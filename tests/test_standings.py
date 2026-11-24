from server.standings import build_standings


def test_tied_leaders_are_joint_winners_and_share_rank():
    standings, winners = build_standings({"민지": 1000, "서연": 1000, "준": 500}, {"민지", "서연", "준"})
    assert winners == ["민지", "서연"]
    assert [(item["name"], item["rank"]) for item in standings] == [("민지", 1), ("서연", 1), ("준", 3)]


def test_disconnected_player_keeps_points_but_is_not_ranked_or_winner():
    standings, winners = build_standings({"민지": 2000, "서연": 1000, "준": 700}, {"서연", "준"})
    assert winners == ["서연"]
    assert [(item["name"], item["score"], item["rank"], item["connected"]) for item in standings] == [
        ("서연", 1000, 1, True), ("준", 700, 2, True), ("민지", 2000, None, False)
    ]


def test_everyone_disconnected_has_no_winner_but_retains_scores():
    standings, winners = build_standings({"민지": 1000, "서연": 0}, set())
    assert winners == []
    assert [s["score"] for s in standings] == [1000, 0]
    assert all(s["rank"] is None and not s["connected"] for s in standings)


def test_zero_point_tie_is_still_a_joint_tournament_win():
    standings, winners = build_standings({"민지": 0, "서연": 0}, {"민지", "서연"})
    assert winners == ["민지", "서연"]
    assert [s["rank"] for s in standings] == [1, 1]
