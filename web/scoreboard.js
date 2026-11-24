// 서버가 확정한 대회 점수를 PC와 휴대폰에 표시한다. 숫자 애니메이션은 표시만 바꾼다.
function setupScoreboard(ws, role, getName) {
  const overlay = document.createElement('div');
  overlay.className = 'scoreboard-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '대회 점수');
  overlay.innerHTML = '<section class="scoreboard-card">' +
    '<p class="scoreboard-kicker"></p><h2 class="scoreboard-title" aria-live="polite"></h2>' +
    '<p class="scoreboard-subtitle"></p><div class="scoreboard-winners" hidden></div>' +
    '<div class="scoreboard-rows"></div><p class="scoreboard-footer"></p></section>';
  document.body.appendChild(overlay);

  const kicker = overlay.querySelector('.scoreboard-kicker');
  const title = overlay.querySelector('.scoreboard-title');
  const subtitle = overlay.querySelector('.scoreboard-subtitle');
  const winnersEl = overlay.querySelector('.scoreboard-winners');
  const rowsEl = overlay.querySelector('.scoreboard-rows');
  const footer = overlay.querySelector('.scoreboard-footer');
  let data = null, mode = null, endAt = 0, startedAt = 0, timer = null, frame = null, values = [];
  const animateMs = 1800;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const number = value => Number(value || 0).toLocaleString('ko-KR');

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stopTimers() {
    clearInterval(timer); timer = null;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function hide() {
    stopTimers(); overlay.hidden = true; data = null; mode = null; values = [];
  }

  function showWinners() {
    if (mode !== 'final') { winnersEl.hidden = true; return; }
    const winners = Array.isArray(data.winners) ? data.winners : [];
    winnersEl.hidden = false;
    winnersEl.replaceChildren();
    winnersEl.appendChild(element('span', 'scoreboard-trophy', '🏆'));
    const label = winners.length === 0 ? '우승자 없음' : winners.length > 1 ? '공동 우승' : '최종 우승';
    const detail = winners.length ? winners.join(' · ') : '현재 참가 중인 플레이어가 없어요';
    const text = element('div', 'scoreboard-winner-text');
    text.appendChild(element('strong', 'scoreboard-winner-label', label));
    text.appendChild(element('span', 'scoreboard-winner-names', detail));
    winnersEl.appendChild(text);
  }

  function renderRows() {
    rowsEl.replaceChildren(); values = [];
    const standings = Array.isArray(data.standings) ? data.standings : [];
    const roundScores = data.scores || {};
    const me = role === 'player' ? getName() : null;
    for (const entry of standings) {
      const active = entry.connected === true;
      const row = element('div', 'scoreboard-row' + (active ? '' : ' is-left') + (entry.name === me ? ' is-me' : ''));
      const rankText = active ? (mode === 'round' && !reduceMotion ? '…' : entry.rank + '위') : '이탈';
      const rank = element('div', 'scoreboard-rank' + (entry.rank === 1 ? ' is-first' : ''), rankText);
      const identity = element('div', 'scoreboard-identity');
      const name = element('strong', 'scoreboard-name', entry.name);
      identity.appendChild(name);
      if (entry.name === me) identity.appendChild(element('span', 'scoreboard-me', '나'));
      const stateText = active ? (mode === 'round' && !reduceMotion ? '점수 합산 중' : (entry.rank === 1 ? '현재 1위' : '대회 참가 중')) : '순위 제외 · 점수 보존';
      const state = element('span', 'scoreboard-state', stateText);
      identity.appendChild(state);
      const points = element('div', 'scoreboard-points');
      const score = Number(entry.score) || 0;
      const earned = mode === 'round' ? Number(roundScores[entry.name] || 0) : 0;
      const gain = mode === 'round' ? element('span', 'scoreboard-gain', '+0') : null;
      const total = element('strong', 'scoreboard-total', number(mode === 'round' ? score - earned : score) + '점');
      if (gain) points.appendChild(gain);
      points.appendChild(total);
      row.append(rank, identity, points); rowsEl.appendChild(row);
      values.push({total, gain, score, earned, rank, state, active, placement: entry.rank});
    }
    if (!standings.length) rowsEl.appendChild(element('p', 'scoreboard-empty', '참가자 기록이 없어요.'));
    showWinners();
  }

  function updateValues(progress) {
    const eased = 1 - Math.pow(1 - progress, 3);
    for (const item of values) {
      const added = Math.round(item.earned * eased);
      item.total.textContent = number(item.score - item.earned + added) + '점';
      if (item.gain) item.gain.textContent = '+' + number(added);
      if (item.active) {
        item.rank.textContent = progress < 1 ? '…' : item.placement + '위';
        item.state.textContent = progress < 1 ? '점수 합산 중' : (item.placement === 1 ? '현재 1위' : '대회 참가 중');
      }
    }
  }

  function animate(now) {
    const progress = reduceMotion ? 1 : Math.min(1, Math.max(0, (now - startedAt) / animateMs));
    updateValues(progress);
    if (progress < 1 && !overlay.hidden) frame = requestAnimationFrame(animate);
    else frame = null;
  }

  function updateFooter() {
    const left = Math.max(0, Math.ceil((endAt - performance.now()) / 1000));
    const label = mode === 'final' ? '로비로 돌아가기까지' :
      data.round === data.total_rounds ? '최종 결과까지' : '다음 게임까지';
    footer.textContent = label + ' ' + left + '초';
  }

  function show(nextMode, nextData) {
    stopTimers(); mode = nextMode; data = nextData; overlay.hidden = false;
    const seconds = Math.max(0, Number(data.seconds) || 0);
    startedAt = performance.now(); endAt = startedAt + seconds * 1000;
    if (mode === 'round') {
      kicker.textContent = 'ROUND ' + data.round + ' / ' + data.total_rounds;
      title.textContent = '이번 게임 점수 집계';
      subtitle.textContent = (data.game_name || '게임') + ' · 누적 점수를 확인해요';
    } else {
      kicker.textContent = 'PARTY COMPLETE';
      title.textContent = '최종 결과';
      subtitle.textContent = '모든 게임이 끝났어요!';
    }
    renderRows();
    if (mode === 'round') frame = requestAnimationFrame(animate);
    else updateValues(1);
    updateFooter(); timer = setInterval(updateFooter, 250);
  }

  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data), d = msg.data || {};
    if (msg.type === 'round_result') show('round', d);
    else if (msg.type === 'match_over') show('final', d);
    else if (msg.type === 'match_standings_update' && data && !overlay.hidden) {
      data.standings = d.standings; data.winners = d.winners;
      renderRows();
      const progress = mode === 'round' && !reduceMotion ? Math.min(1, Math.max(0, (performance.now() - startedAt) / animateMs)) : 1;
      updateValues(progress);
    } else if (['round_start', 'return_lobby', 'match_cancelled', 'match_error', 'game_cancelled'].includes(msg.type)) hide();
  });
  ws.addEventListener('close', () => {
    if (!overlay.hidden) { stopTimers(); footer.textContent = '서버 연결이 끊겼어요. 새로고침해 주세요.'; }
  });
}
