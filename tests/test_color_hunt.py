import asyncio
import base64
import io

from PIL import Image

from games.color_hunt import game as color_hunt
from games.color_hunt.game import ColorHunt


def data_url(color, round_token):
    buf = io.BytesIO()
    Image.new("RGB", (60, 60), color).save(buf, "JPEG")
    return {"image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            "round_token": round_token}


def fast(monkeypatch):
    monkeypatch.setattr(color_hunt, "COUNTDOWN", 0)
    monkeypatch.setattr(color_hunt, "RESULT_SECONDS", 0)
    monkeypatch.setattr(color_hunt, "ROUND_SECONDS", 2)
    monkeypatch.setattr(color_hunt, "ROUNDS", 2)


def test_closer_color_wins(monkeypatch):
    fast(monkeypatch)
    sent = []

    async def broadcast(msg):
        sent.append(msg)

    def rounds_started():
        return sum(1 for m in sent if m["type"] == "ch_round")

    async def scenario():
        g = ColorHunt(["a", "b"], broadcast)
        task = asyncio.create_task(g.run())
        for i in range(2):                       # 2라운드
            while rounds_started() < i + 1 or not g.accepting:
                await asyncio.sleep(0.01)
            t = tuple(g.target)
            await g.on_photo("a", data_url(t, g.round_token))         # 같은 색
            await g.on_photo("b", data_url((255 - t[0], 255 - t[1], 255 - t[2]), g.round_token))
        return await task

    result = asyncio.run(scenario())
    assert result["winner"] == "a"
    assert result["scores"]["a"] == 1000 and result["scores"]["b"] == 700
    assert all(isinstance(v, int) for v in result["scores"].values())


def test_bad_image_and_missing_submission(monkeypatch):
    fast(monkeypatch)
    sent = []

    async def broadcast(msg):
        sent.append(msg["type"])

    async def scenario():
        g = ColorHunt(["a", "b"], broadcast)
        task = asyncio.create_task(g.run())
        while not g.accepting:
            await asyncio.sleep(0.01)
        await g.on_photo("a", {"image": "not-base64!!", "round_token": g.round_token})  # 깨진 데이터는 에러 메시지만
        await g.on_photo("b", None)
        return await task

    result = asyncio.run(scenario())
    assert "ch_photo_error" in sent
    assert result["totals"] == {"a": 0, "b": 0}     # 아무도 못 내면 0점
    assert result["scores"] == {"a": 0, "b": 0}
    assert result["winner"] is None
    assert set(result["not_submitted"]) == {"a", "b"}


def test_everyone_left_cancels(monkeypatch):
    fast(monkeypatch)
    sent = []

    async def broadcast(msg):
        sent.append(msg["type"])

    async def scenario():
        g = ColorHunt(["a"], broadcast)
        task = asyncio.create_task(g.run())
        while not g.accepting:
            await asyncio.sleep(0.01)
        await g.remove_player("a")
        return await task

    assert asyncio.run(scenario()) is None
    assert "game_cancelled" in sent
