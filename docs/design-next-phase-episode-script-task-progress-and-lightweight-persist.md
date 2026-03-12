# 下一阶段设计简报：轻量 Persist + 真实进度条

> 本文档只做设计，不实现。供决策参考。

---

## 一、draftId / token 轻量 Persist

### 为什么要做

当前 persist 链路：前端将完整 draft JSON（61 集约 2~8MB）整包发给后端。问题：

1. **体积风险**：集数增长或字段丰富后，payload 可能再次逼近 body limit
2. **传输浪费**：draft 是后端生成的，原样传回后端再解析，属于无意义往返
3. **可靠性差**：浏览器侧如果用户不小心刷新或网络中断，整个 draft 丢失

### 最小落地路径

```
[generateDraft] → 后端生成完毕后，将完整 draft 缓存在服务端内存/Redis/临时表
                → 返回 { draftId: 'uuid', draft: {...}, ... }

[persistDraft]  → 前端发送 { draftId: 'uuid', novelId: 1 }
                → 后端从缓存取 draft → 执行原有 persist 逻辑
```

### 要改的接口 / 状态

| 组件 | 变更 |
|------|------|
| `pipeline-episode-script.service.ts` | `generateDraft` 返回增加 `draftId`；新增内存 Map 或 Redis 缓存存储 draft |
| `pipeline-episode-script.dto.ts` | `PersistDto` 增加 `draftId?: string`，`draft` 改为 optional |
| `persistDraft()` | 优先从 `draftId` 取缓存 draft，fallback 到 dto.draft |
| 前端 `PipelinePanel.tsx` | 记录 `draftId`，persist 时优先传 `draftId` |
| 前端 `pipeline-episode-script-api.ts` | persist payload 结构调整 |

### 缓存策略选择

| 方式 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| Node.js 内存 Map | 零依赖、实现最快 | 重启丢失、多实例不共享 | ★★★★ 当前阶段推荐 |
| Redis | 持久、多实例共享 | 需额外依赖 | ★★★ 中期推荐 |
| 数据库临时表 | 无额外服务 | 需建表、查询开销 | ★★ |

**推荐先用内存 Map + TTL（30 分钟过期），单进程场景完全够用。**

### 风险点

1. **内存占用**：单个 draft 约 5MB，10 个并发用户 = 50MB，可接受
2. **缓存过期**：用户生成后超过 30 分钟才 persist，需 fallback 到重新传 full draft
3. **向后兼容**：persist 接口需同时支持 `draftId` 和 `draft` 两种模式，过渡期不能断

---

## 二、任务化真实进度条（优先轮询方案）

### 为什么要做

当前 `generateDraft` 是同步长轮询 HTTP 请求，61 集生成可能持续 3~10 分钟。用户体验问题：

1. 前端只能用伪阶段定时器，不反映真实进度
2. 请求超时风险（某些代理/负载均衡器默认 60s 超时）
3. 用户刷新页面后生成结果丢失

### 推荐方案：轮询任务状态

```
[startGeneration]  → POST /pipeline/:novelId/episode-script-generate-draft
                   → 后端立即返回 { taskId: 'uuid' }
                   → 后端在后台线程/worker 中执行 plan → batch → merge

[pollProgress]     → GET /pipeline/task/:taskId/status
                   → 返回 { 
                       status: 'running' | 'done' | 'failed',
                       phase: 'plan' | 'batch' | 'merge' | 'repair',
                       currentBatch: 3,
                       totalBatches: 13,
                       progressPercent: 25,
                       message: '正在分批生成（Batch 3/13）',
                       result?: {...},  // status === 'done' 时返回完整结果
                       error?: string,  // status === 'failed' 时返回错误
                     }

[前端]             → 每 3~5 秒轮询一次
                   → 根据返回的 phase/currentBatch 更新 UI
                   → status === 'done' 时取 result 展示草稿
```

### 要改的接口 / 状态

| 组件 | 变更 |
|------|------|
| `pipeline.controller.ts` | 新增 `POST .../episode-script-start-generate`（返回 taskId）和 `GET .../task/:taskId/status` |
| `pipeline-episode-script.service.ts` | `generateDraft` 拆为 `startGeneration`（写入任务状态、启动后台流程）和 `getTaskStatus` |
| 任务状态存储 | 新增内存 Map: `Map<taskId, TaskState>`（轻量实现，无需建表） |
| 前端 `PipelinePanel.tsx` | `handleGenerateEpisodeScriptDraft` 改为 start + poll 循环 |
| 前端 `pipeline-episode-script-api.ts` | 新增 `startGeneration()` 和 `pollTaskStatus()` |

### 任务状态结构

```typescript
interface GenerationTaskState {
  taskId: string;
  novelId: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  phase: 'plan' | 'batch' | 'merge' | 'repair' | 'idle';
  currentBatch: number;
  totalBatches: number;
  startedAt: number;
  updatedAt: number;
  result?: any;
  error?: string;
}
```

### 进度更新时机

在现有 `generateDraftMultiStage` 各阶段已有详细日志的位置，同步更新 TaskState：

| 现有日志 | 更新动作 |
|---------|---------|
| `[plan][start]` | phase='plan' |
| `[plan][done]` | phase='batch', currentBatch=0 |
| `[batch][N][start]` | currentBatch=N |
| `[batch][N][done]` | currentBatch++ |
| `[merge][start]` | phase='merge' |
| `[merge][done]` | status='done', result=... |
| 任何 catch | status='failed', error=... |

### 前端轮询策略

```
poll interval: 3s（plan 阶段）→ 5s（batch 阶段）→ 2s（merge 阶段）
max poll time: 15 分钟（超时自动停止并提示）
cleanup: 结果获取后停止轮询
```

### 方案对比

| 维度 | 轮询 | SSE | WebSocket |
|------|------|-----|-----------|
| 实现复杂度 | 低 | 中 | 高 |
| 服务端改动 | 新增 1 个 GET 接口 | 需 SSE controller | 需 WS gateway |
| 前端改动 | `setInterval` + fetch | `EventSource` | `WebSocket` 管理 |
| 实时性 | 3~5s 延迟 | 准实时 | 准实时 |
| 兼容性 | 最好 | 好 | 好 |
| 推荐度 | ★★★★★ | ★★★ | ★★ |

**推荐轮询方案：改动最小、最稳定、对当前架构零侵入。**

### 风险点

1. **后台执行稳定性**：当前 `generateDraftMultiStage` 是同步函数，改为后台执行需确保异常被正确捕获
2. **内存泄漏**：TaskState Map 需要 TTL 清理机制（如 30 分钟过期）
3. **并发控制**：同一 novelId 不应允许多个生成任务并行，需加锁
4. **向后兼容**：保留原有同步接口作为 fallback，新接口为独立路由

---

## 三、推荐实施路径

| 阶段 | 内容 | 预计工作量 | 优先级 |
|------|------|-----------|--------|
| **Phase 5a** | draftId 轻量 persist（内存 Map） | 0.5~1 天 | 高 |
| **Phase 5b** | 任务化 + 轮询进度条 | 1~2 天 | 高 |
| Phase 6 | Redis 缓存替换内存 Map | 0.5 天 | 中 |
| Phase 7 | SSE 替换轮询（可选） | 1 天 | 低 |

**建议先做 5a（解决 payload 传输问题），再做 5b（解决用户体验问题）。两者可独立实施。**
