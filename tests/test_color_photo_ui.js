// 브라우저를 흉내 내어 늦은 사진과 서버 확인 메시지의 화면 동작을 검사한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'games', 'color_hunt', 'client', 'colorhunt.js'), 'utf8');

function createHarness(fileOnly = false, role = 'player') {
  let nodes = {}, now = 100000, imageCount = 0, shouldThrow = false;
  const listeners = {}, sent = [], images = [], revoked = [], cameraStreams = [];
  function element(id) {
    let html = '';
    return {
      id, hidden: false, style: {}, onclick: null, onchange: null, textContent: '',
      videoWidth: 480, videoHeight: 640, srcObject: null,
      set innerHTML(value) {
        html = value;
        if (id === 'ch-screen') nodes = { 'ch-screen': this };
        if (nodes[id] === this) {
          for (const match of value.matchAll(/id="([^"]+)"/g)) nodes[match[1]] = element(match[1]);
        }
      },
      get innerHTML() { return html; },
      querySelectorAll() { return []; },
    };
  }
  const root = element('ch-screen');
  nodes['ch-screen'] = root;
  const document = {
    querySelector() { return {}; }, documentElement: { style: {} },
    head: { appendChild() {} }, body: { appendChild() {} }, addEventListener() {},
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) {
      if (tag === 'canvas') return {
        width: 0, height: 0, getContext() { return { drawImage() {} }; },
        toDataURL() { return 'data:image/jpeg;base64,YQ=='; },
      };
      return element('created');
    },
  };
  const navigator = { mediaDevices: fileOnly ? null : { getUserMedia() {
    const track = { stops: 0, stop() { this.stops++; } };
    const stream = { getTracks() { return [track]; }, track };
    cameraStreams.push(stream);
    return Promise.resolve(stream);
  } } };
  const ws = {
    readyState: 1,
    send(payload) { if (shouldThrow) throw new Error('연결 실패'); sent.push(JSON.parse(payload)); },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
  };
  function FakeImage() {
    this.width = 480; this.height = 640; this._src = '';
    Object.defineProperty(this, 'src', {
      get: () => this._src,
      set: value => { this._src = value; images.push(this); },
    });
  }
  const URL = {
    createObjectURL() { return 'blob:test-' + (++imageCount); },
    revokeObjectURL(url) { revoked.push(url); },
  };
  const context = {
    document, navigator, console, Math, JSON, Promise, Image: FakeImage, URL,
    Date: { now: () => now }, WebSocket: { OPEN: 1 },
    setInterval() { return 1; }, clearInterval() {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'colorhunt.js' });
  context.setupColorHunt(ws, role, () => '민지');
  function event(type, data = {}) {
    for (const fn of listeners.message || []) fn({ data: JSON.stringify({ type, data }) });
  }
  function round(index) {
    event('ch_round', { index, total: 3, color_name: '빨강', hex: '#d32f2f', seconds: 25, round_token: 'token-' + index });
  }
  function close() { ws.readyState = 3; for (const fn of listeners.close || []) fn({ code: 1006 }); }
  async function takePhoto() {
    await nodes['ch-cam-btn'].onclick();
    assert(nodes['ch-shot'], '촬영 버튼이 없습니다');
    nodes['ch-shot'].onclick();
    assert(nodes['ch-send'], '보내기 버튼이 없습니다');
  }
  return { round, event, close, takePhoto, sent, images, revoked, cameraStreams,
    node: id => nodes[id] || null, advance: ms => { now += ms; },
    failSend: value => { shouldThrow = value; } };
}

