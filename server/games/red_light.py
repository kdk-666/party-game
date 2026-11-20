import asyncio
import time
import random
GAME_TIME = 600.0  # 게임 제한 시간(초)
THRESHOLD = 2.0      # 빨간불에 이 값보다 크게 움직이면 탈락
GRACE = 0.5          # 빨간불 직후 봐주는 시간(초)
START_DIST = 100.0   # 술래까지 거리(m)
MAX_SPEED = 5.0      # 최대 속도(m/초)
SPEED_RATE = 1.0     # 움직임 값 1당 속도(m/초). 올리면 더 빨리 감
TICK = 0.1           # 거리 갱신 간격(초)
MOTION_TIMEOUT = 0.5  # 0.5초 동안 새 센서 값이 없으면 움직임을 0으로 처리


class RedLight:
    def __init__(self, names, broadcast):
        self.dist = {n: START_DIST for n in names}   # 남은 거리
        self.motion = {n: 0.0 for n in names}        # 최근 움직임 값
        self.motion_time = {n: 0.0 for n in names}
        self.alive = set(names)
        self.connected = set(names)  # 게임에 연결되어 있는 참가자
        self.out = []
        self.arrived = []
        self.state = "green"
        self.red_since = 0.0
        self.running = False
        self.end_event = asyncio.Event()
        self.broadcast = broadcast

    async def run(self):
        self.running = True

        await self.broadcast({"type": "countdown", "data": {}})
        await self.wait_or_end(3)

        if not self.end_event.is_set():
            self.loop_task = asyncio.create_task(self.move_loop())
            end_time = asyncio.get_running_loop().time() + GAME_TIME / 10

            while not self.end_event.is_set():
                await self.set_state("green")
                remaining = end_time - asyncio.get_running_loop().time()
                await self.wait_or_end(min(random.uniform(3, 6), remaining))

                if self.end_event.is_set() or asyncio.get_running_loop().time() >= end_time:
                    break

                self.red_since = asyncio.get_running_loop().time()
                await self.set_state("red")
                remaining = end_time - asyncio.get_running_loop().time()
                await self.wait_or_end(min(random.uniform(2, 4), remaining))

                if asyncio.get_running_loop().time() >= end_time:
                    break

            self.loop_task.cancel()
            try:
                await self.loop_task
            except asyncio.CancelledError:
                pass

        self.running = False

        if not self.connected:
            await self.broadcast({"type": "game_cancelled", "data": {}})
            return

        arrived = [name for name in self.arrived if name in self.connected]

        if arrived:
            winner = arrived[0]
        else:
            winner = min(self.connected, key=lambda name: self.dist[name])

        await self.broadcast({
            "type": "game_over",
            "data": {
                "winner": winner,
                "arrived": arrived,
                "dist": self.dist
            }
        })

    async def move_loop(self):
        # 0.1초마다 초록불인 동안 거리를 줄이고 화면에 알린다
        while True:
            await asyncio.sleep(TICK)
            if self.state == "green":
                now = asyncio.get_running_loop().time()

                for n in list(self.alive):
                    elapsed = now - self.motion_time[n]
                    motion = self.motion[n] if elapsed <= MOTION_TIMEOUT else 0.0
                    speed = min(motion * SPEED_RATE, MAX_SPEED)
                    self.dist[n] = max(0.0, self.dist[n] - speed * TICK)
                    if self.dist[n] <= 0:
                        self.alive.discard(n)
                        self.arrived.append(n)
                if self.arrived:
                    self.end_event.set()  # 도착자가 생기면 종료 신호
            await self.broadcast({"type": "dist", "data": {
                "dist": self.dist, "alive": sorted(self.alive)}})

    async def set_state(self, state):
        self.state = state
        await self.broadcast({"type": "state", "data": {"state": state, "alive": sorted(self.alive)}})

    async def on_motion(self, name, value):
        if not self.running or name not in self.alive:
            return
        self.motion[name] = value
        self.motion_time[name] = time.time()
        if self.state != "red":
            return
        if asyncio.get_event_loop().time() - self.red_since < GRACE:
            return
        if value > THRESHOLD:
            self.alive.discard(name)
            if not self.alive:
                self.end_event.set()
            self.out.append(name)
            await self.broadcast({"type": "eliminated", "data": {"name": name, "alive": sorted(self.alive)}})

    async def remove_player(self, name):
        self.connected.discard(name)
        self.alive.discard(name)

        if not self.alive:
            self.end_event.set()

        await self.broadcast({
            "type": "player_left",
            "data": {"name": name}
        })

    async def wait_or_end(self, seconds):
        try:
            await asyncio.wait_for(self.end_event.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass
