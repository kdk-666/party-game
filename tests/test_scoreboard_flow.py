"""대회 집계, 공동 우승, 이탈과 로비 복귀를 실제 서버 메시지로 검증한다."""
import asyncio
import json
import queue
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import server.main as main
from server.match import Match


class FakeGame:
    def __init__(self, names, broadcast):
        self.names = names
        self.broadcast = broadcast
        self.running = False

    async def run(self):
        await self.broadcast({"type": "countdown", "data": {}})
        self.running = False
        result = {"scores": {name: 1000 for name in self.names}}
        await self.broadcast({"type": "fake_result", "data": result})
        return result

    async def remove_player(self, name):
        pass

    async def on_motion(self, name, value):
        pass


def until(socket, kind):
    # 서버 메시지가 빠져도 테스트가 무한히 멈추지 않게 한다.
    result = queue.Queue()

    def receive():
        try:
            while True:
                message = socket.receive_json()
                if message["type"] == kind:
                    result.put((True, message["data"]))
                    return
        except BaseException as error:
            result.put((False, error))

    threading.Thread(target=receive, daemon=True).start()
    try:
        ok, value = result.get(timeout=8)
    except queue.Empty:
        raise AssertionError(f"{kind} 메시지를 받지 못했습니다") from None
    if not ok:
        raise value
    return value


def fast_main(monkeypatch):
    monkeypatch.setattr(main, "GAME_RESULT_SECONDS", 0)
    monkeypatch.setattr(main, "LAST_GAME_RESULT_SECONDS", 0)
    monkeypatch.setattr(main, "INTERMISSION_SECONDS", 0.5)
    monkeypatch.setattr(main, "FINAL_SECONDS", 0.3)
    monkeypatch.setattr(main, "players", {})
    monkeypatch.setattr(main, "hosts", [])
    monkeypatch.setattr(main, "game", None)
    monkeypatch.setattr(main, "match_task", None)
    monkeypatch.setattr(main, "active_match", None)
    monkeypatch.setattr(main, "preparation", None)


def test_last_round_is_shown_before_final_and_disconnected_player_is_excluded(monkeypatch):
    fast_main(monkeypatch)
    monkeypatch.setattr(main, "GAME_REGISTRY", {"fake": {"name": "테스트 게임", "instructions": [], "game_class": FakeGame}})

    with TestClient(main.app) as client, client.websocket_connect("/ws/host") as host, \
            client.websocket_connect("/ws/player") as p2:
        p2.send_json({"type": "join", "data": {"name": "서연"}})
        until(p2, "join_ok")
        with client.websocket_connect("/ws/player") as p1:
            p1.send_json({"type": "join", "data": {"name": "민지"}})
            until(p1, "join_ok")
            host.send_json({"type": "start", "data": {}})
            token1 = until(p1, "round_start")["token"]
            token2 = until(p2, "round_start")["token"]
            assert token1 == token2
            p1.send_json({"type": "ready", "data": {"token": token1}})
            p2.send_json({"type": "ready", "data": {"token": token2}})
            result = until(p2, "round_result")
            assert result["round"] == result["total_rounds"] == 1
            assert result["scores"] == {"서연": 1000, "민지": 1000}
            assert set(result["winners"]) == {"민지", "서연"}
            assert result["seconds"] > 0
            # 마지막 집계 도중 민지가 나가면, 점수는 보존하고 순위에서 제외한다.
            p1.close()
            update = until(p2, "match_standings_update")
            assert update["winners"] == ["서연"]
            left = next(s for s in update["standings"] if s["name"] == "민지")
            assert left["score"] == 1000 and left["rank"] is None and not left["connected"]
            final = until(p2, "match_over")
            assert final["winners"] == ["서연"]
            assert final["total_scores"] == {"서연": 1000, "민지": 1000}
            assert final["seconds"] > 0
            until(p2, "return_lobby")
            until(host, "return_lobby")
            # 기존 연결을 유지한 채 호스트가 새로운 대회를 시작할 수 있다.
            host.send_json({"type": "start", "data": {}})
            assert until(p2, "round_start")["players"] == ["서연"]


