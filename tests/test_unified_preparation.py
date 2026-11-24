"""공통 준비 완료/시간 초과 후 공굴리기가 두 번째 준비를 기다리지 않는다."""
import asyncio
from types import SimpleNamespace

import pytest

import server.main as main
from games.tilt_ball import game as tilt_ball


@pytest.mark.parametrize('mode', ['all_ready', 'timeout', 'player_leaves'])
def test_tilt_unified_preparation_and_server_transition(monkeypatch, mode):
    async def scenario():
        events = []
        async def send(message):
            events.append(message)
        phone1, phone2 = object(), object()
        monkeypatch.setattr(main, 'players', {phone1: '민지', phone2: '서연'})
        monkeypatch.setattr(main, 'preparation', None)
        monkeypatch.setattr(main, 'to_everyone', send)
        monkeypatch.setattr(main, 'PREPARATION_SECONDS', .08)
        monkeypatch.setattr(tilt_ball, 'COUNT_FROM', 0)
        game = tilt_ball.TiltBall(['민지', '서연'], send)
        monkeypatch.setattr(main, 'game', game)
        match = SimpleNamespace(players=['민지', '서연'], completed_rounds=0, game_ids=['tilt_ball'])
        info = {'name': '공굴리기', 'instructions': ['규칙'], 'guide': {'requires_hook': True}}
        waiting = asyncio.create_task(main.prepare_match_round(match, 'tilt_ball', info))
        await asyncio.sleep(0)
        first = next(e['data'] for e in events if e['type'] == 'round_start')
        assert first['guide']['requires_hook'] is True
        assert first['game_data']['maze']['rows'] == game.maze.rows
        await main.handle_ready(phone1, {'token': '잘못된 토큰'})
        assert not main.preparation.ready
        await main.handle_ready(phone1, {'token': first['token']})
        if mode == 'all_ready':
            await main.handle_ready(phone2, {'token': first['token']})
        elif mode == 'player_leaves':
            async with main.preparation.lock:
                main.players.pop(phone2)
                main.preparation.remove_player('서연')
            await game.remove_player('서연')
        assert await asyncio.wait_for(waiting, .5) is True
        assert main.preparation is None

        # 두 번째 준비를 기다리려 하면 바로 실패한다.
        async def forbidden_wait():
            raise AssertionError('두 번째 준비를 기다리면 안 됩니다')
        async def race_stub():
            pass
        monkeypatch.setattr(game.ready_event, 'wait', forbidden_wait)
        monkeypatch.setattr(game, '_race', race_stub)
        await game.run()
        intro = next(e['data'] for e in events if e['type'] == 'tb_intro')
        assert intro['unified_preparation'] is True
        assert intro['maze'] == first['game_data']['maze']
        assert next(e for e in events if e['type'] == 'tb_over')
    asyncio.run(scenario())
