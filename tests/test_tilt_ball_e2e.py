"""실제 서버(main.py)를 통과하는 전체 흐름: 접속 -> 시작 -> 준비 -> 경주 -> 대회 종료."""
import json

from fastapi.testclient import TestClient

import server.main as m
from games.tilt_ball import game as tilt_ball
from games.tilt_ball.game import TiltBall

TINY = {"name": "짧은 길", "rows": ["########", "#S....G#", "########"]}


def until(ws, kind):
    while True:
        msg = ws.receive_json()
        if msg["type"] == kind:
            return msg["data"]


def test_two_phones_race_through_the_real_server(monkeypatch):
    monkeypatch.setattr(tilt_ball, "MAZES", [TINY])
    monkeypatch.setattr(tilt_ball, "COUNT_FROM", 1)
    monkeypatch.setattr(tilt_ball, "FINISH_GRACE", 1.0)
    monkeypatch.setattr(m, "GAME_REGISTRY", {"tilt_ball": {
        "name": "기울여서 공 굴리기", "instructions": ["규칙"], "game_class": TiltBall}})

    with TestClient(m.app) as c, c.websocket_connect("/ws/host") as host, \
            c.websocket_connect("/ws/player") as p1, c.websocket_connect("/ws/player") as p2:
        for ws, name in ((p1, "민준"), (p2, "서연")):
            ws.send_text(json.dumps({"type": "join", "data": {"name": name}}))
            assert until(ws, "join_ok")["name"] == name
        host.send_text(json.dumps({"type": "start", "data": {}}))

        token = until(p1, "round_start")["token"]                   # 기존 준비(설명) 화면
        until(p2, "round_start")
        for ws in (p1, p2):
            ws.send_text(json.dumps({"type": "ready", "data": {"token": token}}))

        intro = until(p1, "tb_intro")                               # 이 게임의 준비 단계
        assert intro["maze"]["rows"] == TINY["rows"]
        until(p2, "tb_intro")
        for ws in (p1, p2):
            ws.send_text(json.dumps({"type": "tb_ready", "data": {}}))
        until(p1, "tb_count")

        # 경주: 민준은 세게, 서연은 약하게 기울인다
        until(p1, "tb_state"); until(p2, "tb_state")
        over = None
        for _ in range(600):
            p1.send_text(json.dumps({"type": "tilt", "data": {"x": 1.0, "y": 0, "ts": 1}}))
            p2.send_text(json.dumps({"type": "tilt", "data": {"x": 0.3, "y": 0, "ts": 2}}))
            msg = p1.receive_json()
            if msg["type"] == "tb_over":
                over = msg["data"]
                break
            p2.receive_json()
        assert over is not None, "게임이 끝나지 않았어요"
        assert over["ranking"] == ["민준", "서연"] and over["scores"] == {"민준": 1000, "서연": 700}

        final = until(p1, "match_over")                             # 대회 총점에 반영된다
        assert final["total_scores"] == {"민준": 1000, "서연": 700}
