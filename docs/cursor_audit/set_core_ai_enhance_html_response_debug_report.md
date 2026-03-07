# set_core AI enhance HTML 响应定位报告

## 审计说明

- 模式：只读审计
- 未修改业务代码
- 未写库
- 未新增 migration
- 未提交 commit

项目目录：

- `D:/project/duanju/shortdrama`

当前环境变量（已读）：

- `apps/api/.env`
  - `lc_api_key=...`
  - `lc_api_url=https://s.lconai.com`

---

## A. AI enhance 调用链精确定位

### 1. 接口入口

路由：

- `POST /novels/:novelId/set-core:enhance`

定义位置：

- `apps/api/src/set-core/set-core.controller.ts`

代码：

```ts
@Post('novels/:novelId/set-core:enhance')
enhanceSetCore(
  @Param('novelId', ParseIntPipe) novelId: number,
  @Body() dto: EnhanceSetCoreDto,
) {
  return this.setCoreService.enhanceSetCore(novelId, dto);
}
```

### 2. Controller 调到哪个 service 方法

- `SetCoreService.enhanceSetCore(novelId, dto)`

### 3. Service 内部职责链

在 `apps/api/src/set-core/set-core.service.ts` 中：

1. `enhanceSetCore(...)`
   - 校验 novel
   - 解析 modelKey
   - 解析 referenceTables
   - 生成 prompt
   - 调外部 AI
   - 解析结果并映射为 set_core 字段

2. `buildPrompt(...)`
   - 负责拼接 prompt 文本

3. `buildReferenceBlocks(...)`
   - 负责根据勾选表抽取文本参考块

4. `callLcAiApi(...)`
   - 负责 `fetch(...)` 发外部请求

5. `extractAiText(...)`
   - 负责从外部响应 JSON 中抽取文本内容

6. `parseJsonObjectFromText(...)`
   - 负责把模型返回的文本内容再解析成最终 JSON 对象

### 4. 当前 JSON 解析失败的位置

**第一层失败点**在 `callLcAiApi(...)` 中对整个响应体做 `JSON.parse(rawText)` 的位置：

```ts
const rawText = await response.text();
if (!response.ok) {
  throw new BadRequestException(
    `AI enhance request failed (${response.status}): ${rawText.slice(0, 500)}`,
  );
}

let payload: any;
try {
  payload = JSON.parse(rawText);
} catch {
  throw new BadRequestException(`AI enhance response is not valid JSON: ${rawText.slice(0, 500)}`);
}
```

也就是说，**当前拿到的原始 `rawText` 就已经不是 JSON，而是 HTML**。

---

## B. `lc_api_url` 使用方式精确检查

### 1. `getLcApiEndpoint()` 完整实现

```ts
private getLcApiEndpoint(): string {
  const raw = process.env.lc_api_url?.trim();
  if (!raw) {
    throw new InternalServerErrorException('lc_api_url is not configured');
  }

  if (raw.endsWith('/chat/completions')) {
    return raw;
  }

  return `${raw.replace(/\/+$/, '')}/chat/completions`;
}
```

### 2. 真正调用 `fetch(...)` 的位置完整代码

```ts
private async callLcAiApi(
  modelKey: string,
  promptPreview: string,
): Promise<Record<string, unknown>> {
  const endpoint = this.getLcApiEndpoint();
  const apiKey = this.getLcApiKey();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelKey,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content:
            '你是短剧核心设定完善助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
        },
        {
          role: 'user',
          content: promptPreview,
        },
      ],
    }),
  });

  const rawText = await response.text();
  // ...后续解析
}
```

### 3. Authorization 请求头代码

```ts
Authorization: `Bearer ${apiKey}`
```

### 4. Content-Type 请求头代码

```ts
'Content-Type': 'application/json'
```

### 5. 请求 body 组装代码

