# Projects Tab 现状审计报告

- 审计时间：2026-03-04
- 审计范围：`apps/web`（/projects 页面）+ `apps/api`（novels/episodes/themes/reference materials 相关模块）
- 审计原则：只读分析，不修改业务代码，不执行数据库写入

## 0. 基础信息

- 工作目录：`D:/project/duanju/shortdrama`
- `pnpm -v`：`10.28.2`
- `node -v`：`v22.17.0`
- `pnpm -r list --depth 2` 关键依赖（截取）
  - `web`：`next@14.2.35`、`react@18.3.1`、`react-dom@18.3.1`
  - `api`：`@nestjs/common@10.4.22`、`@nestjs/core@10.4.22`、`@nestjs/typeorm@10.0.2`、`typeorm@0.3.28`、`mysql2@3.18.2`、`@nestjs/jwt@10.2.0`、`passport-jwt@4.0.1`

## 1. 前端现状审计（apps/web）

### 1.1 /projects 路由定位（Next.js App Router）

- 路由文件：`apps/web/src/app/projects/page.tsx`
- 未发现 `pages/projects*`（说明当前走 App Router）

### 1.2 /projects 页面结构图（组件层级）

```text
ProjectsPage (app/projects/page.tsx)
├─ Header (欢迎语 + Logout)
└─ Main Two Columns
   ├─ Left: ProjectList
   │  ├─ 搜索/筛选（keyword/status/theme）
   │  ├─ 列表加载（api.getNovels + api.getThemes）
   │  └─ 新建项目弹窗（api.createNovel）
   └─ Right: ProjectDetail（selectedNovel 存在时）
      ├─ Tabs Header（Basic Info / Reference Materials）
      ├─ Basic Info Tab
      │  └─ 编辑并保存（api.updateNovel）/ 删除（api.deleteNovel）
      └─ Reference Materials Tab
         └─ SourceTextManager
            ├─ 列表（api.getSourceTexts）
            ├─ 新建（api.createSourceText）
            ├─ 分段读取（api.getSourceTextChunk）
            └─ 删除（api.deleteSourceText）
```

### 1.3 Tabs 组件实现方式

- 位置：`apps/web/src/components/ProjectDetail.tsx`
- 实现方式：**自研（手写 button + local state）**
  - 通过 `activeTab`（`'basic' | 'source'`）切换内容
  - 样式为 inline style，未使用 `shadcn/antd/MUI/headlessui` 等组件库 Tabs

### 1.4 Reference Materials 组件与数据流

- 组件文件：
  - `apps/web/src/components/ProjectDetail.tsx`（Tab 容器与切换）
  - `apps/web/src/components/SourceTextManager.tsx`（核心交互）
  - `apps/web/src/lib/api.ts`（请求封装）
  - `apps/web/src/types/index.ts`（`SourceText` / `SourceTextChunk` 类型）

- 数据流图：

```text
ProjectDetail(activeTab='source')
   -> <SourceTextManager novelId={novel.id} />
      -> useEffect(novelId) 调用 api.getSourceTexts(novelId)
         -> GET /novels/:novelId/source-texts
            -> 返回 SourceText[]: [{ id, novelsId, updateTime, contentLength }]

      选择条目 handleSelect(id)
         -> api.getSourceTextChunk(id, 0, CHUNK_SIZE)
         -> GET /source-texts/:id?mode=range&offset=0&limit=5000
            -> 返回 SourceTextChunk: { id, offset, limit, totalLength, text }

      Load More
         -> GET /source-texts/:id?mode=range&offset=loadedLength&limit=5000
         -> 追加 chunk.text 到 loadedText

      New Material
         -> POST /novels/:novelId/source-texts

      Delete Material
         -> DELETE /source-texts/:id
```

## 2. 后端现状审计（apps/api）

### 2.1 相关模块清单（controller/service/entity/dto）

- **novels**
  - controller: `apps/api/src/novels/novels.controller.ts`
  - service: `apps/api/src/novels/novels.service.ts`
  - entity: `apps/api/src/entities/drama-novel.entity.ts`
  - dto:
    - `apps/api/src/novels/dto/create-novel.dto.ts`
    - `apps/api/src/novels/dto/update-novel.dto.ts`
    - `apps/api/src/novels/dto/query-novel.dto.ts`

