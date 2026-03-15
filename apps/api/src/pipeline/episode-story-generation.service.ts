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

/** 短剧可拍性：弱钩子模板句（结尾仅这些则判弱） */
const WEAK_HOOK_PHRASES = /风暴将至|暗流涌动|局势紧张|朝局紧张|危机四伏/;
/** 终局跑偏：与 rewrite_goal 相反（建文守江山、朱棣未夺位） */
const REWRITE_GOAL_VIOLATION_PATTERNS = /朱棣.*攻破南京|建文朝覆灭|建文帝.*失败|历史.*未.*改写|朱棣.*夺位|南京.*陷落|燕军.*进京/;
/** 55-61 集 ending guard：终局锁死违规类型（扩展） */
const ENDING_GUARD_VIOLATION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /朱棣.*攻破南京|南京.*陷落|燕军.*进京/, label: '朱棣攻破南京' },
  { pattern: /建文朝覆灭|建文.*覆灭/, label: '建文朝覆灭' },
  { pattern: /建文帝.*失败|建文帝.*失位|建文帝.*出逃/, label: '建文帝失败/失位/出逃' },
  { pattern: /朱棣.*登基|朱棣.*夺位.*成功|建立.*新朝/, label: '朱棣登基/夺位成功/新朝' },
  { pattern: /历史.*没有.*改写|一切.*仍.*回到|按.*历史.*发生/, label: '历史未被改写' },
  { pattern: /退隐江南|写书传后人|传奇落幕/, label: '失败后抒情收尾' },
  { pattern: /时代更替|新朝开启|新的朝代.*辉煌/, label: '变相承认原结局' },
];
/** 结尾具体钩子：人名/事件/物件/时点（用于 concreteHookOk） */
const CONCRETE_HOOK_ENTITIES = /沈照|朱允炆|朱棣|李景隆|齐泰|黄子澄|耿炳文|盛庸|铁铉|姚广孝|密折|城门|金川门|诏令|奏折|兵符|内线|夜袭|起兵|守城|削藩|今晚|今夜|明日|天亮前|三日内|下一刻|此刻/;
/** 重复模板句（用于 warning 计数） */
const TEMPLATE_PHRASES = ['局势骤然紧张', '暗流涌动', '风暴将至', '朝局紧张', '危机四伏'];

/** 第三轮：口播字数门槛（短剧旁白稿） */
const MIN_NARRATION_CHARS_SEVERE = 260;
const MIN_NARRATION_CHARS_WEAK = 360;

/** 第三轮：动作事件词（用于事件密度） */
const ACTION_EVENT_PATTERNS = /递|交|送|入殿|跪|传旨|下旨|搜|查|抓|拦|换防|布防|调兵|夜袭|设伏|开门|封门|揭发|审问|对质|焚毁|夺下|伏击|密会|呈报|拆开密折|调动援军/g;
/** 第三轮：心理摘要词（用于事件密度） */
const SUMMARY_ONLY_PATTERNS = /我知道|我意识到|我明白|我必须|我不能|我决定|我感到|我原以为|我只好|我深知/g;

/** 第三轮：问句钩子（尾部偏提纲问句） */
const QUESTION_HOOK_PATTERNS = /谁会|会不会|我要知道|我必须知道|我要确认|我必须确认|究竟是谁|究竟会不会/;
/** 第三轮：事件钩子（尾部已发生/即将发生的事件） */
const EVENT_HOOK_PATTERNS = /密折落到|某人跪在殿外|城门被打开|兵符不见了|诏令已下|内奸现身|将领倒戈|援军到了|夜袭开始|金川门失守|金川门被守住|某人先动手了|某封信被截|某证据暴露/;

