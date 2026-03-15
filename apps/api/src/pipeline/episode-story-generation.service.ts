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
import { MaterialSiftingService } from './material-sifting.service';
import type { DramaticEvidencePack } from './dto/material-sifting.dto';

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_SOURCE_CHAR_BUDGET = 30000;
const DRAFT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_DRAFTS = 50;
/** P0: 禁止占位/极短正文落库；正文最小长度（绝对下限） */
const MIN_STORY_TEXT_LENGTH_ABSOLUTE = 50;
/** 占位串模板，仅用于校验与日志，不再作为成功路径 fallback */
const PLACEHOLDER_STORY_TEXT_TEMPLATE = (epNum: number) => `第${epNum}集故事正文。`;

/** P1: persist 口播字数硬门槛，低于此禁止写库（可拍短剧体） */
const MIN_NARRATION_CHARS_STRONG = 360;

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

/** 第三轮：口播字数门槛（短剧旁白稿）；persist 使用 MIN_NARRATION_CHARS_STRONG */
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

/** P2: Beat Planner 输出的结构化节拍规划 */
interface StoryBeatJson {
  episode_meta: {
    episode_number: number;
    title: string;
    summary: string;
    single_goal: string;
    antagonist_goal: string;
    theme_expression: string;
  };
  pacing_structure: {
    target_duration_seconds: number;
    estimated_word_count: number;
    hook_3s: {
      description: string;
      hook_type: 'visual_shock' | 'suspenseful_question' | 'action_start' | 'dramatic_reveal';
    };
    conflict_15s: {
      description: string;
      protagonist_action: string;
      antagonist_reaction: string;
    };
    mid_reversal: {
      description: string;
      reversal_type: 'power_dynamic_shift' | 'information_reveal' | 'ally_betrayal' | 'plan_failure' | 'unexpected_ally';
    };
    climax: {
      description: string;
      outcome: string;
    };
    tail_hook: {
      description: string;
      hook_type: 'event_cliffhanger' | 'new_mystery' | 'character_in_danger' | 'goal_achieved_new_problem';
    };
  };
  production_elements: {
    key_characters: string[];
    key_locations: string[];
    key_props: string[];
  };
}

/** P2: Beat Planner 的 System Prompt */
const BEAT_PLANNER_SYSTEM_PROMPT = `### ROLE: Short-Drama Beat Planner

你是一名顶级的短剧编剧专家，你的任务是为一部历史改写题材的短剧，规划其中若干集的详细故事节拍 (Beat)。你将收到一份关于本批各集的"戏剧证据包"（JSON格式），里面包含了所有你需要知道的背景信息。你的唯一任务是为每一集输出一份严格遵循指定 JSON Schema 的"故事节拍规划"。

### OUTPUT JSON Schema（每集一个对象，最终输出为数组）

每集的 story_beat_json 必须严格遵循以下结构：
{
  "episode_meta": {
    "episode_number": <integer>,
    "title": "<本集标题>",
    "summary": "<一句话概述本集核心情节>",
    "single_goal": "<本集主角的唯一、明确、可衡量的核心目标>",
    "antagonist_goal": "<本集核心对手的冲突性目标>",
    "theme_expression": "<本集如何体现或推进某条核心设定/爽点线/权力阶梯>"
  },
  "pacing_structure": {
    "target_duration_seconds": 60,
    "estimated_word_count": 400,
    "hook_3s": {
      "description": "<开篇3-5秒的钩子，必须是具体的、可视化的事件或画面>",
      "hook_type": "<visual_shock|suspenseful_question|action_start|dramatic_reveal>"
    },
    "conflict_15s": {
      "description": "<15秒内核心冲突如何被引入或激化>",
      "protagonist_action": "<主角的具体行动>",
      "antagonist_reaction": "<对手的直接反应>"
    },
    "mid_reversal": {
      "description": "<中段40%-70%处的明确情势逆转或信息反转>",
      "reversal_type": "<power_dynamic_shift|information_reveal|ally_betrayal|plan_failure|unexpected_ally>"
    },
    "climax": {
      "description": "<本集冲突的最高潮，主角与对手的直接对抗>",
      "outcome": "<这次对抗的直接结果>"
    },
    "tail_hook": {
      "description": "<结尾钩子，必须是具体的、未解决的事件>",
      "hook_type": "<event_cliffhanger|new_mystery|character_in_danger|goal_achieved_new_problem>"
    }
  },
  "production_elements": {
    "key_characters": ["<本集出场核心人物>"],
    "key_locations": ["<本集关键场景地点>"],
    "key_props": ["<本集关键道具>"]
  }
}

### CORE INSTRUCTIONS

1. [Define the Core]: 基于证据包中的 temporal_context（故事阶段）和 character_context（主角即时目标），为每集定义 single_goal 和 antagonist_goal。
2. [Plan the Hook]: 查看 plotline_context 中的 required_hook_rhythm 和 active_payoff_lines，设计一个能在3-5秒内抓住眼球的具体、可视化的事件。
3. [Introduce Conflict]: 将 single_goal 与 antagonist_goal 直接碰撞，设计具体的 protagonist_action 和 antagonist_reaction。
4. [Engineer the Reversal]: 设计一个打破观众预期的具体转折事件，与 active_payoff_lines 结合。
5. [Design the Climax]: 将反转后的困境推向顶点，展现最激烈的对抗和具体结果。
6. [Set the Tail Hook]: 基于 climax 的 outcome，制造一个具体的、未解决的事件型悬念。

### CONSTRAINTS

- 所有节拍描述必须是具体的、可视化的动作/事件/对话，禁止抽象描述。
- 输出必须是严格 JSON 数组，每项为一集的 story_beat_json。不要 markdown、不要解释。
- 所有规划必须基于戏剧证据包，不要凭空捏造与证据包无关的人物或情节线。
- 本项目改写目标：沈照改写靖难之役，建文帝守住江山，朱棣不能按历史成功夺位。`;

