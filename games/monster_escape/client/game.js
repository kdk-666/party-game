// 표시할 점프 횟수. 서버 game.py의 JUMP_LIMIT과 같게 유지한다.
const MONSTER_ESCAPE_JUMP_LIMIT = 5;
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
// 버려진 물류창고 전용 외형. 충돌과 시야는 기존 격자를 그대로 사용한다.
function monsterEscapeWarehouseTile(ctx, cell, x, y, size, rows) {
  const px = x * size, py = y * size;
  const rect = (color, a, b, w, h) => {
    ctx.fillStyle = color; ctx.fillRect(px + a * size, py + b * size, w * size, h * size);
  };
  const noise = (n) => ((Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663) ^ Math.imul(n + 1, 83492791)) >>> 0) % 997 / 997;
  const line = (color, width, points) => {
    ctx.strokeStyle = color; ctx.lineWidth = size * width;
    ctx.beginPath(); points.forEach(([a,b], i) => i ? ctx.lineTo(px+a*size,py+b*size) : ctx.moveTo(px+a*size,py+b*size)); ctx.stroke();
  };
  if (cell !== '#') {
    rect(['#92938b','#90918a','#94958e'][Math.floor(noise(0)*3)], 0,0,1,1);
    if (x % 3 === 0) rect('#83857e',0,0,.012,1);
    if (y % 3 === 0) rect('#83857e',0,0,1,.012);
    for (let i=0;i<4;i++) rect('rgba(45,49,45,.09)',.08+noise(i+1)*.8,.08+noise(i+5)*.8,.025,.018);
    if (noise(10)<.18) line('#71756d',.014,[[.12,.12],[.34,.31],[.29,.48],[.63,.74]]);
    if (noise(11)<.10) {
      ctx.fillStyle='rgba(48,53,48,.13)'; ctx.beginPath(); ctx.ellipse(px+size*.53,py+size*.52,size*.27,size*.13,-.35,0,Math.PI*2); ctx.fill();
    }
    if (y === 4 || y === rows.length - 2) rect('#bca35b',.06,.83,.78,.035);
    return;
  }
  const edge = x === 0 || y === 0 || x === rows[0].length - 1 || y === rows.length - 1;
  const open = (a,b) => rows[b]?.[a] === '.';
  const thin = !edge && ((open(x-1,y) && open(x+1,y)) || (open(x,y-1) && open(x,y+1)));
  rect('#303b40',0,0,1,1);
  if (edge) {
    rect('#51595b',.025,.025,.95,.85); rect('#777e7e',.025,.025,.95,.07);
    rect('#343c3e',.025,.85,.95,.12);
  } else if (thin) {
    rect('#62452e',.035,.035,.93,.93); rect('#b18b5c',.09,.09,.82,.76);
    for(let i=1;i<4;i++) rect('#886641',.10,.09+i*.19,.80,.025);
    rect('#d0ad77',.12,.10,.09,.73); rect('#d0ad77',.79,.10,.09,.73);
    line('#795635',.065,[[.22,.76],[.78,.17]]);
    rect('#4e3929',.09,.85,.82,.08);
    rect('#e4bd68',.34,.87,.32,.055);
  } else {
    const colors = ['#526c70','#6d5148','#59645a'];
    const base = colors[Math.floor(noise(20)*colors.length)];
    rect(base,.035,.035,.93,.93);
    for(let i=0;i<6;i++) {
      rect('rgba(0,0,0,.19)',.10+i*.14,.09,.035,.76);
      rect('rgba(255,255,255,.14)',.135+i*.14,.09,.025,.76);
    }
    rect('#a0a39a',.06,.05,.88,.045); rect('#29383b',.04,.86,.92,.10);
    rect('#926047',.12+noise(21)*.4,.68,.24,.075);
    rect('#c0c3b6',.68,.17,.17,.075);
  }
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
function monsterEscapeSpectator(players, viewer, current, step = 0) {
  if (!players[viewer] || players[viewer].alive) return null;
  const names = Object.keys(players).filter(n => players[n].alive && players[n].connected);
  if (!names.length) return null;
  const index = names.indexOf(current);
  return names[index < 0 ? 0 : (index + step + names.length) % names.length];
}
if (typeof module !== 'undefined') module.exports = { monsterEscapeSpectator, monsterEscapeCamera, monsterEscapeInterpolate, monsterEscapeDeathProgress, monsterEscapeFinale, monsterEscapeCanSee, monsterEscapeVisibility, monsterEscapeVisibleWalls };

