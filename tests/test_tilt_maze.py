import math
import random

import pytest

from games.tilt_ball import maze as T
from games.tilt_ball.maze import MAZES, Maze, TiltWorld


def all_mazes():
    return [Maze(m["name"], m["rows"]) for m in MAZES]


# ---------- 미로 자체 ----------
@pytest.mark.parametrize("maze", all_mazes(), ids=lambda m: m.name)
def test_maze_is_valid_and_solvable_without_touching_holes(maze):
    assert maze.safe_path() is not None            # 구멍을 안 밟고 갈 수 있는 길이 있어야 한다
    assert all(cp in maze.dist for cp in maze.checkpoints)
    for r in range(maze.height):                   # 바깥 테두리는 전부 벽
        assert maze.is_wall(0, r) and maze.is_wall(maze.width - 1, r)


def test_maze_rejects_bad_input():
    with pytest.raises(ValueError):
        Maze("x", ["###", "#S#G"])                 # 줄 길이가 다름
    with pytest.raises(ValueError):
        Maze("x", ["###", "#S#", "###"])           # 도착점 없음
    with pytest.raises(ValueError):
        Maze("x", ["#####", "#S?G#", "#####"])     # 알 수 없는 글자


SMALL = ["#######",
         "#S...G#",
         "#######"]


def test_progress_goes_from_0_to_1():
    m = Maze("s", SMALL)
    assert m.progress(1.5, 1.5) == 0 and m.progress(5.5, 1.5) == 1
    assert 0.4 < m.progress(3.5, 1.5) < 0.6


# ---------- 공 물리 ----------
def test_ball_rolls_in_tilt_direction_and_stops_at_wall():
    w = TiltWorld(Maze("s", ["#####", "#S.G#", "#...#", "#####"]), ["a"], time_limit=99)
    w.set_tilt("a", 1, 0)
    for _ in range(90):
        w.step(1 / 30)
    b = w.balls["a"]
    assert b.x > 3.0                               # 오른쪽으로 굴렀다
    assert b.x <= 4 - T.RADIUS + 0.02              # 벽(x=4)을 뚫지 못한다 (엔진 허용 오차 포함)


def test_ball_stops_by_friction_when_flat():
    w = TiltWorld(Maze("s", SMALL), ["a"], time_limit=99)
    w.set_tilt("a", 1, 0)
    for _ in range(15):
        w.step(1 / 30)
    w.set_tilt("a", 0, 0)
    for _ in range(300):
        w.step(1 / 30)
    assert math.hypot(w.balls["a"].vx, w.balls["a"].vy) < 0.05


def test_speed_is_capped():
    w = TiltWorld(Maze("s", ["#" * 40, "#S" + "." * 36 + "G#", "#" * 40]), ["a"], time_limit=99)
    w.set_tilt("a", 1, 0)
    for _ in range(120):
        w.step(1 / 30)
    assert math.hypot(w.balls["a"].vx, w.balls["a"].vy) <= T.MAX_SPEED + 1e-3


def test_bad_tilt_values_are_ignored_or_clamped():
    w = TiltWorld(Maze("s", SMALL), ["a"])
    w.set_tilt("a", float("nan"), 5)
    assert w.balls["a"].tilt == (0.0, 0.0)
    w.set_tilt("a", 99, -99)
    assert w.balls["a"].tilt == (1.0, -1.0)
    w.set_tilt("없는사람", 1, 1)                    # 모르는 이름은 무시 (에러 없음)
    w.set_tilt("a", "abc", None)                   # 숫자가 아닌 값도 에러 없이 무시
    assert w.balls["a"].tilt == (1.0, -1.0)


def test_random_tilting_never_leaves_the_maze():
    maze = all_mazes()[0]
    w = TiltWorld(maze, ["a", "b"], time_limit=999)
    rng = random.Random(3)
    for _ in range(30 * 120):                      # 120초
        for n in ("a", "b"):
            w.set_tilt(n, rng.uniform(-1, 1), rng.uniform(-1, 1))
        w.step(1 / 30)
        for b in w.balls.values():
            assert not maze.is_wall(int(b.x), int(b.y))


def test_wall_rects_cover_exactly_the_wall_cells():
    for maze in all_mazes():
        covered = set()
        for x0, y0, x1, y1 in maze.wall_rects():
            for c in range(x0, x1):
                for r in range(y0, y1):
                    assert (c, r) not in covered           # 겹치지 않는다
                    covered.add((c, r))
        assert covered == maze.walls                        # 빠짐없이 덮는다
        assert len(maze.wall_rects()) < len(maze.walls) / 2  # 칸마다 상자를 만든 것보다 훨씬 적다


