import asyncio
import random

MAX_ROUNDS = 8


class Match:
    def __init__(self, players, game_registry, selected_game_id=None, selected_map_name=None):
        self.players = list(players)
        self.virtual_players = ()
        self.game_registry = dict(game_registry)

        if not self.players:
            raise ValueError("참가자가 없습니다.")
        if not self.game_registry:
            raise ValueError("등록된 게임이 없습니다.")

        if selected_game_id is not None:
            if not isinstance(selected_game_id, str) or selected_game_id not in self.game_registry:
                raise ValueError('등록되지 않은 게임입니다.')
            self.game_ids = [selected_game_id]
        else:
            game_ids = list(self.game_registry)
            count = min(MAX_ROUNDS, len(game_ids))
            self.game_ids = random.sample(game_ids, count)
        if selected_map_name is not None:
            if selected_game_id is None or not isinstance(selected_map_name, str) or selected_map_name not in self.game_registry[selected_game_id].get("test_maps", []):
                raise ValueError("선택할 수 없는 맵입니다.")
        self.selected_map_name = selected_map_name
        self.completed_rounds = 0
        self.total_scores = {name: 0 for name in self.players}
        self.active_game_id = None
        self.standings_lock = asyncio.Lock()
    def start_next_round(self):
        if self.active_game_id is not None:
            raise RuntimeError("이미 진행 중인 게임이 있습니다.")
        if self.completed_rounds >= len(self.game_ids):
            return None

        game_id = self.game_ids[self.completed_rounds]
        self.active_game_id = game_id
        return game_id, self.game_registry[game_id]

    def finish_round(self, game_id, result):
        if self.active_game_id != game_id or game_id is None:
            raise RuntimeError("진행 중인 게임의 결과가 아닙니다.")
        if not isinstance(result, dict) or not isinstance(result.get("scores"), dict):
            raise ValueError("결과에 scores 사전이 필요합니다.")

        scores = result["scores"]
        for name, score in scores.items():
            if name not in self.total_scores:
                raise ValueError("대회에 없는 참가자입니다: " + str(name))
            if isinstance(score, bool) or not isinstance(score, int) or score < 0:
                raise ValueError("점수는 0 이상의 정수여야 합니다.")

        for name, score in scores.items():
            self.total_scores[name] += score
        self.completed_rounds += 1
        self.active_game_id = None
    async def play_round(self, game_id, game):
        if self.active_game_id != game_id or game_id is None:
            raise RuntimeError("진행 중인 게임이 아닙니다.")

        try:
            result = await game.run()
            if result is None:
                return None

            self.finish_round(game_id, result)
            return result
        finally:
            if self.active_game_id == game_id:
                self.active_game_id = None

    async def run_all(self, make_game, on_result, delay=5, on_start=None):
        while True:
            next_round = self.start_next_round()
            if next_round is None:
                return True

            game_id, game_info = next_round
            try:
                game = make_game(game_id, game_info)
                if game is None:
                    return False
                if on_start is not None:
                    can_start = await on_start(game_id, game_info)
                    if can_start is False:
                        return False
                result = await self.play_round(game_id, game)
            finally:
                if self.active_game_id == game_id:
                    self.active_game_id = None
            if result is None:
                return False

            await on_result(game_id, result)
            if self.completed_rounds < len(self.game_ids):
                await asyncio.sleep(delay)