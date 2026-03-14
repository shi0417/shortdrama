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
import type { PipelineReferenceContext } from './pipeline-reference-context.service';
import { PipelineReferenceContextService } from './pipeline-reference-context.service';
import { EpisodeStoryVersionService } from './episode-story-version.service';

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_SOURCE_CHAR_BUDGET = 30000;
const DRAFT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_DRAFTS = 50;
/** P0: 禁止占位/极短正文落库；正文最小长度 */
const MIN_STORY_TEXT_LENGTH = 50;
/** 占位串模板，仅用于校验与日志，不再作为成功路径 fallback */
const PLACEHOLDER_STORY_TEXT_TEMPLATE = (epNum: number) => `第${epNum}集故事正文。`;

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

/** LLM 写作批返回项（camel / snake 兼容 + content/text/body 兼容） */
interface WriterItemLike {
  episodeNumber?: number;
  episode_number?: number;
  title?: string;
  summary?: string;
  storyText?: string;
  story_text?: string;
  content?: string;
  text?: string;
  body?: string;
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
    this.logger.log(
      `[episode-story][generateDraft] novelId=${novelId} targetCount=${targetCount} batchSize=${batchSize} refTablesCount=${referenceTables.length}`,
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
    this.logger.log(`[episode-story][splitBatches] batchCount=${batches.length}`);
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
        i + 1,
        batches.length,
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
    this.logger.log(
      `[episode-story][merge] actualEpisodes=${allEpisodes.length} missing=${missing.length ? missing.join(',') : 'none'}`,
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
    const usingDraftId = !!dto.draftId;
    this.logger.log(
      `[episode-story][persist] novelId=${novelId} usingDraftId=${usingDraftId} episodeCount=${draft.episodes.length}`,
    );
    this.assertDraftQualityBeforePersist(draft);
    const episodeNumbers: number[] = [];
    for (const ep of draft.episodes) {
      const storyLen = typeof ep.storyText === 'string' ? ep.storyText.length : 0;
      const isPlaceholder =
        typeof ep.storyText === 'string' &&
        ep.storyText.trim() === PLACEHOLDER_STORY_TEXT_TEMPLATE(ep.episodeNumber);
      this.logger.log(
        `[episode-story][persist][episode] ep=${ep.episodeNumber} title=${ep.title ?? '(empty)'} storyLen=${storyLen} isPlaceholder=${isPlaceholder}`,
      );
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
    this.logger.log(`[episode-story][persist][summary] inserted=${episodeNumbers.length}`);
    return {
      ok: true,
      summary: { episodeNumbers, versionCount: draft.episodes.length },
    };
  }

  /** P0: 写库前质量门禁，禁止占位或过短 storyText 落库 */
  private assertDraftQualityBeforePersist(draft: EpisodeStoryDraft): void {
    for (const ep of draft.episodes) {
      const epNum = ep.episodeNumber;
      if (epNum == null || typeof epNum !== 'number' || Number.isNaN(epNum)) {
        this.logger.warn('[episode-story][persist] invalid episodeNumber, blocking');
        throw new BadRequestException(
          'Episode story draft contains placeholder or too-short storyText. Persist blocked.',
        );
      }
      const storyText = ep.storyText;
      if (typeof storyText !== 'string') {
        this.logger.warn('[episode-story][persist] storyText not string, blocking');
        throw new BadRequestException(
          'Episode story draft contains placeholder or too-short storyText. Persist blocked.',
        );
      }
      const trimmed = storyText.trim();
      if (trimmed.length < MIN_STORY_TEXT_LENGTH) {
        this.logger.warn(
          `[episode-story][persist] storyText too short ep=${epNum} len=${trimmed.length}, blocking`,
        );
        throw new BadRequestException(
          'Episode story draft contains placeholder or too-short storyText. Persist blocked.',
        );
      }
      if (trimmed === PLACEHOLDER_STORY_TEXT_TEMPLATE(epNum)) {
        this.logger.warn(`[episode-story][persist] storyText is placeholder ep=${epNum}, blocking`);
        throw new BadRequestException(
          'Episode story draft contains placeholder or too-short storyText. Persist blocked.',
        );
      }
    }
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
    const refTables = (dto.referenceTables ?? []) as EpisodeStoryReferenceTable[];
    return this.runCheck(novelId, draft, refTables, dto.modelKey);
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
    const promptChars = systemMsg.length + userMsg.length;
    this.logger.log(`[episode-story][planner] promptChars=${promptChars}`);
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
    const rawPreview = raw.trim().slice(0, 500);
    this.logger.log(`[episode-story][planner][raw] preview=${rawPreview}`);
    if (!res.ok) throw new BadRequestException(`Planner request failed: ${res.status}`);
    const content = this.extractModelContent(raw);
    const contentPreview = content.trim().slice(0, 500);
    this.logger.log(`[episode-story][planner][content] preview=${contentPreview}`);
    const parsed = this.parseJsonFromText(content);
    const planLike = parsed as unknown[] | { episodes?: unknown[]; plan?: unknown[] };
    const arr = Array.isArray(planLike) ? planLike : planLike?.episodes ?? planLike?.plan ?? [];
    if (arr.length === 0) {
      this.logger.warn('[episode-story][planner] empty result after parse, throwing');
      throw new BadRequestException('Episode story planner returned empty result.');
    }
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
    this.logger.log(`[episode-story][planner][parse] arrLen=${arr.length} normalizedPlanLen=${plan.length}`);
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
    batchIndex?: number,
    totalBatches?: number,
  ): Promise<EpisodeStoryDraft['episodes']> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const batchPlan = JSON.stringify(batch, null, 2);
    const userMsg = `上一批最后一集摘要：${prevSummary || '（无）'}\n\n本批规划：\n${batchPlan}\n\n参考上下文（节选）：\n${contextBlock.slice(0, 30000)}\n\n${userInstruction ? `用户要求：${userInstruction}` : ''}`;
    const systemMsg =
      '你是短剧故事正文写作助手。根据本批每集的规划（title、summary、storyBeat），生成每集的完整连续故事正文 storyText。只输出严格 JSON 数组，每项含 episodeNumber、title、summary、storyText。';
    const promptChars = systemMsg.length + userMsg.length;
    const requestedEpisodes = batch.map((b) => b.episodeNumber).join(',');
    this.logger.log(
      `[episode-story][writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}] promptChars=${promptChars} requestedEpisodes=${requestedEpisodes}`,
    );
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
    const rawPreview = raw.trim().slice(0, 500);
    this.logger.log(
      `[episode-story][writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][raw] preview=${rawPreview}`,
    );
    if (!res.ok) throw new BadRequestException(`Writer batch request failed: ${res.status}`);
    const content = this.extractModelContent(raw);
    const contentPreview = content.trim().slice(0, 500);
    this.logger.log(
      `[episode-story][writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][content] preview=${contentPreview}`,
    );
    const parsed = this.parseJsonFromText(content);
    const withEpisodes = parsed as unknown[] | { episodes?: unknown[] };
    const arr = Array.isArray(withEpisodes) ? withEpisodes : withEpisodes?.episodes ?? [];
    this.logger.log(
      `[episode-story][writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][parse] arrLen=${arr.length}`,
    );
    if (arr.length === 0) {
      this.logger.warn('[episode-story][writer] empty result, throwing');
      throw new BadRequestException('Episode story writer returned empty result.');
    }
    if (arr.length < batch.length) {
      this.logger.warn(
        `[episode-story][writer] fewer items than batch: arrLen=${arr.length} batchLen=${batch.length}`,
      );
      throw new BadRequestException(
        'Episode story writer returned fewer items than requested batch.',
      );
    }
    let invalidStoryTextCount = 0;
    const out: EpisodeStoryDraft['episodes'] = [];
    for (let i = 0; i < batch.length; i++) {
      const one = (arr[i] || {}) as WriterItemLike;
      const epNum = (one.episodeNumber ?? one.episode_number ?? batch[i]?.episodeNumber ?? i + 1) as number;
      const normalizedStoryText = this.normalizeWriterStoryText(one);
      const placeholderStr = PLACEHOLDER_STORY_TEXT_TEMPLATE(epNum);
      const isValid =
        typeof normalizedStoryText === 'string' &&
        normalizedStoryText.trim().length >= MIN_STORY_TEXT_LENGTH &&
        normalizedStoryText.trim() !== placeholderStr;
      if (!isValid) {
        invalidStoryTextCount += 1;
      } else {
        out.push({
          episodeNumber: epNum,
          title: one.title ?? batch[i]?.title,
          summary: one.summary ?? batch[i]?.summary,
          storyText: normalizedStoryText,
        });
      }
    }
    this.logger.log(
      `[episode-story][writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][validate] requested=${batch.length} parsed=${arr.length} invalidStoryTextCount=${invalidStoryTextCount}`,
    );
    if (invalidStoryTextCount > 0) {
      this.logger.warn(
        `[episode-story][writer] invalid storyText count=${invalidStoryTextCount}, throwing`,
      );
      throw new BadRequestException(
        'Episode story writer returned invalid storyText for some episodes.',
      );
    }
    return out;
  }

  /** 从 LLM 返回项中取正文，兼容 storyText / story_text / content / text / body */
  private normalizeWriterStoryText(one: WriterItemLike): string | null {
    const candidates = [
      one.storyText,
      one.story_text,
      one.content,
      one.text,
      one.body,
    ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return candidates[0]?.trim() ?? null;
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
    referenceTables: EpisodeStoryReferenceTable[],
    modelKey?: string,
  ): Promise<StoryCheckReportDto> {
    const ruleReport = this.runRuleBasedCheck(draft);
    if (referenceTables.length === 0) {
      return {
        ...ruleReport,
        warnings: ['未传入参考表，检查仅基于草稿文本。'],
      };
    }
    try {
      const refTables = referenceTables as string[];
      const context = await this.refContext.getContext(novelId, {
        requestedTables: refTables,
        startEpisode: 1,
        endEpisode: draft.episodes.length,
        optionalTablesCharBudget: 12000,
        overallCharBudget: 20000,
      });
      const checkPrompt = this.buildStoryCheckPrompt(draft, context);
      const usedModel = (modelKey?.trim() || process.env.LC_STORY_CHECK_MODEL || 'default').slice(0, 100);
      const llmReport = await this.runStoryCheckLlm(usedModel, checkPrompt);
      return this.mergeRuleAndLlmReport(ruleReport, llmReport, referenceTables.length > 0);
    } catch (err) {
      this.logger.warn('QA v2 LLM check failed, falling back to rule report', err);
      return {
        ...ruleReport,
        warnings: [
          ...(ruleReport.warnings || []),
          '参考表驱动 QA 调用失败，已退回仅规则检查结果。',
        ].filter(Boolean),
      };
    }
  }

  private runRuleBasedCheck(draft: EpisodeStoryDraft): StoryCheckReportDto {
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
      warnings: undefined,
    };
  }

  private buildStoryCheckPrompt(draft: EpisodeStoryDraft, context: PipelineReferenceContext): string {
    const draftSummary = draft.episodes
      .map(
        (ep) =>
          `第${ep.episodeNumber}集 title:${ep.title ?? ''} summary:${(ep.summary ?? '').slice(0, 120)} story:${(ep.storyText ?? '').slice(0, 350)}`,
      )
      .join('\n');
    const refBlock = this.refContext.buildNarratorPromptContext(context, { charBudget: 12000 });
    const episodesPreview = JSON.stringify(context.episodes?.slice(0, 80) ?? [], null, 2);
    const structurePreview = JSON.stringify(context.structureTemplates?.slice(0, 30) ?? [], null, 2);
    const hookPreview = JSON.stringify(context.hookRhythms?.slice(0, 80) ?? [], null, 2);
    return `【待检查故事草稿摘要】\n${draftSummary}\n\n【核心参考】\nnovel_episodes(节选):\n${episodesPreview}\n\ndrama_structure_template(节选):\n${structurePreview}\n\nnovel_hook_rhythm(节选):\n${hookPreview}\n\n【扩展参考】\n${refBlock}\n\n请对上述故事草稿做参考表驱动 QA，输出严格 JSON：\n{\n  "overallScore": number(0-100),\n  "episodeIssues": [{"episodeNumber": number, "issues": [{"type": "outline_mismatch|structure_mismatch|character_inconsistency|continuity_issue|weak_hook|too_short|generic_writing|missing_text", "message": "string", "severity": "low|medium|high"}]}],\n  "suggestions": [{"episodeNumber": number|null, "suggestion": "string"}]\n}\n只输出 JSON，不要 markdown 和解释。`;
  }

  private async runStoryCheckLlm(
    modelKey: string,
    prompt: string,
  ): Promise<{
    overallScore?: number;
    episodeIssues?: StoryCheckReportDto['episodeIssues'];
    suggestions?: StoryCheckReportDto['suggestions'];
  }> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是短剧故事 QA 助手。根据核心三表与扩展参考表，检查故事草稿的提纲一致性、结构节奏、人物设定、连续性、尾钩与可读性。只输出指定 JSON，不要其他内容。',
        },
        { role: 'user', content: prompt },
      ],
    });
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    const raw = await res.text();
    if (!res.ok) throw new BadRequestException(`Story check LLM failed: ${res.status}`);
    const content = this.extractModelContent(raw);
    const parsed = this.parseJsonFromText(content) as Record<string, unknown>;
    const episodeIssues = (Array.isArray(parsed.episodeIssues) ? parsed.episodeIssues : []) as StoryCheckReportDto['episodeIssues'];
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : []) as StoryCheckReportDto['suggestions'];
    const overallScore =
      typeof parsed.overallScore === 'number' ? parsed.overallScore : undefined;
    return { overallScore, episodeIssues, suggestions };
  }

  private mergeRuleAndLlmReport(
    ruleReport: StoryCheckReportDto,
    llmReport: { overallScore?: number; episodeIssues?: StoryCheckReportDto['episodeIssues']; suggestions?: StoryCheckReportDto['suggestions'] },
    usedRefTables: boolean,
  ): StoryCheckReportDto {
    const byEp = new Map<number, StoryCheckReportDto['episodeIssues'][0]['issues']>();
    for (const item of ruleReport.episodeIssues) {
      byEp.set(item.episodeNumber, [...item.issues]);
    }
    for (const item of llmReport.episodeIssues ?? []) {
      const existing = byEp.get(item.episodeNumber) ?? [];
      for (const issue of item.issues) {
        if (!existing.some((i) => i.type === issue.type && i.message === issue.message))
          existing.push(issue);
      }
      byEp.set(item.episodeNumber, existing);
    }
    const episodeIssues: StoryCheckReportDto['episodeIssues'] = [];
    for (const [epNum, issues] of byEp) {
      if (issues.length) episodeIssues.push({ episodeNumber: epNum, issues });
    }
    episodeIssues.sort((a, b) => a.episodeNumber - b.episodeNumber);
    const ruleScore = ruleReport.overallScore;
    const llmScore = llmReport.overallScore;
    const overallScore =
      typeof llmScore === 'number' ? Math.round((ruleScore + llmScore) / 2) : ruleScore;
    const passed = overallScore >= 60;
    const suggestions = [
      ...(ruleReport.suggestions ?? []),
      ...(llmReport.suggestions ?? []),
    ].filter(Boolean);
    return {
      overallScore: Math.max(0, Math.min(100, overallScore)),
      passed,
      episodeIssues,
      suggestions: suggestions.length ? suggestions : (passed ? [] : [{ suggestion: '建议根据逐集问题修订后再写入。' }]),
      warnings: usedRefTables ? undefined : ['未传入参考表，检查仅基于草稿文本。'],
    };
  }

  /**
   * 聚合模型接口常返回 OpenAI-compatible shell，真正的 JSON 在 choices[0].message.content 中。
   * 先从此方法取出 content 再交给 parseJsonFromText，避免把整个响应当 JSON 解析导致 arrLen=0。
   */
  private extractModelContent(raw: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
    if (parsed == null || typeof parsed !== 'object') return raw;
    const obj = parsed as Record<string, unknown>;

    const tryContent = (content: unknown): string | null => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        const parts = content
          .map((p) =>
            p && typeof p === 'object' && 'text' in p
              ? (p as { text?: string }).text
              : typeof p === 'string'
                ? p
                : '',
          )
          .filter(Boolean);
        return parts.join('');
      }
      return null;
    };

    const choices = obj.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0] as Record<string, unknown>;
      const message = first?.message;
      if (message && typeof message === 'object') {
        const msg = message as Record<string, unknown>;
        const c = tryContent(msg.content);
        if (c != null) return c;
      }
      const text = first?.text;
      if (typeof text === 'string') return text;
    }
    const message = obj.message;
    if (message && typeof message === 'object') {
      const msg = message as Record<string, unknown>;
      const c = tryContent(msg.content);
      if (c != null) return c;
    }
    const content = obj.content;
    const c = tryContent(content);
    if (c != null) return c;
    return raw;
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