```ts
body: JSON.stringify({
  model: modelKey,
  temperature: 0.7,
  messages: [
    {
      role: 'system',
      content:
        '你是短剧核心设定完善助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
    },
    {
      role: 'user',
      content: promptPreview,
    },
  ],
})
```

### 6. 返回值解析代码

```ts
const rawText = await response.text();
if (!response.ok) {
  throw new BadRequestException(
    `AI enhance request failed (${response.status}): ${rawText.slice(0, 500)}`,
  );
}

let payload: any;
try {
  payload = JSON.parse(rawText);
} catch {
  throw new BadRequestException(`AI enhance response is not valid JSON: ${rawText.slice(0, 500)}`);
}

const content = this.extractAiText(payload);
const parsed = this.parseJsonObjectFromText(content);
```

### 7. 明确回答

#### 当前代码把 `lc_api_url` 当什么？

- **当“基地址或完整接口地址”两用**

逻辑是：

- 如果 `lc_api_url` 已经以 `/chat/completions` 结尾，则视为完整接口地址
- 否则自动拼上 `/chat/completions`

#### 当前代码会不会自动拼 `/v1/chat/completions`？

- **不会**

它只会拼：

- `/chat/completions`

#### 当前最终请求 URL 是什么？

基于当前 `.env`：

- `lc_api_url=https://s.lconai.com`

按代码推导，最终请求 URL 为：

- **`https://s.lconai.com/chat/completions`**

#### 如果 `lc_api_url=https://s.lconai.com`，当前代码实际会打到哪里？

- **`https://s.lconai.com/chat/completions`**

---

## C. 为什么会返回 HTML

结合代码与现象，当前最可能的情况不是“模型返回坏 JSON”，而是：

- **后端请求没有打到真正的 JSON API 接口**
- 而是打到了网页站点或网页路由

### 最可能原因 Top 3

#### Top 1. 请求路径缺少 `/v1`

当前代码拼的是：

- `https://s.lconai.com/chat/completions`

而用户最初设想的站点看起来更像 OpenAI 兼容聚合 API，通常路径更可能是：

- `https://s.lconai.com/v1/chat/completions`

这与用户给出的站点标题“AI聊天-智创聚合API”非常吻合：

- `https://s.lconai.com` 是网站入口
- 真正 API 大概率在 `/v1/...`

所以 **Top 1 原因** 是：

- 当前 URL 拼接少了 `/v1`

#### Top 2. 当前请求打到了网页入口或 SPA 路由回退页面

即便 `/chat/completions` 存在于前端路由层，但如果服务端对未知路径统一回退到 HTML 页面，也会导致：

- `POST` 或错误路径请求
- 返回 `<!DOCTYPE html>...`

这种情况常见于：

- 网站和 API 共域名
- API 未挂在根路径
- 错误路径被前端页面接管

#### Top 3. 服务端需要不同的 API 入口格式，而当前 body/路径触发了网页返回

例如：

- 需要特定前缀路径
- 需要不同 header
- 需要不同 endpoint 名称

但从当前代码看，请求体本身是标准 OpenAI 风格，所以这个原因排在路径问题之后。

### 其它原因的概率判断

- 请求方法不对：**概率低**
  - 当前是 `POST`
- 请求头不对：**中低概率**
  - `Authorization` + `Content-Type` 都是标准格式
- body 格式不对：**中低概率**
  - body 结构本身符合 OpenAI chat completions 常见格式
- 301/302 重定向到网页：**有可能**
  - 但本质上仍属于“URL 路径不正确”

---

## D. 当前 AI 请求格式检查

### 当前请求是否符合 OpenAI chat completions 常见格式？

结论：

- **基本符合**

当前请求体：

