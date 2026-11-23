"""컬러헌트: 제시된 색과 가장 비슷한 물건을 사진으로 찍어 점수를 받는 게임."""
import asyncio
import base64
import random
import secrets

from games.color_hunt.color_utils import center_average_color, hex_to_rgb, similarity_score

ROUNDS = 3               # 한 게임에서 제시하는 색의 개수
COUNTDOWN = 3            # 시작 전 대기(초)
ROUND_SECONDS = 25       # 색 하나당 촬영 제한시간(초)
RESULT_SECONDS = 5       # 결과를 보여주는 시간(초)
MAX_IMAGE_BYTES = 500_000
RANK_POINTS = [1000, 700, 500, 300]   # 대회 점수 (무궁화와 같은 방식)

# 주변에서 찾기 쉬운 색만 골랐다 (흰색/검정/회색은 조명 영향이 커서 제외)
COLORS = [
    ("빨강", "#d32f2f"),
    ("주황", "#f57c00"),
    ("노랑", "#fbc02d"),
    ("초록", "#388e3c"),
    ("하늘", "#4fc3f7"),
    ("파랑", "#1565c0"),
    ("보라", "#7b1fa2"),
    ("분홍", "#f06292"),
]


class ColorHunt:
    def __init__(self, names, broadcast):
        self.connected = set(names)
        self.totals = {n: 0 for n in names}
        self.round_scores = {}     # 이번 색에서 낸 사람 -> 점수
        self.round_rgb = {}        # 이번 색에서 낸 사람 -> 사진 평균색
        self.submitted = set()     # 게임 중 유효한 사진을 한 번 이상 낸 사람
        self.target = None
        self.round_token = None
        self.round_deadline = None
        self.accepting = False     # 지금 사진을 받는 중인가
        self.running = False
        self.all_in = asyncio.Event()
        self.broadcast = broadcast

    async def run(self):
        self.running = True
        await self.broadcast({"type": "countdown", "data": {}})
        await asyncio.sleep(COUNTDOWN)

        colors = random.sample(COLORS, min(ROUNDS, len(COLORS)))
        for index, (name, hex_color) in enumerate(colors):
            if not self.connected:
                break
            await self.play_round(index, len(colors), name, hex_color)

        self.running = False
        if not self.connected:
            await self.broadcast({"type": "game_cancelled", "data": {}})
            return None

        eligible = sorted(self.connected & self.submitted, key=lambda n: -self.totals[n])
        not_submitted = sorted(self.connected - self.submitted)
        ranking = eligible + not_submitted
        scores = {}
        for i, n in enumerate(eligible):
            first = next(j for j, m in enumerate(eligible) if self.totals[m] == self.totals[n])
            scores[n] = RANK_POINTS[first] if first < len(RANK_POINTS) else 100
        scores.update({n: 0 for n in not_submitted})
        result = {
            "winner": eligible[0] if eligible else None,
            "ranking": ranking,
            "not_submitted": not_submitted,
            "totals": {n: self.totals[n] for n in ranking},
            "scores": scores,
        }
        await self.broadcast({"type": "ch_over", "data": result})
        return result

    async def play_round(self, index, total, color_name, hex_color):
        self.target = hex_to_rgb(hex_color)
        self.round_scores = {}
        self.round_rgb = {}
        self.all_in.clear()
        self.round_token = secrets.token_urlsafe(16)
        self.round_deadline = asyncio.get_running_loop().time() + ROUND_SECONDS
        self.accepting = True
        await self.broadcast({"type": "ch_round", "data": {
            "index": index + 1, "total": total, "color_name": color_name,
            "hex": hex_color, "seconds": ROUND_SECONDS, "round_token": self.round_token}})
        remaining = max(0, self.round_deadline - asyncio.get_running_loop().time())
        if remaining > 0 and not self.all_in.is_set():
            try:
                await asyncio.wait_for(self.all_in.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                pass
        self.accepting = False

        results = {}
        for n in self.connected:
            score = self.round_scores.get(n, 0)      # 안 낸 사람은 0점
            self.totals[n] += score
            results[n] = {"score": score, "rgb": self.round_rgb.get(n)}
        await self.broadcast({"type": "ch_round_result", "data": {
            "hex": hex_color, "color_name": color_name, "results": results,
            "totals": {n: self.totals[n] for n in self.connected}}})
        await asyncio.sleep(RESULT_SECONDS)

    def _check_all_in(self):
        if all(n in self.round_scores for n in self.connected):
            self.all_in.set()

    async def on_photo(self, name, data):
        if name not in self.connected or not isinstance(data, dict):
            return
        token = data.get("round_token")
        if not isinstance(token, str) or not token or len(token) > 128:
            return
        if (not self.accepting or token != self.round_token or self.round_deadline is None
                or asyncio.get_running_loop().time() >= self.round_deadline):
            await self.broadcast({"type": "ch_photo_rejected", "data": {
                "name": name, "round_token": token}})
            return
        if name in self.round_scores:
            return
        try:
            raw = base64.b64decode(data["image"].split(",", 1)[-1], validate=True)
            if len(raw) > MAX_IMAGE_BYTES:
                raise ValueError("too big")
            rgb = center_average_color(raw)
        except Exception:
            await self.broadcast({"type": "ch_photo_error", "data": {
                "name": name, "round_token": token}})
            return
        self.round_scores[name] = similarity_score(self.target, rgb)
        self.round_rgb[name] = list(rgb)
        self.submitted.add(name)
        await self.broadcast({"type": "ch_submitted", "data": {
            "names": sorted(self.round_scores), "round_token": token}})
        self._check_all_in()

    async def on_motion(self, name, value):
        pass    # 이 게임은 센서를 쓰지 않는다

    async def remove_player(self, name):
        self.connected.discard(name)
        if self.accepting:
            self._check_all_in()