/** 第三轮：终局收束关键词 */
const ENDING_RESOLUTION_PATTERNS = /守住南京|稳住朝局|皇权得以稳固|叛党被清|内奸伏法|阵线稳住|建文帝采纳|朝堂恢复秩序|忠臣归位|防线巩固|危局已解|局势被扭转|朱棣残党受挫|乱局被按下|新秩序初定|政局稳定|收束|清算|定局|锁住胜局/;
/** 第三轮：终局仍开环/继续预警 */
const ENDING_OPEN_LOOP_PATTERNS = /下一场风暴|更深层的威胁|更大的危机还在后面|只是开始|还远未结束|真正的考验才刚开始|下一步仍需警戒|还有更可怕的敌人|更深的阴谋正在逼近/;

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
    for (const ep of allEpisodes) {
      const ev = this.evaluateStoryTextForShortDrama(ep.episodeNumber, ep.storyText ?? '');
      warnings.push(...ev.warnings);
    }
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

  /**
   * 55-61 集 ending guard：仅当 batch 中含末段集数时返回强约束块，注入 writer prompt。
   */
  private buildEndingGuardInstruction(
    batch: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[],
  ): string {
    const hasEnding = batch.some((b) => b.episodeNumber >= 55);
    if (!hasEnding) return '';
    return `

【终局锁死·第55-61集必遵】
本批若含第55-61集，属终局收束段，严禁跑偏到历史原结局。
- 建文朝必须保住皇权；朱棣不得攻破南京、不得登基、不得完成夺位。
- 结局必须体现「沈照的干预有效改变历史」。
- 55-61 集必须逐步形成终局收束；59-61 集必须出现明确的稳局/反制/清算/定局/巩固结果。
- 禁止把第 61 集写成「新的更大风暴前夜」；最后一集必须体现阶段性胜利闭环，而不是继续中段式吊悬念。
- 禁止：时代更替、王朝覆灭、历史仍按原样发生；禁止空泛口号式胜利，须写出具体胜利机制或具体扭转结果。`;
  }

  /**
   * 55-61 集终局违规检测（扩展类型），用于 persist 门禁与 generateDraft warnings。
   */
  private evaluateEndingGuardForRewriteGoal(
    episodeNumber: number,
    storyText: string,
  ): { violated: boolean; violationType?: string } {
    if (episodeNumber < 55) {
      const hit = REWRITE_GOAL_VIOLATION_PATTERNS.test((storyText || '').trim());
      return hit ? { violated: true, violationType: 'rewrite_goal' } : { violated: false };
    }
    const trimmed = (storyText || '').trim();
    for (const { pattern, label } of ENDING_GUARD_VIOLATION_PATTERNS) {
      if (pattern.test(trimmed)) return { violated: true, violationType: label };
    }
    if (REWRITE_GOAL_VIOLATION_PATTERNS.test(trimmed)) return { violated: true, violationType: 'rewrite_goal' };
    return { violated: false };
  }

  /**
   * 短剧可拍性评估（规则优先）：第一人称、钩子、终局、口播字数、事件密度、问句/事件钩子、终局收束。
   * 见 docs/episode-story-shortdrama-evaluation-and-repair-spec.md 及 round2/round3 补强。
   */
  private evaluateStoryTextForShortDrama(
    episodeNumber: number,
    storyText: string,
  ): {
    firstPersonOk: boolean;
    firstPersonLeadOk: boolean;
    firstPersonCount: number;
    thirdPersonLeadCount: number;
    introHasWo: boolean;
    thirdPersonSummaryRisk: boolean;
    weakHook: boolean;
    severeWeakHook: boolean;
    concreteHookOk: boolean;
    questionHookOnly: boolean;
    eventHookOk: boolean;
    rewriteGoalViolation: boolean;
    templateRepeatCount: number;
    charCount: number;
    tooShortForNarration: boolean;
    narrationLengthWeak: boolean;
    actionEventHitCount: number;
    summaryPhraseHitCount: number;
    eventDensityLow: boolean;
    eventDensitySeverelyLow: boolean;
    endingClosureWeak: boolean;
    endingClosureMissing: boolean;
    warnings: string[];
  } {
    const trimmed = (storyText || '').trim();
    const warnings: string[] = [];
    const head200 = trimmed.slice(0, 200);
    const head120 = trimmed.slice(0, 120);
    const tail = trimmed.slice(-120);
    const tail80 = trimmed.slice(-80);
    const charCount = trimmed.length;

    if (charCount < MIN_NARRATION_CHARS_SEVERE) {
      warnings.push(`第${episodeNumber}集：storyText 字数过短（${charCount} chars），不足以稳定支撑短剧旁白口播。`);
    } else if (charCount < MIN_NARRATION_CHARS_WEAK) {
      warnings.push(`第${episodeNumber}集：storyText 字数偏短，可能更像剧情摘要而非完整短剧旁白稿。`);
    }
    const tooShortForNarration = charCount < MIN_NARRATION_CHARS_SEVERE;
    const narrationLengthWeak = charCount >= MIN_NARRATION_CHARS_SEVERE && charCount < MIN_NARRATION_CHARS_WEAK;

    const actionEventHitCount = (trimmed.match(ACTION_EVENT_PATTERNS) || []).length;
    const summaryPhraseHitCount = (trimmed.match(SUMMARY_ONLY_PATTERNS) || []).length;
    const eventDensityLow =
      actionEventHitCount < 2 || (actionEventHitCount === 0 && summaryPhraseHitCount >= 3);
    const eventDensitySeverelyLow = actionEventHitCount === 0 && summaryPhraseHitCount >= 4;
    if (eventDensityLow) {
      warnings.push(`第${episodeNumber}集：storyText 动作事件密度不足，更像心理总结/剧情摘要，短剧可拍性偏弱。`);
    }
    if (eventDensitySeverelyLow) {
      warnings.push(`第${episodeNumber}集：storyText 几乎没有可拍动作事件，当前更接近梗概而非成片旁白稿。`);
    }

    const firstPersonCount = (head200.match(/我/g) || []).length;
    const thirdPersonLeadCount = (head200.match(/沈照|她/g) || []).length;
    const introHasWo = (head120.match(/我/g) || []).length >= 1;
    const firstPersonOk = firstPersonCount >= 1 || (thirdPersonLeadCount < 2 && trimmed.length > 0);
    const thirdPersonSummaryRisk = thirdPersonLeadCount >= 2 && firstPersonCount === 0;
    const firstPersonLeadOk = introHasWo && (firstPersonCount >= 1 && (thirdPersonLeadCount <= 1 || firstPersonCount >= thirdPersonLeadCount));

    if (!firstPersonOk && trimmed.length >= 50) {
      warnings.push(`第${episodeNumber}集：建议使用第一人称旁白（沈照视角「我」），避免大段第三人称。`);
    }
    if (thirdPersonSummaryRisk && trimmed.length >= 50) {
      warnings.push(`第${episodeNumber}集：明显第三人称摘要化，建议改为第一人称旁白（沈照视角）。`);
    }
    if (firstPersonOk && !firstPersonLeadOk && firstPersonCount < 2 && thirdPersonLeadCount >= 1 && trimmed.length >= 80) {
      warnings.push(`第${episodeNumber}集：第一人称偏弱，前段建议自然出现「我」并保持旁白主导。`);
    }

    const tailWeakPhraseHit = WEAK_HOOK_PHRASES.test(tail80);
    const tailSpecificEntityCount = (tail.match(CONCRETE_HOOK_ENTITIES) || []).length;
    const concreteHookOk = tailSpecificEntityCount >= 1;
    const weakHook = tailWeakPhraseHit && tailSpecificEntityCount < 2;
    const severeWeakHook = tailWeakPhraseHit && tailSpecificEntityCount === 0;
    if (weakHook) {
      warnings.push(`第${episodeNumber}集：结尾钩子过于空泛，建议具体到人/事/时（如某人、某密折、今晚、某城门）。`);
    }
    if (severeWeakHook) {
      warnings.push(`第${episodeNumber}集：结尾仅抽象词无具体对象，建议写出下一集最想看的具体问题。`);
    }
    if (episodeNumber >= 55 && weakHook) {
      warnings.push(`第${episodeNumber}集：属终局段，结尾建议写出具体收束结果或具体风险，避免空泛。`);
    }

    const questionHookHit = QUESTION_HOOK_PATTERNS.test(tail);
    const eventHookHit = EVENT_HOOK_PATTERNS.test(tail);
    const eventHookOk = eventHookHit;
    const questionHookOnly = questionHookHit && !eventHookHit;
    if (questionHookOnly) {
      warnings.push(`第${episodeNumber}集：结尾更像问句钩子，缺少已经发生/即将发生的事件钩子，短剧爆点偏弱。`);
    }

    let rewriteGoalViolation = REWRITE_GOAL_VIOLATION_PATTERNS.test(trimmed);
    if (episodeNumber >= 55) {
      const endingEv = this.evaluateEndingGuardForRewriteGoal(episodeNumber, trimmed);
      if (endingEv.violated) {
        rewriteGoalViolation = true;
        warnings.push(`第${episodeNumber}集：与 rewrite_goal 冲突，属于终局锁死违规，不建议写库。`);
      }
    } else if (rewriteGoalViolation) {
      warnings.push(`第${episodeNumber}集：终局与改写目标不符（不得出现朱棣攻破南京、建文朝覆灭等）。`);
    }

    let templateRepeatCount = 0;
    for (const phrase of TEMPLATE_PHRASES) {
      const n = (trimmed.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      templateRepeatCount += n;
    }
    if (templateRepeatCount >= 2) {
      warnings.push(`第${episodeNumber}集：模板句重复较多，建议换用具体描写。`);
    }

    let endingClosureWeak = false;
    let endingClosureMissing = false;
    if (episodeNumber >= 55) {
      const endingResolutionHitCount = (trimmed.match(ENDING_RESOLUTION_PATTERNS) || []).length;
      const endingOpenLoopHitCount = (trimmed.match(ENDING_OPEN_LOOP_PATTERNS) || []).length;
      if (endingResolutionHitCount === 0 && endingOpenLoopHitCount >= 1) {
        endingClosureWeak = true;
        warnings.push(`第${episodeNumber}集：已进入终局段，但正文仍以继续预警/继续铺悬念为主，缺少终局收束。`);
      }
      if (episodeNumber >= 59 && endingResolutionHitCount === 0) {
        endingClosureMissing = true;
        warnings.push(`第${episodeNumber}集：终局阶段缺少明确收束结果，不像大结局段。`);
      }
    }

    return {
      firstPersonOk,
      firstPersonLeadOk,
      firstPersonCount,
      thirdPersonLeadCount,
      introHasWo,
      thirdPersonSummaryRisk,
      weakHook,
      severeWeakHook,
      concreteHookOk,
      questionHookOnly,
      eventHookOk,
      rewriteGoalViolation,
      templateRepeatCount,
      charCount,
      tooShortForNarration,
      narrationLengthWeak,
      actionEventHitCount,
      summaryPhraseHitCount,
      eventDensityLow,
      eventDensitySeverelyLow,
      endingClosureWeak,
      endingClosureMissing,
      warnings,
    };
  }

  /** P0: 写库前质量门禁，禁止占位或过短 storyText 落库；并做短剧可拍性门禁（第一人称、终局一致性） */
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
    for (const ep of draft.episodes) {
      const epNum = ep.episodeNumber;
      const storyText = (ep.storyText ?? '').trim();
      if (storyText.length < MIN_STORY_TEXT_LENGTH) continue;
      if (epNum >= 55) {
        const endingEv = this.evaluateEndingGuardForRewriteGoal(epNum, storyText);
        if (endingEv.violated) {
          this.logger.warn(
            `[episode-story][persist][quality-block] episode=${epNum} reason=rewrite_goal_conflict`,
          );
          throw new BadRequestException(
            `第${epNum}集内容与改写目标不符（不得出现朱棣攻破南京、建文朝覆灭等结局）。Persist blocked.`,
          );
        }
      }
      const head120 = storyText.slice(0, 120);
      const head200 = storyText.slice(0, 200);
      const thirdIn120 = (head120.match(/沈照|她/g) || []).length;
      const firstIn120 = (head120.match(/我/g) || []).length;
      const thirdIn200 = (head200.match(/沈照|她/g) || []).length;
      const firstIn200 = (head200.match(/我/g) || []).length;
      if (firstIn120 === 0 && thirdIn120 >= 2) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=third_person_summary`,
        );
        throw new BadRequestException(
          `第${epNum}集 storyText 前段无第一人称且第三人称明显，请改为第一人称旁白（沈照视角）。Persist blocked.`,
        );
      }
      if (thirdIn200 >= 2 && firstIn200 === 0) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=third_person_summary`,
        );
        throw new BadRequestException(
          `第${epNum}集 storyText 为第三人称摘要式，请改为第一人称旁白（沈照视角）。Persist blocked.`,
        );
      }
      const ev = this.evaluateStoryTextForShortDrama(epNum, storyText);
      if (ev.tooShortForNarration) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=narration_too_short chars=${ev.charCount}`,
        );
        throw new BadRequestException(
          `第${epNum}集 storyText 字数过短（${ev.charCount} 字），不足以支撑短剧旁白口播。Persist blocked.`,
        );
      }
      if (ev.eventDensitySeverelyLow) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=event_density_low actionEvents=${ev.actionEventHitCount} summaryPhrases=${ev.summaryPhraseHitCount}`,
        );
        throw new BadRequestException(
          `第${epNum}集 动作事件密度严重不足，更接近梗概而非成片旁白稿。Persist blocked.`,
        );
      }
      if (epNum >= 59 && ev.endingClosureMissing) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=ending_closure_missing`,
        );
        throw new BadRequestException(
          `第${epNum}集 终局阶段缺少明确收束结果。Persist blocked.`,
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
    if (arr.length !== targetCount) {
      this.logger.warn(
        `[episode-story][planner][quality-block] expected=${targetCount} actual=${arr.length} reason=planner_count_mismatch`,
      );
      throw new BadRequestException(
        `Episode story planner returned ${arr.length} items, expected ${targetCount}.`,
      );
    }
    const plan: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[] = [];
    for (let i = 0; i < arr.length; i++) {
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
    const endingGuardBlock = this.buildEndingGuardInstruction(batch);
    const systemMsg = `你是短剧故事正文写作助手。根据本批每集的规划（title、summary、storyBeat），生成每集的 storyText。