- **episodes**
  - controller: `apps/api/src/episodes/episodes.controller.ts`
  - service: `apps/api/src/episodes/episodes.service.ts`
  - entity: `apps/api/src/entities/episode.entity.ts`
  - dto:
    - `apps/api/src/episodes/dto/query-episodes.dto.ts`
    - `apps/api/src/episodes/dto/episode-response.dto.ts`

- **themes**
  - controller: `apps/api/src/themes/themes.controller.ts`
  - service: `apps/api/src/themes/themes.service.ts`
  - entity: `apps/api/src/entities/ai-short-drama-theme.entity.ts`
  - dto:
    - `apps/api/src/themes/dto/query-theme.dto.ts`

- **reference materials（source-texts）**
  - controller: `apps/api/src/source-texts/source-texts.controller.ts`
  - service: `apps/api/src/source-texts/source-texts.service.ts`
  - entity: `apps/api/src/entities/drama-source-text.entity.ts`
  - dto:
    - `apps/api/src/source-texts/dto/create-source-text.dto.ts`
    - `apps/api/src/source-texts/dto/update-source-text.dto.ts`

### 2.2 接口清单（method + path + auth + query/body）

- **认证**
  - `POST /auth/login`
    - Auth：否
    - Body：`{ username, password }`

- **novels（受 JWT 保护）**
  - `GET /novels`
    - Auth：是（`JwtAuthGuard`）
    - Query：`keyword?` `status?` `themeId?`
  - `GET /novels/:id`
    - Auth：是
  - `POST /novels`
    - Auth：是
    - Body（`CreateNovelDto`）：`novelsName` 必填，其它可选（`totalChapters/powerUpInterval/author/description/status/themeId`）
  - `PATCH /novels/:id`
    - Auth：是
    - Body（`UpdateNovelDto`）：上述字段均可选
  - `DELETE /novels/:id`
    - Auth：是

- **themes（受 JWT 保护）**
  - `GET /themes`
    - Auth：是
    - Query：`categoryMain?` `hotLevel?` `isHotTrack?`

- **reference materials（受 JWT 保护）**
  - `GET /novels/:novelId/source-texts`
    - Auth：是
    - 返回：`[{ id, novelsId, updateTime, contentLength }]`
  - `POST /novels/:novelId/source-texts`
    - Auth：是
    - Body：`{ sourceText?: string }`
  - `GET /source-texts/:id`
    - Auth：是
    - Query：`mode?` `offset?` `limit?`
    - `mode=range` 时返回：`{ id, offset, limit, totalLength, text }`
    - 否则返回实体全文（含 `sourceText`）
  - `PATCH /source-texts/:id`
    - Auth：是
    - Body：`{ sourceText: string }`
  - `DELETE /source-texts/:id`
    - Auth：是

- **episodes（受 JWT 保护）**
  - `GET /episodes`
    - Auth：是
    - Query：`novelId?`
  - `GET /episodes/:id`
    - Auth：是

### 2.3 实体/表映射清单（TypeORM）

- 已存在映射
  - `drama_novels` -> `DramaNovel`（`drama-novel.entity.ts`）
  - `drama_source_text` -> `DramaSourceText`（`drama-source-text.entity.ts`）
  - `novel_episodes` -> `Episode`（`episode.entity.ts`）
  - `drama_structure_template` -> `DramaStructureTemplate`（`drama-structure-template.entity.ts`）
  - `ai_short_drama_theme` -> `AiShortDramaTheme`（`ai-short-drama-theme.entity.ts`）
  - `user` -> `User`（`user.entity.ts`）

- 未发现映射（当前代码库 `apps/api/src/entities` 中不存在）
  - `novel_timelines`
  - `novel_characters`
  - `novel_key_nodes`
  - `novel_explosions`
  - `set_*` 世界观系列表（仅看到 SQL 脚本，未见 entity）
  - `novel_skeleton_topics`
  - `novel_skeleton_topic_items`

## 3. 重点确认项

### 3.1 /projects 页面数据由哪些 endpoint 提供

