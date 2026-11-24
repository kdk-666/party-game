// 공통 WebSocket을 게임별 메시지 처리기로 연결한다.
function setupGameRouter(ws, role, getName, preparationGuide) {
  const handlers = new Map();
  const entries = document.querySelectorAll('script[data-game-ui]');
  let activeGame = null;

  for (const entry of entries) {
    const gameId = entry.dataset.gameUi;
    const setup = window[entry.dataset.gameSetup];
    if (!gameId || handlers.has(gameId) || typeof setup !== 'function') {
      console.error('게임 화면을 불러오지 못했습니다:', gameId);
      return false;
    }
    const listeners = [];
    const gameSocket = {
      get readyState() { return ws.readyState; },
      send(data) { ws.send(data); },
      addEventListener(type, listener) {
        if (type === 'message') listeners.push(listener);
        else ws.addEventListener(type, listener);
      },
    };
    try { setup(gameSocket, role, getName, preparationGuide); }
    catch (error) { console.error('게임 화면 초기화 오류:', gameId, error); return false; }
    handlers.set(gameId, listeners);
  }

  function dispatch(gameId, event) {
    for (const listener of handlers.get(gameId) || []) listener(event);
  }

  ws.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'lobby') {
      // 대기실 참가자 명단은 게임 시작 전에 모든 게임 화면에 알려준다.
      for (const gameId of handlers.keys()) dispatch(gameId, event);
    } else if (msg.type === 'round_start') {
      // 기존 게임이 카메라, 타이머, 화면을 정리할 기회를 준다.
      const nextGame = (msg.data && msg.data.game_id) || null;
      if (activeGame !== null && activeGame !== nextGame) dispatch(activeGame, event);
      activeGame = nextGame;
      dispatch(activeGame, event);
    } else if (msg.type === 'return_lobby') {
      if (activeGame !== null) dispatch(activeGame, event);
      activeGame = null;
    } else if (activeGame !== null) {
      dispatch(activeGame, event);
    }
  });
  return true;
}
