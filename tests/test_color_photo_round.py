"""다른 색 라운드에서 찍은 사진이 현재 점수에 들어가지 않는지 확인한다."""
import asyncio
import json

from starlette.websockets import WebSocketDisconnect
from games.color_hunt import game as color_hunt
from server import main as server_main


def photo(token):
    return {"image": "data:image/jpeg;base64,YQ==", "round_token": token}


async def wait_for_accepting(game, task):
    while not game.accepting:
        if task.done():
            raise AssertionError("라운드가 예상보다 일찍 끝났습니다")
        await asyncio.sleep(0)


def configured_game(monkeypatch, events):
    monkeypatch.setattr(color_hunt, "center_average_color", lambda raw: (10, 20, 30))
    monkeypatch.setattr(color_hunt, "similarity_score", lambda target, rgb: 42)

    async def broadcast(event):
        events.append(event)

    return color_hunt.ColorHunt(["민지"], broadcast)


def test_old_round_photo_is_rejected_and_current_photo_is_accepted(monkeypatch):
    events = []

    async def scenario():
        game = configured_game(monkeypatch, events)
        game.target = (10, 20, 30)
        game.accepting = True
        game.round_token = "new-round"
        game.round_deadline = asyncio.get_running_loop().time() + 30
        await game.on_photo("민지", photo("old-round"))
        assert game.round_scores == {}
        assert game.submitted == set()
        await game.on_photo("민지", photo("new-round"))
        assert game.round_scores == {"민지": 42}
        assert game.submitted == {"민지"}

    asyncio.run(scenario())
    rejected = [e for e in events if e["type"] == "ch_photo_rejected"]
    assert len(rejected) == 1
    assert rejected[0]["data"]["round_token"] == "old-round"
    accepted = [e for e in events if e["type"] == "ch_submitted"]
    assert accepted[0]["data"]["round_token"] == "new-round"


def test_duplicate_photo_does_not_replace_accepted_photo(monkeypatch):
    events = []

    async def scenario():
        game = configured_game(monkeypatch, events)
        game.target = (10, 20, 30)
        game.accepting = True
        game.round_token = "new-round"
        game.round_deadline = asyncio.get_running_loop().time() + 30
        await game.on_photo("민지", photo("new-round"))
        await game.on_photo("민지", photo("new-round"))
        assert game.round_scores == {"민지": 42}

    asyncio.run(scenario())
    assert len([e for e in events if e["type"] == "ch_submitted"]) == 1


def test_photo_without_round_token_is_not_accepted(monkeypatch):
    events = []

    async def scenario():
        game = configured_game(monkeypatch, events)
        game.target = (10, 20, 30)
        game.accepting = True
        game.round_token = "new-round"
        game.round_deadline = asyncio.get_running_loop().time() + 30
        await game.on_photo("민지", {"image": "data:image/jpeg;base64,YQ=="})
        assert game.round_scores == {}
        assert game.submitted == set()

    asyncio.run(scenario())


def test_photo_is_rejected_after_server_deadline_even_if_flag_is_still_true(monkeypatch):
    events = []

    async def scenario():
        game = configured_game(monkeypatch, events)
        game.target = (10, 20, 30)
        game.accepting = True
        game.round_token = "new-round"
        game.round_deadline = asyncio.get_running_loop().time() - 1
        await game.on_photo("민지", photo("new-round"))
        assert game.round_scores == {}
        assert game.submitted == set()

    asyncio.run(scenario())
    assert any(e["type"] == "ch_photo_rejected" for e in events)


def test_previous_round_packet_is_rejected_during_next_real_round(monkeypatch):
    monkeypatch.setattr(color_hunt, "RESULT_SECONDS", 0)
    monkeypatch.setattr(color_hunt, "ROUND_SECONDS", 3)
    events = []

    async def scenario():
        game = configured_game(monkeypatch, events)
        first = asyncio.create_task(game.play_round(0, 2, "빨강", "#d32f2f"))
        await asyncio.wait_for(wait_for_accepting(game, first), timeout=2)
        old_token = game.round_token
        game.all_in.set()  # 첫 라운드를 미제출로 종료
        await first

        second = asyncio.create_task(game.play_round(1, 2, "초록", "#388e3c"))
        await asyncio.wait_for(wait_for_accepting(game, second), timeout=2)
        new_token = game.round_token
        await game.on_photo("민지", photo(old_token))
        assert game.round_scores == {}
        await game.on_photo("민지", photo(new_token))
        await second
        assert game.totals["민지"] == 42
        return old_token, new_token

    old_token, new_token = asyncio.run(scenario())
    assert old_token != new_token
    assert any(e["type"] == "ch_photo_rejected" and e["data"]["round_token"] == old_token for e in events)
    assert any(e["type"] == "ch_submitted" and e["data"]["round_token"] == new_token for e in events)


