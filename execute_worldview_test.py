#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Worldview 闭环补测脚本 - 完整版
执行 novel_id=1 的 preview->generate->persist->overview 流程
"""

import json
import sys
import traceback
from datetime import datetime

try:
    import requests
except ImportError:
    print("错误: 需要安装 requests 库")
    print("请运行: pip install requests")
    sys.exit(1)

# 配置
BASE_URL = "http://localhost:4000"
FRONTEND_URL = "http://localhost:3000"
NOVEL_ID = 1
USERNAME = "s01"
PASSWORD = "123456"
TIMEOUT_SHORT = 10
TIMEOUT_MEDIUM = 30
TIMEOUT_LONG = 120

# 结果模板
test_result = {
    "testInfo": {
        "timestamp": datetime.now().isoformat(),
        "novelId": NOVEL_ID,
        "environment": {
            "frontend": FRONTEND_URL,
            "backend": BASE_URL
        }
    },
    "serviceCheck": {
        "frontendReachable": False,
        "backendReachable": False,
        "loginSuccess": False
    },
    "runtimeFieldsLoaded": False,
    "previewResult": None,
    "generateResult": None,
    "persistResult": None,
    "overviewResult": None,
    "dbChecks": {
        "unableDirectDb": True,
        "alternativeEvidence": []
    },
    "uiChecks": {
        "unableToAccessUI": True,
        "reason": "API-based testing without browser automation"
    },
    "verdictCandidate": None
}

def log(message):
    """打印并记录日志"""
    print(message)
    with open("test_execution.log", "a", encoding="utf-8") as f:
        f.write(f"{datetime.now().isoformat()} - {message}\n")

def check_runtime_fields(data, source):
    """检查运行时闭环字段"""
    runtime_fields = [
        'validationReportPreview', 'validationReport', 'initialValidationReport',
        'finalValidationReport', 'repairSummary', 'closureStatus', 'repairApplied', 'evidenceReselected'
    ]
    found = [f for f in runtime_fields if f in data]
    if found:
        log(f"  ✓ {source} 发现运行时字段: {', '.join(found)}")
        return True
    return False

def extract_key_fields(data, field_map):
    """提取关键字段"""
    result = {}
    for key, path in field_map.items():
        try:
            value = data
            for part in path.split('.'):
                if '[' in part:
                    field, idx = part.split('[')
                    idx = int(idx.rstrip(']'))
                    value = value.get(field, [])[idx] if value else None
                else:
                    value = value.get(part) if value else None
            result[key] = value
        except (KeyError, IndexError, TypeError, AttributeError):
            result[key] = None
    return result

def main():
    """主测试流程"""
    log("=" * 80)
    log("开始 Worldview 闭环补测")
    log("=" * 80)
    
    # 清空日志文件
    with open("test_execution.log", "w", encoding="utf-8") as f:
        f.write(f"测试开始时间: {datetime.now().isoformat()}\n")
    
    try:
        # 1. 检查服务
        log("\n[1/7] 检查服务状态...")
        
        try:
            r = requests.get(f"{FRONTEND_URL}", timeout=TIMEOUT_SHORT)
            test_result["serviceCheck"]["frontendReachable"] = r.status_code == 200
            log(f"  前端服务: {'✓' if r.status_code == 200 else '✗'} (HTTP {r.status_code})")
        except Exception as e:
            log(f"  前端服务: ✗ ({str(e)})")
        
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=TIMEOUT_SHORT)
            test_result["serviceCheck"]["backendReachable"] = r.status_code == 200
            log(f"  后端服务: {'✓' if r.status_code == 200 else '✗'} (HTTP {r.status_code})")
        except Exception as e:
            log(f"  后端服务: ✗ ({str(e)})")
        
        if not test_result["serviceCheck"]["backendReachable"]:
            raise Exception("后端服务不可达，无法继续测试")
        
        # 2. 登录
        log("\n[2/7] 执行登录...")
        
        r = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": USERNAME, "password": PASSWORD},
            timeout=TIMEOUT_SHORT
        )
        
        if r.status_code not in [200, 201]:
            raise Exception(f"登录失败: HTTP {r.status_code}")
        
        data = r.json()
        token = data.get('access_token') or data.get('token')
        
        if not token:
            raise Exception("登录响应中未找到 token")
        
        test_result["serviceCheck"]["loginSuccess"] = True
        log(f"  登录成功: ✓")
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        # 3. Preview
        log("\n[3/7] 执行 Preview (预览世界观)...")
        
        r = requests.post(
            f"{BASE_URL}/pipeline/{NOVEL_ID}/worldview/preview",
            headers=headers,
            json={},
            timeout=TIMEOUT_MEDIUM
        )
        
        log(f"  HTTP 状态: {r.status_code}")
        
        if r.status_code == 200:
            data = r.json()
            
            # 检查运行时字段
            if check_runtime_fields(data, "Preview"):
                test_result["runtimeFieldsLoaded"] = True
            
            # 提取关键字段
            test_result["previewResult"] = {
                "status": r.status_code,
                "validationReportPreview": data.get("validationReportPreview"),
                "evidenceSummary": data.get("evidenceSummary"),
                "promptEvidenceOffTopicHits": {
                    "张士诚": None,  # 需要从 qualityWarnings 中提取
                    "陈友谅": None,
                    "蓝玉": None,
                    "胡惟庸": None
                },
                "keyFields": extract_key_fields(data, {
                    "score": "validationReportPreview.score",
                    "fatalCount": "validationReportPreview.fatalCount",
                    "majorCount": "validationReportPreview.majorCount",
                    "minorCount": "validationReportPreview.minorCount",
                    "evidenceSegments": "evidenceSummary.evidenceSegments",
                    "coverageChapters": "evidenceSummary.coverageChapters"
                })
            }
            
            # 检查 off-topic 警告
            quality_warnings = data.get("qualityWarnings", [])
            off_topic_chars = ["张士诚", "陈友谅", "蓝玉", "胡惟庸"]
            for warning in quality_warnings:
                if warning.get("type") == "prompt_evidence_off_topic":
                    for char in off_topic_chars:
                        if char in warning.get("message", ""):
                            test_result["previewResult"]["promptEvidenceOffTopicHits"][char] = warning
            
            log(f"  ✓ Preview 成功")
            log(f"    - 校验分数: {test_result['previewResult']['keyFields']['score']}")
            log(f"    - 问题统计: fatal={test_result['previewResult']['keyFields']['fatalCount']}, "
                f"major={test_result['previewResult']['keyFields']['majorCount']}, "
                f"minor={test_result['previewResult']['keyFields']['minorCount']}")
        else:
            test_result["previewResult"] = {
                "status": r.status_code,
                "error": r.text
            }
            log(f"  ✗ Preview 失败: HTTP {r.status_code}")
        
        # 4. Generate
        log("\n[4/7] 执行 Generate (生成世界观草稿)...")
        log("  注意: 此步骤可能需要 1-2 分钟...")
        
        r = requests.post(
            f"{BASE_URL}/pipeline/{NOVEL_ID}/worldview/generate",
            headers=headers,
            json={},
            timeout=TIMEOUT_LONG
        )
        
        log(f"  HTTP 状态: {r.status_code}")
        
        if r.status_code == 200:
            data = r.json()
            
            # 检查运行时字段
            if check_runtime_fields(data, "Generate"):
                test_result["runtimeFieldsLoaded"] = True
            
            # 提取闭环字段
            initial = data.get("initialValidationReport", {})
            final = data.get("finalValidationReport", {})
            
            test_result["generateResult"] = {
                "status": r.status_code,
                "closureStatus": data.get("closureStatus"),
                "repairApplied": data.get("repairApplied"),
                "evidenceReselected": data.get("evidenceReselected"),
                "repairSummary": data.get("repairSummary"),
                "initialValidationReport": initial,
                "finalValidationReport": final,
                "delta": {
                    "score": {
                        "before": initial.get("score"),
                        "after": final.get("score"),
                        "improvement": (final.get("score", 0) - initial.get("score", 0)) if initial.get("score") and final.get("score") else None
                    },
                    "fatal": {
                        "before": initial.get("fatalCount"),
                        "after": final.get("fatalCount"),
                        "reduction": (initial.get("fatalCount", 0) - final.get("fatalCount", 0)) if initial.get("fatalCount") is not None and final.get("fatalCount") is not None else None
                    },
                    "major": {
                        "before": initial.get("majorCount"),
                        "after": final.get("majorCount"),
                        "reduction": (initial.get("majorCount", 0) - final.get("majorCount", 0)) if initial.get("majorCount") is not None and final.get("majorCount") is not None else None
                    },
                    "minor": {
                        "before": initial.get("minorCount"),
                        "after": final.get("minorCount"),
                        "reduction": (initial.get("minorCount", 0) - final.get("minorCount", 0)) if initial.get("minorCount") is not None and final.get("minorCount") is not None else None
                    }
                },
                "moduleSamples": {
                    "payoffLines": data.get("draft", {}).get("payoff", {}).get("lines", [])[:2] if data.get("draft") else None,
                    "opponents": data.get("draft", {}).get("opponents", [])[:2] if data.get("draft") else None,
                    "powerLadder": data.get("draft", {}).get("power", {}).get("ladder", [])[:2] if data.get("draft") else None,
                    "traitors": data.get("draft", {}).get("traitors", [])[:2] if data.get("draft") else None,
                    "traitorStages": data.get("draft", {}).get("traitorStages", [])[:2] if data.get("draft") else None,
                    "storyPhases": data.get("draft", {}).get("storyPhases", [])[:2] if data.get("draft") else None
                }
            }
            
            log(f"  ✓ Generate 成功")
            log(f"    - 闭环状态: {data.get('closureStatus')}")
            log(f"    - 修复已应用: {data.get('repairApplied')}")
            log(f"    - 证据已重选: {data.get('evidenceReselected')}")
            log(f"    - 分数变化: {initial.get('score')} → {final.get('score')} "
                f"(改善: {test_result['generateResult']['delta']['score']['improvement']})")
            log(f"    - Fatal 变化: {initial.get('fatalCount')} → {final.get('fatalCount')} "
                f"(减少: {test_result['generateResult']['delta']['fatal']['reduction']})")
            log(f"    - Major 变化: {initial.get('majorCount')} → {final.get('majorCount')} "
                f"(减少: {test_result['generateResult']['delta']['major']['reduction']})")
            log(f"    - Minor 变化: {initial.get('minorCount')} → {final.get('minorCount')} "
                f"(减少: {test_result['generateResult']['delta']['minor']['reduction']})")
            
            # 记录模块样本
            if data.get("draft"):
                draft = data["draft"]
                log(f"    - 模块计数: payoff={len(draft.get('payoff', {}).get('lines', []))}, "
                    f"opponents={len(draft.get('opponents', []))}, "
                    f"power={len(draft.get('power', {}).get('ladder', []))}, "
                    f"traitors={len(draft.get('traitors', []))}, "
                    f"traitorStages={len(draft.get('traitorStages', []))}, "
                    f"storyPhases={len(draft.get('storyPhases', []))}")
        else:
            test_result["generateResult"] = {
                "status": r.status_code,
                "error": r.text
            }
            log(f"  ✗ Generate 失败: HTTP {r.status_code}")
        
        # 5. Persist
        log("\n[5/7] 执行 Persist (持久化世界观)...")
        
        if test_result["generateResult"] and test_result["generateResult"].get("status") == 200:
            draft_to_persist = data.get("draft")
            
            r = requests.post(
                f"{BASE_URL}/pipeline/{NOVEL_ID}/worldview/persist",
                headers=headers,
                json={"draft": draft_to_persist},
                timeout=TIMEOUT_MEDIUM
            )
            
            log(f"  HTTP 状态: {r.status_code}")
            
            if r.status_code == 200:
                data = r.json()
                
                test_result["persistResult"] = {
                    "status": r.status_code,
                    "validationReport": data.get("validationReport"),
                    "closureStatus": data.get("closureStatus"),
                    "repairApplied": data.get("repairApplied"),
                    "evidenceReselected": data.get("evidenceReselected"),
                    "summary": data.get("summary"),
                    "keyFields": extract_key_fields(data, {
                        "score": "validationReport.score",
                        "fatalCount": "validationReport.fatalCount",
                        "majorCount": "validationReport.majorCount",
                        "minorCount": "validationReport.minorCount"
                    })
                }
                
                log(f"  ✓ Persist 成功")
                log(f"    - 闭环状态: {data.get('closureStatus')}")
                log(f"    - 校验分数: {test_result['persistResult']['keyFields']['score']}")
                log(f"    - 持久化摘要: {data.get('summary')}")
            else:
                test_result["persistResult"] = {
                    "status": r.status_code,
                    "error": r.text
                }
                log(f"  ✗ Persist 失败: HTTP {r.status_code}")
        else:
            test_result["persistResult"] = {
                "status": "skipped",
                "reason": "Generate 失败，跳过 Persist"
            }
            log(f"  ⊘ Persist 跳过 (Generate 失败)")
        
        # 6. Overview
        log("\n[6/7] 执行 Overview (获取世界观概览)...")
        
        r = requests.get(
            f"{BASE_URL}/pipeline/{NOVEL_ID}/overview",
            headers=headers,
            timeout=TIMEOUT_MEDIUM
        )
        
        log(f"  HTTP 状态: {r.status_code}")
        
        if r.status_code == 200:
            data = r.json()
            wv = data.get("worldview", {})
            
            test_result["overviewResult"] = {
                "status": r.status_code,
                "worldviewCounts": {
                    "payoffLines": len(wv.get("payoff", {}).get("lines", [])),
                    "opponents": len(wv.get("opponents", [])),
                    "powerLadder": len(wv.get("power", {}).get("ladder", [])),
                    "traitors": len(wv.get("traitors", [])),
                    "traitorStages": len(wv.get("traitorStages", [])),
                    "storyPhases": len(wv.get("storyPhases", []))
                },
                "keySummary": {
                    "protagonist": wv.get("protagonist", {}).get("name"),
                    "setting": wv.get("setting", {}).get("era"),
                    "theme": wv.get("theme")
                }
            }
            
            counts = test_result["overviewResult"]["worldviewCounts"]
            log(f"  ✓ Overview 成功")
            log(f"    - 世界观模块计数:")
            log(f"      payoff={counts['payoffLines']}, opponents={counts['opponents']}, "
                f"power={counts['powerLadder']}")
            log(f"      traitors={counts['traitors']}, traitorStages={counts['traitorStages']}, "
                f"storyPhases={counts['storyPhases']}")
            log(f"    - 主角: {test_result['overviewResult']['keySummary']['protagonist']}")
            log(f"    - 时代: {test_result['overviewResult']['keySummary']['setting']}")
        else:
            test_result["overviewResult"] = {
                "status": r.status_code,
                "error": r.text
            }
            log(f"  ✗ Overview 失败: HTTP {r.status_code}")
        
        # 7. 数据库检查（替代）
        log("\n[7/7] 数据库检查 (通过 API 数据替代)...")
        
        test_result["dbChecks"]["alternativeEvidence"] = [
            f"Preview 状态: {test_result['previewResult'].get('status') if test_result['previewResult'] else 'N/A'}",
            f"Generate 状态: {test_result['generateResult'].get('status') if test_result['generateResult'] else 'N/A'}",
            f"Persist 状态: {test_result['persistResult'].get('status') if test_result['persistResult'] else 'N/A'}",
            f"Overview 状态: {test_result['overviewResult'].get('status') if test_result['overviewResult'] else 'N/A'}",
            f"运行时字段已加载: {test_result['runtimeFieldsLoaded']}",
            f"闭环状态 (Generate): {test_result['generateResult'].get('closureStatus') if test_result['generateResult'] else 'N/A'}",
            f"闭环状态 (Persist): {test_result['persistResult'].get('closureStatus') if test_result['persistResult'] else 'N/A'}"
        ]
        
        log(f"  ✓ 已收集替代证据 ({len(test_result['dbChecks']['alternativeEvidence'])} 项)")
        
        # 8. 生成判定
        log("\n[判定] 生成测试判定...")
        
        all_success = all([
            test_result["serviceCheck"]["backendReachable"],
            test_result["serviceCheck"]["loginSuccess"],
            test_result["previewResult"] and test_result["previewResult"].get("status") == 200,
            test_result["generateResult"] and test_result["generateResult"].get("status") == 200,
            test_result["persistResult"] and test_result["persistResult"].get("status") == 200,
            test_result["overviewResult"] and test_result["overviewResult"].get("status") == 200,
            test_result["runtimeFieldsLoaded"]
        ])
        
        partial_success = (
            test_result["serviceCheck"]["loginSuccess"] and
            (
                (test_result["previewResult"] and test_result["previewResult"].get("status") == 200) or
                (test_result["generateResult"] and test_result["generateResult"].get("status") == 200)
            )
        )
        
        if all_success:
            test_result["verdictCandidate"] = {
                "verdict": "pass",
                "reason": "所有接口调用成功，运行时字段已加载，闭环流程完整"
            }
        elif partial_success:
            failures = []
            if not test_result["previewResult"] or test_result["previewResult"].get("status") != 200:
                failures.append("Preview")
            if not test_result["generateResult"] or test_result["generateResult"].get("status") != 200:
                failures.append("Generate")
            if not test_result["persistResult"] or test_result["persistResult"].get("status") != 200:
                failures.append("Persist")
            if not test_result["overviewResult"] or test_result["overviewResult"].get("status") != 200:
                failures.append("Overview")
            if not test_result["runtimeFieldsLoaded"]:
                failures.append("运行时字段缺失")
            
            test_result["verdictCandidate"] = {
                "verdict": "partial",
                "reason": f"部分接口成功，但存在失败: {', '.join(failures)}"
            }
        else:
            test_result["verdictCandidate"] = {
                "verdict": "fail",
                "reason": "关键服务不可达或主要接口调用失败"
            }
        
        log(f"\n判定结果: {test_result['verdictCandidate']['verdict'].upper()}")
        log(f"判定理由: {test_result['verdictCandidate']['reason']}")
        
    except Exception as e:
        log(f"\n✗ 测试执行异常: {str(e)}")
        log(f"  堆栈跟踪:\n{traceback.format_exc()}")
        test_result["verdictCandidate"] = {
            "verdict": "fail",
            "reason": f"测试脚本异常: {str(e)}"
        }
    
    # 保存结果
    log("\n" + "=" * 80)
    log("测试完成，保存结果...")
    
    with open("worldview_test_result.json", "w", encoding="utf-8") as f:
        json.dump(test_result, f, ensure_ascii=False, indent=2)
    
    log(f"✓ 结果已保存到: worldview_test_result.json")
    log(f"✓ 日志已保存到: test_execution.log")
    log("=" * 80)
    
    # 打印简要摘要
    print("\n" + "=" * 80)
    print("测试摘要")
    print("=" * 80)
    print(f"判定: {test_result['verdictCandidate']['verdict'].upper()}")
    print(f"理由: {test_result['verdictCandidate']['reason']}")
    print(f"\n服务检查:")
    print(f"  前端: {'✓' if test_result['serviceCheck']['frontendReachable'] else '✗'}")
    print(f"  后端: {'✓' if test_result['serviceCheck']['backendReachable'] else '✗'}")
    print(f"  登录: {'✓' if test_result['serviceCheck']['loginSuccess'] else '✗'}")
    print(f"\n接口状态:")
    print(f"  Preview:  {test_result['previewResult'].get('status') if test_result['previewResult'] else 'N/A'}")
    print(f"  Generate: {test_result['generateResult'].get('status') if test_result['generateResult'] else 'N/A'}")
    print(f"  Persist:  {test_result['persistResult'].get('status') if test_result['persistResult'] else 'N/A'}")
    print(f"  Overview: {test_result['overviewResult'].get('status') if test_result['overviewResult'] else 'N/A'}")
    print(f"\n运行时字段: {'✓ 已加载' if test_result['runtimeFieldsLoaded'] else '✗ 未加载'}")
    print("=" * 80)
    
    return 0 if test_result['verdictCandidate']['verdict'] == 'pass' else 1

if __name__ == "__main__":
    sys.exit(main())
