# ShortDrama - 短剧管理系统

前后端分离的短剧管理平台（Monorepo）

## 技术栈

- **Frontend**: Next.js 14 (App Router) + TypeScript
- **Backend**: NestJS + TypeORM + MySQL
- **Package Manager**: pnpm

## 项目结构

```
shortdrama/
├── apps/
│   ├── web/          # Next.js 前端
│   └── api/          # NestJS 后端
└── packages/
    └── shared/       # 共享类型（预留）
```

## 环境准备

### 1. 安装依赖

确保已安装：
- Node.js 18+
- pnpm 8+
- MySQL 8.0+

### 2. 数据库准备

连接到 MySQL 并创建数据库：

```sql
CREATE DATABASE IF NOT EXISTS duanju CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE duanju;

-- user 表已存在，确保表结构正确
CREATE TABLE IF NOT EXISTS `user` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户唯一标识',
  `username` VARCHAR(50) NOT NULL COMMENT '用户名',
  `password` VARCHAR(255) NOT NULL COMMENT '密码（加密存储）',
  `phone` VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- 插入测试用户（密码为明文 "123456"）
INSERT INTO `user` (`username`, `password`, `phone`)
VALUES ('admin', '123456', '13800138000')
ON DUPLICATE KEY UPDATE username=username;
```

### 3. 运行数据库迁移

执行迁移脚本添加 theme_id 字段到 drama_novels 表：

**Windows:**
```bash
mysql -uroot -p123456 duanju < apps/api/sql/20260302_add_theme_id.sql
```

**Linux/Mac:**
```bash
mysql -uroot -p123456 duanju < apps/api/sql/20260302_add_theme_id.sql
```

或者直接在 MySQL 客户端中执行：
```sql
USE duanju;
SOURCE apps/api/sql/20260302_add_theme_id.sql;
```

此迁移脚本是幂等的，可以安全地多次执行。

### 4. 配置环境变量

**apps/api/.env** (已创建，检查配置)：
```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=duanju
JWT_SECRET=dev_secret_change_me
PORT=4000
```

**apps/web/.env.local** (已创建)：
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

## 安装与启动

```bash
# 1. 安装所有依赖
pnpm install

# 2. 运行数据库迁移（见上方"运行数据库迁移"部分）

# 3. 启动开发服务器（前后端同时启动）
pnpm dev
```

启动后：
- 前端: http://localhost:3000
- 后端: http://localhost:4000
- 健康检查: http://localhost:4000/health

## 验证步骤

### 1. 测试后端健康检查

```bash
curl http://localhost:4000/health
# 预期返回: {"status":"ok"}
```

### 2. 测试登录接口

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"123456\"}"
```

预期返回：
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "username": "admin",
    "phone": "13800138000"
  }
}
```

### 3. 测试前端登录和项目管理

1. 打开浏览器访问 http://localhost:3000/login
2. 输入用户名 `admin`，密码 `123456`
3. 点击登录
4. 成功后自动跳转到 http://localhost:3000/projects
5. 在项目页面可以：
   - 创建新项目
   - 搜索和筛选项目
   - 编辑项目信息（包括关联题材）
   - 管理参考资料（支持大文本分片加载）
   - 删除项目

## 常见问题

### Q1: MySQL 连接失败

检查：
- MySQL 服务是否启动
- `apps/api/.env` 中的数据库配置是否正确
- 数据库 `duanju` 是否已创建
- 用户 `root` 是否有权限访问

### Q2: CORS 错误

确保：
- 后端已启动在 4000 端口
- 前端访问地址是 http://localhost:3000（不是 127.0.0.1）

### Q3: 登录失败 401

检查：
- 数据库中是否有测试用户
- 用户名和密码是否正确（当前为明文比对）

## 安全注意事项

⚠️ **重要**: 当前密码使用明文存储和比对，仅用于 MVP 开发测试。

**生产环境前必须修改**：
1. 使用 bcrypt 加密存储密码
2. 修改 JWT_SECRET 为强随机字符串
3. 启用 HTTPS
4. 添加请求频率限制

## 下一步开发

- [ ] 实现用户注册（使用 bcrypt 加密密码）
- [ ] 添加 JWT 认证守卫
- [ ] 实现项目列表页面
- [ ] 添加短剧管理功能
- [ ] 实现文件上传
