from contextlib import ExitStack
import pytest
import time
from fastapi.testclient import TestClient
import server.main as main
from games.monster_escape import game
from games.monster_escape.manifest import GAME_INFO


def until(ws, kind):
    while True:
        msg = ws.receive_json()
        if msg['type'] == kind:
            return msg['data']


def test_joystick_to_server_and_match_results(monkeypatch):
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'monster_escape': GAME_INFO})
    monkeypatch.setattr(game, 'TIME_LIMIT', 0.6)
    original_init = game.MonsterEscape.__init__
    def setup(self, names, broadcast, map_name=None):
        original_init(self, names, broadcast, map_name='정원 미로')
        self.positions[names[0]] = [1.5, 1.5]
    monkeypatch.setattr(game.MonsterEscape, '__init__', setup)
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)
    with TestClient(main.app) as c, c.websocket_connect('/ws/host') as host, c.websocket_connect('/ws/player') as player:
        player.send_json({'type': 'join', 'data': {'name': '민지'}})
        until(player, 'join_ok')
        host.send_json({'type': 'start', 'data': {}})
        token = until(player, 'round_start')['token']
        player.send_json({'type': 'ready', 'data': {'token': token}})
        until(player, 'me_intro')
        initial = until(player, 'me_state')
        player.send_json({'type': 'me_move', 'data': {'x': 1, 'y': 0}})
        state = until(player, 'me_state')
        for _ in range(3):
            if state['players']['민지']['x'] > initial['players']['민지']['x']:
                break
            state = until(player, 'me_state')
        assert state['players']['민지']['x'] > initial['players']['민지']['x']
        result = until(player, 'me_over')
        assert result['scores']['민지'] == 1000
        assert until(player, 'match_over')['total_scores'] == result['scores']


def test_last_elimination_is_visible_before_results(monkeypatch):
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'monster_escape': GAME_INFO})
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)
    original_step = game.MonsterEscape.step
    def force_elimination(self, dt, now, tick):
        if tick >= 3:
            self.monsters[0] = self.positions[self.names[0]][:]
        original_step(self, dt, now, tick)
    monkeypatch.setattr(game.MonsterEscape, 'step', force_elimination)
    with TestClient(main.app) as client, client.websocket_connect('/ws/host') as host, client.websocket_connect('/ws/player') as player:
        player.send_json({'type': 'join', 'data': {'name': '민지'}})
        until(player, 'join_ok')
        host.send_json({'type': 'start', 'data': {}})
        token = until(player, 'round_start')['token']
        player.send_json({'type': 'ready', 'data': {'token': token}})
        state = until(player, 'me_state')
        assert state['players']['민지']['alive']
        while state['players']['민지']['alive']:
            state = until(player, 'me_state')
        assert state['ending'] == 'all_eliminated'
        started = time.monotonic()
        result = until(player, 'me_over')
        assert time.monotonic() - started >= 0.6
        assert result['reason'] == 'all_eliminated' and result['winners'] == []
        assert set(result['scores']) == {'민지'}


def test_four_player_finish_announces_and_scores_the_survivor(monkeypatch):
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'monster_escape': GAME_INFO})
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)

    def scripted_eliminations(self, dt, now, tick):
        if tick in (1, 2, 3):
            name = self.names[tick - 1]
            self.alive.remove(name)
            self.death_time[name] = self.elapsed
    monkeypatch.setattr(game.MonsterEscape, 'step', scripted_eliminations)
    names = ['가', '나', '다', '라']
    with TestClient(main.app) as client, ExitStack() as stack:
        host = stack.enter_context(client.websocket_connect('/ws/host'))
        players = [stack.enter_context(client.websocket_connect('/ws/player')) for _ in names]
        for player, name in zip(players, names):
            player.send_json({'type': 'join', 'data': {'name': name}})
            until(player, 'join_ok')
        host.send_json({'type': 'start', 'data': {}})
        tokens = [until(player, 'round_start')['token'] for player in players]
        for player, token in zip(players, tokens):
            player.send_json({'type': 'ready', 'data': {'token': token}})
        state = until(players[0], 'me_state')
        while not state.get('ending'):
            state = until(players[0], 'me_state')
        assert state['ending'] == 'last_survivor'
        assert [name for name, p in state['players'].items() if p['alive']] == ['라']
        result = until(players[0], 'me_over')
        assert result['reason'] == 'last_survivor'
        assert result['winners'] == ['라']
        assert result['ranking'] == ['라', '다', '나', '가']
        assert result['scores'] == {'가': 300, '나': 500, '다': 700, '라': 1000}
        assert until(players[0], 'match_over')['total_scores'] == result['scores']


