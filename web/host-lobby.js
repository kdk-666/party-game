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
  const testMap = document.getElementById('test-map');
  const testMapRow = document.getElementById('test-map-row');
  const mapCards = document.getElementById('test-map-cards');
  const randomMap = document.getElementById('test-map-random');
  const mapLegend = document.getElementById('test-map-legend');
  let testGames = [];
  let names = [];
  const invincibleSelect = document.getElementById('test-virtual-invincible');
  const virtualSelect = document.getElementById('test-virtual-count');
  function virtualCount() { return virtualSelect && !testMode.hidden && names.length ? Number(virtualSelect.value) || 0 : 0; }
  function syncVirtual() {
    if (!virtualSelect) return;
    const max = !testMode.hidden && names.length ? Math.max(0, 4 - names.length) : 0;
    const previous = Math.min(virtualCount(), max);
    virtualSelect.replaceChildren(new Option('0명', '0'));
    for (let i = 1; i <= max; i++) virtualSelect.add(new Option(`${i}명`, String(i)));
    virtualSelect.value = String(previous);
    virtualSelect.disabled = max === 0;
  }
  if (virtualSelect) virtualSelect.addEventListener('change', () => drawLobby());
  function drawMaps(preserve = false) {
    if (!testMap || !testMapRow) return;
    const previous = preserve ? testMap.value : '';
    const maps = testGames.find(item => item.id === testGame.value)?.maps || [];
    testMapRow.hidden = testMode.hidden || !maps.length;
    testMap.replaceChildren(new Option('무작위', ''));
    maps.forEach(name => testMap.add(new Option(name, name)));
    if (maps.includes(previous)) testMap.value = previous;
    drawMapCards();
  }
  function drawMapCards() {
    if (!mapCards || !testMap || !testMapRow) return;
    const scroll = mapCards.scrollTop;
    mapCards.replaceChildren();
    if (randomMap) randomMap.setAttribute('aria-pressed', String(!testMap.value));
    const entry = testGames.find(item => item.id === testGame.value);
    const previews = entry?.previews_by_count?.[Math.max(1, names.length + virtualCount())] || entry?.previews || [];
    if (mapLegend) mapLegend.textContent = entry?.id === 'tilt_ball' ? '초록: 시작 · 노랑: 도착 · 파랑: 체크포인트 · 검정: 구멍' : '어두운 칸: 장애물 · 밝은 칸: 이동 경로 (현재 참가 인원 기준)';
    if (testMapRow.hidden) return;
    for (const name of (entry?.maps || [])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'test-map-card';
      button.setAttribute('aria-pressed', String(testMap.value === name));
      const preview = previews.find(item => item.name === name);
      if (preview?.rows?.length) {
        const canvas = document.createElement('canvas');
        const rows = preview.rows, cols = rows[0].length;
        canvas.width = cols * 12; canvas.height = rows.length * 12;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const palette = entry.id === 'tilt_ball' ? {'#':'#536174','.':'#e5d9bb','S':'#49a66c','G':'#e8b63c','C':'#438ad0','O':'#171923'} : {'#': name === '버려진 물류창고' ? '#485c60' : '#416344', '.': name === '버려진 물류창고' ? '#92938b' : '#c0d0a6'};
          rows.forEach((row,y) => Array.from(row).forEach((tile,x) => {
            ctx.fillStyle = palette[tile] || '#eee';
            ctx.fillRect(x*12,y*12,12,12);
          }));
        }
        button.append(canvas);
      }
      const label = document.createElement('span');
      label.textContent = name || '무작위';
      button.append(label);
      button.addEventListener('click', () => { testMap.value = name; drawMapCards(); });
      mapCards.append(button);
    }
    mapCards.scrollTop = scroll;
  }
  if (randomMap) randomMap.addEventListener('click', () => { testMap.value = ''; drawMapCards(); });
  testGame.addEventListener('change', () => drawMaps());
  if (testMap) testMap.addEventListener('change', drawMapCards);

  function drawLobby() {
    const bots = virtualCount();
    if (invincibleSelect) invincibleSelect.disabled = !bots;
    count.textContent = `${names.length + bots} / 4명 참가 중` + (bots ? ` (가상 ${bots}명)` : '');
    slots.replaceChildren();
    for (let i = 0; i < 4; i++) {
      const item = document.createElement('li');
      item.textContent = names[i] || (i < names.length + bots ? `가상 참가자 (${i - names.length + 1})` : '참가자 기다리는 중');
      if (i < names.length + bots) item.classList.add('joined');
      slots.append(item);
    }
    start.disabled = names.length === 0 || ws.readyState !== WebSocket.OPEN;
    drawMapCards();
  }
  function showGame() { waiting.hidden = true; game.hidden = false; }
  start.addEventListener('click', () => {
    if (start.disabled || ws.readyState !== WebSocket.OPEN) return;
    const selected = !testMode.hidden && testGame.value;
    const data = selected ? {game_id: selected} : {};
    if (virtualCount()) {
      data.virtual_count = virtualCount();
      if (invincibleSelect?.value === 'invincible') data.virtual_invincible = true;
    }
    if (selected && testMapRow && testMap && !testMapRow.hidden && testMap.value) data.map_name = testMap.value;
    ws.send(JSON.stringify({type: 'start', data}));
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
      testGames = !testMode.hidden && Array.isArray(data.test_games) ? data.test_games : [];
      syncVirtual();
      drawMaps(true);
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
