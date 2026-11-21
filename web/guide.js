function setupGameGuide(ws, getName) {
  const overlay = document.getElementById('game-guide');
  const round = document.getElementById('guide-round');
  const title = document.getElementById('guide-title');
  const timer = document.getElementById('guide-time');
  const rules = document.getElementById('guide-rules');
  const summary = document.getElementById('guide-summary');
  const players = document.getElementById('guide-players');
  const readyButton = document.getElementById('guide-ready');
  const hint = document.getElementById('guide-hint');
  let token = null, deadline = 0, interval = null, clicked = false;

  function setTimer(seconds) {
    deadline = performance.now() + Math.max(0, Number(seconds) || 0) * 1000;
    const render = () => { timer.textContent = String(Math.max(0, Math.ceil((deadline - performance.now()) / 1000))); };
    clearInterval(interval); render(); interval = setInterval(render, 250);
  }
  function hide() {
    token = null; clearInterval(interval); interval = null; overlay.hidden = true;
  }
  function renderPlayers(data) {
    const names = Array.isArray(data.players) ? data.players : [];
    const ready = Array.isArray(data.ready) ? data.ready : [];
    summary.textContent = `준비 ${ready.length} / ${names.length}`;
    players.replaceChildren();
    names.forEach(name => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      const state = document.createElement('strong');
      label.textContent = name;
      state.textContent = ready.includes(name) ? '✓ 준비 완료' : '대기 중';
      row.append(label, state); players.append(row);
    });
    if (readyButton) {
      const mine = ready.includes(getName());
      readyButton.disabled = clicked || mine || !names.includes(getName());
      readyButton.textContent = mine ? '준비 완료 ✓' : clicked ? '준비 확인 중...' : '준비 완료';
      hint.textContent = mine ? '다른 참가자를 기다리고 있어요.' : '방법을 읽었다면 준비 버튼을 눌러 주세요.';
    }
  }
  if (readyButton) readyButton.addEventListener('click', () => {
    if (!token || clicked || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({type: 'ready', data: {token}}));
    clicked = true; readyButton.disabled = true; readyButton.textContent = '준비 확인 중...';
    hint.textContent = '준비 상태를 확인하고 있어요.';
  });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data), data = msg.data || {};
    if (msg.type === 'round_start' && data.token) {
      token = data.token; clicked = false;
      round.textContent = `ROUND ${data.round} / ${data.total_rounds}`;
      title.textContent = data.game_name || '게임 설명';
      rules.replaceChildren();
      (Array.isArray(data.instructions) ? data.instructions : []).forEach(text => {
        const item = document.createElement('li'); item.textContent = text; rules.append(item);
      });
      overlay.hidden = false; setTimer(data.remaining); renderPlayers(data);
    } else if (msg.type === 'preparation_update' && token && data.token === token) {
      setTimer(data.remaining); renderPlayers(data);
    } else if (['countdown', 'game_cancelled', 'match_cancelled', 'match_error', 'match_over'].includes(msg.type)) {
      hide();
      if (msg.type === 'match_cancelled' || msg.type === 'match_error') {
        const status = document.getElementById('status') || document.getElementById('msg');
        if (status) status.textContent = data.message || '대회가 취소됐어요.';
      }
    }
  });
  ws.addEventListener('close', () => {
    if (!token) return;
    clearInterval(interval); timer.textContent = '—';
    if (readyButton) readyButton.disabled = true;
    hint.textContent = '서버 연결이 끊겼어요.';
  });
}
