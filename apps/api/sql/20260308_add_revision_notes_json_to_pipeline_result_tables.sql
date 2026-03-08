SET @sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'novel_timelines'
      AND COLUMN_NAME = 'revision_notes_json'
  ),
  'SELECT 1',
  'ALTER TABLE novel_timelines ADD COLUMN revision_notes_json LONGTEXT NULL COMMENT ''AI review notes JSON'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'novel_characters'
      AND COLUMN_NAME = 'revision_notes_json'
  ),
  'SELECT 1',
  'ALTER TABLE novel_characters ADD COLUMN revision_notes_json LONGTEXT NULL COMMENT ''AI review notes JSON'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'novel_key_nodes'
      AND COLUMN_NAME = 'revision_notes_json'
  ),
  'SELECT 1',
  'ALTER TABLE novel_key_nodes ADD COLUMN revision_notes_json LONGTEXT NULL COMMENT ''AI review notes JSON'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'novel_skeleton_topic_items'
      AND COLUMN_NAME = 'revision_notes_json'
  ),
  'SELECT 1',
  'ALTER TABLE novel_skeleton_topic_items ADD COLUMN revision_notes_json LONGTEXT NULL COMMENT ''AI review notes JSON'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'novel_explosions'
      AND COLUMN_NAME = 'revision_notes_json'
  ),
  'SELECT 1',
  'ALTER TABLE novel_explosions ADD COLUMN revision_notes_json LONGTEXT NULL COMMENT ''AI review notes JSON'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
