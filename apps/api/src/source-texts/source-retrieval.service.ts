import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  WorldviewQueryBuilder,
  WorldviewQueryBundle,
  WorldviewQueryContext,
  WorldviewQueryModuleKey,
} from './worldview-query-builder';
import {
  ScoredSegmentCandidate,
  SegmentCandidate,
  SegmentRerankScorer,
} from './segment-rerank-scorer';

export type WorldviewEvidenceResult = {
  block: string;
  usedSegments: boolean;
  usedFallback: boolean;
  segmentCount: number;
  chapterCount: number;
  evidenceChars: number;
  warnings: string[];
  moduleEvidenceCount: Record<WorldviewQueryModuleKey, number>;
};

const MODULE_TITLE_MAP: Record<WorldviewQueryModuleKey, string> = {
  payoff: '爽点架构证据',
  opponents: '对手矩阵证据',
  power: '权力升级证据',
  traitor: '内鬼系统证据',
  story_phase: '故事阶段证据',
};

const MODULE_TARGET_RANGE: Record<
  WorldviewQueryModuleKey,
  { min: number; max: number; candidateLimit: number }
> = {
  payoff: { min: 3, max: 5, candidateLimit: 24 },
  opponents: { min: 3, max: 4, candidateLimit: 20 },
  power: { min: 3, max: 5, candidateLimit: 22 },
  traitor: { min: 2, max: 3, candidateLimit: 18 },
  story_phase: { min: 3, max: 5, candidateLimit: 24 },
};

const MODULE_ORDER: WorldviewQueryModuleKey[] = [
  'payoff',
  'opponents',
  'power',
  'traitor',
  'story_phase',
];

const DEFAULT_EVIDENCE_CHARS = 24000;
const RAW_FALLBACK_CHARS = 2500;
const MIN_FINAL_SEGMENTS = 10;
const MAX_FINAL_SEGMENTS = 20;
const SIMILARITY_THRESHOLD = 0.8;

@Injectable()
export class SourceRetrievalService {
  private readonly queryBuilder = new WorldviewQueryBuilder();
  private readonly rerankScorer = new SegmentRerankScorer();

  constructor(private readonly dataSource: DataSource) {}

  async buildWorldviewEvidence(
    novelId: number,
    requestedCharBudget?: number,
  ): Promise<WorldviewEvidenceResult> {
    const warnings: string[] = [];
    const evidenceBudget = Math.max(
      20000,
      Math.min(requestedCharBudget ?? DEFAULT_EVIDENCE_CHARS, 40000),
    );
    const emptyModuleCounts = this.createEmptyModuleCounts();
    const hasSegmentsTable = await this.hasSegmentsTable();

    if (!hasSegmentsTable) {
      warnings.push('novel_source_segments 不存在，已回退到小段 raw source_text');
      return this.buildFallbackResult(novelId, warnings, emptyModuleCounts);
    }

    const queryContext = await this.loadWorldviewQueryContext(novelId);
    const bundles = this.queryBuilder.build(queryContext);
    const moduleCandidates = await Promise.all(
      bundles.map(async (bundle) => ({
        bundle,
        candidates: await this.retrieveModuleCandidates(novelId, bundle),
      })),
    );

    const selectedByModule = new Map<WorldviewQueryModuleKey, ScoredSegmentCandidate[]>();
    for (const { bundle, candidates } of moduleCandidates) {
      selectedByModule.set(bundle.moduleKey, this.selectModuleSegments(bundle, candidates));
    }

    const merged = this.mergeModuleSegments(selectedByModule, evidenceBudget);
    if (merged.length) {
      const moduleEvidenceCount = this.createEmptyModuleCounts();
      for (const moduleKey of MODULE_ORDER) {
        moduleEvidenceCount[moduleKey] = (selectedByModule.get(moduleKey) ?? []).length;
      }

      const evidenceChars = merged.reduce((sum, item) => sum + item.charLength, 0);
      const chapterCount = new Set(
        merged.map((item) => item.chapterLabel || `__null__${item.id}`),
      ).size;

      return {
        block: this.buildModuleEvidenceBlock(selectedByModule),
        usedSegments: true,
        usedFallback: false,
        segmentCount: merged.length,
        chapterCount,
        evidenceChars,
        warnings,
        moduleEvidenceCount,
      };
    }

    warnings.push('未命中有效 segments，已回退到少量原始素材节选');
    return this.buildFallbackResult(novelId, warnings, emptyModuleCounts);
  }

