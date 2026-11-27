"""기울여서 공 굴리기 (대회용 게임).

진행: 준비(각자 버튼으로 기울기 기준 맞추기) -> 3,2,1 -> 경주 -> 결과
순위: 먼저 도착한 순서, 못 도착하면 가장 멀리 간 순서 (물리와 순위 계산은 tilt_maze.py)
"""
import asyncio
import random

from games.tilt_ball.maze import MAZES, Maze, TiltWorld

TIME_LIMIT = 90.0        # 제한 시간(초)
FINISH_GRACE = 20.0      # 첫 도착자가 나오면 나머지는 이만큼만 더 기다린다(초)
INTRO_TIMEOUT = 25.0     # 준비 단계 최대 대기(초)
COUNT_FROM = 3           # 카운트다운 시작 숫자
TICK = 1 / 30            # 초당 30번 위치를 보낸다


_last_maze = None            # 가장 최근에 쓴 미로 이름 (연속으로 같은 미로가 나오지 않게)


class TiltBall:
    def __init__(self, names, broadcast, map_name=None):
        self.names = list(names)
        self.connected = set(names)
        self.broadcast = broadcast
        global _last_maze
        pool = [m for m in MAZES if m["name"] != _last_maze] or MAZES        # 직전 판과 같은 미로는 피한다
        m = random.choice(pool) if map_name is None else next((item for item in MAZES if item["name"] == map_name), None)
        if m is None:
            raise ValueError("선택할 수 없는 맵입니다.")
        _last_maze = m["name"]
        self.maze = Maze(m["name"], m["rows"], m.get("level", 0))
        self.world = TiltWorld(self.maze, self.names, time_limit=TIME_LIMIT)
        self.phase = "intro"             # intro -> count -> race -> over
        self.ready = set()
        self.ready_event = asyncio.Event()
        self.last_ts = {}                # 폰이 보낸 시각 (지연 시간 계산용으로 돌려준다)
        self.end_reason = "time"         # 끝난 이유: all_finished(모두 도착) / last_one(마지막 한 명만 남음) / time(시간 끝)
        self.running = False
        self.unified_preparation = False

    def preparation_data(self):
        """대회의 공통 준비 화면에서 사용할 실제 게임 맵을 반환한다."""
        self.unified_preparation = True
        return {"maze": {"name": self.maze.name, "rows": self.maze.rows, "level": self.maze.level}}

    # ----- 진행 -----
    async def run(self):
        self.running = True
        await self.broadcast({"type": "countdown", "data": {}})       # 설명 화면을 닫고 게임 화면을 연다
        await self.broadcast({"type": "tb_intro", "data": {
            "maze": {"name": self.maze.name, "rows": self.maze.rows, "level": self.maze.level},
            "names": self.names, "time_limit": TIME_LIMIT, "timeout": INTRO_TIMEOUT,
            "unified_preparation": self.unified_preparation}})
        if not self.unified_preparation:
            try:
                await asyncio.wait_for(self.ready_event.wait(), timeout=INTRO_TIMEOUT)
            except asyncio.TimeoutError:
                pass                                                   # 독립 실행에서는 기존 준비 단계 유지

        if self.connected:
            self.phase = "count"
            for n in range(COUNT_FROM, 0, -1):
                await self.broadcast({"type": "tb_count", "data": {"n": n}})
                await asyncio.sleep(1)
            self.phase = "race"
            await self._race()

        self.phase = "over"
        self.running = False
        if not self.connected:
            await self.broadcast({"type": "game_cancelled", "data": {}})
            return None

        ranking = self.world.ranking()
        results = {n: {"finish_time": None if b.finish_time is None else round(b.finish_time, 2),
                       "progress": round(b.best_progress, 3), "falls": b.falls}
                   for n, b in self.world.balls.items()}
        result = {"winner": ranking[0], "ranking": ranking, "scores": self.world.scores(), "results": results,
                  "reason": self.end_reason}
        await self.broadcast({"type": "tb_over", "data": result})
        return result

    async def _race(self):
        loop = asyncio.get_running_loop()
        prev, grace_set = loop.time(), False
        while self.connected and not self.world.finished:
            await asyncio.sleep(TICK)
            now = loop.time()
            dt, prev = min(now - prev, 0.1), now
            self.world.step(dt)
            if not grace_set:
                done = [b.finish_time for b in self.world.balls.values() if b.finish_time is not None]
                if done:                                               # 첫 도착자가 나옴 -> 남은 시간을 줄인다
                    self.world.time_limit = min(self.world.time_limit, min(done) + FINISH_GRACE)
                    grace_set = True
            await self.broadcast({"type": "tb_state", "data": {
                "t": round(self.world.time, 2),
                "left": round(max(0.0, self.world.time_limit - self.world.time), 1),
                "players": self.world.snapshot(), "ts": self.last_ts}})
            # 2명 이상이면 아직 못 들어온 사람이 한 명만 남았을 때 바로 끝낸다 (그 한 명은 지금까지 간 거리로 순위가 정해진다)
            balls = self.world.balls
            unfinished = [n for n, b in balls.items() if b.finish_time is None]
            if not unfinished:
                self.end_reason = "all_finished"
                break
            if len(balls) >= 2 and len(unfinished) == 1:
                self.end_reason = "last_one"
                break
        else:
            self.end_reason = "time"

    # ----- 폰이 보낸 메시지 (main.py가 모르는 메시지를 그대로 넘겨 준다) -----
    async def on_message(self, name, kind, data):
        data = data if isinstance(data, dict) else {}
        if name not in self.connected:
            return
        if kind == "tb_ready" and self.phase == "intro":
            self.ready.add(name)
            await self._ready_changed()
        elif kind == "tilt" and self.phase == "race":
            self.world.set_tilt(name, data.get("x", 0), data.get("y", 0))
            ts = data.get("ts")
            if isinstance(ts, (int, float)) and not isinstance(ts, bool):
                self.last_ts[name] = ts

    async def _ready_changed(self):
        if self.connected <= self.ready:
            self.ready_event.set()
        await self.broadcast({"type": "tb_ready_update", "data": {
            "ready": sorted(self.ready & self.connected), "total": len(self.connected)}})

    async def on_motion(self, name, value):
        pass                                           # 이 게임은 흔들기 센서값을 쓰지 않는다

    async def remove_player(self, name):
        self.connected.discard(name)
        self.ready.discard(name)
        self.world.remove_ball(name)
        self.last_ts.pop(name, None)
        if self.phase == "intro":
            await self._ready_changed()
