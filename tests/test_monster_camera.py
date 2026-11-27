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


@pytest.mark.parametrize('map_size', [15, 17, 19])
def test_camera_follows_player_and_host_sees_whole_map(map_size):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js가 없어 카메라 수학 검사를 생략합니다')
    js = Path(__file__).resolve().parents[1] / 'games/monster_escape/client/game.js'
    script = '''
const {monsterEscapeCamera} = require(process.argv[1]);
const width = Number(process.argv[2]);
const rows = Array(width).fill('.'.repeat(width));
console.log(JSON.stringify([
  monsterEscapeCamera(false, rows, {x: 1.5, y: 1.5}, 600),
  monsterEscapeCamera(false, rows, {x: 4.5, y: 6.5}, 600),
  monsterEscapeCamera(true, rows, {x: 4.5, y: 6.5}, 600),
]));
'''
    result = subprocess.run([node, '-e', script, str(js), str(map_size)], check=True, capture_output=True, text=True)
    first, second, host = json.loads(result.stdout)
    assert first['size'] == pytest.approx(600 / 7)
    assert 1.5 * first['size'] + first['offsetX'] == pytest.approx(300)
    assert 4.5 * second['size'] + second['offsetX'] == pytest.approx(300)
    assert 6.5 * second['size'] + second['offsetY'] == pytest.approx(300)
    assert host['size'] == pytest.approx(600 / map_size)
    assert host['offsetX'] == pytest.approx(0)
    assert host['offsetY'] == pytest.approx(0)


def test_finale_copy_for_last_survivor_joint_survivors_and_all_eliminated():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js가 없어 결과 문구 검사를 생략합니다')
    js = Path(__file__).resolve().parents[1] / 'games/monster_escape/client/game.js'
    script = '''
const {monsterEscapeFinale: f} = require(process.argv[1]);
console.log(JSON.stringify([
  f({winners:['민지'], reason:'last_survivor'}, 'player', '민지'),
  f({winners:['민지'], reason:'last_survivor'}, 'player', '하나'),
  f({winners:['민지','하나'], reason:'time_limit'}, 'host', ''),
  f({winners:['민지'], reason:'time_limit'}, 'player', '민지'),
  f({winners:[], reason:'all_eliminated'}, 'host', ''),
]));
'''
    # Node.js의 한글 JSON 출력은 UTF-8이므로 Windows 기본 인코딩(cp949)에 의존하지 않는다.
    result = subprocess.run([node, '-e', script, str(js)], check=True, capture_output=True, text=True, encoding='utf-8')
    winner, other, joint, timed, none = json.loads(result.stdout)
    assert winner['title'] == '최후의 생존자' and winner['names'] == '민지'
    assert '당신' in winner['detail'] and '당신' not in other['detail']
    assert joint['title'] == '함께 살아남았어요' and joint['names'] == '민지 · 하나'
    assert timed['title'] == '생존 성공'
    assert none['title'] == '생존자 없음' and not none['names'] and not none['points']


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


def test_jump_animation_interpolates_progress_and_clears_on_landing():
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js가 없어 점프 화면 검사를 생략합니다')
    js = Path(__file__).resolve().parents[1] / 'games/monster_escape/client/game.js'
    script = '''
const {monsterEscapeInterpolate: f} = require(process.argv[1]);
const a = {players: {a: {x: 0, y: 1, jump: {progress: .2}}}, monsters: []};
const b = {players: {a: {x: 2, y: 1, jump: {progress: .6}}}, monsters: []};
const c = {players: {a: {x: 3, y: 1, jump: null}}, monsters: []};
console.log(JSON.stringify([f(a, b, .5), f(b, c, .5)]));
'''
    result = subprocess.run([node, '-e', script, str(js)], check=True, capture_output=True, text=True)
    halfway, landed = json.loads(result.stdout)
    assert halfway['players']['a']['x'] == 1
    assert halfway['players']['a']['jump']['progress'] == pytest.approx(.4)
    assert landed['players']['a']['jump'] is None


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
