-- Migration: fix novel_* foreign keys and add timeline_id FKs
-- Target DB: duanju (MySQL 8+)
-- Idempotent: yes (safe to run repeatedly)

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_fix_fk_and_timeline_id$$
CREATE PROCEDURE sp_fix_fk_and_timeline_id()
BEGIN
  DECLARE v_schema VARCHAR(64) DEFAULT DATABASE();
  DECLARE v_table_name VARCHAR(64);
  DECLARE v_constraint_name VARCHAR(64);
  DECLARE v_is_nullable VARCHAR(3);
  DECLARE v_data_type VARCHAR(64);
  DECLARE v_fk_name VARCHAR(64);
  DECLARE done INT DEFAULT 0;
  DECLARE v_count BIGINT DEFAULT 0;
  DECLARE v_stmt LONGTEXT;

  DECLARE cur_drop_novel_fk CURSOR FOR
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE k
    WHERE k.TABLE_SCHEMA = v_schema
      AND k.TABLE_NAME LIKE 'novel\\_%'
      AND k.COLUMN_NAME = 'novel_id'
      AND k.REFERENCED_TABLE_NAME IS NOT NULL
      AND k.REFERENCED_TABLE_NAME <> 'drama_novels'
    ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME;

  DECLARE cur_novel_tables CURSOR FOR
    SELECT c.TABLE_NAME, c.IS_NULLABLE, c.DATA_TYPE
    FROM information_schema.COLUMNS c
    WHERE c.TABLE_SCHEMA = v_schema
      AND c.TABLE_NAME LIKE 'novel\\_%'
      AND c.COLUMN_NAME = 'novel_id'
    ORDER BY c.TABLE_NAME;

  DECLARE cur_drop_timeline_fk CURSOR FOR
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE k
    WHERE k.TABLE_SCHEMA = v_schema
      AND k.TABLE_NAME IN ('novel_explosions', 'novel_key_nodes')
      AND k.COLUMN_NAME = 'timeline_id'
      AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  -- Step 1: audit snapshot (result set for execution report)
  SELECT
    k.TABLE_NAME,
    k.CONSTRAINT_NAME,
    k.COLUMN_NAME,
    k.REFERENCED_TABLE_NAME,
    k.REFERENCED_COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE k
  WHERE k.TABLE_SCHEMA = v_schema
    AND k.TABLE_NAME LIKE 'novel\\_%'
    AND k.REFERENCED_TABLE_NAME IS NOT NULL
    AND k.REFERENCED_TABLE_NAME = 'novels'
  ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME;

  -- Step 2A: drop all wrong novel_id foreign keys in novel_* (including refs to novels)
  SET done = 0;
  OPEN cur_drop_novel_fk;
  drop_novel_fk_loop: LOOP
    FETCH cur_drop_novel_fk INTO v_table_name, v_constraint_name;
    IF done = 1 THEN
      LEAVE drop_novel_fk_loop;
    END IF;

    SET @sql_text = CONCAT(
      'ALTER TABLE `', v_table_name, '` DROP FOREIGN KEY `', v_constraint_name, '`'
    );
    PREPARE stmt FROM @sql_text;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur_drop_novel_fk;

  -- Step 2D-1: ensure timeline_id columns exist and are nullable INT
  SELECT COUNT(*)
    INTO v_count
  FROM information_schema.COLUMNS c
  WHERE c.TABLE_SCHEMA = v_schema
    AND c.TABLE_NAME = 'novel_explosions'
    AND c.COLUMN_NAME = 'timeline_id';
  IF v_count = 0 THEN
    ALTER TABLE novel_explosions ADD COLUMN timeline_id INT NULL AFTER novel_id;
  END IF;

  SELECT COUNT(*)
    INTO v_count
  FROM information_schema.COLUMNS c
  WHERE c.TABLE_SCHEMA = v_schema
    AND c.TABLE_NAME = 'novel_key_nodes'
    AND c.COLUMN_NAME = 'timeline_id';
  IF v_count = 0 THEN
    ALTER TABLE novel_key_nodes ADD COLUMN timeline_id INT NULL AFTER novel_id;
  END IF;
  ALTER TABLE novel_explosions MODIFY COLUMN timeline_id INT NULL;
  ALTER TABLE novel_key_nodes MODIFY COLUMN timeline_id INT NULL;

  -- Step 2E: orphan checks + default strategy(1) cleanup for required tables
  SELECT COUNT(*) AS orphan_novel_timelines_novel_id
  FROM novel_timelines t
  WHERE NOT EXISTS (SELECT 1 FROM drama_novels d WHERE d.id = t.novel_id);

  SELECT COUNT(*) AS orphan_novel_explosions_novel_id
  FROM novel_explosions e
  WHERE NOT EXISTS (SELECT 1 FROM drama_novels d WHERE d.id = e.novel_id);

  SELECT COUNT(*) AS orphan_novel_key_nodes_novel_id
  FROM novel_key_nodes k
  WHERE NOT EXISTS (SELECT 1 FROM drama_novels d WHERE d.id = k.novel_id);

  SELECT COUNT(*) AS orphan_novel_explosions_timeline_id
  FROM novel_explosions e
  WHERE e.timeline_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM novel_timelines t WHERE t.id = e.timeline_id);

  SELECT COUNT(*) AS orphan_novel_key_nodes_timeline_id
  FROM novel_key_nodes k
  WHERE k.timeline_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM novel_timelines t WHERE t.id = k.timeline_id);

  -- Default strategy(1): clean invalid timeline_id first (set NULL)
  UPDATE novel_explosions e
  SET e.timeline_id = NULL
  WHERE e.timeline_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM novel_timelines t WHERE t.id = e.timeline_id);
  SELECT ROW_COUNT() AS cleaned_novel_explosions_timeline_id_rows;

  UPDATE novel_key_nodes k
  SET k.timeline_id = NULL
  WHERE k.timeline_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM novel_timelines t WHERE t.id = k.timeline_id);
  SELECT ROW_COUNT() AS cleaned_novel_key_nodes_timeline_id_rows;

  -- Default strategy(1): clean invalid novel_id in ALL novel_* tables with novel_id
  SET done = 0;
  OPEN cur_novel_tables;
  clean_and_fix_loop: LOOP
    FETCH cur_novel_tables INTO v_table_name, v_is_nullable, v_data_type;
    IF done = 1 THEN
      LEAVE clean_and_fix_loop;
    END IF;

    -- Align type with drama_novels.id (INT)
    IF v_data_type <> 'int' THEN
      IF v_is_nullable = 'YES' THEN
        SET @sql_text = CONCAT('ALTER TABLE `', v_table_name, '` MODIFY COLUMN `novel_id` INT NULL');
      ELSE
        SET @sql_text = CONCAT('ALTER TABLE `', v_table_name, '` MODIFY COLUMN `novel_id` INT NOT NULL');
      END IF;
      PREPARE stmt FROM @sql_text;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    -- Print orphan count before cleanup
    SET @orphan_count = 0;
    SET @sql_text = CONCAT(
      'SELECT COUNT(*) INTO @orphan_count FROM `', v_table_name, '` x ',
      'WHERE NOT EXISTS (SELECT 1 FROM `drama_novels` d WHERE d.id = x.novel_id)'
    );
    PREPARE stmt FROM @sql_text;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SELECT v_table_name AS table_name, @orphan_count AS orphan_novel_id_before_cleanup;

    -- Strategy(1): nullable -> set NULL, not-null -> delete rows
    IF v_is_nullable = 'YES' THEN
      SET @sql_text = CONCAT(
        'UPDATE `', v_table_name, '` x ',
        'SET x.novel_id = NULL ',
        'WHERE NOT EXISTS (SELECT 1 FROM `drama_novels` d WHERE d.id = x.novel_id)'
      );
    ELSE
      SET @sql_text = CONCAT(
        'DELETE x FROM `', v_table_name, '` x ',
        'WHERE NOT EXISTS (SELECT 1 FROM `drama_novels` d WHERE d.id = x.novel_id)'
      );
    END IF;
    PREPARE stmt FROM @sql_text;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    SELECT v_table_name AS table_name, ROW_COUNT() AS cleaned_rows_strategy1;

    -- Ensure an index on novel_id exists before adding FK
    SELECT COUNT(*)
      INTO v_count
    FROM information_schema.STATISTICS s
    WHERE s.TABLE_SCHEMA = v_schema
      AND s.TABLE_NAME = v_table_name
      AND s.COLUMN_NAME = 'novel_id';

    IF v_count = 0 THEN
      SET @sql_text = CONCAT(
        'CREATE INDEX `idx_', v_table_name, '_novel_id` ON `', v_table_name, '`(`novel_id`)'
      );
      PREPARE stmt FROM @sql_text;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    -- Add FK if missing: novel_id -> drama_novels(id) ON DELETE/UPDATE CASCADE
    SELECT COUNT(*)
      INTO v_count
    FROM information_schema.KEY_COLUMN_USAGE k
    WHERE k.TABLE_SCHEMA = v_schema
      AND k.TABLE_NAME = v_table_name
      AND k.COLUMN_NAME = 'novel_id'
      AND k.REFERENCED_TABLE_NAME = 'drama_novels'
      AND k.REFERENCED_COLUMN_NAME = 'id';

    IF v_count = 0 THEN
      SET v_fk_name = CONCAT('fk_', v_table_name, '_novel_id_drama_novels');
      SET @sql_text = CONCAT(
        'ALTER TABLE `', v_table_name, '` ',
        'ADD CONSTRAINT `', v_fk_name, '` FOREIGN KEY (`novel_id`) ',
        'REFERENCES `drama_novels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
      );
      PREPARE stmt FROM @sql_text;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;
  END LOOP;
  CLOSE cur_novel_tables;

  -- Step 2D-2: reset timeline FKs, then add required definitions
  SET done = 0;
  OPEN cur_drop_timeline_fk;
  drop_timeline_fk_loop: LOOP
    FETCH cur_drop_timeline_fk INTO v_table_name, v_constraint_name;
    IF done = 1 THEN
      LEAVE drop_timeline_fk_loop;
    END IF;

    SET @sql_text = CONCAT(
      'ALTER TABLE `', v_table_name, '` DROP FOREIGN KEY `', v_constraint_name, '`'
    );
    PREPARE stmt FROM @sql_text;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur_drop_timeline_fk;

  -- Ensure timeline indexes exist
  SELECT COUNT(*)
    INTO v_count
  FROM information_schema.STATISTICS s
  WHERE s.TABLE_SCHEMA = v_schema
    AND s.TABLE_NAME = 'novel_explosions'
    AND s.COLUMN_NAME = 'timeline_id';
  IF v_count = 0 THEN
    CREATE INDEX idx_novel_explosions_timeline_id ON novel_explosions(timeline_id);
  END IF;

  SELECT COUNT(*)
    INTO v_count
  FROM information_schema.STATISTICS s
  WHERE s.TABLE_SCHEMA = v_schema
    AND s.TABLE_NAME = 'novel_key_nodes'
    AND s.COLUMN_NAME = 'timeline_id';
  IF v_count = 0 THEN
    CREATE INDEX idx_novel_key_nodes_timeline_id ON novel_key_nodes(timeline_id);
  END IF;

  -- Add timeline_id FKs (nullable + SET NULL)
  SELECT COUNT(*)
    INTO v_count
  FROM information_schema.KEY_COLUMN_USAGE k
  WHERE k.TABLE_SCHEMA = v_schema
    AND k.TABLE_NAME = 'novel_explosions'
    AND k.COLUMN_NAME = 'timeline_id'
    AND k.REFERENCED_TABLE_NAME = 'novel_timelines'
    AND k.REFERENCED_COLUMN_NAME = 'id';
  IF v_count = 0 THEN
    ALTER TABLE novel_explosions
      ADD CONSTRAINT fk_novel_explosions_timeline_id_novel_timelines
      FOREIGN KEY (timeline_id) REFERENCES novel_timelines(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  SELECT COUNT(*)
    INTO v_count
  FROM information_schema.KEY_COLUMN_USAGE k
  WHERE k.TABLE_SCHEMA = v_schema
    AND k.TABLE_NAME = 'novel_key_nodes'
    AND k.COLUMN_NAME = 'timeline_id'
    AND k.REFERENCED_TABLE_NAME = 'novel_timelines'
    AND k.REFERENCED_COLUMN_NAME = 'id';
  IF v_count = 0 THEN
    ALTER TABLE novel_key_nodes
      ADD CONSTRAINT fk_novel_key_nodes_timeline_id_novel_timelines
      FOREIGN KEY (timeline_id) REFERENCES novel_timelines(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- Final verification result sets
  SELECT
    k.TABLE_NAME,
    k.CONSTRAINT_NAME,
    k.COLUMN_NAME,
    k.REFERENCED_TABLE_NAME,
    k.REFERENCED_COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE k
  WHERE k.TABLE_SCHEMA = v_schema
    AND k.TABLE_NAME LIKE 'novel\\_%'
    AND k.REFERENCED_TABLE_NAME IS NOT NULL
  ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME;

  SELECT COUNT(*) AS fk_still_pointing_to_novels
  FROM information_schema.KEY_COLUMN_USAGE k
  WHERE k.TABLE_SCHEMA = v_schema
    AND k.REFERENCED_TABLE_NAME = 'novels';
END$$

DELIMITER ;

-- Execute migration
CALL sp_fix_fk_and_timeline_id();
DROP PROCEDURE sp_fix_fk_and_timeline_id;

-- ---------------------------
-- Optional strategy(2): strict placeholder-rows approach (NOT executed by default)
-- ---------------------------
-- 1) Insert placeholder drama_novels rows for missing novel_id values in novel_* tables.
--    Example (adjust required columns per business rules):
--    INSERT INTO drama_novels (id, novels_name, status)
--    SELECT missing_id, CONCAT('placeholder_', missing_id), 0
--    FROM (
--      SELECT DISTINCT x.novel_id AS missing_id
--      FROM novel_timelines x
--      LEFT JOIN drama_novels d ON d.id = x.novel_id
--      WHERE d.id IS NULL
--    ) t;
--
-- 2) Insert placeholder novel_timelines rows for missing timeline_id values if business allows.
--    Then rerun this migration to build FKs without deleting rows.
