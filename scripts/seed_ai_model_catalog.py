import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

MODELS_RAW = """
chat_fast_imagine,chat_relax_imagine,chatgpt-4o-latest,claude-3-5-haiku-20241022,claude-3-5-sonnet-20240620,claude-3-5-sonnet-20241022,claude-3-5-sonnet-all,claude-3-7-sonnet-20250219,claude-3-7-sonnet-20250219-thinking,claude-3-7-sonnet-thinking,claude-3-haiku-20240307,claude-3-opus-20240229,claude-3-sonnet-20240229,claude-3.7-sonnet-thinking,claude-4-opus-thinking,claude-4-sonnet,claude-4-sonnet-thinking,claude-haiku-4-5-20251001,claude-haiku-4-5-20251001-thinking,claude-opus-4,claude-opus-4-1-20250805,claude-opus-4-1-20250805-thinking,claude-opus-4-20250514,claude-opus-4-20250514-thinking,claude-opus-4-5-20251101,claude-opus-4-5-20251101-thinking,claude-opus-4-6,claude-opus-4-6-20260203-c,claude-opus-4-6-c,claude-opus-4-6-thinking,claude-opus-4-6-thinking-c,claude-opus-4-all-c,claude-opus-4-thinking,claude-opus-4-thinking-all-c,claude-sonnet-4-20250514,claude-sonnet-4-20250514-thinking,claude-sonnet-4-5-20250929,claude-sonnet-4-5-20250929-thinking,claude-sonnet-4-5-all,claude-sonnet-4-5-thinking-all,claude-sonnet-4-6,claude-sonnet-4-6-c,claude-sonnet-4-6-thinking,claude-sonnet-4-6-thinking-c,claude-sonnet-4-thinking,codex-mini,cosyvoice-v3-flash,cosyvoice-v3-plus,cs-claude-3-5-haiku-20241022,cs-claude-3-7-sonnet-20250219,cs-claude-3-7-sonnet-20250219-thinking,cs-claude-3-7-sonnet-all,cs-claude-3-7-sonnet-thinking,cs-claude-3-7-sonnet-thinking-all,cs-claude-4-sonnet,cs-claude-opus-4,cs-claude-opus-4-1-20250805,cs-claude-opus-4-1-20250805-thinking,cs-claude-opus-4-1-all,cs-claude-opus-4-1-thinking-all,cs-claude-opus-4-20250514,cs-claude-opus-4-20250514-thinking,cs-claude-opus-4-5-20251101,cs-claude-opus-4-5-20251101-thinking,cs-claude-opus-4-all,cs-claude-opus-4-thinking,cs-claude-opus-4-thinking-all,cs-claude-sonnet-4-20250514,cs-claude-sonnet-4-20250514-thinking,cs-claude-sonnet-4-5-20250929,cs-claude-sonnet-4-5-20250929-thinking,cs-claude-sonnet-4-5-all,cs-claude-sonnet-4-5-thinking-all,cs-claude-sonnet-4-all,cs-claude-sonnet-4-thinking-all,cs-gemini-2.5-flash-all,cs-gemini-2.5-flash-deepsearch,cs-gemini-2.5-pro-all,cs-gemini-3-pro-all,cs-gemini-3-pro-preview,cs-gpt-4.1,cs-gpt-4.1-mini,cs-gpt-4.1-nano,cs-gpt-4o,cs-gpt-5-all,cs-gpt-5-thinking-all,cs-grok-3,cs-grok-4,cs-grok-4-1,cs-grok-4-1-fast,cs-grok-4-1-thinking-1129,cs-o3,cs-o3-all,cs-o3-pro,cs-o3-pro-all,cs-qwq-32b,deepseek-ai/DeepSeek-V3.2-Exp,deepseek-ocr,deepseek-r1,deepseek-r1-0528,deepseek-r1-distill-qwen-32b,deepseek-reasoner,deepseek-v3,deepseek-v3-0324,deepseek-v3.1,deepseek-v3.1-search,deepseek-v3.1-search-thinking,deepseek-v3.1-terminus,deepseek-v3.1-thinking,deepseek-v3.2,deepseek-v3.2-exp,deepseek-v3.2-search,deepseek-v3.2-search-thinking,deepseek-v3.2-speciale,deepseek-v3.2-thinking,doubao-seedream-4-5-251128,doubao-seedream-5-0,fun-asr-realtime,gemini-2.0-flash,gemini-2.0-flash-001,gemini-2.0-flash-exp,gemini-2.0-flash-lite,gemini-2.0-flash-lite-preview-02-05,gemini-2.5-flash,gemini-2.5-flash-deepsearch,gemini-2.5-flash-image,gemini-2.5-flash-image-preview,gemini-2.5-flash-lite,gemini-2.5-flash-lite-preview-06-17,gemini-2.5-flash-lite-preview-06-17-nothinking,gemini-2.5-flash-lite-preview-06-17-thinking,gemini-2.5-flash-lite-preview-09-2025,gemini-2.5-flash-lite-thinking,gemini-2.5-flash-nothinking,gemini-2.5-flash-preview-05-20,gemini-2.5-flash-preview-09-2025,gemini-2.5-flash-search,gemini-2.5-flash-thinking,gemini-2.5-pro,gemini-2.5-pro-all,gemini-2.5-pro-nothinking,gemini-2.5-pro-preview-05-06,gemini-2.5-pro-preview-06-05,gemini-2.5-pro-thinking,gemini-2.5-pro-thinking-128,gemini-3-flash-preview,gemini-3-flash-preview-thinking-128,gemini-3-pro,gemini-3-pro-high-c,gemini-3-pro-image,gemini-3-pro-image-preview,gemini-3-pro-image-preview-2k,gemini-3-pro-image-preview-4k,gemini-3-pro-low-c,gemini-3-pro-preview,gemini-3-pro-preview-c,gemini-3-pro-preview-thinking,gemini-3-pro-preview-thinking-128,gemini-3-pro-preview-thinking-c,gemini-3.1-flash-image-preview,gemini-3.1-flash-image-preview-2k,gemini-3.1-flash-image-preview-4k,gemini-3.1-flash-preview,gemini-3.1-pro,gemini-3.1-pro-high,gemini-3.1-pro-low,gemini-3.1-pro-preview,gemini-3.1-pro-preview-customtools,gemini-3.1-pro-preview-high,gemini-3.1-pro-preview-low,gemini-3.1-pro-preview-thinking-high,gemini-3.1-pro-preview-thinking-low,glm-4-airx,glm-4-flash,glm-4-long,glm-4.5,glm-4.5-air,glm-4.5-thinking,glm-4.6,glm-4.6-thinking,glm-4.7,glm-4.7-thinking,glm-5,glm-5-search,gpt-3.5-turbo,gpt-3.5-turbo-0125,gpt-3.5-turbo-0301,gpt-3.5-turbo-0613,gpt-3.5-turbo-1106,gpt-3.5-turbo-16k,gpt-3.5-turbo-16k-0613,gpt-3.5-turbo-instruct,gpt-4,gpt-4-0125-preview,gpt-4-0613,gpt-4-1106-preview,gpt-4-32k,gpt-4-32k-0613,gpt-4-all,gpt-4-gizmo-*,gpt-4-turbo,gpt-4-turbo-2024-04-09,gpt-4-turbo-preview,gpt-4-vision-preview,gpt-4.1,gpt-4.1-2025-04-14,gpt-4.1-mini,gpt-4.1-mini-2025-04-14,gpt-4.1-nano,gpt-4.1-nano-2025-04-14,gpt-4.5-preview,gpt-4.5-preview-2025-02-27,gpt-4o,gpt-4o-2024-05-13,gpt-4o-2024-08-06,gpt-4o-2024-11-20,gpt-4o-all,gpt-4o-image,gpt-4o-image-vip,gpt-4o-mini,gpt-4o-mini-2024-07-18,gpt-4o-mini-transcribe,gpt-4o-mini-tts,gpt-4o-realtime-preview-2024-10-01,gpt-4o-realtime-preview-2024-12-17,gpt-4o-realtime-preview-2025-06-03,gpt-4o-search,gpt-4o-transcribe,gpt-5,gpt-5-2025-08-07,gpt-5-chat,gpt-5-chat-2025-08-07,gpt-5-chat-latest,gpt-5-codex,gpt-5-codex-high,gpt-5-codex-low,gpt-5-codex-medium,gpt-5-codex-mini,gpt-5-codex-mini-high,gpt-5-codex-mini-medium,gpt-5-codex-minimal,gpt-5-high,gpt-5-low,gpt-5-medium,gpt-5-mini,gpt-5-mini-2025-08-07,gpt-5-minimal,gpt-5-nano,gpt-5-nano-2025-08-07,gpt-5-pro,gpt-5-pro-2025-10-06,gpt-5-thinking,gpt-5-thinking-all,gpt-5.1,gpt-5.1-2025-11-13,gpt-5.1-chat,gpt-5.1-chat-2025-11-13,gpt-5.1-chat-latest,gpt-5.1-codex,gpt-5.1-codex-high,gpt-5.1-codex-low,gpt-5.1-codex-max,gpt-5.1-codex-medium,gpt-5.1-codex-mini,gpt-5.1-codex-mini-2025-11-13,gpt-5.1-codex-mini-high,gpt-5.1-codex-mini-medium,gpt-5.1-high,gpt-5.1-low,gpt-5.1-medium,gpt-5.1-minimal,gpt-5.2,gpt-5.2-2025-12-11,gpt-5.2-chat,gpt-5.2-chat-latest,gpt-5.2-codex,gpt-5.2-high,gpt-5.2-low,gpt-5.2-medium,gpt-5.2-xhigh,gpt-5.3-codex,gpt-5.3-codex-high,gpt-5.3-codex-low,gpt-5.3-codex-medium,gpt-5.3-codex-xhigh,gpt-image-1,gpt-image-1-vip,gpt-image-1.5,grok-3,grok-3-deepsearch,grok-3-mini,grok-3-reasoner,grok-3-search,grok-4,grok-4-0709,grok-4-1-image,grok-4-1-non-thinking-w-tool,grok-4-1-thinking-1108b,grok-4-1-thinking-1129,grok-4-fast-non-reasoning,grok-4-fast-reasoning,grok-code-fast-1,grok-video-3,grok-video-3-max,grok-video-3-pro,jimeng-seedream-4-5,KAT-Coder-Air-V1,KAT-Coder-Exp-72B-1010,KAT-Coder-Pro-V1,Kimi-K2-Instruct,Kimi-K2-Thinking,kimi-k2.5,kimi-k2.5-search,kimi-k2.5-thinking,MiniMax-M2,MiniMax-M2.1,MiniMax-M2.1-Lightning,MiniMax-M2.5,MiniMax-M2.5-Search,mj_blend,mj_custom_zoom,mj_describe,mj_high_variation,mj_imagine,mj_inpaint,mj_low_variation,mj_modal,mj_pan,mj_reroll,mj_shorten,mj_upload,mj_uploads,mj_upscale,mj_variation,mj_zoom,Moonshot-Kimi-K2-Instruct,Moonshot-Kimi-K2-Instruct-search,moonshotai/Kimi-K2-Instruct-0905,nano-banana,nano-banana-2,net-gpt-3.5-turbo,net-gpt-4o,net-gpt-4o-mini,net-o1-mini,net-o1-mini-2024-09-12,net-o1-mini-all,net-o1-preview,net-o1-preview-2024-09-12,net-o1-preview-all,nt-deepseek-r1,o1,o1-2024-12-17,o1-all,o1-mini,o1-mini-2024-09-12,o1-mini-all,o1-preview,o1-preview-2024-09-12,o1-preview-all,o1-pro,o1-pro-all,o3,o3-2025-04-16,o3-all,o3-deep-research,o3-deep-research-2025-06-26,o3-mini,o3-mini-2025-01-31,o3-mini-all,o3-mini-high,o3-mini-high-all,o3-mini-low,o3-mini-medium,o3-pro,o3-pro-2025-06-10,o4-mini,o4-mini-2025-04-16,o4-mini-all,o4-mini-dr,o4-mini-high-all,qwen-deep-research,qwen-flash,qwen-flash-search,qwen-flash-search-thinking,qwen-flash-thinking,qwen-image-max-2025-12-30,qwen-long,qwen-long-2025-01-25,qwen-long-latest,qwen-plus,qwen-plus-latest,qwen-plus-latest-search-thinking,qwen-plus-latest-thinking,qwen-plus-search,qwen-plus-search-thinking,qwen-plus-thinking,qwen-tts-flash,qwen-tts-realtime,qwen-turbo,qwen-turbo-2025-04-28,qwen-turbo-2025-04-28-search,qwen-turbo-2025-04-28-search-thinking,qwen-turbo-2025-04-28-thinking,qwen-turbo-latest,qwen-turbo-latest-search-thinking,qwen-turbo-latest-thinking,qwen-turbo-search,qwen-turbo-search-thinking,qwen-turbo-thinking,qwen-vl-ocr,qwen-vl-ocr-latest,qwen-voice-enrollment,Qwen/Qwen-Image,Qwen/Qwen-Image-Edit-2509,Qwen/Qwen2.5-VL-72B-Instruct,Qwen/Qwen3-235B-A22B,Qwen/Qwen3-Next-80B-A3B-Instruct,Qwen/Qwen3-Next-80B-A3B-Thinking,Qwen/Qwen3-Omni-30B-A3B-Captioner,Qwen/Qwen3-Omni-30B-A3B-Instruct,Qwen/Qwen3-Omni-30B-A3B-Thinking,Qwen2.5-7B-Instruct,qwen3-235b-a22b,Qwen3-235B-A22B-Instruct-2507,qwen3-30b-a3b,Qwen3-30B-A3B-Instruct-2507,qwen3-30b-a3b-thinking,Qwen3-30B-A3B-Thinking-2507,qwen3-32b,qwen3-32b-think,Qwen3-8B,qwen3-coder-flash,qwen3-coder-plus,qwen3-max,qwen3-max-2025-09-23,qwen3-max-2025-09-23-search,qwen3-max-2025-09-23-search-thinking,qwen3-max-2025-09-23-thinking,qwen3-max-preview,qwen3-max-preview-search,qwen3-max-preview-search-thinking,qwen3-max-preview-thinking,qwen3-max-search,qwen3-max-search-thinking,qwen3-max-thinking,qwen3-omni-30b-a3b-captioner,qwen3-tts-flash,qwen3-tts-flash-realtime,qwen3-tts-vc-realtime-2026-01-15,qwen3-tts-vd-realtime-2025-12-16,Qwen3-VL-235B-A22B-Instruct,Qwen3-VL-235B-A22B-Thinking,qwen3-vl-embedding,qwen3-vl-flash,qwen3-vl-flash-2025-10-15,qwen3-vl-flash-2025-10-15-search,qwen3-vl-flash-2025-10-15-search-thinking,qwen3-vl-flash-2025-10-15-thinking,qwen3-vl-flash-search,qwen3-vl-flash-search-thinking,qwen3-vl-flash-thinking,qwen3-vl-plus,qwen3-vl-plus-2025-12-19,qwen3-vl-plus-2025-12-19-search,qwen3-vl-plus-2025-12-19-search-thinking,qwen3-vl-plus-2025-12-19-thinking,qwen3-vl-plus-search,qwen3-vl-plus-search-thinking,qwen3-vl-plus-thinking,qwen3.5-plus,qwen3.5-plus-2026-02-15,qwen3.5-plus-2026-02-15-search,qwen3.5-plus-2026-02-15-search-thinking,qwen3.5-plus-2026-02-15-thinking,qwen3.5-plus-search,qwen3.5-plus-search-thinking,qwen3.5-plus-thinking,qwq-plus,qwq-plus-2025-03-05,qwq-plus-latest,s1-deepsearch,s1-pro-deepsearch,suno_act_mp4,suno_act_stems,suno_act_timing,suno_act_wav,suno_concat,suno_lyrics,suno_music,suno_persona_create,suno_uploads,swap_face,text-embedding-3-large,text-embedding-3-small,text-embedding-ada-002,text-embedding-v4,tts-1,tts-1-1106,tts-1-hd,tts-1-hd-1106,veo_3_1,veo_3_1-fast,veo_3_1-fast-fl,veo_3_1-fl,veo_3_1-landscape,veo_3_1-landscape-fast,veo_3_1-landscape-fast-fl,veo_3_1-landscape-fl,veo_3_1-portrait,veo_3_1-portrait-fast,veo_3_1-portrait-fast-fl,veo_3_1-portrait-fl,veo3-fast,veo3-fast-frames,veo3-frames,veo3-pro,veo3-pro-frames,veo3.1,veo3.1-components,veo3.1-fast,veo3.1-pro,wan2.6-image,whisper,whisper-1,Z-Image-Turbo
"""

