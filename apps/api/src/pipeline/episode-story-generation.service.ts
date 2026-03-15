import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  EpisodeStrongConflictAudit,
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

/** 强冲突审计：对手正在实施的具体动作（敌方角色/势力在做的事） */
const ANTAGONIST_ACTION_PATTERNS = /调兵|夜袭|密会|截信|陷害|逼宫|开城门|倒戈|传假旨|围攻|伏击|收买|刺探|下毒|夺门|献城|叛变|里应外合|调开守军|假传圣旨|暗中勾结|金川门.*开|放燕军|献城门/;
/** 强冲突审计：主角反制（可拍动作：设局、拦截、揭穿、调兵、抓捕等） */
const PROTAGONIST_COUNTERACTION_PATTERNS = /设局|拦截|揭发|调兵|布防|对质|审问|抓捕|反情报|换防|封门|搜|查|夺下|伏击|密会|呈报|拆开密折|调动援军|拦下|堵住|识破|将计就计|先发制人|拿下|控制|稳住|清剿|肃清/;
/** 强冲突审计：单集转折（中后段局势变化、身份揭露、计划失效、反转） */
const REVERSAL_PATTERNS = /身份揭露|计划失效|局势反转|倒戈|证据曝光|真相大白|反水|败露|失守|逆转|原来.*竟是|没想到|不料|竟然|突然.*发现|被识破|计划落空|功亏一篑|峰回路转|柳暗花明|局势陡变|形势急转/;
/** 泛化冲突伪达标：仅这些不能视为强冲突达标 */
const WEAK_FAKE_CONFLICT_PATTERNS = /收到情报|安排部署|气氛紧张|上奏密折|加强戒备|汇报|部署|告知|观察|怀疑|准备|警觉/;
/** 实打实冲突动作：至少需有此类才不算“伪达标” */
const STRONG_CONFLICT_ACTION_PATTERNS = /对撞|阻拦|抓捕|揭发|对质|设局|追踪|交锋|诱敌|反制|伏击|夺下|审问|控制|拿下|识破|将计就计|先发制人|清剿|肃清|堵住|拦下/;
/** 空泛尾句黑名单：非终局集结尾仅这些不视为有效 hook */
const WEAK_TAIL_PHRASES = /加强戒备|风雨欲来|我心中一沉|我知道更大的危机要来了|夜色更深了|夜色沉沉|事情不妙|更大的危机|暗流涌动|风暴将至/;
/** 第三轮：终局仍开环/继续预警 */
const ENDING_OPEN_LOOP_PATTERNS = /下一场风暴|更深层的威胁|更大的危机还在后面|只是开始|还远未结束|真正的考验才刚开始|下一步仍需警戒|还有更可怕的敌人|更深的阴谋正在逼近/;

/** P2: 执行块 — 导演执行谱，每块至少包含必须呈现与禁止项 */
interface ExecutionBlockJson {
  block_no: number;
  purpose: string;
  must_show: string[];
  forbidden: string[];
}

/** P2: 终局收束（仅 59-61 集） */
interface EndingClosureJson {
  required: boolean;
  required_outcome: string[];
}

/** P2: Beat Planner 输出的结构化节拍规划（策划说明 + 执行谱） */
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
      hook_type: 'event_cliffhanger' | 'new_mystery' | 'character_in_danger' | 'goal_achieved_new_problem' | 'closure_aftermath';
    };
  };
  /** 导演执行谱：至少 4 块 hook / conflict / reversal / climax_tail，每块 must_show / forbidden */
  execution_blocks?: ExecutionBlockJson[];
  /** 终局集(59-61)必填：required=true, required_outcome 至少含 守住南京、稳住朝局、叛党被清/内奸伏法、建文帝权力稳固 */
  ending_closure?: EndingClosureJson;
  production_elements: {
    key_characters: string[];
    key_locations: string[];
    key_props: string[];
  };
  /** 多模态扩展预留：本集涉及的视觉形象档案（人物/场景/道具），供未来图像生成使用 */
  visual_profiles?: {
    profile_type: 'character' | 'location' | 'prop';
    name: string;
    visual_description?: string;
    style_tags?: string[];
  }[];
}

/** P2: Beat Planner 的 System Prompt */
const BEAT_PLANNER_SYSTEM_PROMPT = `### ROLE: Short-Drama Beat Planner（策划 + 导演执行谱）

你为历史改写题材短剧规划每集的「故事节拍」与「执行块」。证据包中已包含本集专属的 episodeGoal、visualAnchors、forbiddenDirections、continuity。输出须严格符合下方 JSON Schema。

### OUTPUT JSON Schema（每集一个对象，最终输出为数组）

每集必须包含 episode_meta、pacing_structure、execution_blocks、production_elements。若本批含第 59/60/61 集，则该集还须包含 ending_closure。

{
  "episode_meta": {
    "episode_number": <integer>,
    "title": "<本集标题>",
    "summary": "<一句话概述本集核心情节>",
    "single_goal": "<本集唯一、可衡量的核心目标，与证据包 episodeGoal 一致>",
    "antagonist_goal": "<本集核心对手的冲突性目标>",
    "theme_expression": "<本集如何体现或推进某条核心设定/爽点线>"
  },
  "pacing_structure": {
    "target_duration_seconds": 60,
    "estimated_word_count": 400,
    "hook_3s": { "description": "<具体、可视化开篇事件>", "hook_type": "<visual_shock|suspenseful_question|action_start|dramatic_reveal>" },
    "conflict_15s": { "description": "<15秒内冲突引入>", "protagonist_action": "<具体行动>", "antagonist_reaction": "<直接反应>" },
    "mid_reversal": { "description": "<中段明确转折>", "reversal_type": "<power_dynamic_shift|information_reveal|ally_betrayal|plan_failure|unexpected_ally>" },
    "climax": { "description": "<最高潮对抗>", "outcome": "<直接结果>" },
    "tail_hook": {
      "description": "<结尾：非终局集=具体未解决事件型悬念；59-61集=仅允许「胜局后余震」或「收束后余味」>",
      "hook_type": "<event_cliffhanger|new_mystery|character_in_danger|goal_achieved_new_problem|closure_aftermath>"
    }
  },
  "execution_blocks": [
    { "block_no": 1, "purpose": "hook", "must_show": ["<必须出现的具体画面/动作>"], "forbidden": ["<禁止的写法>"] },
    { "block_no": 2, "purpose": "conflict", "must_show": [], "forbidden": [] },
    { "block_no": 3, "purpose": "reversal", "must_show": [], "forbidden": [] },
    { "block_no": 4, "purpose": "climax_tail", "must_show": [], "forbidden": [] }
  ],
  "ending_closure": "仅当 episode_meta.episode_number 为 59、60 或 61 时必填，见下方说明",
  "production_elements": {
    "key_characters": ["<本集出场核心人物>"],
    "key_locations": ["<本集关键场景>"],
    "key_props": ["<本集关键道具>"]
  }
}

**ending_closure（仅 59/60/61 集）**：
{
  "required": true,
  "required_outcome": ["守住南京", "稳住朝局", "叛党被清或内奸伏法", "建文帝权力稳固"]
}

### CORE INSTRUCTIONS

1. [Define the Core]: 用证据包中的 episodeGoal、character_context 定义 single_goal；用 visualAnchors 约束 must_show。
2. [Execution Blocks]: 至少 4 块：hook / conflict / reversal / climax_tail。每块 must_show 写清「必须拍出的具体动作/画面」，forbidden 写清「禁止仅用心理句、总结句替代」。
3. [强冲突四要素——每集必含]: 每集规划必须可定位以下四项，否则 Writer 无法稳定产出强冲突正文：
   - **antagonist_action**：conflict_15s.antagonist_reaction 必须写清「本集对手/敌方正在做的一件具体事」（如调兵、夜袭、陷害、倒戈、开城门、截信等），禁止仅写「搅动朝局」「威胁稳固」等泛表述。
   - **protagonist_counteraction**：conflict_15s.protagonist_action 必须写清「主角对本集对手动作的具体反制」（如设局、拦截、揭发、对质、调兵布防、抓捕等），禁止仅写「决定应对」「提高警惕」。
   - **reversal**：mid_reversal.description 必须写清「中后段的一个明确转折」（身份揭露、计划失效、证据曝光、局势反转、某人反水等），禁止仅写「又收到情报」「气氛紧张」。
   - **end_hook**：tail_hook.description 必须写清「结尾的具体悬念或风险升级」（具体人/物/时点），非终局集禁止仅写「夜色沉沉」「事情不妙」。
   execution_blocks 中 purpose=conflict 的块 must_show 至少 1 条与「对手动作」相关、1 条与「主角反制」相关；purpose=reversal 的块 must_show 至少 1 条与「转折事件」相关；purpose=climax_tail 的块 must_show 至少 1 条与「结尾钩子」相关。
4. [Finale Mode 59-61]: 若本集为第 59、60 或 61 集，必须输出 ending_closure.required=true，required_outcome 至少包含：守住南京、稳住朝局、叛党被清/内奸伏法、建文帝权力稳固。tail_hook 只能是「胜局后的最后余震」或「收束后的余味」，禁止普通大开环尾钩（如「还有更大阴谋」「真正的考验才刚开始」）。
5. [Tail Hook]: 非终局集 = 具体事件型悬念；终局集 = 仅 closure_aftermath 或收束余味。

### MUST_SHOW 具体化约束（重要）

execution_blocks 中的每个 must_show 条目必须满足以下要求：
- 必须包含【具体人名】或【具体物件/道具】或【具体地点】
- 必须包含【具体动作动词】（如：递、交、送、入殿、跪、传旨、搜、查、抓、拦、换防、布防、调兵、夜袭、设伏、开门、封门、揭发、审问、对质、焚毁、夺下、伏击、密会、呈报、拆开、调动）
- 禁止填入抽象描述（如：「局势紧张」「氛围凝重」「危机四伏」「暗流涌动」「形势严峻」）
- 示例正确写法：「沈照将密折递给齐泰」「李景隆跪在殿外请罪」「内侍打开金川门」
- 示例错误写法：「局势变得紧张」「主角陷入危机」「氛围凝重」

### 能力边界检查

single_goal 必须符合证据包中 temporalContext.currentPowerLevel.abilityBoundary 定义的能力边界：
- 若当前 abilityBoundary 为「仅能影响局部决策」，则 single_goal 不可涉及「改变整体战局」「调动全国兵力」等超出边界的行为
- 若当前 abilityBoundary 为「可影响朝堂决策」，则 single_goal 可涉及朝堂层面但不可涉及「直接指挥军队作战」等超出边界的行为

### CONSTRAINTS

- 所有节拍与 must_show 必须是具体、可视化的动作/事件，禁止抽象描述。
- 输出为严格 JSON 数组，每项为一集 story_beat_json。不要 markdown、不要解释。
- 必须遵守证据包中的 forbiddenDirections（含改写目标与终局禁止项）。
- 本项目改写目标：沈照改写靖难之役，建文帝守住江山，朱棣不能按历史成功夺位。`;