  private async loadWorldviewQueryContext(
    novelId: number,
  ): Promise<WorldviewQueryContext> {
    const [
      setCoreRows,
      timelines,
      characters,
      keyNodes,
      explosions,
      skeletonTopics,
      skeletonTopicItems,
    ] = await Promise.all([
      this.dataSource.query(
        `
        SELECT title, protagonist_name, protagonist_identity, target_story, rewrite_goal, constraint_text, core_text
        FROM set_core
        WHERE novel_id = ? AND is_active = 1
        ORDER BY version DESC, id DESC
        LIMIT 1
        `,
        [novelId],
      ),
      this.dataSource.query(
        `
        SELECT time_node, event
        FROM novel_timelines
        WHERE novel_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [novelId],
      ),
      this.dataSource.query(
        `
        SELECT name, faction, description, personality
        FROM novel_characters
        WHERE novel_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [novelId],
      ),
      this.dataSource.query(
        `
        SELECT category, title, description
        FROM novel_key_nodes
        WHERE novel_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [novelId],
      ),
      this.dataSource.query(
        `
        SELECT explosion_type, title, subtitle, scene_restoration
        FROM novel_explosions
        WHERE novel_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [novelId],
      ),
      this.dataSource.query(
        `
        SELECT topic_key, topic_name, description
        FROM novel_skeleton_topics
        WHERE novel_id = ? AND is_enabled = 1
        ORDER BY sort_order ASC, id ASC
        `,
        [novelId],
      ),
      this.dataSource.query(
        `
        SELECT item_title, content, source_ref
        FROM novel_skeleton_topic_items
        WHERE novel_id = ?
        ORDER BY sort_order ASC, id ASC
        `,
        [novelId],
      ),
    ]);

    return {
      setCore: setCoreRows[0] ?? null,
      timelines,
      characters,
      keyNodes,
      explosions,
      skeletonTopics,
      skeletonTopicItems,
    };
  }

