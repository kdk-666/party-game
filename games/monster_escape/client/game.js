// 표시할 점프 횟수. 서버 game.py의 JUMP_LIMIT과 같게 유지한다.
const MONSTER_ESCAPE_JUMP_LIMIT = 3;
// PC는 전체 맵, 참가자는 내 캐릭터 주변 7칸만 보여준다.
function monsterEscapeCamera(host, rows, player, canvasWidth) {
  const view = host ? rows[0].length : 7;
  const size = canvasWidth / view;
  const x = host ? view / 2 : (player ? player.x : 1.5);
  const y = host ? rows.length / 2 : (player ? player.y : 1.5);
  return { size, offsetX: canvasWidth / 2 - x * size, offsetY: canvasWidth / 2 - y * size };
}
// 격자 경계를 따라 광선을 쏘아 첫 벽까지의 거리를 구한다.
function monsterEscapeRay(rows, origin, dx, dy, limit, showWall = false) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y);
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const deltaX = sx ? Math.abs(1 / dx) : Infinity, deltaY = sy ? Math.abs(1 / dy) : Infinity;
  let nextX = sx > 0 ? (x + 1 - origin.x) * deltaX : sx < 0 ? (origin.x - x) * deltaX : Infinity;
  let nextY = sy > 0 ? (y + 1 - origin.y) * deltaY : sy < 0 ? (origin.y - y) * deltaY : Infinity;
  const blocked = (cx, cy) => cy < 0 || cy >= rows.length || cx < 0 || cx >= rows[0].length || rows[cy][cx] === '#';
  while (Math.min(nextX, nextY) <= limit) {
    const distance = Math.min(nextX, nextY);
    if (Math.abs(nextX - nextY) < 1e-10) {
      // 벽 모서리 사이의 틈으로 가려진 대상을 노출하지 않는다.
      if (blocked(x + sx, y) || blocked(x, y + sy)) return distance;
      x += sx; y += sy; nextX += deltaX; nextY += deltaY;
    } else if (nextX < nextY) { x += sx; nextX += deltaX; }
    else { y += sy; nextY += deltaY; }
    if (blocked(x, y)) return showWall ? Math.min(limit, nextX, nextY) : distance;
  }
  return limit;
}
function monsterEscapeCanSee(rows, origin, target) {
  const dx = target.x - origin.x, dy = target.y - origin.y, distance = Math.hypot(dx, dy);
  return distance < 1e-9 || monsterEscapeRay(rows, origin, dx / distance, dy / distance, distance) >= distance - 1e-8;
}
function monsterEscapeVisibility(rows, origin) {
  const angles = [];
  // 화면 가장자리는 항상 덮고, 벽의 각 모서리 양옆으로 광선을 보내 그림자를 만든다.
  for (let i = 0; i < 32; i++) angles.push((i - 16) * Math.PI * 2 / 32 + .0000037);
  const minX = Math.max(0, Math.floor(origin.x) - 5), maxX = Math.min(rows[0].length - 1, Math.floor(origin.x) + 5);
  const minY = Math.max(0, Math.floor(origin.y) - 5), maxY = Math.min(rows.length - 1, Math.floor(origin.y) + 5);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (rows[y][x] !== '#') continue;
    for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
      const a = Math.atan2(cy - origin.y, cx - origin.x);
      angles.push(a - .00001, a + .00001);
    }
  }
  return angles.map(angle => {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const length = monsterEscapeRay(rows, origin, dx, dy, 10);
    return {angle, x: origin.x + dx * length, y: origin.y + dy * length};
  }).sort((a, b) => a.angle - b.angle);
}
function monsterEscapeVisibleWalls(rows, origin) {
  const walls = [];
  const minX = Math.max(0, Math.floor(origin.x) - 5), maxX = Math.min(rows[0].length - 1, Math.floor(origin.x) + 5);
  const minY = Math.max(0, Math.floor(origin.y) - 5), maxY = Math.min(rows.length - 1, Math.floor(origin.y) + 5);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (rows[y][x] !== '#') continue;
    const inside = Math.floor(origin.x) === x && Math.floor(origin.y) === y;
    const visible = inside || [[.5,.5],[.1,.1],[.9,.1],[.1,.9],[.9,.9]].some(([ox, oy]) => {
      const dx = x + ox - origin.x, dy = y + oy - origin.y, distance = Math.hypot(dx, dy);
      return distance < 1e-9 || monsterEscapeRay(rows, origin, dx / distance, dy / distance, distance, true) >= distance - 1e-8;
    });
    if (visible) walls.push({x, y});
  }
  return walls;
}
function monsterEscapeVisibleWallSurface(rows, origin) {
  const tiles = monsterEscapeVisibleWalls(rows, origin);
  const interior = (x, y) => x > 0 && y > 0 && x < rows[0].length - 1 && y < rows.length - 1;
  const seen = new Set(tiles.map(({x, y}) => y * rows[0].length + x));
  for (let i = 0; i < tiles.length; i++) {
    const {x, y} = tiles[i];
    if (!interior(x, y)) continue;
    for (const [a, b] of [[x-1,y], [x+1,y], [x,y-1], [x,y+1]]) {
      const key = b * rows[0].length + a;
      if (!interior(a, b) || rows[b][a] !== '#' || seen.has(key)) continue;
      seen.add(key);
      tiles.push({x: a, y: b});
    }
  }
  return tiles;
}
function monsterEscapeDeathProgress(start, now) {
  return start == null ? null : Math.max(0, Math.min(1, (now - start) / 700));
}
function monsterEscapeInterpolate(previous, current, amount) {
  if (!previous) return current;
  const t = Math.max(0, Math.min(1, amount));
  const mix = (a, b) => a + (b - a) * t;
  const players = {};
  for (const [name, p] of Object.entries(current.players)) {
    const before = previous.players[name] || p;
    const jump = p.jump && before.jump ? {...p.jump, progress: mix(before.jump.progress, p.jump.progress)} : p.jump;
    players[name] = {...p, x: mix(before.x, p.x), y: mix(before.y, p.y), ...(p.jump ? {jump} : {})};
  }
  const monsters = current.monsters.map((p, i) => {
    const before = previous.monsters[i] || p;
    return [mix(before[0], p[0]), mix(before[1], p[1])];
  });
  return {...current, players, monsters};
}
// 결과별 문구를 한곳에서 정해 PC와 휴대폰이 같은 결과를 보여준다.
function monsterEscapeFinale(data, role, viewer) {
  const winners = Array.isArray(data.winners) ? data.winners : [];
  if (!winners.length) return {tone: 'failure', tag: 'MISSION ENDED', title: '생존자 없음', detail: '모든 플레이어가 탈락했어요.', names: '', points: ''};
  const mine = role !== 'host' && winners.includes(viewer);
  if (winners.length > 1) return {tone: 'victory', tag: 'SURVIVORS', title: '함께 살아남았어요', detail: mine ? '당신은 공동 생존자예요!' : '제한 시간까지 살아남은 플레이어', names: winners.join(' · '), points: '각 +1,000 POINTS'};
  if (data.reason === 'time_limit') return {tone: 'victory', tag: 'TIME SURVIVED', title: '생존 성공', detail: mine ? '제한 시간까지 살아남았어요!' : '제한 시간까지 살아남은 플레이어', names: winners[0], points: '+1,000 POINTS'};
  return {tone: 'victory', tag: 'LAST SURVIVOR', title: '최후의 생존자', detail: mine ? '당신이 마지막까지 살아남았어요!' : '마지막까지 살아남은 플레이어', names: winners[0], points: '+1,000 POINTS'};
}
if (typeof module !== 'undefined') module.exports = { monsterEscapeCamera, monsterEscapeInterpolate, monsterEscapeDeathProgress, monsterEscapeFinale, monsterEscapeCanSee, monsterEscapeVisibility, monsterEscapeVisibleWalls };

