"""테스트 모드 선택은 호스트에서만, 명시적으로 켰을 때만 적용된다."""
from fastapi.testclient import TestClient
import pytest

import server.main as main
from server.match import Match


def until(ws, kind):
    while True:
        msg = ws.receive_json()
        if msg['type'] == kind:
            return msg.get('data', {})


class FakeGame:
    def __init__(self, names, broadcast):
        self.names = names
        self.broadcast = broadcast
        self.running = False

    async def run(self):
        await self.broadcast({'type': 'test_game_started', 'data': {'names': self.names}})
        return {'scores': {name: 10 for name in self.names}}


REGISTRY = {
    'one': {'name': '첫 게임', 'game_class': FakeGame},
    'two': {'name': '좀비 피하기', 'game_class': FakeGame},
}


def join(ws, name):
    ws.send_json({'type': 'join', 'data': {'name': name}})
    assert until(ws, 'join_ok')['name'] == name


def test_match_selected_game_validation_and_normal_random():
    assert Match(['가'], REGISTRY, selected_game_id='two').game_ids == ['two']
    assert set(Match(['가'], REGISTRY).game_ids) == {'one', 'two'}
    for bad in ('missing', '', [], 1):
        with pytest.raises(ValueError):
            Match(['가'], REGISTRY, selected_game_id=bad)


def test_disabled_mode_rejects_selected_game(monkeypatch):
    monkeypatch.delenv('PARTY_TEST_MODE', raising=False)
    monkeypatch.setattr(main, 'GAME_REGISTRY', REGISTRY)
    with TestClient(main.app) as client, client.websocket_connect('/ws/host') as host, client.websocket_connect('/ws/player') as player:
        lobby = until(host, 'lobby')
        assert lobby['test_mode'] is False and lobby['test_games'] == []
        join(player, '가')
        host.send_json({'type': 'start', 'data': {'game_id': 'two'}})
        assert '꺼져' in until(host, 'start_error')['message']
        assert main.active_match is None


def test_selected_game_multiplayer_uses_standard_round_and_lobby(monkeypatch):
    monkeypatch.setenv('PARTY_TEST_MODE', '1')
    monkeypatch.setattr(main, 'GAME_REGISTRY', REGISTRY)
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)
    with TestClient(main.app) as client, client.websocket_connect('/ws/host') as host, client.websocket_connect('/ws/player') as p1, client.websocket_connect('/ws/player') as p2:
        lobby = until(host, 'lobby')
        assert lobby['test_mode'] is True
        assert [g['id'] for g in lobby['test_games']] == ['one', 'two']
        join(p1, '민지')
        join(p2, '서연')
        host.send_json({'type': 'start', 'data': {'game_id': 'missing'}})
        assert '등록되지 않은' in until(host, 'start_error')['message']
        assert main.active_match is None
        host.send_json({'type': 'start', 'data': {'game_id': 'two'}})
        a, b = until(p1, 'round_start'), until(p2, 'round_start')
        assert a['game_id'] == b['game_id'] == 'two'
        assert a['round'] == a['total_rounds'] == 1
        assert a['token'] == b['token']
        p1.send_json({'type': 'ready', 'data': {'token': a['token']}})
        p2.send_json({'type': 'ready', 'data': {'token': b['token']}})
        assert set(until(p1, 'test_game_started')['names']) == {'민지', '서연'}
        result = until(p1, 'round_result')
        assert result['game_id'] == 'two' and result['total_scores'] == {'민지': 10, '서연': 10}
        assert until(p1, 'match_over')['total_scores'] == {'민지': 10, '서연': 10}
        until(p1, 'return_lobby')
        until(p2, 'return_lobby')
