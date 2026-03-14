/**
 * Run production layer SQL migration (episode_script_versions, episode_scenes, episode_shots, episode_shot_prompts, character_visual_profiles).
 * Usage: node scripts/run-production-migration.js
 * Requires: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (or defaults in script)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const defaultConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'duanju',
  multipleStatements: true,
};

const SQL_PATH = path.join(__dirname, '../sql/20260313_create_production_layer_tables.sql');

async function main() {
  console.log('Production layer migration runner');
  console.log('Config:', { ...defaultConfig, password: defaultConfig.password ? '***' : '' });
  if (!fs.existsSync(SQL_PATH)) {
    console.error('SQL file not found:', SQL_PATH);
    process.exit(1);
  }
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const conn = await mysql.createConnection(defaultConfig);
  try {
    await conn.query(sql);
    console.log('Migration executed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
