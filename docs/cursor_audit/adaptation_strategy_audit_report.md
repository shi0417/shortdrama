# adaptation_strategy 只读审计报告

审计目标：为“Step3 顶部新增按钮【新增重构模型】+ 对接 `adaptation_modes` / `novel_adaptation_strategy`”做现状摸底。  
审计模式：只读（仅读代码、SHOW/SELECT、可选 build），未执行写库/DDL/迁移。

---

## Step 0：环境与基线

### 0.1 Node / pnpm 版本

- `node -v`：`v22.17.0`
- `pnpm -v`：`10.28.2`

### 0.2 apps/web 与 apps/api 关键依赖（package.json）

- `apps/web/package.json`
  - `next`: `^14.0.4`
- `apps/api/package.json`
  - `@nestjs/common`: `^10.3.0`
  - `@nestjs/core`: `^10.3.0`
  - `typeorm`: `^0.3.19`
  - `mysql2`: `^3.7.0`

### 0.3 /projects 与 Pipeline 入口链路

- 路由：`apps/web/src/app/projects/page.tsx`
- Tab 切换：`apps/web/src/components/ProjectDetail.tsx`
- Pipeline 容器：`apps/web/src/components/PipelinePanel.tsx`

链路：

`/projects` -> `ProjectDetail` -> `activeTab === 'pipeline'` -> `PipelinePanel`

---

## Step 1：前端 UI 定位（Step3 红框）

### 1.1 Step3 header 定位

文件：`apps/web/src/components/PipelinePanel.tsx`  
关键区段：Step3 header 与模块列表容器（约 `286~370` 行）

### 1.2 Step3 关键 JSX 片段（原样摘录）

```tsx
<div
  style={{
    background: '#fafafa',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #e8e8e8',
  }}
>
  <div style={{ fontWeight: 600 }}>Step 3 - 生成世界观架构 / 重构爽文模型</div>
  <button
    onClick={() => setStep3Expanded((prev) => !prev)}
    style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1890ff' }}
  >
    {step3Expanded ? 'Collapse' : 'Expand'}
  </button>
</div>
{step3Expanded && (
  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
    {modules.map((item) => (
      <div key={item.key} ...>
        <div>
          <div style={{ fontWeight: 600 }}>{item.title}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>{item.mapping}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => handleModuleAction(item.key, 'generate')}>生成(或刷新)</button>
          <button onClick={() => handleModuleAction(item.key, 'edit')}>编辑</button>
          <button onClick={() => handleModuleAction(item.key, 'save')}>保存</button>
        </div>
      </div>
    ))}
    ...
  </div>
)}
```

### 1.3 现状说明

- 红框区域本质是 Step3 的 **header 容器 `div`**（左标题 + 右 collapse 按钮），并未预留“新增重构模型”按钮。
- 右侧“生成/编辑/保存”按钮来自 `modules.map(...)` 内每个模块行，调用 `handleModuleAction`，目前仅 `console.log`。
- Step3 的 6 个模块来源是前端硬编码数组 `modules`（`key/title/mapping`），不是来自 API。

---

## Step 2：前端 API 现状

### 2.1 adaptation 关键词检索结果

全仓库检索 `adaptation_modes|novel_adaptation_strategy`：**无命中**（前端/后端业务代码均未接入该命名）。

### 2.2 apps/web/src/lib 现状

- `apps/web/src/lib/api.ts` 仅有 pipeline overview 相关读取：
  - `getPipelineOverview(novelId) -> GET /pipeline/:novelId/overview`
- 未发现：
  - `getAdaptationModes`
  - `getNovelAdaptationStrategies`
  - `createNovelAdaptationStrategy`
  - `updateNovelAdaptationStrategy`
  - `deleteNovelAdaptationStrategy`

### 2.3 token 与 baseUrl 机制

文件：`apps/web/src/lib/api.ts`

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000'
...
return localStorage.getItem('accessToken')
...
headers.set('Authorization', `Bearer ${token}`)
```

结论：前端请求地址由 `NEXT_PUBLIC_API_BASE_URL` 决定，鉴权依赖 `localStorage.accessToken`。

---

## Step 3：后端现状（接口/模块）

### 3.1 adaptation 关键词检索

- `apps/api/src` 内未发现 `adaptation_modes` / `novel_adaptation_strategy` 对应模块、controller、service。
- `pipeline` 模块仍仅提供：
  - `GET /pipeline/:novelId/overview`

### 3.2 是否已被 pipeline overview 读取

审计结论：当前 `pipeline.service.ts` 未读取 `adaptation_modes` / `novel_adaptation_strategy`，也未包含相关返回字段。

---

## Step 4：数据库只读核对（原样输出）

### 4.1 表存在性（information_schema.TABLES）

```text
TABLE_NAME
adaptation_modes
novel_adaptation_strategy
```

### 4.2 SHOW CREATE TABLE adaptation_modes（原样）

```text
Table	Create Table
adaptation_modes	CREATE TABLE `adaptation_modes` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `mode_key` varchar(50) NOT NULL COMMENT 'ģʽkey',\n  `mode_name` varchar(100) NOT NULL COMMENT 'ģʽ����',\n  `description` text COMMENT 'ģʽ˵��',\n  `is_active` tinyint DEFAULT '1',\n  `sort_order` int DEFAULT '0',\n  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `mode_key` (`mode_key`)\n) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

### 4.3 SHOW CREATE TABLE novel_adaptation_strategy（原样）

