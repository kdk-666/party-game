// 실제 서버 상태를 바탕으로 PC와 휴대폰에 같은 경기장을 그린다.
// Canvas는 표시만 담당하며 거리와 탈락 판정은 서버에서 수행한다.
function setupRedLightArena(ws, role, getName) {
  const isHost = role === 'host';
  const root = document.createElement('section');
  root.className = 'rl-arena ' + (isHost ? 'is-host' : 'is-player'); root.hidden = true;
  root.setAttribute('aria-label', '무궁화 게임 경기장');
  root.innerHTML = '<div class="rl-arena-shell">' +
    '<header class="rl-top"><div><p class="rl-kicker">MOTION PARTY · RED LIGHT</p><h1>무궁화 꽃이 피었습니다</h1></div>' +
    '<div class="rl-clock"><span>남은 시간</span><strong data-k="time">--:--</strong></div></header>' +
    '<div class="rl-signal" data-k="signal" role="status"><span class="rl-signal-dot"></span><div><strong data-k="signal-title">곧 시작해요</strong><span data-k="signal-hint">잠깐만 기다려 주세요!</span></div></div>' +
    '<div class="rl-layout"><div class="rl-board"><canvas aria-label="술래와 참가자 위치를 표시한 경기장"></canvas><div class="rl-board-note">위쪽이 술래 · 아래쪽이 출발선</div><p class="rl-overlay-message" data-k="overlay-message" hidden></p></div>' +
    '<aside class="rl-info"><div class="rl-my-card" data-k="my-card"><span>술래까지 내 거리</span><strong data-k="my-distance">--.-<small> m</small></strong><p data-k="my-status">경기 시작을 기다려요</p></div>' +
    '<div class="rl-player-head"><h2>참가자 위치</h2><span data-k="player-count"></span></div><ul class="rl-players" data-k="players" aria-label="참가자별 거리와 상태"></ul>' +
    '<p class="rl-explain">각 칸에서 위로 갈수록 술래에 가까워요.</p></aside></div></div>';
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  const signal = root.querySelector('[data-k="signal"]'), signalTitle = root.querySelector('[data-k="signal-title"]');
  const signalHint = root.querySelector('[data-k="signal-hint"]'), time = root.querySelector('[data-k="time"]');
  const myCard = root.querySelector('[data-k="my-card"]'), myDistance = root.querySelector('[data-k="my-distance"]');
  const myStatus = root.querySelector('[data-k="my-status"]'), playerCount = root.querySelector('[data-k="player-count"]');
  const list = root.querySelector('[data-k="players"]'), overlayMessage = root.querySelector('[data-k="overlay-message"]');
  const palette = ['#3b82f6', '#f36c88', '#f6b53f', '#8e78e8'];
  let names = [], distances = Object.create(null), shown = Object.create(null), alive = new Set(), connected = new Set(), eliminated = new Set(), arrived = new Set();
  let state = 'waiting', startDistance = 10, remaining = null, receivedAt = 0, frame = null, lastFrame = 0, disconnected = false;

  function shownStatus(name) {
    if (!connected.has(name)) return '나감';
    if (eliminated.has(name)) return '탈락';
    if (arrived.has(name)) return '도착';
    return '참가 중';
  }
  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function updateTimer() {
    if (remaining === null) { time.textContent = '--:--'; return; }
    const seconds = disconnected ? remaining : remaining - (performance.now() - receivedAt) / 1000;
    time.textContent = formatTime(seconds);
    time.classList.toggle('low', seconds <= 10);
  }
  function setText(element, value) { if (element.textContent !== value) element.textContent = value; }
  function updateInfo() {
    const me = getName();
    signal.dataset.state = state; root.dataset.state = state;
    const mineOut = !isHost && eliminated.has(me);
    overlayMessage.hidden = !disconnected && !mineOut;
    setText(overlayMessage, disconnected ? '연결이 끊겼어요' : mineOut ? '탈락 · 관전 중' : '');
    const titleText = disconnected ? '서버 연결이 끊겼어요' : mineOut ? '탈락했어요' : state === 'green' ? '초록불 · 움직여요!' : state === 'red' ? '빨간불 · 멈춰요!' : '곧 시작해요';
    const hintText = disconnected ? '새로고침한 뒤 다시 접속해 주세요.' : mineOut ? '다른 참가자의 경기를 지켜봐요.' : state === 'green' ? '휴대폰을 흔들어 술래에게 다가가요' : state === 'red' ? '지금은 휴대폰을 움직이지 마세요' : '잠깐만 기다려 주세요!';
    setText(signalTitle, titleText); setText(signalHint, hintText);
    myCard.hidden = isHost;
    if (!isHost) {
      const distance = distances[me];
      myDistance.textContent = Number.isFinite(distance) ? distance.toFixed(1) + ' m' : '--.- m';
      myStatus.textContent = mineOut ? '탈락 · 경기를 관전 중이에요' : arrived.has(me) ? '도착했어요!' : state === 'waiting' ? '경기 시작을 기다려요' : '남은 거리 · 0m에 도착하면 승리!';
    }
    playerCount.textContent = names.length + '명';
    list.replaceChildren();
    names.forEach((name, index) => {
      const row = document.createElement('li'); row.className = 'rl-player' + (name === me && !isHost ? ' is-me' : '');
      const marker = document.createElement('span'); marker.className = 'rl-player-color'; marker.style.background = palette[index % palette.length];
      const label = document.createElement('span'); label.className = 'rl-player-name'; label.textContent = name + (name === me && !isHost ? ' (나)' : '');
      const value = document.createElement('strong');
      const distance = distances[name]; const status = shownStatus(name);
      value.textContent = status === '참가 중' ? (Number.isFinite(distance) ? distance.toFixed(1) + 'm' : '대기 중') : status;
      if (status !== '참가 중') row.classList.add('is-inactive');
      row.append(marker, label, value); list.append(row);
    });
  }
  function applySnapshot(data) {
    if (data.dist && typeof data.dist === 'object') {
      distances = Object.create(null);
      Object.keys(data.dist).forEach(name => {
        if (!names.includes(name)) names.push(name);
        if (typeof data.dist[name] === 'number' && Number.isFinite(data.dist[name])) distances[name] = Math.max(0, data.dist[name]);
      });
    }
    if (Array.isArray(data.alive)) alive = new Set(data.alive);
    if (Array.isArray(data.connected)) connected = new Set(data.connected);
    if (Array.isArray(data.eliminated)) eliminated = new Set(data.eliminated);
    if (Array.isArray(data.arrived)) arrived = new Set(data.arrived);
    if (typeof data.start_distance === 'number' && Number.isFinite(data.start_distance) && data.start_distance > 0) startDistance = data.start_distance;
    if (typeof data.remaining === 'number' && Number.isFinite(data.remaining)) { remaining = Math.max(0, data.remaining); receivedAt = performance.now(); }
    updateInfo(); updateTimer();
  }
  function rounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
  }
  function text(s, x, y, size, color, align = 'center', maxWidth) {
    ctx.fillStyle = color; ctx.font = '700 ' + size + 'px system-ui, sans-serif'; ctx.textAlign = align;
    if (maxWidth) ctx.fillText(s, x, y, maxWidth); else ctx.fillText(s, x, y);
  }
  function tree(x, y, scale) {
    ctx.fillStyle = '#8b5d3d'; rounded(x-6*scale,y,12*scale,47*scale,4*scale); ctx.fill();
    ctx.fillStyle = '#61ac78'; ctx.beginPath(); ctx.arc(x,y-5*scale,31*scale,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#88c994'; ctx.beginPath(); ctx.arc(x-10*scale,y-15*scale,18*scale,0,Math.PI*2); ctx.fill();
  }
  function drawDoll() {
    // 초록불에는 등을, 빨간불에는 얼굴을 보여 준다.
    ctx.save(); ctx.translate(360, 113);
    ctx.fillStyle = '#e6a06d'; ctx.beginPath(); ctx.arc(0,-35,29,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#543e3b'; ctx.beginPath(); ctx.arc(0,-42,29,Math.PI,0); ctx.fill();
    ctx.fillStyle = '#e7786b'; rounded(-30,-6,60,52,18); ctx.fill();
    ctx.strokeStyle = '#875d4e'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-12,43); ctx.lineTo(-14,58); ctx.moveTo(12,43); ctx.lineTo(14,58); ctx.stroke();
    if (state === 'red') { ctx.fillStyle = '#342723'; ctx.beginPath(); ctx.arc(-10,-34,3,0,Math.PI*2); ctx.arc(10,-34,3,0,Math.PI*2); ctx.fill(); }
    else { ctx.fillStyle = '#543e3b'; rounded(-20,-51,40,26,10); ctx.fill(); }
    ctx.restore();
  }
  function drawPlayer(name, index, count, position, boardHeight) {
    const x = 100 + (index + .5) * (520 / count);
    const y = 227 + Math.max(0, Math.min(1, position / startDistance)) * (boardHeight - 360);
    const inactive = shownStatus(name) !== '참가 중';
    ctx.save(); ctx.translate(x,y); const avatarScale = isHost ? 1 : 1.22; ctx.scale(avatarScale,avatarScale); ctx.globalAlpha = inactive ? .38 : 1;
    ctx.fillStyle = 'rgba(53,73,60,.15)'; ctx.beginPath(); ctx.ellipse(0,24,25,9,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#4d5966'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(-8,12); ctx.lineTo(-13,24); ctx.moveTo(8,12); ctx.lineTo(13,24); ctx.stroke();
    ctx.fillStyle = palette[index % palette.length]; rounded(-20,-16,40,36,13); ctx.fill();
    ctx.fillStyle = '#ffd7b4'; ctx.beginPath(); ctx.arc(0,-25,15,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#5a423c'; ctx.beginPath(); ctx.arc(0,-29,15,Math.PI,0); ctx.fill();
    if (!isHost && name === getName()) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0,-25,19,0,Math.PI*2); ctx.stroke(); }
    ctx.restore();
    const label = name + (!isHost && name === getName() ? ' · 나' : '');
    ctx.fillStyle = inactive ? '#68766d' : '#284e3c'; rounded(x-58,y-(isHost ? 76 : 88),116,32,14); ctx.fill();
    text(label,x,y-(isHost ? 54 : 66),isHost ? 20 : 22,'#fff','center',110);
  }
  function drawBoard(now) {
    if (!ctx || root.hidden) return;
    const r = Math.min(window.devicePixelRatio || 1, 2), rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * r)), h = Math.max(1, Math.round(rect.height * r));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    // 휴대폰의 긴 화면에 맞춰 경기장만 늘리고, 캐릭터 비율은 유지한다.
    const boardHeight = isHost ? 700 : Math.max(700, 720 * rect.height / Math.max(1, rect.width));
    ctx.setTransform(w/720,0,0,h/boardHeight,0,0); ctx.clearRect(0,0,720,boardHeight);
    ctx.fillStyle = '#dff4ea'; ctx.fillRect(0,0,720,boardHeight);
    ctx.fillStyle = '#c4e4d5'; ctx.beginPath(); ctx.moveTo(0,230); ctx.lineTo(110,150); ctx.lineTo(220,225); ctx.lineTo(500,165); ctx.lineTo(720,230); ctx.lineTo(720,310); ctx.lineTo(0,310); ctx.fill();
    ctx.fillStyle = '#fff8dc'; ctx.beginPath(); ctx.arc(625,72,31,0,Math.PI*2); ctx.fill();
    tree(48,180,.8); tree(676,180,.8);
    ctx.fillStyle = '#f5daba'; rounded(65,190,590,boardHeight - 250,24); ctx.fill();
    ctx.fillStyle = '#f9e8cb'; rounded(82,202,556,boardHeight - 274,18); ctx.fill();
    const count = Math.max(1, names.length);
    for (let i=1; i<count; i++) { ctx.strokeStyle = 'rgba(189,146,105,.35)'; ctx.lineWidth = 2; ctx.setLineDash([8,10]); ctx.beginPath(); ctx.moveTo(100+i*(520/count),205); ctx.lineTo(100+i*(520/count),boardHeight - 80); ctx.stroke(); ctx.setLineDash([]); }
    ctx.strokeStyle = '#d66c64'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(85,205); ctx.lineTo(635,205); ctx.stroke();
    text('술래',360,38,17,'#30604c'); drawDoll();
    text('출발선',360,boardHeight - 35,17,'#936b4c');
    const elapsed = Math.max(0, Math.min(100, now - (lastFrame || now))); lastFrame = now;
    names.forEach((name, index) => {
      const target = Number.isFinite(distances[name]) ? Math.min(startDistance, distances[name]) : startDistance;
      if (!Number.isFinite(shown[name]) || state !== 'green') shown[name] = target;
      else shown[name] += (target - shown[name]) * Math.min(1, elapsed / 160);
      drawPlayer(name,index,count,shown[name],boardHeight);
    });
  }
  function tick(now) { if (root.hidden) { frame = null; return; } drawBoard(now); updateTimer(); frame = requestAnimationFrame(tick); }
  function show() { root.hidden = false; if (frame === null) { lastFrame = 0; frame = requestAnimationFrame(tick); } }
  function hide() { root.hidden = true; if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data), data = msg.data || {};
    if (msg.type === 'round_start') {
      hide(); state = 'waiting'; distances = Object.create(null); shown = Object.create(null); remaining = null; disconnected = false;
      names = Array.isArray(data.players) ? data.players.slice() : [];
      connected = new Set(names); alive = new Set(names); eliminated = new Set(); arrived = new Set();
      updateInfo(); updateTimer();
    } else if (msg.type === 'countdown') { state = 'waiting'; show(); updateInfo(); }
    else if (msg.type === 'state') { state = data.state === 'red' ? 'red' : 'green'; applySnapshot(data); show(); }
    else if (msg.type === 'dist') { applySnapshot(data); }
    else if (msg.type === 'eliminated') { eliminated.add(data.name); if (Array.isArray(data.alive)) alive = new Set(data.alive); updateInfo(); }
    else if (msg.type === 'player_left') { connected.delete(data.name); updateInfo(); }
    else if (['game_over', 'round_result', 'return_lobby', 'game_cancelled', 'match_cancelled', 'match_error'].includes(msg.type)) { hide(); }
  });
  ws.addEventListener('close', () => {
    if (root.hidden) return;
    if (remaining !== null) remaining = Math.max(0, remaining - (performance.now() - receivedAt) / 1000);
    disconnected = true; updateInfo(); updateTimer();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });
}