UPSERT_SQL = """
INSERT INTO ai_model_catalog (
  model_key, display_name, provider, family, model_group, modality,
  capability_tags, version_label, source_type, is_active, is_deprecated,
  sort_order, notes, raw_meta
) VALUES (
  %s, %s, %s, %s, %s, %s,
  %s, %s, %s, %s, %s,
  %s, %s, %s
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  provider = VALUES(provider),
  family = VALUES(family),
  model_group = VALUES(model_group),
  modality = VALUES(modality),
  capability_tags = VALUES(capability_tags),
  version_label = VALUES(version_label),
  source_type = VALUES(source_type),
  is_active = VALUES(is_active),
  is_deprecated = VALUES(is_deprecated),
  sort_order = VALUES(sort_order),
  notes = VALUES(notes),
  raw_meta = VALUES(raw_meta),
  updated_at = CURRENT_TIMESTAMP;
"""


def parse_models(raw: str) -> List[str]:
    tokens = [token.strip() for token in raw.replace("\n", "").split(",")]
    seen = set()
    result = []
    for key in tokens:
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def infer_provider(model_key: str) -> str:
    lower = model_key.lower()
    if (
        lower.startswith("gpt-")
        or lower.startswith("o1")
        or lower.startswith("o3")
        or lower.startswith("o4")
        or lower.startswith("whisper")
        or lower.startswith("tts-")
        or lower.startswith("text-embedding-")
    ):
        return "openai"
    if lower.startswith("claude-") or lower.startswith("cs-claude-"):
        return "anthropic"
    if lower.startswith("gemini-") or lower.startswith("cs-gemini-") or lower.startswith("veo"):
        return "google"
    if (
        lower.startswith("qwen-")
        or lower.startswith("qwen/")
        or lower.startswith("qwen3")
        or lower.startswith("qwq-")
    ):
        return "qwen"
    if lower.startswith("deepseek-") or lower.startswith("deepseek-ai/"):
        return "deepseek"
    if (
        lower.startswith("grok-")
        or lower.startswith("cs-grok-")
        or lower.startswith("grok-code-")
        or lower.startswith("grok-video-")
    ):
        return "xai"
    if lower.startswith("mj_") or lower in {"chat_fast_imagine", "chat_relax_imagine"}:
        return "midjourney"
    if lower.startswith("glm-"):
        return "zhipu"
    if lower.startswith("kimi-") or lower.startswith("moonshot-") or lower.startswith("moonshotai/"):
        return "moonshot"
    if lower.startswith("suno_"):
        return "suno"
    if lower.startswith("cosyvoice-") or lower.startswith("fun-asr-"):
        return "audio"
    return "other"