def test_wall_jump_is_server_authoritative_and_broadcast_to_host(monkeypatch):
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'monster_escape': GAME_INFO})
    monkeypatch.setattr(game, 'TIME_LIMIT', 3.0)
    monkeypatch.setattr(game, 'MONSTER_SPEED', 0.0)
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)
    original_init = game.MonsterEscape.__init__

    def setup_near_wall(self, names, broadcast, map_name=None):
        original_init(self, names, broadcast, map_name='공원 갈림길')
        self.positions[names[0]] = [3.5, 2.5]
        self.monsters = [[11.5, 13.5] for _ in self.monsters]
    monkeypatch.setattr(game.MonsterEscape, '__init__', setup_near_wall)
    with TestClient(main.app) as client, client.websocket_connect('/ws/host') as host, client.websocket_connect('/ws/player') as player:
        player.send_json({'type': 'join', 'data': {'name': '민지'}})
        until(player, 'join_ok')
        host.send_json({'type': 'start', 'data': {}})
        token = until(player, 'round_start')['token']
        player.send_json({'type': 'ready', 'data': {'token': token}})
        state = until(player, 'me_state')
        assert state['players']['민지']['jumps_left'] == 3
        player.send_json({'type': 'me_move', 'data': {'x': 1, 'y': 0}})
        player.send_json({'type': 'me_move', 'data': {'x': 0, 'y': 0}})
        player.send_json({'type': 'me_jump', 'data': {'target': [999, 999]}})
        jumping = until(player, 'me_state')
        for _ in range(10):
            if jumping['players']['민지']['jump']:
                break
            jumping = until(player, 'me_state')
        assert jumping['players']['민지']['jump'] is not None
        assert jumping['players']['민지']['jumps_left'] == 2
        host_state = until(host, 'me_state')
        for _ in range(10):
            if host_state['players']['민지']['jump']:
                break
            host_state = until(host, 'me_state')
        assert host_state['players']['민지']['jump'] is not None
        landed = jumping
        for _ in range(10):
            if landed['players']['민지']['jump'] is None:
                break
            landed = until(player, 'me_state')
        assert landed['players']['민지']['jump'] is None
        assert landed['players']['민지']['x'] == 5.5
        assert landed['players']['민지']['y'] == 2.5
        assert landed['players']['민지']['jumps_left'] == 2


def test_blackout_and_flashlight_direction_over_websocket(monkeypatch):
    monkeypatch.setattr(game, 'BLACKOUT_ENABLED', True)
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'monster_escape': GAME_INFO})
    monkeypatch.setattr(game, 'TIME_LIMIT', 1.3)
    monkeypatch.setattr(game, 'BLACKOUT_START', 0.4)
    monkeypatch.setattr(game, 'BLACKOUT_WARNING', 0.2)
    with TestClient(main.app) as c, c.websocket_connect('/ws/host') as host, c.websocket_connect('/ws/player') as player:
        player.send_json({'type': 'join', 'data': {'name': '민지'}})
        until(player, 'join_ok')
        host.send_json({'type': 'start', 'data': {}})
        token = until(player, 'round_start')['token']
        player.send_json({'type': 'ready', 'data': {'token': token}})
        until(player, 'me_intro')
        until(player, 'me_state')
        player.send_json({'type': 'me_move', 'data': {'x': 1, 'y': 0}})
        player.send_json({'type': 'me_move', 'data': {'x': 0, 'y': 0}})
        phases = set()
        for _ in range(10):
            state = until(player, 'me_state')
            phases.add(state['lighting'])
            if 'blackout' in phases and 'warning' in phases:
                break
        assert {'warning', 'blackout'} <= phases
        assert state['players']['민지']['facing'] == [1.0, 0.0]
        for _ in range(4):
            assert until(player, 'me_state')['lighting'] == 'blackout'


