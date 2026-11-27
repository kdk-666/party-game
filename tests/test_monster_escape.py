import asyncio
import math
from collections import deque

from games.monster_escape import game as monster_game
from games.monster_escape.game import (MonsterEscape, move, walkable, GARDEN_MAP,
                                       ORIGINAL_MAP, STARTS, CENTER_STARTS, MAPS,
                                       MIN_PLAYER_SPAWN_DISTANCE, MIN_ZOMBIE_SPAWN_DISTANCE,
                                       ASSIGNED_MIN_PLAYER_SPAWN_DISTANCE,
                                       path_updates_for_tick, blackout_phase,
                                       starting_positions, center_zombie_positions)


async def noop(_):
    pass


def test_blackout_can_be_disabled_for_chase_testing(monkeypatch):
    monkeypatch.setattr(monster_game, 'BLACKOUT_ENABLED', False)
    assert all(blackout_phase(t) == 'normal' for t in (0, 3, 5, 15, 30, 59.9))


def test_blackout_starts_after_five_seconds_and_remains_on_when_restored(monkeypatch):
    monkeypatch.setattr(monster_game, 'BLACKOUT_ENABLED', True)
    assert blackout_phase(0) == 'normal'
    assert blackout_phase(2.99) == 'normal'
    assert blackout_phase(3) == 'warning'
    assert blackout_phase(4.99) == 'warning'
    assert blackout_phase(5) == 'blackout'
    assert all(blackout_phase(t) == 'blackout' for t in (6, 15, 21, 30, 45, 59.9))


def test_each_map_is_connected_and_supports_all_player_counts():
    assert len(MAPS) >= 2
    for name, base_rows in MAPS:
        for count in range(1, 5):
            names = [f'참가자{i}' for i in range(count)]
            game = MonsterEscape(names, noop, map_name=name)
            rows = game.map
            size = 15 if count <= 2 else (17 if count == 3 else 19)
            assert len(rows) == size and all(len(row) == size for row in rows)
            if count <= 2:
                assert rows == base_rows  # 1~2명은 기존 맵을 바꾸지 않는다.
            floor = {(x, y) for y, row in enumerate(rows) for x, cell in enumerate(row) if cell == '.'}
            seen = {(1, 1)}
            queue = deque(seen)
            while queue:
                x, y = queue.popleft()
                for point in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                    if point in floor and point not in seen:
                        seen.add(point)
                        queue.append(point)
            assert seen == floor
            assert all(sum(walkable(p[0]+dx,p[1]+dy,rows) for dx,dy in ((1,0),(-1,0),(0,1),(0,-1))) >= 3 for p in game.positions.values())
            assert all(walkable(*p, rows) for p in game.positions.values())
            assert game.snapshot()['map_name'] == name
            assert game.initial_targets == [n for n in names for _ in range(2)] + [None] * 3
            assert len(game.monsters) == 2 * count + 3
            assert all(walkable(*m, rows) for m in game.monsters)
            assert all(math.dist(m, p) >= MIN_PLAYER_SPAWN_DISTANCE for m in game.monsters for p in game.positions.values())
            assigned = game.monsters[:-3]
            assert all(math.dist(m, p) >= ASSIGNED_MIN_PLAYER_SPAWN_DISTANCE for m in assigned for p in game.positions.values())
            # 배정 좀비가 모든 참가자의 시작 시야(중심 7칸) 바깥에 있다.
            assert all(abs(m[0] - p[0]) > 4 or abs(m[1] - p[1]) > 4 for m in assigned for p in game.positions.values())
            for i, player in enumerate(names):
                assert all(math.dist(m, game.positions[player]) >= ASSIGNED_MIN_PLAYER_SPAWN_DISTANCE for m in game.monsters[i*2:i*2+2])



def test_random_map_does_not_repeat_immediately():
    games = [MonsterEscape(['가'], noop) for _ in range(8)]
    assert all(a.map_name != b.map_name for a, b in zip(games, games[1:]))


