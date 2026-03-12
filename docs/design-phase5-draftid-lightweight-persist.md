# Phase 5 技术设计：draftId 轻量 Persist

## 1. 现状

### 当前数据流

```
前端 generateDraft()
  → POST /pipeline/:novelId/episode-script-generate-draft
  → 后端 generateDraft() / generateDraftMultiStage()
  → 返回完整 { draft: { episodePackage: {...} }, ... }
  → 前端存入 state: episodeScriptDraft

前端 persist()
  → POST /pipeline/:novelId/episode-script-persist
  → body: { draft: episodeScriptDraft, generationMode }
  → 后端 persistDraft() 解析 dto.draft → validate → 事务写三张表
```

### 已知问题

| 问题 | 状态 |
|------|------|
| body-parser 默认 100KB 导致 PayloadTooLargeError | 已止血（调大到 20MB） |
| 61 集完整 draft JSON ≈ 2~8MB，每次 persist 全量回传 | 未根治 |
| 集数增长（如 120 集）或字段丰富后可能再次逼近 limit | 潜在风险 |
| draft 完全由后端生成，原路回传属于无意义网络往返 | 设计缺陷 |
| 前端页面刷新 → draft 丢失 → 需重新生成 | 用户体验问题 |

### 当前关键文件

| 文件 | 角色 |
|------|------|
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | 后端核心：`generateDraft()` / `persistDraft()` |
| `apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts` | 后端 DTO：`PipelineEpisodeScriptPersistDto` |
| `apps/web/src/lib/pipeline-episode-script-api.ts` | 前端 API client |
| `apps/web/src/types/pipeline.ts` | 前端类型：`PipelineEpisodeScriptPersistPayload` / `...GenerateDraftResponse` |
| `apps/web/src/components/PipelinePanel.tsx` | 前端状态管理 + persist 调用 |

## 2. 目标

### 核心变化

```
generateDraft 成功后：
  → 后端缓存完整 draft（内存 Map）
  → 返回响应新增 draftId（UUID）
  → 前端保存 draftId

persist 时：
  → 前端优先发送 { novelId, generationMode, draftId }（payload < 1KB）
  → 后端从缓存取 draft → 执行原有 persist 逻辑
  → 若 draftId 过期或不存在 → 前端 fallback 传 full draft（兼容旧模式）
```

### 量化收益

| 指标 | 当前 | 改进后 |
|------|------|--------|
| persist 请求体大小 | 2~8MB | < 1KB（draftId 模式） |
| 超 body limit 风险 | 有（集数增长） | 无（轻量 payload） |
| 网络往返 | 大 JSON × 2（生成 + 回传） | 大 JSON × 1（只生成返回） |
| 刷新丢失 | 是 | 是（内存缓存也丢失，但比当前不差） |

## 3. 设计细节

### 3.1 后端缓存结构

在 `PipelineEpisodeScriptService` 内新增私有属性：

```typescript
// pipeline-episode-script.service.ts

interface CachedDraft {
  novelId: number;
  generationMode: string;
  draft: EpisodePackage;
  createdAt: number;
}

private readonly draftCache = new Map<string, CachedDraft>();
private readonly DRAFT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟
```

选择 `Map` 而非外部存储的原因：
- 零依赖，当前项目单进程部署
- draft 生命周期短（生成 → 确认写入，通常几分钟内完成）
- 最大并发用户极少，内存占用可控

### 3.2 draftId 生成方式

```typescript
import { randomUUID } from 'crypto';

private generateDraftId(): string {
  return randomUUID(); // 标准 UUID v4
}
```

不使用时间戳或递增 ID，避免可猜测性。

### 3.3 TTL 策略

```typescript
private cacheDraft(draftId: string, entry: CachedDraft): void {
  this.draftCache.set(draftId, entry);
  this.cleanExpiredDrafts();
}

private getCachedDraft(draftId: string): CachedDraft | null {
  const entry = this.draftCache.get(draftId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > this.DRAFT_CACHE_TTL_MS) {
    this.draftCache.delete(draftId);
    return null;
  }
  return entry;
}

private cleanExpiredDrafts(): void {
  const now = Date.now();
  for (const [key, entry] of this.draftCache) {
    if (now - entry.createdAt > this.DRAFT_CACHE_TTL_MS) {
      this.draftCache.delete(key);
    }
  }
}
```

- 每次 `cacheDraft` 时顺便清理过期条目
- 30 分钟 TTL 覆盖正常使用场景（生成 → 检查 → 写入通常 < 10 分钟）

### 3.4 generateDraft 返回增加 draftId

当前 `generateDraft()` 和 `generateDraftMultiStage()` 最终都返回一个对象。在返回前缓存并附带 `draftId`：

