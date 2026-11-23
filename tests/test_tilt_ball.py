import asyncio

import pytest

from games.tilt_ball import game as tilt_ball
from games.tilt_ball.game import TiltBall

TINY = {"name": "짧은 길", "rows": ["########", "#S....G#", "########"]}


def fast(monkeypatch, **over):
    monkeypatch.setattr(tilt_ball, "MAZES", [TINY])
    monkeypatch.setattr(tilt_ball, "COUNT_FROM", 1)
    monkeypatch.setattr(tilt_ball, "INTRO_TIMEOUT", 0.5)
    for k, v in over.items():
        monkeypatch.setattr(tilt_ball, k, v)


class Bus:
    def __init__(self):
        self.msgs = []

    async def __call__(self, msg):
        self.msgs.append(msg)

    def types(self):
        return [m["type"] for m in self.msgs]

    def last(self, kind):
        return [m for m in self.msgs if m["type"] == kind][-1]["data"]


async def push(game, name, x, until=lambda: False, timeout=10):
    """게임이 끝나거나 until이 참이 될 때까지 x 방향으로 계속 기울인다."""
    end = asyncio.get_running_loop().time() + timeout
    while game.running and not until() and asyncio.get_running_loop().time() < end:
        await game.on_message(name, "tilt", {"x": x, "y": 0, "ts": 7})
        await asyncio.sleep(0.02)


def test_full_race_faster_player_wins(monkeypatch):
    fast(monkeypatch)
    bus = Bus()

    async def scenario():
        g = TiltBall(["빠름", "느림"], bus)
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.on_message("빠름", "tb_ready", {})
        await g.on_message("느림", "tb_ready", {})          # 모두 준비하면 25초를 안 기다린다
        while g.phase != "race":
            await asyncio.sleep(0.02)
        await asyncio.gather(push(g, "빠름", 1.0), push(g, "느림", 0.35))
        return await task

    r = asyncio.run(scenario())
    assert r["ranking"][0] == "빠름" and r["winner"] == "빠름"
    assert r["scores"]["빠름"] == 1000 and all(isinstance(v, int) and v >= 0 for v in r["scores"].values())
    t = bus.types()
    assert t.index("countdown") < t.index("tb_intro") < t.index("tb_count") < t.index("tb_state") < t.index("tb_over")
    assert bus.last("tb_state")["ts"]["빠름"] == 7           # 지연 계산용 시각을 돌려준다
    assert "vx" in bus.last("tb_state")["players"]["빠름"]


def test_intro_times_out_when_someone_never_presses(monkeypatch):
    fast(monkeypatch, TIME_LIMIT=1.0)
    bus = Bus()

    async def scenario():
        g = TiltBall(["a", "b"], bus)
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.on_message("a", "tb_ready", {})              # b는 안 누름
        return await asyncio.wait_for(task, 10)

    r = asyncio.run(scenario())
    assert r is not None and set(r["scores"]) == {"a", "b"}   # 시간이 지나 시작했고 둘 다 점수를 받는다


def test_tilt_before_race_is_ignored_and_bad_data_is_safe(monkeypatch):
    fast(monkeypatch, TIME_LIMIT=1.0)

    async def scenario():
        g = TiltBall(["a"], Bus())
        await g.on_message("a", "tilt", {"x": 1, "y": 0})     # 준비 단계: 무시
        assert g.world.balls["a"].tilt == (0.0, 0.0)
        g.phase = "race"
        for bad in (None, "문자열", [1], {"x": "abc"}, {"x": float("nan"), "y": 1}, {"ts": True}):
            await g.on_message("a", "tilt", bad)               # 에러 없이 무시
        await g.on_message("모르는사람", "tilt", {"x": 1})
        await g.on_message("a", "알수없는종류", {})

    asyncio.run(scenario())


def test_player_leaving_does_not_block_the_game(monkeypatch):
    fast(monkeypatch)

    async def scenario():
        g = TiltBall(["남음", "나감"], Bus())
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.on_message("남음", "tb_ready", {})
        await g.remove_player("나감")                          # 나간 사람 때문에 준비가 안 끝나면 안 된다
        while g.phase != "race":
            await asyncio.sleep(0.02)
        await push(g, "남음", 1.0)
        return await task

    r = asyncio.run(scenario())
    assert list(r["scores"]) == ["남음"] and r["winner"] == "남음"


def test_everyone_leaving_cancels(monkeypatch):
    fast(monkeypatch)
    bus = Bus()

    async def scenario():
        g = TiltBall(["a"], bus)
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.remove_player("a")
        return await asyncio.wait_for(task, 10)

    assert asyncio.run(scenario()) is None
    assert "game_cancelled" in bus.types() and "tb_over" not in bus.types()


def test_after_first_finisher_others_get_limited_time(monkeypatch):
    fast(monkeypatch, FINISH_GRACE=0.6)
    bus = Bus()

    async def scenario():
        g = TiltBall(["빠름", "멈춤"], bus)
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.on_message("빠름", "tb_ready", {})
        await g.on_message("멈춤", "tb_ready", {})
        while g.phase != "race":
            await asyncio.sleep(0.02)
        await push(g, "빠름", 1.0)                              # 멈춤은 가만히
        return g, await asyncio.wait_for(task, 10)

    g, r = asyncio.run(scenario())
    assert r["ranking"] == ["빠름", "멈춤"] and g.world.time < 10   # 90초를 다 기다리지 않았다
    assert r["results"]["멈춤"]["finish_time"] is None
