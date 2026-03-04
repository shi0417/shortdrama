-- Migration: create novel skeleton topics tables
-- Target DB: duanju
-- Idempotent: yes

CREATE TABLE IF NOT EXISTS novel_skeleton_topics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  topic_key VARCHAR(64) NOT NULL,
  topic_name VARCHAR(100) NOT NULL,
  topic_type ENUM('text','list','json') NOT NULL DEFAULT 'text',
  description VARCHAR(255) DEFAULT NULL,
  sort_order INT DEFAULT 0,
  is_enabled TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_novel_skeleton_topics_novel_topic_key (novel_id, topic_key),
  INDEX idx_novel_skeleton_topics_novel_sort (novel_id, sort_order),
  CONSTRAINT fk_novel_skeleton_topics_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS novel_skeleton_topic_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  topic_id INT NOT NULL,
  item_title VARCHAR(255) DEFAULT NULL,
  content LONGTEXT DEFAULT NULL,
  content_json JSON DEFAULT NULL,
  sort_order INT DEFAULT 0,
  source_ref VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_novel_skeleton_topic_items_topic_sort (topic_id, sort_order),
  INDEX idx_novel_skeleton_topic_items_novel_topic (novel_id, topic_id),
  CONSTRAINT fk_novel_skeleton_topic_items_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_novel_skeleton_topic_items_topic FOREIGN KEY (topic_id) REFERENCES novel_skeleton_topics(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
