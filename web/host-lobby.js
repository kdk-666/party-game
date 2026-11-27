function setupHostLobby(ws) {
  const waiting = document.getElementById('host-waiting');
  const game = document.getElementById('host-game');
  const slots = document.getElementById('lobby-players');
  const count = document.getElementById('lobby-count');
  const start = document.getElementById('start');
  const back = document.getElementById('host-back');
  const connection = document.getElementById('host-connection');
  const testMode = document.getElementById('test-mode');
  const testGame = document.getElementById('test-game');
  let names = [];

  function drawLobby() {
    count.textContent = `${names.length} / 4명 참가 중`;
    slots.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const item = document.createElement('li');
      item.textContent = names[i] || '참가자 기다리는 중';
      if (names[i]) item.classList.add('joined');
      slots.append(item);
    }
    start.disabled = names.length === 0 || ws.readyState !== WebSocket.OPEN;
  }
  function showGame() { waiting.hidden = true; game.hidden = false; }
  start.addEventListener('click', () => {
    if (start.disabled || ws.readyState !== WebSocket.OPEN) return;
    const selected = !testMode.hidden && testGame.value;
    ws.send(JSON.stringify({type: 'start', data: selected ? {game_id: selected} : {}}));
  });
  back.addEventListener('click', () => {
    game.hidden = true; waiting.hidden = false; back.hidden = true;
    document.getElementById('bg').style.background = ''; drawLobby();
  });
  ws.addEventListener('open', () => { connection.textContent = '참가자를 기다리고 있어요.'; drawLobby(); });
  ws.addEventListener('close', () => { connection.textContent = '서버 연결이 끊겼어요. 새로고침해 주세요.'; drawLobby(); });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data), data = msg.data || {};
    if (msg.type === 'lobby') {
      names = Array.isArray(data.players) ? data.players : [];
      const selected = testGame.value;
      testMode.hidden = data.test_mode !== true;
      testGame.replaceChildren(new Option('일반 대회 (랜덤)', ''));
      if (!testMode.hidden && Array.isArray(data.test_games)) {
        data.test_games.forEach(item => {
          if (typeof item.id === 'string' && typeof item.name === 'string') testGame.add(new Option(item.name, item.id));
        });
      }
      if (Array.from(testGame.options).some(option => option.value === selected)) testGame.value = selected;
      drawLobby();
    } else if (msg.type === 'start_error') {
      connection.textContent = data.message || '게임을 시작하지 못했어요.';
    } else if (msg.type === 'countdown') {
      back.hidden = true; showGame();
    } else if (msg.type === 'match_over') {
      showGame(); back.hidden = true;
    } else if (msg.type === 'return_lobby') {
      game.hidden = true; waiting.hidden = false; back.hidden = true;
      document.getElementById('bg').style.background = ''; drawLobby();
    } else if (['match_cancelled', 'match_error', 'game_cancelled'].includes(msg.type)) {
      showGame(); back.hidden = false;
    }
  });
  drawLobby();
}
