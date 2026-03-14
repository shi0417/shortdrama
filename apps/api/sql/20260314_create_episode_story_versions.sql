-- Migration: create episode_story_versions (story text layer, versioned per episode)
-- Target DB: duanju
-- Idempotent: yes

CREATE TABLE IF NOT EXISTS episode_story_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  episode_number INT NOT NULL COMMENT '集数',
  source_episode_id INT DEFAULT NULL COMMENT '关联 novel_episodes.id，可空',

  version_no INT DEFAULT 1 COMMENT '版本号，按同一集内递增',
  story_type VARCHAR(50) NOT NULL DEFAULT 'story_text' COMMENT '故事类型：story_text / longform / revised 等',
  title VARCHAR(255) NOT NULL COMMENT '故事版本标题',
  summary TEXT NULL COMMENT '本集故事摘要（便于列表展示）',

  story_text LONGTEXT NOT NULL COMMENT '本集完整连续短剧故事文本',
  story_beat_json JSON NULL COMMENT '结构化故事节拍，可空；后续可存目标/转折/尾钩等',
  word_count INT DEFAULT 0 COMMENT '故事文本字数，便于统计',

  status VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft / approved / locked',
  is_active TINYINT DEFAULT 1 COMMENT '是否当前启用版本（同一集通常仅一个为 1）',

  generation_source VARCHAR(50) DEFAULT 'ai' COMMENT '生成来源：ai / manual / mixed',
  notes TEXT NULL COMMENT '备注，如本版优化点、问题说明',

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_story_versions_ep (novel_id, episode_number, version_no),
  INDEX idx_story_versions_active (novel_id, episode_number, is_active),
  INDEX idx_story_versions_source_episode (source_episode_id),

  CONSTRAINT fk_story_versions_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_story_versions_source_episode FOREIGN KEY (source_episode_id) REFERENCES novel_episodes(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='分集故事正文版本表（完整连续短剧故事文本层）';
