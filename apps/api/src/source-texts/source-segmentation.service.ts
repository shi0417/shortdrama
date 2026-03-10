import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaSourceText } from '../entities/drama-source-text.entity';
import { NovelSourceSegment } from '../entities/novel-source-segment.entity';

type RawSourceTextRow = {
  id: number;
  novelsId: number;
  sourceText: string | null;
  updateTime: Date | null;
};

type SegmentDraft = {
  chapterLabel: string | null;
  titleHint: string | null;
  startOffset: number;
  endOffset: number;
  charLength: number;
  contentText: string;
  keywordText: string | null;
};

type BlockDraft = {
  chapterLabel: string | null;
  titleHint: string | null;
  startOffset: number;
  endOffset: number;
  contentText: string;
};

type TextUnit = {
  text: string;
  start: number;
  end: number;
};

const MIN_MEANINGFUL_LENGTH = 100;
const TARGET_SEGMENT_LENGTH = 1800;
const MAX_SEGMENT_LENGTH = 2600;
const OVERLAP_CHARS = 200;
const MAX_KEYWORD_TEXT_LENGTH = 512;
const CJK_HEADING_NUMBER =
  '0-9一二三四五六七八九十百千万〇零两壹贰叁肆伍陆柒捌玖拾佰仟';
const HEADING_REGEX = new RegExp(
  `^(?:第[${CJK_HEADING_NUMBER}]+[章节部篇卷回]|题记|附录(?:[${CJK_HEADING_NUMBER}]+)?(?:\\s*[^\\n]{0,20})?)$`,
  'u',
);

@Injectable()
export class SourceSegmentationService {
  constructor(
    @InjectRepository(DramaSourceText)
    private readonly sourceTextsRepository: Repository<DramaSourceText>,
    @InjectRepository(NovelSourceSegment)
    private readonly sourceSegmentsRepository: Repository<NovelSourceSegment>,
  ) {}

  async generateSegments(novelId: number) {
    await this.ensureSegmentsTable();

    const sourceTexts = await this.loadSourceTexts(novelId);
    if (!sourceTexts.length) {
      throw new NotFoundException(`No source texts found for novel ${novelId}`);
    }

    const currentVersion = await this.getCurrentVersion(novelId);
    const nextVersion = currentVersion + 1;
    const warnings: string[] = [];
    const sourceStats: Array<{
      sourceTextId: number;
      contentLength: number;
      generatedSegments: number;
      skippedSegments: number;
    }> = [];
    const entities: NovelSourceSegment[] = [];

    for (const sourceText of sourceTexts) {
      const normalized = this.normalizeSourceText(sourceText.sourceText);
      if (!normalized) {
        warnings.push(`source_text_id=${sourceText.id} 内容为空，已跳过`);
        sourceStats.push({
          sourceTextId: sourceText.id,
          contentLength: 0,
          generatedSegments: 0,
          skippedSegments: 0,
        });
        continue;
      }

      const { segments, skippedSegments } = this.buildSegmentsFromSourceText(normalized);
      let segmentIndex = 0;
      for (const segment of segments) {
        entities.push(
          this.sourceSegmentsRepository.create({
            novelId,
            sourceTextId: sourceText.id,
            segmentIndex,
            chapterLabel: segment.chapterLabel,
            titleHint: segment.titleHint,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset,
            charLength: segment.charLength,
            contentText: segment.contentText,
            keywordText: segment.keywordText,
            isActive: 1,
            version: nextVersion,
          }),
        );
        segmentIndex += 1;
      }

      sourceStats.push({
        sourceTextId: sourceText.id,
        contentLength: normalized.length,
        generatedSegments: segments.length,
        skippedSegments,
      });
    }

    await this.sourceSegmentsRepository
      .createQueryBuilder()
      .update(NovelSourceSegment)
      .set({ isActive: 0 })
      .where('novel_id = :novelId AND is_active = 1', { novelId })
      .execute();

    if (entities.length) {
      await this.sourceSegmentsRepository.insert(entities);
    } else {
      warnings.push('未生成任何有效 segment，请检查原始素材内容结构');
    }

    return {
      novelId,
      sourceTextCount: sourceTexts.length,
      generatedSegments: entities.length,
      skippedSegments: sourceStats.reduce((sum, item) => sum + item.skippedSegments, 0),
      version: nextVersion,
      warnings,
      bySourceText: sourceStats,
    };
  }

