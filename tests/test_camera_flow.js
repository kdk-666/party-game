// Node.js 내장 기능으로 카메라 권한 응답 지연을 재현한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'color_hunt', 'client', 'colorhunt.js'), 'utf8');

function createHarness() {
  let nodes = {};
  const listeners = {};
  const requests = [];
  let now = 100000;
  let intervalCallback = null;
  function makeElement(id) {
    let html = '';
    return {
      id, hidden: false, style: {}, onclick: null, textContent: '', srcObject: null,
      set innerHTML(value) {
        html = value;
        if (id === 'ch-screen') nodes = { 'ch-screen': this };
        if (nodes[id] === this) {
          for (const match of value.matchAll(/id="([^"]+)"/g)) {
            nodes[match[1]] = makeElement(match[1]);
          }
        }
      },
      get innerHTML() { return html; },
      querySelectorAll() { return []; }
    };
  }
  const root = makeElement('ch-screen');
  nodes['ch-screen'] = root;
  const document = {
    querySelector() { return {}; },
    documentElement: { style: {} },
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement() { return makeElement('created'); },
    getElementById(id) { return nodes[id] || null; },
    addEventListener() {},
  };
  const navigator = { mediaDevices: { getUserMedia() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({ resolve, reject });
    return promise;
  } } };
  const ws = {
    readyState: 1,
    send() {},
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
  };
  const context = {
    document, navigator, console, Date: { now: () => now }, Math, JSON, Promise,
    WebSocket: { OPEN: 1 },
    setInterval(fn) { intervalCallback = fn; return 1; },
    clearInterval() { intervalCallback = null; },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'colorhunt.js' });
  context.setupColorHunt(ws, 'player', () => '민지');
  function event(type, data = {}) {
    for (const fn of listeners.message || []) fn({ data: JSON.stringify({ type, data }) });
  }
  function close() {
    ws.readyState = 3;
    for (const fn of listeners.close || []) fn({ code: 1006 });
  }
  function round(index = 1) {
    event('ch_round', { index, total: 3, color_name: '빨강', hex: '#d32f2f', seconds: 25, round_token: 'token-' + index });
  }
  function result() {
    event('ch_round_result', { color_name: '빨강', hex: '#d32f2f', results: {}, totals: {} });
  }
  function cameraClick() {
    assert(nodes['ch-cam-btn'], '카메라 버튼을 찾지 못했습니다');
    return nodes['ch-cam-btn'].onclick();
  }
  function makeStream() {
    const track = { stops: 0, stop() { this.stops++; } };
    return { track, stream: { getTracks() { return [track]; } } };
  }
  return { event, close, round, result, cameraClick, requests, makeStream,
    advance: ms => { now += ms; }, tick: () => { if (intervalCallback) intervalCallback(); },
    node: id => nodes[id] || null };
}

