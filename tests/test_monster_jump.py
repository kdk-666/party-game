import asyncio
import time

from games.monster_escape import game as monster


async def noop(_):
    pass


def make_game(names=('가',), map_name='폐허가 된 도심'):
    game = monster.MonsterEscape(list(names), noop, map_name=map_name)
    game.phase = 'playing'
    return game


def send(game, name, kind, data=None):
    asyncio.run(game.on_message(name, kind, {} if data is None else data))


def test_jump_destination_allows_only_nearby_one_cell_interior_walls():
    rows = monster.PARK_MAP
    assert monster.jump_destination([3.5, 2.5], (1, 0), rows) == [5.5, 2.5]
    assert monster.jump_destination([5.5, 2.5], (-1, 0), rows) == [3.5, 2.5]
    assert monster.jump_destination([1.5, 1.5], (-1, 0), rows) is None  # 바깥 테두리
    assert monster.jump_destination([1.5, 3.5], (1, 0), rows) is None  # 두 칸 두께
    assert monster.jump_destination([1.5, 1.5], (1, 0), rows) is None  # 벽이 아님
    assert monster.jump_destination([3.2, 2.5], (1, 0), rows) is None  # 벽에서 너무 멂
    assert monster.jump_destination([4.5, 2.5], (1, 0), rows) is None  # 벽 안에서 시작 불가


def test_jump_checks_the_entire_landing_body_not_only_center():
    rows = ('#######', '#.....#', '#..#..#', '#...#.#', '#.....#', '#######')
    assert monster.jump_destination([2.5, 2.85], (1, 0), rows) is None
    assert monster.jump_destination([2.5, 2.5], (1, 0), rows) == [4.5, 2.5]


def test_jump_uses_server_facing_only_five_uses_and_no_duplicate_while_airborne(monkeypatch):
    monkeypatch.setattr(monster, 'MONSTER_SPEED', 0)
    game = make_game()
    game.positions['가'] = [3.5, 2.5]
    game.monsters = [[11.5, 13.5] for _ in game.monsters]
    game.facing['가'] = (1, 0)
    send(game, '가', 'me_jump', {'x': 999, 'target': [100, 100]})
    send(game, '가', 'me_jump')  # 연타해도 진행 중에는 소모되지 않는다.
    assert game.jumps_left['가'] == 4
    assert game.positions['가'] == [3.5, 2.5]
    game.step(.2, time.monotonic(), 0)
    snap = game.snapshot()['players']['가']
    assert 3.5 < snap['x'] < 5.5
    assert 0 < snap['jump']['progress'] < 1
    assert game.positions['가'] == [3.5, 2.5]  # 실제 판정 좌표는 착지할 때 변경된다.
    game.step(.25, time.monotonic(), 1)
    assert game.positions['가'] == [5.5, 2.5] and game.snapshot()['players']['가']['jump'] is None
    game.facing['가'] = (-1, 0)
    send(game, '가', 'me_jump')
    assert game.jumps_left['가'] == 3
    game.step(.45, time.monotonic(), 2)
    assert game.positions['가'] == [3.5, 2.5]
    game.facing['가'] = (1, 0)
    send(game, '가', 'me_jump')
    assert game.jumps_left['가'] == 2 and '가' in game.jumping
    game.step(.45, time.monotonic(), 3)
    assert game.positions['가'] == [5.5, 2.5]
    for tick, direction in enumerate((-1, 1), 4):
        game.facing['가'] = (direction, 0)
        send(game, '가', 'me_jump')
        assert game.jumps_left['가'] == 5 - tick
        game.step(.45, time.monotonic(), tick)
    game.facing['가'] = (-1, 0)
    send(game, '가', 'me_jump')
    assert game.jumps_left['가'] == 0 and '가' not in game.jumping


