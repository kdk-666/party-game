"""몬스터 추격: 위치, 길찾기, 충돌과 점수는 서버가 관리한다."""
import asyncio
import math
import random
from collections import deque

from pathfinding.core.grid import Grid
from pathfinding.finder.a_star import AStarFinder

# 비교할 수 있도록 기존 맵도 보존한다. 현재는 정원 미로 시험 맵을 사용한다.
ORIGINAL_MAP = (
    '###############',
    '#.............#',
    '#..##.....##..#',
    '#..##.....##..#',
    '#.............#',
    '#.....###.....#',
    '#.............#',
    '#..#.......#..#',
    '#.............#',
    '#.....###.....#',
    '#.............#',
    '#..##.....##..#',
    '#..##.....##..#',
    '#.............#',
    '###############',
)
GARDEN_MAP = (
    '###############',
    '#......#......#',
    '#..##..#..##..#',
    '#..##..#..##..#',
    '#...#.....#...#',
    '#.....###.....#',
    '#.##.......##.#',
    '#..#.......#..#',
    '#.#..#...#..#.#',
    '#.....###.....#',
    '#...#.....#...#',
    '#..##..#..##..#',
    '#..##..#..##..#',
    '#......#......#',
    '###############',
)
PARK_MAP = (
    '###############', '#.............#', '#...#.....#...#', '#.###.....###.#',
    '#.............#', '#..#..###..#..#', '#..#.......#..#', '#.............#',
    '#..#.......#..#', '#..#..###..#..#', '#.............#', '#.###.....###.#',
    '#...#.....#...#', '#.............#', '###############',
)
MAPS = (('정원 미로', GARDEN_MAP), ('넓은 산책로', ORIGINAL_MAP), ('공원 갈림길', PARK_MAP))
MAP = GARDEN_MAP  # 기존 유틸리티의 기본 맵
STARTS = [(1.5, 1.5), (13.5, 1.5), (1.5, 13.5), (13.5, 13.5)]
CENTER_STARTS = [(6.5, 7.5), (7.5, 7.5), (8.5, 7.5)]
INITIAL_CHASE_SECONDS = 5.0
CENTER_RELEASE_SECONDS = 2.0
DEATH_ANIMATION_SECONDS = 0.8  # 마지막 탈락 연출이 보인 뒤 결과로 넘어간다.
_last_map = None
TICK = 0.1
TIME_LIMIT = 60.0
PLAYER_SPEED = 2.6
MONSTER_SPEED = 1.55
INPUT_TIMEOUT = 0.45
ZOMBIE_SEPARATION = 0.75  # 너무 가까운 좀비끼리만 약하게 떨어뜨린다.
FLANK_DISTANCE = 1.3
MIN_PLAYER_SPAWN_DISTANCE = 4.0
MIN_ZOMBIE_SPAWN_DISTANCE = 1.5
BLACKOUT_START = 5.0
BLACKOUT_WARNING = 2.0


def walkable(x, y, rows=MAP):
    return 0 <= x < len(rows[0]) and 0 <= y < len(rows) and rows[int(y)][int(x)] != '#'


def blackout_phase(elapsed):
    # 5초 동안은 길을 보여주고, 그 뒤 경기 종료까지 계속 손전등 시야를 사용한다.
    if elapsed >= BLACKOUT_START:
        return 'blackout'
    if 0 < BLACKOUT_START - elapsed <= BLACKOUT_WARNING:
        return 'warning'
    return 'normal'


def zombie_count(player_count):
    # 한 판 시작 시 연결된 참가자 기준. 중간에 탈락해도 수는 바뀌지 않는다.
    if not 1 <= player_count <= 4:
        raise ValueError('참가자 수는 1명에서 4명이어야 합니다.')
    return 5 + 2 * (player_count - 1)


