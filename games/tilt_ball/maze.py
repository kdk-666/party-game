"""기울여서 공 굴리기: 미로, 공 물리, 순위 계산 (화면/네트워크 없이 단독으로 테스트 가능).

물리 계산(가속, 마찰, 벽 충돌, 튕김)은 오픈소스 물리 엔진 Pymunk(MIT, Chipmunk2D 기반)가 한다.
미로 해석, 구멍/체크포인트/도착 판정, 순위 계산은 이 파일에서 직접 한다.

좌표 규칙: 한 칸의 크기가 1.0. x는 오른쪽, y는 아래쪽으로 커진다. (열 col, 행 row)
미로 글자: # 벽 / . 바닥 / O 구멍 / C 체크포인트 / S 시작 / G 도착
"""
import math
import random
from collections import deque

import pymunk

# ---- 게임 느낌을 정하는 값들 (조작감이 이상하면 여기만 고친다) ----
RADIUS = 0.3            # 공 반지름 (칸 기준)
ACCEL = 14.0            # 완전히 기울였을 때 가속도 (칸/초²)
FRICTION = 1.2          # 마찰: 클수록 빨리 멈춘다 (1초 뒤 속도가 exp(-FRICTION)배가 됨)
MAX_SPEED = 7.0         # 최대 속도 (칸/초)
BOUNCE = 0.25           # 벽에 부딪힐 때 튕기는 정도 (0이면 안 튕김)
HOLE_RADIUS = 0.4       # 구멍 한가운데에서 이 거리 안에 들어가면 빠진다
FALL_TIME = 0.8         # 빠진 뒤 체크포인트로 돌아가기까지 걸리는 시간(초)
SUBSTEP = 1 / 120       # 물리 계산 간격 (벽 뚫림 방지)
BALL_MASS = 1.0
COLLISION_SLOP = 0.005  # 벽에 살짝 겹치는 것을 허용하는 정도 (칸 단위라서 작게)
RANK_POINTS = [1000, 700, 500, 300]

MAZES = [
    {
        "name": "구불구불 길",
        "rows": [
            "###########",
            "#G........#",
            "#....O....#",
            "########..#",
            "#..O......#",
            "#....O..C.#",
            "#..########",
            "#.........#",
            "#...O.C...#",
            "########..#",
            "#...O.....#",
            "#.....O.C.#",
            "#..########",
            "#.........#",
            "#........S#",
            "###########",
        ],
    },
]


class Maze:
    def __init__(self, name, rows):
        widths = {len(r) for r in rows}
        if len(widths) != 1:
            raise ValueError("미로의 모든 줄 길이가 같아야 해요")
        self.name, self.rows = name, list(rows)
        self.width, self.height = len(rows[0]), len(rows)
        self.walls, self.holes, self.checkpoints = set(), set(), []
        self.start = self.goal = None
        for r, line in enumerate(rows):
            for c, ch in enumerate(line):
                if ch == "#":
                    self.walls.add((c, r))
                elif ch == "O":
                    self.holes.add((c, r))
                elif ch == "C":
                    self.checkpoints.append((c, r))
                elif ch == "S":
                    self.start = (c, r)
                elif ch == "G":
                    self.goal = (c, r)
                elif ch != ".":
                    raise ValueError("알 수 없는 글자: " + ch)
        if self.start is None or self.goal is None:
            raise ValueError("S(시작)와 G(도착)가 하나씩 필요해요")
        self.dist = self._goal_distances()
        self.start_dist = self.dist[self.start]

    def is_wall(self, c, r):
        return c < 0 or r < 0 or c >= self.width or r >= self.height or (c, r) in self.walls

    def _goal_distances(self, avoid_holes=False):
        """도착점에서 각 칸까지 걸어가야 하는 칸 수 (벽은 못 지나감)."""
        dist, q = {self.goal: 0}, deque([self.goal])
        while q:
            c, r = q.popleft()
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (c + dc, r + dr)
                if n in dist or self.is_wall(*n) or (avoid_holes and n in self.holes):
                    continue
                dist[n] = dist[(c, r)] + 1
                q.append(n)
        return dist

    def safe_path(self):
        """구멍을 피해 시작에서 도착까지 가는 칸 목록. 길이 없으면 None."""
        dist = self._goal_distances(avoid_holes=True)
        if self.start not in dist:
            return None
        path, cur = [self.start], self.start
        while cur != self.goal:
            cur = min(((cur[0] + dc, cur[1] + dr) for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))
                       if (cur[0] + dc, cur[1] + dr) in dist), key=lambda n: dist[n])
            path.append(cur)
        return path

    def wall_rects(self):
        """벽 칸들을 큰 직사각형 몇 개로 합친다 -> [(x0, y0, x1, y1)].
        칸마다 따로 상자를 만들면 이음새에 공이 걸리기 때문에 이어진 벽은 하나로 만든다."""
        rects, active = [], {}
        for r in range(self.height):
            runs, c = [], 0
            while c < self.width:
                if (c, r) in self.walls:
                    c0 = c
                    while c < self.width and (c, r) in self.walls:
                        c += 1
                    runs.append((c0, c))
                else:
                    c += 1
            new_active = {}
            for run in runs:
                if run in active:                       # 바로 윗줄과 같은 폭이면 위 직사각형을 늘린다
                    rect = active[run]
                    rect[3] = r + 1
                else:
                    rect = [run[0], r, run[1], r + 1]
                    rects.append(rect)
                new_active[run] = rect
            active = new_active
        return [tuple(r) for r in rects]

    def progress(self, x, y):
        """0(시작)~1(도착). 도착점까지 길을 따라 남은 거리로 계산한다."""
        d = self.dist.get((int(x), int(y)))
        if d is None:
            return 0.0
        return max(0.0, min(1.0, 1 - d / self.start_dist))


