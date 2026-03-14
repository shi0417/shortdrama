-- Migration: create novel_hook_rhythm table (idempotent)
-- Target DB: duanju

CREATE TABLE IF NOT EXISTS novel_hook_rhythm (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  episode_number INT NOT NULL COMMENT '集数',
  emotion_level INT NULL COMMENT '情绪等级',
  hook_type VARCHAR(50) NULL COMMENT '爽点类型（悬念、反转、智斗、史诗、震撼、泪点、燃、惊悚、压迫、核弹）',
  description TEXT NULL COMMENT '一句话描述',
  cliffhanger TEXT NULL COMMENT '尾钩',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_novel_hook_rhythm_novel
    FOREIGN KEY (novel_id) REFERENCES drama_novels(id) ON DELETE CASCADE,
  INDEX idx_novel_ep (novel_id, episode_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