```typescript
// generateDraft() 末尾 —— 单次生成路径
const draftId = this.generateDraftId();
this.cacheDraft(draftId, {
  novelId,
  generationMode: dto.generationMode || 'outline_and_script',
  draft,
  createdAt: Date.now(),
});

return {
  draftId,                        // ← 新增
  usedModelKey,
  generationMode: ...,
  draft: { episodePackage: draft },
  // ...其余字段不变
};
```

`generateDraftMultiStage()` 末尾同理。

### 3.5 后端 DTO 兼容升级

```typescript
// pipeline-episode-script.dto.ts

export class PipelineEpisodeScriptPersistDto {
  @IsOptional()
  @IsString()
  draftId?: string;               // ← 新增，优先级高于 draft

  @IsOptional()                   // ← 从必填改为可选
  @IsObject()
  draft?: Record<string, any>;

  @IsOptional()
  @IsIn(episodeGenerationModes)
  generationMode?: EpisodeGenerationMode;
}
```

校验逻辑：`draftId` 和 `draft` 至少提供一个。在 `persistDraft()` 方法开头实现。

### 3.6 persistDraft 优先走 draftId

```typescript
async persistDraft(novelId: number, dto: PipelineEpisodeScriptPersistDto) {
  let resolvedDraft: Record<string, any>;
  let draftSource: 'cache' | 'payload';

  if (dto.draftId) {
    const cached = this.getCachedDraft(dto.draftId);
    if (cached) {
      if (cached.novelId !== novelId) {
        throw new BadRequestException('draftId 与当前 novelId 不匹配');
      }
      resolvedDraft = { episodePackage: cached.draft };
      draftSource = 'cache';
      this.logger.log(
        `[episode-script][persist][draftId] hit cache, draftId=${dto.draftId}`,
      );
    } else if (dto.draft) {
      resolvedDraft = dto.draft;
      draftSource = 'payload';
      this.logger.warn(
        `[episode-script][persist][draftId] cache miss (expired?), falling back to payload draft, draftId=${dto.draftId}`,
      );
    } else {
      throw new BadRequestException(
        'draftId 已过期且未提供 draft fallback，请重新生成草稿',
      );
    }
  } else if (dto.draft) {
    resolvedDraft = dto.draft;
    draftSource = 'payload';
  } else {
    throw new BadRequestException('必须提供 draftId 或 draft');
  }

  // 后续逻辑不变，使用 resolvedDraft 替代原来的 dto.draft
  // ...
}
```

### 3.7 前端类型升级

```typescript
// apps/web/src/types/pipeline.ts

export interface PipelineEpisodeScriptGenerateDraftResponse {
  draftId?: string               // ← 新增
  usedModelKey: string
  // ...其余不变
}

export interface PipelineEpisodeScriptPersistPayload {
  draftId?: string               // ← 新增，优先
  draft?: PipelineEpisodeScriptDraft  // ← 从必填改为可选
  generationMode?: PipelineEpisodeGenerationMode
}
```

### 3.8 前端状态管理

```typescript
// PipelinePanel.tsx

const [episodeScriptDraftId, setEpisodeScriptDraftId] = useState<string | undefined>(undefined)

// generateDraft 成功后
setEpisodeScriptDraftId(result.draftId)

// persist 时构造 payload
const persistPayload: PipelineEpisodeScriptPersistPayload = episodeScriptDraftId
  ? {
      draftId: episodeScriptDraftId,
      generationMode: episodeScriptGenerationMode,
    }
  : {
      draft: episodeScriptDraft!,
      generationMode: episodeScriptGenerationMode,
    }

// onClose 清理
setEpisodeScriptDraftId(undefined)
```

### 3.9 persist 错误处理与 fallback

前端 persist 失败时，如果后端返回 "draftId 已过期" 错误，自动用 full draft 重试一次：

```typescript
// PipelinePanel.tsx — handlePersistEpisodeScriptDraft

try {
  const result = await pipelineEpisodeScriptApi.persistEpisodeScriptDraft(novelId, persistPayload)
  // ...成功处理
} catch (err: any) {
  const isDraftIdExpired = err?.message?.includes('draftId 已过期')
  if (isDraftIdExpired && episodeScriptDraft) {
    // fallback: 用 full draft 重试
    const fallbackPayload = {
      draft: episodeScriptDraft,
      generationMode: episodeScriptGenerationMode,
    }
    const result = await pipelineEpisodeScriptApi.persistEpisodeScriptDraft(novelId, fallbackPayload)
    // ...成功处理
  } else {
    alert(err?.message || '写入失败')
  }
}
```

