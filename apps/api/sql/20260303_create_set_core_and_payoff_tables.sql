-- Migration: create set_core / set_payoff_arch / set_payoff_lines
-- Target DB: duanju
-- Idempotent: yes

CREATE TABLE IF NOT EXISTS `set_core` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `novel_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `core_text` LONGTEXT NOT NULL,
  `protagonist_name` VARCHAR(100) DEFAULT NULL,
  `protagonist_identity` VARCHAR(255) DEFAULT NULL,
  `target_story` VARCHAR(100) DEFAULT NULL,
  `rewrite_goal` VARCHAR(255) DEFAULT NULL,
  `constraint_text` VARCHAR(255) DEFAULT NULL,
  `version` INT DEFAULT 1,
  `is_active` TINYINT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_set_core_novel` (`novel_id`),
  KEY `idx_set_core_active` (`novel_id`, `is_active`),
  CONSTRAINT `fk_set_core_novel`
    FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `set_payoff_arch` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `novel_id` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `notes` TEXT DEFAULT NULL,
  `version` INT DEFAULT 1,
  `is_active` TINYINT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payoff_arch_novel` (`novel_id`),
  KEY `idx_payoff_arch_active` (`novel_id`, `is_active`),
  CONSTRAINT `fk_payoff_arch_novel`
    FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `set_payoff_lines` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `novel_id` INT NOT NULL,
  `payoff_arch_id` INT NOT NULL,
  `line_key` VARCHAR(50) NOT NULL,
  `line_name` VARCHAR(100) NOT NULL,
  `line_content` TEXT NOT NULL,
  `start_ep` INT DEFAULT NULL,
  `end_ep` INT DEFAULT NULL,
  `stage_text` VARCHAR(100) DEFAULT NULL,
  `sort_order` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payoff_lines_arch` (`payoff_arch_id`, `sort_order`),
  KEY `idx_payoff_lines_novel` (`novel_id`, `sort_order`),
  KEY `idx_payoff_lines_ep` (`novel_id`, `start_ep`, `end_ep`),
  CONSTRAINT `fk_payoff_lines_novel`
    FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_payoff_lines_arch`
    FOREIGN KEY (`payoff_arch_id`) REFERENCES `set_payoff_arch` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