  async getSummary(novelId: number) {
    if (!(await this.hasSegmentsTable())) {
      return {
        novelId,
        hasActiveSegments: false,
        activeSegments: 0,
        sourceTextCount: 0,
        activeVersion: null,
        latestGeneratedAt: null,
        sources: [],
      };
    }

    const summaryRows = await this.sourceSegmentsRepository.query(
      `
      SELECT
        source_text_id AS sourceTextId,
        COUNT(*) AS segmentCount,
        MAX(version) AS maxVersion,
        MAX(updated_at) AS latestGeneratedAt,
        COUNT(DISTINCT COALESCE(chapter_label, CONCAT('__null__', segment_index))) AS chapterCount
      FROM novel_source_segments
      WHERE novel_id = ? AND is_active = 1
      GROUP BY source_text_id
      ORDER BY source_text_id ASC
      `,
      [novelId],
    );

    const activeCountRow = await this.sourceSegmentsRepository.query(
      `
      SELECT
        COUNT(*) AS activeSegments,
        COUNT(DISTINCT source_text_id) AS sourceTextCount,
        MAX(version) AS activeVersion,
        MAX(updated_at) AS latestGeneratedAt
      FROM novel_source_segments
      WHERE novel_id = ? AND is_active = 1
      `,
      [novelId],
    );

    const activeCount = activeCountRow[0] ?? {};

    return {
      novelId,
      hasActiveSegments: Number(activeCount.activeSegments ?? 0) > 0,
      activeSegments: Number(activeCount.activeSegments ?? 0),
      sourceTextCount: Number(activeCount.sourceTextCount ?? 0),
      activeVersion: Number(activeCount.activeVersion ?? 0) || null,
      latestGeneratedAt: activeCount.latestGeneratedAt ?? null,
      sources: summaryRows.map((row: Record<string, unknown>) => ({
        sourceTextId: Number(row.sourceTextId ?? 0),
        segmentCount: Number(row.segmentCount ?? 0),
        chapterCount: Number(row.chapterCount ?? 0),
        version: Number(row.maxVersion ?? 0) || null,
        latestGeneratedAt: row.latestGeneratedAt ?? null,
      })),
    };
  }

  private async loadSourceTexts(novelId: number): Promise<RawSourceTextRow[]> {
    const rows = await this.sourceTextsRepository
      .createQueryBuilder('st')
      .select([
        'st.id AS id',
        'st.novelsId AS novelsId',
        'st.sourceText AS sourceText',
        'st.updateTime AS updateTime',
      ])
      .where('st.novelsId = :novelId', { novelId })
      .orderBy('st.updateTime', 'DESC')
      .addOrderBy('st.id', 'DESC')
      .getRawMany();

    return rows.map((row) => ({
      id: Number(row.id),
      novelsId: Number(row.novelsId),
      sourceText: typeof row.sourceText === 'string' ? row.sourceText : null,
      updateTime: row.updateTime ?? null,
    }));
  }

  private async getCurrentVersion(novelId: number): Promise<number> {
    const row = await this.sourceSegmentsRepository
      .createQueryBuilder('seg')
      .select('COALESCE(MAX(seg.version), 0)', 'maxVersion')
      .where('seg.novelId = :novelId', { novelId })
      .getRawOne();

    return Number(row?.maxVersion ?? 0) || 0;
  }

  private async hasSegmentsTable(): Promise<boolean> {
    const rows = await this.sourceSegmentsRepository.query(
      `
      SELECT 1
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'novel_source_segments'
      LIMIT 1
      `,
    );
    return rows.length > 0;
  }