def test_invalid_jumps_do_not_spend_uses_and_inputs_require_living_connected_player():
    game = make_game()
    game.positions['가'] = [1.5, 1.5]
    game.facing['가'] = (-1, 0)
    send(game, '가', 'me_jump')
    assert game.jumps_left['가'] == 5 and not game.jumping
    game.positions['가'] = [3.5, 2.5]
    game.facing['가'] = (1, 0)
    game.phase = 'finishing'
    send(game, '가', 'me_jump')
    game.phase = 'playing'
    game.alive.remove('가')
    send(game, '가', 'me_jump')
    game.alive.add('가')
    game.connected.remove('가')
    send(game, '가', 'me_jump')
    send(game, 'not-a-player', 'me_jump')
    assert game.jumps_left['가'] == 5 and not game.jumping


def test_jump_invulnerability_ends_on_landing(monkeypatch):
    monkeypatch.setattr(monster, 'MONSTER_SPEED', 0)
    game = make_game()
    game.positions['가'] = [3.5, 2.5]
    game.facing['가'] = (1, 0)
    game.elapsed = 2
    game.monsters = [[3.5, 2.5] for _ in game.monsters]
    send(game, '가', 'me_jump')
    game.step(.2, time.monotonic(), 0)
    assert '가' in game.alive and '가' in game.jumping
    game.monsters = [[5.5, 2.5] for _ in game.monsters]
    game.step(.25, time.monotonic(), 1)
    assert '가' not in game.alive and '가' not in game.jumping
    assert game.positions['가'] == [5.5, 2.5]


def test_jump_counts_are_independent_and_disconnect_cancels_jump():
    game = make_game(('가', '나', '다', '라'))
    game.positions['가'] = [3.5, 2.5]
    game.facing['가'] = (1, 0)
    send(game, '가', 'me_jump')
    state = game.snapshot()['players']
    assert state['가']['jumps_left'] == 4 and state['가']['jump'] is not None
    assert all(state[name]['jumps_left'] == 5 and state[name]['jump'] is None for name in ('나', '다', '라'))
    asyncio.run(game.remove_player('가'))
    assert '가' not in game.jumping and '가' not in game.alive


def test_all_map_sizes_have_thin_jumpable_walls_with_safe_landings():
    for name, _ in monster.MAPS:
        for count in (1, 2, 3, 4):
            game = make_game(tuple(str(i) for i in range(count)), name)
            rows = game.map
            found = 0
            for y, row in enumerate(rows):
                for x, cell in enumerate(row):
                    if cell != '.':
                        continue
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        dest = monster.jump_destination([x + .5, y + .5], (dx, dy), rows)
                        if dest is None:
                            continue
                        found += 1
                        assert rows[y + dy][x + dx] == '#'
                        assert 0 < x + dx < len(row) - 1 and 0 < y + dy < len(rows) - 1
                        assert monster.walkable(*dest, rows)
            assert found > 0, (name, count)


def test_jump_recharge_is_sequential_and_capped():
    game = make_game()
    game.positions['가'] = [3.5, 2.5]
    game.facing['가'] = (1, 0)
    send(game, '가', 'me_jump')
    game.update_jump_recharge(10)
    game.jumping.clear()
    send(game, '가', 'me_jump')
    assert game.jumps_left['가'] == 3
    assert game.snapshot()['players']['가']['jump_recharge_in'] == 5
    game.update_jump_recharge(5)
    assert game.jumps_left['가'] == 4
    game.update_jump_recharge(15)
    assert game.jumps_left['가'] == 5
    game.update_jump_recharge(60)
    assert game.jump_recharge['가'] == 0
    assert game.snapshot()['players']['가']['jump_recharge_in'] is None


def test_jump_recharge_applies_to_virtual_players_but_not_eliminated_players():
    game = make_game(('가', '나'))
    game.virtual_players = {'나'}
    game.jumps_left.update({'가': 0, '나': 0})
    game.alive.remove('가')
    game.update_jump_recharge(15)
    assert game.jumps_left == {'가': 0, '나': 1}
    assert game.snapshot()['players']['가']['jump_recharge_in'] is None