def test_only_stale_photos_still_count_as_not_submitted(monkeypatch):
    monkeypatch.setattr(color_hunt, "COUNTDOWN", 0)
    monkeypatch.setattr(color_hunt, "RESULT_SECONDS", 0)
    monkeypatch.setattr(color_hunt, "ROUND_SECONDS", 3)
    monkeypatch.setattr(color_hunt, "ROUNDS", 2)
    events = []

    async def scenario():
        game = configured_game(monkeypatch, events)
        task = asyncio.create_task(game.run())

        async def wait_for_round(number):
            while sum(e["type"] == "ch_round" for e in events) < number or not game.accepting:
                if task.done():
                    raise AssertionError("게임이 예상보다 일찍 종료됐습니다")
                await asyncio.sleep(0)

        await asyncio.wait_for(wait_for_round(1), timeout=2)
        old_token = game.round_token
        game.all_in.set()
        await asyncio.wait_for(wait_for_round(2), timeout=2)
        await game.on_photo("민지", photo(old_token))
        game.all_in.set()
        return await task

    result = asyncio.run(scenario())
    assert result["winner"] is None
    assert result["scores"] == {"민지": 0}
    assert result["not_submitted"] == ["민지"]


def test_websocket_passes_round_token_to_game(monkeypatch):
    # 실제 ws_player 메시지 처리 경로를 네트워크 없이 실행한다.
    monkeypatch.setattr(server_main, "players", {})
    monkeypatch.setattr(server_main, "hosts", [])
    monkeypatch.setattr(server_main, "game", None)
    monkeypatch.setattr(server_main, "match_task", None)
    monkeypatch.setattr(server_main, "preparation", None)
    monkeypatch.setattr(color_hunt, "center_average_color", lambda raw: (10, 20, 30))
    monkeypatch.setattr(color_hunt, "similarity_score", lambda target, rgb: 42)

    class FakeSocket:
        def __init__(self):
            self.index = 0
            self.sent = []
            self.game = None

        async def accept(self):
            pass

        async def send_json(self, msg):
            self.sent.append(msg)

        async def send_text(self, msg):
            self.sent.append(json.loads(msg))

        async def receive_text(self):
            self.index += 1
            if self.index == 1:
                return json.dumps({"type": "join", "data": {"name": "민지"}})
            if self.index == 2:
                self.game = color_hunt.ColorHunt(["민지"], server_main.to_everyone)
                self.game.running = True
                self.game.accepting = True
                self.game.target = (10, 20, 30)
                self.game.round_token = "new-round"
                self.game.round_deadline = asyncio.get_running_loop().time() + 30
                server_main.game = self.game
                return json.dumps({"type": "photo", "data": photo("old-round")})
            if self.index == 3:
                return json.dumps({"type": "photo", "data": photo("new-round")})
            raise WebSocketDisconnect(1000)

    socket = FakeSocket()
    asyncio.run(server_main.ws_player(socket))
    assert socket.game.round_scores == {"민지": 42}
    assert any(e["type"] == "ch_photo_rejected" and e["data"]["round_token"] == "old-round" for e in socket.sent)
    assert any(e["type"] == "ch_submitted" and e["data"]["round_token"] == "new-round" for e in socket.sent)


def test_round_tokens_are_distinct_even_between_game_instances(monkeypatch):
    monkeypatch.setattr(color_hunt, "RESULT_SECONDS", 0)
    monkeypatch.setattr(color_hunt, "ROUND_SECONDS", 2)
    events = []

    async def scenario():
        game1 = configured_game(monkeypatch, events)
        game2 = configured_game(monkeypatch, events)
        for game, index in [(game1, 0), (game1, 1), (game2, 0)]:
            task = asyncio.create_task(game.play_round(index, 2, "빨강", "#d32f2f"))
            await asyncio.wait_for(wait_for_accepting(game, task), timeout=2)
            game.all_in.set()
            await task

    asyncio.run(scenario())
    tokens = [e["data"]["round_token"] for e in events if e["type"] == "ch_round"]
    assert len(tokens) == 3
    assert all(isinstance(token, str) and token for token in tokens)
    assert len(set(tokens)) == 3