  private async ensureSegmentsTable(): Promise<void> {
    await this.sourceSegmentsRepository.query(`
      CREATE TABLE IF NOT EXISTS novel_source_segments (
        id INT NOT NULL AUTO_INCREMENT COMMENT 'Primary key',
        novel_id INT NOT NULL COMMENT 'Drama novel id',
        source_text_id INT NOT NULL COMMENT 'Source text row id',
        segment_index INT NOT NULL COMMENT 'Segment order within one source text',
        chapter_label VARCHAR(128) NULL COMMENT 'Detected chapter label such as 第一章 / 第壹部 / 附录 / 题记',
        title_hint VARCHAR(255) NULL COMMENT 'Detected title hint near the segment',
        start_offset INT NOT NULL COMMENT 'Start offset in normalized source text',
        end_offset INT NOT NULL COMMENT 'End offset in normalized source text',
        char_length INT NOT NULL COMMENT 'Segment character length',
        content_text LONGTEXT NOT NULL COMMENT 'Evidence segment raw text',
        keyword_text TEXT NULL COMMENT 'Lightweight extracted keywords for retrieval',
        is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1=active',
        version INT NOT NULL DEFAULT 1 COMMENT 'Version of regenerated segments',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Created time',
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Updated time',
        PRIMARY KEY (id),
        KEY idx_nss_novel_active_segment (novel_id, is_active, segment_index),
        KEY idx_nss_source_active_segment (source_text_id, is_active, segment_index),
        KEY idx_nss_novel_active_chapter (novel_id, is_active, chapter_label),
        CONSTRAINT fk_nss_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id) ON DELETE CASCADE,
        CONSTRAINT fk_nss_source_text FOREIGN KEY (source_text_id) REFERENCES drama_source_text(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Source text evidence segments for worldview retrieval'
    `);
  }

  private buildSegmentsFromSourceText(text: string): {
    segments: SegmentDraft[];
    skippedSegments: number;
  } {
    const blocks = this.splitIntoBlocks(text);
    const segments: SegmentDraft[] = [];
    let skippedSegments = 0;

    for (const block of blocks) {
      if (this.isDirectoryLikeBlock(block.contentText)) {
        skippedSegments += 1;
        continue;
      }

      const pieces = this.splitBlockIntoSegments(block);
      for (const piece of pieces) {
        if (piece.charLength < MIN_MEANINGFUL_LENGTH || !this.isMeaningfulText(piece.contentText)) {
          skippedSegments += 1;
          continue;
        }
        segments.push(piece);
      }
    }

    return { segments, skippedSegments };
  }

  private normalizeSourceText(value: string | null | undefined): string {
    if (!value) return '';
    return value
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private splitIntoBlocks(text: string): BlockDraft[] {
    const lines = this.buildLineInfos(text);
    const headings = lines.filter((line) => this.isHeadingLine(line.text));
    const blocks: BlockDraft[] = [];

    if (!headings.length) {
      return [
        {
          chapterLabel: null,
          titleHint: this.detectTitleHint(text, null),
          startOffset: 0,
          endOffset: text.length,
          contentText: text.trim(),
        },
      ];
    }

    if (headings[0].start > 0) {
      const prefixText = text.slice(0, headings[0].start).trim();
      if (prefixText) {
        blocks.push({
          chapterLabel: null,
          titleHint: this.detectTitleHint(prefixText, null),
          startOffset: 0,
          endOffset: headings[0].start,
          contentText: prefixText,
        });
      }
    }

    for (let index = 0; index < headings.length; index += 1) {
      const current = headings[index];
      const next = headings[index + 1];
      const startOffset = current.start;
      const endOffset = next ? next.start : text.length;
      const contentText = text.slice(startOffset, endOffset).trim();
      if (!contentText) continue;
      blocks.push({
        chapterLabel: current.text.trim(),
        titleHint: this.detectTitleHint(contentText, current.text.trim()),
        startOffset,
        endOffset,
        contentText,
      });
    }

    return blocks;
  }

  private buildLineInfos(text: string): Array<{ text: string; start: number; end: number }> {
    const lines = text.split('\n');
    const results: Array<{ text: string; start: number; end: number }> = [];
    let cursor = 0;
    for (const line of lines) {
      const start = cursor;
      const end = start + line.length;
      results.push({ text: line, start, end });
      cursor = end + 1;
    }
    return results;
  }

  private isHeadingLine(line: string): boolean {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (!trimmed) return false;
    return HEADING_REGEX.test(trimmed);
  }

  private detectTitleHint(text: string, chapterLabel: string | null): string | null {
    const lines = text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (chapterLabel && line === chapterLabel) {
        continue;
      }
      if (this.isHeadingLine(line)) {
        continue;
      }
      if (line.length <= 40) {
        return line;
      }
      break;
    }
    return chapterLabel;
  }