【必须遵守】
1. storyText 必须由沈照以第一人称持续叙述。前两句必须自然出现「我」；全文主句式应以「我看到/我意识到/我不能/我必须/我原以为/我没想到/我当即/我只好/我知道」等为主。禁止把正文写成第三人称简介；禁止连续多句以「沈照/她」作主语；禁止百科式、梗概式、总结式剧情说明；读起来要像旁白口播，而不是项目说明书。
2. 每集结尾优先写「事件已经发生或即将立刻发生」的事件钩子，不要总用抽象问句收尾。优先事件钩子（如密折先落进谁手里、某人突然现身、某道诏令突然下达、某城门被人打开、某将领临阵倒戈、某内奸暴露）；问句钩子（如「谁会……？」「会不会……？」）仅作次优。禁止连续多集都用「谁会……？」「会不会……？」「我要知道……」「我必须确认……」收尾。至少出现一个明确对象，不可仅用「风暴将至」「暗流涌动」「局势紧张」等抽象词收尾。
3. 本项目改写目标（rewrite_goal）：沈照改写靖难之役，建文帝守住江山，朱棣不能按历史成功夺位。结局不得出现朱棣攻破南京、建文朝覆灭、建文帝失败、历史未被改写等跑偏内容。${endingGuardBlock}

