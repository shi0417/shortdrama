# P3 自动重写代理 (Auto-Rewrite Agent) — 一次性 Cursor 指令

> **目标**：在现有 P2 三阶段流水线（素材筛证 → Beat 规划 → 按谱写作）的基础上，新增"自动重写"能力。当 Writer 生成的 `storyText` 未通过规则 QA 时，系统自动调用"剧本医生"进行精准修复，最多重试 2 次，从而实现内容生产线的"自愈"。
>
> **改造范围**：仅修改 `apps/api/src/pipeline/episode-story-generation.service.ts`，不涉及其他文件。
>
> **请按以下 4 个步骤依次执行。**

---

## 步骤 1：添加 P3 常量和类型

在 `episode-story-generation.service.ts` 文件中，找到现有的 `P2_WRITER_SYSTEM_PROMPT` 常量定义的**下方**（大约在 `interface CachedStoryDraft` 的上方），插入以下代码：

```typescript
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
```

---

## 步骤 2：添加 `diagnoseEpisode` 和 `runAutoRewrite` 方法

在 `EpisodeStoryGenerationService` 类中，找到 `runP2WriterBatch` 方法的**下方**，插入以下两个新方法：

```typescript
  /**
   * P3: 对单集 storyText 进行 QA 诊断，返回结构化的问题列表。
   * 复用 evaluateStoryTextForShortDrama 和 runRuleBasedCheck 中的逻辑，
   * 但输出为 EpisodeQaDiagnosis 格式，供 autoRewrite 使用。
   */
  private diagnoseEpisode(
    episodeNumber: number,
    storyText: string,
  ): EpisodeQaDiagnosis {
    const ev = this.evaluateStoryTextForShortDrama(episodeNumber, storyText);
    const issues: EpisodeQaDiagnosis['issues'] = [];

    // 字数不足
    if (ev.charCount < MIN_NARRATION_CHARS_STRONG) {
      issues.push({
        type: 'narration_too_short',
        message: `字数仅 ${ev.charCount} 字，不足 ${MIN_NARRATION_CHARS_STRONG} 字，无法支撑 60 秒可拍短剧旁白。需要补充具体动作描写和环境细节，使总字数达到 360-520 字。`,
        severity: 'high',
      });
    }

    // 第一人称不足
    if (ev.thirdPersonSummaryRisk || !ev.firstPersonLeadOk) {
      issues.push({
        type: 'third_person_summary',
        message: `第一人称旁白不足或第三人称摘要化（前200字中"我"出现 ${ev.firstPersonCount} 次，"沈照/她"出现 ${ev.thirdPersonLeadCount} 次）。需要改为沈照第一人称「我」视角叙述，前两句必须出现「我」。`,
        severity: 'high',
      });
    }

    // 动作事件密度严重不足
    if (ev.eventDensitySeverelyLow) {
      issues.push({
        type: 'event_density_low',
        message: `动作事件密度严重不足（动作事件词命中 ${ev.actionEventHitCount} 次，心理摘要词命中 ${ev.summaryPhraseHitCount} 次）。需要将心理描写替换为具体动作事件（递、交、送、入殿、跪、传旨、搜、查、抓等）。`,
        severity: 'high',
      });
    }

    // 结尾钩子过于空泛（非终局集）
    if (episodeNumber < 59 && ev.severeWeakHook) {
      issues.push({
        type: 'severe_weak_hook',
        message: '结尾钩子过于空泛（仅抽象词无具体对象）。需要将结尾替换为具体的事件型尾钩，涉及具体人名/物件/时间点。',
        severity: 'high',
      });
    }

    // 仅问句钩子（非终局集）
    if (episodeNumber < 59 && ev.questionHookOnly) {
      issues.push({
        type: 'question_hook_only',
        message: '结尾仅问句钩子，缺少事件型尾钩。需要在问句之前或之后补充一个已经发生或即将发生的具体事件。',
        severity: 'high',
      });
    }

    // 与改写目标不符
    if (ev.rewriteGoalViolation) {
      issues.push({
        type: 'rewrite_goal_violation',
        message: '内容与改写目标不符（出现朱棣攻破南京、建文朝覆灭等）。需要删除或改写相关内容，确保建文帝守住江山。',
        severity: 'high',
      });
    }

    // 终局缺少收束（59-61集）
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
      this.logger.warn(`[episode-story][auto-rewrite] ep=${episodeNumber} request failed: ${res.status}`);
      throw new BadRequestException(`Auto-rewrite request failed for ep=${episodeNumber}: ${res.status}`);
    }

    const content = this.extractModelContent(raw);
    // 自动重写返回的是纯文本，不是 JSON，所以直接取 content
    const rewritten = content.trim();

    if (rewritten.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE) {
      this.logger.warn(
        `[episode-story][auto-rewrite] ep=${episodeNumber} rewritten text too short: ${rewritten.length}`,
      );
      throw new BadRequestException(`Auto-rewrite returned too-short text for ep=${episodeNumber}`);
    }

    this.logger.log(
      `[episode-story][auto-rewrite] ep=${episodeNumber} originalLen=${originalStoryText.length} rewrittenLen=${rewritten.length}`,
    );
    return rewritten;
  }
```