def test_initial_targets_then_free_targeting_and_center_release(monkeypatch):
    game = MonsterEscape(['가', '나'], noop, map_name='정원 미로')
    monkeypatch.setattr(game, 'choose_target', lambda index: '나')
    all_before = [z[:] for z in game.monsters]
    center_before = all_before[-3:]
    for tick in range(5):
        game.elapsed = 1 + tick * .1
        game.step(.1, 10, tick)
    assert game.targets[:2] == ['가', '가']
    assert game.monsters == all_before
    assert game.snapshot()['reinforcements_in'] > 0
    game.elapsed = 1.99
    game.step(.01, 10, 5)
    assert game.monsters == all_before
    assert 0 < game.snapshot()['reinforcements_in'] < .02
    game.elapsed = 2.0
    game.step(.1, 10, 6)
    assert all(after != before for before, after in zip(center_before, game.monsters[-3:]))
    assert game.snapshot()['reinforcements_in'] == 0
    for tick in range(7, 12):
        game.elapsed = 2.1
        game.step(.01, 10, tick)
    assert game.targets[:2] == ['가', '가']  # 중앙 출발과 초기 목표 변경은 별개
    game.elapsed = 5.0
    for tick in range(12, 17):
        game.step(.1, 10, tick)
    assert game.targets[:2] == ['나', '나']


def test_initial_target_eliminated_falls_back_to_other_player(monkeypatch):
    game = MonsterEscape(['가', '나'], noop, map_name='정원 미로')
    game.alive.remove('가')
    game.elapsed = 2
    for tick in range(5):
        game.step(.01, 10, tick)
    assert game.targets[:2] == ['나', '나']


def test_facing_keeps_last_nonzero_direction():
    async def check():
        game = MonsterEscape(['가'], noop)
        game.phase = 'playing'
        assert game.snapshot()['players']['가']['facing'] == (0, -1)
        await game.on_message('가', 'me_move', {'x': 1, 'y': 0})
        assert game.snapshot()['players']['가']['facing'] == (1, 0)
        await game.on_message('가', 'me_move', {'x': 0, 'y': 0})
        assert game.snapshot()['players']['가']['facing'] == (1, 0)
        await game.on_message('가', 'me_move', {'x': float('nan'), 'y': 1})
        assert game.snapshot()['players']['가']['facing'] == (1, 0)
    asyncio.run(check())


def test_garden_map_is_connected_and_preserves_safe_starting_cells():
    assert all(len(row) == 15 for row in GARDEN_MAP)
    floor = {(x, y) for y, row in enumerate(GARDEN_MAP) for x, cell in enumerate(row) if cell == '.'}
    assert len(floor) < sum(row.count('.') for row in ORIGINAL_MAP)
    assert all((int(x), int(y)) in floor for x, y in STARTS + CENTER_STARTS)
    queue = deque([(1, 1)])
    visited = {(1, 1)}
    while queue:
        x, y = queue.popleft()
        for point in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if point in floor and point not in visited:
                visited.add(point)
                queue.append(point)
    assert visited == floor
    assert all(math.dist(player, zombie) >= 5 for player in STARTS for zombie in CENTER_STARTS)


def test_zombie_count_and_spawn_safety_for_each_player_count():
    for count in range(1, 5):
        game = MonsterEscape([str(n) for n in range(count)], noop)
        assert len(game.monsters) == 5 + 2 * (count - 1)
        assert all(walkable(*z, game.map) for z in game.monsters)
        assert all(math.dist(z, p) >= MIN_PLAYER_SPAWN_DISTANCE for z in game.monsters for p in game.positions.values())
        assert all(math.dist(a, b) >= MIN_ZOMBIE_SPAWN_DISTANCE for i, a in enumerate(game.monsters[:-3]) for b in game.monsters[i + 1:])



def test_all_zombie_paths_are_updated_once_per_five_ticks():
    for count in (5, 7, 9, 11):
        for start in (0, 5, 10):
            updates = [i for tick in range(start, start + 5) for i in path_updates_for_tick(count, tick)]
            assert sorted(updates) == list(range(count))


