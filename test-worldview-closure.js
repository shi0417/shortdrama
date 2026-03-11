const http = require('http');
const https = require('https');

// 测试结果收集
const testResult = {
  serviceCheck: {
    frontendReachable: false,
    backendReachable: false,
    loginSuccess: false
  },
  runtimeFieldsLoaded: false,
  previewResult: null,
  generateResult: null,
  persistResult: null,
  overviewResult: null,
  dbChecks: {
    unableDirectDb: true,
    alternativeEvidence: []
  },
  uiChecks: {
    unableToAccessUI: true,
    reason: "Using API-based testing instead of browser automation"
  },
  verdictCandidate: null
};

let authToken = null;

// HTTP 请求辅助函数
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const client = options.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=== 开始 Worldview 闭环补测 ===\n');

  // 1. 检查服务可达性
  console.log('1. 检查服务状态...');
  try {
    const frontendCheck = await makeRequest({
      hostname: 'localhost',
      port: 3000,
      path: '/',
      method: 'GET',
      timeout: 5000
    });
    testResult.serviceCheck.frontendReachable = frontendCheck.status === 200;
    console.log(`   前端服务: ${testResult.serviceCheck.frontendReachable ? '✓' : '✗'} (${frontendCheck.status})`);
  } catch (e) {
    console.log(`   前端服务: ✗ (${e.message})`);
  }

  try {
    const backendCheck = await makeRequest({
      hostname: 'localhost',
      port: 4000,
      path: '/health',
      method: 'GET',
      timeout: 5000
    });
    testResult.serviceCheck.backendReachable = backendCheck.status === 200;
    console.log(`   后端服务: ${testResult.serviceCheck.backendReachable ? '✓' : '✗'} (${backendCheck.status})`);
  } catch (e) {
    console.log(`   后端服务: ✗ (${e.message})`);
  }

  if (!testResult.serviceCheck.backendReachable) {
    console.log('\n后端服务不可达，无法继续测试');
    console.log(JSON.stringify(testResult, null, 2));
    return;
  }

  // 2. 登录
  console.log('\n2. 执行登录...');
  try {
    const loginRes = await makeRequest({
      hostname: 'localhost',
      port: 4000,
      path: '/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, {
      username: 's01',
      password: '123456'
    });

    if (loginRes.status === 200 || loginRes.status === 201) {
      authToken = loginRes.data.access_token || loginRes.data.token;
      testResult.serviceCheck.loginSuccess = !!authToken;
      console.log(`   登录: ${testResult.serviceCheck.loginSuccess ? '✓' : '✗'}`);
    } else {
      console.log(`   登录失败: ${loginRes.status}`);
    }
  } catch (e) {
    console.log(`   登录异常: ${e.message}`);
  }

  if (!authToken) {
    console.log('\n登录失败，无法继续测试');
    console.log(JSON.stringify(testResult, null, 2));
    return;
  }

  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  };

  // 3. Preview - 预览世界观
  console.log('\n3. 执行 Preview (预览世界观)...');
  try {
    const previewRes = await makeRequest({
      hostname: 'localhost',
      port: 4000,
      path: '/pipeline/1/worldview/preview',
      method: 'POST',
      headers
    });

    console.log(`   Preview 状态: ${previewRes.status}`);
    testResult.previewResult = {
      status: previewRes.status,
      validationReportPreview: previewRes.data.validationReportPreview || null,
      evidenceSummary: previewRes.data.evidenceSummary || null,
      promptEvidenceOffTopicHits: {
        张士诚: previewRes.data.promptEvidenceOffTopicHits?.['张士诚'] || null,
        陈友谅: previewRes.data.promptEvidenceOffTopicHits?.['陈友谅'] || null,
        蓝玉: previewRes.data.promptEvidenceOffTopicHits?.['蓝玉'] || null,
        胡惟庸: previewRes.data.promptEvidenceOffTopicHits?.['胡惟庸'] || null
      },
      rawResponse: previewRes.data
    };

    // 检查运行时字段
    const fieldsToCheck = [
      'validationReportPreview', 'validationReport', 'initialValidationReport',
      'finalValidationReport', 'repairSummary', 'closureStatus', 'repairApplied', 'evidenceReselected'
    ];
    const foundFields = fieldsToCheck.filter(f => previewRes.data.hasOwnProperty(f));
    if (foundFields.length > 0) {
      testResult.runtimeFieldsLoaded = true;
      console.log(`   发现运行时字段: ${foundFields.join(', ')}`);
    }

    console.log(`   Preview 完成`);
  } catch (e) {
    console.log(`   Preview 异常: ${e.message}`);
    testResult.previewResult = { status: 'error', error: e.message };
  }

  // 4. Generate - 生成世界观草稿
  console.log('\n4. 执行 Generate (生成世界观草稿)...');
  try {
    const generateRes = await makeRequest({
      hostname: 'localhost',
      port: 4000,
      path: '/pipeline/1/worldview/generate',
      method: 'POST',
      headers
    });

    console.log(`   Generate 状态: ${generateRes.status}`);
    
    testResult.generateResult = {
      status: generateRes.status,
      closureStatus: generateRes.data.closureStatus || null,
      repairApplied: generateRes.data.repairApplied || null,
      evidenceReselected: generateRes.data.evidenceReselected || null,
      repairSummary: generateRes.data.repairSummary || null,
      initialValidationReport: generateRes.data.initialValidationReport || null,
      finalValidationReport: generateRes.data.finalValidationReport || null,
      delta: {
        score: {
          before: generateRes.data.initialValidationReport?.overallScore || null,
          after: generateRes.data.finalValidationReport?.overallScore || null
        },
        fatal: {
          before: generateRes.data.initialValidationReport?.summary?.fatal || null,
          after: generateRes.data.finalValidationReport?.summary?.fatal || null
        },
        major: {
          before: generateRes.data.initialValidationReport?.summary?.major || null,
          after: generateRes.data.finalValidationReport?.summary?.major || null
        },
        minor: {
          before: generateRes.data.initialValidationReport?.summary?.minor || null,
          after: generateRes.data.finalValidationReport?.summary?.minor || null
        }
      },
      moduleSamples: {
        payoffLines: generateRes.data.draft?.payoff?.lines?.slice(0, 2) || null,
        opponents: generateRes.data.draft?.opponents?.slice(0, 2) || null,
        powerLadder: generateRes.data.draft?.power?.ladder?.slice(0, 2) || null,
        traitors: generateRes.data.draft?.traitors?.slice(0, 2) || null,
        traitorStages: generateRes.data.draft?.traitorStages?.slice(0, 2) || null,
        storyPhases: generateRes.data.draft?.storyPhases?.slice(0, 2) || null
      },
      rawResponse: generateRes.data
    };

    // 检查运行时字段
    const fieldsToCheck = [
      'validationReportPreview', 'validationReport', 'initialValidationReport',
      'finalValidationReport', 'repairSummary', 'closureStatus', 'repairApplied', 'evidenceReselected'
    ];
    const foundFields = fieldsToCheck.filter(f => generateRes.data.hasOwnProperty(f));
    if (foundFields.length > 0) {
      testResult.runtimeFieldsLoaded = true;
      console.log(`   发现运行时字段: ${foundFields.join(', ')}`);
    }

    console.log(`   Generate 完成`);
    console.log(`   闭环状态: ${generateRes.data.closureStatus}`);
    console.log(`   修复已应用: ${generateRes.data.repairApplied}`);
    console.log(`   证据已重选: ${generateRes.data.evidenceReselected}`);
  } catch (e) {
    console.log(`   Generate 异常: ${e.message}`);
    testResult.generateResult = { status: 'error', error: e.message };
  }

  // 5. Persist - 持久化世界观
  console.log('\n5. 执行 Persist (持久化世界观)...');
  try {
    const persistRes = await makeRequest({
      hostname: 'localhost',
      port: 4000,
      path: '/pipeline/1/worldview/persist',
      method: 'POST',
      headers
    });

    console.log(`   Persist 状态: ${persistRes.status}`);
    
    testResult.persistResult = {
      status: persistRes.status,
      validationReport: persistRes.data.validationReport || null,
      closureStatus: persistRes.data.closureStatus || null,
      repairApplied: persistRes.data.repairApplied || null,
      evidenceReselected: persistRes.data.evidenceReselected || null,
      summary: persistRes.data.summary || null,
      rawResponse: persistRes.data
    };

    console.log(`   Persist 完成`);
  } catch (e) {
    console.log(`   Persist 异常: ${e.message}`);
    testResult.persistResult = { status: 'error', error: e.message };
  }

  // 6. Overview - 获取概览
  console.log('\n6. 执行 Overview (获取世界观概览)...');
  try {
    const overviewRes = await makeRequest({
      hostname: 'localhost',
      port: 4000,
      path: '/pipeline/1/overview',
      method: 'GET',
      headers
    });

    console.log(`   Overview 状态: ${overviewRes.status}`);
    
    const wv = overviewRes.data.worldview || {};
    testResult.overviewResult = {
      status: overviewRes.status,
      worldviewCounts: {
        payoffLines: wv.payoff?.lines?.length || 0,
        opponents: wv.opponents?.length || 0,
        powerLadder: wv.power?.ladder?.length || 0,
        traitors: wv.traitors?.length || 0,
        traitorStages: wv.traitorStages?.length || 0,
        storyPhases: wv.storyPhases?.length || 0
      },
      keySummary: {
        protagonist: wv.protagonist?.name || null,
        setting: wv.setting?.era || null,
        theme: wv.theme || null
      },
      rawResponse: overviewRes.data
    };

    console.log(`   Overview 完成`);
    console.log(`   世界观模块计数: payoff=${testResult.overviewResult.worldviewCounts.payoffLines}, opponents=${testResult.overviewResult.worldviewCounts.opponents}, power=${testResult.overviewResult.worldviewCounts.powerLadder}, traitors=${testResult.overviewResult.worldviewCounts.traitors}, traitorStages=${testResult.overviewResult.worldviewCounts.traitorStages}, storyPhases=${testResult.overviewResult.worldviewCounts.storyPhases}`);
  } catch (e) {
    console.log(`   Overview 异常: ${e.message}`);
    testResult.overviewResult = { status: 'error', error: e.message };
  }

  // 7. 数据库检查（通过 API 替代）
  console.log('\n7. 数据库检查 (通过 API 数据替代)...');
  testResult.dbChecks.alternativeEvidence = [
    `Preview 返回字段: ${Object.keys(testResult.previewResult?.rawResponse || {}).join(', ')}`,
    `Generate 返回字段: ${Object.keys(testResult.generateResult?.rawResponse || {}).join(', ')}`,
    `Persist 返回字段: ${Object.keys(testResult.persistResult?.rawResponse || {}).join(', ')}`,
    `Overview 返回字段: ${Object.keys(testResult.overviewResult?.rawResponse || {}).join(', ')}`
  ];

  // 8. 判定
  console.log('\n8. 生成测试判定...');
  const allSuccess = 
    testResult.serviceCheck.frontendReachable &&
    testResult.serviceCheck.backendReachable &&
    testResult.serviceCheck.loginSuccess &&
    testResult.previewResult?.status === 200 &&
    testResult.generateResult?.status === 200 &&
    testResult.persistResult?.status === 200 &&
    testResult.overviewResult?.status === 200 &&
    testResult.runtimeFieldsLoaded;

  const partialSuccess = 
    testResult.serviceCheck.loginSuccess &&
    (testResult.previewResult?.status === 200 || testResult.generateResult?.status === 200);

  if (allSuccess) {
    testResult.verdictCandidate = {
      verdict: 'pass',
      reason: '所有接口调用成功，运行时字段已加载，闭环流程完整'
    };
  } else if (partialSuccess) {
    testResult.verdictCandidate = {
      verdict: 'partial',
      reason: '部分接口成功，但存在失败或缺失的步骤'
    };
  } else {
    testResult.verdictCandidate = {
      verdict: 'fail',
      reason: '关键服务不可达或主要接口调用失败'
    };
  }

  console.log(`\n判定: ${testResult.verdictCandidate.verdict} - ${testResult.verdictCandidate.reason}`);

  // 输出最终结果
  console.log('\n=== 测试完成 ===\n');
  console.log(JSON.stringify(testResult, null, 2));
}

runTests().catch(err => {
  console.error('测试执行失败:', err);
  testResult.verdictCandidate = {
    verdict: 'fail',
    reason: `测试脚本异常: ${err.message}`
  };
  console.log(JSON.stringify(testResult, null, 2));
});