async function main() {
  // 권한 응답이 회차 결과·게임 전환·연결 종료·게임 종료 후에 도착하는 경우
  for (const ending of ['result', 'transition', 'match_cancelled', 'match_error', 'game_cancelled', 'next_round', 'close', 'over']) {
    const h = createHarness();
    h.round();
    const promise = h.cameraClick();
    if (ending === 'result') h.result();
    else if (ending === 'transition') h.event('round_start', { game_id: 'red_light' });
    else if (ending === 'next_round') h.round(2);
    else if (ending === 'close') h.close();
    else if (ending === 'over') h.event('ch_over', { ranking: [], totals: {} });
    else h.event(ending);
    const pending = h.makeStream();
    h.requests[0].resolve(pending.stream);
    await promise;
    assert.strictEqual(pending.track.stops, 1, ending + ': 늦게 받은 카메라가 정지되어야 합니다');
    if (ending === 'close') {
      await h.cameraClick();
      assert.strictEqual(h.requests.length, 1, '연결 종료 후에는 새 카메라를 요청하지 않아야 합니다');
    }
  }

  // 화면이 아직 종료 메시지를 처리하지 못해도 만료된 요청은 정지한다.
  for (const elapsed of [25000, 30000]) {
    const h = createHarness();
    h.round();
    const promise = h.cameraClick();
    h.advance(elapsed);
    const pending = h.makeStream();
    h.requests[0].resolve(pending.stream);
    await promise;
    assert.strictEqual(pending.track.stops, 1, '라운드 시간이 지난 요청의 카메라는 정지되어야 합니다');
  }

  // 서버의 종료 메시지가 늦어도 시간이 끝나면 열린 카메라를 정지한다.
  {
    const h = createHarness();
    h.round();
    const promise = h.cameraClick();
    const current = h.makeStream();
    h.requests[0].resolve(current.stream);
    await promise;
    h.advance(24999);
    h.tick();
    assert.strictEqual(current.track.stops, 0, '시간 안에는 카메라를 유지해야 합니다');
    h.advance(1);
    h.tick();
    assert.strictEqual(current.track.stops, 1, '시간이 끝나면 카메라를 정지해야 합니다');
  }

  // 화면이 늦게 갱신되어도 시간이 끝난 뒤 새 카메라를 요청하지 않는다.
  {
    const h = createHarness();
    h.round();
    h.advance(25000);
    await h.cameraClick();
    assert.strictEqual(h.requests.length, 0, '만료 후에는 카메라를 요청하지 않아야 합니다');
  }

  // 이전 요청이 만료된 뒤 거부되어도 다음 라운드의 카메라 요청은 가능하다.
  {
    const h = createHarness();
    h.round();
    const oldPromise = h.cameraClick();
    h.advance(30000);
    h.requests[0].reject({ name: 'NotAllowedError' });
    await oldPromise;
    h.round(2);
    const newPromise = h.cameraClick();
    assert.strictEqual(h.requests.length, 2);
    const current = h.makeStream();
    h.requests[1].resolve(current.stream);
    await newPromise;
    h.result();
    assert.strictEqual(current.track.stops, 1);
  }

  // 새 요청을 시작한 후 이전 요청이 늦게 응답해도 새 카메라는 유지된다.
  {
    const h = createHarness();
    h.round();
    const oldPromise = h.cameraClick();
    const newPromise = h.cameraClick();
    const oldCamera = h.makeStream(), newCamera = h.makeStream();
    h.requests[1].resolve(newCamera.stream);
    await newPromise;
    assert.strictEqual(h.node('ch-video').srcObject, newCamera.stream);
    h.requests[0].resolve(oldCamera.stream);
    await oldPromise;
    assert.strictEqual(oldCamera.track.stops, 1, '이전 요청의 카메라는 정지되어야 합니다');
    assert.strictEqual(newCamera.track.stops, 0, '현재 카메라는 유지되어야 합니다');
    h.result();
    assert.strictEqual(newCamera.track.stops, 1, '결과 화면에서 현재 카메라를 정지해야 합니다');
  }

  // 카메라가 이미 켜져 있더라도 연결이 끊기면 정지한다.
  {
    const h = createHarness();
    h.round();
    const promise = h.cameraClick();
    const current = h.makeStream();
    h.requests[0].resolve(current.stream);
    await promise;
    h.close();
    assert.strictEqual(current.track.stops, 1, '연결 종료 시 활성 카메라를 정지해야 합니다');
  }

  // 정상적인 거부는 사진 앱 방식으로 전환한다.
  {
    const h = createHarness();
    h.round();
    const promise = h.cameraClick();
    h.requests[0].reject({ name: 'NotAllowedError' });
    await promise;
    assert(h.node('ch-area').innerHTML.includes('ch-file'));
    assert(h.node('ch-msg').textContent.includes('사진 앱'));
  }

  // 이전 회차의 늦은 거부가 다음 회차의 카메라 요청을 막지 않는다.
  {
    const h = createHarness();
    h.round();
    const oldPromise = h.cameraClick();
    h.round(2);
    h.requests[0].reject({ name: 'NotAllowedError' });
    await oldPromise;
    const newPromise = h.cameraClick();
    assert.strictEqual(h.requests.length, 2);
    const current = h.makeStream();
    h.requests[1].resolve(current.stream);
    await newPromise;
    h.result();
    assert.strictEqual(current.track.stops, 1);
  }
  console.log('camera flow OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