  private isDirectoryLikeBlock(text: string): boolean {
    const lines = text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (lines.length < 6) return false;

    const shortLines = lines.filter((line) => line.length <= 20).length;
    const headingLike = lines.filter(
      (line) => this.isHeadingLine(line) || /^第.+[章节部篇卷回]/u.test(line),
    ).length;
    const punctuationCount = (text.match(/[，。！？；：]/g) || []).length;

    return (
      shortLines / lines.length >= 0.65 &&
      headingLike / lines.length >= 0.45 &&
      punctuationCount <= Math.max(3, Math.floor(lines.length / 6))
    );
  }

  private splitBlockIntoSegments(block: BlockDraft): SegmentDraft[] {
    if (block.contentText.length <= MAX_SEGMENT_LENGTH) {
      return [this.buildSegmentDraft(block, 0, block.contentText.length)];
    }

    const paragraphUnits = this.expandLargeUnits(
      this.splitIntoParagraphUnits(block.contentText),
    );
    if (!paragraphUnits.length) {
      return this.splitWithWindowFallback(block, 0, block.contentText.length);
    }

    const segments: SegmentDraft[] = [];
    let currentUnits: TextUnit[] = [];

    const flushCurrent = () => {
      if (!currentUnits.length) return;
      const start = currentUnits[0].start;
      const end = currentUnits[currentUnits.length - 1].end;
      segments.push(this.buildSegmentDraft(block, start, end));
    };

    for (const unit of paragraphUnits) {
      const currentLength = this.unitsLength(currentUnits);
      const unitLength = unit.end - unit.start;
      const proposedLength =
        currentLength === 0 ? unitLength : currentLength + 2 + unitLength;

      if (
        currentUnits.length > 0 &&
        proposedLength > MAX_SEGMENT_LENGTH &&
        currentLength >= MIN_MEANINGFUL_LENGTH
      ) {
        flushCurrent();
        currentUnits = [...this.getOverlapUnits(currentUnits), unit];
        continue;
      }

      currentUnits.push(unit);
    }

    flushCurrent();

    return segments.length
      ? segments
      : this.splitWithWindowFallback(block, 0, block.contentText.length);
  }

  private splitIntoParagraphUnits(text: string): TextUnit[] {
    const units: TextUnit[] = [];
    let cursor = 0;

    while (cursor < text.length) {
      while (cursor < text.length && /\s/u.test(text[cursor])) {
        cursor += 1;
      }
      if (cursor >= text.length) break;

      let end = cursor;
      while (end < text.length) {
        if (text[end] === '\n' && text[end + 1] === '\n') {
          break;
        }
        end += 1;
      }

      const rawSlice = text.slice(cursor, end);
      const leadingTrim = rawSlice.search(/\S/u);
      const trailingTrimMatch = rawSlice.match(/\s*$/u);
      const trailingTrim = trailingTrimMatch ? trailingTrimMatch[0].length : 0;
      const start = leadingTrim >= 0 ? cursor + leadingTrim : cursor;
      const normalizedEnd = end - trailingTrim;
      const body = text.slice(start, normalizedEnd).trim();
      if (body) {
        units.push({
          text: body,
          start,
          end: normalizedEnd,
        });
      }

      cursor = end;
      while (cursor < text.length && text[cursor] === '\n') {
        cursor += 1;
      }
    }

    return units;
  }

