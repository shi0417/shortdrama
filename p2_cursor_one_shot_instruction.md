# P2 一次性 Cursor 指令：将"素材筛证 + Beat Planner + 按谱Writer"集成到现有代码

## 背景

`MaterialSiftingService` 和 `DramaticEvidencePack` 接口已经实现完毕（步骤1和步骤2）。本指令的目标是将剩余的 P2 改造一次性完成，具体包括：

1. 在 `EpisodeStoryGenerationService` 中注入 `MaterialSiftingService`
2. 新增 `runBeatPlanner` 方法（替代现有的轻量 `runPlanner`）
3. 新增 `runP2Writer` 方法（替代现有的 `runWriterBatch`）
4. 重构 `generateDraft` 方法，串联新的三阶段流水线
5. 确保 `persistDraft` 正确存储结构化的 `story_beat_json`

---

## 指令开始

请按照以下要求，对 `apps/api/src/pipeline/episode-story-generation.service.ts` 进行改造。所有改动都在这一个文件中完成（除了 module 注册）。

### 第一步：Module 注册（如尚未完成）

在 `apps/api/src/pipeline/pipeline.module.ts` 中：
- 确保 `MaterialSiftingService` 已被 import 并添加到 `providers` 数组中。
- 如果已经注册，跳过此步。

### 第二步：注入 MaterialSiftingService

在 `episode-story-generation.service.ts` 的文件顶部，添加 import：

```typescript
import { MaterialSiftingService } from './material-sifting.service';
import type { DramaticEvidencePack } from './dto/material-sifting.dto';
```

修改 `EpisodeStoryGenerationService` 的 constructor，新增一个依赖：

```typescript
constructor(
    private readonly dataSource: DataSource,
    private readonly refContext: PipelineReferenceContextService,
    private readonly storyVersionService: EpisodeStoryVersionService,
    private readonly materialSifting: MaterialSiftingService,  // 新增
) {}
```

### 第三步：定义 story_beat_json 的 TypeScript 接口

在文件顶部（import 区域下方、class 定义之前），新增以下接口定义：

```typescript
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
```

### 第四步：新增 BEAT_PLANNER_SYSTEM_PROMPT 常量

在文件顶部常量区域（现有常量如 `DEFAULT_BATCH_SIZE` 附近），新增：

```typescript
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
```

### 第五步：新增 P2_WRITER_SYSTEM_PROMPT 常量

紧接着上面的常量，新增：

```typescript
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
```

### 第六步：新增 runBeatPlanner 方法

在 `EpisodeStoryGenerationService` class 内部，新增以下方法（放在现有 `runPlanner` 方法附近）：

```typescript
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

  // 1. 为批内每集构建戏剧证据包
  const evidencePacks: DramaticEvidencePack[] = [];
  for (const item of batch) {
    const pack = await this.materialSifting.buildEvidencePack(novelId, item.episodeNumber);
    evidencePacks.push(pack);
  }

  // 2. 构建 user message
  const packsJson = JSON.stringify(evidencePacks, null, 2);
  const prevBeatBlock = prevTailBeat
    ? `上一集的节拍规划（用于衔接参考）：\n${JSON.stringify(prevTailBeat, null, 2)}\n\n`
    : '';
  const userMsg = `${prevBeatBlock}请为以下 ${batch.length} 集生成结构化的故事节拍规划（story_beat_json），每集一个 JSON 对象，最终输出为 JSON 数组。\n\n本批集数：${batch.map(b => b.episodeNumber).join(', ')}\n\n本批各集的戏剧证据包：\n${packsJson.slice(0, 50000)}`;

  const promptChars = BEAT_PLANNER_SYSTEM_PROMPT.length + userMsg.length;
  this.logger.log(`[episode-story][beat-planner] batch=[${batch.map(b => b.episodeNumber).join(',')}] promptChars=${promptChars}`);

  // 3. 调用 AI
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

  // 4. 解析返回的 JSON 数组
  const content = this.extractModelContent(raw);
  const parsed = this.parseJsonFromText(content);
  const arr = Array.isArray(parsed) ? parsed : (parsed as any)?.beats ?? (parsed as any)?.episodes ?? [];

  if (arr.length !== batch.length) {
    this.logger.warn(`[episode-story][beat-planner] expected=${batch.length} actual=${arr.length}`);
    // 允许部分匹配，但记录警告
  }

  const beats: StoryBeatJson[] = [];
  for (let i = 0; i < batch.length; i++) {
    const raw = arr[i] as StoryBeatJson | undefined;
    if (!raw || !raw.episode_meta || !raw.pacing_structure) {
      this.logger.warn(`[episode-story][beat-planner] invalid beat for ep=${batch[i].episodeNumber}, using fallback`);
      // 构建一个最小化的 fallback beat
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
      beats.push(raw);
    }
  }

  this.logger.log(`[episode-story][beat-planner] parsed ${beats.length} beats`);
  return beats;
}
```

