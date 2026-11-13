import json
from pathlib import Path

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

app = FastAPI()
WEB = Path(__file__).resolve().parent.parent / "web"

# 접속 중인 사람들을 기억하는 곳
hosts = []    # 노트북 화면들
players = {}  # {WebSocket: 닉네임}


async def send_lobby():
    # 현재 참가자 목록을 모든 호스트 화면에 보낸다
    names = list(players.values())
    msg = json.dumps({"type": "lobby", "data": {"players": names}})
    for h in hosts:
        await h.send_text(msg)


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