```json
{
  "model": "...",
  "temperature": 0.7,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

### 明确回答

1. 当前 body 是否包含 `model`
   - **是**
2. 当前 body 是否包含 `messages`
   - **是**
3. 当前 body 是否包含 `temperature`
   - **是**
4. 当前是否错误地用了别的字段名
   - **没有明显错误**
5. 当前模型字段是否直接使用了 `ai_model_catalog.model_key`
   - **是**
   - 来源：`resolveModelKey(dto.modelKey)`

结论：

- **当前请求体格式不是主要嫌疑点**
- 更大概率是 URL 路径不对

---

## E. 环境变量加载审计

### 1. `apps/api/.env` 是否会被当前 Nest 运行时正确加载

当前 `AppModule`：

```ts
ConfigModule.forRoot({
  isGlobal: true,
})
```

这意味着 Nest 会按默认行为加载环境文件。

在当前项目运行方式下，理论上：

- `apps/api/.env` 对 `pnpm --dir apps/api dev` 是**大概率可用的**

### 2. 当前读取方式

- `process.env.lc_api_key`
- `process.env.lc_api_url`

不是 `ConfigService`

### 3. 在当前代码下，`apps/api/.env` 里的值是否理论上已经可用

- **是，理论上可用**

### 4. 如果还报 `lc_api_url is not configured`，最可能原因

按概率排序：

1. **服务没重启**
2. `.env` 变更后 watch 进程未重新加载 env
3. 启动进程时工作目录/加载路径与预期不一致
4. 值里有不可见字符或读取到旧进程

当前这次审计里，`apps/api/.env` 已经能看到：

```env
lc_api_url=https://s.lconai.com
```

因此“变量名拼错”与“读取逻辑 bug”的概率都更低。

---

## F. 最终必须回答的问题

### 1. 当前 `lc_api_url=https://s.lconai.com` 在现有代码里是否正确？

- **大概率不正确**

原因：

- 现有代码会自动拼成 `https://s.lconai.com/chat/completions`
- 但从返回 HTML 的现象判断，更可能需要的是 `/v1/chat/completions`

### 2. 当前代码期望的 `lc_api_url` 应该填基地址还是完整接口地址？

结论：

- **按当前实现，推荐填“完整接口地址”**

因为当前实现只识别：

- 已经以 `/chat/completions` 结尾

它并不会自动补 `/v1`

### 3. 最推荐的 `.env` 配置示例

推荐示例：

```env
lc_api_key=你的真实key
lc_api_url=https://s.lconai.com/v1/chat/completions
```

这是在**不改代码前提下**最稳的配置方式。

### 4. 当前最小修复点在哪里？

最小修复点优先级：

1. **URL 拼接**
2. 其次才是返回解析兼容

请求头与 body 目前看不是主要问题。

### 5. 最小修复方案（本阶段只建议，不改代码）

最小安全方案：

1. 先把 `.env` 配置改为完整接口地址：

```env
lc_api_url=https://s.lconai.com/v1/chat/completions
```

2. 重启后端服务

3. 再测试 `POST /novels/:novelId/set-core:enhance`

4. 如果仍返回 HTML，再进一步检查：
   - 是否需要额外 header
   - 是否有网关要求特定路径前缀
   - 是否服务端并非 OpenAI 兼容 chat/completions

5. 若要代码层更稳健，后续建议：
   - `getLcApiEndpoint()` 同时兼容：
     - `/v1/chat/completions`
     - `/chat/completions`

---

## 结论摘要

- 当前 `POST /novels/:novelId/set-core:enhance` 的调用链清晰，失败发生在 `callLcAiApi()` 中对原始响应做 `JSON.parse(rawText)` 的地方。
- 当前 `lc_api_url=https://s.lconai.com` 在现有实现下，会被拼成：
  - **`https://s.lconai.com/chat/completions`**
- 当前请求头和 body 基本符合 OpenAI chat completions 风格，不是首要嫌疑点。
- 返回 `<!DOCTYPE html>...` 的最可能原因 Top 1：
  - **请求 URL 错了，缺少 `/v1`，导致打到了网页入口或网页回退路由。**
