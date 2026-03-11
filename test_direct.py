#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import sys
import os

# 立即写入开始标记
with open("test_log.txt", "w", encoding="utf-8") as f:
    f.write("Test started\n")

result = {
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

try:
    import requests
    
    with open("test_log.txt", "a", encoding="utf-8") as f:
        f.write("requests module loaded\n")
    
    BASE_URL = "http://localhost:4000"
    NOVEL_ID = 1
    
    # 1. Check backend health
    with open("test_log.txt", "a", encoding="utf-8") as f:
        f.write("Checking backend health...\n")
    
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        result["serviceCheck"]["backendReachable"] = r.status_code == 200
        with open("test_log.txt", "a", encoding="utf-8") as f:
            f.write(f"Backend health: {r.status_code}\n")
    except Exception as e:
        with open("test_log.txt", "a", encoding="utf-8") as f:
            f.write(f"Backend health error: {str(e)}\n")
    
    # 2. Check frontend
    with open("test_log.txt", "a", encoding="utf-8") as f:
        f.write("Checking frontend...\n")
    
    try:
        r = requests.get("http://localhost:3000", timeout=5)
        result["serviceCheck"]["frontendReachable"] = r.status_code == 200
        with open("test_log.txt", "a", encoding="utf-8") as f:
            f.write(f"Frontend: {r.status_code}\n")
    except Exception as e:
        with open("test_log.txt", "a", encoding="utf-8") as f:
            f.write(f"Frontend error: {str(e)}\n")
    
    # 3. Login
    with open("test_log.txt", "a", encoding="utf-8") as f:
        f.write("Attempting login...\n")
    
    try:
        r = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": "s01", "password": "123456"},
            timeout=10
        )
        with open("test_log.txt", "a", encoding="utf-8") as f:
            f.write(f"Login response: {r.status_code}\n")
        
        if r.status_code in [200, 201]:
            data = r.json()
            token = data.get("access_token") or data.get("token")
            result["serviceCheck"]["loginSuccess"] = token is not None
            
            if token:
                headers = {"Authorization": f"Bearer {token}"}
                
                # 4. Preview
                with open("test_log.txt", "a", encoding="utf-8") as f:
                    f.write("Calling preview...\n")
                
                try:
                    r = requests.post(
                        f"{BASE_URL}/pipeline/{NOVEL_ID}/worldview/preview",
                        headers=headers,
                        timeout=30
                    )
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Preview response: {r.status_code}\n")
                    
                    if r.status_code == 200:
                        data = r.json()
                        result["previewResult"] = {
                            "status": r.status_code,
                            "validationReportPreview": data.get("validationReportPreview"),
                            "evidenceSummary": data.get("evidenceSummary"),
                            "promptEvidenceOffTopicHits": {
                                "张士诚": data.get("promptEvidenceOffTopicHits", {}).get("张士诚"),
                                "陈友谅": data.get("promptEvidenceOffTopicHits", {}).get("陈友谅"),
                                "蓝玉": data.get("promptEvidenceOffTopicHits", {}).get("蓝玉"),
                                "胡惟庸": data.get("promptEvidenceOffTopicHits", {}).get("胡惟庸")
                            }
                        }
                        
                        # Check runtime fields
                        runtime_fields = ["validationReportPreview", "validationReport", "initialValidationReport",
                                        "finalValidationReport", "repairSummary", "closureStatus", "repairApplied", "evidenceReselected"]
                        found_fields = [f for f in runtime_fields if f in data]
                        if found_fields:
                            result["runtimeFieldsLoaded"] = True
                            with open("test_log.txt", "a", encoding="utf-8") as f:
                                f.write(f"Runtime fields found in preview: {', '.join(found_fields)}\n")
                    else:
                        result["previewResult"] = {"status": r.status_code, "error": "Non-200 response"}
                except Exception as e:
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Preview error: {str(e)}\n")
                    result["previewResult"] = {"status": "error", "error": str(e)}
                
                # 5. Generate
                with open("test_log.txt", "a", encoding="utf-8") as f:
                    f.write("Calling generate...\n")
                
                try:
                    r = requests.post(
                        f"{BASE_URL}/pipeline/{NOVEL_ID}/worldview/generate",
                        headers=headers,
                        timeout=120
                    )
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Generate response: {r.status_code}\n")
                    
                    if r.status_code == 200:
                        data = r.json()
                        initial = data.get("initialValidationReport", {})
                        final = data.get("finalValidationReport", {})
                        
                        result["generateResult"] = {
                            "status": r.status_code,
                            "closureStatus": data.get("closureStatus"),
                            "repairApplied": data.get("repairApplied"),
                            "evidenceReselected": data.get("evidenceReselected"),
                            "repairSummary": data.get("repairSummary"),
                            "initialValidationReport": initial,
                            "finalValidationReport": final,
                            "delta": {
                                "score": {
                                    "before": initial.get("overallScore"),
                                    "after": final.get("overallScore")
                                },
                                "fatal": {
                                    "before": initial.get("summary", {}).get("fatal"),
                                    "after": final.get("summary", {}).get("fatal")
                                },
                                "major": {
                                    "before": initial.get("summary", {}).get("major"),
                                    "after": final.get("summary", {}).get("major")
                                },
                                "minor": {
                                    "before": initial.get("summary", {}).get("minor"),
                                    "after": final.get("summary", {}).get("minor")
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
                        
                        # Check runtime fields
                        runtime_fields = ["closureStatus", "repairApplied", "initialValidationReport", "finalValidationReport", "repairSummary", "evidenceReselected"]
                        found_fields = [f for f in runtime_fields if f in data]
                        if found_fields:
                            result["runtimeFieldsLoaded"] = True
                            with open("test_log.txt", "a", encoding="utf-8") as f:
                                f.write(f"Runtime fields found in generate: {', '.join(found_fields)}\n")
                                f.write(f"Closure status: {data.get('closureStatus')}\n")
                                f.write(f"Repair applied: {data.get('repairApplied')}\n")
                                f.write(f"Evidence reselected: {data.get('evidenceReselected')}\n")
                    else:
                        result["generateResult"] = {"status": r.status_code, "error": "Non-200 response"}
                except Exception as e:
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Generate error: {str(e)}\n")
                    result["generateResult"] = {"status": "error", "error": str(e)}
                
                # 6. Persist
                with open("test_log.txt", "a", encoding="utf-8") as f:
                    f.write("Calling persist...\n")
                
                try:
                    r = requests.post(
                        f"{BASE_URL}/pipeline/{NOVEL_ID}/worldview/persist",
                        headers=headers,
                        timeout=30
                    )
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Persist response: {r.status_code}\n")
                    
                    if r.status_code == 200:
                        data = r.json()
                        result["persistResult"] = {
                            "status": r.status_code,
                            "validationReport": data.get("validationReport"),
                            "closureStatus": data.get("closureStatus"),
                            "repairApplied": data.get("repairApplied"),
                            "evidenceReselected": data.get("evidenceReselected"),
                            "summary": data.get("summary")
                        }
                    else:
                        result["persistResult"] = {"status": r.status_code, "error": "Non-200 response"}
                except Exception as e:
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Persist error: {str(e)}\n")
                    result["persistResult"] = {"status": "error", "error": str(e)}
                
                # 7. Overview
                with open("test_log.txt", "a", encoding="utf-8") as f:
                    f.write("Calling overview...\n")
                
                try:
                    r = requests.get(
                        f"{BASE_URL}/pipeline/{NOVEL_ID}/overview",
                        headers=headers,
                        timeout=30
                    )
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Overview response: {r.status_code}\n")
                    
                    if r.status_code == 200:
                        data = r.json()
                        wv = data.get("worldview", {})
                        result["overviewResult"] = {
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
                        with open("test_log.txt", "a", encoding="utf-8") as f:
                            counts = result["overviewResult"]["worldviewCounts"]
                            f.write(f"Worldview counts: payoff={counts['payoffLines']}, opponents={counts['opponents']}, "
                                  f"power={counts['powerLadder']}, traitors={counts['traitors']}, "
                                  f"traitorStages={counts['traitorStages']}, storyPhases={counts['storyPhases']}\n")
                    else:
                        result["overviewResult"] = {"status": r.status_code, "error": "Non-200 response"}
                except Exception as e:
                    with open("test_log.txt", "a", encoding="utf-8") as f:
                        f.write(f"Overview error: {str(e)}\n")
                    result["overviewResult"] = {"status": "error", "error": str(e)}
                
                # DB checks
                result["dbChecks"]["alternativeEvidence"] = [
                    f"Preview status: {result['previewResult'].get('status') if result['previewResult'] else 'N/A'}",
                    f"Generate status: {result['generateResult'].get('status') if result['generateResult'] else 'N/A'}",
                    f"Persist status: {result['persistResult'].get('status') if result['persistResult'] else 'N/A'}",
                    f"Overview status: {result['overviewResult'].get('status') if result['overviewResult'] else 'N/A'}",
                    f"Runtime fields loaded: {result['runtimeFieldsLoaded']}"
                ]
    except ImportError:
        with open("test_log.txt", "a", encoding="utf-8") as f:
            f.write("requests module not available\n")
        result["verdictCandidate"] = {"verdict": "fail", "reason": "requests module not installed"}
    except Exception as e:
        with open("test_log.txt", "a", encoding="utf-8") as f:
            f.write(f"Unexpected error: {str(e)}\n")
        result["verdictCandidate"] = {"verdict": "fail", "reason": f"Exception: {str(e)}"}
    
    # Verdict
    if not result["verdictCandidate"]:
        all_ok = all([
            result["serviceCheck"]["backendReachable"],
            result["serviceCheck"]["loginSuccess"],
            result["previewResult"] and result["previewResult"].get("status") == 200,
            result["generateResult"] and result["generateResult"].get("status") == 200,
            result["persistResult"] and result["persistResult"].get("status") == 200,
            result["overviewResult"] and result["overviewResult"].get("status") == 200,
            result["runtimeFieldsLoaded"]
        ])
        
        partial_ok = (
            result["serviceCheck"]["loginSuccess"] and
            (result["previewResult"] and result["previewResult"].get("status") == 200 or
             result["generateResult"] and result["generateResult"].get("status") == 200)
        )
        
        if all_ok:
            result["verdictCandidate"] = {
                "verdict": "pass",
                "reason": "所有接口调用成功，运行时字段已加载，闭环流程完整"
            }
        elif partial_ok:
            result["verdictCandidate"] = {
                "verdict": "partial",
                "reason": "部分接口成功，但存在失败或缺失的步骤"
            }
        else:
            result["verdictCandidate"] = {
                "verdict": "fail",
                "reason": "关键服务不可达或主要接口调用失败"
            }
    
    with open("test_log.txt", "a", encoding="utf-8") as f:
        f.write(f"Verdict: {result['verdictCandidate']['verdict']} - {result['verdictCandidate']['reason']}\n")

except Exception as e:
    with open("test_log.txt", "a", encoding="utf-8") as f:
        f.write(f"Fatal error: {str(e)}\n")
    result["verdictCandidate"] = {"verdict": "fail", "reason": f"Fatal error: {str(e)}"}

# Write final result
with open("test_result.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

with open("test_log.txt", "a", encoding="utf-8") as f:
    f.write("Test completed, result written to test_result.json\n")

print("Test completed")
