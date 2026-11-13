import json
from pathlib import Path

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

app = FastAPI()
WEB = Path(__file__).resolve().parent.parent / "web"

hosts = []    # 노트북 화면들
players = {}  # {WebSocket: 닉네임}


async def to_hosts(msg):
    # 모든 호스트 화면에 메시지를 보낸다
    text = json.dumps(msg)
    for h in hosts:
        await h.send_text(text)


async def send_lobby():
    await to_hosts({"type": "lobby", "data": {"players": list(players.values())}})


@app.websocket("/ws/host")
async def ws_host(ws: WebSocket):
    await ws.accept()
    hosts.append(ws)
    await send_lobby()
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hosts.remove(ws)


@app.websocket("/ws/player")
async def ws_player(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg["type"] == "join":
                players[ws] = msg["data"]["name"][:12]
                await send_lobby()
            elif msg["type"] == "motion" and ws in players:
                # 폰이 보낸 움직임 크기를 호스트에 전달
                await to_hosts({"type": "motion", "data": {
                    "name": players[ws], "value": msg["data"]["value"]}})
    except WebSocketDisconnect:
        players.pop(ws, None)
        await send_lobby()


@app.get("/qr.svg")
def qr(url: str):
    img = qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage)
    return Response(img.to_string(), media_type="image/svg+xml")


@app.get("/")
def host_page():
    return FileResponse(WEB / "host" / "index.html")


@app.get("/play")
def player_page():
    return FileResponse(WEB / "player" / "index.html")


app.mount("/static", StaticFiles(directory=WEB), name="static")
