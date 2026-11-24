import asyncio

from games.red_light import game as red_light


def test_screen_snapshot_uses_server_time_and_tracks_player_states():
    async def run():
        events = []
        async def broadcast(message):
            events.append(message)
        game = red_light.RedLight(['민지', '서연', '준호'], broadcast)
        game.running = True
        loop = asyncio.get_running_loop()
        game.end_time = loop.time() + 10
        game.dist['민지'] = 4.5
        await game.set_state('red')
        state = events[-1]['data']
        assert state['state'] == 'red' and state['dist']['민지'] == 4.5
        assert 9.5 <= state['remaining'] <= 10
        assert state['start_distance'] == red_light.START_DIST
        assert state['connected'] == ['민지', '서연', '준호']
        game.red_since = loop.time() - 2
        await game.on_motion('민지', red_light.THRESHOLD + 1)
        await game.remove_player('준호')
        snapshot = game.screen_state()
        assert snapshot['eliminated'] == ['민지']
        assert snapshot['alive'] == ['서연']
        assert snapshot['connected'] == ['민지', '서연']
        assert snapshot['remaining'] <= state['remaining']
        game.end_time = loop.time() - 2
        assert game.screen_state()['remaining'] == 0
    asyncio.run(run())


def test_periodic_updates_reflect_green_motion_and_stop_on_red(monkeypatch):
    async def run():
        events = []
        async def broadcast(message):
            events.append(message)
        monkeypatch.setattr(red_light, 'TICK', .01)
        game = red_light.RedLight(['민지'], broadcast)
        game.running = True
        game.end_time = asyncio.get_running_loop().time() + 2
        game.motion['민지'] = 2
        game.motion_time['민지'] = asyncio.get_running_loop().time()
        task = asyncio.create_task(game.move_loop())
        await asyncio.sleep(.04)
        assert 0 < game.dist['민지'] < red_light.START_DIST
        await game.set_state('red')
        stopped_at = game.dist['민지']
        await asyncio.sleep(.03)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert game.dist['민지'] == stopped_at
        updates = [e['data'] for e in events if e['type'] == 'dist']
        assert updates and all(u['remaining'] is not None for u in updates)
        assert updates[-1]['dist']['민지'] == stopped_at
    asyncio.run(run())
