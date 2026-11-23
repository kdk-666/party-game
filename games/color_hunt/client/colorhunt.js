function setupColorHuntUI(ws, role, getName) {
  setupColorHunt(ws, role, getName);
}
// 컬러헌트 화면. 호스트(노트북)와 플레이어(폰)가 같은 파일을 쓴다.
// 사용법: setupColorHunt(ws, "host" 또는 "player", () => 내 닉네임)
function setupColorHunt(ws, role, getName) {
  // 밝은 모드 고정 (CSS와 이중으로 선언해서 브라우저별 강제 다크모드를 막는다)
  if (!document.querySelector('meta[name="color-scheme"]')) {
    const meta = document.createElement("meta");
    meta.name = "color-scheme"; meta.content = "light";
    document.head.appendChild(meta);
  }
  document.documentElement.style.colorScheme = "light";
  let root = document.getElementById("ch-screen");
  if (!root) {
    root = document.createElement("div");
    root.id = "ch-screen";
    root.className = "ch-screen";
    root.hidden = true;
    document.body.appendChild(root);
  }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rgbCss = (c) => c ? "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")" : "#eee";
  let timerId = null, deadline = 0, submitted = false, photoData = null, round = null;

  // 색은 CSS 배경이 아니라 <canvas>(그림)로 그린다. 브라우저의 강제 다크모드는 그림의 색은 바꾸지 않는다.
  function paintColors() {
    root.querySelectorAll("canvas[data-color]").forEach(cv => {
      cv.width = 4; cv.height = 4;
      const g = cv.getContext("2d");
      g.fillStyle = cv.dataset.color; g.fillRect(0, 0, 4, 4);
    });
    root.querySelectorAll("canvas[data-ring]").forEach(cv => {
      cv.width = 200; cv.height = 200;
      const g = cv.getContext("2d");
      g.clearRect(0, 0, 200, 200);
      g.strokeStyle = cv.dataset.ring; g.lineWidth = 10;
      g.beginPath(); g.arc(100, 100, 94, 0, Math.PI * 2); g.stroke();
    });
  }

  function hide() { stopCamera(); clearInterval(timerId); root.hidden = true; root.innerHTML = ""; }
  function startTimer(seconds) {
    deadline = Date.now() + seconds * 1000;
    clearInterval(timerId);
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      const el = document.getElementById("ch-time");
      if (el) el.textContent = remaining;
      if (remaining === 0) {
        stopCamera();
        clearInterval(timerId);
        timerId = null;
      }
    };
    tick();
    if (Date.now() < deadline) timerId = setInterval(tick, 250);
  }

  // ---- 카메라: 페이지 안에서 바로 촬영 (앱 전환 없음 -> 연결이 안 끊긴다) ----
  let stream = null, useFile = false, cameraGeneration = 0;

  function stopCamera() {
    cameraGeneration += 1; // 대기 중인 카메라 요청도 무효화한다.
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }
  function fileButton(label) {
    return '<label class="ch-btn" style="display:inline-block">' + label +
      '<input id="ch-file" type="file" accept="image/*" capture="environment" hidden></label>';
  }
  function bindFile() {
    const f = document.getElementById("ch-file");
    if (f) f.onchange = onPick;
  }
  function setMsg(text) {
    const m = document.getElementById("ch-msg");
    if (m) m.textContent = text;
  }
  // 촬영 시작: 기본은 앱 안 카메라, 안 되면 사진 앱 방식으로 바꾼다
  async function startCapture() {
    const area = document.getElementById("ch-area");
    if (!area || submitted || ws.readyState !== WebSocket.OPEN || Date.now() >= deadline) return;
    stopCamera();
    const requestGeneration = cameraGeneration;
    const isCurrent = () => requestGeneration === cameraGeneration && !root.hidden &&
      !submitted && ws.readyState === WebSocket.OPEN && Date.now() < deadline &&
      document.getElementById("ch-area") === area;
    if (useFile || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      useFile = true;
      area.innerHTML = fileButton("📷 사진 찍기"); bindFile();
      return;
    }
    let requestedStream;
    try {
      requestedStream = await navigator.mediaDevices.getUserMedia(
        {video: {facingMode: {ideal: "environment"}}, audio: false});
    } catch (err) {
      if (!isCurrent()) return;
      useFile = true;
      setMsg("카메라를 직접 켤 수 없어요 (" + err.name + "). 사진 앱으로 찍어 주세요");
      area.innerHTML = fileButton("📷 사진 찍기"); bindFile();
      return;
    }
    if (!isCurrent()) {
      requestedStream.getTracks().forEach(track => track.stop());
      return;
    }
    stream = requestedStream;
    area.innerHTML = '<div class="ch-cam"><video id="ch-video" playsinline autoplay muted></video>' +
      '<canvas class="ch-aim" data-ring="' + round.hex + '"></canvas></div><br><button id="ch-shot" class="ch-btn">📸 촬영</button>';
    const video = document.getElementById("ch-video");
    video.srcObject = stream;
    setMsg("동그라미 안에 물건을 가득 담고 촬영하세요");
    paintColors();
    document.getElementById("ch-shot").onclick = () => {
      if (!video.videoWidth) return;
      photoData = canvasToJpeg(video, video.videoWidth, video.videoHeight);
      stopCamera();
      showPreview();
    };
  }

  function canvasToJpeg(source, w, h) {
    const k = Math.min(1, 240 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  }

  function showPreview() {
    const msg = document.getElementById("ch-msg");
    document.getElementById("ch-area").innerHTML =
      '<img class="ch-preview" src="' + photoData + '"><br>' +
      '<button id="ch-send" class="ch-btn">보내기</button>' +
      '<button id="ch-retake" class="ch-btn sub">다시 찍기</button>';
    document.getElementById("ch-retake").onclick = () => { photoData = null; startCapture(); };
    document.getElementById("ch-send").onclick = () => {
      if (submitted || ws.readyState !== WebSocket.OPEN) return;
      submitted = true;
      ws.send(JSON.stringify({type: "photo", data: {image: photoData}}));
      document.getElementById("ch-area").innerHTML = '<p class="ch-big">제출 완료 ✓</p>';
      msg.textContent = "다른 사람을 기다리고 있어요";
    };
    msg.textContent = "이 사진으로 보낼까요?";
  }

  // 사진을 작게 줄여서(긴 변 240px) JPEG 문자열로 바꾼다
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const out = canvasToJpeg(img, img.width, img.height);
        URL.revokeObjectURL(img.src);
        resolve(out);
      };
      img.onerror = () => reject(new Error("이미지를 열 수 없어요"));
      img.src = URL.createObjectURL(file);
    });
  }

  function showRound(d) {
    stopCamera();
    round = d; submitted = false; photoData = null;
    root.hidden = false;
    const head = '<p class="ch-note">컬러헌트 ' + d.index + ' / ' + d.total + ' · 남은 시간 <b id="ch-time"></b>초</p>' +
      '<p class="ch-big">' + esc(d.color_name) + ' 색을 찾아라!</p>' +
      '<canvas class="ch-swatch" data-color="' + d.hex + '"></canvas>';
    if (role === "host") {
      root.innerHTML = head + '<p class="ch-note">폰으로 이 색과 비슷한 물건을 찍어요</p><div id="ch-who"></div>';
    } else {
      root.innerHTML = head +
        '<div id="ch-area"><button id="ch-cam-btn" class="ch-btn">📷 카메라 켜기</button></div>' +
        '<p id="ch-msg" class="ch-note">물건을 화면 가운데에 크게 담아 주세요</p>';
      document.getElementById("ch-cam-btn").onclick = startCapture;
    }
    paintColors();
    startTimer(d.seconds);
  }

  async function onPick(e) {
    const file = e.target.files[0];
    if (!file || submitted) return;
    try { photoData = await shrink(file); } catch (err) { setMsg(err.message); return; }
    showPreview();
  }

  function showResult(d) {
    stopCamera();
    clearInterval(timerId);
    const rows = Object.keys(d.results).sort((a, b) => d.results[b].score - d.results[a].score).map(n => {
      const r = d.results[n];
      return '<div class="ch-row"><canvas class="ch-chip" data-color="' + rgbCss(r.rgb) + '"></canvas>' +
        '<span>' + esc(n) + '</span><b>' + (r.rgb ? r.score + "점" : "미제출 0점") + '</b>' +
        '<span class="ch-note">(합계 ' + d.totals[n] + ')</span></div>';
    }).join("");
    root.hidden = false;
    root.innerHTML = '<p class="ch-note">' + esc(d.color_name) + ' 결과</p>' +
      '<canvas class="ch-swatch" style="height:90px" data-color="' + d.hex + '"></canvas>' + rows;
    paintColors();
  }

  function showOver(d) {
    stopCamera();
    clearInterval(timerId);
    root.hidden = false;
    const noSubmissions = new Set(d.not_submitted || []);
    const rows = d.ranking.map((n, i) =>
      '<div class="ch-row ch-final-row"><b>' + (noSubmissions.has(n) ? '미제출' : (i + 1) + '등') +
      '</b><span>' + esc(n) + '</span><span>색상 ' + d.totals[n] + '점 · 대회 ' + d.scores[n] + '점</span></div>').join("");
    const closeBtn = '<button id="ch-close" class="ch-btn sub">닫기</button>';
    const me = role === "player" ? getName() : null;
    const winnerText = d.winner === null ? '<p class="ch-note">우승자 없음 (전원 미제출)</p>' :
      (me && d.winner === me ? '<p class="ch-big">우승!</p>' : '');
    root.innerHTML = '<p class="ch-big">🏆 컬러헌트 결과</p>' + winnerText + rows + '<br>' + closeBtn;
    document.getElementById("ch-close").onclick = hide;
  }

  // ---- 연결이 끊기면 폰 화면에 이유를 보여준다 (원인 추적용) ----
  if (role === "player") {
    let hiddenAt = null;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
    });
    ws.addEventListener("close", (e) => {
      stopCamera();
      const bar = document.createElement("div");
      bar.className = "ch-banner";
      const ago = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) + "초 전에 화면이 가려짐" : "화면 가려진 적 없음";
      bar.textContent = "서버 연결이 끊겼어요 (코드 " + e.code + ", " + ago + "). 새로고침해 주세요";
      document.body.appendChild(bar);
    });
  }

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data), d = msg.data || {};
    if (msg.type === "ch_round") showRound(d);
    else if (msg.type === "ch_submitted" && role === "host") {
      const who = document.getElementById("ch-who");
      if (who) who.textContent = "제출: " + d.names.join(", ");
    } else if (msg.type === "ch_photo_error" && role === "player" && d.name === getName()) {
      submitted = false; photoData = null;
      setMsg("사진을 읽지 못했어요. 다시 찍어 주세요");
      startCapture();
    }
    else if (msg.type === "ch_round_result") showResult(d);
    else if (msg.type === "ch_over") showOver(d);
    else if (["round_start", "match_cancelled", "match_error", "game_cancelled"].includes(msg.type)) hide();
  });
}