def infer_family(model_key: str, provider: str) -> str:
    lower = model_key.lower()
    if lower.startswith("gpt-4o"):
        return "gpt"
    if "claude-4-sonnet" in lower:
        return "claude"
    if "gemini-2.5-pro" in lower:
        return "gemini"
    if "qwen-plus" in lower:
        return "qwen"
    if "deepseek-v3" in lower:
        return "deepseek"
    if lower.startswith("mj_imagine"):
        return "mj"
    if lower.startswith("grok-4"):
        return "grok"
    if re.match(r"^o[134](?:$|-)", lower):
        return "o-series"
    if lower.startswith("veo"):
        return "veo"
    if lower.startswith("whisper-"):
        return "whisper"
    if lower.startswith("text-embedding-"):
        return "embedding"
    if lower.startswith("tts-"):
        return "tts"

    for prefix, family in [
        ("gpt-", "gpt"),
        ("claude-", "claude"),
        ("gemini-", "gemini"),
        ("qwen", "qwen"),
        ("deepseek-", "deepseek"),
        ("grok-", "grok"),
        ("mj_", "mj"),
    ]:
        if lower.startswith(prefix):
            return family
    return provider


def infer_model_group(model_key: str) -> str:
    lower = model_key.lower()
    if "embedding" in lower:
        return "embedding"
    if (
        "mj_" in lower
        or "image" in lower
        or "gpt-image" in lower
        or "seedream" in lower
        or "swap_face" in lower
        or "z-image" in lower
    ):
        return "image"
    if "video" in lower or "veo" in lower:
        return "video"
    if (
        "tts" in lower
        or "voice" in lower
        or "whisper" in lower
        or "asr" in lower
        or "transcribe" in lower
    ):
        return "audio"
    if "realtime" in lower:
        return "realtime"
    if "search" in lower:
        return "search"
    if "codex" in lower or "coder" in lower:
        return "coder"
    return "llm"


