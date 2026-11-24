import asyncio
import time
import random
GAME_TIME = 600.0  # 기존 게임 설정값. 실제 제한 시간은 GAME_TIME / 10초.
THRESHOLD = 2.0      # 빨간불에 이 값보다 크게 움직이면 탈락
GRACE = 0.5          # 빨간불 직후 봐주는 시간(초)
START_DIST = 10.0   # 술래까지 거리(m)
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
        self.end_time = None
        self.broadcast = broadcast

    async def run(self):
        self.running = True



        await self.broadcast({"type": "countdown", "data": {}})
        await self.wait_or_end(3)

        if not self.end_event.is_set():
            end_time = asyncio.get_running_loop().time() + GAME_TIME / 10
            self.end_time = end_time
            self.loop_task = asyncio.create_task(self.move_loop())

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

        survivors = sorted(
            (name for name in self.dist
             if name in self.connected and name not in self.out),
            key=self.dist.get,
        )

        if arrived and arrived[0] in survivors:
            survivors.remove(arrived[0])
            survivors.insert(0, arrived[0])

        eliminated = sorted(
            (name for name in self.dist
             if name in self.connected and name in self.out),
            key=self.dist.get,
        )

        ranking = survivors + eliminated
        winner = survivors[0] if survivors else None



        print("게임 순위:", ranking, flush=True)

        rank_points = [1000, 700, 500, 300]
        scores = {}

        for index, name in enumerate(ranking):
            if name in self.out:
                scores[name] = 100
            elif index < len(rank_points):
                scores[name] = rank_points[index]
            else:
                scores[name] = None

        print("게임 점수:", scores, flush=True)



        result = {
            "winner": winner,
            "ranking": ranking,
            "eliminated": eliminated,
            "scores": scores,
            "arrived": arrived,
            "dist": self.dist,
        }

        await self.broadcast({"type": "game_over", "data": result})
        return result

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
            await self.broadcast({"type": "dist", "data": self.screen_state()})

    def screen_state(self):
        """클라이언트가 실제 경기 상태와 서버 기준 남은 시간을 그릴 수 있게 한다."""
        remaining = None if self.end_time is None else max(0.0, self.end_time - asyncio.get_running_loop().time())
        return {"dist": dict(self.dist), "alive": sorted(self.alive),
                "connected": sorted(self.connected), "eliminated": list(self.out),
                "arrived": list(self.arrived), "start_distance": START_DIST,
                "remaining": remaining}

    async def set_state(self, state):
        self.state = state
        await self.broadcast({"type": "state", "data": {"state": state, **self.screen_state()}})

    async def on_motion(self, name, value):
        if not self.running or name not in self.alive:
            return
        self.motion[name] = value
        self.motion_time[name] = asyncio.get_running_loop().time()
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
