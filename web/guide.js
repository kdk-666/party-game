// 준비 상태는 서버가 관리하고, 게임별 센서 준비는 선택적인 훅으로 연결한다.
function setupGameGuide(ws, getName) {
  const overlay = document.getElementById('game-guide');
  const round = document.getElementById('guide-round');
  const title = document.getElementById('guide-title');
  const timer = document.getElementById('guide-time');
  const rules = document.getElementById('guide-rules');
  const extra = document.getElementById('guide-extra');
  const summary = document.getElementById('guide-summary');
  const players = document.getElementById('guide-players');
  const readyButton = document.getElementById('guide-ready');
  const hint = document.getElementById('guide-hint');
  const hooks = new Map();
  let token = null, gameId = null, deadline = 0, interval = null;
  let clicked = false, preparing = false, requiresHook = false, preparationError = '';

  function setTimer(seconds) {
    deadline = performance.now() + Math.max(0, Number(seconds) || 0) * 1000;
    const render = () => { timer.textContent = String(Math.max(0, Math.ceil((deadline - performance.now()) / 1000))); };
    clearInterval(interval); render(); interval = setInterval(render, 250);
  }
  function hide() {
    token = null; gameId = null; preparing = false;
    clearInterval(interval); interval = null; overlay.hidden = true;
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
      readyButton.disabled = preparing || clicked || mine || !names.includes(getName());
      readyButton.textContent = mine ? '준비 완료 ✓' : preparing ? '센서 확인 중...' : clicked ? '준비 확인 중...' : '준비 완료';
      if (!preparing && !clicked) hint.textContent = mine ? '다른 참가자를 기다리고 있어요.' : (preparationError || '방법을 읽었다면 준비 버튼을 눌러 주세요.');
      if (mine) hint.textContent = '다른 참가자를 기다리고 있어요.';
    }
  }
  function renderRules(guide, instructions) {
    rules.replaceChildren();
    const list = Array.isArray(guide.rules) ? guide.rules : (Array.isArray(instructions) ? instructions : []);
    list.forEach(entry => {
      const item = document.createElement('li');
      if (typeof entry === 'string') { item.textContent = entry; }
      else if (entry && typeof entry === 'object') {
        const icon = document.createElement('span'); icon.className = 'guide-rule-icon'; icon.textContent = entry.icon || '✦';
        const content = document.createElement('span');
        const label = document.createElement('strong'); label.textContent = entry.title || '';
        const text = document.createElement('span'); text.textContent = entry.text || '';
        content.append(label, text); item.append(icon, content);
      }
      rules.append(item);
    });
  }
  function renderExtra(guide, gameData) {
    extra.replaceChildren(); extra.dataset.hasMap = 'false';
    const maze = gameData && gameData.maze;
    if (maze && Array.isArray(maze.rows) && maze.rows.length && typeof maze.rows[0] === 'string') {
      extra.dataset.hasMap = 'true';
      const mapArea = document.createElement('div'); mapArea.className = 'guide-map-area';
      const heading = document.createElement('h3'); heading.className = 'guide-section-title'; heading.textContent = '이번 맵';
      const name = document.createElement('p'); name.className = 'guide-map-name'; name.textContent = String(maze.name || '미로') + ' · 난이도 ' + '★'.repeat(Math.max(0, Math.min(3, Number(maze.level) || 0)));
      const map = document.createElement('div'); map.className = 'guide-map';
      map.style.gridTemplateColumns = `repeat(${maze.rows[0].length}, 1fr)`;
      // 세로로 긴 맵도 준비 버튼과 참가자 목록을 화면 밖으로 밀어내지 않게 한다.
      map.style.maxWidth = `${Math.min(380, Math.round(165 * maze.rows[0].length / maze.rows.length + 20))}px`;
      map.setAttribute('role', 'img'); map.setAttribute('aria-label', '이번 공굴리기 맵 미리보기');
      const kinds = {'#': 'wall', 'O': 'hole', 'C': 'checkpoint', 'S': 'start', 'G': 'goal'};
      maze.rows.forEach(line => {
        if (typeof line !== 'string') return;
        Array.from(line).forEach(cell => {
          const tile = document.createElement('span'); tile.className = 'guide-map-cell ' + (kinds[cell] || 'path');
          map.append(tile);
        });
      });
      const legend = document.createElement('p'); legend.className = 'guide-map-legend'; legend.textContent = '파랑: 출발 · 검정: 구멍 · 노랑: 깃발 · 초록: GOAL';
      mapArea.append(heading, name, map, legend); extra.append(mapArea);
    }
    if (guide.tip) {
      const tip = document.createElement('p'); tip.className = 'guide-tip'; tip.textContent = guide.tip; extra.append(tip);
    }
  }
  if (readyButton) readyButton.addEventListener('click', async () => {
    if (!token || clicked || preparing || ws.readyState !== WebSocket.OPEN) return;
    const attempt = token;
    const hook = hooks.get(gameId);
    if (requiresHook && !hook) { hint.textContent = '센서 준비 화면을 불러오지 못했어요. 새로고침해 주세요.'; return; }
    preparing = true; preparationError = ''; readyButton.disabled = true;
    if (hook) {
      readyButton.textContent = '센서 확인 중...'; hint.textContent = '휴대폰을 편하게 잡고 센서 권한을 허용해 주세요.';
      let result;
      try { result = await hook(); }
      catch (error) { result = {ok: false, message: '센서를 확인하지 못했어요. 다시 시도해 주세요.'}; }
      if (token !== attempt) return;
      if (!result || !result.ok) {
        preparing = false; readyButton.disabled = false; readyButton.textContent = '다시 시도';
        preparationError = (result && result.message) || '센서를 확인하지 못했어요. 다시 시도해 주세요.';
        hint.textContent = preparationError;
        return;
      }
    }
    if (token !== attempt || ws.readyState !== WebSocket.OPEN || performance.now() >= deadline) return;
    preparing = false; clicked = true; readyButton.textContent = '준비 확인 중...';
    hint.textContent = '준비 상태를 확인하고 있어요.';
    ws.send(JSON.stringify({type: 'ready', data: {token: attempt}}));
  });
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data), data = msg.data || {};
    if (msg.type === 'round_start' && data.token) {
      token = data.token; gameId = data.game_id || ''; clicked = false; preparing = false; preparationError = '';
      const guide = data.guide && typeof data.guide === 'object' ? data.guide : {};
      requiresHook = !!guide.requires_hook;
      overlay.dataset.game = gameId;
      round.textContent = `ROUND ${data.round} / ${data.total_rounds}`;
      title.textContent = data.game_name || '게임 설명';
      renderRules(guide, data.instructions); renderExtra(guide, data.game_data);
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
    token = null; preparing = false; clearInterval(interval); timer.textContent = '—';
    if (readyButton) readyButton.disabled = true;
    hint.textContent = '서버 연결이 끊겼어요.';
  });
  return {register(game, hook) { hooks.set(game, hook); }};
}
