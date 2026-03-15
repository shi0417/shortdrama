# Cursor 指令：增强 `EpisodeStoryGenerationService` 中的调试日志

**目标：** 在 `apps/api/src/pipeline/episode-story-generation.service.ts` 文件中增加更详细的调试日志，特别是在错误处理和关键业务逻辑点，以便更好地诊断“点击生成草稿后退出，也没有调试日志”的问题。

**修改策略：**

1.  **统一错误日志输出：** 确保所有 `throw new BadRequestException` 之前都伴随一个 `this.logger.error` 调用，记录完整的错误堆栈和相关上下文信息。
2.  **增强外部 API 调用日志：** 在调用外部 LLM API（`fetch`）之前、之后以及捕获其错误时，增加详细日志。
3.  **关键数据解析日志：** 在解析 LLM 返回的 JSON 数据时，增加日志以记录原始返回内容和解析结果。
4.  **业务逻辑关键点日志：** 在 `generateDraft` 方法内部，`runBeatPlanner`、`runP2WriterBatch` 和 `autoRewriteIfNeeded` 等关键步骤的入口和出口增加日志，记录输入参数和返回结果的摘要。

**具体修改点（Cursor 应根据上下文智能应用）：**

## `apps/api/src/pipeline/episode-story-generation.service.ts`

### `generateDraft` 方法

*   **方法入口处：** 增加日志记录 `novelId`, `targetCount`, `batchSize`, `referenceTables.length`。
    ```typescript
    this.logger.log(
      `[episode-story][generateDraft] novelId=${novelId} targetCount=${targetCount} batchSize=${batchSize} refTablesCount=${referenceTables.length}`,
    );
    ```
*   **`beatBatches` 循环内部：**
    *   在调用 `this.runBeatPlanner` 之前，记录当前批次的 `startEp` 和 `endEp`。
    *   在调用 `this.runP2WriterBatch` 之前，记录当前批次的 `startEp` 和 `endEp`。
    *   在 `autoRewriteIfNeeded` 循环内部，如果 `rewriteResult.finalDiagnosis.needsRewrite` 为 true，除了现有警告，可以考虑增加 `this.logger.error` 记录详细的 `diagnosis.issues`。

### `runBeatPlanner` 方法

*   **LLM API 请求前：** 记录请求的 `body` (截断敏感信息，例如 `packsJson` 可以只记录前几百个字符)。
    ```typescript
    this.logger.debug(`[episode-story][beat-planner] Request body preview: ${body.slice(0, 500)}`);
    ```
*   **LLM API 响应后：** 记录 `res.status` 和 `raw` 响应的预览。
    ```typescript
    this.logger.log(`[episode-story][beat-planner][raw] status=${res.status} preview=${raw.trim().slice(0, 500)}`);
    ```
*   **错误处理：** 在 `if (!res.ok)` 抛出 `BadRequestException` 之前，增加 `this.logger.error` 记录详细错误信息。
    ```typescript
    if (!res.ok) {
      this.logger.error(`[episode-story][beat-planner] LLM request failed: status=${res.status}, raw=${raw}`);
      throw new BadRequestException(`Beat Planner request failed: ${res.status}`);
    }
    ```
*   **JSON 解析后：** 记录 `parsed` 结果的摘要或长度。
    ```typescript
    this.logger.debug(`[episode-story][beat-planner] Parsed beats count: ${parsedBeats.length}`);
    ```
*   **`arr.length !== batch.length` 警告处：** 增加 `this.logger.error` 记录详细的 `parsed` 内容，以便分析为什么数量不匹配。

### `runP2WriterBatch` 方法

*   **LLM API 请求前：** 记录请求的 `body` (截断敏感信息)。
    ```typescript
    this.logger.debug(`[episode-story][p2-writer] Request body preview: ${body.slice(0, 500)}`);
    ```
*   **LLM API 响应后：** 记录 `res.status` 和 `raw` 响应的预览。
    ```typescript
    this.logger.log(`[episode-story][p2-writer][raw] status=${res.status} preview=${raw.trim().slice(0, 500)}`);
    ```
*   **错误处理：** 在 `if (!res.ok)` 抛出 `BadRequestException` 之前，增加 `this.logger.error` 记录详细错误信息。
    ```typescript
    if (!res.ok) {
      this.logger.error(`[episode-story][p2-writer] LLM request failed: status=${res.status}, raw=${raw}`);
      throw new BadRequestException(`P2 Writer batch request failed: ${res.status}`);
    }
    ```
*   **JSON 解析后：** 记录 `parsed` 结果的摘要或长度。
    ```typescript
    this.logger.debug(`[episode-story][p2-writer] Parsed items count: ${arr.length}`);
    ```