## 4. 风险与兼容性

### 4.1 内存占用

| 场景 | 单个 draft 体积 | 同时缓存数 | 总内存 |
|------|----------------|-----------|--------|
| 61 集 | ~5MB | 1 | 5MB |
| 61 集 | ~5MB | 5（5 个用户并行） | 25MB |
| 120 集 | ~10MB | 3 | 30MB |

Node.js 默认堆上限 ~1.5GB，内存占用完全可接受。

### 4.2 服务重启后 draftId 失效

- **现象**：用户生成 draft 后如果后端重启，draftId 缓存丢失
- **缓解**：前端自动 fallback 到 full draft 传输（见 3.9）
- **用户感知**：无感，只是那一次 persist 请求体变大
- **长期方案**：Phase 6 可升级到 Redis 持久化缓存

### 4.3 多实例问题

- **当前**：项目单进程单实例部署，无此问题
- **未来**：如果部署多实例，需用共享缓存（Redis）替换内存 Map
- **建议**：Phase 6 迁移至 Redis，接口不变

### 4.4 向后兼容

| 调用方 | 旧行为 | 新行为 | 兼容性 |
|--------|--------|--------|--------|
| 前端传 full draft（旧版本前端） | 正常工作 | 正常工作（走 payload 路径） | ✅ 完全兼容 |
| 前端传 draftId（新版本前端） | N/A | 优先走缓存 | ✅ |
| 前端传 draftId + draft（带 fallback） | N/A | 优先缓存，缓存失效用 draft | ✅ |
| 后端 generateDraft 返回多了 draftId | 旧前端忽略 | 新前端使用 | ✅ optional 字段 |

### 4.5 日志策略

| 日志 | 内容 |
|------|------|
| `[persist][draftId] hit cache` | draftId 命中缓存 |
| `[persist][draftId] cache miss` | draftId 未命中，fallback 到 payload |
| `[persist][draftId] expired` | draftId 过期 |
| `[generateDraft][cache] stored` | 生成后缓存 draft，记录 draftId、novelId、draftSizeKB |
| `[draftCache][cleanup]` | 清理过期条目数量 |

## 5. 实施清单

### 后端

| 文件 | 改动内容 |
|------|---------|
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | 1. 新增 `draftCache: Map<string, CachedDraft>` 和 TTL 常量<br>2. 新增 `generateDraftId()`、`cacheDraft()`、`getCachedDraft()`、`cleanExpiredDrafts()`<br>3. `generateDraft()` 末尾缓存 draft 并在返回值增加 `draftId`<br>4. `generateDraftMultiStage()` 末尾同理<br>5. `persistDraft()` 开头增加 draftId 优先 → fallback → 报错 三段逻辑<br>6. 增加相关日志 |
| `apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts` | 1. `PipelineEpisodeScriptPersistDto.draft` 从 `@IsObject()` 必填改为 `@IsOptional() @IsObject()`<br>2. 新增 `@IsOptional() @IsString() draftId?: string` |

### 前端

| 文件 | 改动内容 |
|------|---------|
| `apps/web/src/types/pipeline.ts` | 1. `PipelineEpisodeScriptGenerateDraftResponse` 新增 `draftId?: string`<br>2. `PipelineEpisodeScriptPersistPayload.draft` 改为 optional<br>3. `PipelineEpisodeScriptPersistPayload` 新增 `draftId?: string` |
| `apps/web/src/components/PipelinePanel.tsx` | 1. 新增 state `episodeScriptDraftId`<br>2. `handleGenerateEpisodeScriptDraft` 成功后 `setEpisodeScriptDraftId(result.draftId)`<br>3. `handlePersistEpisodeScriptDraft` 构造 payload 时优先用 draftId<br>4. persist 失败时 fallback 到 full draft 重试<br>5. onClose 清理 draftId |
| `apps/web/src/lib/pipeline-episode-script-api.ts` | 无需修改（payload 类型自动跟随 `PipelineEpisodeScriptPersistPayload` 变化） |

### 不需要改的

| 文件 | 原因 |
|------|------|
| `pipeline.controller.ts` | 路由不变，透传 DTO |
| 数据库 schema | 无新表，无新字段 |
| `PipelineEpisodeScriptDialog.tsx` | persist 逻辑在 PipelinePanel 中，Dialog 只触发回调 |

### 预计工作量

| 步骤 | 估时 |
|------|------|
| 后端缓存 + draftId 生成 + persistDraft 兼容 | 2~3 小时 |
| 前端类型 + state + payload 切换 + fallback | 1~2 小时 |
| 集成测试（生成 → persist → DB 核查） | 1 小时 |
| **合计** | **0.5~1 天** |