def _limit_speed(body, gravity, damping, dt):
    """Pymunk가 매 걸음 속도를 갱신할 때 불리는 함수: 기본 갱신 후 최대 속도를 넘지 않게 자른다."""
    pymunk.Body.update_velocity(body, gravity, damping, dt)
    speed = body.velocity.length
    if speed > MAX_SPEED:
        body.velocity = body.velocity * (MAX_SPEED / speed)


class Ball:
    def __init__(self, maze, space):
        self.body = pymunk.Body(BALL_MASS, pymunk.moment_for_circle(BALL_MASS, 0, RADIUS))
        self.body.position = (maze.start[0] + 0.5, maze.start[1] + 0.5)
        self.body.velocity_func = _limit_speed
        self.shape = pymunk.Circle(self.body, RADIUS)
        self.shape.elasticity = BOUNCE
        self.shape.friction = 0.0                        # 벽을 따라 미끄러지게
        self.shape.filter = pymunk.ShapeFilter(group=1)  # 같은 그룹끼리는 서로 통과한다
        space.add(self.body, self.shape)
        self.tilt = (0.0, 0.0)
        self.state = "rolling"            # rolling / fallen / finished
        self.fall_timer = 0.0
        self.checkpoint = maze.start      # 구멍에 빠지면 돌아올 곳 (가장 앞선 체크포인트)
        self.reached = set()              # 한 번이라도 밟은 체크포인트 (깃발이 노란색이 된다)
        self.cp_saves = 0                 # 체크포인트가 저장된 횟수 ("체크포인트 저장!" 메시지용)
        self.best_progress = 0.0
        self.finish_time = None
        self.falls = 0

    x = property(lambda self: self.body.position.x)
    y = property(lambda self: self.body.position.y)
    vx = property(lambda self: self.body.velocity.x)
    vy = property(lambda self: self.body.velocity.y)

    def place(self, x, y):
        """공을 (x, y)에 세우고 멈춘다."""
        self.body.position = (x, y)
        self.body.velocity = (0.0, 0.0)
        self.body.force = (0.0, 0.0)