```text
Table	Create Table
novel_adaptation_strategy	CREATE TABLE `novel_adaptation_strategy` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `novel_id` int NOT NULL,\n  `mode_id` int NOT NULL COMMENT '�ı�ģʽ',\n  `strategy_title` varchar(200) DEFAULT NULL,\n  `strategy_description` longtext COMMENT '�ı����˵��',\n  `ai_prompt_template` longtext COMMENT 'AI Promptģ��',\n  `version` int DEFAULT '1',\n  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,\n  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,\n  PRIMARY KEY (`id`),\n  KEY `fk_adaptation_novel` (`novel_id`),\n  KEY `fk_adaptation_mode` (`mode_id`),\n  CONSTRAINT `fk_adaptation_mode` FOREIGN KEY (`mode_id`) REFERENCES `adaptation_modes` (`id`),\n  CONSTRAINT `fk_adaptation_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

### 4.4 SHOW INDEX（原样）

```text
Table	Non_unique	Key_name	Seq_in_index	Column_name	Collation	Cardinality	Sub_part	Packed	Null	Index_type	Comment	Index_comment	Visible	Expression
adaptation_modes	0	PRIMARY	1	id	A	3	NULL	NULL		BTREE			YES	NULL
adaptation_modes	0	mode_key	1	mode_key	A	3	NULL	NULL		BTREE			YES	NULL
Table	Non_unique	Key_name	Seq_in_index	Column_name	Collation	Cardinality	Sub_part	Packed	Null	Index_type	Comment	Index_comment	Visible	Expression
novel_adaptation_strategy	0	PRIMARY	1	id	A	0	NULL	NULL		BTREE			YES	NULL
novel_adaptation_strategy	1	fk_adaptation_novel	1	novel_id	A	0	NULL	NULL		BTREE			YES	NULL
novel_adaptation_strategy	1	fk_adaptation_mode	1	mode_id	A	0	NULL	NULL		BTREE			YES	NULL
```

### 4.5 行数（SELECT COUNT(*)）

```text
table_name	row_count
adaptation_modes	3
novel_adaptation_strategy	0
```

### 4.6 外键（KEY_COLUMN_USAGE / REFERENTIAL_CONSTRAINTS 原样）

```text
TABLE_NAME	COLUMN_NAME	CONSTRAINT_NAME	REFERENCED_TABLE_NAME	REFERENCED_COLUMN_NAME
novel_adaptation_strategy	mode_id	fk_adaptation_mode	adaptation_modes	id
novel_adaptation_strategy	novel_id	fk_adaptation_novel	drama_novels	id
CONSTRAINT_NAME	TABLE_NAME	REFERENCED_TABLE_NAME	UPDATE_RULE	DELETE_RULE
fk_adaptation_mode	novel_adaptation_strategy	adaptation_modes	NO ACTION	NO ACTION
fk_adaptation_novel	novel_adaptation_strategy	drama_novels	NO ACTION	CASCADE
```

### 4.7 drama_novels(id) 关联核对（SHOW CREATE TABLE 原样）

```text
Table	Create Table
drama_novels	CREATE TABLE `drama_novels` (\n  `id` int NOT NULL AUTO_INCREMENT COMMENT '�̾�ID����Ӧstructure����novels_id��',\n  `novels_name` varchar(100) NOT NULL COMMENT '�̾����ƣ��磺��������������',\n  `description` text COMMENT '����',\n  `total_chapters` int DEFAULT '0' COMMENT '�ܼ���',\n  `power_up_interval` int DEFAULT '5' COMMENT 'Ȩ���㼶�������������Nֵ��Ĭ��5����һ����',\n  `author` varchar(50) DEFAULT NULL COMMENT '���/����',\n  `status` tinyint DEFAULT '0' COMMENT '0=δ���ߣ�1=�����У�2=�����',\n  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,\n  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '����ʱ��',\n  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '����ʱ��',\n  `theme_id` int DEFAULT NULL COMMENT '题材ID',\n  PRIMARY KEY (`id`),\n  KEY `idx_drama_novels_theme_id` (`theme_id`),\n  CONSTRAINT `fk_drama_novels_theme` FOREIGN KEY (`theme_id`) REFERENCES `ai_short_drama_theme` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT\n) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='�̾������Ϣ������Ȩ����������'
```

---

## Step 5：结论与最小改动切入点

### 5.1 Step3 顶部新增按钮最小切入点

- 文件：`apps/web/src/components/PipelinePanel.tsx`
- 容器：Step3 header 的 `div`（左标题 + 右侧 collapse 按钮）
- 最小改动：在该 header 的右侧按钮组加入“新增重构模型”按钮（与 collapse 并列）

### 5.2 两张表存在性结论

- `adaptation_modes`：存在（3 行）
- `novel_adaptation_strategy`：存在（0 行）
- 结论：不需要“先补 SQL 建表”；当前缺口主要在前后端接口与前端 UI 对接。

### 5.3 后端最小接口集合建议（仅建议，不实现）

- `GET /adaptation-modes`
- `GET /novels/:novelId/adaptation-strategies`
- `POST /novels/:novelId/adaptation-strategies`
- `PATCH /adaptation-strategies/:id`
- `DELETE /adaptation-strategies/:id`

前端最小 UI（仅建议）：

- “新增重构模型”弹窗字段：
  - `modeId`（来自 modes 下拉）
  - `strategyTitle`
  - `strategyDescription`
  - （可选）`version`
- 列表字段：
  - `modeName / strategyTitle / version / updatedAt`
- 行操作：
  - 编辑 / 删除 / 刷新

### 5.4 本次审计是否有代码改动与 build 状态

- 业务代码改动：无
- 本次仅新增审计报告文件：`docs/cursor_audit/adaptation_strategy_audit_report.md`
- build 验证：已执行 `pnpm --dir apps/web build`，通过

---

本次仅做只读审计：未修改业务代码、未执行写库 SQL、未新增 migration、未生成可执行变更。
