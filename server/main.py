import asyncio
import json
import logging
from pathlib import Path

import qrcode
import qrcode.image.svg
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from server.games.red_light import RedLight
from server.games.registry import GAME_REGISTRY
from server.match import Match

app = FastAPI()
WEB = Path(__file__).resolve().parent.parent / "web"
MAX_PLAYERS = 4
hosts = []
players = {}   # {WebSocket: 닉네임}
game = None
total_scores = {}
match_task = None
INTERMISSION_SECONDS = 5

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
    if msg.get("type") == "game_over":
        msg["ranking"] = msg.get("data", {}).get("rankings", [])

    await send_all(hosts + list(players), msg)


async def send_lobby():
    await to_hosts({"type": "lobby", "data": {"players": list(players.values())}})
def make_match_game(match, info):
    global game

    connected = set(players.values())
    names = [name for name in match.players if name in connected]
    if not names:
        return None

    game = info["game_class"](names, to_everyone)
    game.running = True
    return game
async def send_match_start(match, game_id, info):
    await to_everyone({"type": "round_start", "data": {
        "game_id": game_id,
        "game_name": info["name"],
        "round": match.completed_rounds + 1,
        "total_rounds": len(match.game_ids),
    }})


async def send_match_result(match, game_id, result):
    print("누적 점수:", match.total_scores, flush=True)
    await to_everyone({"type": "round_result", "data": {
        "game_id": game_id,
        "round": match.completed_rounds,
        "scores": result["scores"],
        "total_scores": dict(match.total_scores),
    }})
async def send_match_over(match):
    standings = [
        {"name": name, "score": score}
        for name, score in sorted(match.total_scores.items(), key=lambda item: -item[1])
    ]
    print("대회 종료. 최종 점수:", match.total_scores, flush=True)
    await to_everyone({"type": "match_over", "data": {
        "total_scores": dict(match.total_scores),
        "standings": standings,
    }})
async def run_match(match):
    global game
    try:
        completed = await match.run_all(
            lambda game_id, info: make_match_game(match, info),
            lambda game_id, result: send_match_result(match, game_id, result),
            delay=INTERMISSION_SECONDS,
            on_start=lambda game_id, info: send_match_start(match, game_id, info),
        )
        if completed:
            await send_match_over(match)
        else:
            await to_everyone({"type": "match_cancelled", "data": {}})
    except Exception:
        logging.exception("대회 진행 중 오류가 발생했습니다.")
        await to_everyone({"type": "match_error", "data": {"message": "대회 진행 중 오류가 발생했습니다."}})
    finally:
        game = None



@app.websocket("/ws/host")
async def ws_host(ws: WebSocket):
    global game, match_task
    await ws.accept()
    hosts.append(ws)
    await send_lobby()
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg["type"] == "start" and players and not (
                    (game is not None and game.running)
                    or (match_task is not None and not match_task.done())
            ):
                try:
                    match = Match(list(players.values()), GAME_REGISTRY)
                except ValueError as error:
                    print("대회를 시작할 수 없습니다:", error, flush=True)
                    await ws.send_json({"type": "match_error", "data": {"message": str(error)}})
                    continue
                match_task = asyncio.create_task(run_match(match))
    except WebSocketDisconnect:
        hosts.remove(ws)


@app.websocket("/ws/player")
async def ws_player(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg["type"] == "join":
                name = msg["data"]["name"].strip()[:12]
                if (
                    (game is not None and game.running)
                    or (match_task is not None and not match_task.done())
                    ):
                    await ws.send_json({
                        "type": "join_error",
                        "data": {"message": "대회가 끝난 뒤 참가해 주세요."}
                    })
                elif not name:


                    await ws.send_json({
                        "type": "join_error",
                        "data": {"message": "닉네임을 입력해 주세요."}
                    })
                elif name in players.values():
                    await ws.send_json({
                        "type": "join_error",
                        "data": {"message": "이미 사용 중인 닉네임입니다."}
                    })
                elif len(players) >= MAX_PLAYERS:
                    await ws.send_json({
                        "type": "join_error",
                        "data": {"message": "방이 가득 찼어요. 최대 4명까지 참가할 수 있어요."}
                    })
                else:
                    players[ws] = name
                    await ws.send_json({
                        "type": "join_ok",
                        "data": {"name": name}
                    })
                    await send_lobby()
            elif msg["type"] == "motion" and ws in players:
                v = msg["data"]["value"]
                await to_hosts({"type": "motion", "data": {"name": players[ws], "value": v}})
                if game:
                    await game.on_motion(players[ws], v)
    except WebSocketDisconnect:
        name = players.pop(ws, None)

        if name is not None and game is not None and game.running:
            await game.remove_player(name)

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
