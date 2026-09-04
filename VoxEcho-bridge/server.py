# -*- coding: utf-8 -*-
"""ebooks-tts 本地桥：127.0.0.1:5005"""
from __future__ import annotations

import asyncio
import logging
import sys
import time
from typing import Optional

import edge_tts
from flask import Flask, Response, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("tts-server")

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
MAX_ATTEMPTS = 3
HOST = "127.0.0.1"
PORT = 5005

# ---- 音色清单缓存（edge_tts.list_voices 走微软接口，网络请求，缓存 24h）----
_VOICES_CACHE = None
_VOICES_CACHE_TIME = 0.0
VOICES_CACHE_TTL = 24 * 60 * 60  # 24 小时


async def fetch_voices() -> list[dict]:
    raw = await edge_tts.list_voices()
    out = []
    for v in raw or []:
        short_name = v.get("ShortName")
        if not short_name:
            continue
        out.append(
            {
                "shortName": short_name,
                "friendlyName": v.get("FriendlyName") or short_name,
                "gender": v.get("Gender"),
                "locale": v.get("Locale") or "",
                "status": v.get("Status"),
            }
        )
    return out


@app.route("/voices", methods=["GET"])
def voices():
    global _VOICES_CACHE, _VOICES_CACHE_TIME
    now = time.time()
    if _VOICES_CACHE is None or (now - _VOICES_CACHE_TIME) > VOICES_CACHE_TTL:
        try:
            fetched = asyncio.run(fetch_voices())
            if not fetched:
                raise RuntimeError("edge_tts.list_voices 返回空")
            _VOICES_CACHE = fetched
            _VOICES_CACHE_TIME = now
            logger.info(
                "刷新音色清单: %d voices / %d locales",
                len(fetched),
                len({v["locale"] for v in fetched}),
            )
        except Exception as e:
            logger.error("获取音色清单失败: %s: %s", type(e).__name__, e)
            if _VOICES_CACHE is None:
                return jsonify({"error": "%s: %s" % (type(e).__name__, e)}), 502
            # 拉取失败但有旧缓存，继续返回旧缓存
    return jsonify(
        {
            "voices": _VOICES_CACHE,
            "updatedAt": int(_VOICES_CACHE_TIME * 1000),
        }
    )


async def synthesize(text: str, voice: str, rate: Optional[str] = None) -> bytes:
    kwargs = {}
    if rate:
        kwargs["rate"] = rate
    communicate = edge_tts.Communicate(text, voice, **kwargs)
    chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    return b"".join(chunks)


async def synthesize_with_retry(text: str, voice: str, rate: Optional[str] = None) -> bytes:
    last = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return await synthesize(text, voice, rate)
        except Exception as e:
            last = e
            logger.warning(
                "第 %d/%d 次合成失败: %s: %s",
                attempt,
                MAX_ATTEMPTS,
                type(e).__name__,
                e,
            )
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(1.0)
    raise last  # type: ignore


@app.route("/speak", methods=["POST"])
def speak():
    payload = request.get_json(force=True) or {}
    text = (payload.get("text") or "").strip()
    voice = payload.get("voice") or DEFAULT_VOICE
    rate = payload.get("rate")
    if not text:
        return jsonify({"error": "text 不能为空"}), 400
    try:
        audio = asyncio.run(synthesize_with_retry(text, voice, rate))
    except Exception as e:
        logger.error("合成最终失败: %s: %s", type(e).__name__, e)
        return jsonify({"error": "%s: %s" % (type(e).__name__, e)}), 500
    logger.info("合成成功 voice=%s bytes=%d", voice, len(audio))
    return Response(audio, mimetype="audio/mpeg")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "ebooks-tts-bridge"})


def main():
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False, threaded=True)


if __name__ == "__main__":
    main()
