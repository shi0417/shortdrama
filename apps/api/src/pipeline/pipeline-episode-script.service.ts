import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  EpisodeDurationMode,
  EpisodeGenerationMode,
  PipelineEpisodeScriptGenerateDraftDto,
  PipelineEpisodeScriptPersistDto,
  PipelineEpisodeScriptPreviewDto,
  PipelineEpisodeScriptReferenceTable,
  allowedEpisodeScriptReferenceTables,
} from './dto/pipeline-episode-script.dto';
import { SourceRetrievalService } from '../source-texts/source-retrieval.service';

type RowRecord = Record<string, any>;

type ReferenceSummaryItem = {
  table: PipelineEpisodeScriptReferenceTable;
  label: string;
  rowCount: number;
  fields: string[];
  note?: string;
  usedChars?: number;
};

type EpisodeDraft = {
  episodeNumber: number;
  episodeTitle: string;
  sortOrder: number;
  outline: {
    arc: string;
    opening: string;
    coreConflict: string;
    historyOutline: string;
    rewriteDiff: string;
    outlineContent: string;
  };
  script: {
    hooks: string;
    cliffhanger: string;
    fullContent: string;
  };
  structureTemplate: {
    chapterId: number;
    themeType: string;
    structureName: string;
    powerLevel: number;
    isPowerUpChapter: number;
    powerUpContent: string;
    identityGap: string;
    pressureSource: string;
    firstReverse: string;
    continuousUpgrade: string;
    suspenseHook: string;
    typicalOpening: string;
    suitableTheme: string;
    hotLevel: number;
    remarks: string;
  };
  hookRhythm: {
    episodeNumber: number;
    emotionLevel: number;
    hookType: string;
    description: string;
    cliffhanger: string;
  };
};

type EpisodePackage = {
  version: string;
  novelId: number;
  durationMode: EpisodeDurationMode;
  episodes: EpisodeDraft[];
};

const DEFAULT_REFERENCE_TABLES: PipelineEpisodeScriptReferenceTable[] = [
  'drama_novels',
  'novel_source_segments',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_explosions',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
];

const DEFAULT_CHAR_BUDGET = 30000;
const EPISODE_DEFAULT_MODEL_CANDIDATES = [
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'chatgpt-4o-latest',
];

const PLAN_BATCH_SIZE = 5;
const PLAN_BATCH_MAX_RETRIES = 1;
const PLAN_BATCH_THRESHOLD = 10;
const REPAIR_MAX_ATTEMPTS = 1;

const BATCH_EVIDENCE_CHAR_BUDGET = 6000;
const BATCH_EVIDENCE_MAX_ITEMS = 8;
const BATCH_PROMPT_CHAR_BUDGET = 60000;

// ===== Input Layer Definitions (Layer 1-5) =====
const LAYER_1_CORE_CONSTRAINT: PipelineEpisodeScriptReferenceTable[] = [
  'drama_novels',
  'set_core',
  'novel_adaptation_strategy',
  'adaptation_modes',
];
const LAYER_2_PLOT_SKELETON: PipelineEpisodeScriptReferenceTable[] = [
  'novel_timelines',
  'novel_key_nodes',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
];
const LAYER_3_CHARACTER_FACTION: PipelineEpisodeScriptReferenceTable[] = [
  'novel_characters',
  'set_opponent_matrix',
  'set_opponents',
  'set_traitor_system',
  'set_traitors',
  'set_traitor_stages',
];
const LAYER_4_RHYTHM_CONTROL: PipelineEpisodeScriptReferenceTable[] = [
  'novel_explosions',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_power_ladder',
  'set_story_phases',
];
const LAYER_5_EVIDENCE: PipelineEpisodeScriptReferenceTable[] = [
  'novel_source_segments',
  'drama_source_text',
];

const PLAN_LAYERS: PipelineEpisodeScriptReferenceTable[] = [
  ...LAYER_1_CORE_CONSTRAINT,
  ...LAYER_2_PLOT_SKELETON,
];
const BATCH_STATIC_LAYERS: PipelineEpisodeScriptReferenceTable[] = [
  ...LAYER_1_CORE_CONSTRAINT,
  ...LAYER_3_CHARACTER_FACTION,
];

const EP_RANGE_DYNAMIC_QUERIES: Array<{
  table: PipelineEpisodeScriptReferenceTable;
  label: string;
  sql: string;
  fields: string[];
}> = [
  {
    table: 'set_story_phases',
    label: '当前批次关联故事阶段',
    sql: `SELECT phase_name, start_ep, end_ep, historical_path, rewrite_path
          FROM set_story_phases WHERE novel_id = ? AND (start_ep IS NULL OR start_ep <= ?) AND (end_ep IS NULL OR end_ep >= ?) ORDER BY sort_order ASC`,
    fields: ['phase_name', 'start_ep', 'end_ep', 'historical_path', 'rewrite_path'],
  },
  {
    table: 'set_power_ladder',
    label: '当前批次关联权力阶梯',
    sql: `SELECT level_no, level_title, identity_desc, ability_boundary, start_ep, end_ep
          FROM set_power_ladder WHERE novel_id = ? AND (start_ep IS NULL OR start_ep <= ?) AND (end_ep IS NULL OR end_ep >= ?) ORDER BY sort_order ASC`,
    fields: ['level_no', 'level_title', 'identity_desc', 'ability_boundary', 'start_ep', 'end_ep'],
  },
  {
    table: 'set_traitor_stages',
    label: '当前批次关联内鬼阶段',
    sql: `SELECT stage_title, stage_desc, start_ep, end_ep
          FROM set_traitor_stages WHERE novel_id = ? AND (start_ep IS NULL OR start_ep <= ?) AND (end_ep IS NULL OR end_ep >= ?) ORDER BY sort_order ASC`,
    fields: ['stage_title', 'stage_desc', 'start_ep', 'end_ep'],
  },
  {
    table: 'set_payoff_lines',
    label: '当前批次关联爽点线',
    sql: `SELECT line_key, line_name, line_content, start_ep, end_ep, stage_text
          FROM set_payoff_lines WHERE novel_id = ? AND (start_ep IS NULL OR start_ep <= ?) AND (end_ep IS NULL OR end_ep >= ?) ORDER BY sort_order ASC`,
    fields: ['line_key', 'line_name', 'line_content', 'start_ep', 'end_ep', 'stage_text'],
  },
];

type EpisodePlanItem = {
  episodeNumber: number;
  episodeTitle: string;
  arc: string;
  coreConflict: string;
  historyOutline: string;
  rewriteDiff: string;
  cliffhanger: string;
};

type EpisodePlan = {
  novelId: number;
  durationMode: EpisodeDurationMode;
  targetEpisodeCount: number;
  episodes: EpisodePlanItem[];
};

type BatchRange = {
  batchIndex: number;
  startEpisode: number;
  endEpisode: number;
  planEpisodes: EpisodePlanItem[];
};

type BatchResult = {
  batchIndex: number;
  range: string;
  episodes: RowRecord[];
  success: boolean;
  error?: string;
  retried: boolean;
  repaired: boolean;
  elapsedMs: number;
};

type LayerUsageRecord = {
  layersUsed: string[];
  tablesUsed: string[];
  tablesSkipped: string[];
  dynamicHits?: Record<string, number>;
};

interface CachedEpisodeScriptDraft {
  novelId: number;
  generationMode: string;
  draft: any;
  createdAt: number;
}

@Injectable()
export class PipelineEpisodeScriptService {
  private readonly logger = new Logger(PipelineEpisodeScriptService.name);
  private readonly draftCache = new Map<string, CachedEpisodeScriptDraft>();
  private readonly DRAFT_CACHE_TTL_MS = 30 * 60 * 1000;
  private readonly MAX_CACHED_DRAFTS = 50;

  constructor(
    private readonly dataSource: DataSource,
    private readonly sourceRetrievalService: SourceRetrievalService,
  ) {}

  // ===== Draft cache methods =====

  private generateDraftId(): string {
    return randomUUID();
  }

  private cacheDraft(draftId: string, entry: CachedEpisodeScriptDraft): void {
    this.cleanExpiredDrafts();
    this.enforceDraftCacheLimit();
    this.draftCache.set(draftId, entry);
  }

  private getCachedDraft(draftId: string): CachedEpisodeScriptDraft | null {
    const entry = this.draftCache.get(draftId);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.DRAFT_CACHE_TTL_MS) {
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
    for (const [key, entry] of this.draftCache) {
      if (now - entry.createdAt > this.DRAFT_CACHE_TTL_MS) {
        this.draftCache.delete(key);
      }
    }
  }

  private enforceDraftCacheLimit(): void {
    if (this.draftCache.size < this.MAX_CACHED_DRAFTS) return;
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.draftCache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.draftCache.delete(oldestKey);
  }

