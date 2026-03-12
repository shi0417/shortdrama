# 生成每集纲要和每集剧本：Persist 失败与进度条能力调查报告

## 1. 调查范围
- 前端：`apps/web/src/components/PipelinePanel.tsx`、`apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`、`apps/web/src/lib/pipeline-episode-script-api.ts`、`apps/web/src/lib/api.ts`、`apps/web/src/types/pipeline.ts`
- 后端：`apps/api/src/pipeline/pipeline.controller.ts`、`apps/api/src/pipeline/pipeline-episode-script.service.ts`、`apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts`、`apps/api/src/main.ts`、`apps/api/src/app.module.ts`、`apps/api/src/config/database.config.ts`
- 日志与运行证据：结合你提供的报错（`PayloadTooLargeError: request entity too large`，栈在 `raw-body/body-parser/express`）以及代码链路定位
- 数据库核查：已尝试通过本地连接与 API 侧查询校验，但受当前环境访问条件限制，无法拿到三张表的直接 SQL 结果（详见第 5 节证据和阻塞点）

## 2. 前端 persist 调用链与请求体分析
- **点击入口**：`PipelineEpisodeScriptDialog.tsx` 的 `onPersistDraft` -> `PipelinePanel.tsx` 的 `handlePersistEpisodeScriptDraft()`
- **调用函数**：`handlePersistEpisodeScriptDraft()` 内调用 `pipelineEpisodeScriptApi.persistEpisodeScriptDraft(novelId, payload)`
- **请求 API**：`apps/web/src/lib/pipeline-episode-script-api.ts` 中 `POST /pipeline/:novelId/episode-script-persist`
- **请求体结构**（全量）：
  - `draft: PipelineEpisodeScriptDraft`
  - `generationMode?: ...`
- **关键证据**：`PipelineEpisodeScriptPersistPayload` 在 `apps/web/src/types/pipeline.ts` 定义为整包 `draft`，没有 `draftId/token/cacheKey` 机制
- **结论**：persist 请求确实会把完整 `draft.episodePackage`（包含 61 集、每集 `outline/script/structureTemplate/hookRhythm`）整包 `JSON.stringify` 后发送

## 3. 后端 persist 路由与 body limit 现状
- **路由**：`pipeline.controller.ts` 中 `@Post(':novelId/episode-script-persist')` -> `pipelineEpisodeScriptService.persistDraft(...)`
- **DTO**：`PipelineEpisodeScriptPersistDto` 仅含 `draft` + `generationMode`，无轻量引用字段
- **业务入口前置**：请求必须先被 Express body-parser 解析为 JSON，才能进入 Nest Controller
- **body limit 配置检查结果**：
  - `apps/api/src/main.ts` 未显式配置 `app.use(express.json({ limit: ... }))`
  - 未发现其他全局 parser limit 覆盖配置（代码搜索 `bodyParser/express.json/urlencoded/limit` 未命中）
- **推断**：当前使用 Nest 默认 body parser 限制（Express 默认 JSON 体积限制通常为 `100kb` 级别）
- **阶段判断**：如果出现 `PayloadTooLargeError` 且栈在 `raw-body/body-parser/express`，请求会在 Controller 前失败，`persistDraft()` 通常没有机会执行

## 4. 本次日志与错误阶段定位
- 已知错误：`PayloadTooLargeError: request entity too large`
- 栈指向：`raw-body` -> `body-parser` -> `express`
- 该错误与 `pipeline-episode-script.service.ts` 中的 SQL/事务日志（`[episode-script][persist][start]` 等）属于不同阶段：
  - 前者：HTTP 解析层
  - 后者：业务层（只有 body 解析成功才会出现）
- 结合调用链可确认：
  1. 前端传的是整包草稿 JSON
  2. 后端未显式调大 body limit
  3. 请求大概率在 body-parser 阶段被拒绝
  4. 所以“生成成功但写库失败”可成立：生成接口返回成功，persist 接口单独因 payload 超限失败

## 5. 数据库真实落库结果核查
- **目标要求**：核查 `novel_episodes`、`drama_structure_template`、`novel_hook_rhythm`（`novel_id = 1`）
- **本次实际尝试**：
  - 读取到数据库配置来源：`apps/api/src/config/database.config.ts`（默认 `127.0.0.1:3306 / root / 123456 / duanju`）
  - 尝试通过 API 间接核查（`/episodes?novelId=1`）需要 JWT，当前环境无有效 token
  - 尝试使用 README 默认 `admin/123456` 登录，返回 `401 用户名或密码错误`
  - 当前可用 MCP 无数据库查询工具；当前 Shell 输出能力异常（命令执行结果不可见），无法可靠提交 SQL 结果证据
- **结论（就本次调查能力边界）**：
  - 无法在当前执行环境中提供三张表“本次操作后”的直接 SQL 统计与样本硬证据
  - 但根据错误阶段（body-parser）判断，本次报错请求大概率未进入 `persistDraft`，因此“本次点击导致落库”的概率很低
