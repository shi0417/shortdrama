/**
 * 5集稳定生产验证前置检查：生产层表存在性 + 核心三表 1~5 集数据是否就绪。
 * Usage: node scripts/check-production-flow.js [novelId]
 * Default novelId=1.
 */
const mysql = require('mysql2/promise');

const defaultConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'duanju',
};

const PRODUCTION_TABLES = [
  'episode_script_versions',
  'episode_scenes',
  'episode_shots',
  'episode_shot_prompts',
  'character_visual_profiles',
];

const CORE_TABLES = [
  'novel_episodes',
  'drama_structure_template',
  'novel_hook_rhythm',
];

async function main() {
  const novelId = parseInt(process.argv[2], 10) || 1;
  const conn = await mysql.createConnection(defaultConfig);
  try {
    console.log('=== 5集稳定生产验证前置检查 ===');
    console.log('novelId:', novelId);
    console.log('');

    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?)`,
      [defaultConfig.database, [...PRODUCTION_TABLES, ...CORE_TABLES]],
    );
    const foundTables = (tableRows || []).map((r) => r.TABLE_NAME);
    const missingProd = PRODUCTION_TABLES.filter((t) => !foundTables.includes(t));
    const missingCore = CORE_TABLES.filter((t) => !foundTables.includes(t));

    console.log('1. 生产层 5 张表:');
    for (const t of PRODUCTION_TABLES) {
      console.log(`   ${foundTables.includes(t) ? 'OK' : 'MISSING'}: ${t}`);
    }
    if (missingProd.length > 0) {
      console.error('Missing production tables:', missingProd.join(', '));
      process.exit(1);
    }
    console.log('');

    console.log('2. 核心三表（narrator 参考）:');
    for (const t of CORE_TABLES) {
      console.log(`   ${foundTables.includes(t) ? 'OK' : 'MISSING'}: ${t}`);
    }
    if (missingCore.length > 0) {
      console.log('   建议: 先执行 db:migrate 确保核心表存在后再做「生成 5 集」验证。');
      console.log('');
      process.exit(1);
    }
    console.log('');

    const epCount = await conn.query(
      `SELECT COUNT(DISTINCT episode_number) AS c FROM novel_episodes WHERE novel_id = ? AND episode_number BETWEEN 1 AND 5`,
      [novelId],
    ).then(([r]) => (r && r[0] && r[0].c) || 0);
    const structureCount = await conn.query(
      `SELECT COUNT(*) AS c FROM drama_structure_template WHERE novels_id = ?`,
      [novelId],
    ).then(([r]) => (r && r[0] && r[0].c) || 0);
    const hookCount = await conn.query(
      `SELECT COUNT(DISTINCT episode_number) AS c FROM novel_hook_rhythm WHERE novel_id = ? AND episode_number BETWEEN 1 AND 5`,
      [novelId],
    ).then(([r]) => (r && r[0] && r[0].c) || 0);

    console.log('3. 核心三表 1~5 集数据（novel_id=' + novelId + '）:');
    console.log('   novel_episodes (1~5 集):', epCount, epCount >= 5 ? 'OK' : '不足 5 集');
    console.log('   drama_structure_template (总条数):', structureCount, structureCount > 0 ? 'OK' : '无');
    console.log('   novel_hook_rhythm (1~5 集):', hookCount, '条');
    console.log('');

    const ready = epCount >= 5 && structureCount > 0;
    if (ready) {
      console.log('建议测试区间: 起始集=1, 结束集=5, batchSize=5');
      console.log('满足「生成 5 集 → 保存 → Scene/Shot 可编辑 → prompt 可改」的前置条件。');
    } else {
      console.log('当前不满足 5 集生成前置条件: 请确保 novel_episodes 至少有 1~5 集，且 drama_structure_template 有数据。');
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
