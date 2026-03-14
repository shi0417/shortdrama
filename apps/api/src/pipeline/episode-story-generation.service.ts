import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  EpisodeStoryCheckDto,
  EpisodeStoryDraft,
  EpisodeStoryGenerateDraftDto,
  EpisodeStoryGenerateDraftResponse,
  EpisodeStoryPersistDto,
  EpisodeStoryPersistResponse,
  EpisodeStoryPreviewDto,
  EpisodeStoryPreviewResponse,
  EpisodeStoryReferenceSummaryItem,
  EpisodeStoryReferenceTable,
  StoryCheckReportDto,
} from './dto/episode-story-generation.dto';
import { PipelineReferenceContextService } from './pipeline-reference-context.service';
import { EpisodeStoryVersionService } from './episode-story-version.service';

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_SOURCE_CHAR_BUDGET = 30000;
const DRAFT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_DRAFTS = 50;

interface CachedStoryDraft {
  novelId: number;
  draft: EpisodeStoryDraft;
  createdAt: number;
}

/** LLM 规划项（camel / snake 兼容） */
interface PlanItemLike {
  episodeNumber?: number;
  episode_number?: number;
  title?: string;
  episodeTitle?: string;
  summary?: string;
  storyBeat?: string;
}

/** LLM 写作批返回项（camel / snake 兼容） */
interface WriterItemLike {
  episodeNumber?: number;
  episode_number?: number;
  title?: string;
  summary?: string;
  storyText?: string;
  story_text?: string;
}