def spawn_zombies(player_positions, rows=MAP):
    # 각 참가자에게 두 마리씩 할당한다. 실제 미로의 최단거리로 가까운 안전 위치를 고른다.
    players = list(player_positions)
    candidates = [(x + 0.5, y + 0.5) for y, row in enumerate(rows) for x, cell in enumerate(row) if cell == '.']
    chosen = []
    for player in players:
        start = (int(player[0]), int(player[1]))
        distances = {start: 0}
        first_step = {start: None}
        first_branch = None
        queue = deque([start])
        while queue:
            x, y = queue.popleft()
            for nx, ny in ((x-1,y), (x+1,y), (x,y-1), (x,y+1)):
                if (nx, ny) not in distances and walkable(nx + .5, ny + .5, rows):
                    distances[(nx, ny)] = distances[(x, y)] + 1
                    first_step[(nx, ny)] = (nx, ny) if (x, y) == start else first_step[(x, y)]
                    queue.append((nx, ny))
        for _ in range(2):
            available = [p for p in candidates if (int(p[0]), int(p[1])) in distances
                         and all(math.dist(p, q) >= MIN_PLAYER_SPAWN_DISTANCE for q in players)
                         and math.dist(p, player) <= min(math.dist(p, q) for q in players) + 1e-6
                         and all(math.dist(p, q) >= MIN_ZOMBIE_SPAWN_DISTANCE for q in chosen)
                         and all(math.dist(p, q) >= MIN_ZOMBIE_SPAWN_DISTANCE for q in CENTER_STARTS)]
            # 구석의 두 출구를 동시에 막을 가능성을 줄이도록 첫 좀비와 같은 방향을 우선한다.
            if first_branch is not None:
                bx, by = first_branch[0] - start[0], first_branch[1] - start[1]
                same_side = [p for p in available if (p[0] - player[0]) * bx + (p[1] - player[1]) * by > abs((p[0] - player[0]) * by - (p[1] - player[1]) * bx)]
                if same_side:
                    available = same_side
            if not available:
                raise ValueError('참가자 주변에 안전한 좀비 시작 위치가 부족합니다.')
            selected = min(available, key=lambda p: (distances[(int(p[0]), int(p[1]))], math.dist(p, player), p[1], p[0]))
            chosen.append(selected)
            first_branch = first_step[(int(selected[0]), int(selected[1]))]
    # 중앙 세 마리는 서로 겹치지 않는 인접 칸에서 대기한다.
    if any(not walkable(*p, rows) for p in CENTER_STARTS):
        raise ValueError('중앙 좀비 시작 위치가 막혀 있습니다.')
    return [list(p) for p in chosen + CENTER_STARTS]


