/* =====================================================================
   MUSIQA: brauzerning o'zida yaratiladi (fayl kerak emas)
   - musiqa qutisi ovozida "Happy Birthday" (jamoat mulki, erkin kuy)
   - ostida yumshoq akkordlar, orasida mayin arpedjio
   O'z mp3 faylingizni qo'ymoqchi bo'lsangiz: MUSIC_FILE = 'music.mp3'
   ===================================================================== */
export const MUSIC_FILE = '' // masalan: 'music.mp3' (shu papkaga qo'ying)

const BEAT = 0.66 // bir zarb davomiyligi (soniya) — sekin, romantik
const MELODY_AT = 9.0 // kuy qo'ng'izcha chiqqanda boshlanadi (tugma bosilgandan keyin)

const NOTE = (n) => {
  const m = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  const oct = parseInt(n.slice(-1), 10)
  const sharp = n.includes('#') ? 1 : 0
  return 440 * Math.pow(2, (m[n[0]] + sharp + (oct - 4) * 12 - 9) / 12)
}

// [nota, zarblar]
const MELODY = [
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['C5', 1], ['B4', 2],
  ['G4', 0.75], ['G4', 0.25], ['A4', 1], ['G4', 1], ['D5', 1], ['C5', 2],
  ['G4', 0.75], ['G4', 0.25], ['G5', 1], ['E5', 1], ['C5', 1], ['B4', 1], ['A4', 2],
  ['F5', 0.75], ['F5', 0.25], ['E5', 1], ['C5', 1], ['D5', 1], ['C5', 3],
]
// har 3 zarbga bitta akkord (kuy 1 zarblik "kirish"dan keyin boshlanadi)
const MEL_CHORDS = [
  ['C3', 'E3', 'G3'], ['G2', 'D3', 'F3'], ['G2', 'D3', 'F3'], ['C3', 'E3', 'G3'],
  ['C3', 'E3', 'A#3'], ['F2', 'C3', 'A3'], ['G2', 'C3', 'E3'], ['C3', 'E3', 'G3'],
]
// kuydan oldin/keyin aylanib turadigan yumshoq akkordlar: C – Am – F – G
const AMBIENT = [
  ['C3', 'G3', 'C4', 'E4'],
  ['A2', 'E3', 'A3', 'C4'],
  ['F2', 'C3', 'F3', 'A3'],
  ['G2', 'D3', 'G3', 'B3'],
]

let ctx = null, master = null, wet = null, timer = null, muted = false, fileAudio = null

function makeReverb(c) {
  const len = c.sampleRate * 3.2
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)
  }
  const conv = c.createConvolver()
  conv.buffer = buf
  return conv
}

// musiqa qutisi tovushi: yumshoq qo'ng'iroqcha (bir necha garmonika, tez so'nadi)
function bell(freq, t, vel = 1, dur = 2.2) {
  const parts = [[1, 1], [2, 0.28], [3, 0.1], [4.2, 0.05]]
  const out = ctx.createGain()
  out.gain.setValueAtTime(0, t)
  out.gain.linearRampToValueAtTime(0.16 * vel, t + 0.006)
  out.gain.exponentialRampToValueAtTime(0.0008, t + dur)
  out.connect(master)
  out.connect(wet)
  for (const [mul, amp] of parts) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = freq * mul * (1 + (Math.random() - 0.5) * 0.002)
    g.gain.value = amp
    o.connect(g)
    g.connect(out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }
}

// yumshoq pad: sekin kirib, sekin chiqadi
function pad(freqs, t, dur, vel = 1) {
  const out = ctx.createGain()
  out.gain.setValueAtTime(0, t)
  out.gain.linearRampToValueAtTime(0.05 * vel, t + dur * 0.35)
  out.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  out.connect(lp)
  lp.connect(master)
  lp.connect(wet)
  for (const f of freqs) {
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = f
      o.detune.value = det
      o.connect(out)
      o.start(t)
      o.stop(t + dur + 0.8)
    }
  }
}