- **待补硬证据建议（你本机可立即执行）**：
  - `SELECT COUNT(*) , MIN(episode_number), MAX(episode_number) FROM novel_episodes WHERE novel_id=1;`
  - `SELECT COUNT(*) , MIN(chapter_id), MAX(chapter_id) FROM drama_structure_template WHERE novels_id=1;`
  - `SHOW TABLES LIKE 'novel_hook_rhythm';`
  - 若存在：`SHOW COLUMNS FROM novel_hook_rhythm;`
  - 若存在：`SELECT COUNT(*), MIN(episode_number), MAX(episode_number) FROM novel_hook_rhythm WHERE novel_id=1;`

## 6. 根因判断
- **1）本次错误是否发生在业务层之前？**
  - 是。证据是异常类型与栈层级（`raw-body/body-parser/express`）而非 service SQL 栈。
- **2）“request entity too large” 的直接原因？**
  - persist 请求体过大，超过当前 JSON body limit。
- **3）是否因为前端 persist 传 61 集整包 JSON？**
  - 是。代码明确 `payload = { draft: episodeScriptDraft, generationMode }`，且 `draft` 为完整 `episodePackage`。
- **4）当前架构下是否会随集数增加更容易超限？**
  - 是。payload 与集数、`script.fullContent` 文本长度近似线性增长。
- **5）配置问题还是接口设计问题？**
  - 两者都有：
    - 配置层：body limit 未显式调优，导致较大 payload 直接失败
    - 接口设计层：persist 依赖“客户端回传整包大 JSON”，天然高风险

## 7. 可选修复方案对比
- **方案 1：最小修复（立即可落地）**
  - 做法：在 `apps/api/src/main.ts` 增加 `express.json({ limit: '10mb'~'50mb' })`（及 urlencoded 同步）
  - 改动范围：小
  - 风险：中（大请求内存占用上升，仍有极限）
  - UX：立刻缓解 61 集 persist 失败
  - 适用性：高（当前最现实）

- **方案 2：中期合理方案（推荐）**
  - 做法：`generateDraft` 成功后把草稿服务端缓存/落草稿表，前端只拿 `draftId/token`；`persist` 只传 `novelId + draftId + generationMode`
  - 改动范围：中（新增草稿存储与过期策略）
  - 风险：中低（需处理草稿生命周期）
  - UX：更稳定，传输体积极小
  - 适用性：很高（解决根因）

- **方案 3：长期正确方案**
  - 做法：后端生成阶段分批持久化中间结果，最终只做“确认提交/切换状态”，前端不再持有大草稿主数据
  - 改动范围：大（任务化/状态机/幂等控制）
  - 风险：中高（架构升级）
  - UX：最佳，可配真实进度、断点恢复
  - 适用性：中（需排期）

## 8. 进度条能力现状与实现建议
- **现状 1：前端表现**
  - `PipelineEpisodeScriptDialog.tsx` 当前仅按钮态：`生成中...`，没有实时百分比
- **现状 2：后端能力**
  - `pipeline-episode-script.service.ts` 已有明确多阶段日志（plan/start/done、batch/start/done/retry、merge/final）
  - 但这些状态只写日志，不会流式回传给当前请求
- **现状 3：接口返回时机**
  - `generateDraft` 是单次长请求，直到全部结束才返回 `batchInfo/repairSummary/finalCompletenessOk`
  - 前端无法在处理中拿到中间进度
- **最大阻碍**
  - 缺少“任务状态持久化 + 轮询或推送通道”，当前是同步阻塞式 HTTP
- **方案建议（结合当前项目）**
  - 近期最适合：**方案 B（轮询任务状态）**
    - 先把 `generateDraft` 改成创建任务并立即返回 `taskId`
    - 后端落阶段进度（plan、当前 batch、总 batch、失败数）
    - 前端每 1~2 秒轮询 `/tasks/:id/status`
  - 过渡可用：**方案 A（伪进度）**
    - 纯前端计时推测，不可靠但实现快
  - 长期最优：**方案 C（SSE/WebSocket）**
    - 实时推送体验最好，但改造量大于轮询

## 9. 推荐实施路径
- **第 0 步（当天）**
  - 后端调大 body limit（先止血）
  - 前端 persist 前打印 payload 字节数（`new Blob([JSON.stringify(payload)]).size`）入日志
- **第 1 步（本周）**
  - 引入 `draftId/token` 持有机制，persist 改轻量请求
  - 保留旧接口一段时间做兼容开关
- **第 2 步（下个迭代）**
  - generate 改任务化 + 轮询进度
  - UI 增加真实进度条（plan/batch x/y）
- **第 3 步（长期）**
  - 评估 SSE/WebSocket，减少轮询成本并支持更细粒度日志可视化

## 10. 待确认项
- 本地数据库真实账号/密码（当前 `admin/123456` 登录 API 不可用，无法拿 token 间接核查）
- 是否允许我在你本机直接执行 SQL（或提供一次只读 DB 连接）
- 当前线上/本地 API 网关是否还有额外请求体限制（Nginx/Caddy/Cloudflare 等）
- 你希望的 persist 风险策略：默认阻断 or 强确认可绕过
- 进度条优先级：先做轮询任务状态（推荐）还是先做伪进度过渡