def path_updates_for_tick(count, tick):
    # 5틱(0.5초)에 모든 좀비가 한 번 갱신되도록 계산을 여러 틱으로 나눈다.
    return {i % count for i in range(tick * count // 5, (tick + 1) * count // 5)}


def move(pos, dx, dy, rows=MAP):
    x, y = pos
    # 반지름만큼 여유를 두어 벽 모서리에 끼지 않도록 한다.
    for axis, delta in ((0, dx), (1, dy)):
        nx, ny = (x + delta, y) if axis == 0 else (x, y + delta)
        if all(walkable(nx + ox, ny + oy, rows) for ox in (-0.2, 0.2) for oy in (-0.2, 0.2)):
            x, y = nx, ny
    return [x, y]


class MonsterEscape:
    def __init__(self, names, broadcast, map_name=None):
        global _last_map
        if map_name is not None:
            selected = next((item for item in MAPS if item[0] == map_name), None)
            if selected is None:
                raise ValueError('알 수 없는 맵입니다.')
        else:
            selected = random.choice([item for item in MAPS if item[0] != _last_map] or list(MAPS))
        self.map_name, self.map = selected
        _last_map = self.map_name
        self.names = list(names)
        self.connected = set(names)
        self.alive = set(names)
        self.positions = {name: list(STARTS[i % len(STARTS)]) for i, name in enumerate(names)}
        self.inputs = {name: (0.0, 0.0, 0.0) for name in names}
        self.facing = {name: (0.0, -1.0) for name in names}
        zombie_count(len(self.names))  # 인원 검증
        self.monsters = spawn_zombies(self.positions.values(), self.map)
        self.paths = [[] for _ in self.monsters]
        self.initial_targets = [name for name in self.names for _ in range(2)] + [None] * 3
        self.targets = list(self.initial_targets)
        self.death_time = {}
        self.broadcast = broadcast
        self.running = False
        self.phase = 'waiting'
        self.elapsed = 0.0
        self.grid = Grid(matrix=[[int(cell != '#') for cell in row] for row in self.map])
        self.finder = AStarFinder()

    async def run(self):
        self.running = True
        self.phase = 'countdown'
        await self.broadcast({'type': 'countdown', 'data': {}})
        await self.broadcast({'type': 'me_intro', 'data': {'map': self.map, 'map_name': self.map_name}})
        await asyncio.sleep(3)
        self.phase = 'playing'
        loop = asyncio.get_running_loop()
        last = loop.time()
        tick = 0
        try:
            while self.connected and self.elapsed < TIME_LIMIT:
                await asyncio.sleep(TICK)
                now = loop.time()
                dt = min(now - last, 0.2)
                last = now
                self.elapsed += dt
                alive_before = set(self.alive)
                self.step(dt, now, tick)
                tick += 1
                await self.broadcast({'type': 'me_state', 'data': self.snapshot()})
                if not self.alive or (len(self.names) > 1 and len(self.alive) <= 1):
                    # 마지막 상태를 먼저 전송해 모든 화면에서 쓰러짐이 보이게 한다.
                    if alive_before - self.alive and self.connected:
                        await asyncio.sleep(DEATH_ANIMATION_SECONDS)
                    break
            self.phase = 'over'
            if not self.connected:
                await self.broadcast({'type': 'game_cancelled', 'data': {}})
                return None
            result = self.result()
            await self.broadcast({'type': 'me_over', 'data': result})
            return result
        finally:
            self.running = False
            self.phase = 'over'

    def choose_target(self, index):
        # 거리뿐 아니라 이미 해당 참가자를 쫓는 좀비 수도 고려한다.
        monster = self.monsters[index]
        return min(sorted(self.alive), key=lambda n: math.dist(monster, self.positions[n]) +
                   2.5 * sum(t == n for i, t in enumerate(self.targets) if i != index))

    def pursuit_point(self, index, name, now):
        player = self.positions[name]
        dx, dy, timestamp = self.inputs[name]
        if index % 3 == 0 or now - timestamp > INPUT_TIMEOUT or math.hypot(dx, dy) < 0.15:
            return player
        if math.dist(self.monsters[index], player) < 2.0:
            return player
        # 일부 좀비는 움직이는 참가자의 진행 방향 양쪽을 노린다.
        side = 1 if index % 3 == 1 else -1
        x = player[0] + dx * 0.7 - dy * FLANK_DISTANCE * side
        y = player[1] + dy * 0.7 + dx * FLANK_DISTANCE * side
        if walkable(x, y, self.map):
            return [x, y]
        return player

    def step(self, dt, now, tick):
        for name in list(self.alive):
            dx, dy, timestamp = self.inputs[name]
            if now - timestamp > INPUT_TIMEOUT:
                dx = dy = 0
            self.positions[name] = move(self.positions[name], dx * PLAYER_SPEED * dt, dy * PLAYER_SPEED * dt, self.map)
        if not self.alive:
            return
        updates = path_updates_for_tick(len(self.monsters), tick)
        for i, monster in enumerate(self.monsters):
            is_center = i >= len(self.initial_targets) - 3
            if is_center and self.elapsed < CENTER_RELEASE_SECONDS:
                continue
            # 중앙 좀비는 2초가 되는 첫 틱에 길을 찾아 즉시 출발한다.
            if i in updates or (is_center and not self.paths[i]):
                assigned = self.initial_targets[i]
                target = assigned if self.elapsed < INITIAL_CHASE_SECONDS and assigned in self.alive else self.choose_target(i)
                self.targets[i] = target
                destination = self.pursuit_point(i, target, now)
                start = self.grid.node(int(monster[0]), int(monster[1]))
                end = self.grid.node(int(destination[0]), int(destination[1]))
                self.grid.cleanup()
                path, _ = self.finder.find_path(start, end, self.grid)
                self.paths[i] = [[node.x + 0.5, node.y + 0.5] for node in path[1:]]
                if len(path) == 1:
                    self.paths[i] = [list(destination)]
            if self.paths[i]:
                target = self.paths[i][0]
                dx, dy = target[0] - monster[0], target[1] - monster[1]
                distance = math.hypot(dx, dy)
                if distance:
                    amount = min(distance, MONSTER_SPEED * dt)
                    vx, vy = dx / distance, dy / distance
                    # 좁은 곳에서는 겹칠 수 있지만, 가까이 붙으면 옆으로 분산한다.
                    for j, other in enumerate(self.monsters):
                        if i == j:
                            continue
                        ox, oy = monster[0] - other[0], monster[1] - other[1]
                        gap = math.hypot(ox, oy)
                        if 0 < gap < ZOMBIE_SEPARATION:
                            weight = 0.65 * (ZOMBIE_SEPARATION - gap) / ZOMBIE_SEPARATION
                            vx += ox / gap * weight
                            vy += oy / gap * weight
                    length = math.hypot(vx, vy)
                    if length:
                        self.monsters[i] = move(monster, vx / length * amount, vy / length * amount, self.map)
                if math.dist(self.monsters[i], target) < 0.06:
                    self.paths[i].pop(0)
        for name in list(self.alive):
            if any(math.dist(self.positions[name], m) < 0.55 for m in self.monsters):
                self.alive.remove(name)
                self.death_time[name] = self.elapsed

    def snapshot(self):
        return {'map': self.map, 'map_name': self.map_name, 'remaining': max(0, TIME_LIMIT - self.elapsed),
                'reinforcements_in': max(0, CENTER_RELEASE_SECONDS - self.elapsed),
                'lighting': blackout_phase(self.elapsed),
                'players': {n: {'x': p[0], 'y': p[1], 'alive': n in self.alive, 'connected': n in self.connected,
                                'facing': self.facing[n]} for n, p in self.positions.items()},
                'monsters': self.monsters}

    def result(self):
        names = [n for n in self.names if n in self.connected]
        survived = {n: self.death_time.get(n, self.elapsed) for n in names}
        ranking = sorted(names, key=lambda n: survived[n], reverse=True)
        # 같은 틱의 탈락이나 생존자에게는 같은 점수를 준다.
        points = [1000, 700, 500, 300]
        scores = {n: points[min(sum(survived[other] > survived[n] for other in names), 3)] for n in names}
        winners = [n for n in ranking if n in self.alive]
        return {'winner': winners[0] if winners else None, 'winners': winners, 'ranking': ranking, 'scores': scores}

    async def on_message(self, name, kind, data):
        if kind != 'me_move' or self.phase != 'playing' or name not in self.alive or not isinstance(data, dict):
            return
        x, y = data.get('x'), data.get('y')
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (x, y)):
            return
        length = math.hypot(x, y)
        scale = max(1.0, length)
        self.inputs[name] = (x / scale, y / scale, asyncio.get_running_loop().time())
        if length >= 0.15:
            self.facing[name] = (x / length, y / length)

    async def on_motion(self, name, value):
        pass

    async def remove_player(self, name):
        self.connected.discard(name)
        self.alive.discard(name)
        self.targets = [None if target == name else target for target in self.targets]
