"""실제 WebSocket 경기 흐름에서 거리와 시간이 참가자에게 전달되는지 검사한다."""
from fastapi.testclient import TestClient

import server.main as main
from games.red_light import game as red_light
from games.red_light.manifest import GAME_INFO


def until(ws, kind):
    while True:
        message = ws.receive_json()
        if message['type'] == kind:
            return message['data']


def initial_remaining_is_valid(remaining, duration):
    # 큰 단조 시계 값을 더하고 빼는 과정에서 생기는 부동소수점 오차만 허용한다.
    return 0 <= remaining <= duration + 1e-6


def test_initial_remaining_tolerates_only_small_rounding_error():
    assert initial_remaining_is_valid(0.6000000000931323, 0.6)
    assert not initial_remaining_is_valid(0.601, 0.6)
    assert not initial_remaining_is_valid(-0.001, 0.6)


def test_two_players_receive_shared_positions_and_time(monkeypatch):
    monkeypatch.setattr(main, 'GAME_REGISTRY', {'red_light': GAME_INFO})
    monkeypatch.setattr(red_light, 'GAME_TIME', 6.0)  # 실제 경기 0.6초
    monkeypatch.setattr(main, 'LAST_GAME_RESULT_SECONDS', 0)
    monkeypatch.setattr(main, 'INTERMISSION_SECONDS', 0)
    monkeypatch.setattr(main, 'FINAL_SECONDS', 0)
    with TestClient(main.app) as c, c.websocket_connect('/ws/host') as host, \
            c.websocket_connect('/ws/player') as p1, c.websocket_connect('/ws/player') as p2:
        for ws, name in ((p1, '민지'), (p2, '서연')):
            ws.send_json({'type': 'join', 'data': {'name': name}})
            assert until(ws, 'join_ok')['name'] == name
        host.send_json({'type': 'start', 'data': {}})
        t1, t2 = until(p1, 'round_start')['token'], until(p2, 'round_start')['token']
        assert t1 == t2
        for ws in (p1, p2):
            ws.send_json({'type': 'ready', 'data': {'token': t1}})
        state = until(p1, 'state')
        assert state['state'] == 'green'
        assert state['dist'] == {'민지': 10, '서연': 10}
        assert state['connected'] == ['민지', '서연']
        assert state['start_distance'] == 10
        assert initial_remaining_is_valid(state['remaining'], .6)
        p1.send_json({'type': 'motion', 'data': {'value': 3}})
        snapshot = until(p1, 'dist')
        assert set(snapshot['dist']) == {'민지', '서연'} and snapshot['remaining'] <= state['remaining']
        for _ in range(4):
            if snapshot['dist']['민지'] < 10:
                break
            snapshot = until(p1, 'dist')
        assert snapshot['dist']['민지'] < 10
        assert until(p2, 'state')['dist'] == state['dist']
        final = until(p1, 'game_over')
        assert set(final['scores']) == {'민지', '서연'}
        assert until(p1, 'match_over')['total_scores'] == final['scores']