  private async retrieveModuleCandidates(
    novelId: number,
    bundle: WorldviewQueryBundle,
  ): Promise<ScoredSegmentCandidate[]> {
    const queryParts = [...bundle.terms.slice(0, 18), ...bundle.phrases.slice(0, 8)]
      .map((item) => this.normalizeText(item))
      .filter(Boolean)
      .slice(0, 24);
    if (!queryParts.length) {
      return [];
    }

    const conditions = queryParts
      .map(
        () =>
          '(keyword_text LIKE ? OR title_hint LIKE ? OR chapter_label LIKE ? OR content_text LIKE ?)',
      )
      .join(' OR ');
    const bindings: Array<string | number> = [novelId];
    queryParts.forEach((term) => {
      const like = `%${term}%`;
      bindings.push(like, like, like, like);
    });

    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        chapter_label AS chapterLabel,
        title_hint AS titleHint,
        char_length AS charLength,
        content_text AS contentText,
        keyword_text AS keywordText,
        segment_index AS segmentIndex
      FROM novel_source_segments
      WHERE novel_id = ? AND is_active = 1 AND (${conditions})
      ORDER BY segment_index ASC
      LIMIT ?
      `,
      [...bindings, MODULE_TARGET_RANGE[bundle.moduleKey].candidateLimit],
    );

    return rows
      .map((row: Record<string, unknown>) =>
        this.rerankScorer.scoreModuleCandidate(
          {
            id: Number(row.id),
            chapterLabel: this.normalizeText(row.chapterLabel) || null,
            titleHint: this.normalizeText(row.titleHint) || null,
            charLength: Number(row.charLength ?? 0),
            contentText: this.normalizeText(row.contentText),
            keywordText: this.normalizeText(row.keywordText) || null,
            segmentIndex: Number(row.segmentIndex ?? 0),
          },
          bundle,
        ),
      )
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.segmentIndex - b.segmentIndex);
  }

  private selectModuleSegments(
    bundle: WorldviewQueryBundle,
    candidates: ScoredSegmentCandidate[],
  ): ScoredSegmentCandidate[] {
    if (!candidates.length) return [];

    const selected: ScoredSegmentCandidate[] = [];
    const chapterCounter = new Map<string, number>();
    const target = MODULE_TARGET_RANGE[bundle.moduleKey];

    for (const candidate of candidates) {
      if (
        selected.some(
          (existing) =>
            this.rerankScorer.similarity(existing.contentText, candidate.contentText) >
            SIMILARITY_THRESHOLD,
        )
      ) {
        continue;
      }

      const chapterKey = candidate.chapterLabel || `__null__${Math.floor(candidate.segmentIndex / 2)}`;
      const chapterHits = chapterCounter.get(chapterKey) ?? 0;
      if (chapterHits >= 2) {
        continue;
      }

      selected.push(candidate);
      chapterCounter.set(chapterKey, chapterHits + 1);

      if (selected.length >= target.max) {
        break;
      }
    }

    return selected.length >= target.min ? selected : selected.slice(0, target.max);
  }

  private mergeModuleSegments(
    selectedByModule: Map<WorldviewQueryModuleKey, ScoredSegmentCandidate[]>,
    evidenceBudget: number,
  ): ScoredSegmentCandidate[] {
    const merged: ScoredSegmentCandidate[] = [];
    const chapterCounter = new Map<string, number>();
    let totalChars = 0;

    for (const moduleKey of MODULE_ORDER) {
      const rows = selectedByModule.get(moduleKey) ?? [];
      for (const row of rows) {
        if (
          merged.some(
            (existing) =>
              this.rerankScorer.similarity(existing.contentText, row.contentText) >
              SIMILARITY_THRESHOLD,
          )
        ) {
          continue;
        }

        const chapterKey = row.chapterLabel || `__null__${Math.floor(row.segmentIndex / 2)}`;
        const chapterHits = chapterCounter.get(chapterKey) ?? 0;
        if (chapterHits >= 2) {
          continue;
        }

        if (totalChars + row.charLength > evidenceBudget && merged.length >= MIN_FINAL_SEGMENTS) {
          continue;
        }

        merged.push(row);
        chapterCounter.set(chapterKey, chapterHits + 1);
        totalChars += row.charLength;

        if (merged.length >= MAX_FINAL_SEGMENTS || totalChars >= evidenceBudget) {
          break;
        }
      }
    }

    return merged;
  }

  private buildModuleEvidenceBlock(
    selectedByModule: Map<WorldviewQueryModuleKey, ScoredSegmentCandidate[]>,
  ): string {
    const sections: string[] = [];

    for (const moduleKey of MODULE_ORDER) {
      const rows = selectedByModule.get(moduleKey) ?? [];
      if (!rows.length) continue;
      sections.push(
        [
          `【${MODULE_TITLE_MAP[moduleKey]}】`,
          ...rows.map((item) => {
            const sourceTitle =
              [item.chapterLabel, item.titleHint].filter(Boolean).join('｜') ||
              `片段#${item.segmentIndex}`;
            return `来源：${sourceTitle}\n证据：${item.contentText}`;
          }),
        ].join('\n\n'),
      );
    }

    return sections.join('\n\n');
  }

  private async buildFallbackResult(
    novelId: number,
    warnings: string[],
    moduleEvidenceCount: Record<WorldviewQueryModuleKey, number>,
  ): Promise<WorldviewEvidenceResult> {
    const fallback = await this.getRawFallbackBlock(novelId);
    if (fallback) {
      return {
        block: fallback,
        usedSegments: false,
        usedFallback: true,
        segmentCount: 0,
        chapterCount: 0,
        evidenceChars: fallback.length,
        warnings,
        moduleEvidenceCount,
      };
    }

    warnings.push('未命中 segments，且没有可用的原始素材 fallback');
    return {
      block: '',
      usedSegments: false,
      usedFallback: false,
      segmentCount: 0,
      chapterCount: 0,
      evidenceChars: 0,
      warnings,
      moduleEvidenceCount,
    };
  }

  private createEmptyModuleCounts(): Record<WorldviewQueryModuleKey, number> {
    return {
      payoff: 0,
      opponents: 0,
      power: 0,
      traitor: 0,
      story_phase: 0,
    };
  }

  private async getRawFallbackBlock(novelId: number): Promise<string> {
    const rows = await this.dataSource.query(
      `
      SELECT source_text AS sourceText
      FROM drama_source_text
      WHERE novels_id = ?
      ORDER BY update_time DESC, id DESC
      LIMIT 1
      `,
      [novelId],
    );
    const sourceText = this.normalizeText(rows[0]?.sourceText);
    if (!sourceText) {
      return '';
    }
    return ['【原始素材节选（fallback）】', sourceText.slice(0, RAW_FALLBACK_CHARS)].join('\n');
  }

  private normalizeText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    return '';
  }

  private async hasSegmentsTable(): Promise<boolean> {
    const rows = await this.dataSource.query(
      `
      SELECT 1
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'novel_source_segments'
      LIMIT 1
      `,
    );
    return rows.length > 0;
  }
}