def test_starts_are_walkable_and_walls_block():
    game = MonsterEscape(['가', '나', '다', '라'], noop)
    assert all(walkable(*p, game.map) for p in list(game.positions.values()) + game.monsters)
    assert move([1.5, 1.5], -1, 0) == [1.5, 1.5]


def test_monster_uses_pathfinding_and_collision():
    game = MonsterEscape(['가'], noop, map_name='정원 미로')
    game.elapsed = 2
    game.positions['가'] = [1.5, 1.5]
    game.monsters[0] = [1.5, 2.5]
    game.step(0.1, 10, 0)
    assert game.monsters[0][1] < 2.5
    game.monsters[0] = list(game.positions['가'])
    game.step(0.01, 10, 1)
    assert '가' not in game.alive


def test_inputs_are_validated_clamped_and_expire():
    async def check():
        game = MonsterEscape(['가'], noop)
        game.phase = 'playing'
        await game.on_message('가', 'me_move', {'x': float('nan'), 'y': 0})
        assert game.inputs['가'] == (0, 0, 0)
        await game.on_message('가', 'me_move', {'x': 3, 'y': 4})
        x, y, now = game.inputs['가']
        assert math.isclose(math.hypot(x, y), 1)
        before = game.positions['가'][:]
        game.step(.1, now + 1, 0)
        assert game.positions['가'] == before
    asyncio.run(check())


def test_zombies_distribute_targets_and_flank_moving_players():
    game = MonsterEscape(['가', '나'], noop, map_name='정원 미로')
    game.positions['가'] = [5.5, 4.5]
    game.positions['나'] = [8.5, 4.5]
    game.monsters[0] = [6.5, 6.5]
    game.targets = ['가', '가', '가', None, None]
    assert game.choose_target(0) == '나'
    game.positions['가'] = [2.5, 4.5]
    game.inputs['가'] = (1, 0, 10)
    # 측면 추격은 근접 직접 추격 범위 밖에서 검증한다.
    game.monsters[1] = [6.5, 4.5]
    point = game.pursuit_point(1, '가', 10.1)
    assert point != game.positions['가']
    assert walkable(*point)
    assert game.pursuit_point(1, '가', 11) == game.positions['가']
    # 근접 시에는 기존대로 현재 위치를 직접 추격한다.
    game.monsters[1] = [3.5, 4.5]
    assert game.pursuit_point(1, '가', 10.1) == game.positions['가']


def test_interceptors_are_a_small_subset_of_center_zombies():
    for count in range(1, 5):
        game = MonsterEscape([str(i) for i in range(count)], noop)
        assert len(game.interceptors) == (1 if count <= 2 else 2)
        assert game.interceptors <= set(range(len(game.monsters) - 3, len(game.monsters)))


def test_interceptor_predicts_player_speed_after_grace_period_and_stops_when_input_expires():
    game = MonsterEscape(['가'], noop, map_name='버려진 물류창고')
    game.positions['가'] = [3.5, 1.5]
    index = min(game.interceptors)
    game.monsters[index] = [10.5, 1.5]
    game.inputs['가'] = (1, 0, 10)
    game.elapsed = 4.99
    assert game.pursuit_point(index, '가', 10.1) == [3.5, 1.5]
    game.elapsed = 5.0
    point = game.pursuit_point(index, '가', 10.1)
    assert math.isclose(point[0], 3.5 + 2.6 * .8)
    assert point[1] == 1.5
    game.inputs['가'] = (0.5, 0, 10)
    assert math.isclose(game.pursuit_point(index, '가', 10.1)[0], 3.5 + 2.6 * .8 * .5)
    game.inputs['가'] = (-1, 0, 10)
    assert game.pursuit_point(index, '가', 10.1)[0] < 3.5
    assert game.pursuit_point(index, '가', 11) == [3.5, 1.5]
    game.inputs['가'] = (0, 0, 10)
    assert game.pursuit_point(index, '가', 10.1) == [3.5, 1.5]
    game.inputs['가'] = (1, 0, 10)
    game.monsters[index] = [4.5, 1.5]
    assert game.pursuit_point(index, '가', 10.1) == [3.5, 1.5]