### 第七步：新增 runP2WriterBatch 方法

在 class 内部，新增以下方法（放在现有 `runWriterBatch` 方法附近）：

```typescript
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

  // 构建 user message
  const beatsJson = JSON.stringify(beats, null, 2);
  const continuityBlock = prevTail
    ? `上一批最后一集结尾片段（用于衔接）：\n${prevTail}\n\n${prevSummary ? `（上集摘要：${prevSummary}）\n\n` : ''}`
    : '';

  // 55-61集终局守卫
  const hasEnding = beats.some(b => b.episode_meta.episode_number >= 55);
  const endingGuardBlock = hasEnding ? this.buildEndingGuardInstruction(
    beats.map(b => ({
      episodeNumber: b.episode_meta.episode_number,
      title: b.episode_meta.title,
      summary: b.episode_meta.summary,
    }))
  ) : '';

  const systemMsg = P2_WRITER_SYSTEM_PROMPT + endingGuardBlock;

  const userMsg = `${continuityBlock}本批为可拍短剧单元，请严格按照下方每集的 story_beat_json 节拍规划，为每集生成 storyText。你必须忠实地实现每个节拍（hook_3s、conflict_15s、mid_reversal、climax、tail_hook）中描述的具体事件，不允许只参考不落实。\n\n本批节拍规划：\n${beatsJson.slice(0, 40000)}`;

  const promptChars = systemMsg.length + userMsg.length;
  const requestedEpisodes = beats.map(b => b.episode_meta.episode_number).join(',');
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
  const arr = Array.isArray(withEpisodes) ? withEpisodes : (withEpisodes as any)?.episodes ?? [];

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
    const epNum = (one.episodeNumber ?? one.episode_number ?? beats[i].episode_meta.episode_number) as number;
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
        storyBeat: JSON.stringify(beats[i]),  // 将完整的结构化 beat 存为字符串
      });
    }
  }

  this.logger.log(
    `[episode-story][p2-writer][batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}][validate] requested=${beats.length} parsed=${arr.length} invalid=${invalidStoryTextCount}`,
  );

  if (invalidStoryTextCount > 0) {
    this.logger.warn(`[episode-story][p2-writer] invalid storyText count=${invalidStoryTextCount}, throwing`);
    throw new BadRequestException('P2 Writer returned invalid storyText for some episodes.');
  }

  // 运行现有的短剧可拍性评估（复用 evaluateStoryTextForShortDrama）
  for (const item of out) {
    const ev = this.evaluateStoryTextForShortDrama(item.episodeNumber, item.storyText ?? '');
    if (ev.firstPersonOk) this.logger.debug(`[p2-writer] ep=${item.episodeNumber} firstPersonOk`);
    if (ev.weakHook) this.logger.warn(`[p2-writer] ep=${item.episodeNumber} weakHook detected`);
    if (ev.severeWeakHook) this.logger.warn(`[p2-writer] ep=${item.episodeNumber} severeWeakHook detected`);
  }

  return out;
}
```

### 第八步：重构 generateDraft 方法

这是最关键的一步。将现有的 `generateDraft` 方法重构为使用 P2 三阶段流水线（素材筛证 → Beat Planner → P2 Writer）。

**改造策略**：保留现有 `generateDraft` 方法的整体框架（签名、返回值、缓存、warnings 等不变），只替换内部的核心生成逻辑。

找到 `generateDraft` 方法中以下这段代码（从 `const plan = await this.runPlanner(...)` 开始，到 `for (let i = 0; i < batches.length; i++)` 循环结束），替换为新的 P2 流水线逻辑：

```typescript
// === P2 三阶段流水线 ===

// 阶段 1+2: Beat Planner（内部自动调用 MaterialSiftingService 获取戏剧证据包）
// 先用轻量 planner 获取集数列表，然后分批调用 Beat Planner
const episodeList: { episodeNumber: number; title?: string; summary?: string }[] = [];
for (let i = 1; i <= targetCount; i++) {
  episodeList.push({ episodeNumber: i });
}
const beatBatches = this.splitBatches(
  episodeList.map(e => ({ ...e, storyBeat: undefined })),
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

  // 阶段 1+2: 为本批生成结构化 beat 规划
  const beats = await this.runBeatPlanner(
    usedModelKey,
    novelId,
    batch,
    prevTailBeat,
  );

  // 阶段 3: 按谱填词 Writer
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
  allEpisodes.push(...batchDraft);

  // 更新衔接信息
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
```