async function main() {
  // 정상 제출은 라운드 토큰을 보내고, 서버 확인을 받은 뒤 완료를 표시한다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.node('ch-send').onclick();
    assert.strictEqual(h.sent.length, 1);
    assert.strictEqual(h.sent[0].type, 'photo');
    assert.strictEqual(h.sent[0].data.round_token, 'token-1');
    assert(h.node('ch-area').innerHTML.includes('전송 중'));
    assert(!h.node('ch-area').innerHTML.includes('제출 완료'));
    h.event('ch_submitted', { names: ['민지'], round_token: 'token-1' });
    assert(h.node('ch-area').innerHTML.includes('제출 완료'));
  }

  // 라운드 구분값이 없는 이전 서버라면 카메라를 열지 않고 새로고침을 안내한다.
  {
    const h = createHarness();
    h.event('ch_round', { index: 1, total: 3, color_name: '빨강', hex: '#d32f2f', seconds: 25 });
    await h.node('ch-cam-btn').onclick();
    assert.strictEqual(h.cameraStreams.length, 0);
    assert(h.node('ch-msg').textContent.includes('새로고침'));
  }

  // 화면의 제한시간이 지난 뒤에는 보낼 수 없고 이유를 알려준다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.advance(25000); h.node('ch-send').onclick();
    assert.strictEqual(h.sent.length, 0);
    assert(h.node('ch-msg').textContent.includes('시간이 지나'));
  }

  // 호스트는 현재 라운드의 제출 명단만 표시한다.
  {
    const h = createHarness(false, 'host');
    h.round(2);
    h.event('ch_submitted', { names: ['지난참가자'], round_token: 'token-1' });
    assert.strictEqual(h.node('ch-who').textContent, '');
    h.event('ch_submitted', { names: ['민지'], round_token: 'token-2' });
    assert.strictEqual(h.node('ch-who').textContent, '제출: 민지');
  }

  // 서버가 시간 만료로 거절하면 완료가 아닌 실패를 알려준다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.node('ch-send').onclick();
    h.event('ch_photo_rejected', { name: '민지', round_token: 'token-1' });
    assert(h.node('ch-area').innerHTML.includes('제출 실패'));
    assert(h.node('ch-msg').textContent.includes('시간이 지나'));
  }

  // 현재 사진의 오류는 다시 촬영할 수 있도록 복구한다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.node('ch-send').onclick();
    h.event('ch_photo_error', { name: '민지', round_token: 'token-1' });
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(h.cameraStreams.length, 2);
    assert(h.node('ch-shot'));
    h.close();
    assert.strictEqual(h.cameraStreams[1].track.stops, 1);
  }

  // 이미지 오류가 이미 시간 종료 후 도착하면 무한히 전송 중으로 남지 않는다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.node('ch-send').onclick(); h.advance(25000);
    h.event('ch_photo_error', { name: '민지', round_token: 'token-1' });
    assert(h.node('ch-area').innerHTML.includes('제출 실패'));
    assert(h.node('ch-msg').textContent.includes('시간이 지나'));
    assert.strictEqual(h.cameraStreams.length, 1);
  }

  // 이전 회차의 뒤늦은 오류가 새 회차의 전송 상태를 덮어쓰지 않는다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.node('ch-send').onclick();
    h.round(2); await h.takePhoto(); h.node('ch-send').onclick();
    h.event('ch_photo_rejected', { name: '민지', round_token: 'token-1' });
    h.event('ch_photo_error', { name: '민지', round_token: 'token-1' });
    assert(h.node('ch-area').innerHTML.includes('전송 중'));
    h.event('ch_submitted', { names: ['민지'], round_token: 'token-2' });
    assert(h.node('ch-area').innerHTML.includes('제출 완료'));
  }

  // 이전 회차의 촬영 미리보기 버튼은 새 회차의 사진을 전송하거나 카메라를 켜지 않는다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto();
    const oldSend = h.node('ch-send').onclick, oldRetake = h.node('ch-retake').onclick;
    h.round(2); oldSend(); oldRetake();
    assert.strictEqual(h.sent.length, 0);
    assert.strictEqual(h.cameraStreams.length, 1);
    assert(h.node('ch-cam-btn'), '새 라운드의 카메라 버튼이 유지되어야 합니다');
    assert(!h.node('ch-area').innerHTML.includes('ch-preview'));
  }

  // 서버 확인 전 연결이 끊어지면 성공으로 표시하지 않는다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.node('ch-send').onclick(); h.close();
    assert(h.node('ch-area').innerHTML.includes('전송 확인 불가'));
    assert(!h.node('ch-area').innerHTML.includes('제출 완료'));
  }

  // 소켓 전송 자체가 실패해도 완료로 표시하지 않으며 다시 시도할 수 있다.
  {
    const h = createHarness();
    h.round(1); await h.takePhoto(); h.failSend(true); h.node('ch-send').onclick();
    assert.strictEqual(h.sent.length, 0);
    assert(h.node('ch-msg').textContent.includes('보내지 못했어요'));
    h.failSend(false); h.node('ch-send').onclick();
    assert.strictEqual(h.sent.length, 1);
  }

  // 사진 앱에서 돌아오기 전 라운드가 바뀌면 오래된 선택을 무시한다.
  {
    const h = createHarness(true);
    h.round(1); await h.node('ch-cam-btn').onclick();
    const oldInput = h.node('ch-file');
    h.round(2);
    await oldInput.onchange({ target: { files: [{}] } });
    assert.strictEqual(h.images.length, 0);
    assert(h.node('ch-cam-btn'), '새 라운드의 카메라 버튼이 유지되어야 합니다');
    assert(!h.node('ch-area').innerHTML.includes('ch-preview'));
  }

  // 이미지 읽기 중 라운드가 바뀌어도 이전 미리보기를 띄우지 않는다.
  {
    const h = createHarness(true);
    h.round(1); await h.node('ch-cam-btn').onclick();
    const pending = h.node('ch-file').onchange({ target: { files: [{}] } });
    assert.strictEqual(h.images.length, 1);
    h.round(2); h.images[0].onload(); await pending;
    assert(h.node('ch-cam-btn'), '새 라운드의 카메라 버튼이 유지되어야 합니다');
    assert(!h.node('ch-area').innerHTML.includes('ch-preview'));
    assert.strictEqual(h.sent.length, 0);
    assert.deepStrictEqual(h.revoked, ['blob:test-1']);
  }

  // 메시지가 늦더라도 기기 제한시간이 끝난 이미지 처리는 무시한다.
  {
    const h = createHarness(true);
    h.round(1); await h.node('ch-cam-btn').onclick();
    const pending = h.node('ch-file').onchange({ target: { files: [{}] } });
    h.advance(25000); h.images[0].onload(); await pending;
    assert(!h.node('ch-area').innerHTML.includes('ch-preview'));
    assert.strictEqual(h.sent.length, 0);
  }

  // 사진 앱에서 읽기 오류가 나면 현재 화면에 오류를 알리고 임시 URL을 정리한다.
  {
    const h = createHarness(true);
    h.round(1); await h.node('ch-cam-btn').onclick();
    const pending = h.node('ch-file').onchange({ target: { files: [{}] } });
    h.images[0].onerror(); await pending;
    assert(h.node('ch-msg').textContent.includes('이미지를 열 수 없어요'));
    assert.deepStrictEqual(h.revoked, ['blob:test-1']);
  }

  // 사진 앱 방식의 정상 제출도 라운드 토큰과 서버 확인을 사용한다.
  {
    const h = createHarness(true);
    h.round(1); await h.node('ch-cam-btn').onclick();
    const pending = h.node('ch-file').onchange({ target: { files: [{}] } });
    h.images[0].onload(); await pending;
    h.node('ch-send').onclick();
    assert.strictEqual(h.sent[0].data.round_token, 'token-1');
    h.event('ch_submitted', { names: ['민지'], round_token: 'token-1' });
    assert(h.node('ch-area').innerHTML.includes('제출 완료'));
  }
  console.log('color photo UI OK');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