def test_predicted_position_does_not_cross_walls_or_leave_map():
    for map_name, rows in MAPS:
        game = MonsterEscape(['가'], noop, map_name=map_name)
        game.elapsed = 5
        # 구석에서 왼쪽 벽을 향하면 벽 너머가 아닌 현재 위치를 목표로 한다.
        game.positions['가'] = [1.5, 1.5]
        game.inputs['가'] = (-1, 0, 10)
        predicted = game.predicted_position('가', 10.1)
        assert predicted[0] >= 1.2
        assert all(walkable(predicted[0] + x, predicted[1] + y, rows)
                   for x in (-.2, .2) for y in (-.2, .2))


def test_interceptor_uses_astar_to_reach_predicted_cell(monkeypatch):
    game = MonsterEscape(['가'], noop, map_name='버려진 물류창고')
    game.positions['가'] = [3.5, 4.5]
    game.inputs['가'] = (1, 0, 10)
    game.elapsed = 5
    index = min(game.interceptors)
    game.monsters[index] = [10.5, 4.5]
    destination = game.pursuit_point(index, '가', 10.1)
    captured = []
    original = game.finder.find_path
    def find_path(start, end, grid):
        captured.append((end.x, end.y))
        return original(start, end, grid)
    monkeypatch.setattr(game.finder, 'find_path', find_path)
    tick = next(t for t in range(5) if index in path_updates_for_tick(len(game.monsters), t))
    game.step(0, 10.1, tick)
    assert (int(destination[0]), int(destination[1])) in captured
    assert game.paths[index] and [int(v) for v in game.paths[index][-1]] == [int(v) for v in destination]


def test_nearby_zombies_keep_some_space_without_walking_through_walls():
    game = MonsterEscape(['가'], noop, map_name='정원 미로')
    game.elapsed = 2
    game.monsters[0] = [7.5, 7.5]
    game.monsters[1] = [7.6, 7.5]
    game.paths[0] = [[7.5, 6.5]]
    game.step(0.1, 10, 2)
    assert game.monsters[0][0] < 7.5
    assert all(walkable(*p) for p in game.monsters)


def test_last_survivor_scores_above_last_eliminated_at_same_elapsed_time():
    game = MonsterEscape(['가', '나', '다', '라'], noop)
    game.elapsed = 30
    game.alive = {'라'}
    game.death_time = {'가': 10, '나': 20, '다': 30}
    result = game.result()
    assert result['ranking'] == ['라', '다', '나', '가']
    assert result['scores'] == {'가': 300, '나': 500, '다': 700, '라': 1000}
    assert result['winners'] == ['라']


def test_two_player_last_survivor_scores_1000_and_second_place_700():
    game = MonsterEscape(['가', '나'], noop)
    game.elapsed = 12
    game.alive = {'나'}
    game.death_time = {'가': 12}
    result = game.result()
    assert result['scores'] == {'가': 700, '나': 1000}
    assert result['winners'] == ['나']
    assert result['reason'] == 'last_survivor'


def test_timeout_survivors_tie_above_a_player_eliminated_at_the_same_time():
    game = MonsterEscape(['가', '나', '다', '라'], noop)
    game.elapsed = monster_game.TIME_LIMIT
    game.alive = {'다', '라'}
    game.death_time = {'가': 10, '나': game.elapsed}
    result = game.result()
    assert result['scores'] == {'가': 300, '나': 500, '다': 1000, '라': 1000}
    assert result['winners'] == ['다', '라']
    assert result['reason'] == 'time_limit'


def test_simultaneous_eliminations_tie_below_survivor():
    game = MonsterEscape(['가', '나', '다', '라'], noop)
    game.elapsed = 30
    game.alive = {'라'}
    game.death_time = {'가': 10, '나': 30, '다': 30}
    result = game.result()
    assert result['scores'] == {'가': 300, '나': 700, '다': 700, '라': 1000}
    assert result['ranking'][0] == '라'
    assert result['winners'] == ['라']