**注意**：上面的代码替换的是 `generateDraft` 方法中从 `const plan = await this.runPlanner(...)` 到 `for` 循环结束（即 `prevSummary = '';` 那行的 `}` 之后的 `}`）之间的所有代码。

同时，在替换区域之前的这两段代码可以**删除**（因为 P2 不再需要全局 buildContextBlocks）：

```typescript
// 这段可以删除，P2 不再需要：
// const { promptPreview, referenceSummary } = await this.buildContextBlocks(
//   novelId,
//   referenceTables,
//   dto.sourceTextCharBudget ?? DEFAULT_SOURCE_CHAR_BUDGET,
//   targetCount,
//   dto.userInstruction,
//   warnings,
// );
```

但是 `promptPreview` 和 `referenceSummary` 在返回值中仍被使用，所以需要保留一个简化版本。将被删除的那段替换为：

```typescript
// P2: 简化版 promptPreview（用于前端展示，不再用于 AI 调用）
const promptPreview = `[P2 模式] 使用 MaterialSiftingService + BeatPlanner + P2Writer 三阶段流水线。目标 ${targetCount} 集，batchSize=${batchSize}`;
const referenceSummary: EpisodeStoryReferenceSummaryItem[] = [];
```

### 第九步：更新 persistDraft 中的 storyBeatJson 存储

找到 `persistDraft` 方法中的这行代码：

```typescript
storyBeatJson: ep.storyBeat != null ? { storyBeat: ep.storyBeat } : undefined,
```

替换为：

```typescript
storyBeatJson: ep.storyBeat != null ? (typeof ep.storyBeat === 'string' ? (() => { try { return JSON.parse(ep.storyBeat); } catch { return { storyBeat: ep.storyBeat }; } })() : { storyBeat: ep.storyBeat }) : undefined,
```

这样做的目的是：如果 `storyBeat` 是一个 JSON 字符串（P2 模式下存储的是完整的 `StoryBeatJson` 对象的序列化），就解析为对象存入数据库；如果解析失败或是普通字符串（P1 兼容模式），则保持原有行为。

### 第十步：保留旧方法作为 fallback（可选但建议）

不要删除现有的 `runPlanner` 和 `runWriterBatch` 方法。将它们保留在代码中，以便在 P2 流水线出现问题时可以快速回退。可以在方法名前加注释标记：

```typescript
/** @deprecated P1 legacy planner — 保留用于 fallback */
private async runPlanner(...) { ... }

/** @deprecated P1 legacy writer — 保留用于 fallback */
private async runWriterBatch(...) { ... }
```

---

## 改造完成后的数据流

```
generateDraft()
  │
  ├─ for each batch:
  │   │
  │   ├─ runBeatPlanner(batch)
  │   │   │
  │   │   ├─ for each episode in batch:
  │   │   │   └─ materialSifting.buildEvidencePack(novelId, episodeNumber)
  │   │   │       → 查询数据库 → 返回 DramaticEvidencePack
  │   │   │
  │   │   └─ 调用 AI (BEAT_PLANNER_SYSTEM_PROMPT + 证据包)
  │   │       → 返回 StoryBeatJson[]
  │   │
  │   └─ runP2WriterBatch(beats)
  │       │
  │       └─ 调用 AI (P2_WRITER_SYSTEM_PROMPT + beats JSON)
  │           → 返回 { episodeNumber, title, summary, storyText, storyBeat }[]
  │
  └─ 合并所有 batch → 缓存 → 返回
```

## 验证清单

改造完成后，请确认以下几点：

1. `npx nx run api:build` 编译通过
2. `MaterialSiftingService` 在 `pipeline.module.ts` 的 `providers` 中已注册
3. `EpisodeStoryGenerationService` 的 constructor 包含 4 个依赖（dataSource, refContext, storyVersionService, materialSifting）
4. 生成草稿时日志中出现 `[beat-planner]` 和 `[p2-writer]` 标记
5. persist 后 `episode_story_versions.story_beat_json` 列中存储的是完整的结构化 beat 对象（包含 episode_meta、pacing_structure、production_elements）
6. 现有的 QA 规则检查（evaluateStoryTextForShortDrama）、persist 门禁（assertDraftQualityBeforePersist）、终局守卫（buildEndingGuardInstruction）全部正常工作
