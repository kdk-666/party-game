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


def test_with_three_players_the_rest_get_limited_time_after_first_finisher(monkeypatch):
    """3명이면 한 명이 도착해도 아직 2명이 남았으니 바로 끝나지 않고, 제한된 시간(FINISH_GRACE)만 더 기다린다."""
    fast(monkeypatch, FINISH_GRACE=0.8)

    async def scenario():
        g = TiltBall(["빠름", "멈춤1", "멈춤2"], Bus())
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        for n in g.names:
            await g.on_message(n, "tb_ready", {})
        while g.phase != "race":
            await asyncio.sleep(0.02)
        await push(g, "빠름", 1.0)                              # 나머지 둘은 가만히
        return g, await asyncio.wait_for(task, 10)

    g, r = asyncio.run(scenario())
    assert r["ranking"][0] == "빠름" and r["reason"] == "time"
    assert r["results"]["멈춤1"]["finish_time"] is None and g.world.time < 10   # 90초를 다 기다리지 않았다


def test_two_players_game_ends_as_soon_as_one_finishes(monkeypatch):
    """2명이면 한 명이 도착하는 순간 못 들어온 사람이 한 명만 남으니 바로 끝난다."""
    fast(monkeypatch, FINISH_GRACE=60.0)                         # 유예 시간이 길어도 상관없이 끝나야 한다
    bus = Bus()

    async def scenario():
        g = TiltBall(["빠름", "느림"], bus)
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.on_message("빠름", "tb_ready", {})
        await g.on_message("느림", "tb_ready", {})
        while g.phase != "race":
            await asyncio.sleep(0.02)
        await push(g, "빠름", 1.0)
        return g, await asyncio.wait_for(task, 10)

    g, r = asyncio.run(scenario())
    assert r["reason"] == "last_one" and r["ranking"] == ["빠름", "느림"]
    assert r["scores"] == {"빠름": 1000, "느림": 700}
    assert g.world.time < 8                                       # 60초 유예를 기다리지 않았다
    assert bus.last("tb_over")["reason"] == "last_one"
    assert bus.last("tb_state")["players"]["빠름"]["state"] == "finished"   # 마지막 화면에 도착 상태가 담겼다


def test_four_players_end_when_three_have_finished(monkeypatch):
    fast(monkeypatch, FINISH_GRACE=60.0, TIME_LIMIT=60.0)

    async def scenario():
        g = TiltBall(["a", "b", "c", "d"], Bus())
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        for n in g.names:
            await g.on_message(n, "tb_ready", {})
        while g.phase != "race":
            await asyncio.sleep(0.02)
        # a, b, c는 세기가 다르게 도착, d는 가만히
        await asyncio.gather(push(g, "a", 1.0), push(g, "b", 0.8), push(g, "c", 0.6))
        return g, await asyncio.wait_for(task, 20)

    g, r = asyncio.run(scenario())
    assert r["reason"] == "last_one" and r["ranking"][-1] == "d"
    assert [r["results"][n]["finish_time"] is not None for n in "abc"] == [True, True, True]
    assert r["results"]["d"]["finish_time"] is None


def test_single_player_ends_only_when_finished(monkeypatch):
    """혼자 하는 판은 '마지막 한 명' 규칙이 적용되지 않는다 (시작하자마자 끝나면 안 된다)."""
    fast(monkeypatch)

    async def scenario():
        g = TiltBall(["혼자"], Bus())
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.on_message("혼자", "tb_ready", {})
        while g.phase != "race":
            await asyncio.sleep(0.02)
        await asyncio.sleep(0.4)
        assert not task.done()                                    # 아직 도착 전: 끝나지 않았다
        await push(g, "혼자", 1.0)
        return await asyncio.wait_for(task, 10)

    r = asyncio.run(scenario())
    assert r["reason"] == "all_finished" and r["winner"] == "혼자"


def test_when_players_leave_to_one_the_rule_does_not_end_the_game(monkeypatch):
    """2명 중 한 명이 나가서 한 명만 남은 판은 그 사람이 도착할 때까지 계속된다."""
    fast(monkeypatch)

    async def scenario():
        g = TiltBall(["남음", "나감"], Bus())
        task = asyncio.create_task(g.run())
        await asyncio.sleep(0.05)
        await g.on_message("남음", "tb_ready", {})
        await g.on_message("나감", "tb_ready", {})
        while g.phase != "race":
            await asyncio.sleep(0.02)
        await g.remove_player("나감")
        await asyncio.sleep(0.3)
        assert not task.done()
        await push(g, "남음", 1.0)
        return await asyncio.wait_for(task, 10)

    r = asyncio.run(scenario())
    assert r["reason"] == "all_finished" and list(r["scores"]) == ["남음"]


def test_maze_is_random_each_game_and_never_repeats_back_to_back():
    from games.tilt_ball.maze import MAZES
    names = [TiltBall(["a"], Bus()).maze.name for _ in range(300)]
    assert set(names) == {m["name"] for m in MAZES}                # 모든 미로가 골고루 나온다
    assert all(a != b for a, b in zip(names, names[1:]))           # 같은 미로가 연속으로 나오지 않는다


@pytest.mark.parametrize('map_name', [m['name'] for m in tilt_ball.MAZES])
def test_virtual_player_finishes_real_maze(map_name):
    g = TiltBall(['bot', 'human'], Bus(), map_name=map_name)
    g.virtual_players = {'bot'}
    g.phase = 'race'
    g.bot_speeds['bot'] = 1.7
    for _ in range(2700):
        g.update_virtual_players()
        g.world.step(1/30)
        if g.world.balls['bot'].finish_time is not None:
            break
    assert g.world.balls['bot'].finish_time is not None
    assert g.world.balls['bot'].falls == 0
    assert g.world.balls['human'].tilt == (0, 0)


def test_virtual_player_ready_and_races(monkeypatch):
    fast(monkeypatch, COUNT_FROM=0)
    async def scenario():
        g = TiltBall(['bot'], Bus())
        g.virtual_players = {'bot'}
        result = await asyncio.wait_for(g.run(), 10)
        assert g.ready == {'bot'}
        assert result['reason'] == 'all_finished'
    asyncio.run(scenario())
