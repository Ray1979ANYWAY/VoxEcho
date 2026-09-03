import asyncio
import logging
import edge_tts
from flask import Flask, request, Response, jsonify
from flask_cors import CORS

app = Flask(__name__)
# 允许来自浏览器扩展（chrome-extension://...）的跨域请求。
# 服务只监听 127.0.0.1，不对外网暴露，所以这里放开 CORS 不是安全问题。
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts-server")

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
MAX_ATTEMPTS = 3


async def synthesize(text: str, voice: str) -> bytes:
    communicate = edge_tts.Communicate(text, voice)
    audio_chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
    return b"".join(audio_chunks)


async def synthesize_with_retry(text: str, voice: str) -> bytes:
    # 和微软 TTS 服务器的连接偶发失败（代理线路不稳、握手超时之类），大概率重试一两次就能过。
    #
    # 注意：这里曾经加过 asyncio.wait_for() 强制给单次连接设超时上限，想解决"极端情况下
    # 卡将近 2 分钟"的问题，结果在 Windows 上跟 edge-tts 底层的 WebSocket 连接不兼容，
    # 导致原本几秒内就能成功的请求也全部被拖成超时失败——反而比不加这层还差，已撤回。
    # 极端卡顿的情况改由浏览器扩展 background.js 那层的监控器兜底（发出请求太久没回应就
    # 主动判定失败重试），不在这一层强行打断连接。
    last_error = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return await synthesize(text, voice)
        except Exception as e:
            last_error = e
            logger.warning(
                "第 %d/%d 次合成失败：%s: %s",
                attempt,
                MAX_ATTEMPTS,
                type(e).__name__,
                e,
            )
            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(1.0)
    raise last_error


@app.route("/speak", methods=["POST"])
def speak():
    payload = request.get_json(force=True) or {}
    text = (payload.get("text") or "").strip()
    voice = payload.get("voice") or DEFAULT_VOICE

    if not text:
        return jsonify({"error": "text 不能为空"}), 400

    try:
        audio_bytes = asyncio.run(synthesize_with_retry(text, voice))
    except Exception as e:
        logger.error("重试 %d 次后仍然失败：%s: %s", MAX_ATTEMPTS, type(e).__name__, e)
        return jsonify({"error": f"{type(e).__name__}: {e}"}), 500

    return Response(audio_bytes, mimetype="audio/mpeg")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    # 只监听本机端口，不对外网暴露
    app.run(host="127.0.0.1", port=5005, debug=False)

