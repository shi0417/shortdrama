# pipeline resources 字段对齐修复报告

## 1. 本次修复摘要

- 本轮修复了 `timelines`、`characters`、`key-nodes`、`explosions` 四个 pipeline 资源在新通用资源 CRUD 中因错误查询 `updated_at` 导致的 500。
- 修复策略不是改数据库，而是让新资源框架按当前真实数据库字段工作：对旧表移除不存在的 `updated_at`，保留已有的真实字段。
- `characters.image_path` 已补齐到后端资源字段白名单和前端字段配置。
- 修复后：
  - `/projects` 页内嵌 Pipeline 的人物行点击可正常打开弹窗
  - `/projects/1/pipeline/characters` 独立页可正常加载列表
  - `GET /pipeline-resources/characters/:id` 返回 200
  - `GET /novels/1/pipeline-resources/characters` 返回 200
  - `GET /novels/1/pipeline-resources/timelines|key-nodes|explosions` 也已返回 200

## 2. 修改文件清单

### 后端

- `apps/api/src/pipeline/pipeline-resource.service.ts`
  - 移除了 `timelines / characters / key-nodes / explosions` 资源配置里错误的 `updated_at`
  - 为 `characters` 增加了 `image_path`
  - 将 `characters.image_path` 加入 `editableFields`

### 前端

- `apps/web/src/types/pipeline-resource.ts`
  - 移除了 `timelines / characters / key-nodes / explosions` 的 `updated_at` 字段配置
  - 为 `characters` 增加 `image_path`
  - 将 `characters.image_path` 放入默认整页列配置和字段显示面板配置

### 报告

- `docs/cursor_impl/pipeline_resources_field_alignment_fix_report.md`

## 3. 后端字段白名单修正详情

### `characters`

- 修前字段：
  - `id`
  - `novel_id`
  - `name`
  - `faction`
  - `description`
  - `personality`
  - `setting_words`
  - `sort_order`
  - `revision_notes_json`
  - `created_at`
  - `updated_at`

- 修后字段：
  - `id`
  - `novel_id`
  - `name`
  - `faction`
  - `description`
  - `personality`
  - `setting_words`
  - `image_path`
  - `sort_order`
  - `revision_notes_json`
  - `created_at`

- 为什么这样改：
  - 当前数据库真实数据里 `image_path` 已存在、`updated_at` 不存在
  - 新资源框架必须和真实库字段一致，否则列表和详情都会 500

### `timelines`

- 修前字段包含：
  - `updated_at`

- 修后字段：
  - 保留 `id / novel_id / time_node / event / sort_order / revision_notes_json / created_at`
  - 删除 `updated_at`

- 为什么这样改：
  - 当前旧 overview 返回里没有 `updated_at`
  - 新资源接口必须与现有表结构保持一致

### `key-nodes`

- 修前字段包含：
  - `updated_at`

- 修后字段：
  - 保留 `id / novel_id / timeline_id / category / title / description / sort_order / revision_notes_json / created_at`
  - 删除 `updated_at`

- 为什么这样改：
  - 当前旧 overview 返回结构不包含 `updated_at`
  - 保持资源化接口与真实表结构一致

### `explosions`

- 修前字段包含：
  - `updated_at`

- 修后字段：
  - 保留 `id / novel_id / timeline_id / explosion_type / title / subtitle / scene_restoration / dramatic_quality / adaptability / sort_order / revision_notes_json / created_at`
  - 删除 `updated_at`

- 为什么这样改：
  - 当前旧 overview 返回结构不包含 `updated_at`
  - 新资源接口此前正是因为误查该字段而 500

### `skeleton-topics`

- 修前字段：
  - 保持不变

- 修后字段：
  - 保持不变

- 为什么这样改：
  - 该资源本来就正常返回 200
  - 当前数据库中其 `updated_at` 真实存在，不应改坏

### `skeleton-topic-items`

- 修前字段：
  - 保持不变

- 修后字段：
  - 保持不变

- 为什么这样改：
  - 该资源本来就正常返回 200
  - 当前数据库中其 `updated_at` 真实存在，不应改坏

## 4. 前端字段配置修正详情

- 删除了以下资源里的 `updated_at` 字段配置：
  - `timelines`
  - `characters`
  - `key-nodes`
  - `explosions`

- `characters` 新增了：
  - `image_path`
  - label: `图片路径`
  - type: `text`
  - `editable: true`