// butun asarni "voqealar ro'yxati"ga aylantiramiz, keyin oldindan rejalashtiramiz
function buildScore() {
  const ev = []
  const bar = BEAT * 4
  // 1) kirish: kuy boshlanguncha mayin arpedjio
  let t = 0.3, k = 0
  while (t < MELODY_AT - bar * 0.5) {
    const ch = AMBIENT[k % 4]
    ev.push({ t, f: () => pad(ch.slice(0, 3).map(NOTE), ctx0 + t, bar, 0.8) })
    ch.forEach((n, i) => {
      const tt = t + i * BEAT
      ev.push({ t: tt, f: () => bell(NOTE(n) * 2, ctx0 + tt, 0.35) })
    })
    t += bar
    k++
  }
  // 2) "Happy Birthday"
  const m0 = MELODY_AT
  let mt = m0
  MELODY.forEach(([n, b]) => {
    const tt = mt
    ev.push({ t: tt, f: () => bell(NOTE(n), ctx0 + tt, 0.9, Math.max(1.6, b * BEAT * 2.2)) })
    mt += b * BEAT
  })
  MEL_CHORDS.forEach((ch, i) => {
    const tt = m0 + BEAT + i * BEAT * 3
    ev.push({ t: tt, f: () => pad(ch.map(NOTE), ctx0 + tt, BEAT * 3, 1) })
    ev.push({ t: tt, f: () => bell(NOTE(ch[0]) * 2, ctx0 + tt, 0.25, 2.5) })
  })
  return { ev, end: mt + BEAT * 2 }
}

let ctx0 = 0, score = null, idx = 0, loopStart = 0

function scheduler() {
  const ahead = ctx.currentTime + 0.4
  // kuy tugagach: tinch arpedjio cheksiz davom etadi
  while (true) {
    if (idx < score.ev.length) {
      const e = score.ev[idx]
      if (ctx0 + e.t > ahead) break
      e.f()
      idx++
    } else {
      const bar = BEAT * 4
      if (!loopStart) loopStart = score.end
      const tt = loopStart
      if (ctx0 + tt > ahead) break
      const ch = AMBIENT[Math.floor((tt - score.end) / bar) % 4]
      pad(ch.slice(0, 3).map(NOTE), ctx0 + tt, bar, 0.7)
      ch.forEach((n, i) => bell(NOTE(n) * 2, ctx0 + tt + i * BEAT, 0.28))
      // ba'zan yuqorida bitta yulduzcha-nota
      if (Math.random() < 0.5) bell(NOTE(ch[3]) * 4, ctx0 + tt + BEAT * 2.5, 0.12, 3)
      loopStart += bar
    }
  }
}

// tugma bosilganda chaqiriladi (brauzer ovozni faqat foydalanuvchi bosgandan keyin ruxsat beradi)
export function startMusic() {
  if (MUSIC_FILE) {
    fileAudio = new Audio(MUSIC_FILE)
    fileAudio.loop = true
    fileAudio.volume = 0
    fileAudio.play().catch(() => {})
    let v = 0
    const fade = setInterval(() => {
      v = Math.min(0.8, v + 0.04)
      fileAudio.volume = muted ? 0 : v
      if (v >= 0.8) clearInterval(fade)
    }, 120)
    return
  }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC || ctx) return
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = 0
  master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5)
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp)
  comp.connect(ctx.destination)
  const rev = makeReverb(ctx)
  wet = ctx.createGain()
  wet.gain.value = 0.55
  wet.connect(rev)
  rev.connect(comp)
  ctx0 = ctx.currentTime + 0.05
  score = buildScore()
  scheduler()
  timer = setInterval(scheduler, 120)
}

export function setMuted(m) {
  muted = m
  if (fileAudio) fileAudio.volume = m ? 0 : 0.8
  if (ctx && master) {
    master.gain.cancelScheduledValues(ctx.currentTime)
    master.gain.linearRampToValueAtTime(m ? 0 : 0.9, ctx.currentTime + 0.4)
  }
}