*   **`arr.length === 0` 和 `arr.length < beats.length` 抛出异常前：** 增加 `this.logger.error` 记录详细原因和 `raw` 响应。
    ```typescript
    if (arr.length === 0) {
      this.logger.error(`[episode-story][p2-writer] Empty result from LLM. Raw response: ${raw}`);
      throw new BadRequestException("P2 Writer returned empty result.");
    }
    // ... 类似地处理 arr.length < beats.length
    ```
*   **`!isValid` 处：** 记录 `epNum` 和 `normalizedStoryText` 的值，以及 `isValid` 为 `false` 的具体原因（例如，是否是占位符或长度不足）。
    ```typescript
    if (!isValid) {
      this.logger.warn(`[episode-story][p2-writer] Invalid storyText for ep=${epNum}. Length=${normalizedStoryText?.length}, isPlaceholder=${normalizedStoryText?.trim() === PLACEHOLDER_STORY_TEXT_TEMPLATE(epNum)}. Content preview: ${normalizedStoryText?.slice(0, 100)}`);
      invalidStoryTextCount += 1;
    }
    ```

### `autoRewriteIfNeeded` 方法

*   **循环开始时：** 记录当前尝试次数和 `diagnosis.issues` 的摘要。
    ```typescript
    this.logger.log(
      `[episode-story][auto-rewrite-loop] ep=${episodeNumber} attempt=${attempts}/${AUTO_REWRITE_MAX_RETRIES} issues=${diagnosis.issues.filter((i) => i.severity === 'high').map((i) => i.type).join(',')}`,
    );
    ```
*   **`runAutoRewrite` 失败时：** 捕获 `err` 时，记录完整的错误对象。
    ```typescript
    } catch (err) {
      this.logger.error(
        `[episode-story][auto-rewrite-loop] ep=${episodeNumber} rewrite attempt=${attempts} failed: ${err.message || err}`, err
      );
      break;
    }
    ```

### `runAutoRewrite` 方法

*   **LLM API 请求前：** 记录请求的 `body` (截断敏感信息)。
    ```typescript
    this.logger.debug(`[episode-story][auto-rewrite] Request body preview: ${body.slice(0, 500)}`);
    ```
*   **LLM API 响应后：** 记录 `res.status` 和 `raw` 响应的预览。
    ```typescript
    this.logger.log(`[episode-story][auto-rewrite] ep=${episodeNumber} status=${res.status} rawPreview=${raw.trim().slice(0, 300)}`);
    ```
*   **错误处理：** 在 `if (!res.ok)` 抛出 `BadRequestException` 之前，增加 `this.logger.error` 记录详细错误信息。
    ```typescript
    if (!res.ok) {
      this.logger.error(`[episode-story][auto-rewrite] ep=${episodeNumber} LLM request failed: status=${res.status}, raw=${raw}`);
      throw new BadRequestException(
        `Auto-rewrite request failed for ep=${episodeNumber}: ${res.status}`,
      );
    }
    ```
*   **`rewritten.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE` 抛出异常前：** 增加 `this.logger.error` 记录详细原因和 `rewritten` 内容。
    ```typescript
    if (rewritten.length < MIN_STORY_TEXT_LENGTH_ABSOLUTE) {
      this.logger.error(
        `[episode-story][auto-rewrite] ep=${episodeNumber} rewritten text too short: ${rewritten.length}. Content: ${rewritten}`,
      );
      throw new BadRequestException(
        `Auto-rewrite returned too-short text for ep=${episodeNumber}`,
      );
    }
    ```

**Cursor 指令：**

```
请在 `/home/ubuntu/shortdrama/apps/api/src/pipeline/episode-story-generation.service.ts` 文件中，根据上述“具体修改点”的指导，增加详细的调试日志。在添加日志时，请确保：

1.  使用 `this.logger.log` 记录正常流程的关键信息。
2.  使用 `this.logger.debug` 记录详细的请求/响应体预览，以便在需要时开启更详细的调试。
3.  使用 `this.logger.warn` 记录潜在问题，例如 LLM 返回结果数量不匹配。
4.  使用 `this.logger.error` 记录所有导致 `BadRequestException` 的错误，并尽可能包含完整的错误对象或相关上下文信息。
5.  对于 `fetch` 调用的 `body` 和 `raw` 响应，请进行适当的截断（例如 `slice(0, 500)`），以避免日志过长。
6.  在 `generateDraft` 方法的 `for (let i = 0; i < beatBatches.length; i++)` 循环中，在每次循环开始时增加日志，记录当前处理的批次信息（例如 `batchIndex`, `startEp`, `endEp`）。
7.  在 `generateDraft` 方法的 `for (let j = 0; j < batchDraft.length; j++)` 循环中，在 `if (!isValid)` 处增加日志，记录 `normalizedStoryText` 的值和 `isValid` 为 `false` 的具体原因。

完成修改后，请列出所有修改过的代码块，并简要说明每处修改的目的。
```
