"""컬러헌트 미제출과 제출한 0점을 구분하는 회귀 테스트."""
import asyncio

from games.color_hunt import game as color_hunt
from server.match import Match


def run_rounds(monkeypatch, names, submissions, similarity=50):
    monkeypatch.setattr(color_hunt, "COUNTDOWN", 0)
    monkeypatch.setattr(color_hunt, "RESULT_SECONDS", 0)
    monkeypatch.setattr(color_hunt, "ROUND_SECONDS", 3)
    monkeypatch.setattr(color_hunt, "ROUNDS", len(submissions))
    monkeypatch.setattr(color_hunt, "center_average_color", lambda raw: (0, 0, 0))
    monkeypatch.setattr(color_hunt, "similarity_score", lambda target, rgb: similarity)
    events = []

    async def broadcast(event):
        events.append(event)

    async def scenario():
        game = color_hunt.ColorHunt(names, broadcast)
        task = asyncio.create_task(game.run())

        async def wait_for_round(index):
            while sum(e["type"] == "ch_round" for e in events) <= index or not game.accepting:
                if task.done():
                    raise AssertionError("예상보다 일찍 게임이 끝났습니다")
                await asyncio.sleep(0)

        for index, submitted in enumerate(submissions):
            await asyncio.wait_for(wait_for_round(index), timeout=2)
            for name in submitted:
                await game.on_photo(name, {"image": "data:image/jpeg;base64,YQ==", "round_token": game.round_token})
            # 미제출자가 있으면 제한시간이 끝난 것처럼 라운드를 종료한다.
            game.all_in.set()
        result = await task
        return result

    return asyncio.run(scenario()), events


def test_all_missing_get_zero_and_no_winner(monkeypatch):
    result, events = run_rounds(monkeypatch, ["가", "나"], [[]])
    assert result["winner"] is None
    assert result["scores"] == {"가": 0, "나": 0}
    assert set(result["not_submitted"]) == {"가", "나"}
    assert set(result["ranking"]) == {"가", "나"}
    assert [event["data"] for event in events if event["type"] == "ch_over"] == [result]

    # 0점 결과도 공통 대회 관리자가 정상적으로 누적해야 한다.
    match = Match(["가", "나"], {"color_hunt": {}})
    game_id, _ = match.start_next_round()
    match.finish_round(game_id, result)
    assert match.total_scores == {"가": 0, "나": 0}


def test_valid_zero_is_not_the_same_as_missing(monkeypatch):
    result, _ = run_rounds(monkeypatch, ["제출", "미제출"], [["제출"]], similarity=0)
    assert result["totals"] == {"제출": 0, "미제출": 0}
    assert result["winner"] == "제출"
    assert result["ranking"][0] == "제출"
    assert result["scores"] == {"제출": 1000, "미제출": 0}
    assert result["not_submitted"] == ["미제출"]


def test_partial_submission_is_eligible_and_never_submitted_is_zero(monkeypatch):
    result, _ = run_rounds(monkeypatch, ["가", "나", "다"], [["가", "나"], ["가"]])
    assert result["totals"] == {"가": 100, "나": 50, "다": 0}
    assert result["scores"] == {"가": 1000, "나": 700, "다": 0}
    assert result["ranking"] == ["가", "나", "다"]
    assert result["not_submitted"] == ["다"]


def test_zero_point_submissions_keep_existing_tie_points(monkeypatch):
    result, _ = run_rounds(monkeypatch, ["가", "나"], [["가", "나"]], similarity=0)
    assert result["winner"] in {"가", "나"}
    assert result["scores"] == {"가": 1000, "나": 1000}
    assert result["not_submitted"] == []
