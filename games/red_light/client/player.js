function setupRedLightPlayerUI(ws, role, getName) {
  setupRedLightResult(ws, role, getName);
  setupRedLightPlayer(ws, getName);
}

function setupRedLightPlayer(ws, getName) {
  const bg = document.getElementById("bg");
  const msgEl = document.getElementById("msg");

  ws.addEventListener("message", e => {
    const msg = JSON.parse(e.data), d = msg.data;
      if (msg.type === "state") {

      bg.style.background = d.state === "green" ? "#7bd88f" : "#ff6b6b";
      msgEl.textContent = d.state === "green" ? "움직여!" : "멈춰!";
    } else if (msg.type === "eliminated" && d.name === getName()) {
      bg.style.background = "#555"; msgEl.textContent = "탈락 😢";
    } else if (msg.type === "game_over") {
      bg.style.background = "#fff";
      msgEl.textContent = d.winner === getName() ? "🏆 우승!" : "게임 끝 (우승: " + d.winner + ")";
      const ranking = d.ranking || [];
      document.getElementById("ranking").textContent = ranking
        .map((name, index) => (index + 1) + "등: " + name)
        .join("\n");
    }
  });
}