/** P2: 按谱填词的 Writer System Prompt */
const P2_WRITER_SYSTEM_PROMPT = `### ROLE: Short-Drama Script Executor

你是一名专业的短剧执行编剧。你的任务不是从零创作，而是将一份已经规划好的、高度结构化的"故事节拍规划" (story_beat_json)，精准地、忠实地扩写成生动、连贯、可拍摄的 60/90 秒短剧故事正文 (storyText)。

### EXECUTION PROCESS

1. [Internalize the Blueprint]: 仔细阅读并完全理解 story_beat_json 中的每一个节拍描述。这是你的剧本。
2. [Write Beat by Beat]:
   - Opening (Hook): 将 hook_3s 的描述直接转化为故事开篇第一句或第一段，创造强烈视觉冲击力。
   - Inciting Incident (Conflict): 紧接着将 conflict_15s 无缝衔接，生动描绘 protagonist_action 和 antagonist_reaction 的交锋。
   - Midpoint (Reversal): 在故事文本的中间部分(40%-70%位置)，实现 mid_reversal 中描述的具体转折事件。
   - Climax: 紧随反转之后，将 climax 扩写为故事最高潮，用最激烈的动作和对抗展现 outcome。
   - Ending (Tail Hook): 用 tail_hook 的描述作为故事结尾，留下具体的、未解决的悬念。
3. [Polish]: 确保段落过渡流畅，语言生动，充满画面感。

### ABSOLUTE COMMANDMENTS

1. 每集 = 60秒可拍短剧单元（默认），建议 360–520 中文字。禁止写成剧情简介、总结、提纲。
2. 全文必须由沈照以第一人称「我」持续叙述。前两句必须自然出现「我」。禁止第三人称简介、百科式、梗概式说明。
3. 你绝不能偏离 story_beat_json 中定义的任何一个节拍事件。如果节拍说"主角打翻了烛台"，你就不能写成"主角推倒了书架"。
4. 不要写总结性句子如"主角陷入了危机"。要写"冰冷的剑锋已经架在了她的脖子上，殿外传来了禁军整齐的脚步声。" Show, Don't Tell!
5. 多用短句，多写动作、表情、眼神和具体环境细节。避免大段心理描写和抽象形容词。
6. 严格按照 hook_3s -> conflict_15s -> mid_reversal -> climax -> tail_hook 的顺序和节奏组织故事文本。
7. 结尾必须是事件型尾钩（已发生或即将发生的事件），不能只是抽象感慨或空问句。禁止仅用"风暴将至""暗流涌动""局势紧张"收尾。
8. 本项目改写目标：沈照改写靖难之役，建文帝守住江山，朱棣不能按历史成功夺位。结局不得出现朱棣攻破南京、建文朝覆灭等跑偏内容。

只输出严格 JSON 数组，每项含 episodeNumber、title、summary、storyText。不要 markdown 和解释。`;

/** P3: 自动重写最大重试次数 */
const AUTO_REWRITE_MAX_RETRIES = 2;

/** P3: 自动重写代理的 System Prompt */
const AUTO_REWRITE_SYSTEM_PROMPT = `### ROLE: Short-Drama Script Doctor

你是一名经验丰富的剧本医生。你的任务是根据 QA 报告，修复一段未能严格遵循节拍规划的故事文本。

### INPUT
你将收到三份材料：
1. **原始节拍规划 (story_beat_json)**：这是"标准答案"，修复后的文本必须 100% 符合它。
2. **有问题的故事文本 (storyText)**：这是需要修复的原始文本。
3. **QA 错误报告 (qa_issues)**：这是一个结构化的错误列表，明确指出了哪些地方不合格。

### EXECUTION PROCESS
1. [Diagnose]: 仔细阅读 QA 错误报告中的每一条错误，理解问题的根源。
2. [Locate]: 在原始 storyText 中定位与每条错误对应的文本段落。
3. [Repair]: 仅针对错误报告中指出的问题，对故事文本进行最小化的、精准的修改。
4. [Preserve]: 保持原文的风格、语气和其余正确部分不变。不要重写整篇文章。
5. [Verify]: 确保修改后的文本符合节拍规划中的所有节拍（hook_3s, conflict_15s, mid_reversal, climax, tail_hook）。

### REPAIR RULES（按错误类型的修复策略）

- **narration_too_short**（字数不足360字）：在现有段落之间补充具体的动作描写、环境细节、对话片段，使总字数达到 360-520 字。不要添加无意义的水词。
- **third_person_summary**（第一人称不足）：将第三人称描述改为沈照的第一人称旁白视角「我」。前两句必须自然出现「我」。
- **event_density_low**（动作事件密度不足）：将心理描写和总结性语句替换为具体的动作事件（递、交、送、入殿、跪、传旨、搜、查、抓、揭发、审问等）。
- **weak_hook / severe_weak_hook**（结尾钩子空泛）：将结尾的抽象词（"风暴将至""暗流涌动"）替换为具体的事件型尾钩，必须涉及具体人名/物件/时间点（如"沈照""密折""今晚""城门"等）。
- **question_hook_only**（仅问句钩子）：在问句之前或之后补充一个已经发生或即将发生的具体事件。
- **rewrite_goal_violation**（与改写目标不符）：删除或改写涉及"朱棣攻破南京""建文朝覆灭"等内容，确保建文帝守住江山。
- **ending_closure_missing**（终局缺少收束）：为终局段（59-61集）补充具体的胜利机制或扭转结果。

### ABSOLUTE COMMANDMENTS
1. 全文必须由沈照以第一人称「我」持续叙述。
2. 修复后的文本必须在 360-520 中文字之间。
3. 必须忠实实现 story_beat_json 中定义的每一个节拍事件。
4. 结尾必须是事件型尾钩，禁止仅用抽象词收尾。
5. 本项目改写目标：沈照改写靖难之役，建文帝守住江山，朱棣不能按历史成功夺位。

### OUTPUT
只输出修复后的纯故事文本（storyText），不要 JSON 包裹，不要 markdown，不要解释。`;

