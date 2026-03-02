-- 创建 user 表（如果表不存在则创建）
CREATE TABLE IF NOT EXISTS `user` (
  -- 主键 ID，自增，非空
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户唯一标识',
  -- 用户名，非空，唯一（避免重复注册），长度 50
  `username` VARCHAR(50) NOT NULL COMMENT '用户名',
  -- 密码，非空（建议存储加密后的密码），长度 255
  `password` VARCHAR(255) NOT NULL COMMENT '密码（加密存储）',
  -- 手机号，唯一（可选，根据业务调整），长度 20
  `phone` VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  -- 创建时间，默认当前时间，非空
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  -- 更新时间，默认当前时间，更新时自动刷新
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  -- 设置主键
  PRIMARY KEY (`id`),
  -- 用户名唯一索引
  UNIQUE KEY `uk_username` (`username`),
  -- 手机号唯一索引（如果业务要求手机号唯一）
  UNIQUE KEY `uk_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';