def test_all_eliminated_can_tie_for_score_without_a_surviving_winner():
    game = MonsterEscape(['가', '나', '다', '라'], noop)
    game.elapsed = 30
    game.alive.clear()
    game.death_time = {'가': 10, '나': 20, '다': 30, '라': 30}
    result = game.result()
    assert result['scores'] == {'가': 300, '나': 500, '다': 1000, '라': 1000}
    assert result['winners'] == []


def test_ties_and_disconnects_are_scored_safely():
    async def check():
        game = MonsterEscape(['가', '나', '다'], noop)
        game.elapsed = 5
        game.death_time['다'] = 2
        game.alive.remove('다')
        result = game.result()
        assert result['scores'] == {'가': 1000, '나': 1000, '다': 500}
        assert set(result['winners']) == {'가', '나'}
        await game.remove_player('나')
        assert '나' not in game.result()['scores']
        game.alive.clear()
        assert game.result()['winners'] == []
    asyncio.run(check())


def test_random_spawn_repeated_safety():
    import random
    state = random.getstate()
    try:
        random.seed(2026)
        for name, _ in MAPS:
            for count in range(1, 5):
                layouts = set()
                for _ in range(100):
                    game = MonsterEscape([str(i) for i in range(count)], noop, map_name=name)
                    players = list(game.positions.values())
                    layouts.add(tuple(map(tuple, players)))
                    for i,p in enumerate(players):
                        assert all(math.dist(p,q) >= 4 for q in players[i+1:])
                        assert sum(walkable(p[0]+dx,p[1]+dy,game.map) for dx,dy in ((1,0),(-1,0),(0,1),(0,-1))) >= 3
                        for z in game.monsters:
                            assert math.dist(p,z) >= 4
                            game.grid.cleanup()
                            path,_ = game.finder.find_path(game.grid.node(int(p[0]),int(p[1])),game.grid.node(int(z[0]),int(z[1])),game.grid)
                            assert len(path) >= 6
                        assert all(math.dist(p,z) >= 8 for z in game.monsters[:-3])
                    assert all(math.dist(a,b) >= 1.5 for i,a in enumerate(game.monsters) for b in game.monsters[i+1:])
                assert len(layouts) > 1
    finally:
        random.setstate(state)


def test_warehouse_larger_maps_add_real_jump_routes():
    from games.monster_escape.game import LUMBERYARD_MAP, expand_map, jump_destination
    from games.monster_escape.manifest import GAME_INFO
    counts = []
    for n in range(1, 5):
        rows = expand_map(LUMBERYARD_MAP, n)
        preview = next(p['rows'] for p in GAME_INFO['test_map_previews'](n) if p['name'] == '버려진 물류창고')
        assert preview == rows
        counts.append(sum(jump_destination([x+.5, y+.5], d, rows) is not None
                          for y, row in enumerate(rows) for x, c in enumerate(row)
                          if c == '.' for d in ((1, 0), (0, 1))))
    assert counts[0] == counts[1] < counts[2] < counts[3]


def test_virtual_player_moves_without_controlling_real_player():
    game = MonsterEscape(['real', 'bot'], noop)
    game.virtual_players = {'bot'}
    before = {n: list(p) for n,p in game.positions.items()}
    game.step(.1, 10, 0)
    assert game.positions['real'] == before['real']
    assert 0 < math.dist(game.positions['bot'], before['bot']) <= monster_game.PLAYER_SPEED * .1 + 1e-9
    game.alive.remove('bot')
    game.step(.1, 11, 1)
    assert game.bot_next['bot'] < 11


def test_virtual_player_jumps_only_when_safe():
    game = MonsterEscape(['bot'], noop)
    game.virtual_players = {'bot'}
    game.map = ('#######', '#.....#', '#..#..#', '#.....#', '#######')
    game.positions['bot'] = [2.5, 2.5]
    game.monsters = [[1.5, 2.5]]
    game.update_virtual_players(10)
    assert game.jumping['bot']['target'] == [4.5, 2.5]
    assert game.jumps_left['bot'] == monster_game.JUMP_LIMIT - 1
