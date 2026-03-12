/**
 * Read-only script to verify episode-script persist results.
 * Auto-detects column names — never hardcodes fields that might not exist.
 *
 * Usage: node scripts/check-persist-tables.js [novelId]
 * Default novelId = 1
 */
const mysql = require('mysql2/promise');

const NOVEL_ID = parseInt(process.argv[2] || '1', 10);

async function getColumns(conn, tableName) {
  const [rows] = await conn.execute(
    'SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position',
    [tableName],
  );
  return rows.map((r) => ({
    name: r.COLUMN_NAME || r.column_name,
    type: r.DATA_TYPE || r.data_type,
  }));
}

function hasCol(columns, name) {
  return columns.some((c) => c.name === name);
}

function pickFirst(columns, candidates) {
  for (const name of candidates) {
    if (hasCol(columns, name)) return name;
  }
  return null;
}

async function tableExists(conn, tableName) {
  const [rows] = await conn.execute(
    "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName],
  );
  return rows[0].cnt > 0;
}

function printColumns(columns) {
  console.log('  columns:', columns.map((c) => `${c.name}(${c.type})`).join(', '));
}

async function checkTable(conn, tableName, config) {
  const divider = `--- ${tableName} ---`;
  console.log(`\n${divider}`);

  const exists = await tableExists(conn, tableName);
  if (!exists) {
    console.log('  TABLE DOES NOT EXIST');
    return;
  }
  console.log('  table exists: YES');

  const columns = await getColumns(conn, tableName);
  printColumns(columns);

  const fkCol = pickFirst(columns, config.fkCandidates);
  const epCol = pickFirst(columns, config.epCandidates);
  const orderCol = pickFirst(columns, config.orderCandidates);

  console.log(`  detected → fk: ${fkCol || '(none)'}, episode: ${epCol || '(none)'}, order: ${orderCol || '(none)'}`);

  if (!fkCol) {
    console.log('  WARN: no foreign key column found, skipping filtered queries');
    const [countRows] = await conn.execute(`SELECT COUNT(*) as cnt FROM \`${tableName}\``);
    console.log('  total count:', countRows[0].cnt);
    return;
  }

  // count / min / max
  if (epCol) {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) as cnt, MIN(\`${epCol}\`) as min_ep, MAX(\`${epCol}\`) as max_ep FROM \`${tableName}\` WHERE \`${fkCol}\` = ?`,
      [NOVEL_ID],
    );
    console.log(`  count: ${rows[0].cnt}  |  min ${epCol}: ${rows[0].min_ep}  |  max ${epCol}: ${rows[0].max_ep}`);
  } else {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM \`${tableName}\` WHERE \`${fkCol}\` = ?`,
      [NOVEL_ID],
    );
    console.log(`  count: ${rows[0].cnt}`);
  }

  // latest 5 rows
  const sortExpr = orderCol ? `\`${orderCol}\` DESC` : (epCol ? `\`${epCol}\` DESC` : '1');
  const selectCols = columns.map((c) => `\`${c.name}\``).join(', ');
  const [samples] = await conn.execute(
    `SELECT ${selectCols} FROM \`${tableName}\` WHERE \`${fkCol}\` = ? ORDER BY ${sortExpr} LIMIT 5`,
    [NOVEL_ID],
  );
  console.log(`  latest 5 rows (order by ${sortExpr}):`);
  for (const row of samples) {
    const brief = {};
    for (const col of columns) {
      const v = row[col.name];
      if (v === null || v === undefined) { brief[col.name] = null; continue; }
      const s = String(v);
      brief[col.name] = s.length > 80 ? s.slice(0, 77) + '...' : s;
    }
    console.log('   ', JSON.stringify(brief));
  }
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'duanju',
  });

  console.log(`========================================`);
  console.log(`  Persist Tables Check — novel_id=${NOVEL_ID}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`========================================`);

  await checkTable(conn, 'novel_episodes', {
    fkCandidates: ['novel_id', 'novels_id'],
    epCandidates: ['episode_number', 'chapter_id'],
    orderCandidates: ['updated_at', 'created_at', 'create_time', 'id'],
  });

  await checkTable(conn, 'drama_structure_template', {
    fkCandidates: ['novels_id', 'novel_id'],
    epCandidates: ['chapter_id', 'episode_number'],
    orderCandidates: ['updated_at', 'created_at', 'create_time', 'id'],
  });

  await checkTable(conn, 'novel_hook_rhythm', {
    fkCandidates: ['novel_id', 'novels_id'],
    epCandidates: ['episode_number', 'chapter_id'],
    orderCandidates: ['updated_at', 'created_at', 'create_time', 'id'],
  });

  await conn.end();
  console.log('\n========== Done ==========');
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
