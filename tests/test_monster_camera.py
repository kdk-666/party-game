import json
import shutil
import subprocess
from pathlib import Path

import pytest


def test_sprite_files_are_served():
    from fastapi.testclient import TestClient
    from server.main import app
    names = ['cartoon-soldier-walk.png', 'cartoon-zombie-walk.png']
    with TestClient(app) as client:
        for name in names:
            response = client.get('/game-assets/monster_escape/' + name)
            assert response.status_code == 200
            assert response.headers['content-type'] == 'image/png'
            assert response.content.startswith(b'\x89PNG\r\n\x1a\n')


def test_camera_follows_player_and_host_sees_whole_map():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js가 없어 카메라 수학 검사를 생략합니다')
    js = Path(__file__).resolve().parents[1] / 'games/monster_escape/client/game.js'
    script = '''
const {monsterEscapeCamera} = require(process.argv[1]);
const rows = Array(15).fill('.'.repeat(15));
console.log(JSON.stringify([
  monsterEscapeCamera(false, rows, {x: 1.5, y: 1.5}, 600),
  monsterEscapeCamera(false, rows, {x: 4.5, y: 6.5}, 600),
  monsterEscapeCamera(true, rows, {x: 4.5, y: 6.5}, 600),
]));
'''
    result = subprocess.run([node, '-e', script, str(js)], check=True, capture_output=True, text=True)
    first, second, host = json.loads(result.stdout)
    assert first['size'] == pytest.approx(600 / 7)
    assert 1.5 * first['size'] + first['offsetX'] == pytest.approx(300)
    assert 4.5 * second['size'] + second['offsetX'] == pytest.approx(300)
    assert 6.5 * second['size'] + second['offsetY'] == pytest.approx(300)
    assert host == {'size': 40, 'offsetX': 0, 'offsetY': 0}


def test_death_animation_progress_clamps_and_handles_missing_transition():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js가 없어 연출 타이밍 검사를 생략합니다')
    js = Path(__file__).resolve().parents[1] / 'games/monster_escape/client/game.js'
    script = '''
const {monsterEscapeDeathProgress: f} = require(process.argv[1]);
console.log(JSON.stringify([f(null, 100), f(100, 50), f(100, 450), f(100, 800), f(100, 900)]));
'''
    result = subprocess.run([node, '-e', script, str(js)], check=True, capture_output=True, text=True)
    assert json.loads(result.stdout) == [None, 0, .5, 1, 1]


def test_interpolation_smooths_positions_and_clamps_to_authoritative_state():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js가 없어 화면 보간 검사를 생략합니다')
    js = Path(__file__).resolve().parents[1] / 'games/monster_escape/client/game.js'
    script = '''
const {monsterEscapeInterpolate: f} = require(process.argv[1]);
const a = {players: {a: {x: 0, y: 2, alive: true}}, monsters: [[1, 1]]};
const b = {players: {a: {x: 2, y: 4, alive: false}}, monsters: [[3, 5]]};
console.log(JSON.stringify([f(a, b, 0.5), f(a, b, 4)]));
'''
    result = subprocess.run([node, '-e', script, str(js)], check=True, capture_output=True, text=True)
    halfway, end = json.loads(result.stdout)
    assert halfway['players']['a'] == {'x': 1, 'y': 3, 'alive': False}
    assert halfway['monsters'] == [[2, 3]]
    assert end['players']['a']['x'] == 2
    assert end['monsters'] == [[3, 5]]