  async previewPrompt(novelId: number, dto: PipelineEpisodeScriptPreviewDto) {
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const warnings: string[] = [];
    const { promptPreview, referenceSummary } = await this.buildPrompt(
      novelId,
      referenceTables,
      dto.userInstruction,
      dto.sourceTextCharBudget,
      dto.durationMode,
      dto.generationMode,
      dto.targetEpisodeCount,
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

  async generateDraft(novelId: number, dto: PipelineEpisodeScriptGenerateDraftDto) {
    this.logger.log(
      `[episode-script][generateDraft][input] ${this.toCompactJson({
        novelId,
        modelKey: dto.modelKey || '(auto)',
        generationMode: dto.generationMode || 'outline_and_script',
        durationMode: dto.durationMode || '60s',
        targetEpisodeCount: dto.targetEpisodeCount ?? null,
        referenceTables: dto.referenceTables || [],
        sourceTextCharBudget: dto.sourceTextCharBudget ?? null,
      })}`,
    );
    await this.assertNovelExists(novelId);
    const referenceTables = this.resolveReferenceTables(dto.referenceTables);
    const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
    const warnings: string[] = [];

    const useMultiStage =
      !!(dto.targetEpisodeCount && dto.targetEpisodeCount > PLAN_BATCH_THRESHOLD) &&
      !(dto.allowPromptEdit && this.normalizeText(dto.promptOverride));

    if (useMultiStage) {
      this.logger.log(
        `[episode-script][generateDraft] Using multi-stage plan+batch flow (targetEpisodeCount=${dto.targetEpisodeCount})`,
      );
      return this.generateDraftMultiStage(novelId, dto, referenceTables, usedModelKey, warnings);
    }

    this.logger.log(
      `[episode-script][generateDraft] Using legacy single-shot flow`,
    );
    const { promptPreview, referenceSummary } = await this.buildPrompt(
      novelId,
      referenceTables,
      dto.userInstruction,
      dto.sourceTextCharBudget,
      dto.durationMode,
      dto.generationMode,
      dto.targetEpisodeCount,
      warnings,
    );
    const hitSourceSegments = referenceSummary.some(
      (item) => item.table === 'novel_source_segments' && item.rowCount > 0,
    );
    const skippedDramaSourceText = warnings.some((item) =>
      item.includes('跳过 drama_source_text'),
    );
    this.logger.log(
      `[episode-script][buildPrompt][summary] ${this.toCompactJson({
        novelId,
        usedModelKey,
        promptChars: promptPreview.length,
        referenceTables,
        referenceSummary: this.summarizeReferenceSummary(referenceSummary),
        warningCount: warnings.length,
        warnings: this.summarizeWarnings(warnings),
        hitSourceSegments,
        skippedDramaSourceText,
      })}`,
    );
    const finalPrompt =
      dto.allowPromptEdit && this.normalizeText(dto.promptOverride)
        ? dto.promptOverride!.trim()
        : promptPreview;

    const aiJson = await this.callLcAiApi(usedModelKey, finalPrompt, {
      novelId,
      generationMode: dto.generationMode || 'outline_and_script',
      durationMode: dto.durationMode || '60s',
      targetEpisodeCount: dto.targetEpisodeCount ?? null,
      referenceTables,
    });
    const normalizationWarnings: string[] = [];
    const validationWarnings: string[] = [];
    let draft: EpisodePackage;
    try {
      draft = this.validateAndNormalizeEpisodePackage(
        novelId,
        aiJson,
        dto.durationMode || '60s',
        normalizationWarnings,
        validationWarnings,
        dto.generationMode,
        dto.targetEpisodeCount,
      );
    } catch (error: any) {
      this.logger.error(
        `[episode-script][generateDraft][validation_error] ${this.toCompactJson({
          novelId,
          usedModelKey,
          message: this.getErrorMessage(error),
          name: this.getErrorName(error),
        })}`,
      );
      throw this.toStageBadRequest(
        '[episode-script][generateDraft][validation_error]',
        error,
      );
    }

    const actualEpisodeCount = draft.episodes.length;
    const missingEpisodeNumbers = this.findMissingEpisodeNumbers(
      draft.episodes.map((item) => item.episodeNumber),
      dto.targetEpisodeCount,
    );
    const countMismatchWarning =
      dto.targetEpisodeCount && actualEpisodeCount !== dto.targetEpisodeCount
        ? `【生成集数不足】目标 ${dto.targetEpisodeCount} 集，实际仅生成 ${actualEpisodeCount} 集`
        : undefined;
    this.logger.log(
      `[episode-script][generateDraft][result] ${this.toCompactJson({
        novelId,
        usedModelKey,
        actualEpisodeCount,
        targetEpisodeCount: dto.targetEpisodeCount ?? null,
        missingEpisodeCount: missingEpisodeNumbers.length,
        countMismatchWarning: countMismatchWarning || null,
        normalizationWarningCount: normalizationWarnings.length,
        validationWarningCount: validationWarnings.length,
        validationWarnings: this.summarizeWarnings(validationWarnings),
      })}`,
    );

    const draftId = this.generateDraftId();
    const generationMode = dto.generationMode || 'outline_and_script';
    this.cacheDraft(draftId, {
      novelId,
      generationMode,
      draft: { episodePackage: draft },
      createdAt: Date.now(),
    });
    const draftSizeKB = Math.round(JSON.stringify(draft).length / 1024);
    this.logger.log(
      `[episode-script][generateDraft][cache][stored] ${this.toCompactJson({
        draftId, novelId, generationMode, draftSizeKB, cacheSize: this.draftCache.size,
      })}`,
    );

    return {
      draftId,
      usedModelKey,
      generationMode,
      promptPreview: finalPrompt,
      referenceTables,
      referenceSummary,
      draft: { episodePackage: draft },
      targetEpisodeCount: dto.targetEpisodeCount,
      actualEpisodeCount,
      missingEpisodeNumbers: missingEpisodeNumbers.length ? missingEpisodeNumbers : undefined,
      countMismatchWarning,
      warnings: warnings.length ? warnings : undefined,
      normalizationWarnings: normalizationWarnings.length ? normalizationWarnings : undefined,
      validationWarnings: validationWarnings.length ? validationWarnings : undefined,
    };
  }

  async persistDraft(novelId: number, dto: PipelineEpisodeScriptPersistDto) {
    const persistStartedAt = Date.now();

    // ===== Resolve draft source: draftId (cache) vs payload =====
    let resolvedDraft: Record<string, any>;
    let draftSource: 'cache' | 'payload';
    let usedDraftId: string | undefined;

    if (dto.draftId) {
      const cached = this.getCachedDraft(dto.draftId);
      if (cached) {
        if (cached.novelId !== novelId) {
          this.logger.warn(
            `[episode-script][persist][draftId][mismatch] ${this.toCompactJson({
              draftId: dto.draftId, cachedNovelId: cached.novelId, requestNovelId: novelId,
            })}`,
          );
          throw new BadRequestException({
            message: 'draftId 对应的 novelId 与当前请求不匹配',
            code: 'EPISODE_SCRIPT_DRAFT_ID_NOVEL_MISMATCH',
          });
        }
        resolvedDraft = cached.draft;
        draftSource = 'cache';
        usedDraftId = dto.draftId;
        this.logger.log(
          `[episode-script][persist][draftId][hit] ${this.toCompactJson({
            draftId: dto.draftId, novelId,
          })}`,
        );
      } else if (dto.draft) {
        resolvedDraft = dto.draft;
        draftSource = 'payload';
        this.logger.warn(
          `[episode-script][persist][draftId][miss] ${this.toCompactJson({
            draftId: dto.draftId, novelId, fallback: 'payload_draft',
          })}`,
        );
      } else {
        this.logger.warn(
          `[episode-script][persist][draftId][miss] ${this.toCompactJson({
            draftId: dto.draftId, novelId, fallback: 'none',
          })}`,
        );
        throw new BadRequestException({
          message: 'draftId 已过期或不存在，且未提供 draft fallback，请重新生成草稿',
          code: 'EPISODE_SCRIPT_DRAFT_CACHE_MISS',
        });
      }
    } else if (dto.draft) {
      resolvedDraft = dto.draft;
      draftSource = 'payload';
    } else {
      throw new BadRequestException({
        message: '必须提供 draftId 或 draft',
        code: 'EPISODE_SCRIPT_DRAFT_REQUIRED',
      });
    }

    const draftPayloadSize = (() => {
      try { return JSON.stringify(resolvedDraft).length; } catch { return -1; }
    })();
    this.logger.log(
      `[episode-script][persist][entry] ${this.toCompactJson({
        novelId,
        generationMode: dto.generationMode || 'outline_and_script',
        draftSource,
        draftId: usedDraftId || null,
        draftPayloadChars: draftPayloadSize,
        draftPayloadKB: draftPayloadSize > 0 ? Math.round(draftPayloadSize / 1024) : -1,
      })}`,
    );

    await this.assertNovelExists(novelId);
    await this.assertBaseOutputTablesExist();
    const normalizationWarnings: string[] = [];
    const validationWarnings: string[] = [];
    const draft = this.validateAndNormalizeEpisodePackage(
      novelId,
      resolvedDraft,
      '60s',
      normalizationWarnings,
      validationWarnings,
      dto.generationMode,
    );
    const hookTableStatus = await this.detectHookRhythmTableIfExists();
    const warnings: string[] = [];
    if (!hookTableStatus.exists) {
      warnings.push('novel_hook_rhythm 表不存在，已跳过该表落库');
    }

    const episodeNumbers = draft.episodes
      .map((item) => item.episodeNumber)
      .sort((a, b) => a - b);
    const episodeRange = this.formatEpisodeRange(episodeNumbers);
    this.logger.log(
      `[episode-script][persist][start] ${this.toCompactJson({
        novelId,
        generationMode: dto.generationMode || 'outline_and_script',
        draftSource,
        actualEpisodeCount: draft.episodes.length,
        episodeRange,
        hookRhythmTableExists: hookTableStatus.exists,
        hookRhythmColumns: hookTableStatus.exists ? hookTableStatus.columns.size : 0,
        hookRhythmSkipReason: !hookTableStatus.exists ? 'table_not_found' : null,
      })}`,
    );

    const summary = await this.dataSource.transaction(async (manager) => {
      this.logger.log(
        `[episode-script][persist][delete][start] ${this.toCompactJson({
          novelId, episodeRange,
        })}`,
      );
      await this.deleteExistingEpisodeScriptData(
        novelId,
        episodeNumbers,
        hookTableStatus,
        manager,
      );
      this.logger.log(
        `[episode-script][persist][delete][done] ${this.toCompactJson({
          novelId, episodeRange,
        })}`,
      );
      this.logger.log(
        `[episode-script][persist][insert][start] ${this.toCompactJson({
          novelId, episodeRange, hookRhythmTableExists: hookTableStatus.exists,
        })}`,
      );
      return this.insertEpisodePackage(novelId, draft, hookTableStatus, manager, warnings);
    });

    if (usedDraftId) {
      this.deleteCachedDraft(usedDraftId);
      this.logger.log(
        `[episode-script][persist][draftId][deleted_after_success] ${this.toCompactJson({
          draftId: usedDraftId, novelId,
        })}`,
      );
    }

    const affectedTables = ['novel_episodes', 'drama_structure_template'];
    const skippedTables = hookTableStatus.exists ? [] : ['novel_hook_rhythm'];
    const persistElapsedMs = Date.now() - persistStartedAt;
    this.logger.log(
      `[episode-script][persist][done] ${this.toCompactJson({
        novelId,
        generationMode: dto.generationMode || 'outline_and_script',
        draftSource,
        draftId: usedDraftId || null,
        episodeRange,
        insertedEpisodes: summary.episodes,
        insertedStructureTemplates: summary.structureTemplates,
        insertedHookRhythm: summary.hookRhythm,
        affectedTables,
        skippedTables,
        warningCount: warnings.length,
        warnings: this.summarizeWarnings(warnings),
        persistElapsedMs,
      })}`,
    );

    return {
      ok: true,
      summary: {
        ...summary,
        generationMode: dto.generationMode || 'outline_and_script',
        episodeNumbers,
        affectedTables,
        skippedTables,
        overwriteScopeDescription: `将覆盖第 ${episodeRange} 集的已有数据，不影响其它集数`,
      },
      warnings: warnings.length ? warnings : undefined,
      normalizationWarnings: normalizationWarnings.length ? normalizationWarnings : undefined,
      validationWarnings: validationWarnings.length ? validationWarnings : undefined,
    };
  }

  // ========== Multi-stage: plan + batch + merge ==========

  private async generateDraftMultiStage(
    novelId: number,
    dto: PipelineEpisodeScriptGenerateDraftDto,
    referenceTables: PipelineEpisodeScriptReferenceTable[],
    usedModelKey: string,
    warnings: string[],
  ) {
    const targetEpisodeCount = dto.targetEpisodeCount!;
    const durationMode = dto.durationMode || '60s';
    const generationMode = dto.generationMode || 'outline_and_script';
    const charBudget = Math.max(
      8000,
      Math.min(dto.sourceTextCharBudget ?? DEFAULT_CHAR_BUDGET, 120000),
    );
    const multiStageStartedAt = Date.now();
    let planRepaired = false;
    let repairedBatchCount = 0;
    let finalMissingRepairApplied = false;
    const planLayerUsage: LayerUsageRecord = { layersUsed: [], tablesUsed: [], tablesSkipped: [] };
    const batchLayerUsage: LayerUsageRecord = { layersUsed: [], tablesUsed: [], tablesSkipped: [], dynamicHits: {} };

    // --- Build all reference blocks (shared pool) ---
    const { blocks: allRefBlocks, referenceSummary } =
      await this.buildReferenceBlocksOnly(novelId, referenceTables, charBudget, warnings);

    // ==================== Stage A: Plan ====================
    const planRefBlocks = this.filterRefBlocksByTables(allRefBlocks, referenceTables, PLAN_LAYERS);
    planLayerUsage.layersUsed = ['Layer1_CoreConstraint', 'Layer2_PlotSkeleton'];
    planLayerUsage.tablesUsed = PLAN_LAYERS.filter((t) => referenceTables.includes(t));
    planLayerUsage.tablesSkipped = referenceTables.filter(
      (t) => !PLAN_LAYERS.includes(t),
    );
    this.logger.log(
      `[episode-script][layers][plan] ${this.toCompactJson({
        novelId,
        layersUsed: planLayerUsage.layersUsed,
        tablesUsed: planLayerUsage.tablesUsed,
        tablesSkipped: planLayerUsage.tablesSkipped,
        blockCount: planRefBlocks.length,
      })}`,
    );

    const planPrompt = this.buildEpisodePlanPrompt(
      novelId, targetEpisodeCount, durationMode, generationMode, planRefBlocks, dto.userInstruction,
    );

    this.logger.log(
      `[episode-script][plan][start] ${this.toCompactJson({
        novelId, targetEpisodeCount, usedModelKey,
        promptChars: planPrompt.length,
        bodyBytes: Buffer.byteLength(planPrompt, 'utf8'),
        planRefBlockCount: planRefBlocks.length,
      })}`,
    );

    const planStartedAt = Date.now();
    let planAiJson: Record<string, unknown>;
    try {
      planAiJson = await this.callLcAiApi(usedModelKey, planPrompt, {
        novelId, generationMode, durationMode, targetEpisodeCount, referenceTables,
        stage: 'plan',
        systemPrompt: '你是短剧全集规划助手。你的任务是为整部短剧制定每集的轻量骨架规划。请只输出严格 JSON，不要输出 markdown 和解释。',
      });
    } catch (error: any) {
      this.logger.error(
        `[episode-script][plan][ai_error] ${this.toCompactJson({
          novelId, usedModelKey, elapsedMs: Date.now() - planStartedAt, error: this.getErrorMessage(error),
        })}`,
      );
      throw this.toStageBadRequest('[episode-script][plan][ai_error]', error);
    }

    let plan = this.validateAndNormalizePlan(novelId, planAiJson, targetEpisodeCount, durationMode, warnings);
    const planElapsedMs = Date.now() - planStartedAt;
    let planMissing = this.findMissingEpisodeNumbers(
      plan.episodes.map((e) => e.episodeNumber), targetEpisodeCount,
    );

    this.logger.log(
      `[episode-script][plan][done] ${this.toCompactJson({
        novelId, targetEpisodeCount,
        actualPlanEpisodeCount: plan.episodes.length,
        missingCount: planMissing.length,
        missingEpisodeNumbers: planMissing.length > 10 ? planMissing.slice(0, 5) : planMissing,
        promptChars: planPrompt.length, elapsedMs: planElapsedMs,
      })}`,
    );

    // ===== Plan Repair: auto-fill missing episodes =====
    if (planMissing.length > 0 && planMissing.length <= Math.ceil(targetEpisodeCount * 0.5)) {
      plan = await this.repairPlanMissingEpisodes(
        novelId, usedModelKey, plan, planMissing, planRefBlocks, durationMode, generationMode, warnings,
      );
      planMissing = this.findMissingEpisodeNumbers(
        plan.episodes.map((e) => e.episodeNumber), targetEpisodeCount,
      );
      planRepaired = true;
    }
    if (planMissing.length > 0) {
      warnings.push(
        `[plan] 规划阶段缺失 ${planMissing.length} 集: ${planMissing.slice(0, 10).join(', ')}${planMissing.length > 10 ? '...' : ''}`,
      );
    }

    // ==================== Stage B: Batches ====================
    const batches = this.splitPlanIntoBatches(plan, PLAN_BATCH_SIZE);
    this.logger.log(
      `[episode-script][batch][plan] ${this.toCompactJson({
        novelId, batchCount: batches.length, batchSize: PLAN_BATCH_SIZE,
        ranges: batches.map((b) => `${b.startEpisode}-${b.endEpisode}`),
      })}`,
    );

    const batchStaticBlocks = this.filterRefBlocksByTables(allRefBlocks, referenceTables, BATCH_STATIC_LAYERS);
    const planSummaryText = this.buildPlanSummaryForBatch(plan);

    batchLayerUsage.layersUsed = ['Layer1_CoreConstraint', 'Layer3_CharacterFaction', 'Layer4_DynamicRhythm', 'Layer5_Evidence'];
    batchLayerUsage.tablesUsed = BATCH_STATIC_LAYERS.filter((t) => referenceTables.includes(t));

    const useEvidence = referenceTables.includes('novel_source_segments');

    const batchResults: BatchResult[] = [];
    for (const batch of batches) {
      const dynamicCtx = await this.buildDynamicBatchContext(novelId, batch, referenceTables);
      if (dynamicCtx.contextBlock) {
        Object.entries(dynamicCtx.hits).forEach(([k, v]) => {
          batchLayerUsage.dynamicHits![k] = (batchLayerUsage.dynamicHits![k] || 0) + v;
        });
      }

      let evidenceBlock = '';
      if (useEvidence) {
        const evidence = await this.buildBatchEvidenceBlock(
          novelId, batch, BATCH_EVIDENCE_CHAR_BUDGET, BATCH_EVIDENCE_MAX_ITEMS,
        );
        evidenceBlock = evidence.block;
        this.logger.log(
          `[episode-script][batch][evidence] ${this.toCompactJson({
            novelId, batchIndex: batch.batchIndex,
            episodeRange: `${batch.startEpisode}-${batch.endEpisode}`,
            evidenceCount: evidence.evidenceCount,
            usedChars: evidence.usedChars,
            truncated: evidence.truncated,
            queryKeywords: evidence.queryKeywords.slice(0, 6),
          })}`,
        );
      }

      const combinedDynamicBlock = [dynamicCtx.contextBlock, evidenceBlock]
        .filter(Boolean)
        .join('\n\n');

      this.logger.log(
        `[episode-script][batch][dynamic_context] ${this.toCompactJson({
          novelId, batchIndex: batch.batchIndex,
          episodeRange: `${batch.startEpisode}-${batch.endEpisode}`,
          hits: dynamicCtx.hits,
          hasEvidence: !!evidenceBlock,
        })}`,
      );
      this.logger.log(
        `[episode-script][layers][batch] ${this.toCompactJson({
          novelId, batchIndex: batch.batchIndex,
          staticLayers: ['Layer1', 'Layer3'],
          dynamicLayer: 'Layer4_EpRangeFiltered',
          evidenceLayer: useEvidence ? 'Layer5_BudgetControlled' : 'Layer5_Skipped',
          staticBlockCount: batchStaticBlocks.length,
          hasDynamicContext: !!combinedDynamicBlock,
        })}`,
      );

      let result = await this.generateSingleBatch(
        novelId, usedModelKey, batch, plan, planSummaryText,
        batchStaticBlocks, durationMode, generationMode, combinedDynamicBlock, dto.userInstruction,
      );

      // ===== Batch Repair =====
      if (result.success) {
        const repairNeeds = this.assessBatchRepairNeeds(result, batch, generationMode);
        if (repairNeeds.needsRepair) {
          const repaired = await this.repairBatchEpisodes(
            novelId, usedModelKey, batch, result, repairNeeds,
            batchStaticBlocks, plan, durationMode, generationMode, warnings,
          );
          if (repaired) {
            result = { ...result, episodes: repaired, repaired: true };
            repairedBatchCount++;
          }
        }
      }
      batchResults.push(result);
    }

    // ==================== Stage C: Merge ====================
    let mergedEpisodes = this.mergeBatchResults(batchResults, warnings);
    const failedBatches = batchResults.filter((b) => !b.success);

    this.logger.log(
      `[episode-script][merge][summary] ${this.toCompactJson({
        novelId,
        totalBatches: batchResults.length,
        successBatches: batchResults.filter((b) => b.success).length,
        failedBatches: failedBatches.length,
        failedRanges: failedBatches.map((b) => b.range),
        mergedEpisodeCount: mergedEpisodes.length,
        targetEpisodeCount,
        retriedBatches: batchResults.filter((b) => b.retried).length,
        repairedBatches: batchResults.filter((b) => b.repaired).length,
      })}`,
    );

    // --- First validate pass ---
    const rawPackage = {
      episodePackage: { version: 'v1', novelId, durationMode, episodes: mergedEpisodes },
    };
    const normalizationWarnings: string[] = [];
    const validationWarnings: string[] = [];
    let draft: EpisodePackage;
    try {
      draft = this.validateAndNormalizeEpisodePackage(
        novelId, rawPackage, durationMode as EpisodeDurationMode,
        normalizationWarnings, validationWarnings,
        generationMode as EpisodeGenerationMode, targetEpisodeCount,
      );
    } catch (error: any) {
      this.logger.error(
        `[episode-script][merge][validation_error] ${this.toCompactJson({
          novelId, usedModelKey, mergedEpisodeCount: mergedEpisodes.length,
          message: this.getErrorMessage(error),
        })}`,
      );
      throw this.toStageBadRequest('[episode-script][merge][validation_error]', error);
    }

    // ==================== Stage D: Final Completeness ====================
    let missingEpisodeNumbers = this.findMissingEpisodeNumbers(
      draft.episodes.map((item) => item.episodeNumber), targetEpisodeCount,
    );

    if (missingEpisodeNumbers.length > 0 && missingEpisodeNumbers.length <= PLAN_BATCH_SIZE * 2) {
      const repairEps = await this.repairMissingEpisodesAfterMerge(
        novelId, usedModelKey, plan, missingEpisodeNumbers,
        batchStaticBlocks, durationMode, generationMode, warnings,
      );
      if (repairEps.length > 0) {
        mergedEpisodes = [...mergedEpisodes, ...repairEps];
        mergedEpisodes.sort((a, b) => (this.toPositiveInt(a.episodeNumber) ?? 0) - (this.toPositiveInt(b.episodeNumber) ?? 0));
        const repairPkg = {
          episodePackage: { version: 'v1', novelId, durationMode, episodes: mergedEpisodes },
        };
        try {
          draft = this.validateAndNormalizeEpisodePackage(
            novelId, repairPkg, durationMode as EpisodeDurationMode,
            normalizationWarnings, validationWarnings,
            generationMode as EpisodeGenerationMode, targetEpisodeCount,
          );
          missingEpisodeNumbers = this.findMissingEpisodeNumbers(
            draft.episodes.map((item) => item.episodeNumber), targetEpisodeCount,
          );
          finalMissingRepairApplied = true;
        } catch {
          warnings.push('[final] 缺集补生后 validate 失败，使用补生前结果');
        }
      }
    }

    const finalCompletenessOk = missingEpisodeNumbers.length === 0;
    const actualEpisodeCount = draft.episodes.length;
    const countMismatchWarning =
      targetEpisodeCount && actualEpisodeCount !== targetEpisodeCount
        ? `【生成集数不足】目标 ${targetEpisodeCount} 集，实际仅生成 ${actualEpisodeCount} 集`
        : undefined;

    if (!finalCompletenessOk) {
      warnings.push(
        `[final] ⚠️ 草稿不完整，不建议直接 persist。缺失 ${missingEpisodeNumbers.length} 集: ${missingEpisodeNumbers.slice(0, 10).join(', ')}${missingEpisodeNumbers.length > 10 ? '...' : ''}`,
      );
    }

    this.logger.log(
      `[episode-script][final][completeness] ${this.toCompactJson({
        novelId, targetEpisodeCount, actualEpisodeCount,
        missingEpisodeCount: missingEpisodeNumbers.length,
        finalCompletenessOk, finalMissingRepairApplied,
      })}`,
    );

    const totalElapsedMs = Date.now() - multiStageStartedAt;
    this.logger.log(
      `[episode-script][generateDraft][multiStage][result] ${this.toCompactJson({
        novelId, usedModelKey, mode: 'plan+batch',
        batchCount: batchResults.length, failedBatchCount: failedBatches.length,
        actualEpisodeCount, targetEpisodeCount,
        missingEpisodeCount: missingEpisodeNumbers.length,
        countMismatchWarning: countMismatchWarning || null,
        normalizationWarningCount: normalizationWarnings.length,
        validationWarningCount: validationWarnings.length,
        planRepaired, repairedBatchCount, finalMissingRepairApplied, finalCompletenessOk,
        totalElapsedMs, planElapsedMs,
        batchTotalElapsedMs: batchResults.reduce((s, b) => s + b.elapsedMs, 0),
      })}`,
    );

    const planSummary = {
      planEpisodeCount: plan.episodes.length,
      planMissingCount: planMissing.length,
      planElapsedMs,
      planRepaired,
    };
    const batchInfo = batchResults.map((b) => ({
      batchIndex: b.batchIndex, range: b.range, success: b.success,
      retried: b.retried, repaired: b.repaired,
      episodeCount: b.episodes.length, elapsedMs: b.elapsedMs,
      error: b.error || undefined,
    }));

    const draftId = this.generateDraftId();
    this.cacheDraft(draftId, {
      novelId,
      generationMode,
      draft: { episodePackage: draft },
      createdAt: Date.now(),
    });
    const draftSizeKB = Math.round(JSON.stringify(draft).length / 1024);
    this.logger.log(
      `[episode-script][generateDraft][cache][stored] ${this.toCompactJson({
        draftId, novelId, generationMode, draftSizeKB, cacheSize: this.draftCache.size,
      })}`,
    );

    return {
      draftId,
      usedModelKey, generationMode, promptPreview: planPrompt,
      referenceTables, referenceSummary,
      draft: { episodePackage: draft },
      targetEpisodeCount, actualEpisodeCount,
      missingEpisodeNumbers: missingEpisodeNumbers.length ? missingEpisodeNumbers : undefined,
      countMismatchWarning,
      warnings: warnings.length ? warnings : undefined,
      normalizationWarnings: normalizationWarnings.length ? normalizationWarnings : undefined,
      validationWarnings: validationWarnings.length ? validationWarnings : undefined,
      planSummary, batchCount: batchResults.length, batchInfo,
      failedBatches: failedBatches.length
        ? failedBatches.map((b) => ({ batchIndex: b.batchIndex, range: b.range, error: b.error }))
        : undefined,
      finalCompletenessOk,
      layerUsageSummary: { plan: planLayerUsage, batch: batchLayerUsage },
      repairSummary: { planRepaired, repairedBatches: repairedBatchCount, finalMissingRepairApplied },
    };
  }

  private async buildReferenceBlocksOnly(
    novelId: number,
    referenceTables: PipelineEpisodeScriptReferenceTable[],
    sourceTextCharBudget: number,
    warnings: string[],
  ): Promise<{
    blocks: Array<{ table: PipelineEpisodeScriptReferenceTable; block: string }>;
    referenceSummary: ReferenceSummaryItem[];
  }> {
    const referenceSummary: ReferenceSummaryItem[] = [];
    const blocks: Array<{ table: PipelineEpisodeScriptReferenceTable; block: string }> = [];
    let segmentEvidenceCount = 0;

    const prioritizedTables = [
      ...referenceTables.filter((t) => t === 'novel_source_segments'),
      ...referenceTables.filter((t) => t !== 'novel_source_segments'),
    ];

    for (const table of prioritizedTables) {
      if (table === 'drama_source_text' && segmentEvidenceCount > 0) {
        warnings.push('已命中 novel_source_segments 证据，跳过 drama_source_text 直注入');
        continue;
      }
      const built = await this.buildReferenceBlock(novelId, table, sourceTextCharBudget, warnings);
      if (built) {
        blocks.push({ table, block: built.block });
        referenceSummary.push(built.summary);
        if (table === 'novel_source_segments') {
          segmentEvidenceCount = built.summary.rowCount;
        }
      }
    }

    return { blocks, referenceSummary };
  }

  private filterRefBlocksByTables(
    allBlocks: Array<{ table: PipelineEpisodeScriptReferenceTable; block: string }>,
    selectedTables: PipelineEpisodeScriptReferenceTable[],
    coreTables: PipelineEpisodeScriptReferenceTable[],
  ): string[] {
    const allowed = new Set(
      coreTables.filter((t) => selectedTables.includes(t)),
    );
    return allBlocks
      .filter((b) => allowed.has(b.table))
      .map((b) => b.block);
  }

  private buildEpisodePlanPrompt(
    novelId: number,
    targetEpisodeCount: number,
    durationMode: string,
    generationMode: string,
    referenceBlocks: string[],
    userInstruction?: string,
  ): string {
    const planJsonContract = JSON.stringify(
      {
        episodePlan: {
          novelId,
          durationMode,
          targetEpisodeCount,
          episodes: [
            {
              episodeNumber: 1,
              episodeTitle: '第1集标题',
              arc: '本集剧情弧（1-2句）',
              coreConflict: '核心冲突（1句）',
              historyOutline: '历史线概要（1句）',
              rewriteDiff: '改写差异（1句）',
              cliffhanger: '尾钩（1句）',
            },
            {
              episodeNumber: 2,
              episodeTitle: '...',
              arc: '...',
              coreConflict: '...',
              historyOutline: '...',
              rewriteDiff: '...',
              cliffhanger: '...',
            },
          ],
        },
      },
      null,
      2,
    );

    return [
      '【任务定义】',
      '你是短剧全集规划助手。当前任务是为整部短剧生成"全集轻量骨架规划"。',
      '你只需输出每集的标题、剧情弧、核心冲突、历史线概要、改写差异、尾钩。',
      '不需要输出完整剧本正文（fullContent）、结构模板（structureTemplate）、钩子节奏（hookRhythm）。',
      '请严格按 JSON 返回，不要 markdown，不要解释。',
      '',
      '【规划规则】',
      `- 生成模式：${generationMode}`,
      `- 时长模板：${durationMode}`,
      `- 目标集数：第 1 集至第 ${targetEpisodeCount} 集`,
      `- ⚠️ episodes 数组长度必须正好等于 ${targetEpisodeCount}`,
      '- ⚠️ episodeNumber 必须从 1 连续递增到 ' + targetEpisodeCount + '，不得跳号、不得重复、不得缺失',
      '- 每集标题应简洁有力，体现本集核心事件',
      '- 剧情弧（arc）需体现压迫-反击-爆发节奏',
      '- 前后集的 cliffhanger 和下一集的 opening 应有逻辑衔接',
      '- 保持历史逻辑与改写逻辑并行',
      '',
      '【输出 JSON 契约】',
      planJsonContract,
      '',
      '【参考资料】',
      referenceBlocks.join('\n\n'),
      '',
      '【用户附加要求】',
      this.normalizeText(userInstruction) || '（无）',
    ].join('\n');
  }

  private validateAndNormalizePlan(
    novelId: number,
    raw: Record<string, unknown>,
    targetEpisodeCount: number,
    durationMode: string,
    warnings: string[],
  ): EpisodePlan {
    const payload = this.asRecord(raw) || {};
    const planRoot = this.asRecord(payload.episodePlan) || this.asRecord(payload) || {};
    const episodesRaw = Array.isArray(planRoot.episodes)
      ? planRoot.episodes
      : Array.isArray(payload.episodes)
        ? payload.episodes
        : [];

    if (!episodesRaw.length) {
      throw new BadRequestException(
        '[episode-script][plan] AI 返回的规划结果缺少 episodes 数组',
      );
    }

    const usedNumbers = new Set<number>();
    const episodes: EpisodePlanItem[] = episodesRaw.map(
      (item: unknown, index: number) => {
        const row = this.asRecord(item) || {};
        let episodeNumber = this.toPositiveInt(row.episodeNumber) ?? index + 1;
        if (usedNumbers.has(episodeNumber)) {
          episodeNumber = index + 1;
          while (usedNumbers.has(episodeNumber)) episodeNumber++;
        }
        usedNumbers.add(episodeNumber);
        return {
          episodeNumber,
          episodeTitle:
            this.normalizeText(row.episodeTitle) || `第${episodeNumber}集`,
          arc: this.normalizeText(row.arc),
          coreConflict: this.normalizeText(row.coreConflict),
          historyOutline: this.normalizeText(row.historyOutline),
          rewriteDiff: this.normalizeText(row.rewriteDiff),
          cliffhanger: this.normalizeText(row.cliffhanger),
        };
      },
    );

    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

    if (episodes.length < targetEpisodeCount) {
      warnings.push(
        `[plan] AI 规划了 ${episodes.length} 集，目标 ${targetEpisodeCount} 集`,
      );
    }

    return {
      novelId,
      durationMode: (this.normalizeDurationMode(durationMode) ||
        '60s') as EpisodeDurationMode,
      targetEpisodeCount,
      episodes,
    };
  }

  private splitPlanIntoBatches(
    plan: EpisodePlan,
    batchSize: number,
  ): BatchRange[] {
    const sorted = [...plan.episodes].sort(
      (a, b) => a.episodeNumber - b.episodeNumber,
    );
    const batches: BatchRange[] = [];
    for (let i = 0; i < sorted.length; i += batchSize) {
      const chunk = sorted.slice(i, i + batchSize);
      batches.push({
        batchIndex: batches.length,
        startEpisode: chunk[0].episodeNumber,
        endEpisode: chunk[chunk.length - 1].episodeNumber,
        planEpisodes: chunk,
      });
    }
    return batches;
  }

  private buildPlanSummaryForBatch(plan: EpisodePlan): string {
    const lines = plan.episodes.map(
      (ep) =>
        `第${ep.episodeNumber}集「${ep.episodeTitle}」: ${ep.arc || ep.coreConflict || '(无摘要)'}`,
    );
    return lines.join('\n');
  }

  private buildEpisodeBatchPrompt(
    novelId: number,
    batch: BatchRange,
    plan: EpisodePlan,
    planSummaryText: string,
    coreRefBlocks: string[],
    durationMode: string,
    generationMode: string,
    dynamicContextBlock?: string,
    userInstruction?: string,
  ): string {
    const batchPlanDetail = batch.planEpisodes
      .map(
        (ep) =>
          `- 第${ep.episodeNumber}集「${ep.episodeTitle}」\n  arc: ${ep.arc}\n  coreConflict: ${ep.coreConflict}\n  historyOutline: ${ep.historyOutline}\n  rewriteDiff: ${ep.rewriteDiff}\n  cliffhanger: ${ep.cliffhanger}`,
      )
      .join('\n');

    const prevEp = plan.episodes.find(
      (e) => e.episodeNumber === batch.startEpisode - 1,
    );
    const nextEp = plan.episodes.find(
      (e) => e.episodeNumber === batch.endEpisode + 1,
    );
    const contextLines: string[] = [];
    if (prevEp) {
      contextLines.push(
        `前一集（第${prevEp.episodeNumber}集）尾钩: ${prevEp.cliffhanger || '(无)'}`,
      );
    }
    if (nextEp) {
      contextLines.push(
        `后一集（第${nextEp.episodeNumber}集）开场: ${nextEp.arc || '(无)'}`,
      );
    }

    return [
      '【任务定义】',
      `你是短剧每集纲要/剧本结构化生成助手。当前任务是生成第 ${batch.startEpisode} 至第 ${batch.endEpisode} 集的完整详细内容。`,
      '请严格按照全集规划，只生成当前批次的剧集。不要输出其它批次的内容。',
      '请严格按 JSON 返回，不要 markdown，不要解释。',
      '',
      '【生成规则】',
      `- 生成模式：${generationMode}`,
      `- 时长模板：${durationMode}`,
      `- 当前批次：第 ${batch.startEpisode} 集至第 ${batch.endEpisode} 集（共 ${batch.planEpisodes.length} 集）`,
      `- ⚠️ episodes 数组长度必须正好等于 ${batch.planEpisodes.length}`,
      `- ⚠️ episodeNumber 范围必须是 ${batch.startEpisode} 到 ${batch.endEpisode}`,
      '- 每集必须包含 outline、script、structureTemplate、hookRhythm',
      generationMode === 'outline_only'
        ? '- outline_only 模式：script.fullContent 可简化，但结构字段仍需保留'
        : '- 必须输出完整 script.fullContent',
      '- 保持与前后集的衔接连续性',
      '',
      '【短剧节奏模板】',
      '60s：0-5秒冲突；5-10秒身份揭示；10-20秒压迫；20-30秒小反击；30-45秒再压制；45-60秒爽点+尾钩。',
      '90s：0-8秒冲突；8-18秒关系揭示；18-35秒压迫升级；35-55秒策略反击；55-75秒大逆转；75-90秒阶段胜利+尾钩。',
      '',
      '【全集规划摘要（仅供参照衔接）】',
      planSummaryText,
      '',
      '【当前批次规划详情】',
      batchPlanDetail,
      '',
      ...(contextLines.length
        ? ['【前后衔接信息】', ...contextLines, '']
        : []),
      '【输出 JSON 契约】',
      '以下是单集示例。当前批次应重复此结构，生成所有本批次集数。',
      this.getJsonContractTemplate(),
      '',
      '【核心参考资料】',
      coreRefBlocks.join('\n\n'),
      '',
      ...(dynamicContextBlock
        ? ['【当前批次动态关联资料（基于集数区间筛选）】', dynamicContextBlock, '']
        : []),
      '【用户附加要求】',
      this.normalizeText(userInstruction) || '（无）',
    ].join('\n');
  }

  private async generateSingleBatch(
    novelId: number,
    modelKey: string,
    batch: BatchRange,
    plan: EpisodePlan,
    planSummaryText: string,
    coreRefBlocks: string[],
    durationMode: string,
    generationMode: string,
    dynamicContextBlock?: string,
    userInstruction?: string,
  ): Promise<BatchResult> {
    const rangeStr = `${batch.startEpisode}-${batch.endEpisode}`;
    const batchPrompt = this.buildEpisodeBatchPrompt(
      novelId,
      batch,
      plan,
      planSummaryText,
      coreRefBlocks,
      durationMode,
      generationMode,
      dynamicContextBlock,
      userInstruction,
    );

    this.logger.log(
      `[episode-script][batch][start] ${this.toCompactJson({
        novelId,
        batchIndex: batch.batchIndex,
        episodeRange: rangeStr,
        batchSize: batch.planEpisodes.length,
        promptChars: batchPrompt.length,
      })}`,
    );

    const attemptBatch = async (
      attempt: number,
    ): Promise<{ success: boolean; episodes: RowRecord[]; error?: string }> => {
      const startedAt = Date.now();
      try {
        const aiJson = await this.callLcAiApi(modelKey, batchPrompt, {
          novelId,
          generationMode,
          durationMode,
          targetEpisodeCount: batch.planEpisodes.length,
          stage: `batch-${batch.batchIndex}`,
          systemPrompt:
            '你是短剧每集纲要/剧本结构化生成助手。请严格按照全集规划，生成当前批次的完整剧集详情。只输出严格 JSON，不要输出 markdown 和解释。',
        });

        const parsed = this.parseBatchAiResponse(aiJson, batch);
        const elapsedMs = Date.now() - startedAt;
        this.logger.log(
          `[episode-script][batch][done] ${this.toCompactJson({
            novelId,
            batchIndex: batch.batchIndex,
            episodeRange: rangeStr,
            attempt,
            episodeCount: parsed.length,
            elapsedMs,
          })}`,
        );
        return { success: true, episodes: parsed };
      } catch (error: any) {
        const elapsedMs = Date.now() - startedAt;
        this.logger.error(
          `[episode-script][batch][error] ${this.toCompactJson({
            novelId,
            batchIndex: batch.batchIndex,
            episodeRange: rangeStr,
            attempt,
            elapsedMs,
            error: this.getErrorMessage(error),
          })}`,
        );
        return { success: false, episodes: [], error: this.getErrorMessage(error) };
      }
    };

    const startedAt = Date.now();
    let firstResult = await attemptBatch(1);

    if (!firstResult.success && PLAN_BATCH_MAX_RETRIES > 0) {
      this.logger.log(
        `[episode-script][batch][retry] ${this.toCompactJson({
          novelId,
          batchIndex: batch.batchIndex,
          episodeRange: rangeStr,
          retryAttempt: 2,
        })}`,
      );
      firstResult = await attemptBatch(2);
      return {
        batchIndex: batch.batchIndex,
        range: rangeStr,
        episodes: firstResult.episodes,
        success: firstResult.success,
        error: firstResult.error,
        retried: true,
        repaired: false,
        elapsedMs: Date.now() - startedAt,
      };
    }

    return {
      batchIndex: batch.batchIndex,
      range: rangeStr,
      episodes: firstResult.episodes,
      success: firstResult.success,
      error: firstResult.error,
      retried: false,
      repaired: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private parseBatchAiResponse(
    aiJson: Record<string, unknown>,
    batch: BatchRange,
  ): RowRecord[] {
    const payload = this.asRecord(aiJson) || {};
    const pkg = this.asRecord(payload.episodePackage) || payload;
    const episodes = Array.isArray(pkg.episodes) ? pkg.episodes : [];
    if (!episodes.length) {
      throw new BadRequestException(
        `[episode-script][batch] 批次 ${batch.startEpisode}-${batch.endEpisode} AI 返回 episodes 为空`,
      );
    }
    return episodes.map((ep: unknown) => {
      const row = this.asRecord(ep) || {};
      return row as RowRecord;
    });
  }

  private mergeBatchResults(
    batchResults: BatchResult[],
    warnings: string[],
  ): RowRecord[] {
    const allEpisodes: RowRecord[] = [];
    const seenNumbers = new Set<number>();

    for (const batch of batchResults) {
      if (!batch.success) {
        warnings.push(
          `[batch] 批次 ${batch.range} 生成失败: ${batch.error || '未知错误'}`,
        );
        continue;
      }
      for (const ep of batch.episodes) {
        const epNum = this.toPositiveInt(ep.episodeNumber);
        if (epNum && seenNumbers.has(epNum)) {
          warnings.push(
            `[merge] episodeNumber ${epNum} 重复，跳过批次 ${batch.range} 中的重复项`,
          );
          continue;
        }
        if (epNum) seenNumbers.add(epNum);
        allEpisodes.push(ep);
      }
    }

    allEpisodes.sort((a, b) => {
      const na = this.toPositiveInt(a.episodeNumber) ?? 0;
      const nb = this.toPositiveInt(b.episodeNumber) ?? 0;
      return na - nb;
    });

    return allEpisodes;
  }

  // ===== Dynamic Batch Context (Layer 4 ep-range filtered) =====

  private async buildDynamicBatchContext(
    novelId: number,
    batch: BatchRange,
    selectedTables: PipelineEpisodeScriptReferenceTable[],
  ): Promise<{ contextBlock: string; hits: Record<string, number> }> {
    const hits: Record<string, number> = {};
    const sections: string[] = [];
    const startEp = batch.startEpisode;
    const endEp = batch.endEpisode;

    for (const q of EP_RANGE_DYNAMIC_QUERIES) {
      if (!selectedTables.includes(q.table)) continue;
      try {
        const rows: RowRecord[] = await this.dataSource.query(q.sql, [novelId, endEp, startEp]);
        hits[q.table] = rows.length;
        if (rows.length > 0) {
          const simplified = rows.slice(0, 20).map((row) => {
            const out: RowRecord = {};
            q.fields.forEach((f) => { out[f] = row[f]; });
            return out;
          });
          sections.push(`【${q.label}】\n${JSON.stringify(simplified, null, 2)}`);
        }
      } catch {
        hits[q.table] = -1;
      }
    }
    return { contextBlock: sections.join('\n\n'), hits };
  }

  // ===== Layer 5 Batch Evidence (novel_source_segments) =====

  private async buildBatchEvidenceBlock(
    novelId: number,
    batch: BatchRange,
    charBudget: number = BATCH_EVIDENCE_CHAR_BUDGET,
    maxItems: number = BATCH_EVIDENCE_MAX_ITEMS,
  ): Promise<{ block: string; evidenceCount: number; usedChars: number; truncated: boolean; queryKeywords: string[] }> {
    const queryKeywords = this.extractBatchPlanKeywords(batch);
    if (!queryKeywords.length) {
      return { block: '', evidenceCount: 0, usedChars: 0, truncated: false, queryKeywords: [] };
    }

    try {
      const hasTable = await this.dataSource.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'novel_source_segments'`,
      );
      if (Number(hasTable[0]?.cnt || 0) === 0) {
        return { block: '', evidenceCount: 0, usedChars: 0, truncated: false, queryKeywords };
      }

      const likeConditions = queryKeywords
        .slice(0, 6)
        .map(() => `(content_text LIKE CONCAT('%', ?, '%') OR keyword_text LIKE CONCAT('%', ?, '%') OR title_hint LIKE CONCAT('%', ?, '%'))`)
        .join(' OR ');
      const params: any[] = [novelId];
      queryKeywords.slice(0, 6).forEach((kw) => { params.push(kw, kw, kw); });

      const rows: RowRecord[] = await this.dataSource.query(
        `SELECT segment_index, chapter_label, title_hint, content_text, keyword_text
         FROM novel_source_segments
         WHERE novel_id = ? AND (${likeConditions})
         ORDER BY segment_index ASC
         LIMIT ?`,
        [...params, maxItems * 3],
      );

      if (!rows.length) {
        return { block: '', evidenceCount: 0, usedChars: 0, truncated: false, queryKeywords };
      }

      const used: string[] = [];
      let usedChars = 0;
      let truncated = false;
      const selected = rows.slice(0, maxItems);
      for (const row of selected) {
        const text = String(row.content_text || '').trim();
        if (!text) continue;
        const remain = charBudget - usedChars;
        if (remain <= 200) { truncated = true; break; }
        const clipped = text.length > remain ? text.slice(0, remain) + '...(截断)' : text;
        used.push(`[seg#${row.segment_index}][${row.chapter_label || ''}] ${row.title_hint || ''}\n${clipped}`);
        usedChars += clipped.length;
      }
      if (rows.length > maxItems) truncated = true;

      const block = used.length
        ? `【当前批次关联证据素材（novel_source_segments, 预算 ${charBudget} chars）】\n${used.join('\n\n')}`
        : '';
      return { block, evidenceCount: used.length, usedChars, truncated, queryKeywords };
    } catch {
      return { block: '', evidenceCount: 0, usedChars: 0, truncated: false, queryKeywords };
    }
  }

  private extractBatchPlanKeywords(batch: BatchRange): string[] {
    const keywords = new Set<string>();
    for (const ep of batch.planEpisodes) {
      const texts = [ep.arc, ep.coreConflict, ep.historyOutline, ep.cliffhanger, ep.episodeTitle];
      for (const t of texts) {
        if (!t) continue;
        const cleaned = t.replace(/[，。、！？；：""''（）\[\]【】\s]+/g, ' ').trim();
        const parts = cleaned.split(/\s+/).filter((p) => p.length >= 2 && p.length <= 10);
        parts.slice(0, 4).forEach((p) => keywords.add(p));
      }
    }
    return [...keywords].slice(0, 12);
  }

  // ===== Plan Repair =====

  private async repairPlanMissingEpisodes(
    novelId: number,
    modelKey: string,
    plan: EpisodePlan,
    missingNumbers: number[],
    planRefBlocks: string[],
    durationMode: string,
    generationMode: string,
    warnings: string[],
  ): Promise<EpisodePlan> {
    this.logger.log(
      `[episode-script][plan][repair][start] ${this.toCompactJson({
        novelId, missingCount: missingNumbers.length,
        missingNumbers: missingNumbers.length > 20 ? missingNumbers.slice(0, 10) : missingNumbers,
        existingCount: plan.episodes.length,
      })}`,
    );
    const existingSummary = plan.episodes
      .map((ep) => `第${ep.episodeNumber}集「${ep.episodeTitle}」: ${ep.arc || '(无)'}`)
      .join('\n');

    const missingStr = missingNumbers.join(', ');
    const repairPrompt = [
      '【任务定义】',
      '你是短剧全集规划修复助手。以下全集规划存在缺失集号，请只补齐缺失的集数。',
      '不要重复已有集数，只输出缺失部分。请严格按 JSON 返回。',
      '',
      '【缺失集号】',
      missingStr,
      '',
      '【已有规划摘要】',
      existingSummary,
      '',
      '【规则】',
      `- 只输出缺失集数的轻量骨架`,
      `- episodeNumber 必须在 [${missingNumbers[0]}, ${missingNumbers[missingNumbers.length - 1]}] 范围内`,
      '- 保持与已有集数的剧情衔接',
      '',
      '【输出 JSON 契约】',
      '{ "repairedEpisodes": [ { "episodeNumber": N, "episodeTitle": "...", "arc": "...", "coreConflict": "...", "historyOutline": "...", "rewriteDiff": "...", "cliffhanger": "..." } ] }',
      '',
      '【参考资料】',
      planRefBlocks.join('\n\n'),
    ].join('\n');

    const startedAt = Date.now();
    try {
      const aiJson = await this.callLcAiApi(modelKey, repairPrompt, {
        novelId, generationMode, durationMode,
        targetEpisodeCount: missingNumbers.length,
        stage: 'plan-repair',
        systemPrompt: '你是短剧全集规划修复助手。只补齐缺失集号。请只输出严格 JSON。',
      });

      const payload = this.asRecord(aiJson) || {};
      const repaired = Array.isArray(payload.repairedEpisodes)
        ? payload.repairedEpisodes
        : Array.isArray(payload.episodes)
          ? payload.episodes
          : [];

      const existingNums = new Set(plan.episodes.map((e) => e.episodeNumber));
      const newEpisodes: EpisodePlanItem[] = [];
      for (const item of repaired) {
        const row = this.asRecord(item) || {};
        const epNum = this.toPositiveInt(row.episodeNumber);
        if (!epNum || existingNums.has(epNum)) continue;
        existingNums.add(epNum);
        newEpisodes.push({
          episodeNumber: epNum,
          episodeTitle: this.normalizeText(row.episodeTitle) || `第${epNum}集`,
          arc: this.normalizeText(row.arc),
          coreConflict: this.normalizeText(row.coreConflict),
          historyOutline: this.normalizeText(row.historyOutline),
          rewriteDiff: this.normalizeText(row.rewriteDiff),
          cliffhanger: this.normalizeText(row.cliffhanger),
        });
      }

      const merged = [...plan.episodes, ...newEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber);

      this.logger.log(
        `[episode-script][plan][repair][done] ${this.toCompactJson({
          novelId, repairedCount: newEpisodes.length,
          totalAfterRepair: merged.length,
          elapsedMs: Date.now() - startedAt,
        })}`,
      );
      warnings.push(`[plan][repair] 补齐了 ${newEpisodes.length} 集`);

      return { ...plan, episodes: merged };
    } catch (error: any) {
      this.logger.error(
        `[episode-script][plan][repair][error] ${this.toCompactJson({
          novelId, elapsedMs: Date.now() - startedAt,
          error: this.getErrorMessage(error),
        })}`,
      );
      warnings.push(`[plan][repair] 补齐失败: ${this.getErrorMessage(error)}`);
      return plan;
    }
  }

  // ===== Batch Repair =====

  private assessBatchRepairNeeds(
    result: BatchResult,
    batch: BatchRange,
    generationMode: string,
  ): { needsRepair: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const expectedCount = batch.planEpisodes.length;
    const actualCount = result.episodes.length;

    if (actualCount !== expectedCount) {
      reasons.push(`集数不匹配: 期望 ${expectedCount}, 实际 ${actualCount}`);
    }

    const expectedNums = new Set(batch.planEpisodes.map((e) => e.episodeNumber));
    const actualNums = new Set(
      result.episodes.map((ep) => this.toPositiveInt(ep.episodeNumber)).filter(Boolean) as number[],
    );
    const missingNums = [...expectedNums].filter((n) => !actualNums.has(n));
    if (missingNums.length > 0) {
      reasons.push(`缺失集号: ${missingNums.join(', ')}`);
    }

    let criticalFieldMissing = 0;
    for (const ep of result.episodes) {
      const outline = this.asRecord(ep.outline) || {};
      const script = this.asRecord(ep.script) || {};
      const st = this.asRecord(ep.structureTemplate) || {};
      const hr = this.asRecord(ep.hookRhythm) || {};
      if (!this.normalizeText(outline.coreConflict)) criticalFieldMissing++;
      if (generationMode !== 'outline_only' && !this.normalizeText(script.fullContent)) criticalFieldMissing++;
      if (!this.normalizeText(st.structureName)) criticalFieldMissing++;
      if (!this.normalizeText(hr.cliffhanger)) criticalFieldMissing++;
    }
    if (criticalFieldMissing > expectedCount) {
      reasons.push(`关键字段严重缺失 (${criticalFieldMissing} 处)`);
    }

    return { needsRepair: reasons.length > 0, reasons };
  }

  private async repairBatchEpisodes(
    novelId: number,
    modelKey: string,
    batch: BatchRange,
    result: BatchResult,
    repairNeeds: { reasons: string[] },
    coreRefBlocks: string[],
    plan: EpisodePlan,
    durationMode: string,
    generationMode: string,
    warnings: string[],
  ): Promise<RowRecord[] | null> {
    const rangeStr = `${batch.startEpisode}-${batch.endEpisode}`;
    this.logger.log(
      `[episode-script][batch][repair][start] ${this.toCompactJson({
        novelId, batchIndex: batch.batchIndex, episodeRange: rangeStr,
        reasons: repairNeeds.reasons,
        existingEpisodeCount: result.episodes.length,
      })}`,
    );

    const batchPlanDetail = batch.planEpisodes
      .map((ep) => `第${ep.episodeNumber}集「${ep.episodeTitle}」: arc=${ep.arc}, conflict=${ep.coreConflict}`)
      .join('\n');

    const existingBrief = result.episodes
      .map((ep) => `第${ep.episodeNumber}集: ${this.normalizeText(ep.episodeTitle) || '(无标题)'}`)
      .join('\n');

    const repairPrompt = [
      '【任务定义】',
      `你是短剧剧本修复助手。当前批次（第 ${batch.startEpisode}-${batch.endEpisode} 集）生成结果不完整，请修复。`,
      '请输出修复后当前批次的完整 episodePackage。严格按 JSON 返回。',
      '',
      '【问题摘要】',
      repairNeeds.reasons.join('\n'),
      '',
      '【当前批次规划】',
      batchPlanDetail,
      '',
      '【已有结果摘要】',
      existingBrief,
      '',
      '【生成规则】',
      `- 生成模式：${generationMode}`,
      `- 时长模板：${durationMode}`,
      `- ⚠️ episodes 数组长度必须正好等于 ${batch.planEpisodes.length}`,
      `- ⚠️ episodeNumber 范围必须是 ${batch.startEpisode} 到 ${batch.endEpisode}`,
      '- 每集必须包含完整 outline、script、structureTemplate、hookRhythm',
      '',
      '【输出 JSON 契约】',
      this.getJsonContractTemplate(),
      '',
      '【核心参考资料】',
      coreRefBlocks.join('\n\n'),
    ].join('\n');

    const startedAt = Date.now();
    try {
      const aiJson = await this.callLcAiApi(modelKey, repairPrompt, {
        novelId, generationMode, durationMode,
        targetEpisodeCount: batch.planEpisodes.length,
        stage: `batch-repair-${batch.batchIndex}`,
        systemPrompt: '你是短剧剧本修复助手。请修复当前批次的不完整结果。只输出严格 JSON。',
      });
      const parsed = this.parseBatchAiResponse(aiJson, batch);

      this.logger.log(
        `[episode-script][batch][repair][done] ${this.toCompactJson({
          novelId, batchIndex: batch.batchIndex, episodeRange: rangeStr,
          repairedCount: parsed.length,
          elapsedMs: Date.now() - startedAt,
        })}`,
      );
      warnings.push(`[batch][repair] 批次 ${rangeStr} 修复成功 (${parsed.length} 集)`);
      return parsed;
    } catch (error: any) {
      this.logger.error(
        `[episode-script][batch][repair][error] ${this.toCompactJson({
          novelId, batchIndex: batch.batchIndex, episodeRange: rangeStr,
          elapsedMs: Date.now() - startedAt,
          error: this.getErrorMessage(error),
        })}`,
      );
      warnings.push(`[batch][repair] 批次 ${rangeStr} 修复失败: ${this.getErrorMessage(error)}`);
      return null;
    }
  }

  // ===== Final Missing Episodes Repair =====

  private async repairMissingEpisodesAfterMerge(
    novelId: number,
    modelKey: string,
    plan: EpisodePlan,
    missingNumbers: number[],
    coreRefBlocks: string[],
    durationMode: string,
    generationMode: string,
    warnings: string[],
  ): Promise<RowRecord[]> {
    this.logger.log(
      `[episode-script][merge][repair_missing][start] ${this.toCompactJson({
        novelId, missingCount: missingNumbers.length,
        missingNumbers: missingNumbers.length > 15 ? missingNumbers.slice(0, 10) : missingNumbers,
      })}`,
    );

    const missingPlanItems = missingNumbers
      .map((n) => plan.episodes.find((e) => e.episodeNumber === n))
      .filter(Boolean) as EpisodePlanItem[];

    const batchPlanDetail = missingPlanItems
      .map((ep) => `第${ep.episodeNumber}集「${ep.episodeTitle}」: arc=${ep.arc}, conflict=${ep.coreConflict}`)
      .join('\n');

    const repairPrompt = [
      '【任务定义】',
      `你是短剧剧本补生助手。合并后仍缺失以下集号，请生成这些集数的完整内容。`,
      '请严格按 JSON 返回。',
      '',
      `【缺失集号】${missingNumbers.join(', ')}`,
      '',
      '【缺失集规划】',
      batchPlanDetail || '（规划信息缺失）',
      '',
      '【生成规则】',
      `- 生成模式：${generationMode}`,
      `- 时长模板：${durationMode}`,
      `- ⚠️ 只生成缺失集号，不要生成其它集`,
      '- 每集必须包含完整 outline、script、structureTemplate、hookRhythm',
      '',
      '【输出 JSON 契约】',
      this.getJsonContractTemplate(),
      '',
      '【核心参考资料】',
      coreRefBlocks.join('\n\n'),
    ].join('\n');

    const startedAt = Date.now();
    try {
      const aiJson = await this.callLcAiApi(modelKey, repairPrompt, {
        novelId, generationMode, durationMode,
        targetEpisodeCount: missingNumbers.length,
        stage: 'merge-repair-missing',
        systemPrompt: '你是短剧剧本补生助手。请补齐缺失集号的完整内容。只输出严格 JSON。',
      });
      const payload = this.asRecord(aiJson) || {};
      const pkg = this.asRecord(payload.episodePackage) || payload;
      const episodes = Array.isArray(pkg.episodes) ? pkg.episodes : [];
      const result = episodes.map((ep: unknown) => (this.asRecord(ep) || {}) as RowRecord);

      this.logger.log(
        `[episode-script][merge][repair_missing][done] ${this.toCompactJson({
          novelId, requestedCount: missingNumbers.length,
          receivedCount: result.length,
          elapsedMs: Date.now() - startedAt,
        })}`,
      );
      warnings.push(`[final][repair] 补生了 ${result.length} 集`);
      return result;
    } catch (error: any) {
      this.logger.error(
        `[episode-script][merge][repair_missing][error] ${this.toCompactJson({
          novelId, elapsedMs: Date.now() - startedAt,
          error: this.getErrorMessage(error),
        })}`,
      );
      warnings.push(`[final][repair] 缺集补生失败: ${this.getErrorMessage(error)}`);
      return [];
    }
  }

  // ========== End Multi-stage ==========

  private resolveReferenceTables(
    referenceTables: PipelineEpisodeScriptReferenceTable[] | undefined,
  ): PipelineEpisodeScriptReferenceTable[] {
    const candidate = referenceTables?.length ? referenceTables : DEFAULT_REFERENCE_TABLES;
    const valid = candidate.filter((item) =>
      (allowedEpisodeScriptReferenceTables as readonly string[]).includes(item),
    );
    return valid.length ? valid : DEFAULT_REFERENCE_TABLES;
  }

  private async buildPrompt(
    novelId: number,
    referenceTables: PipelineEpisodeScriptReferenceTable[],
    userInstruction: string | undefined,
    sourceTextCharBudget: number | undefined,
    durationMode: EpisodeDurationMode | undefined,
    generationMode: EpisodeGenerationMode | undefined,
    targetEpisodeCount: number | undefined,
    warnings: string[],
  ): Promise<{ promptPreview: string; referenceSummary: ReferenceSummaryItem[] }> {
    const referenceSummary: ReferenceSummaryItem[] = [];
    const blocks: string[] = [];
    const charBudget = Math.max(8000, Math.min(sourceTextCharBudget ?? DEFAULT_CHAR_BUDGET, 120000));
    let segmentEvidenceCount = 0;

    const prioritizedTables = [
      ...referenceTables.filter((item) => item === 'novel_source_segments'),
      ...referenceTables.filter((item) => item !== 'novel_source_segments'),
    ];

    for (const table of prioritizedTables) {
      if (table === 'drama_source_text' && segmentEvidenceCount > 0) {
        warnings.push('已命中 novel_source_segments 证据，跳过 drama_source_text 直注入');
        continue;
      }
      const built = await this.buildReferenceBlock(novelId, table, charBudget, warnings);
      if (built) {
        blocks.push(built.block);
        referenceSummary.push(built.summary);
        if (table === 'novel_source_segments') {
          segmentEvidenceCount = built.summary.rowCount;
        }
      }
    }

    const promptPreview = [
      '【任务定义】',
      '你是短剧工业化编剧助手，需要输出“每集纲要/每集剧本生产包”。请严格按 JSON 返回，不要 markdown，不要解释。',
      '',
      '【生成规则】',
      `- 生成模式：${generationMode || 'outline_and_script'}`,
      `- 时长模板：${durationMode || '60s'}`,
      `- 目标集数：第 1 集至第 ${targetEpisodeCount || '?'} 集，必须完整生成所有集数，不得跳号或缺失`,
      '- 每集必须包含剧情弧、核心冲突、历史线概要、改写差异、尾钩。',
      '- 若是 outline_only，可简化 fullContent，但结构字段仍需保留。',
      '- 保持历史逻辑与改写逻辑并行，避免空泛描述。',
      `- ⚠️ 必须生成完整的 1..N 集，episodes 数组长度必须等于 ${targetEpisodeCount || 'N'}`,
      '- ⚠️ 若无法一次性完整生成，不要擅自减少集数，仍应尽力输出完整结构，保持集数连续',
      '',
      '【短剧节奏模板】',
      '60s：0-5秒冲突；5-10秒身份揭示；10-20秒压迫；20-30秒小反击；30-45秒再压制；45-60秒爽点+尾钩。',
      '90s：0-8秒冲突；8-18秒关系揭示；18-35秒压迫升级；35-55秒策略反击；55-75秒大逆转；75-90秒阶段胜利+尾钩。',
      '',
      '【输出 JSON 契约】',
      '以下是单集示例。实际输出时应重复此结构，完整生成 1..N 集。',
      this.getJsonContractTemplate(),
      '',
      '【参考资料】',
      blocks.join('\n\n'),
      '',
      '【用户附加要求】',
      this.normalizeText(userInstruction) || '（无）',
    ].join('\n');

    return { promptPreview, referenceSummary };
  }

  private async buildReferenceBlock(
    novelId: number,
    table: PipelineEpisodeScriptReferenceTable,
    sourceTextCharBudget: number,
    warnings: string[],
  ): Promise<{ block: string; summary: ReferenceSummaryItem } | null> {
    switch (table) {
      case 'drama_novels': {
        const rows = await this.dataSource.query(
          `SELECT id, novels_name, total_chapters, power_up_interval, author, description, status
           FROM drama_novels WHERE id = ? LIMIT 1`,
          [novelId],
        );
        return this.serializeRows(table, '项目主信息', rows, [
          'id',
          'novels_name',
          'total_chapters',
          'power_up_interval',
          'author',
          'description',
          'status',
        ]);
      }
      case 'drama_source_text': {
        const built = await this.getRawSourceTextBlock(novelId, Math.floor(sourceTextCharBudget * 0.35));
        return {
          block: `【原始素材补充（drama_source_text）】\n${built.block || '（无）'}`,
          summary: {
            table,
            label: '原始素材补充',
            rowCount: built.rowCount,
            fields: ['source_text'],
            note: '仅补充节选，不全量注入',
            usedChars: built.usedChars,
          },
        };
      }
      case 'novel_source_segments': {
        const evidence = await this.sourceRetrievalService.buildWorldviewEvidence(
          novelId,
          sourceTextCharBudget,
        );
        warnings.push(...evidence.warnings);
        return {
          block: `【原始素材切片证据（novel_source_segments）】\n${evidence.block || '（无）'}`,
          summary: {
            table,
            label: '原始素材切片证据',
            rowCount: evidence.segmentCount,
            fields: ['segment_index', 'chapter_label', 'title_hint', 'content_text', 'keyword_text'],
            usedChars: evidence.evidenceChars,
            note: evidence.usedFallback ? 'segments 不足，包含 raw fallback' : undefined,
          },
        };
      }
      case 'novel_adaptation_strategy': {
        const rows = await this.dataSource.query(
          `SELECT strategy_title, strategy_description, ai_prompt_template, version
           FROM novel_adaptation_strategy WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 5`,
          [novelId],
        );
        return this.serializeRows(table, '改编策略', rows, [
          'strategy_title',
          'strategy_description',
          'ai_prompt_template',
          'version',
        ]);
      }
      case 'adaptation_modes': {
        const rows = await this.dataSource.query(
          `SELECT mode_key, mode_name, description FROM adaptation_modes ORDER BY id ASC`,
          [],
        );
        return this.serializeRows(table, '改编模式', rows, ['mode_key', 'mode_name', 'description']);
      }
      case 'set_core':
        return this.serializeRows(
          table,
          '核心设定',
          await this.dataSource.query(
            `SELECT title, core_text, protagonist_name, protagonist_identity, target_story, rewrite_goal, constraint_text
             FROM set_core WHERE novel_id = ? AND is_active = 1 ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          [
            'title',
            'core_text',
            'protagonist_name',
            'protagonist_identity',
            'target_story',
            'rewrite_goal',
            'constraint_text',
          ],
        );
      case 'novel_timelines':
        return this.serializeRows(
          table,
          '时间线',
          await this.dataSource.query(
            `SELECT time_node, event, sort_order FROM novel_timelines WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['time_node', 'event', 'sort_order'],
        );
      case 'novel_characters':
        return this.serializeRows(
          table,
          '人物',
          await this.dataSource.query(
            `SELECT name, faction, description, personality FROM novel_characters WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['name', 'faction', 'description', 'personality'],
        );
      case 'novel_key_nodes':
        return this.serializeRows(
          table,
          '关键节点',
          await this.dataSource.query(
            `SELECT category, title, description, timeline_id, sort_order FROM novel_key_nodes WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['category', 'title', 'description', 'timeline_id', 'sort_order'],
        );
      case 'novel_explosions':
        return this.serializeRows(
          table,
          '爆点',
          await this.dataSource.query(
            `SELECT explosion_type, title, subtitle, scene_restoration, dramatic_quality, adaptability, sort_order
             FROM novel_explosions WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          [
            'explosion_type',
            'title',
            'subtitle',
            'scene_restoration',
            'dramatic_quality',
            'adaptability',
            'sort_order',
          ],
        );
      case 'novel_skeleton_topics':
        return this.serializeRows(
          table,
          '骨架主题',
          await this.dataSource.query(
            `SELECT topic_key, topic_name, topic_type, description, sort_order
             FROM novel_skeleton_topics WHERE novel_id = ? AND is_enabled = 1 ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['topic_key', 'topic_name', 'topic_type', 'description', 'sort_order'],
        );
      case 'novel_skeleton_topic_items':
        return this.serializeRows(
          table,
          '骨架主题详情',
          await this.dataSource.query(
            `SELECT topic_id, item_title, content, content_json, sort_order
             FROM novel_skeleton_topic_items WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['topic_id', 'item_title', 'content', 'content_json', 'sort_order'],
        );
      case 'set_payoff_arch':
        return this.serializeRows(
          table,
          '爽点架构',
          await this.dataSource.query(
            `SELECT name, notes FROM set_payoff_arch WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          ['name', 'notes'],
        );
      case 'set_payoff_lines':
        return this.serializeRows(
          table,
          '爽点线',
          await this.dataSource.query(
            `SELECT line_key, line_name, line_content, start_ep, end_ep, stage_text, sort_order
             FROM set_payoff_lines WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['line_key', 'line_name', 'line_content', 'start_ep', 'end_ep', 'stage_text', 'sort_order'],
        );
      case 'set_opponent_matrix':
        return this.serializeRows(
          table,
          '对手矩阵',
          await this.dataSource.query(
            `SELECT name, description FROM set_opponent_matrix WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          ['name', 'description'],
        );
      case 'set_opponents':
        return this.serializeRows(
          table,
          '对手明细',
          await this.dataSource.query(
            `SELECT level_name, opponent_name, threat_type, detailed_desc, sort_order
             FROM set_opponents WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['level_name', 'opponent_name', 'threat_type', 'detailed_desc', 'sort_order'],
        );
      case 'set_power_ladder':
        return this.serializeRows(
          table,
          '权力升级阶梯',
          await this.dataSource.query(
            `SELECT level_no, level_title, identity_desc, ability_boundary, start_ep, end_ep
             FROM set_power_ladder WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['level_no', 'level_title', 'identity_desc', 'ability_boundary', 'start_ep', 'end_ep'],
        );
      case 'set_traitor_system':
        return this.serializeRows(
          table,
          '内鬼系统',
          await this.dataSource.query(
            `SELECT name, description FROM set_traitor_system WHERE novel_id = ? ORDER BY version DESC, id DESC LIMIT 1`,
            [novelId],
          ),
          ['name', 'description'],
        );
      case 'set_traitors':
        return this.serializeRows(
          table,
          '内鬼角色',
          await this.dataSource.query(
            `SELECT name, public_identity, real_identity, mission, threat_desc, sort_order
             FROM set_traitors WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['name', 'public_identity', 'real_identity', 'mission', 'threat_desc', 'sort_order'],
        );
      case 'set_traitor_stages':
        return this.serializeRows(
          table,
          '内鬼阶段',
          await this.dataSource.query(
            `SELECT stage_title, stage_desc, start_ep, end_ep, sort_order
             FROM set_traitor_stages WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['stage_title', 'stage_desc', 'start_ep', 'end_ep', 'sort_order'],
        );
      case 'set_story_phases':
        return this.serializeRows(
          table,
          '故事阶段',
          await this.dataSource.query(
            `SELECT phase_name, start_ep, end_ep, historical_path, rewrite_path, sort_order
             FROM set_story_phases WHERE novel_id = ? ORDER BY sort_order ASC, id ASC`,
            [novelId],
          ),
          ['phase_name', 'start_ep', 'end_ep', 'historical_path', 'rewrite_path', 'sort_order'],
        );
      default:
        return null;
    }
  }

  private serializeRows(
    table: PipelineEpisodeScriptReferenceTable,
    label: string,
    rows: RowRecord[],
    fields: string[],
  ): { block: string; summary: ReferenceSummaryItem } {
    const simplified = (rows || []).slice(0, 80).map((row) => {
      const output: RowRecord = {};
      fields.forEach((field) => {
        const value = row[field];
        if (typeof value === 'string') {
          output[field] = this.trimBlock(value, 600);
        } else {
          output[field] = value;
        }
      });
      return output;
    });
    return {
      block: `【${label}（${table}）】\n${JSON.stringify(simplified, null, 2)}`,
      summary: {
        table,
        label,
        rowCount: rows.length,
        fields,
      },
    };
  }

  private formatEpisodeRange(episodeNumbers: number[]): string {
    if (!episodeNumbers.length) return '-';
    const sorted = [...episodeNumbers].sort((a, b) => a - b);
    if (sorted.length === 1) return `${sorted[0]}`;
    const isContiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
    return isContiguous ? `${sorted[0]}-${sorted[sorted.length - 1]}` : sorted.join(', ');
  }

  private validateAndNormalizeEpisodePackage(
    novelId: number,
    raw: unknown,
    fallbackDurationMode: EpisodeDurationMode,
    normalizationWarnings: string[],
    validationWarnings: string[],
    generationMode?: EpisodeGenerationMode,
    targetEpisodeCount?: number,
  ): EpisodePackage {
    const payload = this.parseToRecord(raw);
    const root = payload && this.asRecord(payload.episodePackage)
      ? (payload.episodePackage as RowRecord)
      : null;
    if (!root) {
      throw new BadRequestException('AI 返回结构缺少 episodePackage 根节点');
    }

    const episodesRaw = Array.isArray(root.episodes) ? root.episodes : [];
    if (!episodesRaw.length) {
      throw new BadRequestException('AI 返回的 episodePackage.episodes 为空');
    }

    const usedEpisodeNumbers = new Set<number>();
    const episodes: EpisodeDraft[] = episodesRaw.map((item: unknown, index: number) => {
      const row = this.asRecord(item) || {};
      const episodeNumber = this.toPositiveInt(row.episodeNumber) ?? index + 1;
      if (usedEpisodeNumbers.has(episodeNumber)) {
        throw new BadRequestException(`episodeNumber 重复: ${episodeNumber}`);
      }
      usedEpisodeNumbers.add(episodeNumber);
      if (!this.toPositiveInt(row.episodeNumber)) {
        normalizationWarnings.push(`episodes[${index}].episodeNumber 缺失，已自动补为 ${episodeNumber}`);
      }
      const outline = this.asRecord(row.outline) || {};
      const script = this.asRecord(row.script) || {};
      const structureTemplate = this.asRecord(row.structureTemplate) || {};
      const hookRhythm = this.asRecord(row.hookRhythm) || {};

      const normalized: EpisodeDraft = {
        episodeNumber,
        episodeTitle: this.normalizeText(row.episodeTitle) || `第${episodeNumber}集`,
        sortOrder: this.toPositiveInt(row.sortOrder) ?? episodeNumber,
        outline: {
          arc: this.normalizeText(outline.arc),
          opening: this.normalizeText(outline.opening),
          coreConflict: this.normalizeText(outline.coreConflict),
          historyOutline: this.normalizeText(outline.historyOutline),
          rewriteDiff: this.normalizeText(outline.rewriteDiff),
          outlineContent: this.normalizeText(outline.outlineContent),
        },
        script: {
          hooks: this.normalizeText(script.hooks),
          cliffhanger: this.normalizeText(script.cliffhanger),
          fullContent: this.normalizeText(script.fullContent),
        },
        structureTemplate: {
          chapterId: this.toPositiveInt(structureTemplate.chapterId) ?? episodeNumber,
          themeType: this.normalizeText(structureTemplate.themeType),
          structureName: this.normalizeText(structureTemplate.structureName),
          powerLevel: this.toPositiveInt(structureTemplate.powerLevel) ?? 1,
          isPowerUpChapter: this.toBooleanInt(structureTemplate.isPowerUpChapter),
          powerUpContent: this.normalizeText(structureTemplate.powerUpContent),
          identityGap: this.normalizeText(structureTemplate.identityGap),
          pressureSource: this.normalizeText(structureTemplate.pressureSource),
          firstReverse: this.normalizeText(structureTemplate.firstReverse),
          continuousUpgrade: this.normalizeText(structureTemplate.continuousUpgrade),
          suspenseHook: this.normalizeText(structureTemplate.suspenseHook),
          typicalOpening: this.normalizeText(structureTemplate.typicalOpening),
          suitableTheme: this.normalizeText(structureTemplate.suitableTheme),
          hotLevel: this.toPositiveInt(structureTemplate.hotLevel) ?? 3,
          remarks: this.normalizeText(structureTemplate.remarks),
        },
        hookRhythm: {
          episodeNumber,
          emotionLevel: this.toPositiveInt(hookRhythm.emotionLevel) ?? 3,
          hookType: this.normalizeText(hookRhythm.hookType),
          description: this.normalizeText(hookRhythm.description),
          cliffhanger: this.normalizeText(hookRhythm.cliffhanger),
        },
      };

      if (!normalized.structureTemplate.themeType) {
        validationWarnings.push(`episodes[${index}].structureTemplate.themeType 为空`);
      }
      if (!normalized.structureTemplate.structureName) {
        validationWarnings.push(`episodes[${index}].structureTemplate.structureName 为空`);
      }
      if (!normalized.outline.coreConflict) {
        validationWarnings.push(`episodes[${index}].outline.coreConflict 为空`);
      }
      // outline_only 模式下允许 script 字段为空，其余模式标记警告
      if (generationMode !== 'outline_only') {
        if (!normalized.script.fullContent) {
          validationWarnings.push(`[剧本内容不完整] episodes[${index}].script.fullContent 为空`);
        }
        if (!normalized.script.cliffhanger) {
          validationWarnings.push(`[剧本内容不完整] episodes[${index}].script.cliffhanger 为空`);
        }
      }

      return normalized;
    });

    let missingEpisodeNumbers: number[] = [];
    let countMismatchWarning: string | null = null;
    // 集数完整性校验
    if (targetEpisodeCount && targetEpisodeCount > 0) {
      const actualCount = episodes.length;
      if (actualCount !== targetEpisodeCount) {
        countMismatchWarning = `【生成集数不足】目标 ${targetEpisodeCount} 集，实际仅生成 ${actualCount} 集`;
        validationWarnings.push(countMismatchWarning);
      }
      // 检查是否有缺失集数
      const episodeSet = new Set(episodes.map((e) => e.episodeNumber));
      for (let i = 1; i <= targetEpisodeCount; i++) {
        if (!episodeSet.has(i)) {
          missingEpisodeNumbers.push(i);
        }
      }
      if (missingEpisodeNumbers.length > 0) {
        const missingStr = missingEpisodeNumbers.length > 10
          ? `${missingEpisodeNumbers.slice(0, 5).join(', ')}...共 ${missingEpisodeNumbers.length} 集`
          : missingEpisodeNumbers.join(', ');
        validationWarnings.push(`【集数缺失】缺少第 ${missingStr} 集`);
      }
    }
    this.logger.log(
      `[episode-script][validate][summary] ${this.toCompactJson({
        novelId,
        generationMode: generationMode || 'outline_and_script',
        actualEpisodeCount: episodes.length,
        targetEpisodeCount: targetEpisodeCount ?? null,
        missingEpisodeCount: missingEpisodeNumbers.length,
        countMismatchWarning,
        normalizationWarningCount: normalizationWarnings.length,
        validationWarningCount: validationWarnings.length,
        validationWarnings: this.summarizeWarnings(validationWarnings),
      })}`,
    );

    return {
      version: this.normalizeText(root.version) || 'v1',
      novelId,
      durationMode: this.normalizeDurationMode(root.durationMode) || fallbackDurationMode,
      episodes,
    };
  }

  private async deleteExistingEpisodeScriptData(
    novelId: number,
    episodeNumbers: number[],
    hookTableStatus: { exists: boolean; columns: Set<string> },
    manager: DataSource['manager'],
  ): Promise<void> {
    if (!episodeNumbers.length) return;
    const normalizedEpisodeNumbers = Array.from(
      new Set(episodeNumbers.filter((item) => Number.isInteger(item) && item > 0)),
    );
    if (!normalizedEpisodeNumbers.length) return;
    const placeholders = normalizedEpisodeNumbers.map(() => '?').join(', ');
    await manager.query(
      `DELETE FROM novel_episodes WHERE novel_id = ? AND episode_number IN (${placeholders})`,
      [novelId, ...normalizedEpisodeNumbers],
    );
    await manager.query(
      `DELETE FROM drama_structure_template WHERE novels_id = ? AND chapter_id IN (${placeholders})`,
      [novelId, ...normalizedEpisodeNumbers],
    );

    const hasHookRequiredColumns =
      hookTableStatus.exists &&
      hookTableStatus.columns.has('novel_id') &&
      hookTableStatus.columns.has('episode_number');
    if (hasHookRequiredColumns) {
      await manager.query(
        `DELETE FROM novel_hook_rhythm WHERE novel_id = ? AND episode_number IN (${placeholders})`,
        [novelId, ...normalizedEpisodeNumbers],
      );
    }
  }

  private async insertEpisodePackage(
    novelId: number,
    pkg: EpisodePackage,
    hookTableStatus: { exists: boolean; columns: Set<string> },
    manager: DataSource['manager'],
    warnings: string[],
  ): Promise<{
    episodes: number;
    structureTemplates: number;
    hookRhythm: number;
  }> {
    let structureTemplates = 0;
    let episodes = 0;
    let hookRhythm = 0;
    const templateIdByEpisode = new Map<number, number>();

    for (const item of pkg.episodes) {
      const result: any = await manager.query(
        `INSERT INTO drama_structure_template (
          novels_id, chapter_id, power_level, is_power_up_chapter, power_up_content,
          theme_type, structure_name, identity_gap, pressure_source, first_reverse,
          continuous_upgrade, suspense_hook, typical_opening, suitable_theme, hot_level, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          novelId,
          item.structureTemplate.chapterId,
          item.structureTemplate.powerLevel,
          item.structureTemplate.isPowerUpChapter,
          item.structureTemplate.powerUpContent || null,
          item.structureTemplate.themeType || '未分类',
          item.structureTemplate.structureName || `结构模板-${item.episodeNumber}`,
          item.structureTemplate.identityGap || null,
          item.structureTemplate.pressureSource || null,
          item.structureTemplate.firstReverse || null,
          item.structureTemplate.continuousUpgrade || null,
          item.structureTemplate.suspenseHook || null,
          item.structureTemplate.typicalOpening || null,
          item.structureTemplate.suitableTheme || null,
          item.structureTemplate.hotLevel,
          item.structureTemplate.remarks || null,
        ],
      );
      const templateId = Number(result.insertId);
      templateIdByEpisode.set(item.episodeNumber, templateId);
      structureTemplates += 1;
    }

    for (const item of pkg.episodes) {
      await manager.query(
        `INSERT INTO novel_episodes (
          novel_id, episode_number, episode_title, arc, opening, core_conflict, hooks, cliffhanger,
          full_content, outline_content, history_outline, rewrite_diff, structure_template_id, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          novelId,
          item.episodeNumber,
          item.episodeTitle || `第${item.episodeNumber}集`,
          item.outline.arc || null,
          item.outline.opening || null,
          item.outline.coreConflict || null,
          item.script.hooks || null,
          item.script.cliffhanger || null,
          item.script.fullContent || null,
          item.outline.outlineContent || null,
          item.outline.historyOutline || null,
          item.outline.rewriteDiff || null,
          templateIdByEpisode.get(item.episodeNumber) ?? null,
          item.sortOrder,
        ],
      );
      episodes += 1;
    }

    if (!hookTableStatus.exists) {
      return { episodes, structureTemplates, hookRhythm };
    }

    const required = ['novel_id', 'episode_number'];
    const hasRequired = required.every((key) => hookTableStatus.columns.has(key));
    if (!hasRequired) {
      warnings.push('novel_hook_rhythm 字段不兼容，已跳过落库');
      return { episodes, structureTemplates, hookRhythm };
    }

    const optionalMappings: Array<[string, (item: EpisodeDraft) => any]> = [
      ['emotion_level', (item) => item.hookRhythm.emotionLevel],
      ['hook_type', (item) => item.hookRhythm.hookType || null],
      ['description', (item) => item.hookRhythm.description || null],
      ['cliffhanger', (item) => item.hookRhythm.cliffhanger || null],
      ['sort_order', (item) => item.sortOrder],
    ];

    for (const item of pkg.episodes) {
      const columns = ['novel_id', 'episode_number'];
      const values: any[] = [novelId, item.episodeNumber];
      optionalMappings.forEach(([column, getter]) => {
        if (hookTableStatus.columns.has(column)) {
          columns.push(column);
          values.push(getter(item));
        }
      });
      const placeholders = columns.map(() => '?').join(', ');
      await manager.query(
        `INSERT INTO novel_hook_rhythm (${columns.join(', ')}) VALUES (${placeholders})`,
        values,
      );
      hookRhythm += 1;
    }

    return { episodes, structureTemplates, hookRhythm };
  }

  private async detectHookRhythmTableIfExists(): Promise<{ exists: boolean; columns: Set<string> }> {
    const tableRows = await this.dataSource.query(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'novel_hook_rhythm'`,
      [],
    );
    const exists = Number(tableRows[0]?.cnt || 0) > 0;
    if (!exists) {
      return { exists: false, columns: new Set() };
    }
    const columnRows = await this.dataSource.query(
      `SELECT column_name AS columnName
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'novel_hook_rhythm'`,
      [],
    );
    return {
      exists: true,
      columns: new Set(columnRows.map((item: RowRecord) => this.normalizeText(item.columnName).toLowerCase())),
    };
  }

  private async assertNovelExists(novelId: number): Promise<void> {
    const rows = await this.dataSource.query(`SELECT id FROM drama_novels WHERE id = ? LIMIT 1`, [novelId]);
    if (!rows.length) {
      throw new NotFoundException(`Novel ${novelId} not found`);
    }
  }

  private async assertBaseOutputTablesExist(): Promise<void> {
    const tables = ['novel_episodes', 'drama_structure_template'];
    for (const table of tables) {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_name = ?`,
        [table],
      );
      if (Number(rows[0]?.cnt || 0) <= 0) {
        throw new BadRequestException(`Required output table missing: ${table}`);
      }
    }
  }

  private async resolveOptionalModelKey(modelKey?: string): Promise<string> {
    try {
      const rows: Array<{ modelKey: string; provider: string; family: string; modality: string }> =
        await this.dataSource.query(
          `SELECT model_key AS modelKey, provider, family, modality
           FROM lc_api_models
           WHERE is_deleted = 0`,
          [],
        );
      if (!rows.length) {
        throw new BadRequestException('No AI model available');
      }
      const safe = rows.filter((item) => this.isSafeTextModel(item));
      if (!safe.length) {
        throw new BadRequestException('No safe text model available');
      }
      if (modelKey) {
        const matched = safe.find((item) => item.modelKey === modelKey);
        if (!matched) {
          throw new BadRequestException(`Model ${modelKey} is unavailable for episode-script`);
        }
        return matched.modelKey;
      }
      for (const candidate of EPISODE_DEFAULT_MODEL_CANDIDATES) {
        const hit = safe.find((item) => item.modelKey === candidate);
        if (hit) return hit.modelKey;
      }
      return safe[0].modelKey;
    } catch (error: any) {
      const message = this.normalizeText(error?.message).toLowerCase();
      const isMissingModelTable =
        message.includes('lc_api_models') && message.includes("doesn't exist");
      if (!isMissingModelTable) {
        throw error;
      }
      const fallbackFromRequest = this.normalizeText(modelKey);
      if (fallbackFromRequest) {
        return fallbackFromRequest;
      }
      return EPISODE_DEFAULT_MODEL_CANDIDATES[0];
    }
  }

  private isSafeTextModel(row: {
    modelKey: string;
    provider?: string;
    family?: string;
    modality?: string;
  }): boolean {
    const key = this.normalizeText(row.modelKey).toLowerCase();
    const provider = this.normalizeText(row.provider).toLowerCase();
    const family = this.normalizeText(row.family).toLowerCase();
    const modality = this.normalizeText(row.modality).toLowerCase();
    if (key.includes('imagine') || key.includes('midjourney')) return false;
    if (provider.includes('midjourney')) return false;
    if (modality && modality !== 'text') return false;
    return (
      key.includes('claude') ||
      key.includes('gpt') ||
      key.includes('deepseek') ||
      family.includes('claude') ||
      family.includes('gpt') ||
      family.includes('deepseek')
    );
  }

  private async getRawSourceTextBlock(
    novelId: number,
    charBudget: number,
  ): Promise<{ block: string; rowCount: number; usedChars: number }> {
    const rows = await this.dataSource.query(
      `SELECT id, source_text AS sourceText
       FROM drama_source_text
       WHERE novels_id = ?
       ORDER BY id ASC`,
      [novelId],
    );
    if (!rows.length) {
      return { block: '', rowCount: 0, usedChars: 0 };
    }
    const used: string[] = [];
    let usedChars = 0;
    const limit = Math.max(1500, charBudget);
    for (const row of rows) {
      const text = this.normalizeText(row.sourceText);
      if (!text) continue;
      const remain = limit - usedChars;
      if (remain <= 0) break;
      const clipped = text.slice(0, remain);
      used.push(`[source_text#${row.id}] ${clipped}`);
      usedChars += clipped.length;
    }
    return { block: used.join('\n\n'), rowCount: rows.length, usedChars };
  }

  private async callLcAiApi(
    modelKey: string,
    promptPreview: string,
    context?: {
      novelId?: number;
      generationMode?: string;
      durationMode?: string;
      targetEpisodeCount?: number | null;
      referenceTables?: PipelineEpisodeScriptReferenceTable[];
      stage?: string;
      systemPrompt?: string;
    },
  ): Promise<Record<string, unknown>> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const systemMsg =
      context?.systemPrompt ||
      '你是短剧每集纲要/剧本结构化生成助手。你必须只输出严格 JSON，不要输出 markdown 和解释。';
    const requestBody = JSON.stringify({
      model: modelKey,
      temperature: 0.45,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: promptPreview },
      ],
    });
    const bodyBytes = Buffer.byteLength(requestBody, 'utf8');
    const endpointSafe = this.sanitizeEndpoint(endpoint);
    const startedAt = Date.now();

    this.logger.log(
      `[episode-script][callLcAiApi][request] ${this.toCompactJson({
        novelId: context?.novelId ?? null,
        endpoint: endpointSafe,
        model: modelKey,
        bodyBytes,
        messageChars: promptPreview.length,
        timeoutMs: null,
        generationMode: context?.generationMode ?? null,
        durationMode: context?.durationMode ?? null,
        targetEpisodeCount: context?.targetEpisodeCount ?? null,
        referenceTables: context?.referenceTables ?? [],
      })}`,
    );
    let response: any;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
      });
    } catch (error: any) {
      const elapsedMs = Date.now() - startedAt;
      this.logger.error(
        `[episode-script][callLcAiApi][network_error] ${this.toCompactJson({
          novelId: context?.novelId ?? null,
          endpoint: endpointSafe,
          model: modelKey,
          bodyBytes,
          elapsedMs,
          errorName: this.getErrorName(error),
          errorMessage: this.getErrorMessage(error),
          cause: this.getErrorCauseMessage(error),
        })}`,
      );
      throw new BadRequestException(
        `[episode-script][callLcAiApi][network_error] Episode script AI request failed. endpoint=${endpointSafe}, model=${modelKey}, elapsedMs=${elapsedMs}, bodyBytes=${bodyBytes}, error=${this.getErrorMessage(
          error,
        )}`,
      );
    }
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    const elapsedMs = Date.now() - startedAt;
    this.logger.log(
      `[episode-script][callLcAiApi][response] ${this.toCompactJson({
        novelId: context?.novelId ?? null,
        endpoint: endpointSafe,
        model: modelKey,
        status: response.status,
        ok: response.ok,
        elapsedMs,
        contentType,
        responseTextLength: rawText.length,
      })}`,
    );
    if (this.isHtmlResponse(contentType, rawText)) {
      this.logger.error(
        `[episode-script][callLcAiApi][non_json_upstream_payload] ${this.toCompactJson({
          novelId: context?.novelId ?? null,
          endpoint: endpointSafe,
          model: modelKey,
          status: response.status,
          contentType,
          bodySample: this.summarizeBody(rawText),
        })}`,
      );
      throw new BadRequestException(
        `[episode-script][callLcAiApi][non_json_upstream_payload] Episode script request reached HTML page. endpoint=${endpointSafe}, status=${response.status}, body=${this.summarizeBody(
          rawText,
        )}`,
      );
    }
    if (!response.ok) {
      this.logger.error(
        `[episode-script][callLcAiApi][http_status_error] ${this.toCompactJson({
          novelId: context?.novelId ?? null,
          endpoint: endpointSafe,
          model: modelKey,
          status: response.status,
          contentType,
          bodySample: this.summarizeBody(rawText),
        })}`,
      );
      throw new BadRequestException(
        `[episode-script][callLcAiApi][http_status_error] Episode script request failed. endpoint=${endpointSafe}, status=${response.status}, body=${this.summarizeBody(
          rawText,
        )}`,
      );
    }
    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch (error: any) {
      this.logger.error(
        `[episode-script][callLcAiApi][outer_response_json_parse_error] ${this.toCompactJson({
          novelId: context?.novelId ?? null,
          endpoint: endpointSafe,
          model: modelKey,
          status: response.status,
          contentType,
          responseTextLength: rawText.length,
          bodySample: this.summarizeBody(rawText),
          errorName: this.getErrorName(error),
          errorMessage: this.getErrorMessage(error),
        })}`,
      );
      throw new BadRequestException(
        '[episode-script][callLcAiApi][outer_response_json_parse_error] Episode script AI response is not valid JSON',
      );
    }
    const text = this.extractAiText(payload);
    if (!text) {
      this.logger.error(
        `[episode-script][callLcAiApi][ai_text_extraction_error] ${this.toCompactJson({
          novelId: context?.novelId ?? null,
          endpoint: endpointSafe,
          model: modelKey,
          payloadKeys: this.extractTopLevelKeys(payload),
        })}`,
      );
      throw new BadRequestException(
        '[episode-script][callLcAiApi][ai_text_extraction_error] Episode script AI response does not contain text content',
      );
    }
    try {
      return this.parseJsonObjectFromText(text);
    } catch (error: any) {
      this.logger.error(
        `[episode-script][callLcAiApi][episode_package_json_parse_error] ${this.toCompactJson({
          novelId: context?.novelId ?? null,
          endpoint: endpointSafe,
          model: modelKey,
          aiTextLength: text.length,
          errorName: this.getErrorName(error),
          errorMessage: this.getErrorMessage(error),
        })}`,
      );
      throw this.toStageBadRequest(
        '[episode-script][callLcAiApi][episode_package_json_parse_error]',
        error,
      );
    }
  }

  private getJsonContractTemplate(): string {
    return JSON.stringify(
      {
        episodePackage: {
          version: 'v1',
          novelId: 1,
          durationMode: '60s',
          episodes: [
            {
              episodeNumber: 1,
              episodeTitle: '第1集标题',
              sortOrder: 1,
              outline: {
                arc: '本集剧情弧',
                opening: '开场',
                coreConflict: '核心冲突',
                historyOutline: '历史线概要',
                rewriteDiff: '改写差异',
                outlineContent: '本集纲要',
              },
              script: {
                hooks: '本集前置钩子',
                cliffhanger: '本集尾钩',
                fullContent: '完整剧本',
              },
              structureTemplate: {
                chapterId: 1,
                themeType: '权谋',
                structureName: '压迫-反击-爆发',
                powerLevel: 1,
                isPowerUpChapter: 0,
                powerUpContent: '',
                identityGap: '主角身份弱势点',
                pressureSource: '本集压迫源',
                firstReverse: '第一次反转内容',
                continuousUpgrade: '连续升级路径',
                suspenseHook: '悬念钩子',
                typicalOpening: '典型开场',
                suitableTheme: '权谋/历史改写',
                hotLevel: 4,
                remarks:
                  '前10秒冲突：xx；第一次权力反转：xx秒；每60秒悬念：是；爽点频率：2次/分钟；情绪曲线：压迫→反击→爆发',
              },
              hookRhythm: {
                episodeNumber: 1,
                emotionLevel: 4,
                hookType: '反转',
                description: '本集最强钩子一句话',
                cliffhanger: '尾钩内容',
              },
            },
          ],
        },
      },
      null,
      2,
    );
  }

  private extractAiText(payload: any): string {
    if (typeof payload === 'string') return payload;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === 'string') return item;
          if (typeof item?.text === 'string') return item.text;
          if (typeof item?.content === 'string') return item.content;
          return '';
        })
        .join('\n');
    }
    if (typeof payload?.output_text === 'string') return payload.output_text;
    if (typeof payload?.response === 'string') return payload.response;
    return '';
  }

