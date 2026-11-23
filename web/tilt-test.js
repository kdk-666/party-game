// 공 굴리기 시험 화면. 폰을 기울이면 서버가 공을 굴리고, 위치를 받아 내 공 주변을 크게 그린다.

// ---- 기울기 계산 (화면과 상관없는 순수 계산이라 따로 뺌) ----
function wrapAngle(d) { while (d > 180) d -= 360; while (d < -180) d += 360; return d; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// beta: 앞뒤 기울기(위쪽이 들리면 +), gamma: 좌우 기울기(오른쪽이 내려가면 +)
// 반환: x(+이면 오른쪽), y(+이면 화면 아래쪽). 기준(b0, g0)에서 얼마나 기울었는지를 -1~1로 바꾼다.
function tiltFromOrientation(beta, gamma, b0, g0, range, dead) {
  dead = dead === undefined ? 2 : dead;
  const f = (d) => Math.abs(d) < dead ? 0 : clamp((d - Math.sign(d) * dead) / (range - dead), -1, 1);
  return {x: f(wrapAngle(gamma - g0)), y: f(wrapAngle(beta - b0))};
}
if (typeof module !== "undefined") module.exports = {tiltFromOrientation, wrapAngle};

(function () {
  if (typeof document === "undefined") return;
  const $ = (id) => document.getElementById(id);
  const cv = $("cv"), ctx = cv.getContext("2d");
  const VIEW_CELLS = 7;                       // 화면 가로에 보이는 칸 수 (작을수록 크게)
  let ws = null, maze = null, started = false, wakeLock = null;
  let beta = null, gamma = null, b0 = 0, g0 = 0, calibrate = true;
  let range = Number(localStorage.getItem("tiltRange")) || 25;
  let state = null, shown = null, keys = {};
  let latency = null, lastSaves = 0, toastTimer = null, recvAt = 0;

  $("sens").value = range; $("sens-v").textContent = range;
  $("sens").oninput = () => { range = Number($("sens").value); $("sens-v").textContent = range; localStorage.setItem("tiltRange", range); };
  // 폰/브라우저에 따라 방향이 반대로 느껴지면 여기서 뒤집는다 (기억해 둠)
  for (const k of ["x", "y"]) {
    const box = $("flip-" + k);
    box.checked = localStorage.getItem("tiltFlip" + k) === "1";
    box.onchange = () => localStorage.setItem("tiltFlip" + k, box.checked ? "1" : "0");
  }
  $("recal").onclick = () => { calibrate = true; };
  $("reset").onclick = () => send({type: "reset", data: {}});

  function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
  function portrait() { return !(screen.orientation && screen.orientation.angle % 180 !== 0); }

  // ---- 시작: 버튼을 누른 그 순간에 권한 요청 (iPhone 때문) ----
  $("start").onclick = async () => {
    $("note").textContent = "";
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        if (await DOE.requestPermission() !== "granted") { $("note").textContent = "센서 권한이 거부됐어요. Safari 설정에서 허용해 주세요."; return; }
      } catch (e) { $("note").textContent = "센서 권한 요청에 실패했어요: " + e.name; return; }
    }
    started = true;
    $("start-box").style.display = "none"; $("play").style.display = "block";
    window.addEventListener("deviceorientation", onOrientation);
    requestWake();
    connect();
    resize(); requestAnimationFrame(draw);
    setInterval(sendTilt, 33);
  };

  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    beta = e.beta; gamma = e.gamma;
    if (calibrate) { b0 = beta; g0 = gamma; calibrate = false; }
  }

  // ---- 화면 꺼짐 방지: 기울이기만 하면 터치가 없어서 화면이 꺼지고 연결이 끊길 수 있다 ----
  async function requestWake() {
    if (!("wakeLock" in navigator)) { $("s-wake").textContent = "미지원 (화면이 꺼질 수 있어요)"; return; }
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      $("s-wake").textContent = "켜짐";
      wakeLock.addEventListener("release", () => { $("s-wake").textContent = "꺼짐"; });
    } catch (e) { $("s-wake").textContent = "실패 (" + e.name + ")"; }
  }
  document.addEventListener("visibilitychange", () => { if (started && document.visibilityState === "visible") requestWake(); });

  // ---- 서버 연결 ----
  function connect() {
    ws = new WebSocket("wss://" + location.host + "/ws/tilt-test");
    ws.onopen = () => { $("s-conn").textContent = "연결됨"; };
    ws.onclose = (e) => {
      $("s-conn").textContent = "끊김 (코드 " + e.code + ")";
      showBanner("서버 연결이 끊겼어요. 새로고침해 주세요", true);
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "maze") maze = m.data;
      else if (m.type === "state") {
        state = m.data; recvAt = performance.now();
        if (state.cp_saves > lastSaves) showToast("🚩 체크포인트 저장!");   // 새 체크포인트가 저장됐을 때
        lastSaves = state.cp_saves;                                         // (다시 시작하면 0으로 돌아간다)
        if (state.ts) { latency = Date.now() - state.ts; $("s-lat").textContent = latency + " ms"; }
        if (state.state === "finished") showBanner("🏁 도착! " + state.finish_time + "초 (빠진 횟수 " + state.falls + ")");
        else if (state.state === "fallen") showBanner("구멍에 빠졌어요!");
        else hideBanner();
      }
    };
  }
  function showToast(t) {
    const el = $("toast"); el.textContent = t; el.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = "none"; }, 1600);
  }
  let bannerLock = false;
  function showBanner(t, lock) { $("banner").textContent = t; $("banner").style.display = "block"; if (lock) bannerLock = true; }
  function hideBanner() { if (!bannerLock) $("banner").style.display = "none"; }

  // ---- 기울기 전송 (초당 30번) ----
  window.addEventListener("keydown", (e) => { keys[e.key] = true; });
  window.addEventListener("keyup", (e) => { keys[e.key] = false; });
  function currentTilt() {
    let t = {x: 0, y: 0};
    if (beta !== null && portrait()) {
      t = tiltFromOrientation(beta, gamma, b0, g0, range);
      if ($("flip-x").checked) t.x = -t.x;
      if ($("flip-y").checked) t.y = -t.y;
    }
    if (keys.ArrowLeft) t.x = -1; if (keys.ArrowRight) t.x = 1;     // 노트북 테스트용
    if (keys.ArrowUp) t.y = -1; if (keys.ArrowDown) t.y = 1;
    return t;
  }
  function sendTilt() {
    const t = currentTilt();
    $("s-tx").textContent = t.x.toFixed(2); $("s-ty").textContent = t.y.toFixed(2);
    $("s-beta").textContent = beta === null ? "-" : beta.toFixed(0);
    $("s-gamma").textContent = gamma === null ? "-" : gamma.toFixed(0);
    $("s-sensor").textContent = beta === null ? "값 없음 (방향키 사용 가능)" : "정상";
    $("warn").textContent = portrait() ? "" : "폰을 세로로 들어 주세요";
    send({type: "tilt", data: {x: t.x, y: t.y, ts: Date.now()}});
  }

  // ---- 그리기: 내 공을 중심으로 크게 ----
  function resize() {
    const r = window.devicePixelRatio || 1;
    cv.width = Math.round(cv.clientWidth * r); cv.height = Math.round(cv.clientHeight * r);
  }
  window.addEventListener("resize", resize);

  // 깃발: 회색(아직) -> 노란색(밟음)
  function drawFlag(x, y, s, on) {
    ctx.strokeStyle = "#4b5563"; ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.beginPath(); ctx.moveTo(x + s * 0.32, y + s * 0.85); ctx.lineTo(x + s * 0.32, y + s * 0.15); ctx.stroke();   // 깃대
    ctx.fillStyle = on ? "#fbbf24" : "#9ca3af";
    ctx.beginPath(); ctx.moveTo(x + s * 0.32, y + s * 0.15); ctx.lineTo(x + s * 0.8, y + s * 0.32);
    ctx.lineTo(x + s * 0.32, y + s * 0.5); ctx.closePath(); ctx.fill();                                              // 깃발
  }

  function draw() {
    requestAnimationFrame(draw);
    ctx.fillStyle = "#1f2937"; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!maze || !state) return;
    if (!shown || (state.t < shown.t)) shown = {x: state.x, y: state.y, t: state.t};   // 처음/다시 시작
    // 받은 위치에 속도를 곱해 잠깐 앞서 그린다 -> 네트워크가 들쭉날쭉해도 뚝뚝 끊기지 않는다
    const dt = Math.min(0.08, (performance.now() - recvAt) / 1000), roll = state.state === "rolling";
    const tx = state.x + (roll ? (state.vx || 0) * dt : 0), ty = state.y + (roll ? (state.vy || 0) * dt : 0);
    const jump = Math.hypot(tx - shown.x, ty - shown.y) > 2;               // 구멍에서 되돌아갈 때는 바로 옮긴다
    shown.x = jump ? tx : shown.x + (tx - shown.x) * 0.6; shown.y = jump ? ty : shown.y + (ty - shown.y) * 0.6; shown.t = state.t;
    const s = cv.width / VIEW_CELLS;                               // 한 칸의 화면 크기(px)
    const ox = cv.width / 2 - shown.x * s, oy = cv.height * 0.42 - shown.y * s;
    const X = (c) => ox + c * s, Y = (r) => oy + r * s;
    const reached = new Set((state.reached || []).map((p) => p[0] + "," + p[1]));
    maze.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (X(c) > cv.width || X(c + 1) < 0 || Y(r) > cv.height || Y(r + 1) < 0) continue;
        if (ch === "#") { ctx.fillStyle = "#374151"; ctx.fillRect(X(c), Y(r), s + 1, s + 1); continue; }
        ctx.fillStyle = "#e5e7eb"; ctx.fillRect(X(c), Y(r), s + 1, s + 1);
        const cx = X(c + 0.5), cy = Y(r + 0.5);
        if (ch === "O") { ctx.fillStyle = "#111827"; ctx.beginPath(); ctx.arc(cx, cy, 0.4 * s, 0, 7); ctx.fill(); }
        else if (ch === "C") { drawFlag(X(c), Y(r), s, reached.has(c + "," + r)); }
        else if (ch === "G") { ctx.fillStyle = "#34d399"; ctx.fillRect(X(c), Y(r), s, s); ctx.fillStyle = "#065f46"; ctx.font = (s * 0.5) + "px sans-serif"; ctx.textAlign = "center"; ctx.fillText("GOAL", cx, cy + s * 0.15); }
        else if (ch === "S") { ctx.fillStyle = "#93c5fd"; ctx.fillRect(X(c), Y(r), s, s); }
      }
    });
    // 공 (구멍에 빠지는 중이면 작아진다)
    const scale = state.state === "fallen" ? 0.5 : 1;
    ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(X(shown.x), Y(shown.y), 0.3 * s * scale, 0, 7); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  }
})();