---

## 步骤 3：添加 `autoRewriteIfNeeded` 编排方法

在 `runAutoRewrite` 方法的**下方**，插入以下编排方法。它负责对单集执行"诊断 → 重写 → 再诊断"的循环：

```typescript
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

        // 重新诊断修复后的文本
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
        // 重写失败时不再重试，保留当前文本
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
```

---

## 步骤 4：改造 `generateDraft` 方法，集成自动重写

在 `generateDraft` 方法中，找到以下代码块（大约在 `for (let i = 0; i < beatBatches.length; i++)` 循环内部）：

```typescript
      batchInfo.push({
        batchIndex: i + 1,
        range: `${startEp}-${endEp}`,
        success: true,
        episodeCount: batchDraft.length,
      });
      allEpisodes.push(...batchDraft);
```

将 `allEpisodes.push(...batchDraft);` 这一行**替换**为以下代码（保留 `batchInfo.push(...)` 不变）：

```typescript
      // P3: 对本批每集执行自动重写检查
      for (let j = 0; j < batchDraft.length; j++) {
        const ep = batchDraft[j];
        const beatForEp = beats[j] ?? beats[0]; // fallback to first beat if index mismatch
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
```

同时，找到 `generateDraft` 方法中原有的以下代码块（在 for 循环结束之后）：

```typescript
    for (const ep of allEpisodes) {
      const ev = this.evaluateStoryTextForShortDrama(ep.episodeNumber, ep.storyText ?? '');
      warnings.push(...ev.warnings);
    }
```

这段代码**保留不变**，因为它提供的是更细粒度的 warning 信息，与 P3 的自动重写互补。

---

## 验证清单

完成以上 4 个步骤后，请按以下清单验证：

| 序号 | 验证项 | 预期结果 |
|------|--------|----------|
| 1 | 编译 | `npx nx run api:build` 通过，无 TypeScript 错误 |
| 2 | 日志 | 生成时日志中出现 `[auto-rewrite-loop]` 相关条目 |
| 3 | 正常集 | QA 通过的集不触发重写，`wasRewritten=false` |
| 4 | 问题集 | QA 不通过的集触发重写，日志显示 `attempt=1` 或 `attempt=2` |
| 5 | 重写成功 | 重写后的 storyText 通过 QA，日志显示 `FIXED after attempt=N` |
| 6 | 重写失败 | 重写 2 次仍失败，warnings 中出现"自动重写 N 次后仍有问题"提示 |
| 7 | persist | 重写后的 storyText 能正常通过 persistDraft 的 QA 门禁并写入数据库 |

---

## 数据流总览（P2 + P3 完整流水线）

```
generateDraft()
  → for each beatBatch:
      → runBeatPlanner(batch)
          → for each ep: materialSifting.buildEvidencePack(novelId, ep)
          → AI(BEAT_PLANNER_SYSTEM_PROMPT + 证据包) → StoryBeatJson[]
      → runP2WriterBatch(beats, prevTail, prevSummary)
          → AI(P2_WRITER_SYSTEM_PROMPT + beats JSON) → { episodeNumber, title, summary, storyText }[]
      → [P3 NEW] for each episode in batchDraft:
          → diagnoseEpisode(ep, storyText) → EpisodeQaDiagnosis
          → if needsRewrite:
              → runAutoRewrite(beat, storyText, diagnosis) → rewrittenText
              → diagnoseEpisode(ep, rewrittenText) → 再次检查
              → if still needsRewrite && attempts < 2: 重试
              → else: 标记 warning
          → push to allEpisodes
  → 合并、缓存、返回（含 rewrite warnings）

persistDraft()  ← 不变，仍执行 runRuleBasedCheck + assertDraftQualityBeforePersist
```

---

## 设计决策说明

**为什么在 `generateDraft` 而不是 `persistDraft` 中嵌入自动重写？**

自动重写嵌入在 `generateDraft` 的每批 Writer 输出之后，而不是在 `persistDraft` 中。这样做有三个好处：第一，用户在前端预览草稿时就能看到已经修复过的高质量文本，而不是看到有问题的文本然后在写库时才发现被拦截；第二，`persistDraft` 的职责保持纯粹——它只负责"门禁"，不负责"修复"，这符合单一职责原则；第三，生成阶段的时间容忍度更高（用户预期生成需要等待），而写库阶段用户预期是即时的。

**为什么最大重试次数设为 2？**

设为 2 次是在"修复成功率"和"生成时间"之间的平衡。根据经验，大多数可修复的问题（字数不足、第一人称不足、钩子空泛）在第 1 次重写时就能解决。第 2 次重试主要针对第 1 次重写引入了新问题的边缘情况。超过 2 次通常意味着问题出在 Beat 规划本身，而不是 Writer 的执行，此时应该标记为 warning 让人工介入。
