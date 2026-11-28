// Shared local audio; each game owns a scope and stops it on exit.
window.PartyAudio = function (base, tracks) {
  const sounds = new Map();
  const active = new Map();
  let enabled = false;
  const muted = {music: false, effects: false};
  try { for (const k of Object.keys(muted)) muted[k] = localStorage.getItem('party-audio-' + k) === '1'; } catch (_) {}
  function get(name) {
    if (!tracks[name] || typeof Howl !== 'function') return null;
    if (!sounds.has(name)) {
      const t = tracks[name];
      sounds.set(name, new Howl({src: [base + t.file], html5: !!t.html5, loop: !!t.loop, volume: t.volume ?? 0.5, mute: muted[t.group]}));
    }
    return sounds.get(name);
  }
  function play(name, volume) {
    if (!enabled || !tracks[name] || muted[tracks[name].group]) return;
    const sound = get(name); if (!sound) return;
    if (tracks[name].loop && active.has(name)) { if (volume !== undefined) sound.volume(volume, active.get(name)); return; }
    const id = sound.play();
    if (volume !== undefined) sound.volume(volume, id);
    if (tracks[name].loop) active.set(name, id);
  }
  function stop(name) { const s = sounds.get(name); if (s) s.stop(); active.delete(name); }
  function fadeOut(name, ms) {
    const s = sounds.get(name), id = active.get(name);
    if (!s || id === undefined) return;
    s.once('fade', () => { if (active.get(name) === id) { s.stop(id); active.delete(name); } }, id);
    s.fade(s.volume(id), 0, ms, id);
  }
  function setMuted(group, value) {
    muted[group] = value;
    try { localStorage.setItem('party-audio-' + group, value ? '1' : '0'); } catch (_) {}
    for (const [name, s] of sounds) if (tracks[name].group === group) s.mute(value);
  }
  return {enable() { enabled = true; if (typeof Howler !== 'undefined' && Howler.ctx?.state === 'suspended') Howler.ctx.resume().catch(() => {}); }, play, stop, fadeOut, rate(name, value) { const s = sounds.get(name); if (s && active.has(name)) s.rate(value, active.get(name)); }, stopAll() { for (const name of sounds.keys()) stop(name); }, setMuted, isMuted: group => muted[group]};
};
