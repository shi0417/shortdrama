-- Migration: create production layer tables (episode script versions / scenes / shots / shot prompts / character visual profiles)
-- Target DB: duanju
-- Idempotent: yes

CREATE TABLE IF NOT EXISTS episode_script_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  episode_number INT NOT NULL COMMENT '集数',
  source_episode_id INT DEFAULT NULL COMMENT '关联 novel_episodes.id，可空',
  version_no INT DEFAULT 1 COMMENT '版本号，按同一集内递增',
  script_type VARCHAR(50) NOT NULL COMMENT '脚本类型：outline / ai_video / narrator_video / final 等',
  title VARCHAR(255) NOT NULL COMMENT '脚本版本标题',
  summary TEXT NULL COMMENT '该脚本版本概述',
  status VARCHAR(30) DEFAULT 'draft' COMMENT '状态：draft / approved / locked',
  is_active TINYINT DEFAULT 1 COMMENT '是否当前启用版本（同一集通常仅有一个为 1）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_script_versions_ep (novel_id, episode_number, version_no),
  INDEX idx_script_versions_active (novel_id, episode_number, is_active),
  CONSTRAINT fk_script_versions_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分集脚本版本表（支持多版本与当前启用版本）';

CREATE TABLE IF NOT EXISTS episode_scenes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  script_version_id INT NOT NULL COMMENT '关联 episode_script_versions.id',
  episode_number INT NOT NULL COMMENT '冗余集数，便于查询与过滤',
  scene_no INT NOT NULL COMMENT '场景序号（从 1 开始，按剧本内顺序递增）',
  scene_title VARCHAR(255) NOT NULL COMMENT '场景标题（如 开场灵堂 / 御书房争执）',
  location_name VARCHAR(255) NULL COMMENT '场景地点，如 灵堂 / 御书房 / 宫道',
  scene_summary TEXT NULL COMMENT '场景概述，说明本场发生了什么',
  main_conflict TEXT NULL COMMENT '该场核心冲突或矛盾点',
  narrator_text LONGTEXT NULL COMMENT '该场主旁白（可包含整场主视角旁白文案）',
  screen_subtitle TEXT NULL COMMENT '该场主屏幕字幕/爆点字（如大字提示）',
  estimated_seconds INT DEFAULT 10 COMMENT '该场预计时长（秒）',
  sort_order INT DEFAULT 0 COMMENT '排序，通常与 scene_no 一致，可用于拖拽重排',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_scenes_version_order (script_version_id, sort_order),
  INDEX idx_scenes_episode (novel_id, episode_number, sort_order),
  CONSTRAINT fk_scenes_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_scenes_script_version FOREIGN KEY (script_version_id) REFERENCES episode_script_versions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分集脚本场景表（将脚本拆解为若干场景）';

CREATE TABLE IF NOT EXISTS episode_shots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  script_version_id INT NOT NULL COMMENT '关联 episode_script_versions.id',
  scene_id INT NOT NULL COMMENT '关联 episode_scenes.id',
  episode_number INT NOT NULL COMMENT '冗余集数，便于按集统计与过滤',
  shot_no INT NOT NULL COMMENT '镜头序号（在所属场景内从 1 开始）',
  shot_type VARCHAR(50) DEFAULT NULL COMMENT '镜头类型，如 wide / medium / close / insert / montage',
  visual_desc LONGTEXT NOT NULL COMMENT '镜头画面说明，描述画面构图/人物/动作/氛围',
  narrator_text LONGTEXT NULL COMMENT '该镜头旁白文本',
  dialogue_text TEXT NULL COMMENT '该镜头对白文本，可为空',
  subtitle_text TEXT NULL COMMENT '该镜头屏幕字幕/屏幕字，可为空',
  duration_sec DECIMAL(5,2) DEFAULT 3.00 COMMENT '镜头时长（秒），如 3.00',
  camera_movement VARCHAR(100) NULL COMMENT '运镜方式，如 push / pan / static / handheld',
  emotion_tag VARCHAR(50) NULL COMMENT '情绪标签，如 压迫 / 悬念 / 反转 / 爽点',
  sort_order INT DEFAULT 0 COMMENT '排序，通常与 shot_no 一致，可用于拖拽重排',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shots_scene_order (scene_id, sort_order),
  INDEX idx_shots_version_ep (script_version_id, episode_number, sort_order),
  CONSTRAINT fk_shots_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_shots_script_version FOREIGN KEY (script_version_id) REFERENCES episode_script_versions(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_shots_scene FOREIGN KEY (scene_id) REFERENCES episode_scenes(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分集脚本镜头表（生产层核心：按场景拆分为多个镜头）';

CREATE TABLE IF NOT EXISTS episode_shot_prompts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  shot_id INT NOT NULL COMMENT '关联 episode_shots.id',
  prompt_type VARCHAR(50) NOT NULL COMMENT '提示词类型，如 image_cn / image_en / video_cn / video_en',
  prompt_text LONGTEXT NOT NULL COMMENT '提示词正文，用于驱动图像/视频生成模型',
  negative_prompt LONGTEXT NULL COMMENT '负向提示词，控制不希望出现的元素',
  model_name VARCHAR(100) NULL COMMENT '生成模型名，如 kling / runway / pika / hailuo',
  style_preset VARCHAR(100) NULL COMMENT '风格预设，如 古装权谋 / 电影感 / 宫廷夜戏',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shot_prompts_type (shot_id, prompt_type),
  CONSTRAINT fk_shot_prompts_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_shot_prompts_shot FOREIGN KEY (shot_id) REFERENCES episode_shots(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='镜头级提示词表（按镜头维度存储多种生成提示词）';

CREATE TABLE IF NOT EXISTS character_visual_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  character_id INT NOT NULL COMMENT '关联 novel_characters.id',
  profile_name VARCHAR(100) NOT NULL COMMENT '视觉方案名称，如 沈照-前期女官版',
  age_range VARCHAR(50) NULL COMMENT '年龄范围描述，如 少女 / 20-25 岁',
  appearance_text LONGTEXT NOT NULL COMMENT '角色外观整体描述（五官、体态、气质等）',
  costume_text LONGTEXT NULL COMMENT '服装与配饰描述',
  hairstyle_text VARCHAR(255) NULL COMMENT '发型描述，如 高髻 / 披发 / 丸子头',
  expression_keywords VARCHAR(255) NULL COMMENT '常见表情关键词，逗号分隔',
  style_keywords VARCHAR(255) NULL COMMENT '整体视觉风格关键词，逗号分隔',
  negative_keywords VARCHAR(255) NULL COMMENT '负向关键词（不希望出现的元素）',
  reference_image_path VARCHAR(500) NULL COMMENT '参考图路径或 URL',
  is_default TINYINT DEFAULT 1 COMMENT '是否默认视觉方案（每个角色通常仅一个为 1）',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_visual_profiles_character_default (character_id, is_default),
  INDEX idx_visual_profiles_novel (novel_id, character_id),
  CONSTRAINT fk_visual_profiles_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_visual_profiles_character FOREIGN KEY (character_id) REFERENCES novel_characters(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色视觉设定表（按角色与视觉方案管理形象信息）';

