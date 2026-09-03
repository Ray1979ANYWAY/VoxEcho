# -*- coding: utf-8 -*-
"""ebooks-tts 本地桥：127.0.0.1:5005"""
from __future__ import annotations

import asyncio
import logging
import sys
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
