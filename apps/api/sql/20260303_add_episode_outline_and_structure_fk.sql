-- Migration: add episode outline fields and structure template FK
-- Target DB: duanju
-- Idempotent: yes (safe to rerun)

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_add_episode_outline_and_structure_fk$$
CREATE PROCEDURE sp_add_episode_outline_and_structure_fk()
BEGIN
  DECLARE v_count BIGINT DEFAULT 0;

  -- 1) Add columns to novel_episodes if missing
  SELECT COUNT(*) INTO v_count
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'novel_episodes'
    AND COLUMN_NAME = 'outline_content';
  IF v_count = 0 THEN
    ALTER TABLE novel_episodes ADD COLUMN outline_content LONGTEXT NULL COMMENT '剧情大纲内容';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'novel_episodes'
    AND COLUMN_NAME = 'history_outline';
  IF v_count = 0 THEN
    ALTER TABLE novel_episodes ADD COLUMN history_outline TEXT NULL COMMENT '历史线概要';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'novel_episodes'
    AND COLUMN_NAME = 'rewrite_diff';
  IF v_count = 0 THEN
    ALTER TABLE novel_episodes ADD COLUMN rewrite_diff LONGTEXT NULL COMMENT '改写差异';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'novel_episodes'
    AND COLUMN_NAME = 'structure_template_id';
  IF v_count = 0 THEN
    ALTER TABLE novel_episodes ADD COLUMN structure_template_id INT NULL COMMENT '关联 drama_structure_template.id';
  END IF;

  -- 2) Add index if missing
  SELECT COUNT(*) INTO v_count
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'novel_episodes'
    AND INDEX_NAME = 'idx_episode_structure_template_id';
  IF v_count = 0 THEN
    CREATE INDEX idx_episode_structure_template_id
      ON novel_episodes(structure_template_id);
  END IF;

  -- 3) Add unique key on drama_structure_template(novels_id, chapter_id)
  --    If duplicates exist, skip adding and emit diagnostics.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'drama_structure_template'
    AND CONSTRAINT_TYPE = 'UNIQUE'
    AND CONSTRAINT_NAME = 'uk_template_novel_chapter';

  IF v_count = 0 THEN
    SELECT COUNT(*) INTO @dup_count
    FROM (
      SELECT novels_id, chapter_id, COUNT(*) AS c
      FROM drama_structure_template
      GROUP BY novels_id, chapter_id
      HAVING COUNT(*) > 1
    ) d;

    IF @dup_count = 0 THEN
      ALTER TABLE drama_structure_template
        ADD CONSTRAINT uk_template_novel_chapter UNIQUE (novels_id, chapter_id);
    ELSE
      SELECT 'SKIP_ADD_UNIQUE_UK_TEMPLATE_NOVEL_CHAPTER_DUE_TO_DUPLICATES' AS warning, @dup_count AS duplicate_groups;
    END IF;
  END IF;

  -- 4) Add FK if missing: novel_episodes.structure_template_id -> drama_structure_template.id
  SELECT COUNT(*) INTO v_count
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'novel_episodes'
    AND CONSTRAINT_NAME = 'fk_episode_structure_template';
  IF v_count = 0 THEN
    ALTER TABLE novel_episodes
      ADD CONSTRAINT fk_episode_structure_template
      FOREIGN KEY (structure_template_id) REFERENCES drama_structure_template(id)
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END$$

DELIMITER ;

CALL sp_add_episode_outline_and_structure_fk();
DROP PROCEDURE sp_add_episode_outline_and_structure_fk;