  private parseJsonObjectFromText(text: string): Record<string, unknown> {
    const trimmed = this.stripMarkdownCodeFence(text.trim());
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const candidate = trimmed.slice(start, end + 1);
        try {
          return this.parsePossiblyDirtyJson(candidate, 'raw-object-slice');
        } catch (error: any) {
          this.logParseFailure('raw-object-slice', candidate, error);
        }
      }
    }
    try {
      return this.parsePossiblyDirtyJson(trimmed, 'raw-full-text');
    } catch (error: any) {
      this.logParseFailure('raw-full-text', trimmed, error);
      throw error;
    }
  }

  private parsePossiblyDirtyJson(
    text: string,
    stage: string,
  ): Record<string, unknown> {
    const candidates = [text, this.normalizeJsonLikeText(text)];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        return JSON.parse(candidate);
      } catch {
        // try next
      }
    }
    throw new BadRequestException(
      `[episode-script][parse][episode_package_json_parse_error] Episode script JSON parse failed at stage=${stage}`,
    );
  }

  private parseToRecord(raw: unknown): RowRecord | null {
    if (!raw) return null;
    if (typeof raw === 'string') {
      return this.parseJsonObjectFromText(raw);
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as RowRecord;
    }
    return null;
  }

  private asRecord(value: unknown): RowRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as RowRecord;
  }

  private normalizeText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    return '';
  }

  private toPositiveInt(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const intVal = Math.trunc(parsed);
    return intVal > 0 ? intVal : null;
  }

  private toBooleanInt(value: unknown): number {
    if (value === true || value === 1 || value === '1' || value === 'true') return 1;
    return 0;
  }

  private normalizeDurationMode(value: unknown): EpisodeDurationMode | null {
    const text = this.normalizeText(value);
    return text === '90s' ? '90s' : text === '60s' ? '60s' : null;
  }

  private trimBlock(value: unknown, maxLength: number): string {
    const text = this.normalizeText(value);
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...(截断)`;
  }

  private getLcApiEndpoint(): string {
    const raw = process.env.lc_api_url?.trim();
    if (!raw) {
      throw new InternalServerErrorException('lc_api_url is not configured');
    }
    const normalized = raw.replace(/\/+$/, '');
    if (
      normalized.endsWith('/v1/chat/completions') ||
      normalized.endsWith('/chat/completions')
    ) {
      return normalized;
    }
    return `${normalized}/v1/chat/completions`;
  }

  private getLcApiKey(): string {
    const key = process.env.lc_api_key?.trim();
    if (!key) {
      throw new InternalServerErrorException('lc_api_key is not configured');
    }
    return key;
  }

  private isHtmlResponse(contentType: string, body: string): boolean {
    return contentType.includes('text/html') || /^\s*<!doctype html/i.test(body);
  }

  private summarizeBody(body: string): string {
    return body.replace(/\s+/g, ' ').slice(0, 500);
  }

  private toCompactJson(payload: Record<string, unknown>): string {
    try {
      return JSON.stringify(payload);
    } catch {
      return '{"serialization":"failed"}';
    }
  }

  private summarizeReferenceSummary(summary: ReferenceSummaryItem[]): Array<Record<string, unknown>> {
    return summary.map((item) => ({
      table: item.table,
      rowCount: item.rowCount,
      fieldsCount: item.fields.length,
      usedChars: item.usedChars ?? null,
      note: item.note || null,
    }));
  }

  private summarizeWarnings(warnings: string[], limit = 5): string[] {
    if (!warnings.length) return [];
    return warnings.slice(0, limit);
  }

  private findMissingEpisodeNumbers(
    episodeNumbers: number[],
    targetEpisodeCount?: number,
  ): number[] {
    if (!targetEpisodeCount || targetEpisodeCount <= 0) {
      return [];
    }
    const set = new Set(episodeNumbers);
    const missing: number[] = [];
    for (let i = 1; i <= targetEpisodeCount; i += 1) {
      if (!set.has(i)) missing.push(i);
    }
    return missing;
  }

  private sanitizeEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      return `${url.origin}${url.pathname}`;
    } catch {
      return endpoint.split('?')[0];
    }
  }

  private extractTopLevelKeys(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    return Object.keys(payload as Record<string, unknown>).slice(0, 20);
  }

  private getErrorName(error: unknown): string {
    if (error instanceof Error) return error.name;
    return 'UnknownError';
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as any;
      if (typeof response === 'string') return response;
      if (typeof response?.message === 'string') return response.message;
      if (Array.isArray(response?.message)) return response.message.join('; ');
      return error.message;
    }
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  }

  private getErrorCauseMessage(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null;
    const cause = (error as any).cause;
    if (cause instanceof Error) return cause.message;
    if (typeof cause === 'string') return cause;
    if (cause && typeof cause?.message === 'string') return cause.message;
    return null;
  }

  private toStageBadRequest(stage: string, error: unknown): BadRequestException {
    const message = this.getErrorMessage(error);
    if (message.startsWith(stage)) {
      return new BadRequestException(message);
    }
    return new BadRequestException(`${stage} ${message}`);
  }

  private logParseFailure(stage: string, text: string, error: unknown): void {
    const normalized = text || '';
    const prefix = normalized.slice(0, 800);
    const suffix = normalized.slice(Math.max(0, normalized.length - 400));
    const snippetHash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    this.logger.error(
      `[episode-script][parse][failed] ${this.toCompactJson({
        stage,
        errorName: this.getErrorName(error),
        errorMessage: this.getErrorMessage(error),
        textLength: normalized.length,
        snippetHash,
        prefix,
        suffix,
      })}`,
    );
  }

  private stripMarkdownCodeFence(text: string): string {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  private normalizeJsonLikeText(text: string): string {
    return text
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/^\uFEFF/, '')
      .trim();
  }
}

