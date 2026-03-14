/**
 * Verify that the 5 production layer tables exist.
 * Usage: node scripts/verify-production-tables.js
 */
const mysql = require('mysql2/promise');

const defaultConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'duanju',
};

const REQUIRED_TABLES = [
  'episode_script_versions',
  'episode_scenes',
  'episode_shots',
  'episode_shot_prompts',
  'character_visual_profiles',
];

async function main() {
  const conn = await mysql.createConnection(defaultConfig);
  try {
    const [rows] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?)`,
      [defaultConfig.database, REQUIRED_TABLES],
    );
    const found = (rows || []).map((r) => r.TABLE_NAME);
    const missing = REQUIRED_TABLES.filter((t) => !found.includes(t));
    console.log('Production layer tables check:');
    for (const t of REQUIRED_TABLES) {
      console.log(`  ${found.includes(t) ? 'OK' : 'MISSING'}: ${t}`);
    }
    if (missing.length > 0) {
      console.error('Missing tables:', missing.join(', '));
      process.exit(1);
    }
    console.log('All 5 tables exist.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