def infer_modality(model_key: str, group: str) -> str:
    lower = model_key.lower()
    if group == "image":
        return "image"
    if group == "video":
        return "video"
    if group == "audio":
        return "audio"
    if group == "embedding":
        return "text-vector"
    if re.search(r"(vl|omni|vision|image-preview)", lower):
        return "multimodal"
    return "text"


def infer_version_label(model_key: str) -> Optional[str]:
    m = re.search(r"\b\d{4}-\d{2}-\d{2}\b", model_key)
    if m:
        return m.group(0)
    m = re.search(r"\b\d{8}(?:-[a-z])?\b", model_key, flags=re.IGNORECASE)
    if m:
        return m.group(0)
    lower = model_key.lower()
    for token in ("latest", "preview", "thinking"):
        if token in lower:
            return token
    return None


def infer_capability_tags(model_key: str) -> List[str]:
    lower = model_key.lower()
    tags: List[str] = []
    if "thinking" in lower:
        tags.append("thinking")
    if "search" in lower:
        tags.append("search")
    if "image" in lower:
        tags.append("image")
    if "video" in lower or "veo" in lower:
        tags.append("video")
    if any(k in lower for k in ("tts", "voice", "whisper", "asr", "transcribe")):
        tags.append("audio")
    if any(k in lower for k in ("vision", "vl", "omni")):
        tags.append("vision")
    return tags