@pytest.mark.parametrize('count', [2, 3, 4])
@pytest.mark.parametrize('blackout_enabled', [False, True])
def test_multiplayer_movement_blackout_and_scores(monkeypatch, count, blackout_enabled):
    monkeypatch.setattr(game, 'BLACKOUT_ENABLED', blackout_enabled)
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'monster_escape': GAME_INFO})
    # 동시 입력·상태 전달을 확인하기 위한 단축 경기: 좀비는 정지시켜 조기 탈락을 방지한다.
    monkeypatch.setattr(game, 'TIME_LIMIT', 1.5)
    monkeypatch.setattr(game, 'BLACKOUT_START', 0.5)
    monkeypatch.setattr(game, 'BLACKOUT_WARNING', 0.2)
    monkeypatch.setattr(game, 'MONSTER_SPEED', 0.0)
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)
    names = [f'참가자{i}' for i in range(count)]
    with TestClient(main.app) as client, ExitStack() as stack:
        host = stack.enter_context(client.websocket_connect('/ws/host'))
        players = [stack.enter_context(client.websocket_connect('/ws/player')) for _ in names]
        for player, name in zip(players, names):
            player.send_json({'type': 'join', 'data': {'name': name}})
            assert until(player, 'join_ok')['name'] == name
        host.send_json({'type': 'start', 'data': {}})
        tokens = [until(player, 'round_start')['token'] for player in players]
        assert len(set(tokens)) == 1
        for player in players:
            player.send_json({'type': 'ready', 'data': {'token': tokens[0]}})
        initial = [until(player, 'me_state') for player in players]
        assert all(len(state['monsters']) == 5 + 2 * (count - 1) for state in initial)
        expected_size = 15 if count == 2 else (17 if count == 3 else 19)
        assert all(len(state['map']) == expected_size and all(len(row) == expected_size for row in state['map']) for state in initial)
        start_x = {name: initial[0]['players'][name]['x'] for name in names}
        directions = {name: (1 if game.walkable(start_x[name]+1, initial[0]['players'][name]['y'], initial[0]['map']) else -1) for name in names}
        for name, player in zip(names, players):
            player.send_json({'type': 'me_move', 'data': {'x': directions[name], 'y': 0}})
        for player in players:
            observed = False
            for _ in range(6):
                state = until(player, 'me_state')
                if all((state['players'][name]['x'] - start_x[name]) * directions[name] > 0.05 for name in names):
                    observed = True
                    break
            assert observed, '모든 참가자의 이동이 각 참가자에게 반영되어야 합니다'
        for player in players:
            phases = set()
            for _ in range(7):
                phases.add(until(player, 'me_state')['lighting'])
                if blackout_enabled and 'blackout' in phases:
                    break
            if blackout_enabled:
                assert 'blackout' in phases
            else:
                assert phases == {'normal'}
        for player in players:
            result = until(player, 'me_over')
            assert set(result['scores']) == set(names)
            assert until(player, 'match_over')['total_scores'] == result['scores']


def test_four_players_receive_eleven_zombies(monkeypatch):
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'monster_escape': GAME_INFO})
    monkeypatch.setattr(game, 'TIME_LIMIT', 0.3)
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)
    with TestClient(main.app) as c, ExitStack() as stack:
        host = stack.enter_context(c.websocket_connect('/ws/host'))
        players = [stack.enter_context(c.websocket_connect('/ws/player')) for _ in range(4)]
        for index, player in enumerate(players):
            player.send_json({'type': 'join', 'data': {'name': f'참가자{index}'}})
            until(player, 'join_ok')
        host.send_json({'type': 'start', 'data': {}})
        tokens = [until(player, 'round_start')['token'] for player in players]
        assert len(set(tokens)) == 1
        for player in players:
            player.send_json({'type': 'ready', 'data': {'token': tokens[0]}})
        snapshots = [until(player, 'me_state') for player in players]
        assert all(len(state['monsters']) == 11 and len(state['players']) == 4 for state in snapshots)
        result = until(players[0], 'me_over')
        assert len(result['scores']) == 4
