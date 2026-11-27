"""좀비가 지나갈 수 있는 대체 경로가 있을 때 뭉치지 않는지 확인한다."""
import pytest
from pathfinding.core.grid import Grid
from games.monster_escape.game import MonsterEscape, walkable


async def noop(_):
    pass


def open_arena():
    rows = tuple(['###############'] + ['#.............#'] * 13 + ['###############'])
    game = MonsterEscape(['가'], noop, map_name='버려진 물류창고')
    game.map = rows
    game.grid = Grid(matrix=[[int(cell != '#') for cell in row] for row in rows])
    game.positions['가'] = [11.5, 7.5]
    game.monsters = [[3.5, 7.5] for _ in game.monsters]
    game.paths = [[] for _ in game.monsters]
    game.elapsed = 6.0
    return game


def test_chasers_choose_some_different_routes_when_space_allows():
    game = open_arena()
    for tick in range(5):
        game.step(.1, 10, tick)
    # 다른 좀비의 가까운 예정 경로가 있을 때 적어도 일부는 다른 첫 칸을 선택한다.
    next_rows = {path[0][1] for path in game.paths if path}
    assert len(next_rows) > 1, f'넓은 공간인데 같은 줄로만 이동함: {next_rows}'
    assert all(walkable(*monster, game.map) for monster in game.monsters)


def test_shared_start_does_not_stay_perfectly_overlapped():
    game = open_arena()
    for tick in range(10):
        game.step(.1, 10, tick)
    assert len({round(p[1], 2) for p in game.monsters}) > 1
    assert all(walkable(*monster, game.map) for monster in game.monsters)


def test_narrow_corridor_remains_usable():
    game = open_arena()
    rows = tuple('#.............#' if y == 7 else '###############' for y in range(15))
    game.map = rows
    game.grid = Grid(matrix=[[int(cell != '#') for cell in row] for row in rows])
    game.positions['가'] = [12.5, 7.5]
    game.monsters = [[2.5 + i * .4, 7.5] for i in range(len(game.monsters))]
    original = [p[:] for p in game.monsters]
    for tick in range(25):
        game.step(.1, 10 + tick * .1, tick)
    assert all(monster[0] > before[0] for monster, before in zip(game.monsters, original))
    assert all(walkable(*monster, rows) for monster in game.monsters)


def test_occupied_route_increases_astar_cost_and_selects_alternative():
    game = open_arena()
    start, end = game.grid.node(3, 7), game.grid.node(11, 7)
    normal = game.find_spread_path(0, start, end)
    assert all(node.y == 7 for node in normal)
    game.paths[1] = [[x + .5, 7.5] for x in range(4, 8)]
    spread = game.find_spread_path(0, start, end)
    assert any(node.y != 7 for node in spread)
    assert all(node.walkable for node in spread)
    assert all(node.weight == 1 for row in game.grid.nodes for node in row if node.walkable)


def test_temporary_path_weights_are_restored_even_if_finder_fails(monkeypatch):
    game = open_arena()
    game.paths[1] = [[4.5, 7.5], [5.5, 7.5]]
    def fail(*args):
        assert game.grid.node(4, 7).weight > 1
        raise RuntimeError('인위적인 경로 탐색 오류')
    monkeypatch.setattr(game.finder, 'find_path', fail)
    with pytest.raises(RuntimeError):
        game.find_spread_path(0, game.grid.node(3, 7), game.grid.node(11, 7))
    assert all(node.weight == 1 for row in game.grid.nodes for node in row if node.walkable)


def test_initial_period_keeps_original_unweighted_search(monkeypatch):
    game = open_arena()
    game.elapsed = 4.99
    game.paths[1] = [[4.5, 7.5], [5.5, 7.5]]
    original = game.finder.find_path
    def inspect(start, end, grid):
        assert grid.node(4, 7).weight == 1
        return original(start, end, grid)
    monkeypatch.setattr(game.finder, 'find_path', inspect)
    assert game.find_spread_path(0, game.grid.node(3, 7), game.grid.node(11, 7))