def test_balls_pass_through_each_other():
    w = TiltWorld(Maze("s", SMALL), ["a", "b"], time_limit=99)
    assert w.balls["a"].x == w.balls["b"].x            # 같은 자리에서 시작해도 밀어내지 않는다
    w.set_tilt("a", 1, 0)
    w.set_tilt("b", 1, 0)
    for _ in range(30):
        w.step(1 / 30)
    assert abs(w.balls["a"].x - w.balls["b"].x) < 1e-6


# ---------- 구멍 / 체크포인트 / 도착 ----------
HOLE_MAP = ["##########",
            "#S.O..C.G#",
            "##########"]


def test_falling_in_a_hole_returns_to_checkpoint():
    w = TiltWorld(Maze("h", HOLE_MAP), ["a"], time_limit=99)
    w.set_tilt("a", 1, 0)
    for _ in range(60):
        w.step(1 / 30)
        if w.balls["a"].state == "fallen":
            break
    b = w.balls["a"]
    assert b.state == "fallen" and b.falls == 1
    w.set_tilt("a", 0, 0)
    for _ in range(40):
        w.step(1 / 30)
    assert b.state == "rolling" and (int(b.x), int(b.y)) == (1, 1)     # 아직 체크포인트가 없으니 시작점


def test_checkpoint_is_remembered():
    maze = Maze("h", ["##########", "#S.C.O..G#", "##########"])
    w = TiltWorld(maze, ["a"], time_limit=99)
    w.set_tilt("a", 1, 0)
    for _ in range(200):
        w.step(1 / 30)
        if w.balls["a"].state == "fallen":
            break
    w.set_tilt("a", 0, 0)
    for _ in range(40):
        w.step(1 / 30)
    assert (int(w.balls["a"].x), int(w.balls["a"].y)) == (3, 1)         # 체크포인트로 복귀


def test_snapshot_has_every_field_the_screens_read():
    """화면(JS)이 읽는 항목이 snapshot에 전부 있어야 한다 (finish_time이 빠져 'undefined초'가 뜬 적이 있음)."""
    w = TiltWorld(Maze("s", SMALL), ["a"], time_limit=99)
    need = {"x", "y", "vx", "vy", "state", "progress", "falls", "finish_time", "reached", "cp_saves"}
    assert need <= set(w.snapshot()["a"])
    assert w.snapshot()["a"]["finish_time"] is None
    w.set_tilt("a", 1, 0)
    for _ in range(300):
        w.step(1 / 30)
    snap = w.snapshot()["a"]
    assert snap["state"] == "finished" and isinstance(snap["finish_time"], float) and snap["finish_time"] > 0


def test_finishing_records_time_and_stops_ball():
    w = TiltWorld(Maze("s", SMALL), ["a"], time_limit=99)
    w.set_tilt("a", 1, 0)
    for _ in range(300):
        w.step(1 / 30)
    b = w.balls["a"]
    assert b.state == "finished" and b.finish_time is not None and w.finished


def test_flag_turns_on_and_saves_only_when_ahead():
    maze = Maze("h", ["##########", "#S.C.C..G#", "##########"])        # 가까운 깃발(5,1)이 도착에 더 가깝다
    w = TiltWorld(maze, ["a"], time_limit=99)
    b = w.balls["a"]
    b.place(5.5, 1.5)
    w.step(0.01)
    assert (5, 1) in b.reached and b.checkpoint == (5, 1) and b.cp_saves == 1
    b.place(3.5, 1.5)                                  # 뒤쪽 깃발: 노랗게는 되지만 저장은 안 된다
    w.step(0.01)
    assert (3, 1) in b.reached and b.checkpoint == (5, 1) and b.cp_saves == 1
    b.place(5.5, 1.5)                                  # 같은 깃발을 또 밟아도 횟수는 그대로
    w.step(0.01)
    assert b.cp_saves == 1
    snap = w.snapshot()["a"]
    assert snap["reached"] == [[3, 1], [5, 1]] and snap["cp_saves"] == 1


# ---------- 순위 ----------
def test_ranking_prefers_finishers_then_progress():
    w = TiltWorld(Maze("s", SMALL), ["a", "b", "c", "d"], time_limit=99)
    w.balls["b"].finish_time, w.balls["b"].state = 5.0, "finished"
    w.balls["a"].finish_time, w.balls["a"].state = 9.0, "finished"
    w.balls["c"].best_progress = 0.7
    w.balls["d"].best_progress = 0.2
    assert w.ranking() == ["b", "a", "c", "d"]
    assert w.scores() == {"b": 1000, "a": 700, "c": 500, "d": 300}