/** P3: 单集 QA 诊断结果，用于传递给自动重写代理 */
interface EpisodeQaDiagnosis {
  episodeNumber: number;
  issues: {
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
  }[];
  /** 是否需要自动重写（存在 high severity 问题） */
  needsRewrite: boolean;
}

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
    private readonly materialSifting: MaterialSiftingService,
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

    // P2: 简化版 promptPreview（用于前端展示，不再用于 AI 调用）
    const promptPreview = `[P2 模式] 使用 MaterialSiftingService + BeatPlanner + P2Writer 三阶段流水线。目标 ${targetCount} 集，batchSize=${batchSize}`;
    const referenceSummary: EpisodeStoryReferenceSummaryItem[] = [];

    // === P2 三阶段流水线 ===
    const episodeList: { episodeNumber: number; title?: string; summary?: string }[] = [];
    for (let i = 1; i <= targetCount; i++) {
      episodeList.push({ episodeNumber: i });
    }
    const beatBatches = this.splitBatches(
      episodeList.map((e) => ({ ...e, storyBeat: undefined })),
      batchSize,
    );

    this.logger.log(`[episode-story][P2] beatBatchCount=${beatBatches.length} targetCount=${targetCount}`);

    const batchInfo: EpisodeStoryGenerateDraftResponse['batchInfo'] = [];
    const allEpisodes: EpisodeStoryDraft['episodes'] = [];
    let prevTail = '';
    let prevSummary = '';
    let prevTailBeat: StoryBeatJson | null = null;

    for (let i = 0; i < beatBatches.length; i++) {
      const batch = beatBatches[i];
      const startEp = batch[0]?.episodeNumber ?? i * batchSize + 1;
      const endEp = batch[batch.length - 1]?.episodeNumber ?? startEp + batch.length - 1;

      const beats = await this.runBeatPlanner(
        usedModelKey,
        novelId,
        batch,
        prevTailBeat,
      );

      const batchDraft = await this.runP2WriterBatch(
        usedModelKey,
        novelId,
        beats,
        prevTail,
        prevSummary,
        i + 1,
        beatBatches.length,
      );

      batchInfo.push({
        batchIndex: i + 1,
        range: `${startEp}-${endEp}`,
        success: true,
        episodeCount: batchDraft.length,
      });

      // P3: 对本批每集执行自动重写检查
      for (let j = 0; j < batchDraft.length; j++) {
        const ep = batchDraft[j];
        const beatForEp = beats[j] ?? beats[0];
        const rewriteResult = await this.autoRewriteIfNeeded(
          usedModelKey,
          ep.episodeNumber,
          ep.storyText ?? '',
          beatForEp,
        );

        if (rewriteResult.wasRewritten) {
          this.logger.log(
            `[episode-story][P3] ep=${ep.episodeNumber} rewritten after ${rewriteResult.rewriteAttempts} attempt(s)`,
          );
          ep.storyText = rewriteResult.finalStoryText;
        }

        if (rewriteResult.finalDiagnosis.needsRewrite) {
          warnings.push(
            `第${ep.episodeNumber}集：自动重写 ${rewriteResult.rewriteAttempts} 次后仍有问题（${rewriteResult.finalDiagnosis.issues.filter((i) => i.severity === 'high').map((i) => i.type).join('、')}），建议人工审阅。`,
          );
        }

        allEpisodes.push(ep);
      }

      if (batchDraft.length) {
        const last = batchDraft[batchDraft.length - 1];
        prevTail = this.extractStoryTailForContinuation(last.storyText ?? '', 200);
        prevSummary = last.summary ?? '';
      } else {
        prevTail = '';
        prevSummary = '';
      }
      if (beats.length) {
        prevTailBeat = beats[beats.length - 1];
      }
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
    const qaReport = this.runRuleBasedCheck(draft);
    if (qaReport.overallScore < 60) {
      this.logger.warn(
        `[episode-story][persist][qa-block] overallScore=${qaReport.overallScore} below 60`,
      );
      throw new BadRequestException(
        `QA 未通过：综合评分为 ${qaReport.overallScore}，低于 60，禁止写入。请根据检查结果修订草稿后再试。`,
      );
    }
    if (!qaReport.passed) {
      const highIssues = qaReport.episodeIssues.filter((e) => e.issues.some((i) => i.severity === 'high'));
      if (highIssues.length) {
        this.logger.warn(
          `[episode-story][persist][qa-block] high severity issues on episodes: ${highIssues.map((e) => e.episodeNumber).join(',')}`,
        );
        throw new BadRequestException(
          `QA 未通过：第 ${highIssues.map((e) => e.episodeNumber).join('、')} 集存在高严重度问题（如尾钩过弱、事件密度不足、第一人称不足等），禁止写入。请修订后再试。`,
        );
      }
    }
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
        storyBeatJson:
          ep.storyBeat != null
            ? typeof ep.storyBeat === 'string'
              ? (() => {
                  try {
                    return JSON.parse(ep.storyBeat);
                  } catch {
                    return { storyBeat: ep.storyBeat };
                  }
                })()
              : { storyBeat: ep.storyBeat }
            : undefined,
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
      if (trimmed.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE) {
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
      if (storyText.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE) continue;
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
      if (ev.charCount < MIN_NARRATION_CHARS_STRONG) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=narration_too_short chars=${ev.charCount} minRequired=${MIN_NARRATION_CHARS_STRONG}`,
        );
        throw new BadRequestException(
          `第${epNum}集 storyText 字数过短（${ev.charCount} 字），不足 ${MIN_NARRATION_CHARS_STRONG} 字，不足以支撑 60 秒可拍短剧旁白。Persist blocked.`,
        );
      }
      if (epNum < 59) {
        if (ev.severeWeakHook) {
          this.logger.warn(
            `[episode-story][persist][quality-block] episode=${epNum} reason=severe_weak_hook`,
          );
          throw new BadRequestException(
            `第${epNum}集 结尾钩子过于空泛（仅抽象词无具体对象），不符合可拍短剧尾钩要求。Persist blocked.`,
          );
        }
        if (ev.questionHookOnly) {
          this.logger.warn(
            `[episode-story][persist][quality-block] episode=${epNum} reason=question_hook_only`,
          );
          throw new BadRequestException(
            `第${epNum}集 结尾仅问句钩子、缺少事件型尾钩，不符合可拍短剧要求。Persist blocked.`,
          );
        }
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

  /** 取正文尾段用于 batch 衔接，避免仅传摘要导致衔接差 */
  private extractStoryTailForContinuation(text: string, maxChars = 200): string {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return '';
    if (trimmed.length <= maxChars) return trimmed;
    return trimmed.slice(-maxChars);
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

  /**
   * 按 batch 集数范围拉取参考上下文，供 writer 使用；hook/payoff/story_phases 按本批集数过滤，减少噪音。
   */
  private async buildContextBlockForWriterBatch(
    novelId: number,
    referenceTables: EpisodeStoryReferenceTable[],
    batchStartEp: number,
    batchEndEp: number,
    charBudget: number,
  ): Promise<string> {
    const context = await this.refContext.getContext(novelId, {
      requestedTables: referenceTables,
      startEpisode: batchStartEp,
      endEpisode: batchEndEp,
      optionalTablesCharBudget: Math.min(charBudget, 25000),
      overallCharBudget: charBudget,
    });
    const optionalFiltered: Record<string, Record<string, unknown>[]> = {};
    for (const [tableName, rows] of Object.entries(context.optionalTables)) {
      const arr = Array.isArray(rows) ? rows : [];
      if (tableName === 'set_payoff_lines' || tableName === 'set_story_phases') {
        const filtered = arr.filter((row) => {
          const r = row as Record<string, unknown>;
          const start = Number(r.start_ep ?? r.startEp ?? 0);
          const end = Number(r.end_ep ?? r.endEp ?? 0);
          return start <= batchEndEp && end >= batchStartEp;
        });
        optionalFiltered[tableName] = filtered;
      } else {
        optionalFiltered[tableName] = arr;
      }
    }
    const block = this.refContext.buildNarratorPromptContext(
      { ...context, optionalTables: optionalFiltered },
      { charBudget: Math.min(charBudget, 25000) },
    );
    const episodesText = JSON.stringify(context.episodes ?? [], null, 2);
    const structureText = JSON.stringify(context.structureTemplates?.slice(0, 50) ?? [], null, 2);
    const hookText = JSON.stringify(context.hookRhythms ?? [], null, 2);
    return `【核心参考】\nnovel_episodes:\n${episodesText}\n\ndrama_structure_template:\n${structureText}\n\nnovel_hook_rhythm:\n${hookText}\n\n【扩展参考】\n${block}`;
  }

  /** @deprecated P1 legacy planner — 保留用于 fallback */
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

  /**
   * P2: Beat Planner — 为一批集数生成结构化的 story_beat_json。
   * 对批内每集调用 materialSifting.buildEvidencePack 获取戏剧证据包，
   * 然后一次性调用 AI 生成该批所有集的节拍规划。
   */
  private async runBeatPlanner(
    modelKey: string,
    novelId: number,
    batch: { episodeNumber: number; title?: string; summary?: string }[],
    prevTailBeat?: StoryBeatJson | null,
  ): Promise<StoryBeatJson[]> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();

    const evidencePacks: DramaticEvidencePack[] = [];
    for (const item of batch) {
      const pack = await this.materialSifting.buildEvidencePack(novelId, item.episodeNumber);
      evidencePacks.push(pack);
    }

    const packsJson = JSON.stringify(evidencePacks, null, 2);
    const prevBeatBlock = prevTailBeat
      ? `上一集的节拍规划（用于衔接参考）：\n${JSON.stringify(prevTailBeat, null, 2)}\n\n`
      : '';
    const userMsg = `${prevBeatBlock}请为以下 ${batch.length} 集生成结构化的故事节拍规划（story_beat_json），每集一个 JSON 对象，最终输出为 JSON 数组。\n\n本批集数：${batch.map((b) => b.episodeNumber).join(', ')}\n\n本批各集的戏剧证据包：\n${packsJson.slice(0, 50000)}`;

    const promptChars = BEAT_PLANNER_SYSTEM_PROMPT.length + userMsg.length;
    this.logger.log(
      `[episode-story][beat-planner] batch=[${batch.map((b) => b.episodeNumber).join(',')}] promptChars=${promptChars}`,
    );

    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.3,
      messages: [
        { role: 'system', content: BEAT_PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    });
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    const raw = await res.text();
    this.logger.log(`[episode-story][beat-planner][raw] preview=${raw.trim().slice(0, 500)}`);
    if (!res.ok) throw new BadRequestException(`Beat Planner request failed: ${res.status}`);

    const content = this.extractModelContent(raw);
    const parsed = this.parseJsonFromText(content);
    const parsedBeats =
      Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>)?.beats ??
          (parsed as Record<string, unknown>)?.episodes ??
          [];
    const arr: unknown[] = Array.isArray(parsedBeats) ? parsedBeats : [];

    if (arr.length !== batch.length) {
      this.logger.warn(
        `[episode-story][beat-planner] expected=${batch.length} actual=${arr.length}`,
      );
    }

    const beats: StoryBeatJson[] = [];
    for (let i = 0; i < batch.length; i++) {
      const rawBeat = arr[i] as StoryBeatJson | undefined;
      if (!rawBeat?.episode_meta || !rawBeat?.pacing_structure) {
        this.logger.warn(
          `[episode-story][beat-planner] invalid beat for ep=${batch[i].episodeNumber}, using fallback`,
        );
        beats.push({
          episode_meta: {
            episode_number: batch[i].episodeNumber,
            title: batch[i].title ?? `第${batch[i].episodeNumber}集`,
            summary: batch[i].summary ?? '',
            single_goal: '',
            antagonist_goal: '',
            theme_expression: '',
          },
          pacing_structure: {
            target_duration_seconds: 60,
            estimated_word_count: 400,
            hook_3s: { description: '', hook_type: 'action_start' },
            conflict_15s: { description: '', protagonist_action: '', antagonist_reaction: '' },
            mid_reversal: { description: '', reversal_type: 'information_reveal' },
            climax: { description: '', outcome: '' },
            tail_hook: { description: '', hook_type: 'event_cliffhanger' },
          },
          production_elements: { key_characters: [], key_locations: [], key_props: [] },
        });
      } else {
        beats.push(rawBeat);
      }
    }

    this.logger.log(`[episode-story][beat-planner] parsed ${beats.length} beats`);
    return beats;
  }

  /**
   * P2: 按谱填词的 Writer — 接收结构化的 story_beat_json，生成 storyText。
   * 每批调用一次 AI，传入该批所有集的 beat 规划。
   */
  private async runP2WriterBatch(
    modelKey: string,
    novelId: number,
    beats: StoryBeatJson[],
    prevTail: string,
    prevSummary: string,
    batchIndex?: number,
    totalBatches?: number,
  ): Promise<EpisodeStoryDraft['episodes']> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();

    const beatsJson = JSON.stringify(beats, null, 2);
    const continuityBlock = prevTail
      ? `上一批最后一集结尾片段（用于衔接）：\n${prevTail}\n\n${prevSummary ? `（上集摘要：${prevSummary}）\n\n` : ''}`
      : '';

    const hasEnding = beats.some((b) => b.episode_meta.episode_number >= 55);
    const endingGuardBlock = hasEnding
      ? this.buildEndingGuardInstruction(
          beats.map((b) => ({
            episodeNumber: b.episode_meta.episode_number,
            title: b.episode_meta.title,
            summary: b.episode_meta.summary,
          })),
        )
      : '';

    const systemMsg = P2_WRITER_SYSTEM_PROMPT + endingGuardBlock;

    const userMsg = `${continuityBlock}本批为可拍短剧单元，请严格按照下方每集的 story_beat_json 节拍规划，为每集生成 storyText。你必须忠实地实现每个节拍（hook_3s、conflict_15s、mid_reversal、climax、tail_hook）中描述的具体事件，不允许只参考不落实。\n\n本批节拍规划：\n${beatsJson.slice(0, 40000)}`;

    const promptChars = systemMsg.length + userMsg.length;
    const requestedEpisodes = beats.map((b) => b.episode_meta.episode_number).join(',');
    this.logger.log(
      `[episode-story][p2-writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}] promptChars=${promptChars} requestedEpisodes=${requestedEpisodes}`,
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
    this.logger.log(
      `[episode-story][p2-writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][raw] preview=${raw.trim().slice(0, 500)}`,
    );
    if (!res.ok) throw new BadRequestException(`P2 Writer batch request failed: ${res.status}`);

    const content = this.extractModelContent(raw);
    const parsed = this.parseJsonFromText(content);
    const withEpisodes = parsed as unknown[] | { episodes?: unknown[] };
    const parsedItems = Array.isArray(withEpisodes)
      ? withEpisodes
      : (withEpisodes as Record<string, unknown>)?.episodes ?? [];
    const arr: unknown[] = Array.isArray(parsedItems) ? parsedItems : [];

    this.logger.log(
      `[episode-story][p2-writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][parse] arrLen=${arr.length}`,
    );

    if (arr.length === 0) {
      this.logger.warn('[episode-story][p2-writer] empty result, throwing');
      throw new BadRequestException('P2 Writer returned empty result.');
    }

    if (arr.length < beats.length) {
      this.logger.warn(
        `[episode-story][p2-writer] fewer items than beats: arrLen=${arr.length} beatsLen=${beats.length}`,
      );
      throw new BadRequestException('P2 Writer returned fewer items than requested batch.');
    }

    let invalidStoryTextCount = 0;
    const out: EpisodeStoryDraft['episodes'] = [];
    for (let i = 0; i < beats.length; i++) {
      const one = (arr[i] || {}) as WriterItemLike;
      const epNum = (one.episodeNumber ??
        one.episode_number ??
        beats[i].episode_meta.episode_number) as number;
      const normalizedStoryText = this.normalizeWriterStoryText(one);
      const isValid =
        typeof normalizedStoryText === 'string' &&
        normalizedStoryText.trim().length >= MIN_STORY_TEXT_LENGTH_ABSOLUTE &&
        normalizedStoryText.trim() !== PLACEHOLDER_STORY_TEXT_TEMPLATE(epNum);

      if (!isValid) {
        invalidStoryTextCount += 1;
      } else {
        out.push({
          episodeNumber: epNum,
          title: one.title ?? beats[i].episode_meta.title,
          summary: one.summary ?? beats[i].episode_meta.summary,
          storyText: normalizedStoryText,
          storyBeat: JSON.stringify(beats[i]),
        });
      }
    }

    this.logger.log(
      `[episode-story][p2-writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][validate] requested=${beats.length} parsed=${arr.length} invalid=${invalidStoryTextCount}`,
    );

    if (invalidStoryTextCount > 0) {
      this.logger.warn(
        `[episode-story][p2-writer] invalid storyText count=${invalidStoryTextCount}, throwing`,
      );
      throw new BadRequestException('P2 Writer returned invalid storyText for some episodes.');
    }

    for (const item of out) {
      const ev = this.evaluateStoryTextForShortDrama(item.episodeNumber, item.storyText ?? '');
      if (ev.firstPersonOk) this.logger.debug(`[p2-writer] ep=${item.episodeNumber} firstPersonOk`);
      if (ev.weakHook) this.logger.warn(`[p2-writer] ep=${item.episodeNumber} weakHook detected`);
      if (ev.severeWeakHook)
        this.logger.warn(`[p2-writer] ep=${item.episodeNumber} severeWeakHook detected`);
    }

    return out;
  }

  /**
   * P3: 对单集 storyText 进行 QA 诊断，返回结构化的问题列表。
   * 复用 evaluateStoryTextForShortDrama 的逻辑，
   * 输出为 EpisodeQaDiagnosis 格式，供 autoRewrite 使用。
   */
  private diagnoseEpisode(
    episodeNumber: number,
    storyText: string,
  ): EpisodeQaDiagnosis {
    const ev = this.evaluateStoryTextForShortDrama(episodeNumber, storyText);
    const issues: EpisodeQaDiagnosis['issues'] = [];

    if (ev.charCount < MIN_NARRATION_CHARS_STRONG) {
      issues.push({
        type: 'narration_too_short',
        message: `字数仅 ${ev.charCount} 字，不足 ${MIN_NARRATION_CHARS_STRONG} 字，无法支撑 60 秒可拍短剧旁白。需要补充具体动作描写和环境细节，使总字数达到 360-520 字。`,
        severity: 'high',
      });
    }

    if (ev.thirdPersonSummaryRisk || !ev.firstPersonLeadOk) {
      issues.push({
        type: 'third_person_summary',
        message: `第一人称旁白不足或第三人称摘要化（前200字中"我"出现 ${ev.firstPersonCount} 次，"沈照/她"出现 ${ev.thirdPersonLeadCount} 次）。需要改为沈照第一人称「我」视角叙述，前两句必须出现「我」。`,
        severity: 'high',
      });
    }

    if (ev.eventDensitySeverelyLow) {
      issues.push({
        type: 'event_density_low',
        message: `动作事件密度严重不足（动作事件词命中 ${ev.actionEventHitCount} 次，心理摘要词命中 ${ev.summaryPhraseHitCount} 次）。需要将心理描写替换为具体动作事件（递、交、送、入殿、跪、传旨、搜、查、抓等）。`,
        severity: 'high',
      });
    }

    if (episodeNumber < 59 && ev.severeWeakHook) {
      issues.push({
        type: 'severe_weak_hook',
        message: '结尾钩子过于空泛（仅抽象词无具体对象）。需要将结尾替换为具体的事件型尾钩，涉及具体人名/物件/时间点。',
        severity: 'high',
      });
    }

    if (episodeNumber < 59 && ev.questionHookOnly) {
      issues.push({
        type: 'question_hook_only',
        message: '结尾仅问句钩子，缺少事件型尾钩。需要在问句之前或之后补充一个已经发生或即将发生的具体事件。',
        severity: 'high',
      });
    }

    if (ev.rewriteGoalViolation) {
      issues.push({
        type: 'rewrite_goal_violation',
        message: '内容与改写目标不符（出现朱棣攻破南京、建文朝覆灭等）。需要删除或改写相关内容，确保建文帝守住江山。',
        severity: 'high',
      });
    }

    if (episodeNumber >= 59 && ev.endingClosureMissing) {
      issues.push({
        type: 'ending_closure_missing',
        message: '终局阶段缺少明确收束结果。需要补充具体的胜利机制或扭转结果（守住南京、稳住朝局、叛党被清等）。',
        severity: 'high',
      });
    }

    const needsRewrite = issues.some((i) => i.severity === 'high');
    return { episodeNumber, issues, needsRewrite };
  }

  /**
   * P3: 自动重写代理 — 接收有问题的 storyText、原始 beat 规划和 QA 诊断，
   * 调用 AI "剧本医生" 进行精准修复，返回修复后的 storyText。
   */
  private async runAutoRewrite(
    modelKey: string,
    episodeNumber: number,
    originalStoryText: string,
    beat: StoryBeatJson,
    diagnosis: EpisodeQaDiagnosis,
  ): Promise<string> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();

    const issuesJson = JSON.stringify(diagnosis.issues, null, 2);
    const beatJson = JSON.stringify(beat, null, 2);

    const userMsg = `请修复以下第 ${episodeNumber} 集的故事文本。

【原始节拍规划 (story_beat_json)】
${beatJson}

【QA 错误报告 (qa_issues)】
${issuesJson}

【有问题的故事文本 (storyText)】
${originalStoryText}

请仅针对 QA 错误报告中指出的问题进行最小化修复，保持原文风格和正确部分不变。只输出修复后的纯故事文本。`;

    const promptChars = AUTO_REWRITE_SYSTEM_PROMPT.length + userMsg.length;
    this.logger.log(
      `[episode-story][auto-rewrite] ep=${episodeNumber} issueCount=${diagnosis.issues.length} promptChars=${promptChars}`,
    );

    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.3,
      messages: [
        { role: 'system', content: AUTO_REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    const raw = await res.text();
    this.logger.log(
      `[episode-story][auto-rewrite] ep=${episodeNumber} status=${res.status} rawPreview=${raw.trim().slice(0, 300)}`,
    );
    if (!res.ok) {
      this.logger.warn(
        `[episode-story][auto-rewrite] ep=${episodeNumber} request failed: ${res.status}`,
      );
      throw new BadRequestException(
        `Auto-rewrite request failed for ep=${episodeNumber}: ${res.status}`,
      );
    }

    const content = this.extractModelContent(raw);
    const rewritten = content.trim();

    if (rewritten.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE) {
      this.logger.warn(
        `[episode-story][auto-rewrite] ep=${episodeNumber} rewritten text too short: ${rewritten.length}`,
      );
      throw new BadRequestException(
        `Auto-rewrite returned too-short text for ep=${episodeNumber}`,
      );
    }

    this.logger.log(
      `[episode-story][auto-rewrite] ep=${episodeNumber} originalLen=${originalStoryText.length} rewrittenLen=${rewritten.length}`,
    );
    return rewritten;
  }

  /**
   * P3: 对单集执行"诊断 → 自动重写 → 再诊断"循环。
   * 最多重试 AUTO_REWRITE_MAX_RETRIES 次。
   * 返回最终的 storyText（可能是原始的，也可能是重写后的）和诊断结果。
   */
  private async autoRewriteIfNeeded(
    modelKey: string,
    episodeNumber: number,
    storyText: string,
    beat: StoryBeatJson,
  ): Promise<{
    finalStoryText: string;
    wasRewritten: boolean;
    rewriteAttempts: number;
    finalDiagnosis: EpisodeQaDiagnosis;
  }> {
    let currentText = storyText;
    let diagnosis = this.diagnoseEpisode(episodeNumber, currentText);
    let attempts = 0;
    let wasRewritten = false;

    while (diagnosis.needsRewrite && attempts < AUTO_REWRITE_MAX_RETRIES) {
      attempts++;
      this.logger.log(
        `[episode-story][auto-rewrite-loop] ep=${episodeNumber} attempt=${attempts}/${AUTO_REWRITE_MAX_RETRIES} issues=${diagnosis.issues.filter((i) => i.severity === 'high').map((i) => i.type).join(',')}`,
      );

      try {
        const rewritten = await this.runAutoRewrite(
          modelKey,
          episodeNumber,
          currentText,
          beat,
          diagnosis,
        );
        currentText = rewritten;
        wasRewritten = true;

        diagnosis = this.diagnoseEpisode(episodeNumber, currentText);

        if (!diagnosis.needsRewrite) {
          this.logger.log(
            `[episode-story][auto-rewrite-loop] ep=${episodeNumber} FIXED after attempt=${attempts}`,
          );
        } else {
          this.logger.warn(
            `[episode-story][auto-rewrite-loop] ep=${episodeNumber} still has issues after attempt=${attempts}: ${diagnosis.issues.filter((i) => i.severity === 'high').map((i) => i.type).join(',')}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[episode-story][auto-rewrite-loop] ep=${episodeNumber} rewrite attempt=${attempts} failed: ${err}`,
        );
        break;
      }
    }

    if (diagnosis.needsRewrite && attempts >= AUTO_REWRITE_MAX_RETRIES) {
      this.logger.warn(
        `[episode-story][auto-rewrite-loop] ep=${episodeNumber} exhausted ${AUTO_REWRITE_MAX_RETRIES} retries, still has high issues`,
      );
    }

    return {
      finalStoryText: currentText,
      wasRewritten,
      rewriteAttempts: attempts,
      finalDiagnosis: diagnosis,
    };
  }

  /** @deprecated P1 legacy writer — 保留用于 fallback */
  private async runWriterBatch(
    modelKey: string,
    novelId: number,
    batch: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[],
    plan: { episodeNumber: number; title?: string; summary?: string; storyBeat?: string }[],
    prevTail: string,
    prevSummary: string,
    contextBlock: string,
    userInstruction?: string,
    batchIndex?: number,
    totalBatches?: number,
  ): Promise<EpisodeStoryDraft['episodes']> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const batchPlan = JSON.stringify(batch, null, 2);
    const continuityBlock = prevTail
      ? `上一批最后一集结尾片段（用于衔接）：\n${prevTail}\n\n${prevSummary ? `（上集摘要：${prevSummary}）\n\n` : ''}`
      : '';
    const userMsg = `${continuityBlock}本批为可拍短剧单元，请按下方规划生成本批每集的 storyText。\n\n本批规划：\n${batchPlan}\n\n参考上下文（节选，已按本批集数过滤）：\n${contextBlock.slice(0, 30000)}\n\n${userInstruction ? `用户要求：${userInstruction}` : ''}`;
    const endingGuardBlock = this.buildEndingGuardInstruction(batch);
    const systemMsg = `你是短剧故事正文写作助手。本批输出的是 **60秒或90秒可拍短剧故事单元**，不是剧情简介、不是总结、不是提纲。根据本批每集的规划（title、summary、storyBeat），生成每集的 storyText，且必须兑现 storyBeat 中的开钩/冲突/反转/尾钩，不允许只参考不落实。

【必须遵守】
1. 每集 = 60秒可拍短剧单元（默认），建议 360–520 中文字；若为 90 秒则适当放长。禁止写成剧情简介、总结、提纲。
2. 全文必须由沈照以第一人称「我」持续叙述。前两句必须自然出现「我」；主句式以「我看到/我意识到/我不能/我必须/我原以为/我没想到/我当即/我只好/我知道」等为主。禁止第三人称简介、百科式、梗概式说明；读起来像旁白口播。
3. 开头前 3 句内必须出现一个强钩子：直接危险、直接冲突、直接揭露秘密、或直接反杀前奏。
4. 15 秒内（约前 100 字内）必须出现冲突升级或局势变化。
5. 中段必须出现一次明确反转/误判修正/新信息揭露。
6. 结尾必须是事件型尾钩（已发生或即将发生的事件），不能只是抽象感慨或空问句。优先：密折落谁手、某人现身、诏令下达、城门被打开、将领倒戈、内奸暴露等；禁止仅用「风暴将至」「暗流涌动」「局势紧张」或连续多集只用「谁会……？」「会不会……？」收尾。
7. 单集只围绕一个核心目标推进，避免东拉西扯。
8. 叙述必须偏可视化动作推进，少写大段解释型历史背景。
9. 本项目改写目标（rewrite_goal）：沈照改写靖难之役，建文帝守住江山，朱棣不能按历史成功夺位。结局不得出现朱棣攻破南京、建文朝覆灭、建文帝失败、历史未被改写等跑偏内容。${endingGuardBlock}

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
        normalizedStoryText.trim().length >= MIN_STORY_TEXT_LENGTH_ABSOLUTE &&
        normalizedStoryText.trim() !== placeholderStr;
      if (!isValid) {
        invalidStoryTextCount += 1;
      } else {
        out.push({
          episodeNumber: epNum,
          title: one.title ?? batch[i]?.title,
          summary: one.summary ?? batch[i]?.summary,
          storyText: normalizedStoryText,
          storyBeat: batch[i]?.storyBeat,
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
        score -= 10;
      } else if (ep.storyText.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE) {
        issues.push({ type: 'too_short', message: '正文过短', severity: 'high' });
        score -= 8;
      } else {
        const ev = this.evaluateStoryTextForShortDrama(ep.episodeNumber, ep.storyText);
        if (ev.charCount < MIN_NARRATION_CHARS_STRONG) {
          issues.push({ type: 'narration_too_short', message: `字数不足 ${MIN_NARRATION_CHARS_STRONG} 字，不足以支撑可拍短剧`, severity: 'high' });
          score -= 8;
        }
        if (ev.thirdPersonSummaryRisk || !ev.firstPersonLeadOk) {
          issues.push({ type: 'third_person_summary', message: '第一人称旁白不足或第三人称摘要化', severity: 'high' });
          score -= 5;
        }
        if (ev.eventDensitySeverelyLow) {
          issues.push({ type: 'event_density_low', message: '动作事件密度严重不足，更接近梗概', severity: 'high' });
          score -= 6;
        }
        if (ep.episodeNumber < 59 && ev.severeWeakHook) {
          issues.push({ type: 'weak_hook', message: '结尾钩子过于空泛', severity: 'high' });
          score -= 5;
        }
        if (ep.episodeNumber < 59 && ev.questionHookOnly) {
          issues.push({ type: 'weak_hook', message: '结尾仅问句钩子、缺少事件型尾钩', severity: 'high' });
          score -= 4;
        }
        if (ep.episodeNumber >= 59 && ev.endingClosureMissing) {
          issues.push({ type: 'ending_closure_missing', message: '终局阶段缺少明确收束', severity: 'high' });
          score -= 8;
        }
        if (ev.rewriteGoalViolation) {
          issues.push({ type: 'rewrite_goal_violation', message: '与改写目标不符', severity: 'high' });
          score -= 10;
        }
      }
      if (issues.length) episodeIssues.push({ episodeNumber: ep.episodeNumber, issues });
    }
    const overallScore = Math.max(0, Math.min(100, score));
    const passed = overallScore >= 60 && !episodeIssues.some((e) => e.issues.some((i) => i.severity === 'high'));
    return {
      overallScore,
      passed,
      episodeIssues,
      suggestions: passed ? [] : [{ suggestion: '建议根据逐集问题修订后再写入；存在 high 严重度问题时禁止写库。' }],
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
