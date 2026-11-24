"""대회 누적 점수로 현재 참가자의 순위와 공동 우승자를 계산한다."""


def build_standings(total_scores, connected):
    connected = set(connected)
    active = sorted(
        (name for name in total_scores if name in connected),
        key=lambda name: -total_scores[name],
    )
    left = [name for name in total_scores if name not in connected]
    standings = []
    last_score = None
    last_rank = None
    for index, name in enumerate(active):
        score = total_scores[name]
        rank = last_rank if score == last_score else index + 1
        standings.append({"name": name, "score": score, "rank": rank, "connected": True})
        last_score, last_rank = score, rank
    standings.extend({"name": name, "score": total_scores[name], "rank": None, "connected": False} for name in left)
    winners = [item["name"] for item in standings if item["rank"] == 1]
    return standings, winners
