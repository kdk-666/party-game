function setupRedLightHostUI(ws, role, getName) {
  setupRedLightResult(ws, role, getName);
  setupRedLightHost(ws);
}


function setupRedLightHost(ws) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const bg = document.getElementById("bg");
  const status = document.getElementById("status");
    const view = document.createElement("section");
  view.hidden = true;
  view.innerHTML = '<h2>참가자 (술래까지 거리)</h2>' +
    '<div class="red-light-list" style="width:70%;margin:auto;font-size:22px;text-align:left"></div>' +
    '<h2>게임 순위</h2>' +
    '<div class="red-light-ranking" style="font-size:22px;white-space:pre-line"></div>';
  document.getElementById("game-content").appendChild(view);
  const rankingEl = view.querySelector(".red-light-ranking");
  const list = view.querySelector(".red-light-list");
  let names = [], alive = null, dist = {};
  const START = 10;

  function draw() {
    list.innerHTML = names.map(n => {
      const dead = alive && !alive.includes(n);
      const d = dist[n] !== undefined ? dist[n] : START;
      const pct = Math.max(0, Math.min(100, (START - d) / START * 100));
      return "<div style='margin:8px 0;" + (dead ? "color:#999" : "") + "'>" + esc(n) +
        " — " + d.toFixed(1) + "m" + (dead ? " (정지)" : "") +
        "<div style='background:#ddd;height:18px;border-radius:9px'>" +
        "<div style='background:" + (dead ? "#999" : "#3b82f6") + ";height:18px;border-radius:9px;width:" + pct + "%'></div></div></div>";
    }).join("");
  }

  ws.addEventListener("message", e => {
    const msg = JSON.parse(e.data), d = msg.data;
    if (msg.type === "lobby") { names = d.players; draw(); }
    else if (msg.type === "round_start") {
      view.hidden = d.game_id !== "red_light";
      if (!view.hidden && Array.isArray(d.players)) {
        names = d.players;
        draw();
      }
    }
    else if (msg.type === "countdown") {
      rankingEl.textContent = "";
      alive = null; dist = {}; bg.style.background = "#fff"; status.textContent = "준비하세요! 3초 후 시작"; draw();
    } else if (msg.type === "state") {
      alive = d.alive; draw();
      bg.style.background = d.state === "green" ? "#7bd88f" : "#ff6b6b";
      status.textContent = d.state === "green" ? "🟢 초록불: 흔들어서 앞으로!" : "🔴 빨간불: 멈춰!";
    } else if (msg.type === "dist") { dist = d.dist; alive = d.alive; draw(); }
    else if (msg.type === "eFliminated") { alive = d.alive; draw(); }
    else if (msg.type === "game_cancelled") {
      bg.style.background = "#fff";
      status.textContent = "참가자가 모두 나가 게임이 취소됐습니다.";
    } else if (msg.type === "game_over") {
      dist = d.dist;
      draw();
      bg.style.background = "#fff";
      status.textContent = "🏆 우승: " + d.winner + (d.arrived.length ? " (도착!)" : " (가장 가까이 감)");
      rankingEl.textContent = (d.ranking || []).map((name, index) => (index + 1) + "등: " + name).join("\n");
    }
  });
}