class TiltWorld:
    def __init__(self, maze, names, time_limit=60.0):
        self.maze = maze
        self.space = pymunk.Space()
        self.space.damping = math.exp(-FRICTION)
        self.space.collision_slop = COLLISION_SLOP
        for x0, y0, x1, y1 in maze.wall_rects():
            wall = pymunk.Poly(self.space.static_body, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
            wall.elasticity = 1.0                        # 부딪힘 정도는 공 쪽 BOUNCE로 정해진다
            wall.friction = 0.0
            self.space.add(wall)
        self.balls = {n: Ball(maze, self.space) for n in names}
        self.time_limit = time_limit
        self.time = 0.0

    def remove_ball(self, name):
        """참가자가 나갔을 때 그 공을 치운다 (순위와 종료 판정에서 빠진다)."""
        b = self.balls.pop(name, None)
        if b is not None:
            self.space.remove(b.body, b.shape)

    # ----- 입력 -----
    def set_tilt(self, name, tx, ty):
        """tx: 오른쪽으로 기울임(+), ty: 아래쪽(몸쪽)으로 기울임(+). 범위는 -1~1."""
        b = self.balls.get(name)
        if b is None:
            return
        try:
            tx, ty = float(tx), float(ty)
        except (TypeError, ValueError):
            return                                  # 숫자가 아니면 무시
        if not (math.isfinite(tx) and math.isfinite(ty)):
            return                                  # 이상한 값은 무시
        b.tilt = (max(-1.0, min(1.0, tx)), max(-1.0, min(1.0, ty)))

    # ----- 진행 -----
    def step(self, dt):
        n = max(1, math.ceil(dt / SUBSTEP))
        h = dt / n
        for _ in range(n):
            if self.finished:
                break
            self.time += h
            for b in self.balls.values():                # 1) 기울기를 힘으로 바꿔 준다
                if b.state == "rolling":
                    b.body.force = (b.tilt[0] * ACCEL * BALL_MASS, b.tilt[1] * ACCEL * BALL_MASS)
            self.space.step(h)                           # 2) Pymunk가 이동과 충돌을 계산
            for b in self.balls.values():                # 3) 구멍, 체크포인트, 도착을 확인
                self._after_physics(b, h)

    def _after_physics(self, b, h):
        if b.state == "finished":
            return
        if b.state == "fallen":
            b.fall_timer -= h
            if b.fall_timer <= 0:
                b.place(b.checkpoint[0] + 0.5, b.checkpoint[1] + 0.5)
                b.state = "rolling"
            return
        m = self.maze
        x, y = b.x, b.y
        b.best_progress = max(b.best_progress, m.progress(x, y))
        for hc, hr in m.holes:                       # 구멍에 빠졌나?
            if abs(x - (hc + 0.5)) < 1 and abs(y - (hr + 0.5)) < 1 and \
                    math.hypot(x - (hc + 0.5), y - (hr + 0.5)) < HOLE_RADIUS:
                b.state, b.fall_timer = "fallen", FALL_TIME
                b.place(hc + 0.5, hr + 0.5)
                b.falls += 1
                return
        cell = (int(x), int(y))
        for cp in m.checkpoints:                     # 체크포인트를 밟았나?
            if cell == cp and cp not in b.reached:
                b.reached.add(cp)                    # 깃발이 노란색이 된다
                if m.dist[cp] < m.dist[b.checkpoint]:    # 지금까지 것보다 앞선 곳일 때만 저장
                    b.checkpoint = cp
                    b.cp_saves += 1
        if cell == m.goal:
            b.state, b.finish_time = "finished", self.time
            b.best_progress = 1.0
            b.place(x, y)

    @property
    def finished(self):
        """모두 도착했거나 제한시간이 끝나면 True."""
        return self.time >= self.time_limit or all(b.state == "finished" for b in self.balls.values())

    # ----- 결과 -----
    def ranking(self):
        """도착한 사람(빠른 순) -> 못 도착한 사람(가장 멀리 간 순)."""
        done = sorted((n for n, b in self.balls.items() if b.finish_time is not None),
                      key=lambda n: self.balls[n].finish_time)
        rest = sorted((n for n, b in self.balls.items() if b.finish_time is None),
                      key=lambda n: (-self.balls[n].best_progress, n))
        return done + rest

    def scores(self):
        out = {}
        for i, n in enumerate(self.ranking()):
            out[n] = RANK_POINTS[i] if i < len(RANK_POINTS) else 100
        return out

    def snapshot(self):
        """화면에 보낼 현재 상태 (숫자는 작게 반올림)."""
        return {n: {"x": round(b.x, 3), "y": round(b.y, 3),
                    "vx": round(b.vx, 2), "vy": round(b.vy, 2), "state": b.state,
                    "progress": round(b.best_progress, 3), "falls": b.falls,
                    "finish_time": None if b.finish_time is None else round(b.finish_time, 2),
                    "reached": sorted([c, r] for c, r in b.reached), "cp_saves": b.cp_saves}
                for n, b in self.balls.items()}


def pick_maze(rng=random):
    m = rng.choice(MAZES)
    return Maze(m["name"], m["rows"])
