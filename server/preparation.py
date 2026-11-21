import asyncio
import secrets
import time


class GamePreparation:
    def __init__(self, names, seconds=60):
        self.players = set(names)
        self.ready = set()
        self.token = secrets.token_urlsafe(12)
        self.deadline = time.monotonic() + seconds
        self.event = asyncio.Event()
        self.lock = asyncio.Lock()
        self._update()

    def _update(self):
        if not self.players or self.players.issubset(self.ready):
            self.event.set()
    def mark_ready(self, name):
        if name not in self.players or name in self.ready:
            return False
        self.ready.add(name)
        self._update()
        return True

    def remove_player(self, name):
        self.players.discard(name)
        self.ready.discard(name)
        self._update()
    def remaining(self):
        return max(0.0, self.deadline - time.monotonic())

    async def wait(self):
        try:
            await asyncio.wait_for(self.event.wait(), timeout=self.remaining())
        except asyncio.TimeoutError:
            pass
        return bool(self.players)