function setupMonsterEscape(ws, role, getName) {
  const host = role === 'host';
  const root = document.createElement('section');
  root.className = host ? 'me-screen me-host' : 'me-screen me-player'; root.hidden = true;
  root.innerHTML = '<div class="me-panel"><header><div class="me-heading"><span class="me-kicker">SURVIVAL · 탈출 작전</span><h1>🧟 좀비 피하기</h1></div><strong data-time>준비 중</strong></header>' +
    '<div class="me-audio"><button type="button" data-music>음악</button><button type="button" data-effects>효과음</button></div><p data-status>좀비를 피해 살아남으세요!</p><div class="me-map-strip"><strong data-map-name></strong><span data-survivors></span></div><div class="me-board"><canvas width="600" height="600" aria-label="좀비와 참가자의 위치가 표시된 경기장"></canvas></div>' +
    '<div class="me-control"><p>벽을 바라보고 벽 넘기 버튼을 눌러요</p><div class="me-control-row">' +
      '<div class="me-jump-area"><button type="button" class="me-jump" data-jump disabled aria-label="벽 넘기">' +
        '<span aria-hidden="true">↗</span><strong>벽 넘기</strong><small data-jump-count>' + MONSTER_ESCAPE_JUMP_LIMIT + ' / ' + MONSTER_ESCAPE_JUMP_LIMIT + '</small></button>' +
        '<div class="me-charge" aria-hidden="true"><i></i></div><small class="me-jump-hint" data-jump-hint aria-live="polite">얇은 벽 앞에서 사용</small></div>' +
      '<div class="me-stick" role="application" aria-label="이동 조이스틱"><div class="me-knob"></div></div></div></div>' +
    '<div class="me-spectator" hidden><p>관전 모드</p><div class="me-spectator-row"><button type="button" data-watch-prev aria-label="이전 생존자">‹</button><div><strong data-watch-name></strong><p data-watch-info></p></div><button type="button" data-watch-next aria-label="다음 생존자">›</button></div></div></div>' +
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
  const tracks = {
    normal: {file: 'void-estate.ogg', group: 'music', loop: true, html5: true, volume: .26},
    heart: {file: 'heart.mp3', group: 'effects', loop: true, volume: .35},
    start: {file: 'start.mp3', group: 'effects', volume: .35},
    rush: {file: 'rush.mp3', group: 'effects', volume: .55},
    hit: {file: 'hit.mp3', group: 'effects', volume: .8},
    win: {file: 'win.mp3', group: 'effects', volume: .55},
    loss: {file: 'loss.mp3', group: 'effects', volume: .40},
  };
  for (let i = 1; i <= 6; i++) {
    tracks['groan'+i] = {file: `groan${i}.mp3`, group: 'effects'};
    tracks['foot'+i] = {file: `foot${i}.mp3`, group: 'effects'};
  }
  const audio = !host && typeof PartyAudio === 'function' ? PartyAudio('/static/audio/zombie/', tracks) : null;
  let audioPhase = '', audioPlayer = null, nextGroan = 0, nextFoot = 0, duckUntil = 0;
  let audioEnded = false;
  function resetAudio() { audio?.stopAll(); audioEnded = false; audioPhase = ''; audioPlayer = null; nextGroan = nextFoot = duckUntil = 0; }
  function randomSound(prefix, volume) { audio.play(prefix + (1 + Math.floor(Math.random()*6)), volume); }
  function syncAudio(data) {
    if (!audio || !data?.players) return;
    if (audioEnded) return;
    const now = performance.now(), me = data.players[getName()];
    if (me && audioPlayer?.alive && !me.alive) { audio.play('hit'); duckUntil = now + 1400; }
    if (data.ending) {
      audioEnded = true;
      audio.stop('heart');
      for (let i = 1; i <= 6; i++) { audio.stop('groan'+i); audio.stop('foot'+i); }
      audio.fadeOut('normal', 1000);
      if (me?.alive) audio.play('win');
      else if (data.ending === 'all_eliminated' && !(me && audioPlayer?.alive)) audio.play('loss');
      return;
    }
    const phase = data.remaining <= 30 ? 'rush' : 'normal';
    if (audioPhase !== phase) { audio.play(audioPhase ? 'rush' : 'start'); audioPhase = phase; duckUntil = now + 900; }
    const listener = me?.alive ? me : data.players[watched];
    const distance = listener ? Math.min(Infinity, ...data.monsters.filter(m => monsterEscapeCanSee(data.map,listener,{x:m[0],y:m[1]})).map(m => Math.hypot(m[0]-listener.x,m[1]-listener.y))) : Infinity;
    audio.play('normal', now < duckUntil ? .10 : distance < 2 ? .15 : .26);
    if (me?.alive && distance < 6) {
      audio.play('heart', Math.min(.48, .15 + (6-distance)*.055));
      audio.rate('heart', Math.min(1.85, 1 + (6-distance)*.15));
    } else audio.stop('heart');
    if (distance < 6 && now >= nextGroan) {
      randomSound('groan', Math.min(.28, .055 + (6-distance)*.038));
      nextGroan = now + 3800 + Math.random()*2400;
    }
    if (me?.alive && audioPlayer && now >= nextFoot && !me.jump && (audioPlayer.jump || Math.hypot(me.x-audioPlayer.x,me.y-audioPlayer.y) > .015)) {
      randomSound('foot', audioPlayer.jump ? .48 : .22); nextFoot = now + 350;
    }
    audioPlayer = me ? {alive: me.alive, x: me.x, y: me.y, jump: !!me.jump} : null;
  }
  root.querySelector('.me-audio').hidden = host;
  for (const [group, selector, label] of [['music','[data-music]','음악'],['effects','[data-effects]','효과음']]) {
    const button = root.querySelector(selector);
    function refresh() { const muted = audio?.isMuted(group); button.textContent = label + (muted ? ' 끔' : ' 켬'); button.setAttribute('aria-pressed', String(!muted)); }
    refresh();
    button.addEventListener('click', () => { if (!audio) return; audio.enable(); audio.setMuted(group, !audio.isMuted(group)); refresh(); if (snapshot && playing) syncAudio(snapshot); });
  }
  document.addEventListener('pointerdown', () => { audio?.enable(); if (!root.hidden && snapshot && playing) syncAudio(snapshot); }, {passive: true});
  const spectator = root.querySelector('.me-spectator');
  const watchPrev = root.querySelector('[data-watch-prev]'), watchNext = root.querySelector('[data-watch-next]');
  let watched = null;
  function updateSpectator(data, step = 0) {
    const me = data.players[getName()];
    const eliminated = !host && !!me && !me.alive;
    watched = eliminated ? monsterEscapeSpectator(data.players, getName(), watched, step) : null;
    control.hidden = host || eliminated;
    spectator.hidden = !eliminated || !!data.ending || !watched;
    const count = Object.values(data.players).filter(p => p.alive && p.connected).length;
    watchPrev.disabled = watchNext.disabled = count < 2;
    if (watched) {
      spectator.querySelector('[data-watch-name]').textContent = watched + ' 관전 중';
      spectator.querySelector('[data-watch-info]').textContent = `생존자 ${count}명 · 남은 점프 ${data.players[watched].jumps_left ?? 0}회${data.players[watched].jump_recharge_in != null ? ` · 충전 ${Math.ceil(data.players[watched].jump_recharge_in)}초` : ''}`;
    }
  }
  watchPrev.addEventListener('click', () => { if (snapshot && !spectator.hidden) updateSpectator(snapshot, -1); });
  watchNext.addEventListener('click', () => { if (snapshot && !spectator.hidden) updateSpectator(snapshot, 1); });
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
  ws.addEventListener('close', () => { resetAudio(); reset(); playing = false; finale.hidden = true; stopRendering(); if (!root.hidden) status.textContent = '서버 연결이 끊겼어요.'; });
  function draw(snapshot) {
    if (!snapshot || !ctx) return;
    const viewName = watched ?? getName();
    const rows = snapshot.map, mine = snapshot.players[viewName];
    // 준비 카운트다운에 아직 내 위치가 없는 동안은 맵을 미리 노출하지 않는다.
    if (!host && !mine) { ctx.fillStyle = '#101a1b'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    const {size, offsetX, offsetY} = monsterEscapeCamera(host, rows, mine, canvas.width);
    ctx.fillStyle = '#101a1b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(offsetX, offsetY);
    rows.forEach((row, y) => Array.from(row).forEach((cell, x) => {
      const px = x * size, py = y * size;
      // 보이는 타일만 그려 휴대폰에서 불필요한 그리기 작업을 줄인다.
      if (px + offsetX > canvas.width || py + offsetY > canvas.height || px + size + offsetX < 0 || py + size + offsetY < 0) return;
      if (snapshot.map_name === '버려진 물류창고') {
        monsterEscapeWarehouseTile(ctx, cell, x, y, size, rows);
        return;
      }
      if (snapshot.map_name === '폐허가 된 도심') {
        const wall = (a, b) => rows[b]?.[a] === '#';
        const floor = (a, b) => rows[b]?.[a] === '.';
        const horizontalJump = floor(x-1,y) && floor(x+1,y);
        const verticalJump = floor(x,y-1) && floor(x,y+1);
        const noise = n => ((Math.imul(x+31,73856093)^Math.imul(y+17,19349663)^Math.imul(n+1,83492791))>>>0)%997/997;
        const rect = (color,a,b,w,h) => { ctx.fillStyle=color; ctx.fillRect(px+a*size,py+b*size,w*size,h*size); };
        rect(['#656a70','#686d72','#62676c'][Math.floor(noise(0)*3)],0,0,1,1);
        if (cell !== '#') {
          if (noise(1)<.28) {
            ctx.strokeStyle='#50555a'; ctx.lineWidth=size*.018;
            ctx.beginPath(); ctx.moveTo(px+size*.12,py+size*.06); ctx.lineTo(px+size*.38,py+size*.42); ctx.lineTo(px+size*.29,py+size*.68); ctx.stroke();
          }
          for(let i=0;i<3;i++) rect('#85898a',.08+noise(i+2)*.84,.08+noise(i+5)*.84,.025,.018);
          if (wall(x-1,y)) rect('#85817a',0,0,.09,1);
          if (wall(x+1,y)) rect('#85817a',.91,0,.09,1);
        }
        if (cell === '#') {
          const attachedToBuilding = [[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy]) => {
            const a = x+dx, b = y+dy;
            return wall(a,b) && !(floor(a-1,b) && floor(a+1,b)) && !(floor(a,b-1) && floor(a,b+1));
          });
          if ((horizontalJump || verticalJump) && attachedToBuilding) {
            // 건물에 붙은 낮은 잔해: 실제 점프 가능한 타일만 밝게 표시한다.
            ctx.fillStyle = '#a99579'; ctx.fillRect(px,py,size,size);
            ctx.fillStyle = '#c4b49a'; ctx.fillRect(px+size*.08,py+size*.08,size*.84,size*.84);
            ctx.strokeStyle = '#665e53'; ctx.lineWidth = size*.045;
            ctx.beginPath(); ctx.moveTo(px+size*.15,py+size*.25);
            ctx.lineTo(px+size*.48,py+size*.48); ctx.lineTo(px+size*.32,py+size*.82);
            ctx.moveTo(px+size*.48,py+size*.48); ctx.lineTo(px+size*.85,py+size*.35); ctx.stroke();
          } else if (horizontalJump || verticalJump) {
            // 실제 한 칸 점프 가능 방향과 차량의 방향을 일치시킨다.
            ctx.save(); ctx.translate(px+size/2, py+size/2);
            if (horizontalJump && !verticalJump) ctx.rotate(Math.PI/2);
            ctx.fillStyle = '#34383c'; ctx.fillRect(-size/2,-size/2,size,size);
            ctx.fillStyle = '#20262b';
            for (const a of [-.32,.22]) for (const b of [-.39,.28]) ctx.fillRect(size*a,size*b,size*.16,size*.11);
            ctx.fillStyle = ['#ad9167','#9b6656','#819c9c'][Math.floor(noise(2)*3)]; ctx.fillRect(-size*.46,-size*.34,size*.92,size*.68);
            ctx.fillStyle = '#b9b6a1'; ctx.fillRect(-size*.06,-size*.25,size*.17,size*.50);
            ctx.fillStyle = '#414f57'; ctx.fillRect(-size*.24,-size*.28,size*.18,size*.56);
            ctx.fillRect(size*.12,-size*.28,size*.16,size*.56);
            ctx.fillStyle = '#d4c8a2'; ctx.fillRect(-size*.45,-size*.25,size*.07,size*.14);
            ctx.fillRect(-size*.45,size*.11,size*.07,size*.14);
            ctx.restore();
          } else {
            ctx.fillStyle = '#45474a'; ctx.fillRect(px,py,size,size);
            rect('#57595b',.08,.08,.84,.84);
            rect('#77797a',.08,.08,.84,.045); rect('#77797a',.08,.08,.045,.70);
            if (noise(3)<.35) { rect('#3c4145',.30,.28,.38,.38); rect('#73787a',.34,.32,.30,.08); }
            else if (noise(4)<.4) { rect('#45494d',.18,.42,.64,.045); rect('#45494d',.45,.18,.045,.64); }
            ctx.fillStyle = '#303236';
            if (!wall(x,y+1)) ctx.fillRect(px,py+size*.78,size,size*.22);
            if (!wall(x+1,y)) ctx.fillRect(px+size*.86,py,size*.14,size);
          }
        } else if ((x === Math.floor(rows[0].length/2) || y === Math.floor(rows.length/2)) && (x+y)%2 === 0) {
          ctx.fillStyle = '#c7bd91';
          if (x === Math.floor(rows[0].length/2)) ctx.fillRect(px+size*.47,py+size*.18,size*.06,size*.64);
          if (y === Math.floor(rows.length/2)) ctx.fillRect(px+size*.18,py+size*.47,size*.64,size*.06);
        }
        return;
      }
      // 정원: 낮은 울타리와 높은 생울타리를 실제 점프 가능 방향으로 구분한다.
      const rect = (color,a,b,w,h) => { ctx.fillStyle=color; ctx.fillRect(px+a*size,py+b*size,w*size,h*size); };
      const noise = n => ((Math.imul(x+31,73856093)^Math.imul(y+17,19349663)^Math.imul(n+1,83492791))>>>0)%997/997;
      const floor = (a,b) => rows[b]?.[a] === '.';
      const edge = x===0 || y===0 || x===rows[0].length-1 || y===rows.length-1;
      const low = !edge && ((floor(x-1,y)&&floor(x+1,y)) || (floor(x,y-1)&&floor(x,y+1)));
      if (cell === '#') {
        rect('#263a2b',0,0,1,1);
        if (low) {
          rect('#8c805f',.05,.05,.90,.90);
          rect('#c1af83',.09,.09,.82,.72);
          rect('#77694e',.09,.81,.82,.10);
          for(let i=0;i<3;i++) rect('#a39470',.12+i*.27,.12,.025,.67);
          rect('#d9c69a',.09,.09,.82,.06);
        } else {
          rect('#172e23',0,.78,1,.22);
          for(let i=0;i<7;i++) {
            const a=.16+(i%3)*.31, b=.18+Math.floor(i/3)*.27;
            ctx.fillStyle=['#355b39','#416947','#2e5034'][Math.floor(noise(i)*3)];
            ctx.beginPath(); ctx.ellipse(px+size*a,py+size*b,size*.15,size*.16,0,0,Math.PI*2); ctx.fill();
            rect('rgba(171,194,128,.20)',a-.06,b-.07,.07,.035);
          }
        }
      } else {
        rect(['#858a70','#888c73','#82876d'][Math.floor(noise(0)*3)],0,0,1,1);
        rect('#92947d',.035,.035,.93,.93);
        if(noise(1)<.35) {
          ctx.strokeStyle='#727761'; ctx.lineWidth=size*.015;
          ctx.beginPath(); ctx.moveTo(px+size*.12,py+size*.08); ctx.lineTo(px+size*.38,py+size*.39); ctx.lineTo(px+size*.29,py+size*.65); ctx.stroke();
        }
        for(let i=0;i<3;i++) rect('#737d50',.08+noise(i+2)*.80,.08+noise(i+5)*.80,.035,.018);
      }
    }));
    snapshot.monsters.forEach((m, i) => {
      if (!host && mine && !monsterEscapeCanSee(rows, mine, {x: m[0], y: m[1]})) return;
      ctx.save(); ctx.translate(m[0] * size, m[1] * size);
      ctx.fillStyle = 'rgba(7,18,12,.38)'; ctx.beginPath(); ctx.ellipse(0, size * .2, size * .3, size * .13, 0, 0, Math.PI * 2); ctx.fill();
      const angle = zombieDirections[i] || 0;
      drawSprite(zombieSprite, [Math.cos(angle), Math.sin(angle)], performance.now() - (zombieMovedAt[i] || 0) < 220, size, true);
      if (snapshot.reinforcements_in > 0) {
        ctx.font = `bold ${Math.max(10, size * .20)}px sans-serif`; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#203528'; ctx.strokeText('Z', 0, -size * .40); ctx.fillStyle = '#f9e5ae'; ctx.fillText('Z', 0, -size * .40);
      }
      ctx.restore();
    });
    Object.entries(snapshot.players).forEach(([name, p], index) => {
      if (!host && mine && name !== viewName && !monsterEscapeCanSee(rows, mine, p)) return;
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

  }
  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data), data = msg.data || {};
    if (msg.type === 'round_start' || msg.type === 'return_lobby' || msg.type === 'match_cancelled' || msg.type === 'match_error') {
      resetAudio(); watched = null; spectator.hidden = true; control.hidden = host;
      reset(); playing = false; root.hidden = true; finale.hidden = true; snapshot = null; previous = null; zombieDirections = []; zombieMovedAt = []; playerMovedAt = {}; playerDeathAt = {}; stopRendering();
    } else if (msg.type === 'me_intro') {
      resetAudio(); watched = null; spectator.hidden = true; control.hidden = host;
      root.hidden = false; finale.hidden = true; playing = false; jumpButton.disabled = true; jumpCount.textContent = `${MONSTER_ESCAPE_JUMP_LIMIT} / ${MONSTER_ESCAPE_JUMP_LIMIT}`; jumpHint.textContent = '얇은 벽 앞에서 사용'; clock.style.color = ''; clock.textContent = '곧 시작!'; status.textContent = '좀비를 피해 살아남으세요!';
      mapName.textContent = data.map_name || ''; root.querySelector('[data-survivors]').textContent = ''; root.querySelector('.me-charge').style.setProperty('--charge', '100%');
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
        const charge = me.jump_recharge_in == null ? (left >= MONSTER_ESCAPE_JUMP_LIMIT ? 1 : 0) : Math.max(0, Math.min(1, 1 - me.jump_recharge_in / 15));
        root.querySelector('.me-charge').style.setProperty('--charge', `${charge * 100}%`);
        jumpButton.disabled = !playing || left <= 0 || !!me.jump;
        if (!me.alive) jumpHint.textContent = '관전 중';
        else if (me.jump) jumpHint.textContent = '벽을 넘는 중!';
        else if (me.jump_recharge_in != null) jumpHint.textContent = `다음 충전 ${Math.ceil(me.jump_recharge_in)}초`;
        else jumpHint.textContent = '얇은 벽 앞에서 사용';
      }
      if (!playing && pointer !== null) reset();
      updateSpectator(data);
      syncAudio(data);
      clock.style.color = data.remaining <= 30 && !data.ending ? '#ef4444' : '';
      const seconds = Math.max(0, Math.ceil(data.remaining));
      clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      root.querySelector('[data-survivors]').textContent = `생존 ${Object.values(data.players).filter(p => p.alive && p.connected).length} / ${Object.keys(data.players).length}`;
      mapName.textContent = `${data.map_name || '정원'}${data.reinforcements_in > 0 ? ` · 좀비 출발까지 ${Math.ceil(data.reinforcements_in)}초` : ''}`;
      if (data.ending) {
        clock.textContent = '생존 결과 확인 중';
        status.textContent = data.ending === 'last_survivor' ? '마지막 생존자가 결정됐어요!' : data.ending === 'time_limit' ? '제한 시간이 끝났어요!' : '모든 플레이어가 탈락했어요.';
      } else if (!host && me && !me.alive) status.textContent = '탈락했어요 · 관전 중';
      else status.textContent = '좀비를 피해 도망가요!';
    } else if (msg.type === 'me_over') {
      spectator.hidden = true;
      reset(); playing = false; jumpButton.disabled = true; stopRendering(); if (snapshot) draw(snapshot); clock.style.color = ''; clock.textContent = '게임 종료';
      status.textContent = data.winners && data.winners.length ? '우승: ' + data.winners.join(', ') : '경기가 종료됐어요.';
      if (!audioEnded) {
        audioEnded = true;
        audio?.stop('heart');
        audio?.fadeOut('normal', 1000);
        audio?.play(data.winners?.includes(getName()) ? 'win' : 'loss');
      }
      showFinale(data);
    } else if (msg.type === 'round_result' || msg.type === 'match_over' || msg.type === 'game_cancelled') {
      resetAudio(); watched = null; spectator.hidden = true; control.hidden = host;
      reset(); playing = false; root.hidden = true; finale.hidden = true; stopRendering();
    }
  });
}
