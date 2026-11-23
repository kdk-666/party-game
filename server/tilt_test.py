"""공 굴리기 시험용 주소 (대회 흐름과 별개). 폰 한 대로 기울기/지연/화면꺼짐방지를 확인한다.

  페이지:     https://내IP:8000/tilt-test
  WebSocket:  /ws/tilt-test   (연결마다 공 하나, 미로 하나가 따로 생김)
"""
import asyncio
import json
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from games.tilt_ball.maze import MAZES, Maze, TiltWorld

WEB = Path(__file__).resolve().parent.parent / "web"
TICK = 1 / 30          # 초당 30번 위치를 보낸다
ME = "me"


def new_world():
    m = MAZES[0]
    return TiltWorld(Maze(m["name"], m["rows"]), [ME], time_limit=600)


def tilt_test_page():
    return FileResponse(WEB / "tilt-test.html")


async def ws_tilt_test(ws: WebSocket):
    await ws.accept()
    world = new_world()
    last_ts = 0                        # 폰이 보낸 시각(지연 시간 계산용으로 그대로 돌려준다)
    await ws.send_json({"type": "maze", "data": {"name": world.maze.name, "rows": world.maze.rows}})

    async def reader():
        nonlocal world, last_ts
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            kind, data = msg.get("type"), msg.get("data")
            data = data if isinstance(data, dict) else {}
            if kind == "tilt":
                world.set_tilt(ME, data.get("x", 0), data.get("y", 0))
                ts = data.get("ts", 0)
                last_ts = ts if isinstance(ts, (int, float)) else 0
            elif kind == "reset":
                world = new_world()

    async def ticker():
        loop = asyncio.get_running_loop()
        prev = loop.time()
        while True:
            await asyncio.sleep(TICK)
            now = loop.time()
            dt, prev = min(now - prev, 0.1), now           # 서버가 잠깐 느려져도 한 번에 크게 뛰지 않게
            world.step(dt)
            b = world.balls[ME]
            await ws.send_json({"type": "state", "data": {
                "t": round(world.time, 2), "x": round(b.x, 3), "y": round(b.y, 3),
                "vx": round(b.vx, 2), "vy": round(b.vy, 2),
                "state": b.state, "progress": round(b.best_progress, 3), "falls": b.falls,
                "reached": sorted([c, r] for c, r in b.reached), "cp_saves": b.cp_saves,
                "finish_time": None if b.finish_time is None else round(b.finish_time, 2),
                "ts": last_ts}})

    tasks = [asyncio.create_task(reader()), asyncio.create_task(ticker())]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        for t in done:
            try:
                t.result()
            except (WebSocketDisconnect, RuntimeError):     # 폰이 끊긴 정상적인 경우
                pass
    finally:
        for t in tasks:
            t.cancel()


def install_tilt_test(app):
    """main.py에서 한 줄로 시험 주소를 붙인다. (include_router 대신 라우트를 하나씩 등록해서 다른 코드/테스트와 안 부딪힌다)"""
    app.add_api_route("/tilt-test", tilt_test_page, methods=["GET"])
    app.add_api_websocket_route("/ws/tilt-test", ws_tilt_test)