只输出严格 JSON 数组，每项含 episodeNumber、title、summary、storyText。`;
    this.logger.log(`[episode-story][writer] prompt uses first-person + ending guard + concrete hook constraints`);
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
    let firstPersonOkCount = 0;
    let weakHookCount = 0;
    let severeWeakHookCount = 0;
    let concreteHookOkCount = 0;
    let eventHookOkCount = 0;
    let questionHookOnlyCount = 0;
    for (const item of out) {
      const ev = this.evaluateStoryTextForShortDrama(item.episodeNumber, item.storyText ?? '');
      if (ev.firstPersonOk) firstPersonOkCount += 1;
      if (ev.weakHook) weakHookCount += 1;
      if (ev.severeWeakHook) severeWeakHookCount += 1;
      if (ev.concreteHookOk) concreteHookOkCount += 1;
      if (ev.eventHookOk) eventHookOkCount += 1;
      if (ev.questionHookOnly) questionHookOnlyCount += 1;
    }
    this.logger.log(
      `[episode-story][writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][narration-check] firstPersonOk=${firstPersonOkCount}/${out.length} weakHookCount=${weakHookCount}`,
    );
    this.logger.log(
      `[episode-story][writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][hook-check] concreteHookOk=${concreteHookOkCount}/${out.length} weakHookCount=${weakHookCount} severeWeakHookCount=${severeWeakHookCount} eventHookOk=${eventHookOkCount}/${out.length} questionHookOnlyCount=${questionHookOnlyCount}`,
    );
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
