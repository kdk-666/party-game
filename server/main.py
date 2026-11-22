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
from server.preparation import GamePreparation

app = FastAPI()
WEB = Path(__file__).resolve().parent.parent / "web"
MAX_PLAYERS = 4
hosts = []
players = {}   # {WebSocket: 닉네임}
game = None
total_scores = {}
match_task = None
preparation = None
INTERMISSION_SECONDS = 5
PREPARATION_SECONDS = 60

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
async def send_preparation_update(current):
    # 준비 상태를 수정한 쪽에서 current.lock을 잡고 호출합니다.
    if preparation is not current:
        return
    await to_everyone({"type": "preparation_update", "data": {
        "token": current.token,
        "players": sorted(current.players),
        "ready": sorted(current.ready),
        "remaining": current.remaining(),
    }})
async def handle_ready(ws, data):
    current = preparation
    if current is None or ws not in players or not isinstance(data, dict):
        return

    async with current.lock:
        if (
            preparation is current
            and ws in players
            and data.get("token") == current.token
            and current.remaining() > 0
        ):
            if current.mark_ready(players[ws]):
                await send_preparation_update(current)
async def prepare_match_round(match, game_id, info):
    global preparation

    connected = set(players.values())
    names = [name for name in match.players if name in connected]
    if not names:
        return False

    current = GamePreparation(names, PREPARATION_SECONDS)
    preparation = current
    try:
        async with current.lock:
            await to_everyone({"type": "round_start", "data": {
                "game_id": game_id,
                "game_name": info["name"],
                "instructions": info.get("instructions", []),
                "round": match.completed_rounds + 1,
                "total_rounds": len(match.game_ids),
                "token": current.token,
                "players": sorted(current.players),
                "ready": [],
                "remaining": current.remaining(),
            }})

        can_start = await current.wait()
        async with current.lock:
            return can_start and any(name in players.values() for name in current.players)
    finally:
        if preparation is current:
            preparation = None
async def send_match_start(match, game_id, info):
    return await prepare_match_round(match, game_id, info)


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
            print('대회 취소됨', flush=True)
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
            elif msg["type"] == "photo" and ws in players:
                if game is not None and hasattr(game, "on_photo"):
                    await game.on_photo(players[ws], msg.get("data"))
            elif msg["type"] == "ready":
                    await handle_ready(ws, msg.get("data"))
            elif msg["type"] == "motion" and ws in players:
                if preparation is not None:
                    continue
                v = msg["data"]["value"]
                await to_hosts({"type": "motion", "data": {"name": players[ws], "value": v}})
                if game:
                    await game.on_motion(players[ws], v)
    except WebSocketDisconnect:
        name = players.pop(ws, None)
        print('연결 끊김:', name, '| 남은 참가자:', list(players.values()), flush=True)

        if name is not None and game is not None and game.running:
            await game.remove_player(name)

        current = preparation
        if name is not None and current is not None:
            async with current.lock:
                if preparation is current and name in current.players:
                    current.remove_player(name)
                    await send_preparation_update(current)

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

