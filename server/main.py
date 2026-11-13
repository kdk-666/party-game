import asyncio
import json
from pathlib import Path

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from server.games.red_light import RedLight

app = FastAPI()
WEB = Path(__file__).resolve().parent.parent / "web"

hosts = []
players = {}   # {WebSocket: 닉네임}
game = None


async def send_all(sockets, msg):
    text = json.dumps(msg)
    for s in list(sockets):
        try:
            await s.send_text(text)
        except Exception:
            pass


async def to_hosts(msg):
    await send_all(hosts, msg)


async def to_everyone(msg):
    await send_all(hosts + list(players), msg)


async def send_lobby():
    await to_hosts({"type": "lobby", "data": {"players": list(players.values())}})


@app.websocket("/ws/host")
async def ws_host(ws: WebSocket):
    global game
    await ws.accept()
    hosts.append(ws)
    await send_lobby()
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg["type"] == "start" and players and not (game and game.running):
                game = RedLight(list(players.values()), to_everyone)
                asyncio.create_task(game.run())
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
                v = msg["data"]["value"]
                await to_hosts({"type": "motion", "data": {"name": players[ws], "value": v}})
                if game:
                    await game.on_motion(players[ws], v)
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
