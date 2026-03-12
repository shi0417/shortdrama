# Phase 5a：draftId 轻量 Persist 实现报告

## 1. 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | 修改 | 新增 draftCache、缓存方法、generateDraft 缓存 draft 并返回 draftId、persistDraft 支持 draftId 优先 |
| `apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts` | 修改 | PersistDto 新增 `draftId?`，`draft` 改为 optional |
| `apps/web/src/types/pipeline.ts` | 修改 | GenerateDraftResponse 新增 `draftId?`，PersistPayload 新增 `draftId?`、`draft` 改为 optional |
| `apps/web/src/components/PipelinePanel.tsx` | 修改 | 新增 `episodeScriptDraftId` state，persist 优先走 draftId，实现 cache miss 自动 fallback |

## 2. 后端缓存实现说明

### 数据结构

```typescript
interface CachedEpisodeScriptDraft {
  novelId: number;
  generationMode: string;
  draft: any;          // 完整的 { episodePackage: EpisodePackage }
  createdAt: number;   // Date.now() 时间戳
}

private readonly draftCache = new Map<string, CachedEpisodeScriptDraft>();
```

### 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| TTL | 30 分钟 | `DRAFT_CACHE_TTL_MS = 30 * 60 * 1000` |
| 最大缓存数 | 50 | `MAX_CACHED_DRAFTS = 50` |
| draftId 生成 | `crypto.randomUUID()` | UUID v4，不可猜测 |

### 清理策略

1. **TTL 过期清理**：每次 `cacheDraft()` 时遍历清除过期条目
2. **容量淘汰**：超过 50 条时淘汰 `createdAt` 最早的条目
3. **主动删除**：persist 成功后主动删除已消费的 draftId
4. **读取时校验**：`getCachedDraft()` 发现过期自动删除并返回 null

### 缓存存储时机

`generateDraft()` 的两条路径（legacy 单次 + multi-stage）最终返回前均执行：

```typescript
const draftId = this.generateDraftId();
this.cacheDraft(draftId, { novelId, generationMode, draft: { episodePackage: draft }, createdAt: Date.now() });
// 返回值中包含 draftId
```

## 3. DTO 与接口兼容性说明

### 后端 DTO 变更

```typescript
// PipelineEpisodeScriptPersistDto
draftId?: string;    // 新增，可选
draft?: Record<string, any>;  // 从必填改为可选
generationMode?: EpisodeGenerationMode;  // 不变
```

### 前端类型变更

```typescript
// PipelineEpisodeScriptGenerateDraftResponse
draftId?: string;    // 新增，可选

// PipelineEpisodeScriptPersistPayload
draftId?: string;    // 新增
draft?: PipelineEpisodeScriptDraft;  // 从必填改为可选
```

### 兼容旧前端

| 旧前端行为 | 兼容性 |
|-----------|--------|
| 只传 `{ draft, generationMode }` | ✅ 完全兼容，走 payload 路径 |
| 不解析 `draftId` 字段 | ✅ optional 字段，忽略即可 |
| 不传 `draftId` | ✅ 自动走旧逻辑 |

## 4. persist draftId 优先逻辑说明

### 解析优先级

```
1. dto.draftId 存在
   ├─ 缓存命中 → 校验 novelId 一致性 → 使用缓存 draft → draftSource='cache'
   ├─ 缓存未命中 + dto.draft 存在 → 使用 payload draft → draftSource='payload' + warn 日志
   └─ 缓存未命中 + dto.draft 不存在 → 抛错 EPISODE_SCRIPT_DRAFT_CACHE_MISS

2. dto.draftId 不存在
   ├─ dto.draft 存在 → 使用 payload draft → draftSource='payload'
   └─ dto.draft 不存在 → 抛错 EPISODE_SCRIPT_DRAFT_REQUIRED
```

### 错误码

| 错误码 | 触发条件 |
|--------|---------|
| `EPISODE_SCRIPT_DRAFT_CACHE_MISS` | draftId 过期或不存在，且无 fallback draft |
| `EPISODE_SCRIPT_DRAFT_ID_NOVEL_MISMATCH` | 缓存中 novelId 与请求 novelId 不一致 |
| `EPISODE_SCRIPT_DRAFT_REQUIRED` | 既无 draftId 也无 draft |

错误格式：`throw new BadRequestException({ message: '...', code: '...' })`
前端可通过 `err.payload.code` 读取。

### novelId 校验

如果缓存命中但 `cached.novelId !== novelId`，直接抛 `EPISODE_SCRIPT_DRAFT_ID_NOVEL_MISMATCH`，阻止跨项目写入。

### 成功后删除缓存

```typescript
if (usedDraftId) {
  this.deleteCachedDraft(usedDraftId);
  // 日志: [persist][draftId][deleted_after_success]
}
```

## 5. 前端 state 与 fallback 说明

### episodeScriptDraftId

```typescript
const [episodeScriptDraftId, setEpisodeScriptDraftId] = useState<string | undefined>(undefined)
```