def test_final_winner_updates_if_a_player_leaves_during_final_screen(monkeypatch):
    fast_main(monkeypatch)
    monkeypatch.setattr(main, "INTERMISSION_SECONDS", 0)
    monkeypatch.setattr(main, "FINAL_SECONDS", 0.6)
    monkeypatch.setattr(main, "GAME_REGISTRY", {"fake": {"name": "게임", "instructions": [], "game_class": FakeGame}})
    with TestClient(main.app) as client, client.websocket_connect("/ws/host") as host, \
            client.websocket_connect("/ws/player") as p1, client.websocket_connect("/ws/player") as p2:
        for socket, name in ((p1, "민지"), (p2, "서연")):
            socket.send_json({"type": "join", "data": {"name": name}})
            until(socket, "join_ok")
        host.send_json({"type": "start", "data": {}})
        token1, token2 = until(p1, "round_start")["token"], until(p2, "round_start")["token"]
        p1.send_json({"type": "ready", "data": {"token": token1}})
        p2.send_json({"type": "ready", "data": {"token": token2}})
        assert set(until(p2, "match_over")["winners"]) == {"민지", "서연"}
        p1.close()
        update = until(p2, "match_standings_update")
        assert update["winners"] == ["서연"]
        left = next(item for item in update["standings"] if item["name"] == "민지")
        assert left["score"] == 1000 and left["rank"] is None
        until(p2, "return_lobby")
        until(host, "return_lobby")


@pytest.mark.parametrize("total, completed, expected", [(3, 1, 4), (3, 3, 3), (1, 1, 3), (8, 8, 3)])
def test_game_result_is_visible_before_scoreboard(monkeypatch, total, completed, expected):
    games = {f"fake{i}": {"name": "테스트", "game_class": FakeGame} for i in range(total)}
    match = Match(["민지"], games)
    match.completed_rounds = completed
    match.total_scores["민지"] = 1000
    events = []

    async def wait(seconds):
        events.append(("wait", seconds))

    async def record(event):
        events.append((event["type"], event["data"]))

    monkeypatch.setattr(main, "players", {object(): "민지"})
    monkeypatch.setattr(main, "asyncio", SimpleNamespace(sleep=wait))
    monkeypatch.setattr(main, "to_everyone", record)
    asyncio.run(main.send_match_result(match, "fake0", {"scores": {"민지": 1000}}))
    assert events[0] == ("wait", expected)
    assert events[1][0] == "round_result"
    assert events[1][1]["seconds"] == 4
    assert events[2] == ("wait", 4)
    assert main.FINAL_SECONDS == 10


def test_eight_games_emit_eight_scoreboards_before_final(monkeypatch):
    fast_main(monkeypatch)
    monkeypatch.setattr(main, "INTERMISSION_SECONDS", 0)
    monkeypatch.setattr(main, "FINAL_SECONDS", 0)
    main.players[object()] = "민지"
    games = {"game" + str(i): {"name": "게임" + str(i), "game_class": FakeGame} for i in range(8)}
    match = Match(["민지"], games)
    events = []

    async def record(event):
        events.append(event)

    async def record_sockets(sockets, event):
        events.append(event)

    async def ready(*args):
        return True

    monkeypatch.setattr(main, "to_everyone", record)
    monkeypatch.setattr(main, "send_all", record_sockets)
    monkeypatch.setattr(main, "to_hosts", record)
    monkeypatch.setattr(main, "send_lobby", lambda: asyncio.sleep(0))
    monkeypatch.setattr(main, "send_match_start", ready)
    monkeypatch.setattr(main, "active_match", match)
    asyncio.run(main.run_match(match))
    scoreboards = [event for event in events if event["type"] == "round_result"]
    assert [event["data"]["round"] for event in scoreboards] == list(range(1, 9))
    assert all(event["data"]["total_rounds"] == 8 for event in scoreboards)
    game_results = [event["type"] for event in events if event["type"] in ("fake_result", "round_result")]
    assert game_results == [kind for _ in range(8) for kind in ("fake_result", "round_result")]
    assert match.total_scores == {"민지": 8000}
    assert [event["type"] for event in events][-4:] == ["round_result", "match_over", "return_lobby", "return_lobby"]