@Injectable()
export class EpisodeStoryGenerationService {
  private readonly logger = new Logger(EpisodeStoryGenerationService.name);
  private readonly draftCache = new Map<string, CachedStoryDraft>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly refContext: PipelineReferenceContextService,
    private readonly storyVersionService: EpisodeStoryVersionService,
  ) {}

  async previewPrompt(
    novelId: number,
    dto: EpisodeStoryPreviewDto,
  ): Promise<EpisodeStoryPreviewResponse> {
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = dto.modelKey?.trim() || 'default';
    const warnings: string[] = [];
    const { promptPreview, referenceSummary } = await this.buildContextBlocks(
      novelId,
      referenceTables,
      dto.sourceTextCharBudget ?? DEFAULT_SOURCE_CHAR_BUDGET,
      dto.targetEpisodeCount,
      dto.userInstruction,
      warnings,
    );
    return {
      promptPreview,
      usedModelKey,
      referenceTables,
      referenceSummary,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  async generateDraft(
    novelId: number,
    dto: EpisodeStoryGenerateDraftDto,
  ): Promise<EpisodeStoryGenerateDraftResponse> {
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = dto.modelKey?.trim() || 'default';
    const targetCount = dto.targetEpisodeCount ?? (await this.getDefaultEpisodeCount(novelId));
    const batchSize = Math.min(
      Math.max(2, dto.batchSize ?? DEFAULT_BATCH_SIZE),
      10,
    );
    const warnings: string[] = [];

    const { promptPreview, referenceSummary } = await this.buildContextBlocks(
      novelId,
      referenceTables,
      dto.sourceTextCharBudget ?? DEFAULT_SOURCE_CHAR_BUDGET,
      targetCount,
      dto.userInstruction,
      warnings,
    );

    const plan = await this.runPlanner(usedModelKey, novelId, targetCount, promptPreview, dto.userInstruction);
    const batches = this.splitBatches(plan, batchSize);
    const batchInfo: EpisodeStoryGenerateDraftResponse['batchInfo'] = [];
    const allEpisodes: EpisodeStoryDraft['episodes'] = [];
    let prevSummary = '';

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchDraft = await this.runWriterBatch(
        usedModelKey,
        novelId,
        batch,
        plan,
        prevSummary,
        promptPreview,
        dto.userInstruction,
      );
      const startEp = batch[0]?.episodeNumber ?? i * batchSize + 1;
      const endEp = batch[batch.length - 1]?.episodeNumber ?? startEp + batch.length - 1;
      batchInfo.push({
        batchIndex: i + 1,
        range: `${startEp}-${endEp}`,
        success: true,
        episodeCount: batchDraft.length,
      });
      allEpisodes.push(...batchDraft);
      prevSummary = batchDraft.length
        ? (batchDraft[batchDraft.length - 1].summary || batchDraft[batchDraft.length - 1].storyText?.slice(0, 200) || '')
        : '';
    }

    const draft: EpisodeStoryDraft = { episodes: allEpisodes };
    const missing = this.findMissingEpisodeNumbers(
      allEpisodes.map((e) => e.episodeNumber),
      targetCount,
    );
    const finalCompletenessOk = missing.length === 0;
    const countMismatchWarning =
      targetCount && allEpisodes.length !== targetCount
        ? `目标 ${targetCount} 集，实际生成 ${allEpisodes.length} 集`
        : undefined;

    const draftId = this.generateDraftId();
    this.cacheDraft(draftId, { novelId, draft, createdAt: Date.now() });

    return {
      draftId,
      draft,
      usedModelKey,
      promptPreview: dto.allowPromptEdit && dto.promptOverride?.trim() ? dto.promptOverride : promptPreview,
      referenceSummary,
      targetEpisodeCount: targetCount,
      actualEpisodeCount: allEpisodes.length,
      countMismatchWarning,
      warnings: warnings.length ? warnings : undefined,
      batchInfo,
      finalCompletenessOk,
    };
  }

  async persistDraft(
    novelId: number,
    dto: EpisodeStoryPersistDto,
  ): Promise<EpisodeStoryPersistResponse> {
    const draft = await this.resolveDraftForPersist(novelId, dto);
    const episodeNumbers: number[] = [];
    for (const ep of draft.episodes) {
      await this.storyVersionService.create(novelId, {
        episodeNumber: ep.episodeNumber,
        storyType: 'story_text',
        title: ep.title || `第${ep.episodeNumber}集`,
        summary: ep.summary ?? null,
        storyText: ep.storyText,
        generationSource: 'ai',
      });
      episodeNumbers.push(ep.episodeNumber);
    }
    if (dto.draftId) {
      this.deleteCachedDraft(dto.draftId);
    }
    return {
      ok: true,
      summary: { episodeNumbers, versionCount: draft.episodes.length },
    };
  }

  async check(novelId: number, dto: EpisodeStoryCheckDto): Promise<StoryCheckReportDto> {
    await this.assertNovelExists(novelId);
    let draft: EpisodeStoryDraft | null = null;
    if (dto.draftId) {
      const cached = this.getCachedDraft(dto.draftId);
      if (cached && cached.novelId === novelId) draft = cached.draft;
    }
    if (!draft && dto.draft?.episodes?.length) draft = dto.draft;
    if (!draft && dto.versionIds?.length) {
      const episodes: EpisodeStoryDraft['episodes'] = [];
      for (const id of dto.versionIds) {
        const row = await this.storyVersionService.getOne(id);
        if (row && Number(row.novel_id) === novelId) {
          episodes.push({
            episodeNumber: Number(row.episode_number),
            title: String(row.title ?? ''),
            summary: row.summary ? String(row.summary) : undefined,
            storyText: String(row.story_text ?? ''),
          });
        }
      }
      draft = { episodes };
    }
    if (!draft || !draft.episodes.length) {
      throw new BadRequestException('请提供 draftId、draft 或 versionIds');
    }
    return this.runCheck(novelId, draft, dto.referenceTables ?? []);
  }

  private resolveReferenceTables(
    tables: EpisodeStoryReferenceTable[],
  ): EpisodeStoryReferenceTable[] {
    return Array.isArray(tables) ? [...new Set(tables)] : [];
  }

  private async buildContextBlocks(
    novelId: number,
    referenceTables: EpisodeStoryReferenceTable[],
    charBudget: number,
    targetEpisodeCount?: number,
    userInstruction?: string,
    warnings?: string[],
  ): Promise<{
    promptPreview: string;
    referenceSummary: EpisodeStoryReferenceSummaryItem[];
  }> {
    const context = await this.refContext.getContext(novelId, {
      requestedTables: referenceTables,
      startEpisode: 1,
      endEpisode: targetEpisodeCount ?? undefined,
      optionalTablesCharBudget: Math.min(charBudget, 25000),
      overallCharBudget: charBudget,
    });
    const block = this.refContext.buildNarratorPromptContext(context, {
      charBudget: Math.min(charBudget, 25000),
    });
    const summary = this.refContext.buildReferenceSummary(context);
    const refSummary: EpisodeStoryReferenceSummaryItem[] = summary.map((s) => ({
      table: s.table,
      label: s.label,
      rowCount: s.rowCount,
      fields: s.fields,
    }));
    const episodesText = JSON.stringify(context.episodes?.slice(0, 200) ?? [], null, 2);
    const structureText = JSON.stringify(context.structureTemplates?.slice(0, 50) ?? [], null, 2);
    const hookText = JSON.stringify(context.hookRhythms?.slice(0, 200) ?? [], null, 2);
    const promptPreview = `【核心参考】\nnovel_episodes:\n${episodesText}\n\ndrama_structure_template:\n${structureText}\n\nnovel_hook_rhythm:\n${hookText}\n\n【扩展参考】\n${block}\n\n${userInstruction ? `用户要求：${userInstruction}` : ''}`;
    return { promptPreview, referenceSummary: refSummary };
  }

  private async runPlanner(
    modelKey: string,
    novelId: number,
    targetCount: number,
    contextPreview: string,
    userInstruction?: string,
  ): Promise<{ episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[]> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const systemMsg =
      '你是短剧故事规划助手。根据提供的参考数据，输出每集的轻量规划（episodeNumber、title、summary、storyBeat）。只输出严格 JSON 数组，不要 markdown 和解释。';
    const userMsg = `请为以下短剧生成 ${targetCount} 集的规划（每集含 episodeNumber、title、summary、storyBeat）。\n\n${contextPreview.slice(0, 40000)}`;
    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
    });
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    const raw = await res.text();
    if (!res.ok) throw new BadRequestException(`Planner request failed: ${res.status}`);
    const parsed = this.parseJsonFromText(raw);
    const planLike = parsed as unknown[] | { episodes?: unknown[]; plan?: unknown[] };
    const arr = Array.isArray(planLike) ? planLike : planLike?.episodes ?? planLike?.plan ?? [];
    const plan: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[] = [];
    for (let i = 0; i < (targetCount || 61); i++) {
      const one = arr[i] as PlanItemLike | undefined;
      plan.push({
        episodeNumber: (one?.episodeNumber ?? one?.episode_number ?? i + 1) as number,
        title: one?.title ?? one?.episodeTitle ?? undefined,
        summary: one?.summary ?? undefined,
        storyBeat: one?.storyBeat ?? undefined,
      });
    }
    return plan;
  }

  private splitBatches(
    plan: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[],
    batchSize: number,
  ): { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[][] {
    const batches: typeof plan[] = [];
    for (let i = 0; i < plan.length; i += batchSize) {
      batches.push(plan.slice(i, i + batchSize));
    }
    return batches;
  }

  private async runWriterBatch(
    modelKey: string,
    novelId: number,
    batch: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[],
    plan: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[],
    prevSummary: string,
    contextBlock: string,
    userInstruction?: string,
  ): Promise<EpisodeStoryDraft['episodes']> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const batchPlan = JSON.stringify(batch, null, 2);
    const systemMsg =
      '你是短剧故事正文写作助手。根据本批每集的规划（title、summary、storyBeat），生成每集的完整连续故事正文 storyText。只输出严格 JSON 数组，每项含 episodeNumber、title、summary、storyText。';
    const userMsg = `上一批最后一集摘要：${prevSummary || '（无）'}\n\n本批规划：\n${batchPlan}\n\n参考上下文（节选）：\n${contextBlock.slice(0, 30000)}\n\n${userInstruction ? `用户要求：${userInstruction}` : ''}`;
    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.5,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
    });
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    const raw = await res.text();
    if (!res.ok) throw new BadRequestException(`Writer batch request failed: ${res.status}`);
    const parsed = this.parseJsonFromText(raw);
    const withEpisodes = parsed as unknown[] | { episodes?: unknown[] };
    const arr = Array.isArray(withEpisodes) ? withEpisodes : withEpisodes?.episodes ?? [];
    const out: EpisodeStoryDraft['episodes'] = [];
    for (let i = 0; i < batch.length; i++) {
      const one = (arr[i] || {}) as WriterItemLike;
      const epNum = (one.episodeNumber ?? one.episode_number ?? batch[i]?.episodeNumber ?? i + 1) as number;
      out.push({
        episodeNumber: epNum,
        title: one.title ?? batch[i]?.title,
        summary: one.summary ?? batch[i]?.summary,
        storyText: typeof one.storyText === 'string' ? one.storyText : (one.story_text ?? `第${epNum}集故事正文。`) as string,
      });
    }
    return out;
  }

  private findMissingEpisodeNumbers(
    episodeNumbers: number[],
    targetCount?: number,
  ): number[] {
    if (!targetCount || targetCount <= 0) return [];
    const set = new Set(episodeNumbers);
    const missing: number[] = [];
    for (let i = 1; i <= targetCount; i++) if (!set.has(i)) missing.push(i);
    return missing;
  }

  private generateDraftId(): string {
    return randomUUID();
  }

  private cacheDraft(draftId: string, entry: CachedStoryDraft): void {
    this.cleanExpiredDrafts();
    if (this.draftCache.size >= MAX_CACHED_DRAFTS) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.draftCache) {
        if (v.createdAt < oldest) {
          oldest = v.createdAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.draftCache.delete(oldestKey);
    }
    this.draftCache.set(draftId, entry);
  }

  private getCachedDraft(draftId: string): CachedStoryDraft | null {
    const entry = this.draftCache.get(draftId);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > DRAFT_CACHE_TTL_MS) {
      this.draftCache.delete(draftId);
      return null;
    }
    return entry;
  }

  private deleteCachedDraft(draftId: string): void {
    this.draftCache.delete(draftId);
  }

  private cleanExpiredDrafts(): void {
    const now = Date.now();
    for (const [k, v] of this.draftCache) {
      if (now - v.createdAt > DRAFT_CACHE_TTL_MS) this.draftCache.delete(k);
    }
  }

  private async resolveDraftForPersist(
    novelId: number,
    dto: EpisodeStoryPersistDto,
  ): Promise<EpisodeStoryDraft> {
    if (dto.draftId) {
      const cached = this.getCachedDraft(dto.draftId);
      if (cached) {
        if (cached.novelId !== novelId)
          throw new BadRequestException('draftId 对应的 novelId 与当前请求不匹配');
        return cached.draft;
      }
      if (dto.draft?.episodes?.length) return dto.draft;
      throw new BadRequestException('draftId 已过期或不存在，且未提供 draft');
    }
    if (dto.draft?.episodes?.length) return dto.draft;
    throw new BadRequestException('请提供 draftId 或 draft');
  }

  private async getDefaultEpisodeCount(novelId: number): Promise<number> {
    const rows = await this.dataSource.query<{ cnt: number }[]>(
      'SELECT COUNT(*) AS cnt FROM novel_episodes WHERE novel_id = ?',
      [novelId],
    );
    return Math.max(1, Number(rows[0]?.cnt ?? 61));
  }

  private async runCheck(
    novelId: number,
    draft: EpisodeStoryDraft,
    referenceTables: string[],
  ): Promise<StoryCheckReportDto> {
    const episodeIssues: StoryCheckReportDto['episodeIssues'] = [];
    let score = 80;
    for (const ep of draft.episodes) {
      const issues: StoryCheckReportDto['episodeIssues'][0]['issues'] = [];
      if (!ep.storyText?.trim()) {
        issues.push({ type: 'missing_text', message: '缺少故事正文', severity: 'high' });
        score -= 5;
      }
      if (ep.storyText && ep.storyText.length < 50) {
        issues.push({ type: 'too_short', message: '正文过短', severity: 'medium' });
        score -= 2;
      }
      if (issues.length) episodeIssues.push({ episodeNumber: ep.episodeNumber, issues });
    }
    const passed = score >= 60;
    return {
      overallScore: Math.max(0, Math.min(100, score)),
      passed,
      episodeIssues,
      suggestions: passed ? [] : [{ suggestion: '建议补充或扩写标为 high/medium 的集数正文后再写入。' }],
      warnings: referenceTables.length ? undefined : ['未传入参考表，检查仅基于草稿文本。'],
    };
  }

  private parseJsonFromText(raw: string): unknown {
    const text = (raw || '').trim();
    let jsonStr = text;
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) jsonStr = m[0];
    try {
      return JSON.parse(jsonStr);
    } catch {
      const first = text.indexOf('[');
      const last = text.lastIndexOf(']');
      if (first !== -1 && last > first) jsonStr = text.slice(first, last + 1);
      try {
        return JSON.parse(jsonStr);
      } catch {
        throw new BadRequestException('AI 返回不是有效 JSON');
      }
    }
  }

  private getLcApiEndpoint(): string {
    const raw = process.env.lc_api_url?.trim();
    if (!raw) throw new Error('lc_api_url is not configured');
    const n = raw.replace(/\/+$/, '');
    if (n.endsWith('/v1/chat/completions') || n.endsWith('/chat/completions')) return n;
    return `${n}/v1/chat/completions`;
  }

  private getLcApiKey(): string {
    const key = process.env.lc_api_key?.trim();
    if (!key) throw new Error('lc_api_key is not configured');
    return key;
  }

  private async assertNovelExists(novelId: number): Promise<void> {
    const rows = await this.dataSource.query(
      'SELECT id FROM drama_novels WHERE id = ? LIMIT 1',
      [novelId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }
}