def test_time_limit_ends_the_game():
    w = TiltWorld(Maze("s", SMALL), ["a"], time_limit=2.0)
    for _ in range(90):
        w.step(1 / 30)
    assert w.finished and w.time <= 2.0 + T.SUBSTEP + 1e-9


# ---------- 연습 봇: 실제로 굴려서 끝까지 갈 수 있나 ----------
def run_bot(maze, max_tilt=1.0, seconds=90, avoid_holes=True):
    w = TiltWorld(maze, ["bot"], time_limit=seconds)
    path = maze.safe_path()
    target_i = 1
    b = w.balls["bot"]
    while not w.finished:
        if b.state == "fallen":
            w.step(1 / 30)
            if b.state == "rolling":                       # 체크포인트에서 다시 출발
                target_i = min(range(len(path)), key=lambda i: (path[i][0] + .5 - b.x) ** 2 + (path[i][1] + .5 - b.y) ** 2) + 1
            continue
        tx, ty = path[min(target_i, len(path) - 1)]
        tx, ty = tx + 0.5, ty + 0.5
        if math.hypot(tx - b.x, ty - b.y) < 0.45 and target_i < len(path) - 1:
            target_i += 1
            tx, ty = path[target_i][0] + 0.5, path[target_i][1] + 0.5
        dx, dy = tx - b.x, ty - b.y
        d = math.hypot(dx, dy) or 1.0
        want = min(3.0, d * 3.0)                           # 가까우면 천천히
        ax = max(-max_tilt, min(max_tilt, (dx / d * want - b.vx) * 0.6))
        ay = max(-max_tilt, min(max_tilt, (dy / d * want - b.vy) * 0.6))
        w.set_tilt("bot", ax, ay)
        w.step(1 / 30)
    return b


@pytest.mark.parametrize("maze", all_mazes(), ids=lambda m: m.name)
def test_skilled_player_can_finish_well_within_time(maze):
    b = run_bot(maze)
    assert b.finish_time is not None and b.finish_time < 45


@pytest.mark.parametrize("maze", all_mazes(), ids=lambda m: m.name)
def test_careful_player_with_half_tilt_can_still_finish(maze):
    b = run_bot(maze, max_tilt=0.5)
    assert b.finish_time is not None and b.finish_time < 60


# ---------- 미로 밸런스 (새 미로를 추가할 때 이 기준을 지켜야 한다) ----------
def test_mazes_are_balanced_and_fair():
    names = set()
    for m in MAZES:
        assert m["name"] not in names                              # 이름이 겹치지 않는다
        names.add(m["name"])
        assert m["level"] in (1, 2, 3)                              # 난이도 1~3
        mz = Maze(m["name"], m["rows"], m["level"])
        assert mz.width <= 13 and mz.height <= 20                   # 폰/노트북 화면에 무리 없는 크기
        assert 35 <= len(mz.safe_path()) <= 55                      # 길이가 비슷해야 한 판 시간이 비슷하다
        assert len(mz.checkpoints) >= 2 and len(mz.holes) <= 12     # 깃발은 2개 이상, 구멍은 12개 이하
        for spot in [mz.start, mz.goal, *mz.checkpoints]:           # 출발/도착/깃발은 구멍과 붙어 있지 않다
            for h in mz.holes:
                assert abs(spot[0] - h[0]) + abs(spot[1] - h[1]) >= 2, (m["name"], spot, h)
        assert 14 <= run_bot(mz).finish_time <= 26, m["name"]       # 연습 봇이 14~26초에 도착


def test_each_segment_of_a_level2_course_has_2_to_4_holes():
    """난이도 2 이상 코스는 체크포인트로 나눈 구간마다 구멍이 2~4개여야 한다 (구불구불 길은 기본 코스라 예외)."""
    checked = 0
    for m in MAZES:
        if m["level"] < 2:
            continue
        counts = Maze(m["name"], m["rows"], m["level"]).holes_per_segment()
        assert len(counts) >= 3 and all(0 <= c <= 4 for c in counts), (m["name"], counts)
        checked += 1
    assert checked >= 1


def test_there_are_at_least_nine_courses():
    assert len(MAZES) >= 9
    assert {m["level"] for m in MAZES} >= {1, 2}