- `characters.defaultPageColumns` 新增：
  - `image_path`

- 修复后的前端行为：
  - 字段显示面板不再显示不存在的 `更新时间`
  - `characters` 的字段显示面板现在会显示 `图片路径`
  - 人物详情弹窗会出现 `图片路径` 输入框
  - 保存时会跟随后端白名单一起提交，不会再报字段未允许错误

## 5. 回归验证结果

### 接口验证

以下接口已在带 token 的浏览器会话中实际验证：

- `GET http://localhost:4000/pipeline/1/overview`
  - 结果：`200`
  - 关键现象：
    - `characters[]` 仍正常返回
    - 返回体中可看到 `image_path`

- `GET http://localhost:4000/novels/1/pipeline-resources/characters`
  - 结果：`200`
  - 关键现象：
    - 返回体中包含 `image_path`
    - 不再报 `Internal server error`

- `GET http://localhost:4000/pipeline-resources/characters/86`
  - 结果：`200`
  - 关键现象：
    - 详情接口可正常返回单条人物记录
    - 返回体中包含 `image_path`

- `GET http://localhost:4000/novels/1/pipeline-resources/timelines`
  - 结果：`200`
  - 关键现象：
    - 修复了此前因错误查询 `updated_at` 导致的 500

- `GET http://localhost:4000/novels/1/pipeline-resources/key-nodes`
  - 结果：`200`
  - 关键现象：
    - 修复了此前因错误查询 `updated_at` 导致的 500

- `GET http://localhost:4000/novels/1/pipeline-resources/explosions`
  - 结果：`200`
  - 关键现象：
    - 修复了此前因错误查询 `updated_at` 导致的 500

### MCP 页面验证

#### `/projects/1/pipeline/characters`

- URL：`http://localhost:3000/projects/1/pipeline/characters`
- 结果：通过
- 关键现象：
  - 页面可正常加载
  - 网络请求 `GET /novels/1/pipeline-resources/characters` 返回 `200`
  - 点击“字段显示”后，面板中出现 `图片路径`
  - 通过实际点击首行，成功打开人物编辑弹窗
  - 弹窗中出现 `图片路径` 输入框
  - 点击人物行时，请求 `GET /pipeline-resources/characters/86` 返回 `200`

#### `/projects`

- URL：`http://localhost:3000/projects`
- 结果：通过
- 关键现象：
  - 选中项目后进入 Pipeline tab
  - 内嵌“人物列表”区块仍正常显示
  - 触发人物首行点击后，人物编辑弹窗成功打开
  - 该链路下 `GET /pipeline/1/overview` 返回 `200`
  - 人物详情预加载请求 `GET /pipeline-resources/characters/86` 返回 `200`
  - 未再出现 `Internal server error`

## 6. 数据编辑验证结果

- 测试对象：
  - 人物 `id=86`
  - 字段：`image_path`

- 验证过程：
  1. 在独立页人物弹窗中将 `image_path` 改为：
     - `https://example.com/test-image-path.png`
  2. 点击保存
  3. 浏览器网络中确认：
     - `PATCH /pipeline-resources/characters/86` 返回 `200`
  4. 页面自动刷新后列表接口重新请求并返回 `200`
  5. 为避免污染数据，再次打开同一人物
  6. 将 `image_path` 清空并保存
  7. 再次确认：
     - `PATCH /pipeline-resources/characters/86` 返回 `200`
     - 刷新后列表接口继续返回 `200`

- 结论：
  - `image_path` 的读取、显示、编辑、保存、恢复原值都已验证通过

## 7. 遗留问题与建议

- 本轮没有改旧的 AI 抽取 / review 写入链路，所以：
  - `characters.image_path` 虽然已经能在资源化 CRUD 中读写
  - 但 AI 生成和二次 review 目前不会自动写入该字段

- 当前修复基于“代码适配真实数据库结构”的原则，没有强行给旧表补 `updated_at`
  - 这能最快恢复功能
  - 后续如果你希望所有 pipeline 结果表完全统一 schema，再单独做 migration 会更稳妥

- MCP 浏览器在 `/projects` 页面里对左侧项目卡片的可访问性标注不稳定，所以本轮在内嵌链路回归时混合使用了：
  - 真实页面加载
  - DOM 级点击触发
  - 网络请求验证
  这不影响功能结论，但如果你后续想做更稳定的自动化回归，可以考虑补测试用选择器
