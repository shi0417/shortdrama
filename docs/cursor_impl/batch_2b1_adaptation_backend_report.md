# Batch 2B-1 Adaptation Backend Report

## 1) 新增/修改文件清单

- `apps/api/src/adaptation/adaptation.module.ts` (new)
- `apps/api/src/adaptation/adaptation.controller.ts` (new)
- `apps/api/src/adaptation/adaptation.service.ts` (new)
- `apps/api/src/adaptation/dto/create-adaptation-strategy.dto.ts` (new)
- `apps/api/src/adaptation/dto/update-adaptation-strategy.dto.ts` (new)
- `apps/api/src/app.module.ts` (modified: register `AdaptationModule`)

## 2) API 列表与 DTO

All routes are protected by `@UseGuards(JwtAuthGuard)`.

1. `GET /adaptation-modes`
   - default: only active modes (`is_active=1`)
   - supports `?all=1` to return all
2. `GET /novels/:novelId/adaptation-strategies`
   - list a novel's strategy versions (`version DESC`)
3. `POST /novels/:novelId/adaptation-strategies`
   - create strategy with auto `version = max(version)+1` (per novel)
4. `PATCH /adaptation-strategies/:id`
   - update `modeId/strategyTitle/strategyDescription/aiPromptTemplate`
   - empty patch body returns `400`
5. `DELETE /adaptation-strategies/:id`
   - delete one strategy, returns `{ ok: true }`

DTO:

- `CreateAdaptationStrategyDto`
  - `modeId`: `IsInt`, `Min(1)`
  - `strategyTitle?`: `IsString`, `MaxLength(200)`
  - `strategyDescription?`: `IsString`
  - `aiPromptTemplate?`: `IsString`
- `UpdateAdaptationStrategyDto`
  - same optional fields with same validators

## 3) 核心 SQL（关键片段）

```sql
-- list strategies (join mode dictionary)
SELECT
  s.id,
  s.novel_id AS novelId,
  s.mode_id AS modeId,
  m.mode_key AS modeKey,
  m.mode_name AS modeName,
  s.strategy_title AS strategyTitle,
  s.strategy_description AS strategyDescription,
  s.ai_prompt_template AS aiPromptTemplate,
  s.version,
  s.created_at AS createdAt,
  s.updated_at AS updatedAt
FROM novel_adaptation_strategy s
JOIN adaptation_modes m ON m.id = s.mode_id
WHERE s.novel_id = ?
ORDER BY s.version DESC, s.updated_at DESC, s.id DESC;
```

```sql
-- next version per novel
SELECT IFNULL(MAX(version), 0) + 1 AS nextVersion
FROM novel_adaptation_strategy
WHERE novel_id = ?;
```

```sql
-- create strategy
INSERT INTO novel_adaptation_strategy (
  novel_id, mode_id, strategy_title, strategy_description, ai_prompt_template, version
) VALUES (?, ?, ?, ?, ?, ?);
```

## 4) Build 验证

Command:

```bash
pnpm --dir apps/api build
```

Result: passed.

## 5) 接口实测（含 token）

Test account: `s01 / 123456`

PowerShell command style used for local verification:

```powershell
Invoke-RestMethod -Method Post http://localhost:4000/auth/login ...
```

### 5.1 GET /adaptation-modes

Sample response:

```json
[
  {
    "id": 1,
    "modeKey": "historical_rewrite",
    "modeName": "历史改写",
    "isActive": 1,
    "sortOrder": 1
  }
]
```

### 5.2 GET /novels/1/adaptation-strategies

Before create: `[]`

### 5.3 POST /novels/1/adaptation-strategies

Body:

```json
{
  "modeId": 1,
  "strategyTitle": "Batch2B v1",
  "strategyDescription": "initial strategy",
  "aiPromptTemplate": "prompt template v1"
}
```

Sample response (key fields):

```json
{
  "id": 1,
  "novelId": 1,
  "modeId": 1,
  "modeKey": "historical_rewrite",
  "version": 1
}
```

### 5.4 PATCH /adaptation-strategies/:id

Body:

```json
{
  "strategyTitle": "Batch2B v1 updated",
  "strategyDescription": "updated strategy"
}
```

Sample response includes updated title/description.

### 5.5 DELETE /adaptation-strategies/:id

Sample response:

```json
{ "ok": true }
```

After delete, list endpoint returns `[]` again.

## 6) 风险点与说明

- `version` currently uses `MAX(version)+1`; concurrent high-frequency inserts on same novel may need transaction/lock for strict monotonic guarantees.
- `PATCH` empty body is explicitly blocked with `400` to avoid no-op updates.
- `modeId` / `novelId` / `strategyId` existence checks are enforced to avoid silent FK errors.