/** P2: 按谱填词的 Writer System Prompt */
const P2_WRITER_SYSTEM_PROMPT = `### ROLE: Short-Drama Script Executor（按执行块逐块写）

你的任务是将 story_beat_json（含 pacing_structure 与 execution_blocks）忠实地扩写成可拍摄的 60/90 秒短剧故事正文 (storyText)。必须按 execution_blocks 顺序展开，每个 block 至少落成一段具体动作，禁止用心理句/总结句替代 must_show。

### EXECUTION PROCESS

1. [Internalize]: 读懂每集的 episode_meta、pacing_structure、execution_blocks；若有 ending_closure，则终局集最后一段必须兑现 required_outcome。
2. [Write Block by Block]: 严格按 execution_blocks 顺序写：
   - block 1 (hook): 将 hook_3s + 该块 must_show 写成开篇具体画面/动作，不得用概括句替代。【约 60-80 字】
   - block 2 (conflict): 将 conflict_15s + must_show 写成具体交锋，禁止只写「局势紧张」。【约 100-130 字】
   - block 3 (reversal): 将 mid_reversal + must_show 写成具体转折事件。【约 80-100 字】
   - block 4 (climax_tail): 将 climax 与 tail_hook + must_show 写成高潮与结尾。若该集有 ending_closure，则最后一段必须明确写出：南京是否守住、朝局是否稳住、叛党/内奸是否被清、建文帝是否稳住皇权。【约 120-160 字】
3. [Must-Show Pixel-Level Fulfillment]: 每个 execution_block 的 must_show 列表中的每一项，必须在正文中有对应的一句或一段具体描写：
   - 每一项 must_show 必须被转化为至少一句包含【具体动作动词】（递/交/送/入殿/跪/传旨/搜/查/抓/揭发/审问/对质/焚毁/夺下/伏击/密会/呈报等）的描写
   - 禁止用「我意识到」「局势变得」「形势紧张」等心理/总结句替代 must_show
   - 逐一检查：若 must_show 有 3 项，正文中必须有 3 段对应的具体动作描写，缺一不可
4. [Finale 59-61]: 若 episode_number 为 59、60 或 61，结尾必须写清：守住南京、稳住朝局、叛党/内奸被清、建文帝权力稳固；禁止使用普通大开环尾钩（如「还有更大阴谋」「真正的考验才刚开始」）。

### SHOW, DON'T TELL 量化约束（严格遵守）

1. 全文至少包含 5 个不同的【具体动作动词】（递/交/送/入殿/跪/传旨/搜/查/抓/拦/换防/布防/调兵/夜袭/设伏/开门/封门/揭发/审问/对质/焚毁/夺下/伏击/密会/呈报/拆开/调动等）
2. 全文中【心理摘要词】（我知道/我意识到/我明白/我必须/我不能/我决定/我感到/我深知）不得超过 2 次
3. 禁止连续 2 句以上使用心理/感受描写，中间必须插入具体动作或对话
4. 每个 block 必须至少包含 1 个具体的人物动作（非心理活动）

### 强冲突四要素（正文必须落出，缺一不可）

1. **对手在做什么**：正文必须写出至少一处敌方/对手正在实施的具体动作（调兵、夜袭、陷害、倒戈、开城门、截信等），禁止仅用「收到情报」「局势紧张」「敌军有阴谋」冒充。
2. **主角怎么反制**：正文必须写出至少一处主角对对手动作的具体反制（设局、拦截、揭发、对质、调兵布防、抓捕等），禁止仅用「安排部署」「我决定小心」「提高警惕」等概括。
3. **中段转折**：正文中后段必须出现明确局势变化（身份揭露、计划失效、证据曝光、某人反水等），禁止仅用「又收到一封密报」式信息追加。
4. **结尾钩子**：非终局集结尾须写出具体事件型悬念或风险升级（具体人/物/时点），禁止仅用「夜色沉沉」「我意识到事情不妙」收尾。

### ABSOLUTE COMMANDMENTS

1. 每集 360–520 中文字，60 秒可拍单元。禁止剧情简介、总结、提纲。
2. 全文沈照第一人称「我」叙述，前两句必须出现「我」。
3. 绝不偏离 story_beat_json 的节拍与 execution_blocks 的 must_show；禁止用总结句替代具体动作。
4. Show, Don't Tell：写具体动作、表情、环境，不写「主角陷入危机」这类概括。
5. 严格按 hook_3s -> conflict_15s -> mid_reversal -> climax -> tail_hook（即 execution_blocks 顺序）组织正文。
6. 非终局集结尾=事件型尾钩；终局集(59-61)=收束结果+禁止大开环。
7. 改写目标：建文帝守住江山，朱棣不能成功夺位。禁止朱棣攻破南京、建文朝覆灭等。

只输出严格 JSON 数组，每项含 episodeNumber、title、summary、storyText。不要 markdown 和解释。`;

/** P3: 自动重写最大重试次数 */
const AUTO_REWRITE_MAX_RETRIES = 2;

