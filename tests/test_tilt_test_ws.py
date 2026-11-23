from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.tilt_test import install_tilt_test


def make_client():
    app = FastAPI()
    install_tilt_test(app)
    return TestClient(app)          # with 로 감싸서 써야 연결들이 같은 이벤트 루프를 쓴다


def read_states(ws, n):
    out = []
    while len(out) < n:
        msg = ws.receive_json()
        if msg["type"] == "state":
            out.append(msg["data"])
    return out


def test_maze_is_sent_first_and_ball_moves_when_tilted():
    with make_client() as c, c.websocket_connect("/ws/tilt-test") as ws:
        first = ws.receive_json()
        assert first["type"] == "maze" and len(first["data"]["rows"]) > 5
        start_x = read_states(ws, 1)[0]["x"]
        ws.send_json({"type": "tilt", "data": {"x": 1, "y": 0, "ts": 12345}})
        states = read_states(ws, 20)
        assert states[-1]["x"] > start_x + 0.1                 # 오른쪽으로 굴러갔다
        assert states[-1]["ts"] == 12345                        # 지연 계산용 시각을 돌려준다
        assert states[-1]["reached"] == [] and states[-1]["cp_saves"] == 0   # 아직 깃발을 안 밟음


def test_reset_puts_ball_back_at_start():
    with make_client() as c, c.websocket_connect("/ws/tilt-test") as ws:
        ws.receive_json()
        ws.send_json({"type": "tilt", "data": {"x": 1, "y": 0}})
        moved = read_states(ws, 20)[-1]["x"]
        ws.send_json({"type": "reset", "data": {}})
        states = read_states(ws, 5)
        assert states[-1]["x"] < moved
        assert states[-1]["t"] < 1.0                           # 시간도 처음부터


def test_garbage_messages_do_not_kill_the_connection():
    with make_client() as c, c.websocket_connect("/ws/tilt-test") as ws:
        ws.receive_json()
        for bad in ["not json", "[1,2,3]", '{"type":"tilt","data":"x"}',
                    '{"type":"tilt","data":{"x":"abc","y":null,"ts":"zzz"}}', '{"type":123}', "null"]:
            ws.send_text(bad)
        assert read_states(ws, 3)                              # 여전히 살아서 위치를 보내 준다


def test_page_route_exists():
    with make_client() as c:
        # web/tilt-test.html 이 있어야 200
        assert c.get("/tilt-test").status_code == 200
