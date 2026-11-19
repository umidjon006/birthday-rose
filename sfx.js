/* =====================================================================
   OVOZ EFFEKTLARI: qo'ng'izchaning ovozi (brauzerda sintez qilinadi)
   - giggle():  "hi-hi-hi-hii!" — yoqimtoy kulgi
   - grumble(): "grrr... hmph!" — jahli chiqqan, lekin yoqimtoy
   - setBuzz(): ekranga yaqin uchganda qanot g'uvillashi
   ===================================================================== */
let ctx = null,
  out = null,
  buzzGain = null,
  noiseBuf = null,
  muted = false

// tugma bosilganda chaqiriladi (brauzer ovozga faqat foydalanuvchi bosgandan keyin ruxsat beradi)
export function initSfx() {
  // iOS 17+: telefon ovozsiz rejimda bo'lsa ham qo'ng'iz ovozi eshitilsin (qo'shiq kabi)
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback'
  } catch (e) {}
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC || ctx) return
  ctx = new AC()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx.state !== 'running') ctx.resume().catch(() => {})
  })
  out = ctx.createGain()
  out.gain.value = muted ? 0 : 1
  const comp = ctx.createDynamicsCompressor()
  out.connect(comp)
  comp.connect(ctx.destination)

  // oq shovqin (nafas, "h" va "ph" tovushlari uchun)
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

  // qanot g'uvillashi: doim ishlab turadi, ovozi 0 da
  buzzGain = ctx.createGain()
  buzzGain.gain.value = 0
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  const trem = ctx.createGain()
  trem.gain.value = 0.6
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 38
  const lfoG = ctx.createGain()
  lfoG.gain.value = 0.4
  lfo.connect(lfoG)
  lfoG.connect(trem.gain)
  for (const [f, det] of [[172, 0], [176, 7], [345, -5]]) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    o.detune.value = det
    o.connect(lp)
    o.start()
  }
  lp.connect(trem)
  trem.connect(buzzGain)
  buzzGain.connect(out)
  lfo.start()
}

export function setSfxMuted(m) {
  muted = m
  if (ctx && out) out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05)
}

export function setBuzz(level) {
  if (!ctx || !buzzGain) return
  buzzGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.05, ctx.currentTime, 0.06)
}

function ready() {
  if (!ctx) return false
  if (ctx.state === 'suspended') ctx.resume()
  return true
}

// bitta "bo'g'in": arra to'lqin + formant filtrlar (unli tovush hosil qiladi)
function syllable(t, f0, f1, dur, formants, vol, opts = {}) {
  const o = ctx.createOscillator()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(f0, t)
  o.frequency.exponentialRampToValueAtTime(f1, t + dur)
  // tirik ovoz uchun vibrato
  const vib = ctx.createOscillator()
  vib.frequency.value = opts.vib || 7
  const vibG = ctx.createGain()
  vibG.gain.value = f0 * 0.018
  vib.connect(vibG)
  vibG.connect(o.frequency)

  const env = ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.018, dur * 0.25))
  env.gain.setValueAtTime(vol, t + dur * 0.55)
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  let tail = env
  if (opts.trem) {
    // "rrr" — tez titroq
    const tr = ctx.createGain()
    tr.gain.value = 0.5
    const lfo = ctx.createOscillator()
    lfo.type = 'square'
    lfo.frequency.value = opts.trem
    const lg = ctx.createGain()
    lg.gain.value = 0.48
    lfo.connect(lg)
    lg.connect(tr.gain)
    env.connect(tr)
    tail = tr
    lfo.start(t)
    lfo.stop(t + dur + 0.05)
  }
  for (const [F, Q, g] of formants) {
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = F
    bp.Q.value = Q
    const gg = ctx.createGain()
    gg.gain.value = g
    o.connect(bp)
    bp.connect(gg)
    gg.connect(env)
  }
  tail.connect(out)
  o.start(t)
  vib.start(t)
  o.stop(t + dur + 0.05)
  vib.stop(t + dur + 0.05)
}

function breath(t, dur, freq, vol, q = 1.2) {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(bp)
  bp.connect(g)
  g.connect(out)
  s.start(t)
  s.stop(t + dur + 0.02)
}

// "hi-hi-hi-hii!" — ingichka, quvnoq kulgi
export function giggle() {
  if (!ready()) return
  const t0 = ctx.currentTime + 0.03
  const I = [[450, 6, 1], [2700, 10, 0.75], [3700, 12, 0.3]] // "i" unlisi
  const notes = [[860, 790], [930, 860], [1000, 930], [1080, 990], [1180, 1420]]
  notes.forEach(([a, b], i) => {
    const st = t0 + i * 0.125
    const last = i === notes.length - 1
    breath(st, 0.04, 3600, 0.09)
    syllable(st + 0.016, a, b, last ? 0.26 : 0.09, I, 0.2, { vib: last ? 9 : 7 })
  })
}

// "grrr... hmph!" — jahli chiqqan, lekin baribir yoqimtoy (baland, bolalarcha ovoz)
export function grumble() {
  if (!ready()) return
  const t0 = ctx.currentTime + 0.03
  // "mmm" — lab yumib norozi
  syllable(t0, 380, 440, 0.22, [[300, 4, 1], [1000, 6, 0.22]], 0.2)
  // "grrr" — o'ralib keladigan "r"
  syllable(t0 + 0.26, 360, 285, 0.58, [[700, 5, 1], [1200, 7, 0.55], [2500, 9, 0.18]], 0.26, { trem: 31, vib: 5 })
  // "hmph!" — burnini jiyirib
  breath(t0 + 0.94, 0.17, 950, 0.3, 0.9)
  syllable(t0 + 0.95, 420, 330, 0.13, [[360, 4, 1], [950, 6, 0.3]], 0.2)
}

// "uh-h-h..." — xafa bo'lib xo'rsinish
export function sigh() {
  if (!ready()) return
  const t0 = ctx.currentTime + 0.03
  breath(t0, 0.3, 700, 0.1, 0.8)
  syllable(t0 + 0.1, 560, 330, 1.05, [[380, 5, 1], [850, 7, 0.45], [2600, 10, 0.08]], 0.17, { vib: 5 })
}

// burun tortish (yig'lagandek)
export function sniff() {
  if (!ready()) return
  const t0 = ctx.currentTime + 0.03
  breath(t0, 0.08, 2600, 0.11, 2)
  breath(t0 + 0.15, 0.11, 2900, 0.13, 2)
}

// "oh?" — umid bilan, ovozi ko'tariladi
export function oh() {
  if (!ready()) return
  const t0 = ctx.currentTime + 0.03
  syllable(t0, 430, 660, 0.34, [[520, 5, 1], [950, 7, 0.5], [2600, 10, 0.1]], 0.18, { vib: 6 })
}
