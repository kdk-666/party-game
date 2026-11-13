import asyncio
import random

THRESHOLD = 2.0      # 빨간불에 이 값보다 크게 움직이면 탈락
GRACE = 0.5          # 빨간불 직후 봐주는 시간(초)
START_DIST = 100.0   # 술래까지 거리(m)
MAX_SPEED = 5.0      # 최대 속도(m/초)
SPEED_RATE = 1.0     # 움직임 값 1당 속도(m/초). 올리면 더 빨리 감
TICK = 0.1           # 거리 갱신 간격(초)


class RedLight:
    def __init__(self, names, broadcast):
        self.dist = {n: START_DIST for n in names}   # 남은 거리
        self.motion = {n: 0.0 for n in names}        # 최근 움직임 값
        self.alive = set(names)
        self.out = []
        self.arrived = []
        self.state = "green"
        self.red_since = 0.0
        self.running = False
        self.broadcast = broadcast

    async def run(self):
        self.running = True
        loop = asyncio.get_event_loop()
        await self.broadcast({"type": "countdown", "data": {}})
        await asyncio.sleep(3)
        self.loop_task = asyncio.create_task(self.move_loop())
        while self.running and self.alive:
            await self.set_state("green")
            await asyncio.sleep(random.uniform(3, 6))
            await self.set_state("red")
            self.red_since = loop.time()
            await asyncio.sleep(random.uniform(2, 4))
        self.running = False
        self.loop_task.cancel()
        if self.arrived:
            winner = self.arrived[0]
        else:
            winner = min(self.dist, key=self.dist.get)   # 가장 가까이 갔던 사람
        await self.broadcast({"type": "game_over", "data": {
            "winner": winner, "arrived": self.arrived, "dist": self.dist}})

    async def move_loop(self):
        # 0.1초마다 초록불인 동안 거리를 줄이고 화면에 알린다
        while True:
            await asyncio.sleep(TICK)
            if self.state == "green":
                for n in list(self.alive):
                    speed = min(self.motion[n] * SPEED_RATE, MAX_SPEED)
                    self.dist[n] = max(0.0, self.dist[n] - speed * TICK)
                    if self.dist[n] <= 0:
                        self.alive.discard(n)
                        self.arrived.append(n)
                if self.arrived:
                    self.running = False   # 먼저 도착하면 즉시 종료
            await self.broadcast({"type": "dist", "data": {
                "dist": self.dist, "alive": sorted(self.alive)}})

    async def set_state(self, state):
        self.state = state
        await self.broadcast({"type": "state", "data": {"state": state, "alive": sorted(self.alive)}})

    async def on_motion(self, name, value):
        if not self.running or name not in self.alive:
            return
        self.motion[name] = value
        if self.state != "red":
            return
        if asyncio.get_event_loop().time() - self.red_since < GRACE:
            return
        if value > THRESHOLD:
            self.alive.discard(name)
            self.out.append(name)
            await self.broadcast({"type": "eliminated", "data": {"name": name, "alive": sorted(self.alive)}})
