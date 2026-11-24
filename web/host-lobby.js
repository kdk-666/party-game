function setupHostLobby(ws) {
  const waiting = document.getElementById('host-waiting');
  const game = document.getElementById('host-game');
  const slots = document.getElementById('lobby-players');
  const count = document.getElementById('lobby-count');
  const start = document.getElementById('start');
  const back = document.getElementById('host-back');
  const connection = document.getElementById('host-connection');
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
      drawLobby();
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