| 时机 | 操作 |
|------|------|
| generate 成功 | `setEpisodeScriptDraftId(result.draftId)` |
| 弹窗关闭 | `setEpisodeScriptDraftId(undefined)` |
| persist 构造 payload 时 | 如果有 draftId，只传 `{ draftId, generationMode }`；否则传 full draft |

### persist 请求流程

```
1. 有 draftId → 发送 { draftId, generationMode }（payload < 1KB）
2. 无 draftId → 发送 { draft, generationMode }（full draft）
3. 如果 draftId 模式失败
   ├─ err.payload.code === 'EPISODE_SCRIPT_DRAFT_CACHE_MISS' 且本地有 draft
   │   → 自动用 full draft 重试一次
   │   → 日志: [persist][frontend][fallback]
   └─ 其它错误 → 直接弹出错误提示
```

### fallback 重试策略

- 仅重试 **一次**
- 仅在错误码为 `EPISODE_SCRIPT_DRAFT_CACHE_MISS` 或 `EPISODE_SCRIPT_DRAFT_EXPIRED` 时触发
- 仅在前端本地仍持有 `episodeScriptDraft` 时触发
- fallback 成功 → 正常提示
- fallback 失败 → 弹出最终错误

## 6. 日志增强说明

### 后端新增日志

| 标签 | 字段 | 触发时机 |
|------|------|---------|
| `[generateDraft][cache][stored]` | draftId, novelId, generationMode, draftSizeKB, cacheSize | 两条 generateDraft 路径缓存 draft 后 |
| `[persist][draftId][hit]` | draftId, novelId | 缓存命中 |
| `[persist][draftId][miss]` | draftId, novelId, fallback | 缓存未命中 |
| `[persist][draftId][mismatch]` | draftId, cachedNovelId, requestNovelId | novelId 不匹配 |
| `[persist][draftId][deleted_after_success]` | draftId, novelId | persist 成功后删除缓存 |
| `[persist][entry]` 增强 | 新增 draftSource, draftId | 每次 persist 入口 |
| `[persist][start]` 增强 | 新增 draftSource | 校验后开始写入 |
| `[persist][done]` 增强 | 新增 draftSource, draftId | 完成 |

### 前端新增日志

| 标签 | 字段 | 条件 |
|------|------|------|
| `[persist][frontend][payload]` 增强 | 新增 persistMode, draftId | 每次 persist |
| `[persist][frontend][fallback]` | novelId, draftId, errorCode | draftId 失败后 fallback |

## 7. 验证结果

> 注意：当前执行环境 Shell 工具无法捕获命令行输出，以下列出需要你本地执行的验证步骤。

### 验证 1：generate 返回 draftId

**操作**：重启后端 → 前端生成草稿

**预期**：
- 后端日志出现 `[generateDraft][cache][stored]` 含 `draftId`, `draftSizeKB`, `cacheSize`
- 前端 DevTools 的 response 中包含 `draftId` 字段（UUID 格式）
- 前端 state `episodeScriptDraftId` 有值

### 验证 2：persist 正常命中缓存

**操作**：生成后直接点击"确认写入数据库"

**预期**：
- 前端日志 `persistMode: 'draftId'`，payload 很小（< 1KB）
- 后端日志 `[persist][draftId][hit]`
- 后端日志 `[persist][entry]` 含 `draftSource: 'cache'`
- 后端日志 `[persist][draftId][deleted_after_success]`
- 后端日志 `[persist][done]` 含 `draftSource: 'cache'`
- 写入成功

### 验证 3：check script

```bash
node scripts/check-persist-tables.js 1
```

三张表应正常输出。

### 验证 4：重启后端后 persist fallback

**操作**：
1. 生成草稿（拿到 draftId）
2. 不关前端
3. 重启后端（缓存丢失）
4. 点击"确认写入数据库"

**预期**：
- 后端日志 `[persist][draftId][miss]` fallback='none'（因为前端第一次只传 draftId）
- 后端返回 400 + code: `EPISODE_SCRIPT_DRAFT_CACHE_MISS`
- 前端日志 `[persist][frontend][fallback]`
- 前端自动用 full draft 重试
- 后端第二次收到完整 draft，`[persist][entry]` 含 `draftSource: 'payload'`
- 最终写入成功

## 8. 风险与后续建议

1. **内存缓存不持久**：后端重启后所有 draftId 失效。前端 fallback 可兜底，但用户体验略差。后续可考虑 Redis 持久化。
2. **并发写入**：同一 draftId 被两个请求同时 persist 不会死锁（第二个会 cache miss），但可能重复写入。当前单用户场景可接受。
3. **内存占用**：单个 61 集 draft ≈ 5MB，50 个缓存上限 = 最大 250MB。单用户场景远不会达到。
4. **draftId 不可重复使用**：persist 成功后 draftId 被删除。如果需要"多次写入同一 draft"（如写入后再修改再写入），当前不支持，需要重新 generate。
5. **下一步方向**：Phase 5b 可实现任务化真实进度条（轮询方案），与 draftId 机制天然配合。