/** P3: 自动重写代理的 System Prompt */
const AUTO_REWRITE_SYSTEM_PROMPT = `### ROLE: Short-Drama Script Doctor

你根据 QA 报告修复未达标的 storyText。若问题包含 rewrite_goal_violation 或 ending_closure_missing，允许对结尾 30% 做结构性重写，而非仅做最小字面修补。

### INPUT
1. **story_beat_json**：修复后须符合其节拍与 execution_blocks；若含 ending_closure，须兑现 required_outcome。
2. **storyText**：待修复的正文。
3. **qa_issues**：错误列表。
4. **user_feedback**（可选）：用户对本集的修改意见，若提供则优先参考。

### REPAIR RULES

- **narration_too_short**：补充具体动作、环境、对话，达到 360-520 字。
- **third_person_summary**：改为沈照第一人称「我」，前两句出现「我」。
- **event_density_low**：用具体动作事件（递、交、送、入殿、跪、传旨、搜、查、抓、揭发、审问等）替换心理/总结句。
- **weak_hook / severe_weak_hook**：结尾改为具体事件型尾钩（人名/物件/时间点）。
- **question_hook_only**：在问句前后补具体已发生或即将发生的事件。
- **rewrite_goal_violation**：禁止最小修补。允许对结尾 30% 做结构性重写，删除或改写「朱棣攻破南京」「建文朝覆灭」等，确保建文帝守住江山。
- **ending_closure_missing**：禁止最小修补。若 story_beat_json 含 ending_closure，必须优先兑现 required_outcome（守住南京、稳住朝局、叛党/内奸被清、建文帝权力稳固）；允许重写结尾 30% 以明确收束结果。
- **antagonist_action_missing**：必须增加至少一处敌方/对手正在实施的具体威胁动作（如调兵、夜袭、陷害、倒戈、开城门、截信等），禁止仅用「局势紧张」「敌军有阴谋」等泛表述。
- **protagonist_counteraction_missing**：必须增加至少一处主角对对手动作的具体反制（设局、拦截、揭发、对质、抓捕、调兵布防等），禁止仅用「我意识到」「我决定小心」等心理句。
- **reversal_missing**：必须在中后段补出一个明确转折（身份揭露、计划失效、证据曝光、局势反转、某人反水等），禁止仅用「又收到一封密报」式信息追加。
- **end_hook_missing**：必须重写结尾，写出具体事件型悬念或风险升级（具体人/物/时点），禁止仅用「夜色沉沉」「我意识到事情不妙」等空泛收尾。
- **conflict_intensity_low**：须同时补足对手动作、主角反制、单集转折、结尾钩子中缺失的项，使四要素至少三项达标。
- **user_feedback**：用户反馈优先级最高。根据用户具体意见进行修改，同时确保不违反 story_beat_json 的核心节拍与改写目标。

### STRUCTURAL REWRITE（当 qa_issues 含 rewrite_goal_violation、ending_closure_missing 或强冲突类问题）
- **终局/改写目标**：可对全文最后约 30% 进行结构性重写；终局集(59-61)须兑现 ending_closure.required_outcome。
- **强冲突补戏**：当含 antagonist_action_missing、protagonist_counteraction_missing、reversal_missing、end_hook_missing、conflict_intensity_low 时，必须补「戏核」——补出对手动作、主角反制、中后段转折、结尾钩子中缺失的项，允许对冲突段与结尾段做结构性增写，而非只改一两句。

### ABSOLUTE COMMANDMENTS
1. 沈照第一人称「我」；360-520 字。
2. 符合 story_beat_json 的节拍与 execution_blocks；若有 ending_closure 必须兑现。
3. 改写目标：建文帝守住江山，朱棣不能成功夺位。
4. 若有 user_feedback，优先满足用户意见，但不得违反改写目标。

### OUTPUT
只输出修复后的纯故事文本，不要 JSON、不要 markdown、不要解释。`;

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
    /** 结构化衔接：上一批最后一集的核心冲突状态 */
    let prevConflictState = '';
    /** 结构化衔接：上一批最后一集的未竟悬念 */
    let prevUnresolvedSuspense = '';

    for (let i = 0; i < beatBatches.length; i++) {
      const batch = beatBatches[i];
      const startEp = batch[0]?.episodeNumber ?? i * batchSize + 1;
      const endEp = batch[batch.length - 1]?.episodeNumber ?? startEp + batch.length - 1;
      this.logger.log(
        `[episode-story][generateDraft] batch ${i + 1}/${beatBatches.length} startEp=${startEp} endEp=${endEp} calling runBeatPlanner`,
      );

      const beats = await this.runBeatPlanner(
        usedModelKey,
        novelId,
        batch,
        prevTailBeat,
      );

      this.logger.log(
        `[episode-story][generateDraft] batch ${i + 1}/${beatBatches.length} startEp=${startEp} endEp=${endEp} calling runP2WriterBatch`,
      );
      const batchDraft = await this.runP2WriterBatch(
        usedModelKey,
        novelId,
        beats,
        prevTail,
        prevSummary,
        prevConflictState,
        prevUnresolvedSuspense,
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
          const issueTypes = rewriteResult.finalDiagnosis.issues
            .filter((i) => i.severity === 'high')
            .map((i) => i.type)
            .join('、');
          warnings.push(
            `第${ep.episodeNumber}集：自动重写 ${rewriteResult.rewriteAttempts} 次后仍有问题（${issueTypes}），建议人工审阅。`,
          );
          this.logger.error(
            `[episode-story][generateDraft] ep=${ep.episodeNumber} still needsRewrite after ${rewriteResult.rewriteAttempts} attempts. issues=${JSON.stringify(rewriteResult.finalDiagnosis.issues)}`,
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
        // 从上一批最后一集的 beat 中提取结构化衔接信息
        const lastBeat = beats[beats.length - 1];
        prevConflictState = this.extractConflictStateFromBeat(lastBeat);
        prevUnresolvedSuspense = this.extractUnresolvedSuspenseFromBeat(lastBeat);
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
    /** 强冲突审计：正文是否包含至少一处对手正在实施的动作 */
    antagonistActionOk: boolean;
    /** 强冲突审计：正文是否包含至少一处主角反制动作 */
    protagonistCounteractionOk: boolean;
    /** 强冲突审计：正文中后段是否包含至少一处单集转折 */
    reversalOk: boolean;
    /** 强冲突审计：结尾是否有明确钩子（非终局集要求具体/事件型尾钩） */
    endHookOk: boolean;
    /** 强冲突审计：四要素缺失≥2 则视为冲突强度不足 */
    conflictIntensityLow: boolean;
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

    const antagonistActionHit = ANTAGONIST_ACTION_PATTERNS.test(trimmed);
    const protagonistCounteractionHit = PROTAGONIST_COUNTERACTION_PATTERNS.test(trimmed);
    const reversalHit = REVERSAL_PATTERNS.test(trimmed);
    const strongConflictActionHitCount = (trimmed.match(STRONG_CONFLICT_ACTION_PATTERNS) || []).length;
    const weakFakeConflictHitCount = (trimmed.match(WEAK_FAKE_CONFLICT_PATTERNS) || []).length;
    const hasStrongAction = strongConflictActionHitCount >= 1;
    const antagonistActionOk = antagonistActionHit && hasStrongAction;
    const protagonistCounteractionOk = protagonistCounteractionHit && hasStrongAction;
    const reversalOk = reversalHit;
    let endHookOk =
      episodeNumber >= 59 || (!severeWeakHook && (concreteHookOk || eventHookOk));
    if (episodeNumber < 59 && endHookOk) {
      const tailForWeak = trimmed.slice(-80);
      if (WEAK_TAIL_PHRASES.test(tailForWeak) && tailSpecificEntityCount === 0 && !eventHookHit) {
        endHookOk = false;
      }
    }
    let conflictOkCount = [antagonistActionOk, protagonistCounteractionOk, reversalOk, endHookOk].filter(Boolean).length;
    let conflictIntensityLow = conflictOkCount < 3;
    if (!hasStrongAction && (antagonistActionHit || protagonistCounteractionHit || weakFakeConflictHitCount >= 2)) {
      conflictIntensityLow = true;
    }
    if (!antagonistActionOk) {
      warnings.push(`第${episodeNumber}集：缺少明确对手动作（如敌方调兵/夜袭/陷害/倒戈等），建议写出具体敌方正在做的事。`);
    }
    if (!protagonistCounteractionOk) {
      warnings.push(`第${episodeNumber}集：缺少主角反制动作（如设局/揭发/拦截/对质/抓捕等），建议写出主角的具体应对。`);
    }
    if (!reversalOk) {
      warnings.push(`第${episodeNumber}集：缺少单集转折（如身份揭露/计划失效/局势反转/证据曝光等），建议中后段有明确局势变化。`);
    }
    if (!endHookOk && episodeNumber < 59) {
      warnings.push(`第${episodeNumber}集：结尾缺少明确钩子，建议写出具体事件型悬念或风险升级。`);
    }
    if (conflictIntensityLow) {
      warnings.push(`第${episodeNumber}集：强冲突四要素不足（对手动作/主角反制/转折/尾钩中仅${conflictOkCount}项达标），短剧爆点偏弱。`);
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
      antagonistActionOk,
      protagonistCounteractionOk,
      reversalOk,
      endHookOk,
      conflictIntensityLow,
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
        // 非终局集：严格检查尾钩质量
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
      // 59-60 集：仍需检查尾钩（仅最终集 61 可豁免尾钩检查）
      if (epNum >= 59 && epNum < 61) {
        if (ev.severeWeakHook && !ev.endingClosureMissing) {
          this.logger.warn(
            `[episode-story][persist][quality-block] episode=${epNum} reason=severe_weak_hook_in_finale_segment`,
          );
          throw new BadRequestException(
            `第${epNum}集 属终局段但结尾钩子过于空泛，需要具体的收束结果或事件型悬念。Persist blocked.`,
          );
        }
        // 终局段增加 endingClosureWeak 拦截
        if (ev.endingClosureWeak) {
          this.logger.warn(
            `[episode-story][persist][quality-block] episode=${epNum} reason=ending_closure_weak`,
          );
          throw new BadRequestException(
            `第${epNum}集 已进入终局段，但正文仍以继续预警/铺悬念为主，缺少终局收束。Persist blocked.`,
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
      if (!ev.antagonistActionOk) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=antagonist_action_missing`,
        );
        throw new BadRequestException(
          `第${epNum}集 缺少明确对手动作（须写出敌方正在实施的具体动作，如调兵/夜袭/陷害/倒戈等）。Persist blocked.`,
        );
      }
      if (!ev.protagonistCounteractionOk) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=protagonist_counteraction_missing`,
        );
        throw new BadRequestException(
          `第${epNum}集 缺少主角反制动作（须写出主角的具体应对，如设局/揭发/拦截/对质/抓捕等）。Persist blocked.`,
        );
      }
      if (!ev.reversalOk) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=reversal_missing`,
        );
        throw new BadRequestException(
          `第${epNum}集 缺少单集转折（中后段须有明确局势变化/身份揭露/计划失效等）。Persist blocked.`,
        );
      }
      if (epNum < 59 && !ev.endHookOk) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=end_hook_missing`,
        );
        throw new BadRequestException(
          `第${epNum}集 结尾缺少明确钩子（须写出具体事件型悬念或风险升级）。Persist blocked.`,
        );
      }
      if (ev.conflictIntensityLow) {
        this.logger.warn(
          `[episode-story][persist][quality-block] episode=${epNum} reason=conflict_intensity_low`,
        );
        throw new BadRequestException(
          `第${epNum}集 强冲突四要素不足（对手动作/主角反制/转折/尾钩须至少达标三项），短剧爆点偏弱。Persist blocked.`,
        );
      }
    }
  }

  async check(novelId: number, dto: EpisodeStoryCheckDto): Promise<StoryCheckReportDto> {
    await this.assertNovelExists(novelId);
    let draft: EpisodeStoryDraft | null = null;
    let draftSource: 'draft-cache' | 'payload-draft' | 'versionIds' | null = null;
    if (dto.draftId) {
      const cached = this.getCachedDraft(dto.draftId);
      if (cached) {
        if (cached.novelId !== novelId) {
          this.logger.warn(
            `[episode-story][check] draftId=${dto.draftId} novelId mismatch: cached=${cached.novelId} request=${novelId}`,
          );
          throw new BadRequestException(
            'draftId 对应的草稿属于其他剧目，与当前 novelId 不匹配。请使用本剧目的 draftId 或传 draft/versionIds。',
            'EPISODE_STORY_DRAFT_ID_NOVEL_MISMATCH',
          );
        }
        draft = cached.draft;
        draftSource = 'draft-cache';
      }
    }
    if (!draft && dto.draft?.episodes?.length) {
      draft = dto.draft;
      draftSource = 'payload-draft';
    }
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
      draftSource = 'versionIds';
    }
    if (dto.draftId && !draft) {
      this.logger.warn(`[episode-story][check] draftId=${dto.draftId} cache miss, no draft from payload/versionIds`);
      throw new BadRequestException(
        '草稿缓存已失效或不存在（可能已过期），请重新生成草稿后再检查。',
        'EPISODE_STORY_DRAFT_CACHE_MISS',
      );
    }
    if (!draft || !draft.episodes.length) {
      throw new BadRequestException('请提供 draftId、draft 或 versionIds');
    }
    this.logger.log(`[episode-story][check] novelId=${novelId} source=${draftSource} episodes=${draft.episodes.length}`);
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

  /**
   * 从 StoryBeatJson 中提取核心冲突状态，用于批次衔接。
   * 组合 single_goal + antagonist_goal + climax.outcome
   */
  private extractConflictStateFromBeat(beat: StoryBeatJson): string {
    const parts: string[] = [];
    if (beat.episode_meta?.single_goal) {
      parts.push(`主角目标：${beat.episode_meta.single_goal}`);
    }
    if (beat.episode_meta?.antagonist_goal) {
      parts.push(`对手目标：${beat.episode_meta.antagonist_goal}`);
    }
    if (beat.pacing_structure?.climax?.outcome) {
      parts.push(`本集结果：${beat.pacing_structure.climax.outcome}`);
    }
    return parts.join('；') || '';
  }

  /**
   * 从 StoryBeatJson 中提取未竟悬念，用于批次衔接。
   * 取 tail_hook.description，若为终局集则标注收束状态
   */
  private extractUnresolvedSuspenseFromBeat(beat: StoryBeatJson): string {
    const epNum = beat.episode_meta?.episode_number ?? 0;
    const tailHook = beat.pacing_structure?.tail_hook?.description ?? '';

    if (epNum >= 59 && beat.ending_closure?.required) {
      // 终局集：标注收束状态而非悬念
      const outcomes = beat.ending_closure.required_outcome ?? [];
      return outcomes.length > 0
        ? `终局收束：${outcomes.join('、')}`
        : tailHook;
    }

    return tailHook;
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
   *
   * 容错机制：
   * - JSON parse 失败时进行多轮清洗重试
   * - 仍失败则记录 raw response 到日志并生成 fallback beats
   * - 不会因单批解析失败导致整个 generateDraft 失败
   */
  private async runBeatPlanner(
    modelKey: string,
    novelId: number,
    batch: { episodeNumber: number; title?: string; summary?: string }[],
    prevTailBeat?: StoryBeatJson | null,
  ): Promise<StoryBeatJson[]> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const batchRange = `${batch[0]?.episodeNumber ?? '?'}-${batch[batch.length - 1]?.episodeNumber ?? '?'}`;

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
    this.logger.debug(`[episode-story][beat-planner] Request body preview: ${body.slice(0, 500)}`);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    const raw = await res.text();
    this.logger.log(
      `[episode-story][beat-planner][raw] status=${res.status} preview=${raw.trim().slice(0, 500)}`,
    );
    if (!res.ok) {
      this.logger.error(
        `[episode-story][beat-planner] LLM request failed: status=${res.status}, raw=${raw.slice(0, 2000)}`,
      );
      // 容错：HTTP 失败时生成 fallback beats 而不是抛异常
      this.logger.warn(
        `[episode-story][beat-planner][fallback] HTTP ${res.status} for batch=${batchRange}, generating fallback beats`,
      );
      return this.generateFallbackBeats(batch);
    }

    const content = this.extractModelContent(raw);

    // 容错解析：多轮清洗 + fallback
    const parseResult = this.safeParseBeatsJson(content, batchRange, raw);
    if (!parseResult.success) {
      this.logger.error(
        `[episode-story][beat-planner][parse-fail] batch=${batchRange} allAttemptsFailed, using fallback beats. rawLen=${raw.length}`,
      );
      // 记录完整 raw response 到日志（便于后续排查）
      // TypeScript narrowing workaround: cast to access lastError
      const errorMsg = (parseResult as { success: false; lastError: string }).lastError;
      this.logParseFailure('beat-planner', batchRange, raw, errorMsg);
      return this.generateFallbackBeats(batch);
    }

    const arr = parseResult.data;
    this.logger.debug(`[episode-story][beat-planner] Parsed beats count: ${arr.length}`);

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
        beats.push(this.createFallbackBeat(batch[i].episodeNumber, batch[i].title, batch[i].summary));
      } else {
        let beatToPush: StoryBeatJson = rawBeat;
        const episodeNumber = rawBeat.episode_meta.episode_number;
        const ps = rawBeat.pacing_structure;
        const conflict = ps?.conflict_15s;
        const antReaction = (conflict?.antagonist_reaction ?? '').trim();
        const protAction = (conflict?.protagonist_action ?? '').trim();
        const reversalDesc = (ps?.mid_reversal?.description ?? '').trim();
        const tailDesc = (ps?.tail_hook?.description ?? '').trim();
        const missing: string[] = [];
        if (antReaction.length < 4) missing.push('antagonist_reaction');
        if (protAction.length < 4) missing.push('protagonist_action');
        if (reversalDesc.length < 4) missing.push('mid_reversal');
        if (tailDesc.length < 4) missing.push('tail_hook');
        if (missing.length > 0) {
          this.logger.warn(
            `[episode-story][beat-planner][strong-conflict] ep=${episodeNumber} missing or too short: ${missing.join(',')} — Writer 可能无法稳定产出强冲突`,
          );
          const c15 = ps?.conflict_15s;
          const injectedConflict15s =
            c15 && (antReaction.length < 4 || protAction.length < 4)
              ? {
                  ...c15,
                  antagonist_reaction:
                    antReaction.length >= 4
                      ? c15.antagonist_reaction
                      : c15.antagonist_reaction || '（本集对手正在实施的具体动作，如调兵/夜袭/陷害/倒戈，须在正文中写出）',
                  protagonist_action:
                    protAction.length >= 4
                      ? c15.protagonist_action
                      : c15.protagonist_action || '（主角对本集对手动作的具体反制，如设局/揭发/拦截/对质，须在正文中写出）',
                }
              : ps?.conflict_15s;
          beatToPush = {
            ...rawBeat,
            pacing_structure: {
              ...ps!,
              ...(injectedConflict15s && { conflict_15s: injectedConflict15s }),
            },
          };
        }
        if (episodeNumber >= 59 && episodeNumber <= 61) {
          const needsBlocks =
            !beatToPush.execution_blocks || beatToPush.execution_blocks.length === 0;
          const needsClosure = !beatToPush.ending_closure;
          if (needsBlocks || needsClosure) {
            beatToPush = { ...beatToPush };
            if (needsBlocks) {
              beatToPush.execution_blocks = [
                { block_no: 1, purpose: 'hook', must_show: [], forbidden: [] },
                { block_no: 2, purpose: 'conflict', must_show: [], forbidden: [] },
                { block_no: 3, purpose: 'reversal', must_show: [], forbidden: [] },
                { block_no: 4, purpose: 'climax_tail', must_show: [], forbidden: [] },
              ];
              this.logger.log(
                `[episode-story][beat-planner][finale-fix] ep=${episodeNumber} injected execution_blocks`,
              );
            }
            if (needsClosure) {
              beatToPush.ending_closure = {
                required: true,
                required_outcome: [
                  '守住南京',
                  '稳住朝局',
                  '叛党被清或内奸伏法',
                  '建文帝权力稳固',
                ],
              };
              this.logger.log(
                `[episode-story][beat-planner][finale-fix] ep=${episodeNumber} injected ending_closure`,
              );
            }
          }
        }
        beats.push(beatToPush);
      }
    }

    this.logger.log(`[episode-story][beat-planner] parsed ${beats.length} beats`);
    return beats;
  }

  /**
   * 安全解析 beats JSON，多轮清洗尝试
   */
  private safeParseBeatsJson(
    content: string,
    batchRange: string,
    rawForLog: string,
  ): { success: true; data: unknown[] } | { success: false; lastError: string } {
    const attempts: { name: string; transform: (s: string) => string }[] = [
      { name: 'direct', transform: (s) => s },
      { name: 'strip-markdown', transform: (s) => this.stripMarkdownCodeFence(s) },
      { name: 'extract-array', transform: (s) => this.extractJsonArray(s) },
      { name: 'strip-trailing-text', transform: (s) => this.stripTrailingNonJson(this.extractJsonArray(s)) },
      { name: 'aggressive-clean', transform: (s) => this.aggressiveJsonClean(s) },
    ];

    let lastError = '';
    for (const attempt of attempts) {
      try {
        const cleaned = attempt.transform(content);
        if (!cleaned.trim()) continue;
        const parsed = JSON.parse(cleaned);
        const arr = this.extractArrayFromParsed(parsed);
        if (arr.length > 0) {
          this.logger.log(
            `[episode-story][beat-planner][parse] batch=${batchRange} success via ${attempt.name}, arrLen=${arr.length}`,
          );
          return { success: true, data: arr };
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        this.logger.debug(
          `[episode-story][beat-planner][parse] batch=${batchRange} attempt=${attempt.name} failed: ${lastError}`,
        );
      }
    }
    return { success: false, lastError };
  }

  /** 从解析结果中提取数组（兼容 { beats: [] } / { episodes: [] } / [] 等格式） */
  private extractArrayFromParsed(parsed: unknown): unknown[] {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.beats)) return obj.beats;
      if (Array.isArray(obj.episodes)) return obj.episodes;
      if (Array.isArray(obj.data)) return obj.data;
    }
    return [];
  }

  /** 清理 markdown code fence */
  private stripMarkdownCodeFence(text: string): string {
    let s = text.trim();
    // 移除 ```json ... ``` 或 ``` ... ```
    const match = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match?.[1]) s = match[1].trim();
    return s;
  }

  /** 提取首个 [ 到最后一个 ] 之间的内容 */
  private extractJsonArray(text: string): string {
    const first = text.indexOf('[');
    const last = text.lastIndexOf(']');
    if (first !== -1 && last > first) {
      return text.slice(first, last + 1);
    }
    // 尝试提取对象
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }
    return text;
  }

  /** 去掉 JSON 末尾可能混入的解释文字 */
  private stripTrailingNonJson(text: string): string {
    const trimmed = text.trim();
    // 找到最后一个 ] 或 }，截断后面的内容
    const lastBracket = trimmed.lastIndexOf(']');
    const lastBrace = trimmed.lastIndexOf('}');
    const lastValid = Math.max(lastBracket, lastBrace);
    if (lastValid > 0) {
      return trimmed.slice(0, lastValid + 1);
    }
    return trimmed;
  }

  /** 激进清洗：移除所有非 JSON 字符前缀/后缀 */
  private aggressiveJsonClean(text: string): string {
    let s = this.stripMarkdownCodeFence(text);
    s = this.extractJsonArray(s);
    s = this.stripTrailingNonJson(s);
    // 移除可能的 BOM 或特殊字符
    s = s.replace(/^\uFEFF/, '').trim();
    return s;
  }

  /** 记录解析失败的 raw response 到日志 */
  private logParseFailure(
    stage: string,
    batchRange: string,
    rawResponse: string,
    errorMsg: string,
  ): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      stage,
      batchRange,
      errorMsg,
      rawResponseLength: rawResponse.length,
      rawResponsePreview: rawResponse.slice(0, 2000),
      rawResponseTail: rawResponse.slice(-500),
    };
    this.logger.error(
      `[episode-story][${stage}][parse-fail-log] ${JSON.stringify(logEntry)}`,
    );
  }

  /** 为单集生成 fallback beat */
  private createFallbackBeat(
    episodeNumber: number,
    title?: string,
    summary?: string,
  ): StoryBeatJson {
    const isFinale = episodeNumber >= 59 && episodeNumber <= 61;
    return {
      episode_meta: {
        episode_number: episodeNumber,
        title: title ?? `第${episodeNumber}集`,
        summary: summary ?? '',
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
        tail_hook: { description: '', hook_type: isFinale ? 'closure_aftermath' : 'event_cliffhanger' },
      },
      execution_blocks: [
        { block_no: 1, purpose: 'hook', must_show: [], forbidden: [] },
        { block_no: 2, purpose: 'conflict', must_show: [], forbidden: [] },
        { block_no: 3, purpose: 'reversal', must_show: [], forbidden: [] },
        { block_no: 4, purpose: 'climax_tail', must_show: [], forbidden: [] },
      ],
      ending_closure: isFinale
        ? { required: true, required_outcome: ['守住南京', '稳住朝局', '叛党被清或内奸伏法', '建文帝权力稳固'] }
        : undefined,
      production_elements: { key_characters: [], key_locations: [], key_props: [] },
    };
  }

  /** 为整批生成 fallback beats */
  private generateFallbackBeats(
    batch: { episodeNumber: number; title?: string; summary?: string }[],
  ): StoryBeatJson[] {
    this.logger.warn(
      `[episode-story][beat-planner][fallback] generating ${batch.length} fallback beats for episodes: ${batch.map((b) => b.episodeNumber).join(',')}`,
    );
    return batch.map((b) => this.createFallbackBeat(b.episodeNumber, b.title, b.summary));
  }

  /**
   * P2: 按谱填词的 Writer — 接收结构化的 story_beat_json，生成 storyText。
   * 每批调用一次 AI，传入该批所有集的 beat 规划。
   *
   * 容错机制：
   * - 当 AI 返回条目数 > requested 时按 episodeNumber 分组去重
   * - 同一 episode 多条时选最佳（字数最接近 400 且非占位）
   * - 确保每个 requested episode 最终只产出 1 条 storyText
   */
  private async runP2WriterBatch(
    modelKey: string,
    novelId: number,
    beats: StoryBeatJson[],
    prevTail: string,
    prevSummary: string,
    prevConflictState: string,
    prevUnresolvedSuspense: string,
    batchIndex?: number,
    totalBatches?: number,
  ): Promise<EpisodeStoryDraft['episodes']> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();
    const batchLabel = `batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}`;

    const beatsJson = JSON.stringify(beats, null, 2);
    const continuityBlock = prevTail
      ? `上一批最后一集结尾片段（用于衔接）：\n${prevTail}\n\n${prevSummary ? `（上集摘要：${prevSummary}）\n\n` : ''}${prevConflictState ? `【上集核心冲突状态】${prevConflictState}\n\n` : ''}${prevUnresolvedSuspense ? `【上集未竟悬念】${prevUnresolvedSuspense}\n\n` : ''}`
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

    const userMsg = `${continuityBlock}本批为可拍短剧单元，请严格按照下方每集的 story_beat_json 为每集生成 storyText。
要求：按 execution_blocks 顺序逐块写，每个 block 的 must_show 必须落成具体动作/画面，禁止仅用心理句或总结句替代。
若某集有 ending_closure（59-61 集），最后一段必须明确写出 required_outcome：守住南京、稳住朝局、叛党/内奸被清、建文帝权力稳固。
你必须忠实地实现每个节拍与执行块，不允许只参考不落实。\n\n本批节拍规划：\n${beatsJson.slice(0, 40000)}`;

    const promptChars = systemMsg.length + userMsg.length;
    const requestedEpisodeNums = beats.map((b) => b.episode_meta.episode_number);
    const requestedEpisodes = requestedEpisodeNums.join(',');
    this.logger.log(
      `[episode-story][p2-writer][${batchLabel}] promptChars=${promptChars} requestedEpisodes=${requestedEpisodes}`,
    );

    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.5,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
    });
    this.logger.debug(
      `[episode-story][p2-writer] Request body preview: ${body.slice(0, 500)}`,
    );
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
    const raw = await res.text();
    this.logger.log(
      `[episode-story][p2-writer][${batchLabel}][raw] status=${res.status} preview=${raw.trim().slice(0, 500)}`,
    );
    if (!res.ok) {
      this.logger.error(
        `[episode-story][p2-writer] LLM request failed: status=${res.status}, raw=${raw.slice(0, 2000)}`,
      );
      throw new BadRequestException(`P2 Writer batch request failed: ${res.status}`);
    }

    const content = this.extractModelContent(raw);
    const parsed = this.parseJsonFromText(content);
    const withEpisodes = parsed as unknown[] | { episodes?: unknown[] };
    const parsedItems = Array.isArray(withEpisodes)
      ? withEpisodes
      : (withEpisodes as Record<string, unknown>)?.episodes ?? [];
    const arr: unknown[] = Array.isArray(parsedItems) ? parsedItems : [];

    const rawParsedCount = arr.length;

    this.logger.log(
      `[episode-story][p2-writer][${batchLabel}][parse] rawParsedCount=${rawParsedCount} requestedCount=${beats.length}`,
    );

    if (arr.length === 0) {
      this.logger.error(
        `[episode-story][p2-writer] Empty result from LLM. Raw response: ${raw.slice(0, 2000)}`,
      );
      throw new BadRequestException('P2 Writer returned empty result.');
    }

    // 将所有 parsed items 归一化为 { epNum, item, normalizedStoryText }
    const allCandidates: {
      epNum: number;
      item: WriterItemLike;
      storyText: string | null;
      arrIndex: number;
    }[] = [];
    for (let i = 0; i < arr.length; i++) {
      const one = (arr[i] || {}) as WriterItemLike;
      const epNum = (one.episodeNumber ?? one.episode_number ?? 0) as number;
      const normalizedStoryText = this.normalizeWriterStoryText(one);
      allCandidates.push({ epNum, item: one, storyText: normalizedStoryText, arrIndex: i });
    }

    // 按 episodeNumber 分组
    const byEpisode = new Map<number, typeof allCandidates>();
    for (const c of allCandidates) {
      if (!byEpisode.has(c.epNum)) byEpisode.set(c.epNum, []);
      byEpisode.get(c.epNum)!.push(c);
    }

    // 检测重复并记录日志
    const duplicateEpisodes: { epNum: number; count: number }[] = [];
    for (const [epNum, candidates] of byEpisode) {
      if (candidates.length > 1) {
        duplicateEpisodes.push({ epNum, count: candidates.length });
      }
    }
    if (duplicateEpisodes.length > 0) {
      this.logger.warn(
        `[episode-story][p2-writer][${batchLabel}][dedup] duplicates detected: ${duplicateEpisodes.map((d) => `ep=${d.epNum}(x${d.count})`).join(', ')}`,
      );
    }

    // 为每个 requested episode 选出最佳候选
    let invalidStoryTextCount = 0;
    const out: EpisodeStoryDraft['episodes'] = [];
    const requestedEpSet = new Set(requestedEpisodeNums);

    for (let i = 0; i < beats.length; i++) {
      const targetEpNum = beats[i].episode_meta.episode_number;
      const candidates = byEpisode.get(targetEpNum);

      if (!candidates || candidates.length === 0) {
        // 该 episode 在 AI 返回中找不到 → 尝试用位置 index 对应
        const positionalCandidate = allCandidates[i];
        if (positionalCandidate) {
          const fallbackText = positionalCandidate.storyText;
          const isValid =
            typeof fallbackText === 'string' &&
            fallbackText.trim().length >= MIN_STORY_TEXT_LENGTH_ABSOLUTE &&
            fallbackText.trim() !== PLACEHOLDER_STORY_TEXT_TEMPLATE(targetEpNum);
          if (isValid) {
            this.logger.warn(
              `[episode-story][p2-writer][${batchLabel}][dedup] ep=${targetEpNum} not found by episodeNumber, using positional index=${i} (actualEpNum=${positionalCandidate.epNum})`,
            );
            out.push({
              episodeNumber: targetEpNum,
              title: positionalCandidate.item.title ?? beats[i].episode_meta.title,
              summary: positionalCandidate.item.summary ?? beats[i].episode_meta.summary,
              storyText: fallbackText!,
              storyBeat: JSON.stringify(beats[i]),
            });
            continue;
          }
        }
        this.logger.warn(
          `[episode-story][p2-writer][${batchLabel}] no candidate for ep=${targetEpNum}`,
        );
        invalidStoryTextCount += 1;
        continue;
      }

      // 从同一 episode 的多个候选中选最佳一条
      const best = this.selectBestWriterCandidate(candidates, targetEpNum);

      if (!best) {
        this.logger.warn(
          `[episode-story][p2-writer][${batchLabel}] all ${candidates.length} candidates for ep=${targetEpNum} are invalid`,
        );
        invalidStoryTextCount += 1;
        continue;
      }

      out.push({
        episodeNumber: targetEpNum,
        title: best.item.title ?? beats[i].episode_meta.title,
        summary: best.item.summary ?? beats[i].episode_meta.summary,
        storyText: best.storyText!,
        storyBeat: JSON.stringify(beats[i]),
      });
    }

    // 检查是否有 AI 返回的 episode 不在 requested 中（额外生成的噪音）
    const extraEpisodes = [...byEpisode.keys()].filter((ep) => !requestedEpSet.has(ep));
    if (extraEpisodes.length > 0) {
      this.logger.warn(
        `[episode-story][p2-writer][${batchLabel}][dedup] extra episodes not in requested set: ${extraEpisodes.join(',')}`,
      );
    }

    const dedupedCount = out.length;
    this.logger.log(
      `[episode-story][p2-writer][${batchLabel}][validate] ` +
        `requestedEpisodes=${requestedEpisodes} rawParsedCount=${rawParsedCount} ` +
        `dedupedCount=${dedupedCount} invalid=${invalidStoryTextCount}` +
        `${duplicateEpisodes.length > 0 ? ` duplicateEpisodes=${duplicateEpisodes.map((d) => d.epNum).join(',')}` : ''}` +
        `${extraEpisodes.length > 0 ? ` extraEpisodes=${extraEpisodes.join(',')}` : ''}`,
    );

    if (invalidStoryTextCount > 0 && out.length === 0) {
      this.logger.warn(
        `[episode-story][p2-writer] all storyTexts invalid count=${invalidStoryTextCount}, throwing`,
      );
      throw new BadRequestException('P2 Writer returned invalid storyText for all episodes.');
    }

    if (invalidStoryTextCount > 0 && out.length > 0) {
      this.logger.warn(
        `[episode-story][p2-writer][${batchLabel}] ${invalidStoryTextCount} episodes missing valid storyText, proceeding with ${out.length} valid episodes`,
      );
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
   * 从同一 episode 的多个 writer 候选中选最佳一条。
   * 策略：
   * 1. 过滤掉无效（太短 / 占位）的候选
   * 2. 有效候选中，优先选字数在 360-520 区间的
   * 3. 若多个都在区间内，选字数最接近 400 的
   * 4. 若都不在区间内，选字数最长的（更可能完整）
   */
  private selectBestWriterCandidate(
    candidates: { epNum: number; item: WriterItemLike; storyText: string | null; arrIndex: number }[],
    targetEpNum: number,
  ): { item: WriterItemLike; storyText: string } | null {
    const validCandidates = candidates.filter((c) => {
      if (typeof c.storyText !== 'string') return false;
      const trimmed = c.storyText.trim();
      return (
        trimmed.length >= MIN_STORY_TEXT_LENGTH_ABSOLUTE &&
        trimmed !== PLACEHOLDER_STORY_TEXT_TEMPLATE(targetEpNum)
      );
    }) as { epNum: number; item: WriterItemLike; storyText: string; arrIndex: number }[];

    if (validCandidates.length === 0) return null;
    if (validCandidates.length === 1) return validCandidates[0];

    // 多个有效候选 → 选最佳
    const TARGET_CHARS = 400;
    const RANGE_MIN = 360;
    const RANGE_MAX = 520;

    const inRange = validCandidates.filter((c) => {
      const len = c.storyText.trim().length;
      return len >= RANGE_MIN && len <= RANGE_MAX;
    });

    if (inRange.length > 0) {
      // 选字数最接近 TARGET_CHARS 的
      inRange.sort(
        (a, b) =>
          Math.abs(a.storyText.trim().length - TARGET_CHARS) -
          Math.abs(b.storyText.trim().length - TARGET_CHARS),
      );
      this.logger.debug(
        `[p2-writer][dedup] ep=${targetEpNum} selected candidate arrIndex=${inRange[0].arrIndex} len=${inRange[0].storyText.trim().length} from ${validCandidates.length} valid candidates`,
      );
      return inRange[0];
    }

    // 都不在区间内 → 选最长的
    validCandidates.sort(
      (a, b) => b.storyText.trim().length - a.storyText.trim().length,
    );
    this.logger.debug(
      `[p2-writer][dedup] ep=${targetEpNum} selected longest candidate arrIndex=${validCandidates[0].arrIndex} len=${validCandidates[0].storyText.trim().length} from ${validCandidates.length} valid candidates (none in range)`,
    );
    return validCandidates[0];
  }

  /**
   * P3: 对单集 storyText 进行 QA 诊断，返回结构化的问题列表。
   * 复用 evaluateStoryTextForShortDrama 的逻辑，
   * 输出为 EpisodeQaDiagnosis 格式，供 autoRewrite 使用。
   * @param beat 可选；传入时若 execution_blocks 不少于 4 且正文段落数明显少于 4，则追加 execution_blocks_undershoot 供 rewrite 补段。
   */
  private diagnoseEpisode(
    episodeNumber: number,
    storyText: string,
    beat?: StoryBeatJson | null,
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

    // 非终局集：严格检查尾钩质量
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

    // 59-60 集：仍需检查尾钩（仅最终集 61 可豁免尾钩检查）
    if (episodeNumber >= 59 && episodeNumber < 61) {
      if (ev.severeWeakHook && !ev.endingClosureMissing) {
        issues.push({
          type: 'severe_weak_hook',
          message: '属终局段但结尾钩子过于空泛，需要具体的收束结果或事件型悬念。',
          severity: 'high',
        });
      }
      // 终局段增加 endingClosureWeak 检查
      if (ev.endingClosureWeak) {
        issues.push({
          type: 'ending_closure_weak',
          message: '已进入终局段，但正文仍以继续预警/铺悬念为主，缺少终局收束。需要补充具体的收束结果。',
          severity: 'high',
        });
      }
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

    if (!ev.antagonistActionOk) {
      issues.push({
        type: 'antagonist_action_missing',
        message: '缺少明确对手动作。正文必须写出至少一处敌方/对手正在实施的具体动作（如调兵、夜袭、陷害、倒戈、开城门等），禁止仅用「局势紧张」「敌军有阴谋」等泛表述。',
        severity: 'high',
      });
    }
    if (!ev.protagonistCounteractionOk) {
      issues.push({
        type: 'protagonist_counteraction_missing',
        message: '缺少主角反制动作。正文必须写出至少一处主角对对手动作的具体回应（如设局、拦截、揭发、对质、抓捕、调兵布防等），禁止仅用「我意识到」「我决定小心」等心理句。',
        severity: 'high',
      });
    }
    if (!ev.reversalOk) {
      issues.push({
        type: 'reversal_missing',
        message: '缺少单集转折。中后段须有明确局势变化（如身份揭露、计划失效、证据曝光、局势反转、某人反水等），禁止仅用「又收到一封密报」式信息追加。',
        severity: 'high',
      });
    }
    if (episodeNumber < 59 && !ev.endHookOk) {
      issues.push({
        type: 'end_hook_missing',
        message: '结尾缺少明确钩子。须写出具体事件型悬念或风险升级（如某人/某物/某时点的后果），禁止仅用「夜色沉沉」「我意识到事情不妙」等空泛收尾。',
        severity: 'high',
      });
    }
    if (ev.conflictIntensityLow) {
      issues.push({
        type: 'conflict_intensity_low',
        message: `强冲突四要素不足（对手动作/主角反制/转折/尾钩中仅部分达标）。需要补足至少三项：明确对手动作、主角反制、单集转折、结尾钩子。`,
        severity: 'high',
      });
    }

    if (beat?.execution_blocks && beat.execution_blocks.length >= 4) {
      const paragraphCount = (storyText || '')
        .split(/\n+/)
        .filter((s) => s.trim().length > 0).length;
      if (paragraphCount < 4) {
        issues.push({
          type: 'execution_blocks_undershoot',
          message: `正文仅 ${paragraphCount} 段，与 execution_blocks 至少 4 块不符，大概率未按 hook/conflict/reversal/climax_tail 落段。请按 block 顺序补段，每块至少一段。`,
          severity: 'medium',
        });
      }
    }

    const needsRewrite = issues.some((i) => i.severity === 'high');
    return { episodeNumber, issues, needsRewrite };
  }

  /**
   * P3: 自动重写代理 — 接收有问题的 storyText、原始 beat 规划和 QA 诊断，
   * 调用 AI "剧本医生" 进行精准修复，返回修复后的 storyText。
   * @param userFeedback 用户反馈（反馈闭环预留），若提供则优先参考用户意见进行修复
   */
  private async runAutoRewrite(
    modelKey: string,
    episodeNumber: number,
    originalStoryText: string,
    beat: StoryBeatJson,
    diagnosis: EpisodeQaDiagnosis,
    userFeedback?: string,
  ): Promise<string> {
    const endpoint = this.getLcApiEndpoint();
    const apiKey = this.getLcApiKey();

    const issuesJson = JSON.stringify(diagnosis.issues, null, 2);
    const beatJson = JSON.stringify(beat, null, 2);

    const issueTypes = diagnosis.issues.map((i) => i.type);
    const strongConflictIssueTypes = [
      'antagonist_action_missing',
      'protagonist_counteraction_missing',
      'reversal_missing',
      'end_hook_missing',
      'conflict_intensity_low',
    ];
    const hasStrongConflictIssue = strongConflictIssueTypes.some((t) => issueTypes.includes(t));
    const hasExecutionBlocksUndershoot = issueTypes.includes('execution_blocks_undershoot');
    const needsStructuralFinale =
      issueTypes.includes('rewrite_goal_violation') ||
      issueTypes.includes('ending_closure_missing');
    const needsStructuralConflictFix = hasStrongConflictIssue;
    const hasExecutionBlocks = !!(beat?.execution_blocks && beat.execution_blocks.length >= 4);

    let repairInstruction: string;
    if (needsStructuralConflictFix) {
      repairInstruction = `本次不是最小化修补。QA 报告显示缺少强冲突要素（对手动作/主角反制/转折/结尾钩子）。
你必须按 qa_issues 中列出的类型逐项补「戏核」：缺对手动作则增加敌方正在实施的具体威胁动作；缺主角反制则增加主角的具体应对（设局/揭发/拦截/对质/抓捕等）；缺转折则在中后段补出明确局势变化/身份揭露/计划失效；缺结尾钩子则重写结尾为具体事件型悬念或风险升级。
允许对冲突段（中段）与结尾段做结构性增写，保持 story_beat_json 节拍与第一人称。${
        needsStructuralFinale
          ? '若 qa_issues 含 ending_closure_missing 或 rewrite_goal_violation，还须兑现终局收束与改写目标（守住南京、建文帝权力稳固等）。'
          : ''
      }
只输出修复后的纯故事文本。`;
    } else if (needsStructuralFinale) {
      repairInstruction = `本次不是最小化修补。允许对全文最后约 30% 做结构性重写。
必须兑现 story_beat_json 中的 ending_closure.required_outcome。
必须把终局结果写实：南京守住、朝局稳住、叛党/内奸被清、建文帝权力稳固。
允许调整结尾段落顺序与事件呈现方式，但不要改坏前文已正确部分。
只输出修复后的纯故事文本。`;
    } else {
      repairInstruction = `请仅针对 QA 错误报告中指出的问题进行最小化修复，保持原文风格和正确部分不变。只输出修复后的纯故事文本。`;
    }

    if (needsStructuralConflictFix || hasExecutionBlocksUndershoot) {
      repairInstruction += `\n\n【强冲突/落段补写要求】不要只补环境描写和心理描写。必须补出一个正在发生的对手动作；必须补出主角针对该动作的反制；必须补出至少一个局势变化/中段转折；非终局集最后必须落一个具体事件型钩子。`;
    }
    if (hasExecutionBlocks) {
      repairInstruction += `\n若 story_beat_json 含 execution_blocks，请按 block 顺序补段，不要把 must_show 改写成总结句。`;
    }

    // 反馈闭环：若用户提供了反馈，优先参考用户意见
    const userFeedbackBlock = userFeedback?.trim()
      ? `\n\n【用户反馈 (user_feedback)】\n${userFeedback.trim()}\n\n请优先参考用户反馈进行修复，用户意见优先级高于 QA 自动检测。`
      : '';

    const userMsg = `请修复以下第 ${episodeNumber} 集的故事文本。

【原始节拍规划 (story_beat_json)】
${beatJson}

【QA 错误报告 (qa_issues)】
${issuesJson}${userFeedbackBlock}

【有问题的故事文本 (storyText)】
${originalStoryText}

${repairInstruction}`;

    const promptChars = AUTO_REWRITE_SYSTEM_PROMPT.length + userMsg.length;
    this.logger.log(
      `[episode-story][auto-rewrite] ep=${episodeNumber} issueCount=${diagnosis.issues.length} promptChars=${promptChars} mode=${needsStructuralConflictFix ? 'structural-conflict-fix' : needsStructuralFinale ? 'structural-finale-rewrite' : 'minimal-fix'}`,
    );

    const body = JSON.stringify({
      model: modelKey,
      temperature: 0.3,
      messages: [
        { role: 'system', content: AUTO_REWRITE_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
    });
    this.logger.debug(
      `[episode-story][auto-rewrite] Request body preview: ${body.slice(0, 500)}`,
    );
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
      this.logger.error(
        `[episode-story][auto-rewrite] ep=${episodeNumber} LLM request failed: status=${res.status}, raw=${raw.slice(0, 2000)}`,
      );
      throw new BadRequestException(
        `Auto-rewrite request failed for ep=${episodeNumber}: ${res.status}`,
      );
    }

    const content = this.extractModelContent(raw);
    const rewritten = content.trim();

    if (rewritten.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE) {
      this.logger.error(
        `[episode-story][auto-rewrite] ep=${episodeNumber} rewritten text too short: length=${rewritten.length}. Content: ${rewritten.slice(0, 500)}`,
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
   * @param userFeedback 用户反馈（反馈闭环预留），若提供则传递给自动重写代理
   */
  private async autoRewriteIfNeeded(
    modelKey: string,
    episodeNumber: number,
    storyText: string,
    beat: StoryBeatJson,
    userFeedback?: string,
  ): Promise<{
    finalStoryText: string;
    wasRewritten: boolean;
    rewriteAttempts: number;
    finalDiagnosis: EpisodeQaDiagnosis;
  }> {
    let currentText = storyText;
    let diagnosis = this.diagnoseEpisode(episodeNumber, currentText, beat);
    let attempts = 0;
    let wasRewritten = false;

    // 反馈闭环：若有 userFeedback 但无自动诊断问题，仍触发一次重写
    if (!diagnosis.needsRewrite && userFeedback?.trim()) {
      diagnosis.needsRewrite = true;
      diagnosis.issues.push({
        type: 'user_feedback',
        message: `用户反馈：${userFeedback.trim().slice(0, 200)}`,
        severity: 'high',
      });
      this.logger.log(
        `[episode-story][auto-rewrite-loop] ep=${episodeNumber} no auto-diagnosis issues, but userFeedback present — triggering rewrite`,
      );
    }

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
          userFeedback,
        );
        currentText = rewritten;
        wasRewritten = true;

        diagnosis = this.diagnoseEpisode(episodeNumber, currentText, beat);

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
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `[episode-story][auto-rewrite-loop] ep=${episodeNumber} rewrite attempt=${attempts} failed: ${errMsg}`,
          err instanceof Error ? err.stack : undefined,
        );
        break;
      }
    }

    if (diagnosis.needsRewrite && attempts >= AUTO_REWRITE_MAX_RETRIES) {
      const issueTypes = diagnosis.issues.filter((i) => i.severity === 'high').map((i) => i.type);
      this.logger.warn(
        `[episode-story][auto-rewrite-loop] ep=${episodeNumber} exhausted ${AUTO_REWRITE_MAX_RETRIES} retries, still has high issues: ${issueTypes.join(',')}`,
      );
      this.logger.error(
        `[episode-story][auto-rewrite-loop] ep=${episodeNumber} quality-rescue hint: ` +
          `若为 rewrite_goal_violation/ending_closure_missing 多为 beat 设计未约束终局或 writer 未兑现 beat；` +
          `若为 event_density_low/narration_too_short 多为 writer 未按 execution_blocks must_show 落段或 rewrite 无法补齐结构。` +
          `issues=${JSON.stringify(diagnosis.issues)}`,
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
      let strongConflictAudit: EpisodeStrongConflictAudit | undefined;
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
        if (!ev.antagonistActionOk) {
          issues.push({ type: 'antagonist_action_missing', message: '缺少明确对手动作（敌方正在实施的具体动作）', severity: 'high' });
          score -= 5;
        }
        if (!ev.protagonistCounteractionOk) {
          issues.push({ type: 'protagonist_counteraction_missing', message: '缺少主角反制动作（可拍的反制/设局/揭发/拦截等）', severity: 'high' });
          score -= 5;
        }
        if (!ev.reversalOk) {
          issues.push({ type: 'reversal_missing', message: '缺少单集转折（中后段局势变化/身份揭露/计划失效等）', severity: 'high' });
          score -= 5;
        }
        if (ep.episodeNumber < 59 && !ev.endHookOk) {
          issues.push({ type: 'end_hook_missing', message: '结尾缺少明确钩子（事件型悬念或风险升级）', severity: 'high' });
          score -= 4;
        }
        if (ev.conflictIntensityLow) {
          issues.push({ type: 'conflict_intensity_low', message: '强冲突四要素不足，短剧爆点偏弱', severity: 'high' });
          score -= 6;
        }
        strongConflictAudit = {
          hasAntagonistAction: ev.antagonistActionOk,
          hasProtagonistCounteraction: ev.protagonistCounteractionOk,
          hasReversal: ev.reversalOk,
          hasEndHook: ev.endHookOk,
          conflictIntensityLow: ev.conflictIntensityLow,
        };
      }
      if (issues.length > 0 || strongConflictAudit) {
        episodeIssues.push({
          episodeNumber: ep.episodeNumber,
          issues,
          ...(strongConflictAudit && { strongConflictAudit }),
        });
      }
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
            '你是短剧故事 QA 助手。根据核心三表与扩展参考表，检查故事草稿的提纲一致性、结构节奏、人物设定、连续性、尾钩与可读性。\n\n除了上述传统维度，你还需评估以下主观维度：\n- **引人入胜度 (engagementScore)**：1-10 分，评估该集是否能在前 3 秒抓住观众、冲突是否足够吸引人持续观看\n- **情感张力 (emotionalTensionScore)**：1-10 分，评估该集是否有足够的情感起伏（紧张→松弛→再紧张）、角色动机是否引发共情\n\n若 engagementScore 或 emotionalTensionScore 低于 5，请在该集的 issues 中增加一条 severity=medium 的问题。\n\n只输出指定 JSON，不要其他内容。',
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
    const auditByEp = new Map<number, EpisodeStrongConflictAudit>();
    for (const item of ruleReport.episodeIssues) {
      byEp.set(item.episodeNumber, [...item.issues]);
      if (item.strongConflictAudit) auditByEp.set(item.episodeNumber, item.strongConflictAudit);
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
      if (issues.length > 0 || auditByEp.has(epNum)) {
        episodeIssues.push({
          episodeNumber: epNum,
          issues,
          ...(auditByEp.get(epNum) && { strongConflictAudit: auditByEp.get(epNum) }),
        });
      }
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

  /**
   * 从可能含 markdown 或前后说明文字的内容中剥出纯 JSON 字符串。
   * 先剥 ```json ... ``` / ``` ... ```，再按首尾 [ ] 或 { } 截取（数组优先）。
   */
  private stripJsonFromRaw(raw: string): string {
    let text = (raw || '').trim();
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock?.[1]) text = codeBlock[1].trim();
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBracket !== -1 && lastBracket > firstBracket)
      return text.slice(firstBracket, lastBracket + 1);
    if (firstBrace !== -1 && lastBrace > firstBrace)
      return text.slice(firstBrace, lastBrace + 1);
    return text;
  }

  private parseJsonFromText(raw: string): unknown {
    const text = (raw || '').trim();
    const jsonStr = this.stripJsonFromRaw(text);
    try {
      return JSON.parse(jsonStr);
    } catch {
      const first = text.indexOf('[');
      const last = text.lastIndexOf(']');
      if (first !== -1 && last > first) {
        try {
          return JSON.parse(text.slice(first, last + 1));
        } catch {
          // fallthrough to throw with context
        }
      }
      this.logger.warn(
        `[episode-story][parse-json] failed rawLen=${raw.length} excerpt=${text.slice(0, 300)}`,
      );
      throw new BadRequestException('AI 返回不是有效 JSON');
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
