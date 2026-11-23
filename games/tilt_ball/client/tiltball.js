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
    '<div class="tb-card" data-k="card" hidden></div>';
  const cv = root.querySelector("canvas"), ctx = cv.getContext("2d");
  const hud = root.querySelector(".tb-hud"), toast = root.querySelector(".tb-toast");
  const banner = root.querySelector(".tb-banner"), countEl = root.querySelector(".tb-count");
  const card = root.querySelector('[data-k="card"]');
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
                    window.removeEventListener("deviceorientation", onOrientation); releaseWake(); }
  function resize() { const r = window.devicePixelRatio || 1; cv.width = Math.round(cv.clientWidth * r); cv.height = Math.round(cv.clientHeight * r); }
  window.addEventListener("resize", resize);
  function say(t, ms) {
    toast.textContent = t; toast.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms || 1600);
  }
  function setBanner(t) { if (t) { banner.textContent = t; banner.hidden = false; } else banner.hidden = true; }
  function send(obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
  const portrait = () => !(screen.orientation && screen.orientation.angle % 180 !== 0);

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
    show(); phase = "intro"; maze = d.maze; names = d.names; timeLimit = d.time_limit;
    names.forEach((n, i) => { colors[n] = COLORS[i % COLORS.length]; });
    snap = null; shown = {}; lastSaves = 0; lastTs = null; lagSamples = []; setBanner(""); hud.hidden = true;
    if (isHost) {
      card.innerHTML = '<h2>기울여서 공 굴리기</h2><p>폰으로 "준비" 버튼을 눌러 주세요</p><p class="tb-small">기울기 기준을 맞추는 중이에요</p>' +
        '<div data-k="ready"></div>';
      renderReady([], names.length);
    } else {
      card.innerHTML = '<h2>기울여서 공 굴리기</h2>' +
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
    if (phase !== "race") { phase = "race"; card.hidden = true; countEl.hidden = true; hud.hidden = false; startSending(); }
    snap = d.players; recvAt = performance.now();
    const left = Math.max(0, Math.ceil(d.left));
    hud.querySelector('[data-k="left"]').textContent = "⏱ " + left + "초";
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
    phase = "over"; clearInterval(tiltTimer); setBanner(""); hud.hidden = true; countEl.hidden = true;
    const me = isHost ? null : getName();
    const rows = d.ranking.map((n, i) => {
      const r = d.results[n];
      const what = typeof r.finish_time === "number" ? "🏁 " + r.finish_time + "초" : Math.round(r.progress * 100) + "% 지점";
      return '<div class="tb-row"><b>' + (i + 1) + '등</b><span class="tb-chip" style="background:' + colors[n] + '"></span>' +
        esc(n) + ' <span class="tb-small">' + what + " · 구멍 " + r.falls + '번</span></div>';
    }).join("");
    card.innerHTML = '<h2>🏆 결과</h2>' + (me && d.winner === me ? '<p><b>우승!</b></p>' : '') + rows +
      '<button class="tb-btn sub" data-k="close">닫기</button>';
    card.querySelector('[data-k="close"]').onclick = hide;
    card.hidden = false;
  }

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data), d = msg.data || {};
    if (msg.type === "tb_intro") showIntro(d);
    else if (msg.type === "tb_ready_update") renderReady(d.ready || [], d.total || names.length);
    else if (msg.type === "tb_count") { phase = "count"; card.hidden = true; countEl.hidden = false; countEl.textContent = d.n; show(); }
    else if (msg.type === "tb_state") onState(d);
    else if (msg.type === "tb_over") showOver(d);
    else if (["round_start", "match_cancelled", "match_error", "game_cancelled"].includes(msg.type)) hide();
  });
  ws.addEventListener("close", () => { if (!root.hidden && !isHost) { setBanner("서버 연결이 끊겼어요. 새로고침해 주세요"); } });

  // ---------- 그리기 ----------
  function drawCell(ch, c, r, X, Y, s, reachedAny) {
    if (ch === "#") { ctx.fillStyle = "#4b5563"; ctx.fillRect(X(c), Y(r), s + 1, s + 1); return; }
    ctx.fillStyle = "#e5e7eb"; ctx.fillRect(X(c), Y(r), s + 1, s + 1);
    const x = X(c), y = Y(r);
    if (ch === "O") { ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, 0.4 * s, 0, 7); ctx.fill(); }
    else if (ch === "G") { ctx.fillStyle = "#34d399"; ctx.fillRect(x, y, s, s); ctx.fillStyle = "#065f46"; ctx.font = (s * 0.32) + "px sans-serif"; ctx.textAlign = "center"; ctx.fillText("GOAL", x + s / 2, y + s * 0.6); }
    else if (ch === "S") { ctx.fillStyle = "#93c5fd"; ctx.fillRect(x, y, s, s); }
    else if (ch === "C") {                                              // 깃발: 회색 -> 노란색
      ctx.strokeStyle = "#4b5563"; ctx.lineWidth = Math.max(2, s * 0.06);
      ctx.beginPath(); ctx.moveTo(x + s * 0.32, y + s * 0.85); ctx.lineTo(x + s * 0.32, y + s * 0.15); ctx.stroke();
      ctx.fillStyle = reachedAny ? "#fbbf24" : "#9ca3af";
      ctx.beginPath(); ctx.moveTo(x + s * 0.32, y + s * 0.15); ctx.lineTo(x + s * 0.8, y + s * 0.32); ctx.lineTo(x + s * 0.32, y + s * 0.5); ctx.closePath(); ctx.fill();
    }
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
  function drawBall(n, x, y, s, mine) {
    const p = snap[n], k = p.state === "fallen" ? 0.5 : 1;
    ctx.globalAlpha = mine || isHost ? 1 : 0.65;
    ctx.fillStyle = colors[n] || "#ef4444"; ctx.beginPath(); ctx.arc(x, y, 0.3 * s * k, 0, 7); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = mine ? 3 : 2; ctx.stroke();
    ctx.globalAlpha = 1;
    if (isHost || !mine) { ctx.fillStyle = "#fff"; ctx.font = Math.max(11, s * 0.28) + "px sans-serif"; ctx.textAlign = "center"; ctx.fillText(n, x, y - 0.42 * s); }
  }
  function draw() {
    if (!running) return;
    requestAnimationFrame(draw);
    ctx.fillStyle = "#1f2937"; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!maze) return;
    const rows = maze.rows, mh = rows.length, mw = rows[0].length;
    let s, ox, oy;
    const reachedAny = new Set();
    if (snap) for (const n in snap) (snap[n].reached || []).forEach((q) => reachedAny.add(q[0] + "," + q[1]));
    const myReached = new Set();
    if (!isHost && snap && snap[getName()]) (snap[getName()].reached || []).forEach((q) => myReached.add(q[0] + "," + q[1]));
    let pos = {};
    if (snap) for (const n in snap) pos[n] = ballPos(n);
    if (isHost) {                                                       // 노트북: 미로 전체를 화면에 맞춰 보여 준다
      s = Math.min(cv.width * 0.96 / mw, cv.height * 0.86 / mh);
      ox = (cv.width - s * mw) / 2; oy = cv.height * 0.1 + (cv.height * 0.86 - s * mh) / 2;
    } else {                                                            // 폰: 내 공 주변만 크게
      s = cv.width / VIEW_CELLS;
      const me = pos[getName()] || {x: maze.rows.findIndex((r) => r.includes("S")) , y: 0};
      let mx = me.x, my = me.y;
      if (!pos[getName()]) { const sr = rows.findIndex((r) => r.includes("S")); mx = rows[sr].indexOf("S") + 0.5; my = sr + 0.5; }
      ox = cv.width / 2 - mx * s; oy = cv.height * 0.45 - my * s;
    }
    const X = (c) => ox + c * s, Y = (r) => oy + r * s;
    for (let r = 0; r < mh; r++) for (let c = 0; c < mw; c++) {
      if (X(c) > cv.width || X(c + 1) < 0 || Y(r) > cv.height || Y(r + 1) < 0) continue;
      const ch = rows[r][c], key = c + "," + r;
      drawCell(ch, c, r, X, Y, s, isHost ? reachedAny.has(key) : myReached.has(key));
    }
    if (snap) {
      const me = getName();
      Object.keys(pos).filter((n) => n !== me).forEach((n) => drawBall(n, X(pos[n].x), Y(pos[n].y), s, false));
      if (pos[me]) drawBall(me, X(pos[me].x), Y(pos[me].y), s, true);
    }
  }
}
