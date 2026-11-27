import json
import shutil
import subprocess
from pathlib import Path

import pytest


def test_line_of_sight_blocks_walls_and_corners_but_allows_open_paths():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js가 없어 시야 계산 검사를 생략합니다')
    js = Path(__file__).resolve().parents[1] / 'games/monster_escape/client/game.js'
    script = '''
const {monsterEscapeCanSee: see, monsterEscapeVisibility: polygon, monsterEscapeVisibleWalls: visibleWalls} = require(process.argv[1]);
const map = ['########', '#..#...#', '#..#...#', '#......#', '#..#...#', '########'];
const origin = {x: 2.5, y: 1.5};
const corner = ['#####', '#.#.#', '#...#', '#...#', '#####'];
const points = polygon(map, origin);
const doubleWall = ['#########', '#..#.#..#', '#..#.#..#', '#..#.#..#', '#########'];
const walls = visibleWalls(doubleWall, {x: 2.5, y: 2.5});
console.log(JSON.stringify({
  open: see(map, origin, {x: 1.5, y: 1.5}),
  openVertical: see(map, origin, {x: 2.5, y: 3.5}),
  blocked: see(map, origin, {x: 4.5, y: 1.5}),
  beforeWall: see(map, origin, {x: 2.95, y: 1.5}),
  cornerBlocked: see(corner, {x: 1.5, y: 1.5}, {x: 2.5, y: 2.5}),
  cornerOpen: see(corner, {x: 1.5, y: 2.5}, {x: 2.5, y: 3.5}),
  insideJump: see(map, {x: 3.5, y: 1.5}, {x: 4.5, y: 1.5}),
  zeroDistance: see(map, origin, origin),
  finite: points.length > 32 && points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
  sorted: points.every((p, i) => !i || points[i-1].angle <= p.angle),
  frontWall: walls.some(p => p.x === 3 && p.y === 2),
  hiddenWall: walls.some(p => p.x === 5 && p.y === 2),
}));
'''
    result = subprocess.run([node, '-e', script, str(js)], check=True, capture_output=True, text=True, encoding='utf-8')
    checks = json.loads(result.stdout)
    assert checks == {'open': True, 'openVertical': True, 'blocked': False, 'beforeWall': True,
                      'cornerBlocked': False, 'cornerOpen': True, 'insideJump': True,
                      'zeroDistance': True, 'finite': True, 'sorted': True,
                      'frontWall': True, 'hiddenWall': False}
