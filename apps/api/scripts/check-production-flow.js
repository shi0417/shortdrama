/**
 * 5集最小集成验证脚本：前置检查 + generateDraft + persist + 数据库回查。
 * 会向正式表写入数据，建议在测试库或指定 novel 上执行。
 *
 * Usage:
 *   node scripts/check-production-flow.js [novelId] [startEpisode] [endEpisode] [batchSize] [modelKey]
 *   node scripts/check-production-flow.js 1
 *   node scripts/check-production-flow.js 1 1 5 5
 *
 * Env: DB_*, API_BASE_URL (default http://localhost:4000), API_TOKEN (optional, for JWT)
 */
const mysql = require('mysql2/promise');

const novelId = parseInt(process.argv[2], 10) || 1;
const startEpisode = parseInt(process.argv[3], 10) || 1;
const endEpisode = parseInt(process.argv[4], 10) || 5;
const batchSize = parseInt(process.argv[5], 10) || 5;
const modelKey = process.argv[6] || '';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';
const API_TOKEN = process.env.API_TOKEN || '';
const PIPELINE_PREFIX = '/pipeline';

const dbConfig = {
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
const CORE_TABLES = ['novel_episodes', 'drama_structure_template', 'novel_hook_rhythm'];

function logSection(title) {
  console.log('\n' + title);
}

function ok(msg) {
  console.log('  OK: ' + msg);
}

function fail(msg) {
  console.log('  FAIL: ' + msg);
}

async function httpPost(path, body) {
  const url = API_BASE + PIPELINE_PREFIX + path;
  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = 'Bearer ' + API_TOKEN;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function main() {
  console.log('========================================');
  console.log('Production Flow Integration Check');
  console.log('novelId=' + novelId + ' episodes=' + startEpisode + '-' + endEpisode + ' batchSize=' + batchSize);
  console.log('========================================');
  console.log('\n提示: 本脚本会向正式表写入数据，建议在测试库或指定 novel 上执行。');

  const conn = await mysql.createConnection(dbConfig);
  let draftId = null;
  let draft = null;
  let persistSummary = null;

  try {
    // [1] Table existence
    logSection('[1] Table existence');
    const [tableRows] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_name IN (?)`,
      [dbConfig.database, [...PRODUCTION_TABLES, ...CORE_TABLES]],
    );
    const foundTables = (tableRows || []).map((r) => r.TABLE_NAME);
    for (const t of PRODUCTION_TABLES) {
      if (foundTables.includes(t)) ok(t);
      else {
        fail(t + ' (missing)');
        throw new Error('Missing production table: ' + t);
      }
    }
    for (const t of CORE_TABLES) {
      if (foundTables.includes(t)) ok(t);
      else {
        fail(t + ' (missing)');
        throw new Error('Missing core table: ' + t);
      }
    }

    // [2] Source readiness
    logSection('[2] Source readiness');
    const [[epRow]] = await conn.query(
      `SELECT COUNT(DISTINCT episode_number) AS c FROM novel_episodes WHERE novel_id = ? AND episode_number BETWEEN ? AND ?`,
      [novelId, startEpisode, endEpisode],
    );
    const epCount = epRow?.c ?? 0;
    const expectedEpisodes = endEpisode - startEpisode + 1;
    if (epCount >= expectedEpisodes) ok('novel_episodes has episodes ' + startEpisode + '-' + endEpisode);
    else {
      fail('novel_episodes has only ' + epCount + ' in range (need ' + expectedEpisodes + ')');
      throw new Error('Insufficient episodes');
    }
    const [[structRow]] = await conn.query(
      `SELECT COUNT(*) AS c FROM drama_structure_template WHERE novels_id = ?`,
      [novelId],
    );
    if ((structRow?.c ?? 0) > 0) ok('drama_structure_template has chapters');
    else {
      fail('drama_structure_template has no data');
      throw new Error('No structure template');
    }
    const [[hookRow]] = await conn.query(
      `SELECT COUNT(DISTINCT episode_number) AS c FROM novel_hook_rhythm WHERE novel_id = ? AND episode_number BETWEEN ? AND ?`,
      [novelId, startEpisode, endEpisode],
    );
    ok('novel_hook_rhythm episodes in range: ' + (hookRow?.c ?? 0));

    // [3] Generate draft
    logSection('[3] Generate draft');
    const genBody = {
      startEpisode,
      endEpisode,
      batchSize,
    };
    if (modelKey) genBody.modelKey = modelKey;
    let genResult;
    try {
      genResult = await httpPost('/' + novelId + '/narrator-script-generate-draft', genBody);
    } catch (e) {
      if (e.status === 401) {
        fail('API returned 401. Set API_TOKEN (JWT) to call protected pipeline endpoints.');
        process.exit(1);
      }
      throw e;
    }
    if (!genResult?.draftId) {
      fail('No draftId in response');
      throw new Error('Generate draft failed: no draftId');
    }
    draftId = genResult.draftId;
    draft = genResult.draft || null;
    ok('draftId=' + draftId);
    const scriptCount = genResult.draft?.scripts?.length ?? 0;
    ok('scripts=' + scriptCount);
    const batchCount = genResult.draft?.meta?.batchCount ?? 'n/a';
    ok('batchCount=' + batchCount);
    if (scriptCount < expectedEpisodes) {
      fail('Expected ' + expectedEpisodes + ' scripts, got ' + scriptCount);
      throw new Error('Script count mismatch');
    }

    // [4] Persist
    logSection('[4] Persist');
    const persistBody = { draftId };
    if (draft) persistBody.draft = draft;
    persistSummary = await httpPost('/' + novelId + '/narrator-script-persist', persistBody);
    if (!persistSummary?.ok || !persistSummary?.summary) {
      fail('Persist response missing ok/summary');
      throw new Error('Persist failed');
    }
    const s = persistSummary.summary;
    ok('scriptVersions=' + (s.scriptVersions ?? 0));
    ok('scenes=' + (s.scenes ?? 0));
    ok('shots=' + (s.shots ?? 0));
    ok('prompts=' + (s.prompts ?? 0));
    ok('episodeCoverage=' + (s.episodeCoverage ?? 0));
    ok('batchCount=' + (s.batchCount ?? 'n/a'));

    // [5] DB verification
    logSection('[5] DB verification');
    const [[vRow]] = await conn.query(
      `SELECT COUNT(*) AS c FROM episode_script_versions WHERE novel_id = ? AND episode_number BETWEEN ? AND ? AND is_active = 1`,
      [novelId, startEpisode, endEpisode],
    );
    const vCount = vRow?.c ?? 0;
    if (vCount >= expectedEpisodes) ok('versions in DB=' + vCount);
    else {
      fail('versions in DB=' + vCount + ' (expected >= ' + expectedEpisodes + ')');
      throw new Error('DB version count mismatch');
    }
    const [[scRow]] = await conn.query(
      `SELECT COUNT(*) AS c FROM episode_scenes es
       JOIN episode_script_versions ev ON es.script_version_id = ev.id AND ev.novel_id = ? AND ev.is_active = 1
       WHERE es.episode_number BETWEEN ? AND ?`,
      [novelId, startEpisode, endEpisode],
    );
    const scCount = scRow?.c ?? 0;
    ok('scenes in DB=' + scCount);
    const [[shRow]] = await conn.query(
      `SELECT COUNT(*) AS c FROM episode_shots sh
       JOIN episode_script_versions ev ON sh.script_version_id = ev.id AND ev.novel_id = ? AND ev.is_active = 1
       WHERE sh.episode_number BETWEEN ? AND ?`,
      [novelId, startEpisode, endEpisode],
    );
    ok('shots in DB=' + (shRow?.c ?? 0));
    const [[pRow]] = await conn.query(
      `SELECT COUNT(*) AS c FROM episode_shot_prompts p
       JOIN episode_shots sh ON p.shot_id = sh.id
       JOIN episode_script_versions ev ON sh.script_version_id = ev.id AND ev.novel_id = ? AND ev.is_active = 1
       WHERE sh.episode_number BETWEEN ? AND ?`,
      [novelId, startEpisode, endEpisode],
    );
    ok('prompts in DB=' + (pRow?.c ?? 0));

    const [activeDup] = await conn.query(
      `SELECT novel_id, episode_number, COUNT(*) AS c
       FROM episode_script_versions
       WHERE novel_id = ? AND episode_number BETWEEN ? AND ? AND is_active = 1
       GROUP BY novel_id, episode_number HAVING c > 1`,
      [novelId, startEpisode, endEpisode],
    );
    if ((activeDup || []).length === 0) ok('active versions uniqueness check passed');
    else {
      fail('multiple active versions for same novel_id+episode_number');
      throw new Error('Uniqueness check failed');
    }

    console.log('\n========================================');
    console.log('FINAL RESULT: PASS');
    console.log('========================================');
  } catch (err) {
    console.log('\n========================================');
    console.log('FINAL RESULT: FAIL');
    console.log('========================================');
    if (err.message) console.error('Reason: ' + err.message);
    if (err.data) console.error('Response: ' + JSON.stringify(err.data).slice(0, 300));
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
