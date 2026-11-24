// 무궁화 게임의 PC·휴대폰 공통 결과 화면. 게임 점수는 서버 결과를 그대로 표시한다.
function setupRedLightResult(ws, role, getName) {
  const root = document.createElement('section');
  root.className = 'rl-result'; root.hidden = true;
  root.setAttribute('role', 'region'); root.setAttribute('aria-label', '무궁화 게임 결과');
  document.body.appendChild(root);
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function show(data) {
    const ranking = Array.isArray(data.ranking) ? data.ranking : [];
    const eliminated = new Set(data.eliminated || []);
    const arrived = new Set(data.arrived || []);
    const me = role === 'player' ? getName() : null;
    const winner = data.winner;
    const headline = winner == null ? '우승자 없음' : esc(winner) + (winner === me ? ' <span class="rl-result-me">나</span>' : '');
    const detail = winner == null ? '모두 탈락했어요. 다음 게임에서 다시 도전!' :
      (arrived.has(winner) ? '결승선에 가장 먼저 도착했어요!' : '술래에게 가장 가까이 다가갔어요!');
    const rows = ranking.map((name, index) => {
      const dead = eliminated.has(name);
      const distance = data.dist && Number.isFinite(data.dist[name]) ? data.dist[name].toFixed(1) + 'm 남음' : '';
      const state = dead ? '탈락' : arrived.has(name) ? '결승선 도착' : distance;
      const score = data.scores && Number.isFinite(data.scores[name]) ? data.scores[name] : 0;
      return '<div class="rl-result-row' + (name === me ? ' is-me' : '') + '">' +
        '<span class="rl-result-rank' + (index === 0 && !dead ? ' is-first' : '') + '">' + (dead ? '탈락' : (index + 1) + '위') + '</span>' +
        '<span class="rl-result-person"><strong>' + esc(name) + (name === me ? ' <small>나</small>' : '') + '</strong><span>' + esc(state) + '</span></span>' +
        '<span class="rl-result-score"><small>게임 점수</small><strong>' + score.toLocaleString('ko-KR') + '점</strong></span></div>';
    }).join('');
    root.innerHTML = '<div class="rl-result-card"><div class="rl-result-top"><span class="rl-result-kicker">GAME RESULT</span><span class="rl-result-lights"><i></i><i></i></span></div>' +
      '<h2>무궁화 게임 결과</h2><p class="rl-result-subtitle">멈추고, 움직이고! 이번 경기의 기록이에요.</p>' +
      '<div class="rl-result-winner"><span class="rl-result-icon">🌸</span><div><span>이번 게임 우승</span><strong>' + headline + '</strong><small>' + detail + '</small></div></div>' +
      '<div class="rl-result-rows">' + rows + '</div><p class="rl-result-footer">잠시 후 대회 점수를 집계해요 <span>→</span></p></div>';
    root.hidden = false;
  }
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'game_over') show(message.data || {});
    else if (['round_start', 'round_result', 'return_lobby', 'match_cancelled', 'match_error', 'game_cancelled'].includes(message.type)) root.hidden = true;
  });
}