  private expandLargeUnits(units: TextUnit[]): TextUnit[] {
    const expanded: TextUnit[] = [];
    for (const unit of units) {
      if (unit.text.length <= MAX_SEGMENT_LENGTH) {
        expanded.push(unit);
        continue;
      }

      let cursor = 0;
      while (cursor < unit.text.length) {
        const end = Math.min(cursor + TARGET_SEGMENT_LENGTH, unit.text.length);
        const rawText = unit.text.slice(cursor, end).trim();
        if (rawText) {
          const offsetAdjust = unit.text.indexOf(rawText, cursor);
          expanded.push({
            text: rawText,
            start: unit.start + offsetAdjust,
            end: unit.start + offsetAdjust + rawText.length,
          });
        }
        if (end >= unit.text.length) break;
        cursor += TARGET_SEGMENT_LENGTH - OVERLAP_CHARS;
      }
    }
    return expanded;
  }

  private splitWithWindowFallback(
    block: BlockDraft,
    localStart: number,
    localEnd: number,
  ): SegmentDraft[] {
    const segments: SegmentDraft[] = [];
    let cursor = localStart;
    while (cursor < localEnd) {
      const end = Math.min(cursor + TARGET_SEGMENT_LENGTH, localEnd);
      segments.push(this.buildSegmentDraft(block, cursor, end));
      if (end >= localEnd) break;
      cursor += TARGET_SEGMENT_LENGTH - OVERLAP_CHARS;
    }
    return segments;
  }

  private buildSegmentDraft(
    block: BlockDraft,
    localStart: number,
    localEnd: number,
  ): SegmentDraft {
    const rawSlice = block.contentText.slice(localStart, localEnd);
    const contentText = this.cleanSegmentText(rawSlice);
    const absoluteStart = block.startOffset + localStart;
    const absoluteEnd = absoluteStart + contentText.length;
    return {
      chapterLabel: block.chapterLabel,
      titleHint: block.titleHint,
      startOffset: absoluteStart,
      endOffset: absoluteEnd,
      charLength: contentText.length,
      contentText,
      keywordText: this.buildKeywordText(block.chapterLabel, block.titleHint, contentText),
    };
  }

  private cleanSegmentText(value: string): string {
    return value
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private isMeaningfulText(text: string): boolean {
    const normalized = text.replace(/\s+/g, '');
    if (normalized.length < MIN_MEANINGFUL_LENGTH) {
      return false;
    }

    const punctuationCount = (normalized.match(/[，。！？；：]/g) || []).length;
    const headingLikeLines = text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((line) => this.isHeadingLine(line) || /^第.+[章节部篇卷回]/u.test(line)).length;

    if (headingLikeLines >= 3 && punctuationCount <= 1) {
      return false;
    }

    return true;
  }

  private buildKeywordText(
    chapterLabel: string | null,
    titleHint: string | null,
    contentText: string,
  ): string | null {
    const source = [chapterLabel, titleHint, contentText.slice(0, 600)]
      .filter(Boolean)
      .join('\n');
    const tokens = source
      .split(/[\s,，。！？；：、（）()《》“”"'‘’【】\[\]<>…—\-]+/u)
      .map((item) => item.trim())
      .filter(
        (item) =>
          item.length >= 2 &&
          item.length <= 20 &&
          !/^\d+$/u.test(item) &&
          !['我们', '他们', '这个', '一个', '没有', '以及', '因为', '所以'].includes(item),
      );

    const unique = [...new Set(tokens)].slice(0, 24);
    if (!unique.length) {
      return null;
    }
    const keywordText = unique.join(' ').trim();
    return keywordText.slice(0, MAX_KEYWORD_TEXT_LENGTH);
  }

  private unitsLength(units: TextUnit[]): number {
    if (!units.length) return 0;
    return units.reduce((sum, unit, index) => sum + (index > 0 ? 2 : 0) + unit.text.length, 0);
  }

  private getOverlapUnits(units: TextUnit[]): TextUnit[] {
    if (!units.length) return [];
    const selected: TextUnit[] = [];
    let covered = 0;
    for (let index = units.length - 1; index >= 0; index -= 1) {
      selected.unshift(units[index]);
      covered += units[index].text.length;
      if (covered >= OVERLAP_CHARS) {
        break;
      }
    }
    return selected;
  }
}
