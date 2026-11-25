import asyncio
import math
from collections import deque

from games.monster_escape.game import (MonsterEscape, move, walkable, GARDEN_MAP,
                                       ORIGINAL_MAP, STARTS, CENTER_STARTS, MAPS,
                                       MIN_PLAYER_SPAWN_DISTANCE, MIN_ZOMBIE_SPAWN_DISTANCE,
                                       path_updates_for_tick, blackout_phase)


async def noop(_):
    pass


def test_blackout_starts_after_five_seconds_and_remains_on():
    assert blackout_phase(0) == 'normal'
    assert blackout_phase(2.99) == 'normal'
    assert blackout_phase(3) == 'warning'
    assert blackout_phase(4.99) == 'warning'
    assert blackout_phase(5) == 'blackout'
    assert all(blackout_phase(t) == 'blackout' for t in (6, 15, 21, 30, 45, 59.9))


def test_each_map_is_connected_and_supports_all_player_counts():
    assert len(MAPS) >= 2
    for name, rows in MAPS:
        assert len(rows) == 15 and all(len(row) == 15 for row in rows)
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
        for count in range(1, 5):
            names = [f'참가자{i}' for i in range(count)]
            game = MonsterEscape(names, noop, map_name=name)
            assert game.map == rows and game.snapshot()['map_name'] == name
            assert game.initial_targets == [n for n in names for _ in range(2)] + [None] * 3
            assert len(game.monsters) == 2 * count + 3
            assert all(walkable(*m, rows) for m in game.monsters)
            for i, player in enumerate(names):
                assert all(math.dist(m, game.positions[player]) >= MIN_PLAYER_SPAWN_DISTANCE for m in game.monsters[i*2:i*2+2])
            assert game.monsters[-3:] == [list(p) for p in CENTER_STARTS]


def test_random_map_does_not_repeat_immediately():
    games = [MonsterEscape(['가'], noop) for _ in range(8)]
    assert all(a.map_name != b.map_name for a, b in zip(games, games[1:]))


def test_initial_targets_then_free_targeting_and_center_release(monkeypatch):
    game = MonsterEscape(['가', '나'], noop, map_name='정원 미로')
    monkeypatch.setattr(game, 'choose_target', lambda index: '나')
    center_before = [z[:] for z in game.monsters[-3:]]
    for tick in range(5):
        game.elapsed = 1 + tick * .1
        game.step(.1, 10, tick)
    assert game.targets[:2] == ['가', '가']
    assert game.monsters[-3:] == center_before
    assert game.snapshot()['reinforcements_in'] > 0
    game.elapsed = 1.99
    game.step(.01, 10, 5)
    assert game.monsters[-3:] == center_before
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
    game.elapsed = 1
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
        assert game.monsters[-3:] == [list(p) for p in CENTER_STARTS]


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
    point = game.pursuit_point(1, '가', 10.1)
    assert point != game.positions['가']
    assert walkable(*point)
    assert game.pursuit_point(1, '가', 11) == game.positions['가']


def test_nearby_zombies_keep_some_space_without_walking_through_walls():
    game = MonsterEscape(['가'], noop, map_name='정원 미로')
    game.monsters[0] = [7.5, 7.5]
    game.monsters[1] = [7.6, 7.5]
    game.paths[0] = [[7.5, 6.5]]
    game.step(0.1, 10, 2)
    assert game.monsters[0][0] < 7.5
    assert all(walkable(*p) for p in game.monsters)


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
