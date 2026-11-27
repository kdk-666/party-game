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
    '#..#.......#..#', '#..#..###..#..#', '#.............#', '#.#.#.....###.#',
    '#...#.....#...#', '#.............#', '###############',
)
LUMBERYARD_MAP = (
    '###############',
    '#.............#',
    '#.###.....###.#',
    '#.###.....###.#',
    '#.............#',
    '#.#...#.#...#.#',
    '#.#...#.#...#.#',
    '#.............#',
    '#..##.....##..#',
    '#......#......#',
    '#.##...#...##.#',
    '#.##.......##.#',
    '#....##.##....#',
    '#.............#',
    '###############',
)
# 별도 설계: 두꺼운 화물 더미 사이에 한 칸 점프 통로를 배치한다.
WAREHOUSE_LARGE_MAPS = {
    3: (
        '#################',
        '#...............#',
        '#.###.......###.#',
        '#.#.........###.#',
        '#...............#',
        '#.#...#...#...#.#',
        '#.#...#...#...#.#',
        '#.......#.......#',
        '#..###.....###..#',
        '#...............#',
        '#..##.......##..#',
        '#......###......#',
        '#.##.........##.#',
        '#.##..........#.#',
        '#....##...##....#',
        '#...............#',
        '#################',
    ),
    4: (
        '###################',
        '#.................#',
        '#.###.........###.#',
        '#.#.............#.#',
        '#.................#',
        '#.#...#.....#...#.#',
        '#.#...#.....#...#.#',
        '#........#........#',
        '#..###.......###..#',
        '#.......###.......#',
        '#..###.......###..#',
        '#........#........#',
        '#..##.........##..#',
        '#......#####......#',
        '#.##...........##.#',
        '#.#.............#.#',
        '#....##.....##....#',
        '#.................#',
        '###################',
    ),
}
MAPS = (('정원 미로', GARDEN_MAP), ('버려진 물류창고', LUMBERYARD_MAP), ('공원 갈림길', PARK_MAP))
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
CROWD_PATH_STEPS = 4  # 다른 좀비가 곧 지나갈 칸만 고려한다.
CROWD_PATH_COST = 1.5  # 점유 경로는 막지 않고 비용만 높인다.
FLANK_DISTANCE = 1.3
INTERCEPT_START_SECONDS = 5.0  # 초반 적응 시간이 지난 뒤 예측 추격을 시작한다.
INTERCEPT_LOOKAHEAD_SECONDS = 0.8
MIN_PLAYER_SPAWN_DISTANCE = 4.0  # 전체 좀비의 기존 최소 안전 거리
ASSIGNED_MIN_PLAYER_SPAWN_DISTANCE = 8.0  # 참가자별 배정 좀비는 시야 밖에서 시작
MIN_ZOMBIE_SPAWN_DISTANCE = 1.5
BLACKOUT_ENABLED = False  # 추격 테스트 중 임시 해제. True로 바꾸면 기존 정전이 돌아온다.
BLACKOUT_START = 5.0
BLACKOUT_WARNING = 2.0
JUMP_LIMIT = 3
JUMP_DURATION = 0.45  # 점프 중만 좀비 충돌을 피하고 착지 즉시 다시 판정한다.
JUMP_WALL_DISTANCE = 0.65  # 캐릭터 중심에서 벽까지 허용되는 최대 거리


def walkable(x, y, rows=MAP):
    return 0 <= x < len(rows[0]) and 0 <= y < len(rows) and rows[int(y)][int(x)] != '#'


def expand_map(rows, player_count):
    # 기존 맵을 유지하면서 중앙의 길을 넓힌다: 3명 17칸, 4명 19칸.
    extra = max(0, player_count - 2) * 2
    if not extra:
        return rows
    if rows == LUMBERYARD_MAP:
        return WAREHOUSE_LARGE_MAPS[player_count]
    center_x, center_y = len(rows[0]) // 2, len(rows) // 2
    widened = tuple(row[:center_x] + row[center_x] * extra + row[center_x:] for row in rows)
    return widened[:center_y] + (widened[center_y],) * extra + widened[center_y:]


def starting_positions(rows):
    right, bottom = len(rows[0]) - 1.5, len(rows) - 1.5
    return [(1.5, 1.5), (right, 1.5), (1.5, bottom), (right, bottom)]


def center_zombie_positions(rows):
    x, y = len(rows[0]) // 2 + .5, len(rows) // 2 + .5
    return [(x - 1, y), (x, y), (x + 1, y)]


def blackout_phase(elapsed):
    if not BLACKOUT_ENABLED:
        return 'normal'
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