def build_row(model_key: str, index: int) -> Dict[str, Any]:
    provider = infer_provider(model_key)
    family = infer_family(model_key, provider)
    model_group = infer_model_group(model_key)
    modality = infer_modality(model_key, model_group)
    version_label = infer_version_label(model_key)
    capability_tags = infer_capability_tags(model_key)

    return {
        "model_key": model_key,
        "display_name": model_key,
        "provider": provider,
        "family": family,
        "model_group": model_group,
        "modality": modality,
        "capability_tags": json.dumps(capability_tags, ensure_ascii=False),
        "version_label": version_label,
        "source_type": "import",
        "is_active": 1,
        "is_deprecated": 0,
        "sort_order": index,
        "notes": None,
        "raw_meta": json.dumps(
            {
                "original_model_key": model_key,
                "parser_version": "v1",
            },
            ensure_ascii=False,
        ),
    }


def get_db_connection():
    host = os.getenv("DB_HOST", "127.0.0.1")
    port = int(os.getenv("DB_PORT", "3306"))
    user = os.getenv("DB_USER", "root")
    password = os.getenv("DB_PASSWORD", "123456")
    database = os.getenv("DB_NAME", "duanju")

    try:
        import pymysql  # type: ignore

        return pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            charset="utf8mb4",
            autocommit=False,
        ), "pymysql"
    except Exception:
        try:
            import mysql.connector  # type: ignore

            return mysql.connector.connect(
                host=host,
                port=port,
                user=user,
                password=password,
                database=database,
                charset="utf8mb4",
                autocommit=False,
            ), "mysql-connector-python"
        except Exception as e:
            raise RuntimeError(
                "No MySQL driver available. Install one: pip install pymysql"
            ) from e