- 左侧列表与筛选：
  - `GET /novels`（项目列表）
  - `GET /themes`（题材下拉）
- 右侧详情（Basic Info）：
  - 初始选中后：使用列表中已有 novel 数据
  - 刷新详情：`GET /novels/:id`
  - 保存：`PATCH /novels/:id`
  - 删除：`DELETE /novels/:id`
- 右侧 Reference Materials：
  - `GET /novels/:novelId/source-texts`
  - `POST /novels/:novelId/source-texts`
  - `GET /source-texts/:id?mode=range&offset=&limit=`
  - `DELETE /source-texts/:id`

### 3.2 JWT 守卫与 token 注入位置

- 后端守卫：
  - 各业务 controller 使用 `@UseGuards(JwtAuthGuard)`，`JwtStrategy` 从 `Authorization: Bearer <token>` 提取并校验
- 前端 token 注入：
  - `apps/web/src/lib/api.ts` 的 `apiClient()` 读取 `localStorage.accessToken`，自动添加 `Authorization` 头
- 前端登录态校验：
  - `/projects` 页面与 `ProjectList` 内都会检查 `localStorage`，无 token 跳转 `/login`

### 3.3 当前错误处理（是否吞错 / 仅 alert）

- `apiClient`：非 2xx 时抛 `Error(message)`，不会吞掉
- UI 层：
  - 大量 `catch` 采用 `alert('Failed...'+error.message)`（用户可见）
  - 部分仅 `console.error`（如 `ProjectsPage` 里 `loadThemes`、`handleUpdate`），用户不可见
  - `ProjectList` 对 Unauthorized 有专门分支跳转登录，其他错误弹窗

## 4. 风险点与“红框新 Tab”最小切入点

### 4.1 最小改动切入点（推荐）

- 首选改动入口：`apps/web/src/components/ProjectDetail.tsx`
  - 这里统一管理 Tabs（当前 `basic/source`），加新 Tab 的改动面最小
  - 仅需扩展 `activeTab` 联合类型、Tab 按钮、内容渲染分支

### 4.2 适合改动的文件（按最小改动优先）

1. `apps/web/src/components/ProjectDetail.tsx`（新增 tab header + 条件渲染）
2. 新增一个纯展示组件（例如 `apps/web/src/components/<NewTab>.tsx`）
3. （可选）`apps/web/src/types/index.ts`（若新 Tab 需要前端本地类型）
4. 暂不改 `apps/web/src/lib/api.ts`（静态 UI 阶段不接接口）

### 4.3 主要风险点

- 当前 Tabs 是手写按钮，新增 tab 后若继续堆叠 inline style，可维护性会下降
- 当前错误处理风格不统一（有 alert 也有 console-only），后续接 API 时易出现“失败但用户无感知”
- 后端尚无新 Tab 对应实体/接口（尤其 skeleton/set_* 仅见 SQL），直接联调会阻塞

## 5. 下一步建议（先做纯前端静态 UI，不接 API）

- 目标：先完成“新 Tab”外观与交互壳子，确保不影响现有 Basic/Reference 功能
- 建议改动：
  - 修改 `apps/web/src/components/ProjectDetail.tsx`
    - 扩展 `activeTab`：`'basic' | 'source' | 'newTab'`
    - 新增第三个 Tab 按钮
    - 在内容区新增 `activeTab === 'newTab'` 分支
  - 新增组件：`apps/web/src/components/NewTabPanel.tsx`（命名可再定）
    - 放静态表单/占位块/说明文本
    - 内部使用本地 `useState`，不调用 `api`
- 暂不改动：
  - `apps/web/src/lib/api.ts`
  - `apps/api/**` 任意 controller/service/entity/dto
  - 数据库结构与迁移

---

## 结论摘要

- `/projects` 已经是 Next.js App Router 页面，Tabs 为自研按钮态切换，不依赖第三方 Tabs 组件库。
- Reference Materials 数据链路完整：前端 `SourceTextManager` -> `api.ts` -> 后端 `source-texts` 控制器/服务。
- 新增“红框新 Tab”的最小改动只需动 `ProjectDetail` + 一个新前端展示组件；纯静态阶段无需改后端和数据库。