def spawn_layout(rows, count):
    floor = {(x, y) for y, row in enumerate(rows) for x, cell in enumerate(row) if cell == '.'}
    def neighbors(p):
        x, y = p
        return [(a, b) for a, b in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)) if (a,b) in floor]
    candidates = sorted(p for p in floor if len(neighbors(p)) >= 3)
    for attempt in range(500):
        # 넓게 분산하되 좀비 안전거리 확보가 우선이다.
        target = {1: 4, 2: 7, 3: 8, 4: 9}[count]
        spacing = target if attempt < 150 else max(4, target - 1 - (attempt - 150) // 70)
        players = []
        pool = candidates[:]
        random.shuffle(pool)
        for p in pool:
            if all(math.dist(p,q) >= spacing for q in players):
                players.append(p)
                if len(players) == count:
                    break
        if len(players) != count:
            continue
        distances = []
        for p in players:
            d = {p: 0}
            queue = deque([p])
            while queue:
                q = queue.popleft()
                for n in neighbors(q):
                    if n not in d:
                        d[n] = d[q] + 1
                        queue.append(n)
            distances.append(d)
        safe = [p for p in sorted(floor) if all(math.dist(p,q) >= MIN_PLAYER_SPAWN_DISTANCE and d.get(p,-1) >= 5 for q,d in zip(players,distances))]
        chosen = []
        for i in range(2*count+3):
            assigned = i < 2*count
            available = [p for p in safe if all(math.dist(p,q) >= MIN_ZOMBIE_SPAWN_DISTANCE for q in chosen)]
            if assigned:
                available = [p for p in available if all(math.dist(p,q) >= ASSIGNED_MIN_PLAYER_SPAWN_DISTANCE for q in players)]
            if not available:
                break
            chosen.append(random.choice(available))
        if len(chosen) == 2*count+3:
            return [[x+.5,y+.5] for x,y in players], [[x+.5,y+.5] for x,y in chosen]
    raise ValueError('안전한 시작 위치를 찾지 못했습니다.')


def jump_destination(pos, facing, rows):
    """가까운 한 칸 두께의 벽만, 착지 가능한 곳으로 넘어간다."""
    x, y = pos
    cell_x, cell_y = int(x), int(y)
    if not walkable(x, y, rows):
        return None
    fx, fy = facing
    if abs(fx) >= abs(fy):
        dx, dy = (1 if fx > 0 else -1), 0
        distance = cell_x + 1 - x if dx > 0 else x - cell_x
    else:
        dx, dy = 0, (1 if fy > 0 else -1)
        distance = cell_y + 1 - y if dy > 0 else y - cell_y
    wx, wy = cell_x + dx, cell_y + dy
    # 바깥 테두리를 넘거나 두꺼운 벽에 착지하는 일은 허용하지 않는다.
    if distance > JUMP_WALL_DISTANCE or not (0 < wx < len(rows[0]) - 1 and 0 < wy < len(rows) - 1):
        return None
    if rows[wy][wx] != '#':
        return None
    tx, ty = wx + dx, wy + dy
    target = [tx + .5 if dx else x, ty + .5 if dy else y]
    if not all(walkable(target[0] + ox, target[1] + oy, rows) for ox in (-.2, .2) for oy in (-.2, .2)):
        return None
    return target


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
        self.map_name, original_map = selected
        _last_map = self.map_name
        self.names = list(names)
        self.virtual_players = set()
        self.bot_next = {}
        self.bot_recent = {}
        zombie_count(len(self.names))  # 크기 조정 전 참가 인원을 검증한다.
        self.map = expand_map(original_map, len(self.names))
        self.connected = set(self.names)
        self.alive = set(self.names)
        starts, self.monsters = spawn_layout(self.map, len(self.names))
        self.positions = {name: list(starts[i]) for i, name in enumerate(self.names)}
        self.inputs = {name: (0.0, 0.0, 0.0) for name in names}
        self.facing = {name: (0.0, -1.0) for name in names}
        self.jumps_left = {name: JUMP_LIMIT for name in self.names}
        self.jumping = {}  # 출발점·착지점과 진행 시간은 서버에서 관리한다.
        # 추가 좀비 중 소수만 예측한다. 1~2명일 때 1마리, 3~4명일 때 2마리.
        first_center = len(self.monsters) - len(CENTER_STARTS)
        interceptor_count = 1 + (len(self.names) >= 3)
        self.interceptors = set(range(first_center, first_center + interceptor_count))
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
                ending = not self.alive or (len(self.names) > 1 and len(self.alive) <= 1)
                state = self.snapshot()
                if ending:
                    state['ending'] = 'last_survivor' if self.alive else 'all_eliminated'
                elif self.elapsed >= TIME_LIMIT:
                    state['ending'] = 'time_limit'
                if state.get('ending'):
                    self.phase = 'finishing'  # 결과가 확정된 뒤의 입력은 받지 않는다.
                await self.broadcast({'type': 'me_state', 'data': state})
                if ending:
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

    def predicted_position(self, name, now):
        player = self.positions[name]
        dx, dy, timestamp = self.inputs[name]
        if self.elapsed < INTERCEPT_START_SECONDS or now - timestamp > INPUT_TIMEOUT or math.hypot(dx, dy) < 0.15:
            return list(player)
        # 실제 플레이어 이동과 같은 충돌 규칙으로 짧게 시뮬레이션한다.
        # 매 틱 검사하여 벽 너머 지점을 목표로 삼지 않는다.
        predicted = list(player)
        steps = round(INTERCEPT_LOOKAHEAD_SECONDS / TICK)
        for _ in range(steps):
            next_position = move(predicted, dx * PLAYER_SPEED * TICK, dy * PLAYER_SPEED * TICK, self.map)
            if math.dist(predicted, next_position) < 1e-9:
                break
            predicted = next_position
        return predicted

    def pursuit_point(self, index, name, now):
        player = self.positions[name]
        dx, dy, timestamp = self.inputs[name]
        if index in self.interceptors:
            # 지나치게 근접한 경우 예측 지점을 지나치지 않고 직접 추격한다.
            if math.dist(self.monsters[index], player) < 2.0:
                return player
            return self.predicted_position(name, now)
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

    def find_spread_path(self, index, start, end):
        # 같은 길을 따라 늘어서는 것을 줄이되, 좁은 통로는 계속 이용할 수 있게 한다.
        # 초기 5초에는 기존 시작 방향과 공정성을 그대로 유지한다.
        counts = {}
        if self.elapsed >= INITIAL_CHASE_SECONDS:
            for other_index, other in enumerate(self.monsters):
                if other_index == index:
                    continue
                cells = {(int(other[0]), int(other[1]))}
                cells.update((int(p[0]), int(p[1])) for p in self.paths[other_index][:CROWD_PATH_STEPS])
                for cell in cells:
                    counts[cell] = counts.get(cell, 0) + 1
        changed = []
        self.grid.cleanup()
        try:
            for (x, y), count in counts.items():
                if not walkable(x + .5, y + .5, self.map) or (x, y) == (end.x, end.y):
                    continue
                node = self.grid.node(x, y)
                changed.append((node, node.weight))
                node.weight += CROWD_PATH_COST * min(count, 3)
            path, _ = self.finder.find_path(start, end, self.grid)
            return path
        finally:
            # 이 좀비만의 비용을 다른 탐색에 남기지 않는다.
            for node, old_weight in changed:
                node.weight = old_weight

    def update_virtual_players(self, now):
        # 같은 이동/점프 판정을 사용하고, 판단은 약 0.4초마다 갱신한다.
        for name in sorted(self.virtual_players & self.alive & self.connected):
            if name in self.jumping or now < self.bot_next.get(name, 0):
                continue
            self.bot_next[name] = now + random.uniform(.32, .48)
            pos = self.positions[name]
            nearby = [m for m in self.monsters if math.dist(pos, m) <= 6]
            danger = min((math.dist(pos, m) for m in nearby), default=6)
            recent = self.bot_recent.setdefault(name, deque(maxlen=8))
            recent.append(tuple(map(int, pos)))
            choices = []
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                length = math.hypot(dx, dy)
                dx, dy = dx / length, dy / length
                end = list(pos)
                for _ in range(6):
                    end = move(end, dx * PLAYER_SPEED * TICK, dy * PLAYER_SPEED * TICK, self.map)
                if math.dist(pos, end) < .2:
                    continue
                safety = min((math.dist(end, m) for m in nearby), default=6)
                exits = sum(walkable(end[0]+x, end[1]+y, self.map) for x,y in ((1,0),(-1,0),(0,1),(0,-1)))
                score = safety + .22 * exits + .3 * math.dist(pos,end) - .35 * recent.count(tuple(map(int,end)))
                choices.append((score + random.uniform(0,.18), dx, dy))
            if danger < 2.6 and self.jumps_left[name] > 0:
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    target = jump_destination(pos, (dx,dy), self.map)
                    if target is not None and min((math.dist(target,m) for m in nearby), default=6) > max(1.8,danger+.7):
                        self.facing[name] = (dx,dy)
                        self.inputs[name] = (0,0,now)
                        self.try_jump(name)
                        break
                if name in self.jumping:
                    continue
            if choices:
                _, dx, dy = max(choices)
                self.inputs[name] = (dx,dy,now)
                self.facing[name] = (dx,dy)
            else:
                self.inputs[name] = (0,0,now)

    def step(self, dt, now, tick):
        self.update_virtual_players(now)
        for name in list(self.alive):
            jump = self.jumping.get(name)
            if jump is not None:
                jump['elapsed'] = min(JUMP_DURATION, jump['elapsed'] + dt)
                if jump['elapsed'] >= JUMP_DURATION:
                    self.positions[name] = list(jump['target'])
                    del self.jumping[name]
                continue
            dx, dy, timestamp = self.inputs[name]
            if now - timestamp > INPUT_TIMEOUT:
                dx = dy = 0
            self.positions[name] = move(self.positions[name], dx * PLAYER_SPEED * dt, dy * PLAYER_SPEED * dt, self.map)
        if not self.alive:
            return
        if self.elapsed < CENTER_RELEASE_SECONDS:
            return
        updates = path_updates_for_tick(len(self.monsters), tick)
        for i, monster in enumerate(self.monsters):
            # 모든 좀비는 준비 시간이 끝나면 즉시 길을 찾는다.
            if i in updates or not self.paths[i]:
                assigned = self.initial_targets[i]
                target = assigned if self.elapsed < INITIAL_CHASE_SECONDS and assigned in self.alive else self.choose_target(i)
                self.targets[i] = target
                destination = self.pursuit_point(i, target, now)
                start = self.grid.node(int(monster[0]), int(monster[1]))
                end = self.grid.node(int(destination[0]), int(destination[1]))
                path = self.find_spread_path(i, start, end)
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
                        if gap < ZOMBIE_SEPARATION:
                            if gap < 1e-9:
                                # 완전히 겹친 좌표에서도 서로 반대쪽으로 분산한다.
                                a, b = sorted((i, j))
                                angle = (a * len(self.monsters) + b) * 2.3999632297
                                sign = 1 if i == a else -1
                                nx, ny = math.cos(angle) * sign, math.sin(angle) * sign
                            else:
                                nx, ny = ox / gap, oy / gap
                            weight = 0.65 * (ZOMBIE_SEPARATION - gap) / ZOMBIE_SEPARATION
                            vx += nx * weight
                            vy += ny * weight
                    length = math.hypot(vx, vy)
                    if length:
                        self.monsters[i] = move(monster, vx / length * amount, vy / length * amount, self.map)
                if math.dist(self.monsters[i], target) < 0.06:
                    self.paths[i].pop(0)
        for name in list(self.alive):
            if name not in self.jumping and any(math.dist(self.positions[name], m) < 0.55 for m in self.monsters):
                self.alive.remove(name)
                self.death_time[name] = self.elapsed

    def snapshot(self):
        players = {}
        for name, pos in self.positions.items():
            jump = self.jumping.get(name)
            progress = jump['elapsed'] / JUMP_DURATION if jump else None
            shown = [a + (b - a) * progress for a, b in zip(jump['start'], jump['target'])] if jump else pos
            players[name] = {'x': shown[0], 'y': shown[1], 'alive': name in self.alive,
                             'connected': name in self.connected, 'facing': self.facing[name],
                             'jumps_left': self.jumps_left[name], 'jump': {'progress': progress} if jump else None}
        return {'map': self.map, 'map_name': self.map_name, 'remaining': max(0, TIME_LIMIT - self.elapsed),
                'reinforcements_in': max(0, CENTER_RELEASE_SECONDS - self.elapsed),
                'lighting': blackout_phase(self.elapsed), 'players': players, 'monsters': self.monsters}

    def result(self):
        names = [n for n in self.names if n in self.connected]
        survived = {n: self.death_time.get(n, self.elapsed) for n in names}
        # 살아남은 사람은 마지막 탈락자와 경과 시간이 같아도 항상 앞선다.
        rank_key = {n: (n in self.alive, survived[n]) for n in names}
        ranking = sorted(names, key=lambda n: rank_key[n], reverse=True)
        # 같은 틱의 탈락이나 제한 시간까지 생존한 사람은 같은 순위다.
        points = [1000, 700, 500, 300]
        scores = {n: points[min(sum(rank_key[other] > rank_key[n] for other in names), 3)] for n in names}
        winners = [n for n in ranking if n in self.alive]
        reason = ('all_eliminated' if not winners else
                  'last_survivor' if len(self.names) > 1 and len(self.alive) <= 1 else 'time_limit')
        return {'winner': winners[0] if winners else None, 'winners': winners, 'ranking': ranking, 'scores': scores, 'reason': reason}

    def try_jump(self, name):
        if self.jumps_left[name] <= 0 or name in self.jumping:
            return
        target = jump_destination(self.positions[name], self.facing[name], self.map)
        if target is not None:
            self.jumping[name] = {'start': list(self.positions[name]), 'target': target, 'elapsed': 0.0}
            self.jumps_left[name] -= 1

    async def on_message(self, name, kind, data):
        if self.phase != 'playing' or name not in self.alive or name not in self.connected or not isinstance(data, dict):
            return
        if kind == 'me_jump':
            self.try_jump(name)
            return
        if kind != 'me_move':
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
        self.jumping.pop(name, None)
        self.targets = [None if target == name else target for target in self.targets]
