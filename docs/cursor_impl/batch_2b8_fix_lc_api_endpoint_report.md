# Batch 2B-8 Fix: lc_api_url Endpoint Compatibility

## 修改文件清单
- `apps/api/src/set-core/set-core.service.ts`

## 修复目标
- 修复 `POST /novels/:novelId/set-core:enhance` 在 `lc_api_url` 填写为基地址时，错误请求到网页入口并返回 HTML 的问题。
- 兼容以下三种写法：
  - 基地址：`https://s.lconai.com`
  - 完整 OpenAI 兼容地址：`https://s.lconai.com/v1/chat/completions`
  - 旧式完整地址：`https://s.lconai.com/chat/completions`

## `getLcApiEndpoint()` 修复前后逻辑

### 修复前
- 读取 `process.env.lc_api_url`
- 若以 `/chat/completions` 结尾则直接返回
- 否则统一拼接为 `/<chat/completions>`
- 问题：`https://s.lconai.com` 会被错误拼成 `https://s.lconai.com/chat/completions`，缺少 `/v1`

### 修复后
- 先统一去除末尾多余 `/`
- 若已是以下任一完整路径，则直接返回：
  - `/v1/chat/completions`
  - `/chat/completions`
- 若只是基地址，则自动拼接为：
  - `/v1/chat/completions`
- 结果：
  - `https://s.lconai.com` -> `https://s.lconai.com/v1/chat/completions`
  - `https://s.lconai.com/` -> `https://s.lconai.com/v1/chat/completions`
  - `https://s.lconai.com/v1/chat/completions` -> 原样使用
  - `https://s.lconai.com/chat/completions` -> 原样使用

## HTML 响应识别逻辑
- 在 `JSON.parse` 之前，先读取：
  - `response.status`
  - `response.headers.get('content-type')`
  - `response.text()`
- 若满足任一条件，则判定为 HTML 响应：
  - `content-type` 包含 `text/html`
  - 响应体以 `<!DOCTYPE html` 开头
  - 响应体以 `<html` 开头
- 命中后直接抛出更明确的错误，不再继续 `JSON.parse`

## 错误提示增强
- 外部 AI 请求失败时，错误信息现在会保留：
  - `endpoint`
  - `status`
  - `contentType`
  - 响应体前 400 字符摘要
- HTML 响应时，报错会明确说明：
  - 请求打到了 HTML 页面，而不是 JSON API
- 普通非 JSON 响应时，也会带上相同上下文，便于快速定位

## 最小调试信息
- 仅在 `set_core enhance` 链路增加日志：
  - 请求前打印：`endpoint`、`model`
  - 响应后打印：`status`、`contentType`
- 未打印：
  - `lc_api_key`
  - 完整 prompt
  - 其它敏感内容

## Build 结果
- 执行：`pnpm --dir apps/api build`
- 结果：通过

## 本地接口验证结果

### 当前 `.env`
- `apps/api/.env` 中当前配置为：
  - `lc_api_url=https://s.lconai.com`

### 验证 1：Prompt 预览
- 调用：`POST /novels/1/set-core:enhance-preview-prompt`
- 结果：成功返回 `usedModelKey` 与 `promptPreview`

### 验证 2：Enhance
- 调用：`POST /novels/1/set-core:enhance`
- 服务端日志确认：
  - 请求地址：`https://s.lconai.com/v1/chat/completions`
  - 响应状态：`200`
  - `content-type=application/json`
- 本地接口已成功返回 JSON 结构，包含：
  - `title`
  - `coreText`
  - `protagonistName`
  - `protagonistIdentity`
  - `targetStory`
  - `rewriteGoal`
  - `constraintText`
  - `usedModelKey`
  - `promptPreview`

### 结论
- 旧错误 `AI enhance response is not valid JSON: <!DOCTYPE html>...` 已不再出现
- 当前“基地址写法”已能正确自动路由到 `/v1/chat/completions`

## 推荐的 `apps/api/.env` 写法示例

### 推荐写法 1：完整接口地址
```env
lc_api_url=https://s.lconai.com/v1/chat/completions
```

### 兼容写法 2：基地址
```env
lc_api_url=https://s.lconai.com
```

## 最终结论
- 已兼容“基地址 / 完整地址 / 旧式完整地址”三种写法
- 已避免再次把 HTML 页面误当作 JSON 解析
- 现有前端与后端接口结构未变更
