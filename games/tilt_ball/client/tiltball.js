// 기울여서 공 굴리기 화면. 노트북(host)과 폰(player)이 같은 파일을 쓴다.
// 사용법: setupTiltBall(ws, "host" 또는 "player", () => 내 닉네임)

// ---- 기울기 계산 (화면과 상관없는 순수 계산) ----
function tbWrap(d) { while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
function tbClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// beta: 앞뒤(윗부분이 들리면 +), gamma: 좌우(오른쪽이 내려가면 +). 기준(b0, g0)에서 얼마나 기울었는지를 -1~1로.
function tbTilt(beta, gamma, b0, g0, range, dead) {
  dead = dead === undefined ? 2 : dead;
  const f = (d) => Math.abs(d) < dead ? 0 : tbClamp((d - Math.sign(d) * dead) / (range - dead), -1, 1);
  return {x: f(tbWrap(gamma - g0)), y: f(tbWrap(beta - b0))};
}
if (typeof module !== "undefined") module.exports = {tbTilt, tbWrap};

function setupTiltBall(ws, role, getName) {
  let root = document.getElementById("tb-screen");
  if (!root) {                                   // 게임 화면은 게임 폴더만으로 동작해야 하므로 HTML에 없으면 스스로 만든다
    root = document.createElement("div");
    root.id = "tb-screen"; root.className = "tb-screen"; root.hidden = true;
    document.body.appendChild(root);
  }
  const COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b"];
  const VIEW_CELLS = 7;                 // 폰: 화면 가로에 보이는 칸 수 (작을수록 크게)
  const isHost = role === "host";

  root.innerHTML =
    '<canvas></canvas>' +
    '<div class="tb-hud" hidden><span data-k="left"></span><span data-k="info"></span></div>' +
    '<div class="tb-toast" hidden></div><div class="tb-banner" hidden></div><div class="tb-count" hidden></div>' +
    '<button class="tb-recal" hidden>영점 조절</button>' +
    '<div class="tb-card" data-k="card" hidden></div>';
  const cv = root.querySelector("canvas"); let ctx = cv.getContext("2d");
  const hud = root.querySelector(".tb-hud"), toast = root.querySelector(".tb-toast");
  const banner = root.querySelector(".tb-banner"), countEl = root.querySelector(".tb-count");
  const card = root.querySelector('[data-k="card"]'), recal = root.querySelector(".tb-recal");
  if (isHost) hud.classList.add("host");                        // 노트북: 남은 시간을 크게 가운데에
  const RECAL_COOLDOWN = 20;                                    // 영점 조절 쿨타임(초)
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

  let maze = null, names = [], colors = {}, snap = null, recvAt = 0, shown = {};
  let phase = "idle", timeLimit = 90, lastSaves = 0, toastTimer = null, running = false;
  let lastTs = null, lagSamples = [];                       // 지연(ms) 측정용
  const debug = localStorage.getItem("tbDebug") === "1";   // 지연 표시는 개발자용: 콘솔에서 localStorage.tbDebug="1"
  const sec = (v) => (typeof v === "number" ? v : "?");     // 도착 시간이 없을 때 'undefined'가 화면에 뜨지 않게
  // 폰 센서
  let beta = null, gamma = null, b0 = 0, g0 = 0, sensing = false, wakeLock = null, tiltTimer = null;
  let range = Number(localStorage.getItem("tiltRange")) || 25;

  // ---------- 공통 ----------
  function show() { root.hidden = false; if (!running) { running = true; requestAnimationFrame(draw); resize(); } }
  function hide() { root.hidden = true; running = false; phase = "idle"; clearInterval(tiltTimer); tiltTimer = null; sensing = false;
                    window.removeEventListener("deviceorientation", onOrientation); releaseWake(); recal.hidden = true; resetRecal(); }
  // 노트북은 해상도 상한을 둬서 가볍게 한다
  function resize() { const r = Math.min(window.devicePixelRatio || 1, isHost ? 1.25 : 2); cv.width = Math.round(cv.clientWidth * r); cv.height = Math.round(cv.clientHeight * r); }
  window.addEventListener("resize", resize);
  function say(t, ms) {
    toast.textContent = t; toast.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms || 1600);
  }
  function setBanner(t) { if (t) { banner.textContent = t; banner.hidden = false; } else banner.hidden = true; }
  function send(obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
  const portrait = () => !(screen.orientation && screen.orientation.angle % 180 !== 0);

  // ---------- 영점 조절: 누른 순간의 각도가 새 기준(0점). 쿨타임 동안은 반투명하고 눌리지 않는다 ----------
  let recalUntil = 0, recalTimer = null;
  function recalTick() {
    const left = Math.ceil((recalUntil - Date.now()) / 1000);
    if (left > 0) { recal.classList.add("cool"); recal.disabled = true; recal.textContent = "영점 조절 (" + left + ")"; }
    else { clearInterval(recalTimer); recalTimer = null; recal.classList.remove("cool"); recal.disabled = false; recal.textContent = "영점 조절"; }
  }
  recal.onclick = () => {
    if (Date.now() < recalUntil) return;
    if (beta === null) { say("센서 값이 없어요", 1200); return; }
    b0 = beta; g0 = gamma;
    recalUntil = Date.now() + RECAL_COOLDOWN * 1000;
    say("🎯 영점 조절 완료", 1200);
    clearInterval(recalTimer); recalTick(); recalTimer = setInterval(recalTick, 250);
  };
  function resetRecal() { recalUntil = 0; clearInterval(recalTimer); recalTimer = null; recalTick(); }

  // ---------- 폰 센서 ----------
  let calibrateNext = false;            // true이면 다음에 들어오는 센서 값을 기준(0점)으로 삼는다
  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    beta = e.beta; gamma = e.gamma;
    if (calibrateNext) { b0 = beta; g0 = gamma; calibrateNext = false; }
  }
  async function requestWake() {
    if (!("wakeLock" in navigator)) return false;
    try { wakeLock = await navigator.wakeLock.request("screen"); return true; } catch (e) { return false; }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
  document.addEventListener("visibilitychange", () => { if (sensing && document.visibilityState === "visible") requestWake(); });

  async function pressReady(btn, note) {
    const DOE = window.DeviceOrientationEvent;                     // iPhone은 버튼을 누르는 이 순간에 권한을 물어야 한다
    if (DOE && typeof DOE.requestPermission === "function") {
      try { if (await DOE.requestPermission() !== "granted") { note.textContent = "센서 권한이 거부됐어요. 설정에서 허용해 주세요."; return; } }
      catch (e) { note.textContent = "센서 권한 요청 실패: " + e.name; return; }
    }
    const wake = await requestWake();
    calibrateNext = true;                                          // 지금 각도(첫 센서 값)가 기준(0점)
    window.addEventListener("deviceorientation", onOrientation);
    sensing = true;
    for (let i = 0; i < 12 && calibrateNext; i++) await new Promise((r) => setTimeout(r, 50));   // 첫 값을 최대 0.6초 기다림
    btn.disabled = true; btn.textContent = "준비 완료 ✓";
    note.textContent = beta === null ? "센서 값이 없어요. 방향키로만 움직일 수 있어요." : (wake ? "" : "화면이 꺼지지 않게 가끔 화면을 만져 주세요.");
    send({type: "tb_ready", data: {}});
  }
  const keys = {};
  window.addEventListener("keydown", (e) => { keys[e.key] = true; });
  window.addEventListener("keyup", (e) => { keys[e.key] = false; });
  function currentTilt() {
    let t = {x: 0, y: 0};
    if (beta !== null && portrait()) {
      t = tbTilt(beta, gamma, b0, g0, range);
      if (localStorage.getItem("tiltFlipx") === "1") t.x = -t.x;      // tilt-test 화면에서 정한 방향 설정을 같이 쓴다
      if (localStorage.getItem("tiltFlipy") === "1") t.y = -t.y;
    }
    if (keys.ArrowLeft) t.x = -1; if (keys.ArrowRight) t.x = 1;       // 노트북에서 시험할 때
    if (keys.ArrowUp) t.y = -1; if (keys.ArrowDown) t.y = 1;
    return t;
  }
  function startSending() {
    clearInterval(tiltTimer);
    if (isHost) return;                                           // 노트북은 센서를 안 쓰니 아무것도 보내지 않는다
    tiltTimer = setInterval(() => {
      if (phase !== "race") return;
      const t = currentTilt();
      send({type: "tilt", data: {x: t.x, y: t.y, ts: Date.now()}});
    }, 33);
  }

  // ---------- 메시지 ----------
  function showIntro(d) {
    card.classList.remove("tb-result-card"); card.classList.remove("tb-result-wait");
    show(); phase = "intro"; maze = d.maze; names = d.names; timeLimit = d.time_limit;
    names.forEach((n, i) => { colors[n] = COLORS[i % COLORS.length]; });
    snap = null; shown = {}; lastSaves = 0; lastTs = null; lagSamples = []; setBanner(""); hud.hidden = true;
    parts = []; trail = {}; fallAt = {}; prevPos = {}; spin = {}; texKey = ""; hostCache = null;
    const lv = Number(maze.level) || 0;                                  // 코스 이름과 난이도(★)
    const course = maze.name ? '<p class="tb-small">코스: <b>' + esc(maze.name) + '</b> ' + "★".repeat(lv) + "☆".repeat(Math.max(0, 3 - lv)) + '</p>' : "";
    if (isHost) {
      card.innerHTML = '<h2>기울여서 공 굴리기</h2>' + course + '<p>폰으로 "준비" 버튼을 눌러 주세요</p><p class="tb-small">기울기 기준을 맞추는 중이에요</p>' +
        '<div data-k="ready"></div>';
      renderReady([], names.length);
    } else {
      card.innerHTML = '<h2>기울여서 공 굴리기</h2>' + course +
        '<p>폰을 <b>세로</b>로 편하게 잡고 아래 버튼을 누르세요.</p>' +
        '<p class="tb-small">누른 순간의 각도가 "평평한 상태"가 돼요. 기울여서 공을 굴려 GOAL까지 가세요!</p>' +
        '<button class="tb-btn" data-k="go">준비 완료</button><p class="tb-note" data-k="note"></p>';
      const btn = card.querySelector('[data-k="go"]'), note = card.querySelector('[data-k="note"]');
      btn.onclick = () => pressReady(btn, note);
    }
    card.hidden = false;
  }
  function renderReady(ready, total) {
    const el = card.querySelector('[data-k="ready"]');
    if (!el) return;
    el.innerHTML = names.map((n) => '<div class="tb-row"><span class="tb-chip" style="background:' + colors[n] + '"></span>' +
      esc(n) + ' <b>' + (ready.includes(n) ? "✓ 준비" : "대기 중") + '</b></div>').join("") +
      '<p class="tb-small">' + ready.length + ' / ' + total + '</p>';
  }
  function onState(d) {
    if (phase !== "race") { phase = "race"; card.hidden = true; countEl.hidden = true; hud.hidden = false; startSending(); if (!isHost) { recal.hidden = false; resetRecal(); } }
    const prevSnap = snap;
    snap = d.players; recvAt = performance.now();
    fxFromState(prevSnap);
    const left = Math.max(0, Math.ceil(d.left));
    hud.querySelector('[data-k="left"]').textContent = isHost
      ? "남은 시간 " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0")      // 노트북: 1:23 처럼 크게
      : "⏱ " + left + "초";
    hud.classList.toggle("low", left <= 10);                                                   // 10초 이하면 빨갛게
    const me = !isHost && snap[getName()];
    if (me) {
      hud.querySelector('[data-k="info"]').textContent = Math.round(me.progress * 100) + "%";
      if (me.cp_saves > lastSaves) say("🚩 체크포인트 저장!");
      lastSaves = me.cp_saves;
      setBanner(me.state === "fallen" ? "구멍에 빠졌어요!" : me.state === "finished" ? "🏁 도착! " + sec(me.finish_time) + "초" : "");
      const mine = d.ts && d.ts[getName()];
      if (typeof mine === "number" && mine !== lastTs) {            // 새로 도착한 측정값만 쓴다 (같은 값을 계속 쓰면 숫자가 계속 커진다)
        lastTs = mine;
        const ms = Date.now() - mine;
        if (ms >= 0 && ms < 5000) { lagSamples.push(ms); if (lagSamples.length > 15) lagSamples.shift(); }
      }
      if (debug && lagSamples.length && me.state !== "finished") {
        const sorted = [...lagSamples].sort((a, b) => a - b);        // 가운데 값(중앙값)을 보여 준다
        hud.querySelector('[data-k="info"]').textContent += "  ·  " + sorted[sorted.length >> 1] + "ms";
      }
    } else if (isHost) {
      hud.querySelector('[data-k="info"]').textContent = "";
    }
  }
  function showOver(d) {
    phase = "over"; clearInterval(tiltTimer); setBanner(""); hud.hidden = true; countEl.hidden = true; recal.hidden = true;
    const why = {all_finished: "모두 결승선에 도착했어요!", last_one: "한 명을 제외하고 모두 도착했어요.", time: "시간이 다 됐어요."}[d.reason] || "경주가 끝났어요!";
    const me = isHost ? null : getName();
    const rows = d.ranking.map((n, i) => {
      const r = d.results[n];
      const what = typeof r.finish_time === "number" ? "완주 " + r.finish_time + "초" : "진행 " + Math.round(r.progress * 100) + "%";
      const score = d.scores && Number.isFinite(d.scores[n]) ? d.scores[n] : 0;
      return '<div class="tb-result-row' + (n === me ? ' is-me' : '') + '"><b class="tb-result-rank' + (i === 0 ? ' is-first' : '') + '">' + (i + 1) + '등</b>' +
        '<span class="tb-result-person"><strong><i class="tb-chip" style="background:' + (colors[n] || '#97764f') + '"></i>' + esc(n) + (n === me ? ' <small>나</small>' : '') + '</strong>' +
        '<span>' + what + ' · 구멍 ' + r.falls + '번</span></span><span class="tb-result-score"><small>게임 점수</small><strong>' + score.toLocaleString('ko-KR') + '점</strong></span></div>';
    }).join("");
    const winner = d.winner == null ? '우승자 없음' : esc(d.winner);
    card.classList.add("tb-result-card");
    card.innerHTML = '<div class="tb-result-top"><span>GAME RESULT</span><span class="tb-result-marble">●</span></div>' +
      '<h2>공굴리기 결과</h2><p class="tb-result-subtitle">' + why + '</p>' +
      '<div class="tb-result-winner"><span class="tb-result-icon">🏁</span><div><span>이번 게임 우승</span><strong>' + winner + '</strong><small>' + (me && d.winner === me ? '우승! 멋진 주행이었어요!' : '멋진 주행이었어요!') + '</small></div></div>' +
      '<div class="tb-result-rows">' + rows + '</div><p class="tb-result-footer">잠시 후 대회 점수를 집계해요 →</p>' +
      '<button class="tb-result-dismiss" data-k="close">결과 닫기</button>';
    card.querySelector('[data-k="close"]').onclick = () => {
      hide();
      root.hidden = false; card.hidden = false;
      card.classList.add("tb-result-wait");
      card.innerHTML = '<p role="status">점수 집계를 기다리고 있어요.</p>';
    };
    card.hidden = false;
  }

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data), d = msg.data || {};
    if (msg.type === "tb_intro") showIntro(d);
    else if (msg.type === "tb_ready_update") renderReady(d.ready || [], d.total || names.length);
    else if (msg.type === "tb_count") { phase = "count"; card.hidden = true; countEl.hidden = false; countEl.textContent = d.n; countEl.style.animation = "none"; void countEl.offsetWidth; countEl.style.animation = ""; show(); }
    else if (msg.type === "tb_state") onState(d);
    else if (msg.type === "tb_over") showOver(d);
    else if (["round_start", "round_result", "return_lobby", "match_cancelled", "match_error", "game_cancelled"].includes(msg.type)) hide();
  });
  ws.addEventListener("close", () => { if (!root.hidden && !isHost) { setBanner("서버 연결이 끊겼어요. 새로고침해 주세요"); } });

  // ---------- 그리기 (나무판 위의 유리구슬 미로) ----------
  // 모든 그림은 캔버스로 직접 그린다 (이미지 파일 없음). 미로 바닥/벽은 한 번만 큰 그림으로 만들어 두고 매 프레임 잘라서 쓴다.
  const WALL_H = 0.13;                                             // 벽의 높이 (칸 크기 기준)
  const SHOW_TRAIL = true;                                          // 구슬 뒤의 짧은 꼬리 (끄려면 false)
  let tex = null, texKey = "", parts = [], trail = {}, fallAt = {}, lastFrame = 0, prevPos = {}, spin = {};

  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  // 색을 밝게(t>0) 또는 어둡게(t<0)
  function mix(h, t) { const f = (c) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t)); const [r, g, b] = rgb(h); return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")"; }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function buildTexture(rows) {
    const mh = rows.length, mw = rows[0].length;
    const T = Math.max(32, Math.min(128, Math.floor(4096 / Math.max(mw, mh))));          // 한 칸의 그림 크기(픽셀)
    const c = document.createElement("canvas"); c.width = mw * T; c.height = mh * T;            // 바닥층 (공 아래)
    const wc = document.createElement("canvas"); wc.width = mw * T; wc.height = mh * T;          // 벽층 (공 위에 덮는다: 벽 뒤의 공이 살짝 가려진다)
    const g = c.getContext("2d"), wg = wc.getContext("2d"), H = WALL_H * T, rand = rng(20251123);
    const isWall = (cc, rr) => rr < 0 || cc < 0 || rr >= mh || cc >= mw || rows[rr][cc] === "#";
    g.fillStyle = "#24160c"; g.fillRect(0, 0, c.width, c.height);

    // 1) 나무 바닥: 칸마다 살짝 다른 색 + 나뭇결
    for (let r = 0; r < mh; r++) for (let cc = 0; cc < mw; cc++) {
      if (isWall(cc, r)) continue;
      const x = cc * T, y = r * T, tone = (rand() - 0.5) * 0.06;
      const gr = g.createLinearGradient(x, y, x, y + T);
      gr.addColorStop(0, mix("#ecd0a0", tone)); gr.addColorStop(1, mix("#d9b27a", tone));
      g.fillStyle = gr; g.fillRect(x, y, T + 1, T + 1);
      g.lineWidth = Math.max(1, T * 0.012);
      for (let i = 0; i < 9; i++) {
        const yy = y + rand() * T, x0 = x + rand() * T * 0.4, len = T * (0.4 + rand() * 0.6);
        g.strokeStyle = "rgba(105,62,24," + (0.09 + rand() * 0.12).toFixed(3) + ")";
        g.beginPath(); g.moveTo(x0, yy); g.quadraticCurveTo(x0 + len * 0.5, yy + (rand() - 0.5) * T * 0.05, x0 + len, yy + (rand() - 0.5) * T * 0.04); g.stroke();
      }
      g.strokeStyle = "rgba(90,55,20,.07)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      // 벽 옆은 그림자 (빛은 왼쪽 위에서 온다)
      const band = (x0, y0, x1, y1, bx, by, bw, bh, a) => {
        const sg = g.createLinearGradient(x0, y0, x1, y1);
        sg.addColorStop(0, "rgba(30,15,5," + a + ")"); sg.addColorStop(1, "rgba(30,15,5,0)");
        g.fillStyle = sg; g.fillRect(bx, by, bw, bh);
      };
      if (isWall(cc, r - 1)) band(x, y, x, y + T * 0.5, x, y, T, T * 0.5, 0.5);
      if (isWall(cc - 1, r)) band(x, y, x + T * 0.4, y, x, y, T * 0.4, T, 0.36);
      if (isWall(cc + 1, r)) band(x + T, y, x + T * 0.82, y, x + T * 0.82, y, T * 0.18, T, 0.16);
      if (isWall(cc, r + 1)) band(x, y + T, x, y + T * 0.84, x, y + T * 0.84, T, T * 0.16, 0.16);
    }

    // 2) 벽: 먼저 앞면(아래 옆면), 그 위에 윗면을 입체적으로
    for (let r = 0; r < mh; r++) for (let cc = 0; cc < mw; cc++) {
      if (!isWall(cc, r) || isWall(cc, r + 1)) continue;
      const x = cc * T, y = r * T, fg = wg.createLinearGradient(x, y + T - H, x, y + T);
      fg.addColorStop(0, "#4b2c15"); fg.addColorStop(1, "#1f1008");
      wg.fillStyle = fg; wg.fillRect(x, y + T - H, T + 1, H + 1);
      wg.fillStyle = "rgba(0,0,0,.4)"; wg.fillRect(x, y + T - 2, T + 1, 2);
    }
    for (let r = 0; r < mh; r++) for (let cc = 0; cc < mw; cc++) {
      if (!isWall(cc, r)) continue;
      const x = cc * T, y = r * T - H, tg = wg.createLinearGradient(x, y, x + T, y + T);
      tg.addColorStop(0, "#946339"); tg.addColorStop(1, "#6f4526");
      wg.fillStyle = tg; wg.fillRect(x, y, T + 1, T + 1);
      wg.lineWidth = Math.max(1, T * 0.012);
      for (let i = 0; i < 4; i++) {
        const xx = x + rand() * T, y0 = y + rand() * T * 0.3, len = T * (0.4 + rand() * 0.5);
        wg.strokeStyle = "rgba(40,20,5," + (0.08 + rand() * 0.09).toFixed(3) + ")";
        wg.beginPath(); wg.moveTo(xx, y0); wg.quadraticCurveTo(xx + (rand() - 0.5) * T * 0.05, y0 + len * 0.5, xx, y0 + len); wg.stroke();
      }
      const e = Math.max(2, T * 0.05);                                          // 모서리 하이라이트/어두운 테두리
      if (!isWall(cc, r - 1)) { wg.fillStyle = "rgba(255,240,210,.68)"; wg.fillRect(x, y, T + 1, e); }
      if (!isWall(cc - 1, r)) { wg.fillStyle = "rgba(255,235,200,.3)"; wg.fillRect(x, y, e, T + 1); }
      if (!isWall(cc + 1, r)) { wg.fillStyle = "rgba(0,0,0,.32)"; wg.fillRect(x + T - e, y, e, T + 1); }
      if (!isWall(cc, r + 1)) { wg.fillStyle = "rgba(0,0,0,.34)"; wg.fillRect(x, y + T - e, T + 1, e); }
    }

    // 3) 구멍, 출발, 도착, 체크포인트 바닥 장식
    for (let r = 0; r < mh; r++) for (let cc = 0; cc < mw; cc++) {
      const ch = rows[r][cc], cx = cc * T + T / 2, cy = r * T + T / 2;
      if (ch === "O") {
        let sg = g.createRadialGradient(cx, cy, T * 0.3, cx, cy, T * 0.56);
        sg.addColorStop(0, "rgba(20,10,3,.55)"); sg.addColorStop(1, "rgba(20,10,3,0)");
        g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, T * 0.56, 0, 7); g.fill();                 // 바깥 그림자
        g.fillStyle = "#7a4d27"; g.beginPath(); g.arc(cx, cy, T * 0.42, 0, 7); g.fill();          // 테두리
        const hg = g.createRadialGradient(cx - T * 0.08, cy - T * 0.1, T * 0.04, cx, cy, T * 0.42);
        hg.addColorStop(0, "#000"); hg.addColorStop(0.55, "#0b0603"); hg.addColorStop(0.9, "#2a1a0b"); hg.addColorStop(1, "#4a2f16");
        g.fillStyle = hg; g.beginPath(); g.arc(cx, cy, T * 0.4, 0, 7); g.fill();                  // 깊은 구멍
        const ig = g.createLinearGradient(cx - T * 0.4, cy - T * 0.4, cx + T * 0.3, cy + T * 0.3);   // 왼쪽 위 안쪽 벽의 그림자
        ig.addColorStop(0, "rgba(0,0,0,.85)"); ig.addColorStop(0.55, "rgba(0,0,0,.25)"); ig.addColorStop(1, "rgba(60,35,15,.0)");
        g.fillStyle = ig; g.beginPath(); g.arc(cx, cy, T * 0.4, 0, 7); g.fill();
        g.strokeStyle = "rgba(150,100,55,.45)"; g.lineWidth = T * 0.09;                              // 아래쪽 안쪽 벽면에 빛이 닿은 모습
        g.beginPath(); g.arc(cx, cy, T * 0.33, 0.12 * Math.PI, 0.72 * Math.PI); g.stroke();
        g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = Math.max(1.5, T * 0.03);
        g.beginPath(); g.arc(cx, cy, T * 0.405, 1.05 * Math.PI, 1.9 * Math.PI); g.stroke();       // 윗쪽 테두리는 어둡게
        g.strokeStyle = "rgba(255,225,170,.45)"; g.lineWidth = Math.max(1.5, T * 0.035);
        g.beginPath(); g.arc(cx, cy, T * 0.41, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();       // 아래쪽 반짝이는 테두리
      } else if (ch === "S") {
        g.fillStyle = "rgba(59,130,246,.28)"; g.beginPath(); g.arc(cx, cy, T * 0.38, 0, 7); g.fill();
        g.strokeStyle = "rgba(30,64,175,.9)"; g.lineWidth = Math.max(2.5, T * 0.07);
        g.beginPath(); g.arc(cx, cy, T * 0.38, 0, 7); g.stroke();
        g.strokeStyle = "rgba(37,99,235,.45)"; g.lineWidth = Math.max(1, T * 0.025);
        g.beginPath(); g.arc(cx, cy, T * 0.26, 0, 7); g.stroke();
      } else if (ch === "G") {
        g.save(); g.beginPath(); g.arc(cx, cy, T * 0.42, 0, 7); g.clip();                         // 체크무늬 결승 패드
        const q = (T * 0.84) / 4;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          g.fillStyle = (i + j) % 2 ? "#14532d" : "#f0fdf4";
          g.fillRect(cx - T * 0.42 + i * q, cy - T * 0.42 + j * q, q + 1, q + 1);
        }
        g.restore();
        g.strokeStyle = "#16a34a"; g.lineWidth = Math.max(2, T * 0.06); g.beginPath(); g.arc(cx, cy, T * 0.42, 0, 7); g.stroke();
      } else if (ch === "C") {
        g.fillStyle = "rgba(60,35,10,.22)"; g.beginPath(); g.ellipse(cx - T * 0.14, cy + T * 0.3, T * 0.2, T * 0.07, 0, 0, 7); g.fill();   // 깃대 그림자
      }
    }
    return {canvas: c, walls: wc, T};
  }

  // ----- 효과: 구멍에 빠짐, 체크포인트 반짝임, 결승 색종이 -----
  function burst(kind, x, y, color, owner) {
    const n = kind === "confetti" ? 38 : 16, pal = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#f472b6"];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = (kind === "confetti" ? 2.5 : 1.6) * (0.4 + Math.random());
      parts.push({kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === "confetti" ? 2.2 : 0.6), life: 0, max: kind === "confetti" ? 1.6 : 0.8,
        color: kind === "confetti" ? pal[i % pal.length] : color, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, size: 0.04 + Math.random() * 0.05, owner});
    }
  }
  function fxFromState(prev) {                                          // 새 상태가 오면 이전과 비교해서 효과를 만든다
    for (const n in snap) {
      const p = snap[n], q = prev && prev[n];
      if (p.state === "fallen" && (!q || q.state !== "fallen")) fallAt[n] = performance.now();
      if (p.state === "finished" && (!q || q.state !== "finished")) burst("confetti", p.x, p.y, colors[n], n);
    }
  }
  function drawParticles(X, Y, s, owner, dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.kind === "confetti" ? 6 : 0) * dt; p.rot += p.vr * dt;
      if (p.life >= p.max) { parts.splice(i, 1); continue; }
      if (owner !== null && p.owner !== owner) continue;
      const a = 1 - p.life / p.max, px = X(p.x), py = Y(p.y), sz = p.size * s;
      ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.save(); ctx.translate(px, py); ctx.rotate(p.rot);
      if (p.kind === "confetti") ctx.fillRect(-sz, -sz * 0.5, sz * 2, sz);
      else { ctx.beginPath(); for (let k = 0; k < 8; k++) { const rr = k % 2 ? sz * 0.5 : sz * 1.6, ang = k * Math.PI / 4; ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); } ctx.closePath(); ctx.fill(); }
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  // ----- 움직이는 장식: 깃발, 결승 빛 -----
  function drawFlag(x, y, s, on) {                                       // x, y는 칸의 왼쪽 위. 가만히 서 있는 깃발 (회색 -> 밟으면 노란색)
    const px = x + s * 0.34, top = y + s * 0.13, w = s * 0.46, h = s * 0.33;
    ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = Math.max(2, s * 0.05); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(px, y + s * 0.88); ctx.lineTo(px, y + s * 0.1); ctx.stroke(); ctx.lineCap = "butt";
    ctx.fillStyle = "#9ca3af"; ctx.beginPath(); ctx.arc(px, y + s * 0.9, s * 0.06, 0, 7); ctx.fill();
    ctx.fillStyle = "#f9fafb"; ctx.beginPath(); ctx.arc(px, y + s * 0.09, s * 0.04, 0, 7); ctx.fill();
    const g = ctx.createLinearGradient(px, top, px + w, top + h);
    if (on) { g.addColorStop(0, "#fde047"); g.addColorStop(1, "#f59e0b"); } else { g.addColorStop(0, "#8d96a6"); g.addColorStop(1, "#444c5a"); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px + w, top + h * 0.12); ctx.lineTo(px + w * 0.9, top + h * 0.5); ctx.lineTo(px + w, top + h * 0.88); ctx.lineTo(px, top + h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = on ? "rgba(120,60,0,.55)" : "rgba(20,24,32,.7)"; ctx.lineWidth = Math.max(1.2, s * 0.018); ctx.stroke();
  }

  // 받은 위치에 속도를 곱해 잠깐 앞서 그린다 -> 네트워크가 들쭉날쭉해도 뚝뚝 끊기지 않는다
  function ballPos(n) {
    const p = snap[n], dt = Math.min(0.08, (performance.now() - recvAt) / 1000);
    const tx = p.x + (p.state === "rolling" ? p.vx * dt : 0), ty = p.y + (p.state === "rolling" ? p.vy * dt : 0);
    const cur = shown[n] || (shown[n] = {x: tx, y: ty});
    const jump = Math.hypot(tx - cur.x, ty - cur.y) > 2;               // 구멍에서 되돌아갈 때는 바로 옮긴다
    cur.x = jump ? tx : cur.x + (tx - cur.x) * 0.6; cur.y = jump ? ty : cur.y + (ty - cur.y) * 0.6;
    return cur;
  }

  // ----- 구슬: 그림자, 꼬리, 광택 -----
  function drawBall(n, x, y, s, mine) {
    const p = snap[n], base = colors[n] || "#ef4444", r = 0.3 * s;
    let k = 1, a = 1;
    let dark = 0;
    if (p.state === "fallen") { const e = (performance.now() - (fallAt[n] || 0)) / 1000; k = Math.pow(Math.max(0, 1 - e / 0.5), 1.4); a = Math.max(0, 1 - e / 0.65); dark = Math.min(0.8, e * 2.2); }   // 구멍으로 빨려 들어간다 (작아지면서 어두워진다)
    if (k <= 0.02) return;
    const al = (mine || isHost ? 1 : 0.6) * a, tr = SHOW_TRAIL ? (trail[n] || []) : [];
    ctx.fillStyle = base;
    for (let i = 0; i < tr.length; i++) {                                // 지나온 자리의 흐릿한 꼬리 (최대 6개의 작은 원)
      const f = (i + 1) / tr.length;
      ctx.globalAlpha = 0.16 * f * al; ctx.beginPath(); ctx.arc(x + (tr[i].x - tr[tr.length - 1].x) * s, y + (tr[i].y - tr[tr.length - 1].y) * s, r * (0.45 + 0.4 * f) * k, 0, 7); ctx.fill();
    }
    const sh = ctx.createRadialGradient(x + r * 0.2, y + r * 0.55, r * 0.1, x + r * 0.2, y + r * 0.55, r * 1.25 * k);   // 부드러운 바닥 그림자
    sh.addColorStop(0, "rgba(20,8,0,.62)"); sh.addColorStop(0.55, "rgba(20,8,0,.3)"); sh.addColorStop(1, "rgba(20,8,0,0)");
    ctx.globalAlpha = al * 0.6; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(x + r * 0.12, y + r * 0.78 * k, r * 0.7 * k, r * 0.22 * k, 0, 0, 7); ctx.fill();   // 닿는 자리의 진한 그림자
    ctx.globalAlpha = al; ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(x + r * 0.2, y + r * 0.55, r * 1.25 * k, r * 0.8 * k, 0, 0, 7); ctx.fill();
    const gr = ctx.createRadialGradient(x - r * 0.35 * k, y - r * 0.42 * k, r * 0.08 * k, x, y, r * k * 1.05);
    gr.addColorStop(0, mix(base, 0.8)); gr.addColorStop(0.35, base); gr.addColorStop(1, mix(base, -0.55));
    ctx.globalAlpha = al; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * k, 0, 7); ctx.fill();
    const ang = ((spin[n] && spin[n].a) || 0);                           // 구르는 방향으로 도는 밝은 점 (굴러가는 느낌)
    ctx.fillStyle = "rgba(255,255,255,.28)";
    for (let i = 0; i < 2; i++) { const aa = ang + i * Math.PI; ctx.beginPath(); ctx.arc(x + Math.cos(aa) * r * 0.55 * k, y + Math.sin(aa) * r * 0.55 * k, r * 0.13 * k, 0, 7); ctx.fill(); }
    const rl = ctx.createRadialGradient(x + r * 0.15 * k, y + r * 0.62 * k, 0, x + r * 0.15 * k, y + r * 0.62 * k, r * 0.75 * k);   // 바닥(나무)에서 올라온 반사광
    rl.addColorStop(0, "rgba(255,210,150,.5)"); rl.addColorStop(1, "rgba(255,210,150,0)");
    ctx.fillStyle = rl; ctx.beginPath(); ctx.arc(x, y, r * k, 0, 7); ctx.fill();
    ctx.strokeStyle = mix(base, -0.62); ctx.lineWidth = Math.max(1.2, r * 0.07); ctx.beginPath(); ctx.arc(x, y, r * k, 0, 7); ctx.stroke();   // 얇은 어두운 테두리
    if (dark > 0) { ctx.globalAlpha = al * dark; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x, y, r * k, 0, 7); ctx.fill(); }          // 구멍 속으로 들어갈수록 어두워짐
    ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.beginPath(); ctx.ellipse(x - r * 0.34 * k, y - r * 0.4 * k, r * 0.2 * k, r * 0.12 * k, -0.7, 0, 7); ctx.fill();   // 반짝이는 하이라이트
    ctx.globalAlpha = 1;
  }
  function drawLabel(n, x, y, s, mine) {                                  // 이름표는 벽 위에 그려서 항상 읽히게 한다
    if (!(isHost || !mine) || snap[n].state === "fallen") return;
    const fs = Math.max(15, s * 0.34), r = 0.3 * s;
    ctx.font = "bold " + fs + "px sans-serif"; ctx.textAlign = "center";
    const w = ctx.measureText(n).width + fs * 0.9, h = fs * 1.35, by = y - r * 1.6 - fs * 1.05;
    let bx = x - w / 2; bx = Math.max(4, Math.min(cv.width - w - 4, bx));                          // 화면 가장자리에서도 잘리지 않게
    const tx = bx + w / 2;
    ctx.fillStyle = "rgba(15,8,2,.68)"; roundRect(ctx, bx, by, w, h, h / 2); ctx.fill();               // 반투명 알약 배경
    ctx.strokeStyle = colors[n] || "#fff"; ctx.lineWidth = Math.max(1.5, fs * 0.09); roundRect(ctx, bx, by, w, h, h / 2); ctx.stroke();   // 선수 색 테두리
    ctx.fillStyle = "#fff"; ctx.fillText(n, tx, by + h * 0.72);
  }

  // 노트북은 배경, 보드 틀, 바닥, 벽을 한 번만 그려서 저장해 두고 매 프레임 붙이기만 한다 (매번 다시 그리면 노트북이 끊긴다)
  let hostCache = null, sideCanvas = null, sideAt = 0;
  const offscreen = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  function buildHostCache(mw, mh) {
    const key = cv.width + "x" + cv.height + "|" + texKey;
    if (hostCache && hostCache.key === key) return hostCache;
    const s = Math.min(cv.width * 0.96 / mw, cv.height * 0.84 / mh);
    const ox = (cv.width - s * mw) / 2, oy = cv.height * 0.12 + (cv.height * 0.84 - s * mh) / 2;
    const fc = offscreen(cv.width, cv.height), wc = offscreen(cv.width, cv.height), saved = ctx;
    try {
      ctx = fc.getContext("2d");
      const bg = ctx.createRadialGradient(cv.width / 2, cv.height * 0.4, cv.height * 0.2, cv.width / 2, cv.height / 2, cv.height * 0.95);   // 배경 + 가장자리 어둡게(비네팅)
      bg.addColorStop(0, "#33231a"); bg.addColorStop(1, "#0d0804"); ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,.65)"; ctx.shadowBlur = s * 0.45; ctx.shadowOffsetY = s * 0.12;                              // 나무판 틀
      const fx = ox - s * 0.22, fy = oy - s * (0.22 + WALL_H), fw = s * mw + s * 0.44, fh = s * mh + s * 0.44 + s * WALL_H;
      const fg = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh); fg.addColorStop(0, "#7a4b27"); fg.addColorStop(1, "#4a2c15");
      ctx.fillStyle = fg; roundRect(ctx, fx, fy, fw, fh, s * 0.26); ctx.fill(); ctx.restore();
      ctx.strokeStyle = "rgba(255,225,180,.35)"; ctx.lineWidth = Math.max(1.5, s * 0.03); roundRect(ctx, fx + 1, fy + 1, fw - 2, fh - 2, s * 0.26); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,.45)"; roundRect(ctx, ox - s * 0.06, oy - s * (0.06 + WALL_H), s * mw + s * 0.12, s * mh + s * 0.12 + s * WALL_H, s * 0.1); ctx.fill();
      ctx.drawImage(tex.canvas, ox, oy, s * mw, s * mh);                                                                                    // 바닥층
      ctx = wc.getContext("2d"); ctx.drawImage(tex.walls, ox, oy, s * mw, s * mh);                                                          // 벽층 (구슬 위에 덮을 것)
    } finally { ctx = saved; }
    return (hostCache = {key, fc, wc, s, ox, oy});
  }
  function draw() {
    if (!running) return;
    requestAnimationFrame(draw);
    const nowMs = performance.now(), dt = Math.min(0.05, lastFrame ? (nowMs - lastFrame) / 1000 : 0.016);
    lastFrame = nowMs;
    if (!isHost) {
      const bg = ctx.createLinearGradient(0, 0, 0, cv.height); bg.addColorStop(0, "#2b1c10"); bg.addColorStop(1, "#120b06");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, cv.width, cv.height);
    }
    if (!maze) return;
    const rows = maze.rows, mh = rows.length, mw = rows[0].length, key = rows.join("|");
    if (!tex || texKey !== key) { tex = buildTexture(rows); texKey = key; hostCache = null; }
    let s, ox, oy, hc = null;
    const pos = {};
    if (snap) for (const n in snap) pos[n] = ballPos(n);
    const reachedAny = new Set(), myReached = new Set();
    if (snap) for (const n in snap) (snap[n].reached || []).forEach((q) => { reachedAny.add(q[0] + "," + q[1]); if (n === getName()) myReached.add(q[0] + "," + q[1]); });
    if (isHost) {                                                       // 노트북: 미로 전체를 화면에 맞춰 보여 준다
      hc = buildHostCache(mw, mh); s = hc.s; ox = hc.ox; oy = hc.oy;
      ctx.drawImage(hc.fc, 0, 0);                                       // 배경 + 틀 + 바닥을 한 번에
    } else {                                                            // 폰: 내 공 주변만 크게
      s = cv.width / VIEW_CELLS;
      let mx, my;
      if (pos[getName()]) { mx = pos[getName()].x; my = pos[getName()].y; }
      else { const sr = rows.findIndex((r) => r.includes("S")); mx = rows[sr].indexOf("S") + 0.5; my = sr + 0.5; }
      ox = cv.width / 2 - mx * s; oy = cv.height * 0.45 - my * s;
    }
    const X = (c) => ox + c * s, Y = (r) => oy + r * s;
    // 폰은 보이는 부분만 큰 그림에서 잘라서 그린다
    const c0 = Math.max(0, Math.floor(-ox / s)), c1 = Math.min(mw, Math.ceil((cv.width - ox) / s));
    const r0 = Math.max(0, Math.floor(-oy / s) - 1), r1 = Math.min(mh, Math.ceil((cv.height - oy) / s) + 1);
    const layer = (img) => { if (c1 > c0 && r1 > r0) ctx.drawImage(img, c0 * tex.T, r0 * tex.T, (c1 - c0) * tex.T, (r1 - r0) * tex.T, X(c0), Y(r0), (c1 - c0) * s, (r1 - r0) * s); };
    if (!isHost) layer(tex.canvas);
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
      if (rows[r][c] === "C") drawFlag(X(c), Y(r), s, isHost ? reachedAny.has(c + "," + r) : myReached.has(c + "," + r));
    }
    if (snap) {
      const me = getName();
      for (const n in pos) {                                            // 굴러가는 각도 갱신
        const q = prevPos[n];
        if (q) { const d = Math.hypot(pos[n].x - q.x, pos[n].y - q.y); if (d > 0.0005) spin[n] = {a: ((spin[n] && spin[n].a) || 0) + d / 0.3}; }
        if (SHOW_TRAIL) {
          const tr = trail[n] || (trail[n] = []);
          if (!q || Math.hypot(pos[n].x - q.x, pos[n].y - q.y) > 0.01) { tr.push({x: pos[n].x, y: pos[n].y}); if (tr.length > 6) tr.shift(); }
          if (snap[n].state !== "rolling") tr.length = 0;
        }
        prevPos[n] = {x: pos[n].x, y: pos[n].y};
      }
      Object.keys(pos).filter((n) => n !== me).forEach((n) => drawBall(n, X(pos[n].x), Y(pos[n].y), s, false));
      if (pos[me]) drawBall(me, X(pos[me].x), Y(pos[me].y), s, true);
    }
    if (isHost) ctx.drawImage(hc.wc, 0, 0); else layer(tex.walls);       // 벽을 구슬 위에 덮는다 (벽 바로 뒤의 구슬은 살짝 가려진다)
    if (snap) {
      const me = getName();
      Object.keys(pos).forEach((n) => drawLabel(n, X(pos[n].x), Y(pos[n].y), s, n === me));
    }
    drawParticles(X, Y, s, isHost ? null : getName(), dt);
    if (isHost) {                                                       // 양옆 카드는 초당 5번만 새로 그린다
      if (!sideCanvas || sideCanvas.width !== cv.width || sideCanvas.height !== cv.height) { sideCanvas = offscreen(cv.width, cv.height); sideAt = 0; }
      if (sideAt === 0 || nowMs - sideAt > 200) {                  // 처음에는 반드시 한 번 그린다
        const saved = ctx; ctx = sideCanvas.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height);
        try { drawHostSide(s, ox, oy, mw, mh); } finally { ctx = saved; }
        sideAt = nowMs || 1;
      }
      ctx.drawImage(sideCanvas, 0, 0);
    }
  }

  // ----- 노트북 양옆: 왼쪽 안내, 오른쪽 실시간 순위 -----
  function drawHostSide(s, ox, oy, mw, mh) {
    const u = cv.height / 720, gap = s * 0.55, margin = cv.width * 0.025, mazeW = s * mw;
    const leftW = ox - gap - margin, rightX = ox + mazeW + gap, rightW = cv.width - rightX - margin;
    const panel = (x, y, w, h) => {
      ctx.fillStyle = "rgba(24,14,7,.62)"; roundRect(ctx, x, y, w, h, 16 * u); ctx.fill();
      ctx.strokeStyle = "rgba(255,225,180,.2)"; ctx.lineWidth = 1.5; roundRect(ctx, x, y, w, h, 16 * u); ctx.stroke();
    };
    const text = (str, x, y, size, color, weight, align) => { ctx.font = (weight || "bold") + " " + Math.round(size * u) + "px sans-serif"; ctx.textAlign = align || "left"; ctx.fillStyle = color; ctx.fillText(str, x, y); };
    const wrap = (str, x, y, maxW, size, lineH, maxLines) => {            // 카드 폭에 맞춰 글자를 줄바꿈한다 (넘치면 잘라서 ... 표시)
      ctx.font = "normal " + Math.round(size * u) + "px sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,233,196,.9)";
      let line = "", n = 0;
      for (const ch of str) {
        if (ctx.measureText(line + ch).width > maxW && line) { if (++n >= maxLines) { line = line.slice(0, -1) + "…"; break; } ctx.fillText(line, x, y + (n - 1) * lineH * u); line = ch.trim() ? ch : ""; } else line += ch;
      }
      ctx.fillText(line, x, y + n * lineH * u);
    };
    const flagsTotal = maze.rows.reduce((a, r) => a + (r.match(/C/g) || []).length, 0);
    const top = oy - s * WALL_H;
    if (rightW >= 190 * u && snap) {                                   // 실시간 순위: 도착한 순서, 그다음 많이 간 순서
      const order = Object.keys(snap).sort((a, b) => {
        const pa = snap[a], pb = snap[b], fa = typeof pa.finish_time === "number", fb = typeof pb.finish_time === "number";
        return fa && fb ? pa.finish_time - pb.finish_time : fa ? -1 : fb ? 1 : pb.progress - pa.progress;
      });
      text("실시간 순위", rightX + 6 * u, top + 24 * u, 22, "#f5deb3");
      const cw = Math.min(rightW, 420 * u), ch = 76 * u;
      order.forEach((n, i) => {
        const p = snap[n], y = top + 40 * u + i * (ch + 12 * u);
        panel(rightX, y, cw, ch);
        const bx = rightX + 30 * u, by = y + ch / 2, br = 15 * u, base = colors[n] || "#ef4444";
        text(String(i + 1), rightX + 12 * u, by + 8 * u, 22, "#ffe9c4", "bold");
        const g = ctx.createRadialGradient(bx + 8 * u - 4 * u, by - 5 * u, 2 * u, bx + 8 * u, by, br);           // 선수 구슬 아이콘
        g.addColorStop(0, mix(base, 0.8)); g.addColorStop(0.4, base); g.addColorStop(1, mix(base, -0.55));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx + 8 * u, by, br, 0, 7); ctx.fill();
        text(n, bx + 34 * u, y + 28 * u, 21, "#fff");
        const done = typeof p.finish_time === "number", right = rightX + cw - 14 * u;
        text(done ? "도착 " + p.finish_time + "초" : p.state === "fallen" ? "구멍! " + Math.round(p.progress * 100) + "%" : Math.round(p.progress * 100) + "%", right, y + 28 * u, 19, done ? "#86efac" : p.state === "fallen" ? "#fca5a5" : "#ffe9c4", "bold", "right");
        const barX = bx + 34 * u, barW = cw - (barX - rightX) - 14 * u, barY = y + 42 * u;
        ctx.fillStyle = "rgba(255,255,255,.14)"; roundRect(ctx, barX, barY, barW, 10 * u, 5 * u); ctx.fill();
        const bg = ctx.createLinearGradient(barX, 0, barX + barW, 0); bg.addColorStop(0, mix(base, 0.25)); bg.addColorStop(1, base);
        ctx.fillStyle = bg; roundRect(ctx, barX, barY, Math.max(10 * u, barW * Math.max(0, Math.min(1, p.progress))), 10 * u, 5 * u); ctx.fill();
        text("깃발 " + (p.reached || []).length + "/" + flagsTotal + "  ·  구멍 " + p.falls + "번", barX, y + 68 * u, 15, "rgba(255,240,215,.95)", "normal");
      });
    }
    if (leftW >= 190 * u) {                                            // 이렇게 해요: 그림 기호 설명
      const lx = Math.max(margin, ox - gap - Math.min(leftW, 360 * u)), lw = Math.min(leftW, 360 * u);
      text("이렇게 해요", lx + 6 * u, top + 24 * u, 22, "#f5deb3");
      const items = [["구멍", "빠지면 가까운 깃발에서 다시 시작해요"], ["깃발", "밟으면 노란색! 체크포인트가 저장돼요"], ["GOAL", "가장 먼저 도착하면 우승이에요"]];
      items.forEach((it, i) => {
        const y = top + 40 * u + i * 104 * u; panel(lx, y, lw, 92 * u);
        ctx.save(); ctx.beginPath(); ctx.rect(lx, y, lw, 92 * u); ctx.clip();                    // 카드 밖으로 글자가 나가지 않게
        const ix = lx + 40 * u, iy = y + 46 * u;
        if (i === 0) { const hg = ctx.createRadialGradient(ix - 3 * u, iy - 3 * u, 2 * u, ix, iy, 24 * u); hg.addColorStop(0, "#000"); hg.addColorStop(0.7, "#120a04"); hg.addColorStop(1, "#6a421f"); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ix, iy, 24 * u, 0, 7); ctx.fill(); }
        else if (i === 1) drawFlag(ix - 26 * u, iy - 34 * u, 68 * u, true);
        else { ctx.save(); ctx.beginPath(); ctx.arc(ix, iy, 24 * u, 0, 7); ctx.clip(); for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { ctx.fillStyle = (a + b) % 2 ? "#14532d" : "#f0fdf4"; ctx.fillRect(ix - 24 * u + a * 12 * u, iy - 24 * u + b * 12 * u, 12 * u + 1, 12 * u + 1); } ctx.restore(); ctx.strokeStyle = "#16a34a"; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(ix, iy, 24 * u, 0, 7); ctx.stroke(); }
        text(it[0], lx + 78 * u, y + 32 * u, 20, "#fff");
        wrap(it[1], lx + 78 * u, y + 54 * u, lw - 78 * u - 10 * u, 13, 16, 3);
        ctx.restore();
      });
    }
  }
}