function setupMonsterEscape(ws, role, getName) {
  const host = role === 'host';
  const root = document.createElement('section');
  root.className = 'me-screen'; root.hidden = true;
  root.innerHTML = '<div class="me-panel"><header><div class="me-heading"><span class="me-kicker">SURVIVAL · 탈출 작전</span><h1>🧟 좀비 피하기</h1></div><strong data-time>준비 중</strong></header>' +
    '<p data-status>좀비를 피해 살아남으세요!</p><p data-map-name></p><div class="me-board"><canvas width="600" height="600" aria-label="좀비와 참가자의 위치가 표시된 경기장"></canvas></div>' +
    '<div class="me-control"><p>벽을 바라보고 벽 넘기 버튼을 눌러요</p><div class="me-control-row">' +
      '<div class="me-jump-area"><button type="button" class="me-jump" data-jump disabled aria-label="벽 넘기">' +
        '<span aria-hidden="true">↗</span><strong>벽 넘기</strong><small data-jump-count>' + MONSTER_ESCAPE_JUMP_LIMIT + ' / ' + MONSTER_ESCAPE_JUMP_LIMIT + '</small></button>' +
        '<small class="me-jump-hint" data-jump-hint aria-live="polite">얇은 벽 앞에서 사용</small></div>' +
      '<div class="me-stick" role="application" aria-label="이동 조이스틱"><div class="me-knob"></div></div></div></div></div>' +
    '<div class="me-finale" data-finale hidden role="status" aria-live="polite">' +
      '<div class="me-finale-particles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="me-finale-card"><div class="me-finale-mark" aria-hidden="true"><span>✦</span></div>' +
      '<span class="me-finale-tag" data-finale-tag></span><h2 data-finale-title></h2><p class="me-finale-detail" data-finale-detail></p>' +
      '<div class="me-finale-rule" aria-hidden="true"><span></span><b>✦</b><span></span></div>' +
      '<p class="me-finale-names" data-finale-names></p><p class="me-finale-points" data-finale-points></p>' +
      '<p class="me-finale-next">잠시 후 점수 화면으로 이동합니다</p></div></div>';
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  // 별도 마스크에 어둠을 그려서, 원본 경기장에는 영향을 주지 않는다.
  const darkness = document.createElement('canvas'); darkness.width = canvas.width; darkness.height = canvas.height;
  const darknessCtx = darkness.getContext('2d');
  const sightMask = document.createElement('canvas'); sightMask.width = canvas.width; sightMask.height = canvas.height;
  const sightCtx = sightMask.getContext('2d');
  const entry = document.querySelector('script[data-game-ui="monster_escape"]');
  const assetBase = entry ? entry.src : location.href;
  function loadSprite(file) { const image = new Image(); image.src = new URL(file, assetBase).href; return image; }
  const playerSprite = loadSprite('cartoon-soldier-walk.png');
  const zombieSprite = loadSprite('cartoon-zombie-walk.png');
  let zombieDirections = [], zombieMovedAt = [], playerMovedAt = {}, playerDeathAt = {};
  function drawSprite(image, direction, moving, size, zombie = false) {
    ctx.save();
    if (image.complete && image.naturalWidth) {
      if (zombie) {
        // 기존 좀비는 위에서 본 그림으로 방향에 맞춰 회전한다.
        ctx.rotate(Math.atan2(direction[1], direction[0]) + Math.PI / 2);
        const frame = moving ? Math.floor(performance.now() / 120) % 8 : 0;
        ctx.drawImage(image, frame * 64, 0, 64, 64, -size * .52, -size * .52, size * 1.04, size * 1.04);
      } else {
        // 군인과 좀비는 같은 탑다운 시점이며 위쪽을 향하는 원본을 함께 회전한다.
        ctx.rotate(Math.atan2(direction[1], direction[0]) + Math.PI / 2);
        const sequence = [0, 1, 2, 1];
        const frame = moving ? sequence[Math.floor(performance.now() / 150) % 4] : 1;
        ctx.drawImage(image, frame * 128, 0, 128, 128, -size * .52, -size * .52, size * 1.04, size * 1.04);
      }
    } else { ctx.fillStyle = zombie ? '#9acb77' : '#55abf6'; ctx.beginPath(); ctx.arc(0, 0, size * .25, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  // 탈락 시 짧게 흔들리고 주저앉으며 붉은 파문이 퍼진다. 판정에는 영향을 주지 않는다.
  function drawPlayer(p, name, size) {
    const progress = p.alive ? null : monsterEscapeDeathProgress(playerDeathAt[name], performance.now());
    ctx.save();
    if (progress !== null && progress < 1) {
      ctx.strokeStyle = `rgba(255, 113, 92, ${(1 - progress) * .9})`;
      ctx.lineWidth = Math.max(2, size * .05);
      ctx.beginPath(); ctx.arc(0, 0, size * (.25 + progress * .50), 0, Math.PI * 2); ctx.stroke();
      ctx.font = `bold ${Math.max(12, size * .22)}px sans-serif`; ctx.textAlign = 'center';
      ctx.lineWidth = Math.max(3, size * .045); ctx.strokeStyle = '#241d22'; ctx.fillStyle = '#ffb1a1';
      ctx.strokeText('탈락!', 0, -size * (.55 + progress * .15)); ctx.fillText('탈락!', 0, -size * (.55 + progress * .15));
      ctx.rotate(Math.sin(progress * Math.PI * 4) * .22 * (1 - progress));
      ctx.scale(1 - progress * .18, 1 - progress * .30);
      ctx.globalAlpha = 1 - progress * .55;
    } else if (!p.alive || !p.connected) ctx.globalAlpha = .35;
    if (p.alive && p.jump) {
      const lift = Math.sin(Math.PI * Math.max(0, Math.min(1, p.jump.progress)));
      ctx.translate(0, -size * .42 * lift);
      ctx.scale(1 + .12 * lift, 1 + .12 * lift);
    }
    drawSprite(playerSprite, p.facing || [0, -1], p.alive && performance.now() - (playerMovedAt[name] || 0) < 220, size);
    ctx.restore();
  }
  const stick = root.querySelector('.me-stick'), knob = root.querySelector('.me-knob');
  const jumpButton = root.querySelector('[data-jump]'), jumpCount = root.querySelector('[data-jump-count]'), jumpHint = root.querySelector('[data-jump-hint]');
  const control = root.querySelector('.me-control'), status = root.querySelector('[data-status]'), clock = root.querySelector('[data-time]'), mapName = root.querySelector('[data-map-name]');
  const finale = root.querySelector('[data-finale]');
  function showFinale(data) {
    const view = monsterEscapeFinale(data, role, getName());
    finale.dataset.tone = view.tone;
    for (const field of ['tag', 'title', 'detail', 'names', 'points'])
      finale.querySelector(`[data-finale-${field}]`).textContent = view[field];
    finale.hidden = false;
  }
  control.hidden = host;
  let snapshot = null, previous = null, receivedAt = 0, frame = null, playing = false, direction = {x: 0, y: 0}, pointer = null;
  const INTERPOLATION_MS = 100; // 서버가 보내는 0.1초 간격 사이를 화면에서만 부드럽게 잇는다.
  function displayed(now) { return monsterEscapeInterpolate(previous, snapshot, (now - receivedAt) / INTERPOLATION_MS); }
  function render(now) {
    frame = null;
    if (root.hidden || !snapshot) return;
    draw(displayed(now));
    frame = requestAnimationFrame(render);
  }
  function startRendering() { if (frame === null) frame = requestAnimationFrame(render); }
  function stopRendering() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  function send() {
    if (playing && !host && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({type: 'me_move', data: direction}));
  }
  const timer = setInterval(() => { if (pointer !== null) send(); }, 100);
  function reset() { pointer = null; direction = {x: 0, y: 0}; knob.style.transform = 'translate(-50%, -50%)'; send(); }
  function update(event) {
    const r = stick.getBoundingClientRect();
    let x = (event.clientX - r.left - r.width / 2) / (r.width * .36);
    let y = (event.clientY - r.top - r.height / 2) / (r.height * .36);
    const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
    direction = {x, y}; knob.style.transform = `translate(calc(-50% + ${x * r.width * .36}px), calc(-50% + ${y * r.height * .36}px))`; send();
  }
  stick.addEventListener('pointerdown', e => { if (!playing || pointer !== null) return; e.preventDefault(); pointer = e.pointerId; stick.setPointerCapture(pointer); update(e); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === pointer) { e.preventDefault(); update(e); } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, e => { if (e.pointerId === pointer) reset(); });
  function requestJump() {
    if (!playing || host || jumpButton.disabled || ws.readyState !== WebSocket.OPEN) return;
    jumpHint.textContent = '얇은 벽 가까이서 눌러요';
    jumpButton.disabled = true;  // 다음 서버 상태에서 남은 횟수를 다시 확인한다.
    ws.send(JSON.stringify({type: 'me_jump', data: {}}));
  }
  // 두 번째 손가락의 click은 모바일에서 생략될 수 있으므로 pointerdown으로 처리한다.
  jumpButton.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    requestJump();
  });
  jumpButton.addEventListener('click', e => { if (e.detail === 0) requestJump(); });  // 키보드·보조기기
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  ws.addEventListener('close', () => { reset(); playing = false; finale.hidden = true; stopRendering(); if (!root.hidden) status.textContent = '서버 연결이 끊겼어요.'; });
  function draw(snapshot) {
    if (!snapshot || !ctx) return;
    const rows = snapshot.map, mine = snapshot.players[getName()];
    // 준비 카운트다운에 아직 내 위치가 없는 동안은 맵을 미리 노출하지 않는다.
    if (!host && !mine) { ctx.fillStyle = '#101a1b'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    const {size, offsetX, offsetY} = monsterEscapeCamera(host, rows, mine, canvas.width);
    ctx.fillStyle = '#101a1b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(offsetX, offsetY);
    rows.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      const px = x * size, py = y * size;
      // 보이는 타일만 그려 휴대폰에서 불필요한 그리기 작업을 줄인다.
      if (px + offsetX > canvas.width || py + offsetY > canvas.height || px + size + offsetX < 0 || py + size + offsetY < 0) return;
      if (cell === '#') {
        // 판정은 기존 격자 그대로. 나뭇잎이 풍성한 공원 생울타리만 시각적으로 추가한다.
        ctx.fillStyle = '#263a2b'; ctx.fillRect(px, py, size, size);
        ctx.fillStyle = '#172e23'; ctx.fillRect(px, py + size * .78, size, size * .22);
        const leaves = [[.18,.29,.21],[.49,.22,.25],[.82,.3,.22],[.27,.55,.23],[.65,.56,.27],[.9,.57,.18]];
        leaves.forEach(([a,b,r], i) => {
          ctx.fillStyle = i % 2 ? '#355e3d' : '#2e5238';
          ctx.beginPath(); ctx.arc(px + size * a, py + size * b, size * r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(143,180,116,.16)';
          ctx.beginPath(); ctx.ellipse(px + size * (a - .045), py + size * (b - .065), size * r * .48, size * r * .23, -.4, 0, Math.PI * 2); ctx.fill();
        });
        if ((x * 3 + y * 7) % 5 === 0) {
          ctx.fillStyle = '#c7977a'; ctx.beginPath(); ctx.arc(px + size * .58, py + size * .47, size * .035, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        // 이어진 흙길과 자갈: 바닥은 밝게, 벽은 어둡게 유지해 이동 가능 영역을 구분한다.
        ctx.fillStyle = (x * 7 + y * 11) % 3 === 0 ? '#777d69' : '#737b67'; ctx.fillRect(px, py, size, size);
        ctx.fillStyle = 'rgba(205,207,169,.10)';
        ctx.beginPath(); ctx.ellipse(px + size * .35, py + size * .4, size * .27, size * .15, -.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9b9b7c';
        [[.17,.22],[.68,.72],[.84,.25]].forEach(([a,b], i) => {
          if ((x * 5 + y * 3 + i) % 3 !== 0) return;
          ctx.beginPath(); ctx.ellipse(px + size * a, py + size * b, size * .035, size * .021, -.3, 0, Math.PI * 2); ctx.fill();
        });
      }
    }));
    snapshot.monsters.forEach((m, i) => {
      if (!host && mine && !monsterEscapeCanSee(rows, mine, {x: m[0], y: m[1]})) return;
      ctx.save(); ctx.translate(m[0] * size, m[1] * size);
      ctx.fillStyle = 'rgba(7,18,12,.38)'; ctx.beginPath(); ctx.ellipse(0, size * .2, size * .3, size * .13, 0, 0, Math.PI * 2); ctx.fill();
      const angle = zombieDirections[i] || 0;
      drawSprite(zombieSprite, [Math.cos(angle), Math.sin(angle)], performance.now() - (zombieMovedAt[i] || 0) < 220, size, true);
      if (snapshot.reinforcements_in > 0 && i >= snapshot.monsters.length - 3) {
        ctx.font = `bold ${Math.max(10, size * .20)}px sans-serif`; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#203528'; ctx.strokeText('Z', 0, -size * .40); ctx.fillStyle = '#f9e5ae'; ctx.fillText('Z', 0, -size * .40);
      }
      ctx.restore();
    });
    Object.entries(snapshot.players).forEach(([name, p], index) => {
      if (!host && mine && name !== getName() && !monsterEscapeCanSee(rows, mine, p)) return;
      ctx.save(); ctx.translate(p.x * size, p.y * size);
      ctx.fillStyle = 'rgba(20,30,25,.24)'; ctx.beginPath(); ctx.ellipse(0, size * .25, size * .29, size * .1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ['#55abf6', '#f17fa6', '#ffcd57', '#56dbac'][index % 4];
      ctx.fillRect(-size * .13, size * .28, size * .26, size * .055);
      drawPlayer(p, name, size);
      const jumpLift = p.alive && p.jump ? Math.sin(Math.PI * Math.max(0, Math.min(1, p.jump.progress))) * size * .42 : 0;
      ctx.font = `bold ${Math.max(12, size * .18)}px sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = Math.max(3, size * .05); ctx.strokeStyle = '#273745'; ctx.strokeText(name, 0, -size * .45 - jumpLift, size * 2.2); ctx.fillStyle = '#fff'; ctx.fillText(name, 0, -size * .45 - jumpLift, size * 2.2);
      ctx.restore();
    });
    ctx.restore();
    if (!host && mine && sightCtx) {
      // 처음 닿는 벽은 보이고 그 너머의 바닥과 대상은 가린다. 정전 여부와 무관하다.
      const polygon = monsterEscapeVisibility(rows, mine);
      sightCtx.globalCompositeOperation = 'source-over';
      sightCtx.clearRect(0, 0, sightMask.width, sightMask.height);
      sightCtx.fillStyle = '#0a1415'; sightCtx.fillRect(0, 0, sightMask.width, sightMask.height);
      sightCtx.globalCompositeOperation = 'destination-out';
      sightCtx.beginPath();
      polygon.forEach((point, i) => {
        const x = offsetX + point.x * size, y = offsetY + point.y * size;
        if (!i) sightCtx.moveTo(x, y); else sightCtx.lineTo(x, y);
      });
      sightCtx.closePath(); sightCtx.fill();
      // 보이는 첫 벽 타일은 온전히 보여 장벽의 모양과 점프 가능성을 알아보기 쉽게 한다.
      monsterEscapeVisibleWallSurface(rows, mine).forEach(({x, y}) => sightCtx.fillRect(offsetX + x * size, offsetY + y * size, size, size));
      sightCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(sightMask, 0, 0);
    }
    if (!host && snapshot.lighting === 'blackout' && mine && darknessCtx) {
      const cx = offsetX + mine.x * size, cy = offsetY + mine.y * size;
      const facing = mine.facing || [0, -1], angle = Math.atan2(facing[1], facing[0]);
      darknessCtx.globalCompositeOperation = 'source-over';
      darknessCtx.clearRect(0, 0, darkness.width, darkness.height);
      darknessCtx.fillStyle = 'rgba(3, 9, 13, .97)'; darknessCtx.fillRect(0, 0, darkness.width, darkness.height);
      darknessCtx.globalCompositeOperation = 'destination-out';
      // 여러 겹의 반투명 원뿔과 그라데이션으로 손전등 경계를 부드럽게 만든다.
      const glow = darknessCtx.createRadialGradient(cx, cy, 0, cx, cy, size * 3.2);
      glow.addColorStop(0, 'rgba(255,255,255,1)'); glow.addColorStop(.45, 'rgba(255,255,255,.9)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
      for (let i = 0; i < 5; i++) {
        const half = Math.PI / 6 + .10 - i * .035;
        darknessCtx.globalAlpha = .5; darknessCtx.fillStyle = glow;
        darknessCtx.beginPath(); darknessCtx.moveTo(cx, cy); darknessCtx.arc(cx, cy, size * 3.2, angle - half, angle + half); darknessCtx.closePath(); darknessCtx.fill();
      }
      darknessCtx.globalAlpha = 1;
      darknessCtx.globalCompositeOperation = 'source-over';
      ctx.drawImage(darkness, 0, 0);
      // 주변 원형 빛은 없애되, 자신의 캐릭터는 어둠 위에 다시 그려 위치를 알아볼 수 있게 한다.
      ctx.save(); ctx.translate(cx, cy);
      drawPlayer(mine, getName(), size);
      ctx.restore();
    }
  }
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data), data = msg.data || {};
    if (msg.type === 'round_start' || msg.type === 'return_lobby' || msg.type === 'match_cancelled' || msg.type === 'match_error') {
      reset(); playing = false; root.hidden = true; finale.hidden = true; snapshot = null; previous = null; zombieDirections = []; zombieMovedAt = []; playerMovedAt = {}; playerDeathAt = {}; stopRendering();
    } else if (msg.type === 'me_intro') {
      root.hidden = false; finale.hidden = true; playing = false; jumpButton.disabled = true; jumpCount.textContent = `${MONSTER_ESCAPE_JUMP_LIMIT} / ${MONSTER_ESCAPE_JUMP_LIMIT}`; jumpHint.textContent = '얇은 벽 앞에서 사용'; clock.textContent = '곧 시작!'; status.textContent = '좀비를 피해 살아남으세요!';
      mapName.textContent = data.map_name ? `맵: ${data.map_name}` : '';
      snapshot = {map: data.map, players: {}, monsters: []}; previous = null; draw(snapshot);
    } else if (msg.type === 'me_state') {
      root.hidden = false;
      const now = performance.now();
      previous = snapshot ? displayed(now) : data;
      if (snapshot && Array.isArray(snapshot.monsters)) data.monsters.forEach((monster, i) => {
        const old = snapshot.monsters[i];
        if (old && Math.hypot(monster[0] - old[0], monster[1] - old[1]) > .001) {
          zombieDirections[i] = Math.atan2(monster[1] - old[1], monster[0] - old[0]); zombieMovedAt[i] = now;
        }
      });
      if (snapshot && snapshot.players) Object.entries(data.players).forEach(([name, p]) => {
        const old = snapshot.players[name];
        if (old && old.alive && !p.alive && p.connected) playerDeathAt[name] = now;
        if (old && Math.hypot(p.x - old.x, p.y - old.y) > .001) playerMovedAt[name] = now;
      });
      snapshot = data; receivedAt = now;
      startRendering();
      const me = data.players[getName()]; playing = !data.ending && (host || !!(me && me.alive && me.connected));
      if (!host && me) {
        const left = me.jumps_left ?? 0;
        jumpCount.textContent = `${left} / ${MONSTER_ESCAPE_JUMP_LIMIT}`;
        jumpButton.disabled = !playing || left <= 0 || !!me.jump;
        if (!me.alive) jumpHint.textContent = '관전 중';
        else if (me.jump) jumpHint.textContent = '벽을 넘는 중!';
        else if (left <= 0) jumpHint.textContent = '모두 사용했어요';
        else if (previous && previous.players && previous.players[getName()] && previous.players[getName()].jump) jumpHint.textContent = '착지 완료!';
      }
      if (!playing && pointer !== null) reset();
      clock.textContent = `남은 시간 ${Math.ceil(data.remaining)}초`;
      status.dataset.lighting = data.lighting || 'normal';
      mapName.textContent = `맵: ${data.map_name || '정원'} (${data.map[0].length}×${data.map.length})${data.reinforcements_in > 0 ? ` · 중앙 좀비 출발까지 ${Math.ceil(data.reinforcements_in)}초` : ''}`;
      if (data.ending) {
        clock.textContent = '생존 결과 확인 중';
        status.textContent = data.ending === 'last_survivor' ? '마지막 생존자가 결정됐어요!' : data.ending === 'time_limit' ? '제한 시간이 끝났어요!' : '모든 플레이어가 탈락했어요.';
      } else if (!host && me && !me.alive) status.textContent = '탈락했어요 · 관전 중';
      else if (data.lighting === 'warning') status.textContent = '⚠️ 곧 정전! 손전등을 준비하세요';
      else if (data.lighting === 'blackout') status.textContent = host ? '🔦 정전 중 · 참가자의 시야가 좁아졌어요' : '🔦 정전! 이동 방향을 비춰요';
      else status.textContent = '좀비를 피해 도망가요!';
    } else if (msg.type === 'me_over') {
      reset(); playing = false; jumpButton.disabled = true; stopRendering(); if (snapshot) draw(snapshot); clock.textContent = '게임 종료';
      status.textContent = data.winners && data.winners.length ? '우승: ' + data.winners.join(', ') : '경기가 종료됐어요.';
      showFinale(data);
    } else if (msg.type === 'round_result' || msg.type === 'match_over' || msg.type === 'game_cancelled') {
      reset(); playing = false; root.hidden = true; finale.hidden = true; stopRendering();
    }
  });
}
