/**
 * Read-only script to verify episode-script persist results.
 * Usage: node scripts/check-persist-tables.js [novelId]
 * Default novelId = 1
 */
const mysql = require('mysql2/promise');

const NOVEL_ID = parseInt(process.argv[2] || '1', 10);

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'duanju',
  });

  console.log(`=== Checking persist tables for novel_id=${NOVEL_ID} ===\n`);

  // 1. novel_episodes
  console.log('--- novel_episodes ---');
  try {
    const [rows] = await conn.execute(
      'SELECT COUNT(*) as cnt, MIN(episode_number) as min_ep, MAX(episode_number) as max_ep FROM novel_episodes WHERE novel_id = ?',
      [NOVEL_ID],
    );
    console.log('  count / min / max:', rows[0]);
    const [samples] = await conn.execute(
      'SELECT id, novel_id, episode_number, episode_title, created_at, updated_at FROM novel_episodes WHERE novel_id = ? ORDER BY episode_number DESC LIMIT 5',
      [NOVEL_ID],
    );
    console.log('  latest 5 rows (desc):');
    samples.forEach((r) => console.log('   ', JSON.stringify(r)));
  } catch (e) {
    console.log('  ERROR:', e.message);
  }

  // 2. drama_structure_template
  console.log('\n--- drama_structure_template ---');
  try {
    const [rows] = await conn.execute(
      'SELECT COUNT(*) as cnt, MIN(chapter_id) as min_ch, MAX(chapter_id) as max_ch FROM drama_structure_template WHERE novel_id = ?',
      [NOVEL_ID],
    );
    console.log('  count / min / max:', rows[0]);
    const [samples] = await conn.execute(
      'SELECT id, novel_id, chapter_id, structure_name, created_at, updated_at FROM drama_structure_template WHERE novel_id = ? ORDER BY chapter_id DESC LIMIT 5',
      [NOVEL_ID],
    );
    console.log('  latest 5 rows (desc):');
    samples.forEach((r) => console.log('   ', JSON.stringify(r)));
  } catch (e) {
    console.log('  ERROR:', e.message);
  }

  // 3. novel_hook_rhythm
  console.log('\n--- novel_hook_rhythm ---');
  try {
    const [exists] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'novel_hook_rhythm'",
    );
    if (exists[0].cnt === 0) {
      console.log('  TABLE DOES NOT EXIST');
    } else {
      console.log('  table exists');
      const [cols] = await conn.execute(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'novel_hook_rhythm' ORDER BY ordinal_position",
      );
      console.log('  columns:', cols.map((c) => `${c.column_name}(${c.data_type})`).join(', '));
      const [rows] = await conn.execute(
        'SELECT COUNT(*) as cnt, MIN(episode_number) as min_ep, MAX(episode_number) as max_ep FROM novel_hook_rhythm WHERE novel_id = ?',
        [NOVEL_ID],
      );
      console.log('  count / min / max:', rows[0]);
      const [samples] = await conn.execute(
        'SELECT * FROM novel_hook_rhythm WHERE novel_id = ? ORDER BY episode_number DESC LIMIT 5',
        [NOVEL_ID],
      );
      console.log('  latest 5 rows (desc):');
      samples.forEach((r) => console.log('   ', JSON.stringify(r)));
    }
  } catch (e) {
    console.log('  ERROR:', e.message);
  }

  await conn.end();
  console.log('\n=== Done ===');
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
