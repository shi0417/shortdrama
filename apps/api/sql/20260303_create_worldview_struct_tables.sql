-- Migration: create structured worldview system tables
-- Target DB: duanju
-- Idempotent: yes

CREATE TABLE IF NOT EXISTS set_core (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  title VARCHAR(255) NOT NULL COMMENT '设定标题',
  core_text LONGTEXT NOT NULL COMMENT '核心设定正文（Markdown/纯文本）',
  protagonist_name VARCHAR(100) DEFAULT NULL,
  protagonist_identity VARCHAR(255) DEFAULT NULL,
  target_story VARCHAR(100) DEFAULT NULL,
  rewrite_goal VARCHAR(255) DEFAULT NULL,
  constraint_text VARCHAR(255) DEFAULT NULL,
  version INT DEFAULT 1,
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_set_core_novel (novel_id),
  INDEX idx_set_core_active (novel_id, is_active),
  CONSTRAINT fk_set_core_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='核心设定（主设定/世界观/主线矛盾）';

CREATE TABLE IF NOT EXISTS set_payoff_arch (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  name VARCHAR(255) NOT NULL COMMENT '爽点架构名称',
  notes TEXT DEFAULT NULL COMMENT '总体说明',
  version INT DEFAULT 1,
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payoff_arch_novel (novel_id),
  INDEX idx_payoff_arch_active (novel_id, is_active),
  CONSTRAINT fk_payoff_arch_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='核心爽点架构（总表/方案）';

CREATE TABLE IF NOT EXISTS set_payoff_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '冗余：便于按项目查询',
  payoff_arch_id INT NOT NULL COMMENT '关联 set_payoff_arch.id',
  line_key VARCHAR(50) NOT NULL COMMENT '爽点线Key',
  line_name VARCHAR(100) NOT NULL COMMENT '爽点线名称',
  line_content TEXT NOT NULL COMMENT '爽点线内容描述',
  start_ep INT DEFAULT NULL,
  end_ep INT DEFAULT NULL,
  stage_text VARCHAR(100) DEFAULT NULL COMMENT '释放阶段文本',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payoff_lines_arch (payoff_arch_id, sort_order),
  INDEX idx_payoff_lines_novel (novel_id, sort_order),
  INDEX idx_payoff_lines_ep (novel_id, start_ep, end_ep),
  CONSTRAINT fk_payoff_lines_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payoff_lines_arch FOREIGN KEY (payoff_arch_id) REFERENCES set_payoff_arch(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='爽点线明细（可扩展）';

CREATE TABLE IF NOT EXISTS set_opponent_matrix (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL COMMENT '关联 drama_novels.id',
  name VARCHAR(255) NOT NULL COMMENT '矩阵名称',
  description TEXT DEFAULT NULL COMMENT '整体说明',
  version INT DEFAULT 1,
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_opponent_matrix_novel (novel_id),
  INDEX idx_opponent_matrix_active (novel_id, is_active),
  CONSTRAINT fk_opponent_matrix_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对手矩阵总表';

CREATE TABLE IF NOT EXISTS set_opponents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  opponent_matrix_id INT NOT NULL,
  level_name VARCHAR(50) NOT NULL COMMENT '层级（外敌/内鬼/猪队友/身份危机）',
  opponent_name VARCHAR(255) NOT NULL COMMENT '对手名称',
  threat_type VARCHAR(255) DEFAULT NULL COMMENT '威胁方式',
  detailed_desc TEXT DEFAULT NULL COMMENT '详细描述',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_opponents_matrix (opponent_matrix_id, sort_order),
  INDEX idx_opponents_novel (novel_id, sort_order),
  CONSTRAINT fk_opponents_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_opponents_matrix FOREIGN KEY (opponent_matrix_id) REFERENCES set_opponent_matrix(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='对手矩阵明细';

CREATE TABLE IF NOT EXISTS set_power_ladder (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  level_no INT NOT NULL COMMENT '等级数字（1..N）',
  level_title VARCHAR(100) NOT NULL COMMENT '等级名（如 Lv.1 普通女官）',
  identity_desc VARCHAR(255) NOT NULL COMMENT '身份',
  ability_boundary TEXT NOT NULL COMMENT '能力边界',
  start_ep INT DEFAULT NULL COMMENT '达成起始集',
  end_ep INT DEFAULT NULL COMMENT '达成结束集',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_power_ladder_novel (novel_id, level_no),
  CONSTRAINT fk_power_ladder_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权力升级阶梯';

CREATE TABLE IF NOT EXISTS set_traitor_system (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  name VARCHAR(255) NOT NULL COMMENT '系统名称',
  description TEXT DEFAULT NULL,
  version INT DEFAULT 1,
  is_active TINYINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_traitor_system_novel (novel_id),
  CONSTRAINT fk_traitor_system_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内鬼系统总表';

CREATE TABLE IF NOT EXISTS set_traitors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  traitor_system_id INT NOT NULL,
  name VARCHAR(100) NOT NULL COMMENT '角色名',
  public_identity VARCHAR(255) DEFAULT NULL COMMENT '表面身份',
  real_identity VARCHAR(255) DEFAULT NULL COMMENT '真实身份',
  mission TEXT DEFAULT NULL COMMENT '任务目标',
  threat_desc TEXT DEFAULT NULL COMMENT '威胁方式',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_traitors_system (traitor_system_id, sort_order),
  INDEX idx_traitors_novel (novel_id, sort_order),
  CONSTRAINT fk_traitors_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_traitors_system FOREIGN KEY (traitor_system_id) REFERENCES set_traitor_system(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内鬼角色';

CREATE TABLE IF NOT EXISTS set_traitor_stages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  traitor_system_id INT NOT NULL,
  stage_title VARCHAR(255) NOT NULL COMMENT '阶段标题',
  stage_desc TEXT NOT NULL COMMENT '阶段描述',
  start_ep INT DEFAULT NULL,
  end_ep INT DEFAULT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_traitor_stage_system (traitor_system_id, sort_order),
  INDEX idx_traitor_stage_novel (novel_id, sort_order),
  CONSTRAINT fk_traitor_stage_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_traitor_stage_system FOREIGN KEY (traitor_system_id) REFERENCES set_traitor_system(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内鬼阶段推进';

CREATE TABLE IF NOT EXISTS set_story_phases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  novel_id INT NOT NULL,
  phase_name VARCHAR(100) NOT NULL COMMENT '阶段名称',
  start_ep INT NOT NULL,
  end_ep INT NOT NULL,
  historical_path TEXT DEFAULT NULL COMMENT '历史走向',
  rewrite_path TEXT DEFAULT NULL COMMENT '改写走向',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_story_phase_novel (novel_id, sort_order),
  INDEX idx_story_phase_ep (novel_id, start_ep, end_ep),
  CONSTRAINT fk_story_phase_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='故事发展阶段设计';