def main() -> int:
    models = parse_models(MODELS_RAW)
    rows = [build_row(model_key, idx + 1) for idx, model_key in enumerate(models)]

    conn, driver = get_db_connection()
    print(f"Using driver: {driver}")
    print(f"Parsed models: {len(models)}")
    try:
        cur = conn.cursor()
        for row in rows:
            cur.execute(
                UPSERT_SQL,
                (
                    row["model_key"],
                    row["display_name"],
                    row["provider"],
                    row["family"],
                    row["model_group"],
                    row["modality"],
                    row["capability_tags"],
                    row["version_label"],
                    row["source_type"],
                    row["is_active"],
                    row["is_deprecated"],
                    row["sort_order"],
                    row["notes"],
                    row["raw_meta"],
                ),
            )
        conn.commit()

        cur.execute("SELECT COUNT(*) FROM ai_model_catalog")
        total = int(cur.fetchone()[0])
        cur.execute(
            """
            SELECT provider, COUNT(*) AS cnt
            FROM ai_model_catalog
            GROUP BY provider
            ORDER BY cnt DESC, provider ASC
            """
        )
        provider_stats = cur.fetchall()

        unresolved = []
        for r in rows:
            if r["provider"] == "other" or r["family"] in (None, "", "other"):
                unresolved.append((r["model_key"], r["provider"], r["family"]))

        print(f"Rows in ai_model_catalog: {total}")
        print("Top providers:")
        for provider, cnt in provider_stats[:10]:
            print(f"  {provider}: {cnt}")
        print(f"Unresolved guess rows: {len(unresolved)}")
        if unresolved:
            print("Unresolved sample (first 30):")
            for item in unresolved[:30]:
                print(f"  {item[0]} | provider={item[1]} | family={item[2]}")

    except Exception as exc:
        conn.rollback()
        raise
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as err:
        print(f"[ERROR] {err}", file=sys.stderr)
        raise
