// PC는 전체 맵, 참가자는 내 캐릭터 주변 7칸만 보여준다.
function monsterEscapeCamera(host, rows, player, canvasWidth) {
  const view = host ? rows[0].length : 7;
  const size = canvasWidth / view;
  const x = host ? view / 2 : (player ? player.x : 1.5);
  const y = host ? rows.length / 2 : (player ? player.y : 1.5);
  return { size, offsetX: canvasWidth / 2 - x * size, offsetY: canvasWidth / 2 - y * size };
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
    players[name] = {...p, x: mix(before.x, p.x), y: mix(before.y, p.y)};
  }
  const monsters = current.monsters.map((p, i) => {
    const before = previous.monsters[i] || p;
    return [mix(before[0], p[0]), mix(before[1], p[1])];
  });
  return {...current, players, monsters};
}
if (typeof module !== 'undefined') module.exports = { monsterEscapeCamera, monsterEscapeInterpolate, monsterEscapeDeathProgress };

function setupMonsterEscape(ws, role, getName) {
  const host = role === 'host';
  const root = document.createElement('section');
  root.className = 'me-screen'; root.hidden = true;
  root.innerHTML = '<div class="me-panel"><header><div class="me-heading"><span class="me-kicker">SURVIVAL · 탈출 작전</span><h1>🧟 좀비 피하기</h1></div><strong data-time>준비 중</strong></header>' +
    '<p data-status>좀비를 피해 살아남으세요!</p><p data-map-name></p><div class="me-board"><canvas width="600" height="600" aria-label="좀비와 참가자의 위치가 표시된 경기장"></canvas></div>' +
    '<div class="me-control"><p>조이스틱을 밀어서 이동해요</p><div class="me-stick" role="application" aria-label="이동 조이스틱"><div class="me-knob"></div></div></div></div>';
  document.body.appendChild(root);
  const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
  // 별도 마스크에 어둠을 그려서, 원본 경기장에는 영향을 주지 않는다.
  const darkness = document.createElement('canvas'); darkness.width = canvas.width; darkness.height = canvas.height;
  const darknessCtx = darkness.getContext('2d');
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
    drawSprite(playerSprite, p.facing || [0, -1], p.alive && performance.now() - (playerMovedAt[name] || 0) < 220, size);
    ctx.restore();
  }
  const stick = root.querySelector('.me-stick'), knob = root.querySelector('.me-knob');
  const control = root.querySelector('.me-control'), status = root.querySelector('[data-status]'), clock = root.querySelector('[data-time]'), mapName = root.querySelector('[data-map-name]');
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
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  ws.addEventListener('close', () => { reset(); playing = false; stopRendering(); if (!root.hidden) status.textContent = '서버 연결이 끊겼어요.'; });
  function draw(snapshot) {
    if (!snapshot || !ctx) return;
    const rows = snapshot.map, mine = snapshot.players[getName()];
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
      ctx.save(); ctx.translate(p.x * size, p.y * size);
      ctx.fillStyle = 'rgba(20,30,25,.24)'; ctx.beginPath(); ctx.ellipse(0, size * .25, size * .29, size * .1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ['#55abf6', '#f17fa6', '#ffcd57', '#56dbac'][index % 4];
      ctx.fillRect(-size * .13, size * .28, size * .26, size * .055);
      drawPlayer(p, name, size);
      ctx.font = `bold ${Math.max(12, size * .18)}px sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = Math.max(3, size * .05); ctx.strokeStyle = '#273745'; ctx.strokeText(name, 0, -size * .45, size * 2.2); ctx.fillStyle = '#fff'; ctx.fillText(name, 0, -size * .45, size * 2.2);
      ctx.restore();
    });
    ctx.restore();
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
      reset(); playing = false; root.hidden = true; snapshot = null; previous = null; zombieDirections = []; zombieMovedAt = []; playerMovedAt = {}; playerDeathAt = {}; stopRendering();
    } else if (msg.type === 'me_intro') {
      root.hidden = false; playing = false; clock.textContent = '곧 시작!'; status.textContent = '좀비를 피해 살아남으세요!';
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
      const me = data.players[getName()]; playing = host || !!(me && me.alive && me.connected);
      if (!playing && pointer !== null) reset();
      clock.textContent = `남은 시간 ${Math.ceil(data.remaining)}초`;
      status.dataset.lighting = data.lighting || 'normal';
      mapName.textContent = `맵: ${data.map_name || '정원'}${data.reinforcements_in > 0 ? ` · 중앙 좀비 출발까지 ${Math.ceil(data.reinforcements_in)}초` : ''}`;
      if (!host && me && !me.alive) status.textContent = '탈락했어요 · 관전 중';
      else if (data.lighting === 'warning') status.textContent = '⚠️ 곧 정전! 손전등을 준비하세요';
      else if (data.lighting === 'blackout') status.textContent = host ? '🔦 정전 중 · 참가자의 시야가 좁아졌어요' : '🔦 정전! 이동 방향을 비춰요';
      else status.textContent = '좀비를 피해 도망가요!';
    } else if (msg.type === 'me_over') {
      reset(); playing = false; stopRendering(); if (snapshot) draw(snapshot); clock.textContent = '게임 종료';
      status.textContent = data.winners && data.winners.length ? '우승: ' + data.winners.join(', ') : '경기가 종료됐어요.';
    } else if (msg.type === 'round_result' || msg.type === 'match_over' || msg.type === 'game_cancelled') {
      reset(); playing = false; root.hidden = true; stopRendering();
    }
  });
}
