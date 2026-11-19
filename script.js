import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { startMusic, setMuted, restartMusic, duckMusic } from './music.js?v=3'
import * as sfx from './sfx.js?v=3'

/* =====================================================================
   SOZLAMALAR (shu yerdan sozlang)
   ===================================================================== */
const CONFIG = {
  petals: 50, // gulbarglar soni (ko'p = to'laroq gul)
  roseScale: 0.98, // gul boshining umumiy kattaligi
  sparkles: 90, // yulduzchalar soni (0 = o'chirish)
  fallMax: 6, // bir vaqtda tushayotgan gulbarglar
  seed: 2026, // o'zgartirsangiz gulning "tasodifiy" ko'rinishi boshqacha bo'ladi
}

// Vaqt jadvali (tugma bosilgandan boshlab, soniyada)
const T = {
  stemStart: 1.3,
  stemDur: 1.1,
  leafDelays: [1.9, 2.2, 2.5, 2.8, 3.1],
  leafDur: 1.4,
  headStart: 4.0,
  headDur: 1.0, // kosacha va kurtak
  budStart: 5.2,
  budDur: 1.0, // qizil kurtak o'sadi
  openStart: 6.2,
  openDur: 3.0, // gul ochiladi
  fallStart: 8.8,
  sparkleStart: 8.8,
  beetleStart: 8.4, // qo'ng'izcha gul ichidan chiqa boshlaydi
}

/* =====================================================================
   YORDAMCHI FUNKSIYALAR
   ===================================================================== */
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const deg = THREE.MathUtils.degToRad

// Tasodifiy, lekin har safar bir xil (seed bo'yicha) generator
function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(CONFIG.seed)
const rr = (a, b) => a + (b - a) * rand()

/* =====================================================================
   YUKLANISH KARTASI
   ===================================================================== */
const stage = document.getElementById('stage')
const card = document.getElementById('card')
const bar = document.getElementById('barFill')
const status = document.getElementById('status')
const btn = document.getElementById('bloomBtn')

const STEPS = [
  [500, 'Loading ...', 15],
  [1000, 'Growing digital petals ...', 35],
  [1500, 'Adding velvet textures ...', 55],
  [2000, 'Optimizing 3D rendering ...', 80],
  [2500, 'Ready to bloom!', 100],
]
STEPS.forEach(([time, text, percent]) => {
  setTimeout(() => {
    status.textContent = text
    bar.style.width = percent + '%'
    if (percent === 100) btn.disabled = false
  }, time)
})

/* =====================================================================
   RENDERER, SAHNA, YORUG'LIK
   ===================================================================== */
const canvas = document.getElementById('gl')
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
})
renderer.setClearColor(0x000000, 0)
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 0.78 // qizil kanal "kuyib" ketmasin: soyalar saqlanadi
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)

// Yumshoq muhit aks-sadosi (ozgina yaltiroqlik uchun)
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.22

scene.add(new THREE.HemisphereLight(0xff9aa8, 0x120006, 0.22))

const key = new THREE.DirectionalLight(0xfff1ea, 1.75)
key.position.set(5, 7, 3.5) // yonroqdan tushadi: gulbarg hajmi aniqroq
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.left = -3.5
key.shadow.camera.right = 3.5
key.shadow.camera.top = 3.5
key.shadow.camera.bottom = -3.5
key.shadow.camera.near = 1
key.shadow.camera.far = 25
key.shadow.bias = -0.0006
key.shadow.normalBias = 0.035
key.shadow.radius = 4
scene.add(key)

const rim = new THREE.DirectionalLight(0xff9aa6, 1.7) // orqadan iliq chetki nur
rim.position.set(-5, 3, -4)
scene.add(rim)

const fill = new THREE.DirectionalLight(0x7f8cff, 0.3) // juda kuchsiz sovuq to'ldiruvchi
fill.position.set(5, 0, 3)
scene.add(fill)

/* =====================================================================
   KINEMATOGRAFIK POST-PROCESSING: nur (bloom), rang, vinyetka, plyonka donasi
   ===================================================================== */
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 })
)
composer.addPass(new RenderPass(scene, camera))
const bloomPass = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.55, 0.9)
composer.addPass(bloomPass)
composer.addPass(new OutputPass())
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGlow: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGlow; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // chetlarda juda nozik xromatik aberratsiya (linza hissi)
      vec2 off = c * r2 * 0.012;
      vec4 base = texture2D(tDiffuse, uv);
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, base.g, texture2D(tDiffuse, uv - off).b);
      float a = clamp(base.a, 0.0, 1.0);
      // fon: qorong'i qizg'ish chuqurlik + gul ortidagi iliq nur
      float d1 = length(vec2(c.x / 0.40, (uv.y - 0.58) / 0.45));
      vec3 bg = vec3(0.102, 0.0, 0.031) * (1.0 - smoothstep(0.0, 0.7, d1));
      float d2 = length(vec2(c.x / 0.26, (uv.y - 0.64) / 0.34));
      bg += vec3(0.24, 0.0, 0.05) * (1.0 - smoothstep(0.0, 0.75, d2)) * uGlow;
      col += bg * (1.0 - a);
      // yumshoq kontrast va iliq ranglar
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
      col *= vec3(1.02, 0.99, 0.97);
      // vinyetka
      float vig = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.1)) * 1.25);
      col *= mix(0.62, 1.0, vig);
      // plyonka donasi
      float gr = hash(uv * uRes + fract(uTime * 7.13) * 100.0) - 0.5;
      col += gr * 0.022;
      gl_FragColor = vec4(col, 1.0);
    }`,
})
composer.addPass(gradePass)

/* Kadr o'lchami: butun o'simlik + pastda matn uchun joy */
const VIEW_H = 10.8,
  VIEW_W = 6.6,
  TARGET_Y = -0.9
function layout() {
  const w = window.innerWidth,
    h = window.innerHeight
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  const fov = deg(camera.fov)
  const distV = VIEW_H / (2 * Math.tan(fov / 2))
  const distH = VIEW_W / (2 * Math.tan(fov / 2) * camera.aspect)
  // ?zoom=3 — sozlash uchun gulga yaqinlashish
  const zq = parseFloat(new URLSearchParams(location.search).get('zoom')) || 1
  const d = Math.max(distV, distH) / zq
  const ty = zq > 1 ? 0.7 : TARGET_Y
  const elev = deg(25)
  camera.position.set(0, ty + d * Math.sin(elev), d * Math.cos(elev))
  camera.lookAt(0, ty, 0)
  camera.updateProjectionMatrix()
  const pr = Math.min(window.devicePixelRatio || 1, 2)
  composer.setPixelRatio(pr)
  composer.setSize(w, h)
  bloomPass.resolution.set(w, h)
  gradePass.uniforms.uRes.value.set(w * pr, h * pr)
}
window.addEventListener('resize', layout)
layout()

/* =====================================================================
   TEKSTURALAR (canvas'da chiziladi, tashqi rasm kerak emas)
   ===================================================================== */
// yumshoq "bulut" shovqin qatlami (fbm o'rniga: kichik tasodifiy rasm kattalashtiriladi)
function noiseLayer(g, W, H, cells, alpha, op) {
  const n = document.createElement('canvas')
  n.width = n.height = cells
  const ng = n.getContext('2d')
  const im = ng.createImageData(cells, cells)
  for (let i = 0; i < cells * cells; i++) {
    const v = Math.random() * 255
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v
    im.data[i * 4 + 3] = 255
  }
  ng.putImageData(im, 0, 0)
  g.save()
  g.globalAlpha = alpha
  g.globalCompositeOperation = op
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(n, 0, 0, W, H)
  g.restore()
}

// balandlik xaritasidan normal map (sirtdagi mayda bo'rtiq va tomirlar uchun)
function heightToNormal(hc, strength) {
  const W = hc.width, H = hc.height
  const src = hc.getContext('2d').getImageData(0, 0, W, H).data
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const og = out.getContext('2d')
  const img = og.createImageData(W, H)
  const d = img.data
  const h = (x, y) => src[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4] / 255
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength
      let nx = -dx, ny = dy, nz = 1
      const l = Math.hypot(nx, ny, nz)
      const k = (y * W + x) * 4
      d[k] = (nx / l * 0.5 + 0.5) * 255
      d[k + 1] = (ny / l * 0.5 + 0.5) * 255
      d[k + 2] = (nz / l * 0.5 + 0.5) * 255
      d[k + 3] = 255
    }
  }
  og.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(out)
  tex.anisotropy = 8
  return tex
}

function makePetalTexture() {
  const W = 1024, H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const HS = 512
  const hc = document.createElement('canvas')
  hc.width = hc.height = HS
  const hg = hc.getContext('2d')
  hg.fillStyle = '#808080'
  hg.fillRect(0, 0, HS, HS)

  // tagidan uchigacha: tubida och-sarg'ish, keyin to'q qon-qizil, uchida yorqin qizil
  const grad = g.createLinearGradient(0, H, 0, 0)
  grad.addColorStop(0.0, '#7a3a14')
  grad.addColorStop(0.05, '#4a0208')
  grad.addColorStop(0.24, '#6d0010')
  grad.addColorStop(0.55, '#a30c22')
  grad.addColorStop(0.82, '#c5142d')
  grad.addColorStop(1.0, '#cf2738')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)

  // tabiiy dog'lanish (rang notekisligi)
  noiseLayer(g, W, H, 6, 0.16, 'overlay')
  noiseLayer(g, W, H, 14, 0.14, 'overlay')
  noiseLayer(g, W, H, 40, 0.08, 'overlay')
  noiseLayer(hg, HS, HS, 24, 0.25, 'overlay')
  noiseLayer(hg, HS, HS, 90, 0.18, 'overlay')

  // chetlari: ozgina to'qroq, "baxmal" qirra
  const side = g.createLinearGradient(0, 0, W, 0)
  side.addColorStop(0.0, 'rgba(45,0,8,0.42)')
  side.addColorStop(0.1, 'rgba(45,0,8,0)')
  side.addColorStop(0.9, 'rgba(45,0,8,0)')
  side.addColorStop(1.0, 'rgba(45,0,8,0.42)')
  g.fillStyle = side
  g.fillRect(0, 0, W, H)
  const tip = g.createLinearGradient(0, 0, 0, H * 0.14)
  tip.addColorStop(0, 'rgba(50,0,10,0.32)')
  tip.addColorStop(1, 'rgba(50,0,10,0)')
  g.fillStyle = tip
  g.fillRect(0, 0, W, H * 0.14)

  // tomirlar: tubidan yelpig'ichsimon tarqaladi, ba'zilari shoxlanadi
  const veins = []
  const NV = 96
  for (let i = 0; i < NV; i++) {
    const t = (i / (NV - 1)) * 2 - 1
    const x0 = 0.5 + t * 0.05
    const x1 = 0.5 + t * 0.5 + (Math.random() - 0.5) * 0.03
    const y1 = 0.02 + Math.pow(Math.abs(t), 1.6) * 0.32
    const cx = 0.5 + t * 0.3 + (Math.random() - 0.5) * 0.04
    const w = 0.6 + Math.random() * 1.4
    veins.push({ x0, y0: 1.0, cx, cy: 0.5, x1, y1, w, a: 0.05 + Math.random() * 0.07 })
    if (Math.random() < 0.45) {
      const bx = 0.5 + t * 0.32, by = 0.42 + Math.random() * 0.2
      veins.push({ x0: bx, y0: by, cx: bx + t * 0.06, cy: by - 0.12, x1: bx + t * 0.12 + (Math.random() - 0.5) * 0.05, y1: by - 0.3, w: w * 0.6, a: 0.04 })
    }
  }
  g.lineCap = hg.lineCap = 'round'
  for (const v of veins) {
    g.beginPath()
    g.moveTo(v.x0 * W, v.y0 * H)
    g.quadraticCurveTo(v.cx * W, v.cy * H, v.x1 * W, v.y1 * H)
    g.strokeStyle = `rgba(28,0,6,${v.a})`
    g.lineWidth = v.w * 1.6
    g.stroke()
    g.beginPath()
    g.moveTo(v.x0 * W + 2, v.y0 * H)
    g.quadraticCurveTo(v.cx * W + 2, v.cy * H, v.x1 * W + 2, v.y1 * H)
    g.strokeStyle = `rgba(255,120,135,${v.a * 0.35})`
    g.lineWidth = v.w
    g.stroke()
    hg.beginPath()
    hg.moveTo(v.x0 * HS, v.y0 * HS)
    hg.quadraticCurveTo(v.cx * HS, v.cy * HS, v.x1 * HS, v.y1 * HS)
    hg.strokeStyle = `rgba(0,0,0,${0.35 + v.a * 2})`
    hg.lineWidth = v.w * 1.1
    hg.stroke()
  }

  // baxmal: mayda piksel shovqin
  const img = g.getImageData(0, 0, W, H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 12
    d[i] += n
    d[i + 1] += n * 0.25
    d[i + 2] += n * 0.3
  }
  g.putImageData(img, 0, 0)

  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  return { map, normal: heightToNormal(hc, 3.2) }
}

function makeLeafTexture() {
  const W = 512, H = 1024
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const hc = document.createElement('canvas')
  hc.width = 256
  hc.height = 512
  const hg = hc.getContext('2d')
  hg.fillStyle = '#808080'
  hg.fillRect(0, 0, 256, 512)

  const grad = g.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0.0, '#173f1b')
  grad.addColorStop(0.5, '#2a7330')
  grad.addColorStop(1.0, '#173f1b')
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  const vg = g.createLinearGradient(0, H, 0, 0)
  vg.addColorStop(0, 'rgba(0,25,0,0.40)')
  vg.addColorStop(0.5, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(139,195,74,0.18)')
  g.fillStyle = vg
  g.fillRect(0, 0, W, H)
  noiseLayer(g, W, H, 8, 0.18, 'overlay')
  noiseLayer(g, W, H, 30, 0.12, 'overlay')
  noiseLayer(hg, 256, 512, 60, 0.2, 'overlay')

  g.lineCap = hg.lineCap = 'round'
  const line = (ctx, sx, x0, y0, cx, cy, x1, y1, col, lw) => {
    ctx.beginPath()
    ctx.moveTo(x0 * sx, y0 * sx)
    ctx.quadraticCurveTo(cx * sx, cy * sx, x1 * sx, y1 * sx)
    ctx.strokeStyle = col
    ctx.lineWidth = lw
    ctx.stroke()
  }
  // yon tomirlar va ularning mayda shoxchalari
  for (let k = 0; k < 16; k++) {
    const y = H * (0.96 - k * 0.057)
    for (const s of [-1, 1]) {
      const x0 = W / 2, x1 = W / 2 + s * W * 0.47, y1 = y - 150
      line(g, 1, x0, y, W / 2 + s * 110, y - 50, x1, y1, 'rgba(150,210,100,0.38)', 2.6)
      line(hg, 0.5, x0, y, W / 2 + s * 110, y - 50, x1, y1, 'rgba(255,255,255,0.55)', 1.6)
      for (let m = 0; m < 3; m++) {
        const bx = W / 2 + s * (60 + m * 55), by = y - 26 - m * 34
        line(g, 1, bx, by, bx + s * 10, by + 30, bx - s * 8, by + 64, 'rgba(120,185,80,0.18)', 1.2)
      }
    }
  }
  line(g, 1, W / 2, H, W / 2, H / 2, W / 2, 0, 'rgba(156,204,101,0.9)', 8)
  line(g, 1, W / 2, H, W / 2, H / 2, W / 2, 0, 'rgba(215,240,165,0.55)', 3)
  line(hg, 0.5, W / 2, H, W / 2, H / 2, W / 2, 0, 'rgba(255,255,255,0.9)', 4)

  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  return { map, normal: heightToNormal(hc, 2.5) }
}

const petalTex = makePetalTexture()
const leafTex = makeLeafTexture()

/* =====================================================================
   MATERIALLAR
   ===================================================================== */
const petalMat = new THREE.MeshPhysicalMaterial({
  map: petalTex.map,
  normalMap: petalTex.normal,
  normalScale: new THREE.Vector2(0.8, 0.8),
  vertexColors: true,
  roughness: 0.7,
  metalness: 0,
  sheen: 0.6, // baxmal yaltirash
  sheenRoughness: 0.5,
  sheenColor: new THREE.Color(0xff4d62),
  emissive: new THREE.Color(0x1a0003),
  side: THREE.DoubleSide,
})

// Gulbarg orqasidan nur o'tishi (subsurface/translucency) - shader'ga qo'shimcha
const sssU = {
  uBackL: { value: new THREE.Vector3() },
  uKeyL: { value: new THREE.Vector3() },
  uBackC: { value: new THREE.Color(1.0, 0.16, 0.22).multiplyScalar(0.55) },
  uKeyC: { value: new THREE.Color(1.0, 0.45, 0.4).multiplyScalar(0.12) },
}
petalMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, sssU)
  sh.fragmentShader = sh.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform vec3 uBackL; uniform vec3 uKeyL; uniform vec3 uBackC; uniform vec3 uKeyC;'
    )
    .replace(
      '#include <opaque_fragment>',
      `{
        vec3 Vd = normalize(vViewPosition);
        float thin = 1.0 - abs(dot(normal, Vd));
        float t1 = pow(clamp(dot(Vd, -normalize(uBackL + normal * 0.45)), 0.0, 1.0), 2.5);
        float t2 = pow(clamp(dot(Vd, -normalize(uKeyL + normal * 0.45)), 0.0, 1.0), 2.5);
        float wrap = clamp(dot(normal, normalize(uKeyL)) * 0.5 + 0.5, 0.0, 1.0);
        // nur faqat gulbargning orqa tomoniga tushsa o'tadi; ichkaridagilar soyada (vColor = AO)
        t1 *= clamp(-dot(normal, normalize(uBackL)) * 1.5, 0.0, 1.0);
        t2 *= clamp(-dot(normal, normalize(uKeyL)) * 1.5, 0.0, 1.0);
        float occ = vColor.r * vColor.r;
        outgoingLight += diffuseColor.rgb * (uBackC * t1 + uKeyC * t2) * (0.35 + 0.9 * thin) * occ * 1.6;
        outgoingLight += diffuseColor.rgb * vec3(0.5, 0.06, 0.08) * wrap * 0.05;
        // diffuz o'tish: orqa tomondan tushgan nur yupqa gulbarg orqali qizg'ish bo'lib chiqadi
        float bk = clamp(-dot(normal, normalize(uKeyL)), 0.0, 1.0);
        outgoingLight += diffuseColor.rgb * vec3(1.0, 0.25, 0.22) * bk * 0.55 * (0.4 + 0.6 * vColor.r);
      }
      #include <opaque_fragment>`
    )
}
function updateSSS() {
  camera.updateMatrixWorld()
  sssU.uBackL.value.copy(rim.position).normalize().transformDirection(camera.matrixWorldInverse)
  sssU.uKeyL.value.copy(key.position).normalize().transformDirection(camera.matrixWorldInverse)
}

const leafMat = new THREE.MeshStandardMaterial({
  map: leafTex.map,
  normalMap: leafTex.normal,
  normalScale: new THREE.Vector2(0.7, 0.7),
  roughness: 0.46,
  metalness: 0,
  side: THREE.DoubleSide,
})
const sepalMat = new THREE.MeshStandardMaterial({
  color: 0x5da83c,
  roughness: 0.5,
  metalness: 0,
  side: THREE.DoubleSide,
})
const stemMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.48,
  metalness: 0,
})
const hipMat = new THREE.MeshStandardMaterial({
  color: 0x3d8a2e,
  roughness: 0.5,
})

/* =====================================================================
   GEOMETRIYA YORDAMCHILARI
   ===================================================================== */
// (nx x ny) to'rli tekis sirt; uv: u = kenglik, v = uzunlik
function makeGrid(nx, ny, ccwForXZ = false, vArr = null) {
  const n = (nx + 1) * (ny + 1)
  const uv = new Float32Array(n * 2)
  const idx = []
  for (let iy = 0; iy <= ny; iy++) {
    for (let ix = 0; ix <= nx; ix++) {
      const k = iy * (nx + 1) + ix
      uv[k * 2] = ix / nx
      uv[k * 2 + 1] = vArr ? vArr[iy] : iy / ny
    }
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iy * (nx + 1) + ix,
        b = a + 1,
        c = a + (nx + 1),
        d = c + 1
      if (ccwForXZ) idx.push(a, c, b, b, c, d)
      else idx.push(a, b, c, b, d, c)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(n * 3), 3)
  )
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  return geo
}

/* ------------------------- GULBARG -------------------------
   Mahalliy koordinata: x = kenglik, y = uzunlik (asosdan uchiga),
   z = tashqariga. Gulbarg o'qni "o'rab" turadi (cup), uchi esa
   ochilganda orqaga o'raladi (curl) va to'lqinsimon tebranadi (ruffle). */
const PNX = 32,
  PNY = 42
// uchi (v=1) atrofida to'r zichroq bo'lsin: chet silliq chiqadi
const PV = Array.from(
  { length: PNY + 1 },
  (_, i) => 1 - Math.pow(1 - i / PNY, 1.8)
)

function shapePetal(geo, p) {
  const pos = geo.attributes.position.array
  const rollL = p.rollL || 0,
    rollR = p.rollR || 0,
    notch = p.notch ?? 0.035,
    twist = p.twist || 0,
    ph = p.phase,
    ph2 = p.phase2 ?? p.phase * 1.7
  for (let iy = 0; iy <= PNY; iy++) {
    const v = PV[iy]
    // kontur: tubi tor "tirnoq", yuqori qismida eng keng, uchi keng va yumaloq
    const grow = Math.pow(smooth(0, 0.68, v), 0.75)
    const cap = v > 0.68 ? Math.sqrt(Math.max(0, 1 - Math.pow((v - 0.68) / 0.32, 2))) : 1
    let hw = p.W * (0.14 + 0.86 * grow) * (0.08 + 0.92 * cap)
    // har bir gulbarg chetining o'ziga xos notekisligi
    hw *= 1 + 0.05 * Math.sin(v * 7 + ph) + 0.03 * Math.sin(v * 15 + ph2)
    const top = smooth(0.7, 1, v)
    const upper = smooth(0.32, 1, v)
    for (let ix = 0; ix <= PNX; ix++) {
      const u = (ix / PNX) * 2 - 1,
        au = Math.abs(u)
      // chetlar orqaga qayriladi (atirgulga xos "o'tkir uchli" ko'rinish), chap va o'ng har xil
      const roll = (u < 0 ? rollL : rollR) * upper * Math.pow(au, 3.2)
      const xx = u * hw * (1 - 0.08 * Math.min(1, roll))
      const x = xx + p.shear * v * v * p.W
      // uchining o'rtasida ozgina botiqlik (yurak shakli)
      const y = v * p.h - notch * p.h * Math.pow(1 - au, 6) * top
      let z = -p.cup * xx * xx // chetlari o'qqa qarab egiladi
      z += p.bend * p.h * v * v // uzunasiga egilish
      z += p.curl * p.h * 0.45 * top * top // uchi orqaga o'raladi
      z += p.curl * 0.3 * p.h * Math.pow(au, 3) * top // burchaklari ham
      z += roll * p.h * 0.24
      z += twist * u * v * v * p.h * 0.12 // ozgina buralish
      const wav =
        Math.sin(u * 4.2 + ph) + 0.45 * Math.sin(u * 9.1 + ph2) + 0.3 * Math.sin(v * 10 + u * 3 + ph)
      z += p.ruffle * top * 0.05 * p.h * wav * (0.4 + 0.6 * au)
      z += 0.004 * p.h * Math.sin(u * 28 + ph2) * smooth(0.15, 0.9, v) // mayda uzunasiga burmalar
      const k = (iy * (PNX + 1) + ix) * 3
      pos[k] = x
      pos[k + 1] = y
      pos[k + 2] = z
    }
  }
  geo.attributes.position.needsUpdate = true
  geo.computeVertexNormals()
}

/* ------------------------- BARG / KOSACHA BARGI -------------------------
   Mahalliy koordinata: x = kenglik, z = uzunlik, y = tepaga. */
function makeBlade({
  L,
  W,
  nx = 10,
  ny = 24,
  serr = 0,
  teeth = 12,
  fold = 0.35,
  droop = 0.25,
  corr = 0.012,
  basePow = 0.78,
  tipPow = 0.85,
}) {
  const geo = makeGrid(nx, ny, true)
  const pos = geo.attributes.position.array
  for (let iy = 0; iy <= ny; iy++) {
    const v = iy / ny
    let hw =
      W *
      Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(v, basePow))), tipPow)
    if (serr > 0) hw *= 1 + serr * (((v * teeth) % 1) - 0.5) // arra tishlar
    for (let ix = 0; ix <= nx; ix++) {
      const u = (ix / nx) * 2 - 1
      const x = u * hw
      const z = v * L
      let y = fold * Math.abs(x) - droop * L * v * v * 0.5
      y +=
        corr *
        Math.sin(v * L * 16 - Math.abs(x) * 10) *
        smooth(0.05, 0.3, Math.abs(u)) // tomirlar o'yig'i
      const k = (iy * (nx + 1) + ix) * 3
      pos[k] = x
      pos[k + 1] = y
      pos[k + 2] = z
    }
  }
  geo.computeVertexNormals()
  return geo
}

/* ------------------------- POYA (silindrsimon, egri) ------------------------- */
function makeTube(curve, segs, radial, radiusFn, colorFn) {
  const frames = curve.computeFrenetFrames(segs, false)
  const pos = [],
    nor = [],
    col = [],
    idx = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const P = curve.getPoint(t)
    const N = frames.normals[i],
      B = frames.binormals[i]
    const rad = radiusFn(t),
      c = colorFn(t)
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2,
        cx = Math.cos(a),
        sy = Math.sin(a)
      const nx = N.x * cx + B.x * sy,
        ny = N.y * cx + B.y * sy,
        nz = N.z * cx + B.z * sy
      pos.push(P.x + nx * rad, P.y + ny * rad, P.z + nz * rad)
      nor.push(nx, ny, nz)
      col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j,
        b = a + radial + 1
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.setIndex(idx)
  return geo
}

/* =====================================================================
   O'SIMLIK: poya va barglar (tikansiz)
   ===================================================================== */
// Aylanuvchi tagkursi: foydalanuvchi sichqoncha / barmoq bilan gulni aylantiradi
const turntable = new THREE.Group()
turntable.position.y = 0.2 // gul boshiga yaqin nuqta atrofida egiladi
scene.add(turntable)
const plant = new THREE.Group() // pastki uchi (0,0,0), balandligi ~5.2
plant.position.y = -4.7 - turntable.position.y
turntable.add(plant)

const stemCurve = new THREE.CatmullRomCurve3(
  [
    // uzun, deyarli tik poya (namunadagidek)
    new THREE.Vector3(0.0, 0.0, 0.0),
    new THREE.Vector3(-0.05, 1.4, 0.02),
    new THREE.Vector3(0.04, 2.9, -0.02),
    new THREE.Vector3(0.0, 4.2, 0.05),
    new THREE.Vector3(0.03, 5.2, 0.14),
  ],
  false,
  'centripetal'
)

const cLow = new THREE.Color(0x4d5520), // pastda zaytun-jigarrang
  cHigh = new THREE.Color(0x6d9733) // yuqorida och yashil
const stem = new THREE.Mesh(
  makeTube(
    stemCurve,
    90,
    14,
    (t) => 0.078 - 0.026 * t + 0.003 * Math.sin(t * 38),
    (t) => cLow.clone().lerp(cHigh, smooth(0.05, 0.85, t))
  ),
  stemMat
)
stem.castShadow = true
plant.add(stem)

// Murakkab barglar: petiole + 3 ta tishli bargcha
function makeLeaf(azimuth, stemT, scale, pitch, delay, five = false) {
  const group = new THREE.Group()
  group.rotation.order = 'YXZ'
  group.position.copy(stemCurve.getPoint(stemT))
  group.rotation.y = azimuth

  const Lp = 1.25
  const pet = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.1, Lp * 0.5),
    new THREE.Vector3(0, 0.04, Lp),
  ])
  const petiole = new THREE.Mesh(
    new THREE.TubeGeometry(pet, 14, 0.02, 6, false),
    sepalMat
  )
  group.add(petiole)

  const mkLeaflet = (L, W) => {
    const m = new THREE.Mesh(
      makeBlade({
        L,
        W,
        nx: 12,
        ny: 48,
        serr: 0.1,
        teeth: 13,
        fold: 0.3,
        droop: 0.3,
        corr: 0.014,
      }),
      leafMat
    )
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  const terminal = mkLeaflet(1.25, 0.5)
  terminal.position.copy(pet.getPoint(1.0))
  group.add(terminal)

  const sides = []
  const pairs = five ? [[0.5, 0.95, 0.4], [0.18, 0.7, 0.3]] : [[0.5, 0.95, 0.4]]
  for (const [pt, L, W] of pairs) for (const s of [1, -1]) {
    const pivot = new THREE.Group()
    pivot.position.copy(pet.getPoint(pt))
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.016, 0.22, 5),
      sepalMat
    )
    stalk.rotation.x = Math.PI / 2
    stalk.position.z = 0.11
    pivot.add(stalk)
    const lf = mkLeaflet(L, W)
    lf.position.z = 0.2
    pivot.add(lf)
    group.add(pivot)
    sides.push({ pivot, s })
  }
  plant.add(group)
  return { group, sides, terminal, scale, pitch, delay, azimuth }
}

const leaves = [
  // navbatma-navbat chap/o'ng, yuqoriga qarab kichrayadi (namunadagidek)
  makeLeaf(1.35, 0.2, 0.85, -0.3, T.leafDelays[0], true),
  makeLeaf(-1.25, 0.33, 0.85, -0.3, T.leafDelays[1], true),
  makeLeaf(2.0, 0.46, 0.78, -0.35, T.leafDelays[2], true),
  makeLeaf(-1.95, 0.58, 0.72, -0.38, T.leafDelays[3]),
  makeLeaf(0.85, 0.69, 0.62, -0.42, T.leafDelays[4]),
]
leaves.forEach((l) => {
  l.group.visible = false
})

/* =====================================================================
   GUL BOSHI: kosacha, kurtak, gulbarglar
   ===================================================================== */
const head = new THREE.Group() // poyaning uchida, poya yo'nalishida
head.position.copy(stemCurve.getPoint(1))
head.quaternion.setFromUnitVectors(
  new THREE.Vector3(0, 1, 0),
  stemCurve.getTangent(1).normalize()
)
plant.add(head)

const rose = new THREE.Group() // gulni kameraga qarab biroz engashtiramiz
rose.rotation.x = 0.1
head.add(rose)

// Poya uchidagi shishgan "hip"
const hip = new THREE.Mesh(
  new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.001, -0.16),
      new THREE.Vector2(0.13, -0.13),
      new THREE.Vector2(0.25, 0.0),
      new THREE.Vector2(0.28, 0.1),
      new THREE.Vector2(0.21, 0.22),
      new THREE.Vector2(0.1, 0.3),
      new THREE.Vector2(0.001, 0.33),
    ],
    20
  ),
  hipMat
)
hip.castShadow = true
rose.add(hip)

// 5 ta uchli kosacha bargi (sepal); ochilganda pastga qayriladi
const sepals = []
for (let k = 0; k < 5; k++) {
  const az = (k / 5) * Math.PI * 2 + rr(-0.15, 0.15)
  const az_g = new THREE.Group()
  az_g.rotation.y = az
  const pivot = new THREE.Group()
  pivot.position.set(0, 0.1, 0.2)
  const blade = new THREE.Mesh(
    makeBlade({
      L: rr(0.85, 1.05), // ingichka, uzun kosacha barglari (namunadagidek)
      W: 0.075,
      nx: 6,
      ny: 22,
      fold: 0.55,
      droop: -0.2,
      corr: 0.006,
      basePow: 0.55,
      tipPow: 0.95,
    }),
    sepalMat
  )
  blade.castShadow = true
  pivot.add(blade)
  az_g.add(pivot)
  rose.add(az_g)
  sepals.push({ pivot })
}

// Gulbarglar
const PNUM = CONFIG.petals
const petals = []
for (let i = 0; i < PNUM; i++) {
  const s = i / (PNUM - 1) // 0 = eng ichki, 1 = eng tashqi
  const p = {
    s,
    W: (0.3 + 0.5 * s) * rr(0.95, 1.08),
    h: (0.85 + 0.45 * s) * rr(0.94, 1.06),
    az: i * 2.39996 + rr(-0.12, 0.12), // oltin burchak (137.5°) = spiral
    y0: 0.3 * Math.pow(1 - s, 0.8),
    r0: 0.04 + 0.34 * s,
    r1: 0.05 + 0.3 * s, // o'qdan masofa: yopiq / ochiq
    th0: deg(2 + 5 * s),
    th1: deg(3 + 26 * Math.pow(s, 1.6)), // egilish burchagi: qadahsimon, yassi emas
    tip0: 0.03 + 0.12 * s,
    tip1: 0.04 + 0.64 * Math.pow(s, 1.3), // uchining o'qdan masofasi
    curl1: 0.42 * Math.pow(s, 1.5) * rr(0.8, 1.2), // faqat chekkasi tashqariga qayriladi
    ruffle1: (0.4 + 0.8 * s) * rr(0.7, 1.3),
    shear: rr(-0.18, 0.18),
    phase: rr(0, 6.28),
    roll: rr(-0.08, 0.08),
    // chetlarning qayrilishi: o'rta qatlamlarda kuchli, eng tashqisida yengil (orasida tirqish qolmasin)
    rollL1: (0.08 + 0.7 * Math.pow(s, 1.3)) * rr(0.6, 1.3),
    rollR1: (0.08 + 0.7 * Math.pow(s, 1.3)) * rr(0.6, 1.3),
    notch: rr(0.015, 0.06),
    twist: rr(-0.5, 0.5),
    phase2: rr(0, 6.28),
    delay: (1 - s) * 0.5,
    dur: 0.5, // tashqi gulbarglar birinchi ochiladi
    lastE: -1,
  }
  p.cup0 = Math.min(2.4, Math.max(0.9, 0.55 / (p.r0 + 0.1)))
  p.cup1 = lerp(2.4, 1.1, Math.pow(s, 0.8)) // gulbarglar o'ralib turadi

  p.geo = makeGrid(PNX, PNY, false, PV)
  // qatlam tusi: ichkarisi to'qroq
  const tint = 0.6 + 0.4 * s,
    n = (PNX + 1) * (PNY + 1),
    cols = new Float32Array(n * 3)
  for (let q = 0; q < n; q++) {
    // soya (ambient occlusion): gulbarg tubi qo'shnilari ostida qoladi
    const v = PV[Math.floor(q / (PNX + 1))]
    const ao = 0.28 + 0.72 * smooth(0.0, 0.7, v)
    cols[q * 3] = tint * ao
    cols[q * 3 + 1] = tint * ao
    cols[q * 3 + 2] = tint * ao
  }
  p.geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))

  p.azG = new THREE.Group()
  p.azG.rotation.y = p.az
  p.pivot = new THREE.Group()
  p.pivot.rotation.y = p.roll
  p.mesh = new THREE.Mesh(p.geo, petalMat)
  p.mesh.castShadow = true
  p.mesh.receiveShadow = true
  p.pivot.add(p.mesh)
  p.azG.add(p.pivot)
  rose.add(p.azG)
  petals.push(p)
}

// e (0..1) = bu gulbargning ochilish darajasi
// Shudring tomchilari: tashqi gulbarglar ustida, gulbarg egilishiga ergashadi
const dropGeo = new THREE.SphereGeometry(1, 24, 16)
const dropMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.03,
  transmission: 1,
  thickness: 0.08,
  ior: 1.33,
  envMapIntensity: 3,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  specularIntensity: 1,
})
const glintGeo = new THREE.SphereGeometry(1, 10, 8)
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
const _dn = new THREE.Vector3(), _up0 = new THREE.Vector3(0, 1, 0)
function updateDrops(p, e) {
  if (!p.drops) return
  const pos = p.geo.attributes.position.array,
    nor = p.geo.attributes.normal.array
  const k = smooth(0.55, 1, e)
  for (const d of p.drops) {
    const i = d.idx * 3
    _dn.set(nor[i], nor[i + 1], nor[i + 2]).normalize()
    if (_dn.z > 0) _dn.negate() // gulbargning ichki (bizga ko'rinadigan) tomoni
    d.m.position.set(pos[i], pos[i + 1], pos[i + 2]).addScaledVector(_dn, d.r * 0.45 * k)
    d.m.quaternion.setFromUnitVectors(_up0, _dn)
    d.m.scale.set(d.r * k + 1e-4, d.r * 0.58 * k + 1e-4, d.r * k + 1e-4)
    d.m.visible = k > 0.01
  }
}

const DBG_ROLL = parseFloat(new URLSearchParams(location.search).get('roll') ?? '1')
const DBG_TW = parseFloat(new URLSearchParams(location.search).get('tw') ?? '1')
function applyPetal(p, e) {
  const r = lerp(p.r0, p.r1, e)
  const th = lerp(p.th0, p.th1, e)
  const tip = lerp(p.tip0, p.tip1, e)
  // uchi kerakli masofada tursin deb egilishni hisoblaymiz
  let bend = (tip - r - p.h * Math.sin(th)) / (p.h * Math.cos(th))
  bend = Math.max(-1.2, Math.min(0.8, bend))
  p.pivot.position.set(0, p.y0, r)
  p.pivot.rotation.set(th, p.roll, 0)
  shapePetal(p.geo, {
    W: p.W,
    h: p.h,
    cup: lerp(p.cup0, p.cup1, e),
    bend,
    curl: p.curl1 * smooth(0.35, 1, e),
    ruffle: p.ruffle1 * smooth(0.3, 1, e),
    shear: p.shear,
    phase: p.phase,
    phase2: p.phase2,
    rollL: DBG_ROLL * p.rollL1 * smooth(0.25, 1, e),
    rollR: DBG_ROLL * p.rollR1 * smooth(0.25, 1, e),
    notch: p.notch,
    twist: DBG_TW * p.twist * e,
  })
  updateDrops(p, e)
}
{
  const drand = mulberry32(77)
  petals.forEach((p) => {
    if (p.s < 0.42) return
    const cnt = drand() < 0.35 ? 0 : drand() < 0.7 ? 1 : 2
    for (let k = 0; k < cnt; k++) {
      const ix = Math.round((0.28 + drand() * 0.44) * PNX)
      const iy = Math.round((0.38 + drand() * 0.4) * PNY)
      const r = 0.026 + drand() * 0.03
      const m = new THREE.Mesh(dropGeo, dropMat)
      const gl = new THREE.Mesh(glintGeo, glintMat)
      gl.scale.setScalar(0.2)
      gl.position.set(0.32, 0.72, 0.3)
      m.add(gl)
      p.mesh.add(m)
      ;(p.drops ||= []).push({ m, idx: iy * (PNX + 1) + ix, r })
    }
  })
}
petals.forEach((p) => {
  applyPetal(p, 0)
  p.lastE = 0
})

// Gul ichidagi qizil yorug'lik
const heartLight = new THREE.PointLight(0xff2a45, 0, 3.4, 2)
heartLight.position.set(0, 0.55, 0)
rose.add(heartLight)

head.visible = false

/* =====================================================================
   TUSHUVCHI GULBARGLAR
   ===================================================================== */
const fallGeo = makeGrid(PNX, PNY, false, PV)
shapePetal(fallGeo, {
  W: 0.17,
  h: 0.28,
  cup: 1.2,
  bend: 0.25,
  curl: 0.4,
  ruffle: 0.3,
  shear: 0,
  phase: 1,
})
{
  const n = (PNX + 1) * (PNY + 1),
    cols = new Float32Array(n * 3).fill(0.9)
  fallGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
}
const falling = []
function spawnFall() {
  const m = new THREE.Mesh(fallGeo, petalMat)
  const a = Math.random() * Math.PI * 2,
    d = Math.random() * 0.9
  m.position.set(
    Math.cos(a) * d,
    0.6 + Math.random() * 0.5,
    0.45 + Math.sin(a) * d * 0.7
  )
  m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
  scene.add(m)
  falling.push({
    m,
    age: 0,
    life: 6 + Math.random() * 3,
    vy: 0.38 + Math.random() * 0.25,
    sway: 0.25 + Math.random() * 0.35,
    ph: Math.random() * 6,
    spin: new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).multiplyScalar(2.2),
    x0: m.position.x,
    z0: m.position.z,
  })
}
let fallTimer = 0

/* =====================================================================
   YULDUZCHALAR (miltillovchi mayda nuqtalar)
   ===================================================================== */
let sparkMat = null
if (CONFIG.sparkles > 0) {
  const N = CONFIG.sparkles
  const pos = new Float32Array(N * 3),
    ph = new Float32Array(N),
    sz = new Float32Array(N),
    sp = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2,
      b = Math.acos(2 * Math.random() - 1),
      d = Math.cbrt(Math.random())
    pos[i * 3] = Math.sin(b) * Math.cos(a) * d * 2.7
    pos[i * 3 + 1] = 0.9 + Math.cos(b) * d * 1.9
    pos[i * 3 + 2] = 0.3 + Math.sin(b) * Math.sin(a) * d * 1.8
    ph[i] = Math.random() * 6.28
    sz[i] = 0.13 + Math.random() * 0.26
    sp[i] = 1.6 + Math.random() * 3.2
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
  g.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1))
  sparkMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uAppear: { value: 0 },
      uPx: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute float aPhase; attribute float aSize; attribute float aSpeed;
      uniform float uTime; uniform float uAppear; uniform float uPx;
      varying float vA;
      void main() {
        float tw = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
        tw = pow(tw, 3.0);
        vA = tw * uAppear;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPx * (220.0 / -mv.z) * (0.45 + tw);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float glow = pow(smoothstep(0.5, 0.0, d), 2.2);
        float star = max(0.0, 1.0 - abs(c.x) * 9.0) * max(0.0, 1.0 - abs(c.y) * 2.2)
                   + max(0.0, 1.0 - abs(c.y) * 9.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
        float a = (glow + star * 0.55) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.82, 0.88) * a, a);
      }`,
  })
  const pts = new THREE.Points(g, sparkMat)
  pts.frustumCulled = false
  scene.add(pts)
}

/* =====================================================================
   QO'NG'IZCHA: gul ichidan chiqadi, aylanadi, izi bilan tabrik yozadi,
   keyin bargga qo'nadi
   ===================================================================== */
const BT = { emerge: 1.8, orbit: 11, land: 4.2, fps: 60 }
const GREETING = ['Happy', 'Birthday'] // ENG tilida tabrik
const TEXT_W = 5.4 // yozuvning maksimal kengligi (dunyo birligida)
const TEXT_CENTER = new THREE.Vector3(0, 3.2, 0.4)

/* ---------- matnni "bir chiziqli" yo'llarga aylantirish (skelet) ---------- */
function thinImage(bw, W, H) {
  const del = []
  let changed = true
  while (changed) {
    changed = false
    for (let step = 0; step < 2; step++) {
      del.length = 0
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x
          if (!bw[i]) continue
          const p2 = bw[i - W], p3 = bw[i - W + 1], p4 = bw[i + 1], p5 = bw[i + W + 1]
          const p6 = bw[i + W], p7 = bw[i + W - 1], p8 = bw[i - 1], p9 = bw[i - W - 1]
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const A =
            (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
            (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2)
          if (A !== 1) continue
          if (step === 0) {
            if (p2 * p4 * p6 || p4 * p6 * p8) continue
          } else if (p2 * p4 * p8 || p2 * p6 * p8) continue
          del.push(i)
        }
      }
      if (del.length) {
        changed = true
        for (const i of del) bw[i] = 0
      }
    }
  }
}

const NB8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]

function buildTextStrokes(lines) {
  const FS = 170, LH = 185, PAD = 28
  const fam = '"Great Vibes", "Playfair Display", cursive'
  const c = document.createElement('canvas')
  const g = c.getContext('2d', { willReadFrequently: true })
  g.font = `${FS}px ${fam}`
  const maxW = Math.max(...lines.map((l) => g.measureText(l).width))
  const W = Math.ceil(maxW + PAD * 2 + 40)
  const H = Math.ceil(LH * lines.length + PAD * 2 + 60)
  c.width = W
  c.height = H
  g.font = `${FS}px ${fam}`
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  const base0 = PAD + FS * 0.82
  lines.forEach((l, i) => g.fillText(l, W / 2, base0 + i * LH))

  const img = g.getImageData(0, 0, W, H).data
  const bw = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) bw[i] = img[i * 4 + 3] > 120 ? 1 : 0
  thinImage(bw, W, H)

  // skelet piksellarini yo'llarga ajratish
  const vis = new Uint8Array(W * H)
  const nbrCount = (i) => {
    const x = i % W, y = (i / W) | 0
    let n = 0
    for (const [ox, oy] of NB8) {
      const nx = x + ox, ny = y + oy
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && bw[ny * W + nx]) n++
    }
    return n
  }
  const touchesVisited = (i) => {
    const x = i % W, y = (i / W) | 0
    for (const [ox, oy] of NB8) {
      const nx = x + ox, ny = y + oy
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && vis[ny * W + nx]) return true
    }
    return false
  }
  const walk = (s) => {
    const path = [s]
    vis[s] = 1
    let cur = s
    for (;;) {
      const x = cur % W, y = (cur / W) | 0
      const ref = path[Math.max(0, path.length - 6)]
      const dx0 = x - (ref % W), dy0 = y - ((ref / W) | 0)
      const dl = Math.hypot(dx0, dy0) || 1
      let best = -1, bs = -9
      for (const [ox, oy] of NB8) {
        const nx = x + ox, ny = y + oy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const j = ny * W + nx
        if (!bw[j] || vis[j]) continue
        const sc = (ox * dx0 + oy * dy0) / (dl * Math.hypot(ox, oy)) - (ox && oy ? 0.05 : 0)
        if (sc > bs) { bs = sc; best = j }
      }
      if (best < 0) break
      vis[best] = 1
      path.push(best)
      cur = best
    }
    return path
  }
  const ends = [], rest = []
  for (let i = 0; i < W * H; i++) {
    if (!bw[i]) continue
    ;(nbrCount(i) === 1 ? ends : rest).push(i)
  }
  const byX = (a, b) => (a % W) - (b % W)
  ends.sort(byX)
  rest.sort(byX)
  const raw = []
  for (const s of ends) if (!vis[s]) raw.push({ idx: walk(s), att: false })
  for (const s of rest) if (!vis[s]) {
    const att = touchesVisited(s)
    raw.push({ idx: walk(s), att })
  }
  // kichik shoxchalarni olib tashlash, silliqlash
  const strokes = []
  for (const r of raw) {
    if (r.att && r.idx.length < 14) continue
    let pts = r.idx.map((i) => [i % W, (i / W) | 0])
    for (let pass = 0; pass < 2 && pts.length > 8; pass++) {
      pts = pts.map((p, k) => {
        if (k === 0 || k === pts.length - 1) return p
        let sx = 0, sy = 0, n = 0
        for (let d = -3; d <= 3; d++) {
          const q = pts[Math.min(pts.length - 1, Math.max(0, k + d))]
          sx += q[0]; sy += q[1]; n++
        }
        return [sx / n, sy / n]
      })
    }
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length
    const line = Math.min(lines.length - 1, Math.max(0, Math.floor((cy - (base0 - LH / 2)) / LH)))
    strokes.push({ pts, line })
  }
  // mayda "kir" nuqtalarni tashlab yuboramiz; faqat yolg'iz nuqta (masalan "i" nuqtasi) qoladi
  {
    const big = strokes.filter((s) => s.pts.length >= 8)
    for (let k = strokes.length - 1; k >= 0; k--) {
      const s = strokes[k]
      if (s.pts.length >= 8) continue
      const [px, py] = s.pts[0]
      const near = big.some((b) => b.pts.some(([x, y]) => Math.hypot(x - px, y - py) < 18))
      if (near) strokes.splice(k, 1)
    }
  }
  // yozish tartibi: qatorma-qator, chapdan o'ngga, eng yaqin boshlanishga
  const ordered = []
  for (let li = 0; li < lines.length; li++) {
    const rem = strokes.filter((s) => s.line === li)
    let pen = null
    while (rem.length) {
      let bi = -1, br = false, bc = Infinity
      rem.forEach((s, k) => {
        for (const rev of [false, true]) {
          const p = rev ? s.pts[s.pts.length - 1] : s.pts[0]
          const cost = pen
            ? Math.hypot(p[0] - pen[0], p[1] - pen[1]) + 0.4 * Math.max(0, pen[0] - p[0] - 15)
            : p[0]
          if (cost < bc) { bc = cost; bi = k; br = rev }
        }
      })
      const s = rem.splice(bi, 1)[0]
      if (br) s.pts.reverse()
      ordered.push(s.pts)
      pen = s.pts[s.pts.length - 1]
    }
  }
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
  ordered.forEach((pts) => pts.forEach(([x, y]) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }))
  return { strokes: ordered, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }
}

let textData = null
{
  const ready = document.fonts && document.fonts.load
    ? document.fonts.load('170px "Great Vibes"', 'Happy Birthday')
    : Promise.resolve()
  Promise.resolve(ready)
    .catch(() => {})
    .then(() =>
      setTimeout(() => {
        try { textData = buildTextStrokes(GREETING) } catch (e) { console.warn(e) }
      }, 60)
    )
}

/* ---------- qo'ng'izcha modeli ---------- */
const beetle = new THREE.Group()
beetle.visible = false
scene.add(beetle)

const shellMat = new THREE.MeshStandardMaterial({
  color: 0xffc43d, emissive: 0xff9a10, emissiveIntensity: 0.8,
  roughness: 0.28, metalness: 0.5, side: THREE.DoubleSide,
})
const darkMat = new THREE.MeshStandardMaterial({
  color: 0x4a2a10, emissive: 0x8a4a10, emissiveIntensity: 0.35, roughness: 0.45,
})
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.12, metalness: 0.2 })
const whiteBasic = new THREE.MeshBasicMaterial({ color: 0xffffff })
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 })

const rig = new THREE.Group()
beetle.add(rig)
const ell = (r, sx, sy, sz, mat, x, y, z) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat)
  m.scale.set(sx, sy, sz)
  m.position.set(x, y, z)
  rig.add(m)
  return m
}
ell(1, 0.12, 0.085, 0.16, darkMat, 0, -0.005, 0.0) // tana
const headMesh = ell(1, 0.085, 0.07, 0.078, darkMat, 0, 0.0, 0.185) // bosh
ell(1, 0.105, 0.06, 0.06, shellMat, 0, 0.035, 0.115) // "yoqa"
const eyes = []
for (const s of [1, -1]) {
  const eye = ell(0.03, 1, 1, 1, eyeMat, s * 0.05, 0.025, 0.232)
  const hl = ell(0.009, 1, 1, 1, whiteBasic, s * 0.043, 0.042, 0.254)
  eyes.push({ eye, hl, s })
}
// mo'ylovlar
const antennae = []
for (const s of [1, -1]) {
  const piv = new THREE.Group()
  piv.position.set(s * 0.03, 0.05, 0.24)
  const crv = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(s * 0.03, 0.06, 0.05),
    new THREE.Vector3(s * 0.07, 0.11, 0.1),
  ])
  piv.add(new THREE.Mesh(new THREE.TubeGeometry(crv, 10, 0.006, 5, false), darkMat))
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), bulbMat)
  bulb.position.copy(crv.getPoint(1))
  piv.add(bulb)
  rig.add(piv)
  antennae.push({ piv, s })
}
// oyoqchalar
const legs = []
for (const s of [1, -1]) {
  for (const z of [0.07, 0, -0.08]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.13, 5), darkMat)
    leg.position.set(s * 0.115, -0.07, z)
    leg.rotation.z = s * 0.7
    rig.add(leg)
    legs.push(leg)
  }
}
// qattiq qanotlar (elytra): ochilib yopiladi, ustida nuqtalar
const elytra = []
for (const s of [1, -1]) {
  const piv = new THREE.Group()
  piv.position.set(0, 0.085, -0.06)
  const a = 0.14, b = 0.105, cz = 0.2
  const geo = new THREE.SphereGeometry(1, 24, 14, s > 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI, 0, Math.PI / 2)
  const shell = new THREE.Mesh(geo, shellMat)
  shell.scale.set(a, b, cz)
  shell.position.set(0, -0.065, 0)
  piv.add(shell)
  for (const [fx, fz] of [[0.45, -0.45], [0.6, 0.1], [0.4, 0.55]]) {
    const x = fx * a, z = fz * cz
    const y = b * Math.sqrt(Math.max(0, 1 - fx * fx - fz * fz)) - 0.065
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), darkMat)
    sp.scale.set(1, 0.35, 1)
    sp.position.set(s * x, y, z)
    piv.add(sp)
  }
  rig.add(piv)
  elytra.push({ piv, s })
}
// yupqa shaffof qanotlar
const wings = []
const wingMat = new THREE.MeshBasicMaterial({
  color: 0xfff0c4, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending, depthWrite: false,
})
for (const s of [1, -1]) {
  const piv = new THREE.Group()
  piv.position.set(s * 0.04, 0.075, -0.02)
  const w = new THREE.Mesh(new THREE.CircleGeometry(1, 24), wingMat)
  w.rotation.x = -Math.PI / 2
  w.scale.set(0.16, 0.07, 1)
  w.position.set(s * 0.15, 0, -0.04)
  piv.add(w)
  rig.add(piv)
  wings.push({ piv, s })
}
// yorug'lik gardishi va nur
const haloTex = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  gr.addColorStop(0, 'rgba(255,236,170,0.95)')
  gr.addColorStop(0.25, 'rgba(255,190,80,0.45)')
  gr.addColorStop(0.6, 'rgba(255,140,40,0.12)')
  gr.addColorStop(1, 'rgba(255,120,30,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
})()
const halo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false,
    transparent: true, toneMapped: false,
  })
)
halo.position.set(0, 0.04, 0.02)
beetle.add(halo)
const beetleLight = new THREE.PointLight(0xffb347, 0, 3.8, 2)
beetleLight.position.set(0, 0.12, 0.1)
beetle.add(beetleLight)

/* ---------- bosh (alohida bo'g'in) va yuz ifodalari ---------- */
// bosh bo'ynidan chayqaladi: aylanayotganda boshi aylanadi, kulganda/jahl qilganda qimirlaydi
const NECK = new THREE.Vector3(0, 0.005, 0.14)
const headG = new THREE.Group()
headG.position.copy(NECK)
rig.add(headG)
headG.attach(headMesh)
eyes.forEach(({ eye, hl }) => {
  headG.attach(eye)
  headG.attach(hl)
})
antennae.forEach(({ piv }) => headG.attach(piv))

// bosh ellipsoidi va ko'zlar sirtining z koordinatasi (rig koordinatalarida)
const headSurfZ = (x, y) =>
  0.185 + 0.078 * Math.sqrt(Math.max(0, 1 - (x / 0.085) ** 2 - (y / 0.07) ** 2))
function faceZ(x, y, overEyes) {
  let z = headSurfZ(x, y)
  if (overEyes)
    for (const s of [1, -1]) {
      const k = 0.03 ** 2 - (x - s * 0.05) ** 2 - (y - 0.025) ** 2
      if (k > 0) z = Math.max(z, 0.232 + Math.sqrt(k))
    }
  return z
}
const toHead = (x, y, z) => new THREE.Vector3(x - NECK.x, y - NECK.y, z - NECK.z)
// geometriyani o'z markaziga ko'chiramiz (shunda scale markazdan ishlaydi)
function centered(geo, mat) {
  geo.computeBoundingBox()
  const c = geo.boundingBox.getCenter(new THREE.Vector3())
  geo.translate(-c.x, -c.y, -c.z)
  const m = new THREE.Mesh(geo, mat)
  m.position.copy(c)
  headG.add(m)
  return m
}
function faceTube(pts2, r, mat, overEyes = false, lift = 0.003) {
  const pts = pts2.map(([x, y]) => toHead(x, y, faceZ(x, y, overEyes) + lift))
  return centered(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, r, 7, false), mat)
}
// yuz sirtiga yopishgan to'r (tekis uchburchaklar boshning ichiga botib ketmasin)
function faceGrid(fn, nu, nv, mat, lift) {
  const pos = [],
    idx = []
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const [x, y] = fn(i / nu, j / nv)
      const v = toHead(x, y, faceZ(x, y, false) + lift)
      pos.push(v.x, v.y, v.z)
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i,
        b = a + 1,
        c = a + nu + 1,
        d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return centered(g, mat)
}
const inkMat = new THREE.MeshBasicMaterial({ color: 0x140405, side: THREE.DoubleSide })
const mouthMat = new THREE.MeshBasicMaterial({ color: 0x4a0a16, side: THREE.DoubleSide })
const tongueMat = new THREE.MeshBasicMaterial({ color: 0xff7193, side: THREE.DoubleSide })
const arc = (n, fn) => Array.from({ length: n }, (_, i) => fn(-1 + (2 * i) / (n - 1)))

// oddiy holat: kichik tabassum
const mouthNeutral = faceTube(arc(7, (u) => [u * 0.02, -0.03 + 0.006 * u * u]), 0.0032, inkMat)
// kulgi: ochiq og'iz + til
const mouthOpen = (() => {
  const W = 0.031
  const m = faceGrid(
    (u, v) => {
      const x = (u * 2 - 1) * W,
        q = 1 - (x / W) ** 2
      const top = -0.022 - 0.004 * q
      const bot = -0.022 - 0.032 * Math.pow(q, 0.8)
      return [x, lerp(top, bot, v)]
    },
    24, 10, mouthMat, 0.003
  )
  const tongue = faceGrid(
    (u, v) => {
      const a = u * Math.PI * 2
      return [0.015 * v * Math.cos(a), -0.042 + 0.007 * v * Math.sin(a)]
    },
    24, 4, tongueMat, 0.0045
  )
  headG.remove(tongue)
  tongue.position.sub(m.position)
  m.add(tongue)
  return m
})()
// jahl: burchaklari pastga qaragan lab
const mouthFrown = faceTube(arc(7, (u) => [u * 0.019, -0.027 - 0.009 * u * u + 0.0015 * Math.sin(u * 9)]), 0.0038, inkMat)
// quvongan ko'zlar: ^ ^
const happyEyes = [1, -1].map((s) =>
  faceTube(arc(9, (u) => [s * 0.05 + u * 0.024, 0.017 + 0.017 * (1 - u * u)]), 0.0045, inkMat, false, 0.004)
)
// jahl qoshlari: ichki uchi pastda
const brows = [1, -1].map((s) =>
  faceTube([[s * 0.019, 0.049], [s * 0.045, 0.059], [s * 0.073, 0.072]], 0.0058, inkMat, true, 0.006)
)
// yonoqlar (qizarish)
const blushTex = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
})()
const cheekMat = new THREE.MeshBasicMaterial({
  map: blushTex, color: 0xff7aa2, transparent: true, opacity: 0, depthWrite: false,
})
const cheeks = [1, -1].map((s) => {
  const x = s * 0.064, y = -0.017, z = headSurfZ(x, y)
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.019, 20), cheekMat)
  m.position.copy(toHead(x, y, z + 0.002))
  const n = new THREE.Vector3(x / 0.085 ** 2, y / 0.07 ** 2, (z - 0.185) / 0.078 ** 2).normalize()
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
  headG.add(m)
  return m
})

// kichik rasm-belgilar: yurakcha, jahl belgisi, bosh aylanish yulduzchasi
function iconTex(draw) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  draw(c.getContext('2d'))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
const heartTex = iconTex((g) => {
  g.shadowColor = 'rgba(255,90,140,0.9)'
  g.shadowBlur = 18
  g.fillStyle = '#ff4f86'
  g.beginPath()
  g.moveTo(64, 104)
  g.bezierCurveTo(18, 72, 14, 30, 42, 26)
  g.bezierCurveTo(56, 24, 62, 36, 64, 44)
  g.bezierCurveTo(66, 36, 72, 24, 86, 26)
  g.bezierCurveTo(114, 30, 110, 72, 64, 104)
  g.fill()
  g.fillStyle = 'rgba(255,255,255,0.7)'
  g.beginPath()
  g.ellipse(44, 44, 9, 6, -0.6, 0, Math.PI * 2)
  g.fill()
})
const angerTex = iconTex((g) => {
  // manga uslubidagi "jahl tomiri" belgisi
  g.strokeStyle = '#ff2b3d'
  g.lineWidth = 15
  g.lineCap = 'round'
  g.shadowColor = 'rgba(255,40,60,0.8)'
  g.shadowBlur = 10
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    g.beginPath()
    const cx = 64 + sx * 46, cy = 64 + sy * 46
    const a0 = Math.atan2(-sy, -sx)
    g.arc(cx, cy, 34, a0 - 0.62, a0 + 0.62)
    g.stroke()
  }
})
const starTex = iconTex((g) => {
  g.shadowColor = 'rgba(255,220,120,0.9)'
  g.shadowBlur = 14
  g.fillStyle = '#ffe27a'
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 22 : 52, a = -Math.PI / 2 + (i * Math.PI) / 5
    g.lineTo(64 + r * Math.cos(a), 64 + r * Math.sin(a))
  }
  g.closePath()
  g.fill()
})
const iconSprite = (map) =>
  new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0 }))

const angerMark = iconSprite(angerTex)
angerMark.position.copy(toHead(0.078, 0.092, 0.225))
angerMark.visible = false
headG.add(angerMark)

const dizzyStars = [0, 1, 2].map(() => {
  const sp = iconSprite(starTex)
  sp.scale.setScalar(0.06)
  sp.visible = false
  headG.add(sp)
  return sp
})

const hearts = []
for (let i = 0; i < 7; i++) {
  const sp = iconSprite(heartTex)
  sp.visible = false
  scene.add(sp)
  hearts.push({ sp, age: 9, life: 1, v: new THREE.Vector3() })
}

// xafa qoshlar: ichki uchi tepada
const sadBrows = [1, -1].map((s) =>
  faceTube([[s * 0.019, 0.071], [s * 0.045, 0.064], [s * 0.073, 0.05]], 0.0055, inkMat, true, 0.006)
)
// ko'z yoshlari
const tearMat = new THREE.MeshBasicMaterial({
  color: 0xaee8ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
})
const tears = [1, -1].map((s, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), tearMat.clone())
  m.scale.set(0.0075, 0.011, 0.005)
  m.visible = false
  headG.add(m)
  return { m, s, ph: i * 0.5 }
})

const shellEmissive0 = shellMat.emissive.clone()
const angryEmissive = new THREE.Color(0xff2a12)
setFace(0, 0, 0, 0, 0)

// yuz ifodasini qo'llash: smile/angry 0..1, squint = ko'z yumilishi
function setFace(smile, angry, blink, t, sad = 0) {
  mouthNeutral.visible = smile < 0.35 && angry < 0.35 && sad < 0.35
  mouthOpen.visible = smile > 0.02
  mouthOpen.scale.set(0.55 + 0.45 * smile, Math.max(0.01, smile), 1)
  const happy = smile > 0.55
  happyEyes.forEach((m) => {
    m.visible = happy
    m.scale.setScalar(smooth(0.55, 0.9, smile) * 0.6 + 0.4)
  })
  const squint = Math.max(0.08, (1 - 0.32 * angry) * (1 - 0.12 * sad) * (1 - blink))
  eyes.forEach(({ eye, hl }) => {
    eye.visible = !happy
    hl.visible = !happy && squint > 0.5 && angry < 0.25
    hl.scale.setScalar(1 + 0.3 * sad) // yoshli, yaltiroq ko'zlar
    eye.scale.set(1, squint, 1)
  })
  brows.forEach((m) => {
    m.visible = angry > 0.02
    m.scale.setScalar(Math.max(0.01, angry))
  })
  mouthFrown.visible = angry > 0.35 || sad > 0.35
  mouthFrown.scale.set(1, 1 + 0.15 * sad * Math.sin(t * 11), 1) // xafa bo'lganda labi titraydi
  sadBrows.forEach((m) => {
    m.visible = sad > 0.02
    m.scale.setScalar(Math.max(0.01, sad))
  })
  for (const tr of tears) {
    tr.m.visible = sad > 0.25
    if (!tr.m.visible) continue
    const ph = (t * 0.7 + tr.ph) % 1
    const x = tr.s * lerp(0.05, 0.062, ph),
      y = lerp(-0.004, -0.056, ph * ph)
    tr.m.position.copy(toHead(x, y, faceZ(x, y, false) + 0.006))
    tr.m.material.opacity = sad * smooth(0, 0.15, ph) * (1 - smooth(0.75, 1, ph))
  }
  cheekMat.opacity = Math.max(smile * 0.7, angry * 0.85)
  cheekMat.color.setHex(angry > smile ? 0xff3b3b : 0xff7aa2)
  angerMark.visible = angry > 0.05
  angerMark.material.opacity = angry
  angerMark.scale.setScalar(0.058 * angry * (0.85 + 0.18 * Math.sin(t * 13)))
  shellMat.emissive.copy(shellEmissive0).lerp(angryEmissive, angry * 0.75)
}

/* ---------- iz (trail): yaltiroq zarrachalar ---------- */
const TRAIL_MAX = 4200
const tPos = new Float32Array(TRAIL_MAX * 3),
  tBirth = new Float32Array(TRAIL_MAX),
  tKind = new Float32Array(TRAIL_MAX),
  tSeed = new Float32Array(TRAIL_MAX),
  tTarget = new Float32Array(TRAIL_MAX * 3)
const trailGeo = new THREE.BufferGeometry()
const mkAttr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage)
trailGeo.setAttribute('position', mkAttr(tPos, 3))
trailGeo.setAttribute('aBirth', mkAttr(tBirth, 1))
trailGeo.setAttribute('aKind', mkAttr(tKind, 1))
trailGeo.setAttribute('aSeed', mkAttr(tSeed, 1))
trailGeo.setAttribute('aTarget', mkAttr(tTarget, 3))
trailGeo.setDrawRange(0, 0)
const trailMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
  vertexShader: `
    attribute float aBirth; attribute float aKind; attribute float aSeed; attribute vec3 aTarget;
    uniform float uTime; uniform float uScale;
    varying float vA; varying vec3 vC; varying float vStar;
    void main() {
      float age = max(uTime - aBirth, 0.0);
      float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 1.8) + aSeed * 50.0);
      float fresh = exp(-age * 4.0);
      float size; float a;
      vec3 pos = position;
      if (aKind < 2.0) {
        // beetle ortidagi mayin iz
        a = exp(-age * 0.9) * (0.5 + 0.5 * tw) * 0.8;
        size = 0.06 + 0.06 * exp(-age * 0.9);
        vC = vec3(1.0, 0.8, 0.42);
        vStar = 0.0;
      } else {
        // yaltiroq zarra: avval sekin tushadi, keyin yozuvdagi o'z joyiga suzib boradi
        float hold = 0.5 + aSeed * 0.7;
        float dur = 2.6 + aSeed * 1.2;
        float u = clamp((age - hold) / dur, 0.0, 1.0);
        float e = u * u * (3.0 - 2.0 * u);
        float fall = min(age, hold);
        vec3 s0 = position + vec3(sin(age * 1.6 + aSeed * 30.0) * 0.07, -0.3 * fall, 0.0);
        float arc = sin(e * 3.14159);
        pos = mix(s0, aTarget, e) + vec3((aSeed - 0.5) * 0.9 * arc, 0.25 * arc, 0.0);
        a = smoothstep(0.0, 0.2, age) * (0.5 + 0.5 * tw);
        size = 0.07 + 0.025 * tw * e;
        vC = mix(vec3(1.0, 0.8, 0.4), mix(vec3(1.0, 0.88, 0.62), vec3(1.0, 0.68, 0.8), aSeed), e);
        vStar = step(0.93, aSeed) * e;
      }
      a = (a + fresh * 0.5) * 0.75;
      vA = a;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = (size * (1.0 + fresh * 0.6) + vStar * 0.1) * uScale / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA; varying vec3 vC; varying float vStar;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      float core = pow(smoothstep(0.5, 0.0, d), 2.0);
      float star = vStar * (max(0.0, 1.0 - abs(c.x) * 10.0) * max(0.0, 1.0 - abs(c.y) * 2.4)
                          + max(0.0, 1.0 - abs(c.y) * 10.0) * max(0.0, 1.0 - abs(c.x) * 2.4));
      gl_FragColor = vec4(vC, (core + star * 0.7) * vA);
    }`,
})
const trailPts = new THREE.Points(trailGeo, trailMat)
trailPts.frustumCulled = false
scene.add(trailPts)
let trailN = 0
function emitTrail(p, kind, birth, tx) {
  if (trailN >= TRAIL_MAX) return
  const i = trailN++
  tPos[i * 3] = p.x + (Math.random() - 0.5) * 0.03
  tPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.03
  tPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.03
  tBirth[i] = birth
  tKind[i] = kind
  tSeed[i] = Math.random()
  if (tx) {
    tTarget[i * 3] = tx[0]
    tTarget[i * 3 + 1] = tx[1]
    tTarget[i * 3 + 2] = tx[2]
  }
}

/* ---------- reja: yo'l (60 Hz kalitlar), qo'nish nuqtasi ---------- */
let plan = null
const _q = new THREE.Quaternion(),
  _v1 = new THREE.Vector3(),
  _v2 = new THREE.Vector3(),
  _m = new THREE.Matrix4()
const rest = {
  pos: new THREE.Vector3(),
  q: new THREE.Quaternion(),
}
const landLeaf = leaves[1]

function frameQuat(f, up, out) {
  const x = _v1.copy(up).cross(f)
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0)
  x.normalize()
  const y = _v2.copy(f).cross(x).normalize()
  _m.makeBasis(x, y, f)
  return out.setFromRotationMatrix(_m)
}

function buildPlan() {
  scene.updateMatrixWorld(true)
  const home = rose.localToWorld(new THREE.Vector3(0, 0.55, 0))
  const fps = BT.fps

  // matn yo'llari -> dunyo koordinatalari
  const td = textData || (textData = buildTextStrokes(GREETING))
  const elev = deg(25)
  const right = new THREE.Vector3(1, 0, 0)
  const upv = new THREE.Vector3(0, Math.cos(elev), -Math.sin(elev))
  const portrait = camera.aspect < 1
  const textH = portrait ? 2.7 : 2.3 // gul tepasidagi bo'sh joyga sig'adi
  const textC = TEXT_CENTER.clone()
  textC.y = portrait ? 3.25 : 3.1
  const sc = Math.min(textH / td.h, TEXT_W / td.w)
  const world = td.strokes.map((pts) =>
    pts.map(([px, py]) =>
      textC.clone()
        .addScaledVector(right, (px - td.cx) * sc)
        .addScaledVector(upv, -(py - td.cy) * sc)
    )
  )
  let totalLen = 0
  world.forEach((w) => { for (let i = 1; i < w.length; i++) totalLen += w[i].distanceTo(w[i - 1]) })
  const step = Math.max(0.03, totalLen / 1100)
  const resample = (w) => {
    if (w.length < 2) return [w[0].clone()]
    const out = [w[0].clone()]
    let carry = 0
    for (let i = 1; i < w.length; i++) {
      const a = w[i - 1], b = w[i]
      const seg = a.distanceTo(b)
      let d = step - carry
      while (d <= seg) {
        out.push(a.clone().lerp(b, d / seg))
        d += step
      }
      carry = seg - (d - step)
    }
    return out
  }
  // zarralar joylashadigan nuqtalar: chapdan o'ngga, ozgina tasodifiy tartibda
  const tg = []
  world.forEach((w) => resample(w).forEach((p) => tg.push({ p, k: p.x + Math.random() * 0.9 })))
  tg.sort((a, b) => a.k - b.k)
  const targets = new Float32Array(tg.length * 3)
  tg.forEach(({ p }, i) => targets.set([p.x, p.y, p.z], i * 3))

  const keys = []
  const K = (p, f) => keys.push(p.x, p.y, p.z, f)

  // 1) gul ichidan chiqish + 2) gul tepasida sekin, yumshoq aylanish
  const C = home.clone().add(new THREE.Vector3(0, 1.0, 0))
  const R = 2.0, phi0 = Math.PI / 2, om = (Math.PI * 2 * 1.3) / BT.orbit
  const orbitPos = (phi, o) =>
    o.set(C.x + R * Math.cos(phi), C.y + 0.5 + 0.35 * Math.sin(phi + 0.5), C.z + 0.8 * R * Math.sin(phi))
  const A = orbitPos(phi0, new THREE.Vector3())
  const nE = Math.round(BT.emerge * fps)
  for (let i = 0; i < nE; i++) {
    const u = i / nE
    const p = home.clone().lerp(A, easeInOut(u))
    p.y += 0.7 * Math.sin(Math.PI * u) * (1 - 0.4 * u)
    K(p, 1)
  }
  const nO = Math.round(BT.orbit * fps)
  const tmp = new THREE.Vector3()
  for (let i = 0; i < nO; i++) {
    const u = i / nO
    // boshida/oxirida ozgina sekinlashadi
    const ph = phi0 + om * BT.orbit * (u - 0.04 * Math.sin(u * Math.PI * 2) / (Math.PI * 2) * 2)
    K(orbitPos(ph, tmp), 1)
  }
  const tEnd = keys.length / 4 / fps
  const P0 = new THREE.Vector3(keys[keys.length - 4], keys[keys.length - 3], keys[keys.length - 2])

  // 4) qo'nish nuqtasi (bargcha ustida)
  landLeaf.group.updateMatrixWorld(true)
  const guess = landLeaf.group.localToWorld(new THREE.Vector3(0, 0.04, 2.05))
  const rc = new THREE.Raycaster(guess.clone().add(new THREE.Vector3(0, 4, 0)), new THREE.Vector3(0, -1, 0))
  const hit = rc.intersectObject(landLeaf.terminal, false)[0]
  let lp, ln
  if (hit) {
    lp = landLeaf.group.worldToLocal(hit.point.clone())
    const n = hit.face.normal.clone().transformDirection(landLeaf.terminal.matrixWorld)
    if (n.y < 0) n.negate()
    const gq = landLeaf.group.getWorldQuaternion(new THREE.Quaternion())
    ln = n.applyQuaternion(gq.invert())
  } else {
    lp = new THREE.Vector3(0, 0.15, 2.05)
    ln = new THREE.Vector3(0, 1, 0)
  }
  plan = { keys: new Float32Array(keys), n: keys.length / 4, tEnd, P0, home, lp, ln, targets, dustI: 0, dustStart: BT.emerge + 0.4, dustEnd: tEnd - 1.0, lastEmit: -1, wasInit: false }
}

// qo'nish holatini (dunyo koordinatasi) bargning hozirgi holatidan hisoblash
function updateRest() {
  turntable.updateMatrixWorld(true)
  const g = landLeaf.group
  g.localToWorld(rest.pos.copy(plan.lp))
  g.getWorldQuaternion(_q)
  const n = new THREE.Vector3().copy(plan.ln).applyQuaternion(_q).normalize()
  const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(_q)
  dir.addScaledVector(n, -dir.dot(n)).normalize()
  const toCam = new THREE.Vector3().subVectors(camera.position, rest.pos)
  toCam.addScaledVector(n, -toCam.dot(n)).normalize()
  const f = dir.multiplyScalar(0.55).addScaledVector(toCam, 0.75).normalize()
  rest.pos.addScaledVector(n, 0.1)
  frameQuat(f, n, rest.q)
}

// tau momentidagi o'rin; qaytaradi: 0 = iz yo'q, 1 = vaqtincha iz, 2 = qoladigan iz
function beetleAt(tau, out) {
  if (tau < plan.tEnd) {
    const x = Math.max(0, tau) * BT.fps
    const i0 = Math.min(plan.n - 1, Math.floor(x)), i1 = Math.min(plan.n - 1, i0 + 1)
    const f = x - i0, k = plan.keys
    out.set(
      lerp(k[i0 * 4], k[i1 * 4], f),
      lerp(k[i0 * 4 + 1], k[i1 * 4 + 1], f),
      lerp(k[i0 * 4 + 2], k[i1 * 4 + 2], f)
    )
    return k[i0 * 4 + 3]
  }
  const u = clamp01((tau - plan.tEnd) / BT.land)
  const e = easeInOut(u)
  const cc = _v2.copy(plan.P0).add(rest.pos).multiplyScalar(0.5)
  cc.y += 1.1
  cc.z += 1.0
  const a = _v1.copy(plan.P0).lerp(cc, e),
    b = cc.clone().lerp(rest.pos, e)
  out.copy(a).lerp(b, e)
  out.y += 0.1 * Math.sin(u * Math.PI * 3) * (1 - u)
  return u < 1 ? 1 : 0
}

const _p = new THREE.Vector3(),
  _pa = new THREE.Vector3(),
  _pb = new THREE.Vector3(),
  _fq = new THREE.Quaternion(),
  _fwd = new THREE.Vector3(0, 0, 1),
  _up = new THREE.Vector3(),
  _cam = new THREE.Vector3()

function updateBeetle(t, dt) {
  trailMat.uniforms.uTime.value = t
  trailMat.uniforms.uScale.value =
    renderer.domElement.height / (2 * Math.tan(deg(camera.fov) / 2))
  if (t < T.beetleStart) {
    beetle.visible = false
    return
  }
  if (!plan) buildPlan()
  const tau = t - T.beetleStart
  updateRest()
  beetle.visible = true

  // beetle ortidan zarralar to'kiladi; ular yozuvni tashkil qiladi
  const doneTau = plan.tEnd + BT.land
  const to = Math.min(tau, doneTau)
  if (plan.lastEmit < 0) plan.lastEmit = 0
  const M = plan.targets.length / 3
  let guard = 0
  while (plan.lastEmit + 1 / 120 <= to && guard++ < 600) {
    plan.lastEmit += 1 / 120
    const kind = beetleAt(plan.lastEmit, _p)
    const bt = T.beetleStart + plan.lastEmit
    if (kind && guard % 2 === 0) emitTrail(_p, 1, bt)
    if (plan.lastEmit > plan.dustStart) {
      const want = Math.floor(
        M * clamp01((plan.lastEmit - plan.dustStart) / (plan.dustEnd - plan.dustStart))
      )
      while (plan.dustI < want) {
        const j = plan.dustI++
        emitTrail(_p, 3, bt, [plan.targets[j * 3], plan.targets[j * 3 + 1], plan.targets[j * 3 + 2]])
      }
    }
  }
  trailGeo.setDrawRange(0, trailN)
  ;['position', 'aBirth', 'aKind', 'aSeed', 'aTarget'].forEach((n) => (trailGeo.attributes[n].needsUpdate = true))

  // qo'ngandan keyin: erkin rejim (aylantirish, silkitish va h.k.)
  if (tau >= doneTau) {
    freeBeetle(t, dt)
    return
  }

  // o'rin
  const landU = clamp01((tau - plan.tEnd) / BT.land)
  if (tau >= doneTau) _p.copy(rest.pos)
  else beetleAt(tau, _p)
  beetle.position.copy(_p)

  // yo'nalish
  beetleAt(tau + 0.03, _pa)
  beetleAt(Math.max(0, tau - 0.03), _pb)
  const vel = _pa.sub(_pb)
  _cam.subVectors(camera.position, _p).normalize()
  _up.set(0, 1, 0).lerp(_cam, 0.3).normalize()
  if (vel.lengthSq() > 1e-8 && tau < doneTau) {
    vel.normalize()
    frameQuat(vel, _up, _fq)
    if (tau > plan.tEnd) _fq.slerp(rest.q, smooth(0.5, 1, landU))
  } else {
    _fq.copy(rest.q)
  }
  if (!plan.wasInit) {
    beetle.quaternion.copy(_fq)
    plan.wasInit = true
  } else beetle.quaternion.slerp(_fq, 1 - Math.exp(-Math.max(dt, 0.016) * 10))

  // o'lcham, qanot, yorug'lik
  const grow = easeOut(smooth(0, 1.2, tau))
  beetle.scale.setScalar(Math.max(0.02, grow))
  const fly =
    tau < plan.tEnd ? smooth(0.4, 1.0, tau) : 1 - smooth(0.62, 0.95, landU)
  const open = 0.85 * fly
  elytra.forEach(({ piv, s }) => (piv.rotation.z = s * open))
  const flap = Math.sin(t * 38)
  wings.forEach(({ piv, s }) => {
    piv.visible = fly > 0.03
    piv.rotation.z = s * (0.15 + 0.55 * flap) * fly
  })
  antennae.forEach(({ piv, s }, i) => {
    piv.rotation.z = s * 0.12 * Math.sin(t * 2.4 + i * 1.3)
    piv.rotation.x = 0.1 * Math.sin(t * 1.9 + i)
  })
  rig.position.y = fly > 0.5 ? 0.02 * Math.sin(t * 9) : 0.006 * Math.sin(t * 2.2)
  const pulse = 0.88 + 0.12 * Math.sin(t * 2.8)
  halo.scale.setScalar((0.95 + 0.25 * fly) * pulse * grow)
  beetleLight.intensity = 1.7 * grow * (0.55 + 0.45 * fly) * pulse
}

/* =====================================================================
   AYLANTIRISH: sichqoncha / barmoq bilan gulni har tomondan ko'rish.
   Qattiq surib yuborilsa — inersiya bilan aylanadi.
   ===================================================================== */
const TILT_MIN = -0.32,
  TILT_MAX = 0.55,
  MAX_VEL = 26
const spin = {
  enabled: false,
  yaw: 0,
  vel: 0,
  tilt: 0,
  omega: 0, // hozirgi burchak tezligi (rad/s)
  accum: 0, // to'xtovsiz aylangan burchak
  jig: 0, // silkitilgandagi titroq
  drag: false,
  id: null,
  px: 0,
  py: 0,
  pt: 0,
  samples: [],
  lastInput: -1e9,
  rev: [],
  dirX: 0,
}
const clampN = (x, a, b) => Math.min(b, Math.max(a, x))
const rotK = () => 4.2 / Math.min(window.innerWidth || 800, 900)
function recentDragVel(now) {
  let sum = 0
  for (const [ts, a] of spin.samples) if (now - ts < 100) sum += a
  spin.samples = spin.samples.filter(([ts]) => now - ts < 160)
  return sum / 0.1
}
stage.addEventListener('pointerdown', (e) => {
  if (!spin.enabled || e.target.closest('.mute')) return
  spin.drag = true
  spin.id = e.pointerId
  try {
    stage.setPointerCapture(e.pointerId)
  } catch (err) {}
  spin.px = e.clientX
  spin.py = e.clientY
  spin.pt = performance.now()
  spin.samples.length = 0
  spin.vel *= 0.15 // aylanayotgan gulni ushlab olsa — sekinlashadi
  spin.lastInput = performance.now()
  stage.classList.add('dragging')
  hideHint()
})
stage.addEventListener('pointermove', (e) => {
  if (!spin.drag || e.pointerId !== spin.id) return
  const now = performance.now()
  const dx = e.clientX - spin.px,
    dy = e.clientY - spin.py
  const dtm = Math.max(1, now - spin.pt) / 1000
  spin.px = e.clientX
  spin.py = e.clientY
  spin.pt = now
  const k = rotK()
  spin.yaw += dx * k
  spin.tilt = clampN(spin.tilt + dy * k * 0.5, TILT_MIN, TILT_MAX)
  spin.samples.push([now, dx * k])
  spin.lastInput = now
  // tez-tez u yoqqa-bu yoqqa siltash ham "silkitish" hisoblanadi (kompyuterda)
  if (Math.abs(dx / dtm) > 650) {
    const d = Math.sign(dx)
    if (spin.dirX && d !== spin.dirX) spin.rev.push(now)
    spin.dirX = d
  }
  spin.rev = spin.rev.filter((x) => now - x < 1000)
  if (spin.rev.length >= 4) {
    spin.rev.length = 0
    requestShake()
  }
})
function endDrag(e) {
  if (!spin.drag || (e && e.pointerId !== undefined && e.pointerId !== spin.id)) return
  spin.drag = false
  stage.classList.remove('dragging')
  spin.vel = clampN(recentDragVel(performance.now()), -MAX_VEL, MAX_VEL)
  spin.lastInput = performance.now()
}
stage.addEventListener('pointerup', endDrag)
stage.addEventListener('pointercancel', endDrag)
stage.addEventListener('lostpointercapture', endDrag)

function updateSpin(t, dt) {
  const now = performance.now()
  if (spin.drag) {
    spin.omega = recentDragVel(now)
  } else {
    spin.yaw += spin.vel * dt
    spin.vel *= Math.exp(-dt * 0.5) // havo qarshiligi
    spin.vel -= Math.sign(spin.vel) * Math.min(Math.abs(spin.vel), 0.6 * dt)
    spin.omega = spin.vel
    // egilish asta-sekin o'z holiga qaytadi
    if (now - spin.lastInput > 1400) spin.tilt += (0 - spin.tilt) * (1 - Math.exp(-dt * 1.1))
  }
  const w = Math.abs(spin.omega)
  if (w > 0.8) spin.accum += w * dt
  else if (w < 0.4) spin.accum = 0
  spin.jig *= Math.exp(-dt * 1.7)
  turntable.rotation.set(
    spin.tilt + spin.jig * 0.06 * Math.sin(t * 23),
    spin.yaw,
    spin.jig * 0.1 * Math.sin(t * 19 + 1)
  )
}

/* ---------- ko'rsatma ---------- */
const hint = document.getElementById('hint')
const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
let hintShown = false,
  hintTimer = null
function showHint() {
  if (hintShown || !hint) return
  hintShown = true
  hint.textContent = isTouch
    ? 'swipe to spin the rose  ·  shake your phone'
    : 'drag to spin the rose  ·  wiggle it fast to shake'
  hint.classList.add('show')
  hintTimer = setTimeout(hideHint, 7000)
}
function hideHint() {
  if (!hint) return
  clearTimeout(hintTimer)
  hint.classList.remove('show')
}
function enableInteraction() {
  spin.enabled = true
  stage.classList.add('interactive')
  setTimeout(showHint, 1200)
}

/* ---------- telefonni silkitish (DeviceMotion) ---------- */
let motionOn = false
function enableMotion() {
  const DME = window.DeviceMotionEvent
  if (!DME || motionOn) return
  const add = () => {
    if (motionOn) return
    motionOn = true
    window.addEventListener('devicemotion', onMotion)
  }
  // iOS ruxsat so'raydi — bu foydalanuvchi bosgan paytda chaqirilishi shart
  if (typeof DME.requestPermission === 'function')
    DME.requestPermission()
      .then((s) => s === 'granted' && add())
      .catch(() => {})
  else add()
}
let gPrev = null,
  lastPeak = 0,
  peaks = []
function onMotion(e) {
  let m = null,
    th = 14
  const a = e.acceleration
  if (a && a.x != null) m = Math.hypot(a.x, a.y, a.z)
  else {
    const g = e.accelerationIncludingGravity
    if (!g || g.x == null) return
    if (gPrev) m = Math.hypot(g.x - gPrev.x, g.y - gPrev.y, g.z - gPrev.z)
    gPrev = { x: g.x, y: g.y, z: g.z }
    th = 10
    if (m == null) return
  }
  const now = performance.now()
  if (m > th && now - lastPeak > 110) {
    lastPeak = now
    peaks.push(now)
  }
  peaks = peaks.filter((x) => now - x < 1000)
  if (peaks.length >= 3) {
    peaks = []
    requestShake()
  }
}

/* =====================================================================
   AYLANISH YULDUZCHALARI: gul qancha tez aylansa, ichidan shuncha ko'p
   turli o'lchamdagi yulduzchalar otilib chiqadi
   ===================================================================== */
const SP_N = 900
const spPos = new Float32Array(SP_N * 3),
  spVel = new Float32Array(SP_N * 3),
  spAge = new Float32Array(SP_N).fill(99),
  spLife = new Float32Array(SP_N).fill(1),
  spSize0 = new Float32Array(SP_N),
  spSeed = new Float32Array(SP_N),
  spSize = new Float32Array(SP_N),
  spAlpha = new Float32Array(SP_N),
  spCol = new Float32Array(SP_N * 3),
  spStar = new Float32Array(SP_N)
const spGeo = new THREE.BufferGeometry()
spGeo.setAttribute('position', mkAttr(spPos, 3))
spGeo.setAttribute('aSize', mkAttr(spSize, 1))
spGeo.setAttribute('aAlpha', mkAttr(spAlpha, 1))
spGeo.setAttribute('aColor', mkAttr(spCol, 3))
spGeo.setAttribute('aStar', mkAttr(spStar, 1))
const spMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uScale: { value: 600 } },
  vertexShader: `
    attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aStar;
    uniform float uScale;
    varying float vA; varying vec3 vC; varying float vStar;
    void main() {
      vA = aAlpha; vC = aColor; vStar = aStar;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA; varying vec3 vC; varying float vStar;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      float core = pow(smoothstep(0.5, 0.0, d), 2.4);
      float star = vStar * (max(0.0, 1.0 - abs(c.x) * 11.0) * max(0.0, 1.0 - abs(c.y) * 2.1)
                          + max(0.0, 1.0 - abs(c.y) * 11.0) * max(0.0, 1.0 - abs(c.x) * 2.1));
      float a = (core + star) * vA;
      gl_FragColor = vec4(vC * a, a);
    }`,
})
const spPts = new THREE.Points(spGeo, spMat)
spPts.frustumCulled = false
scene.add(spPts)
let spNext = 0,
  spAcc = 0
const _heart = new THREE.Vector3()
const SP_COLS = [
  [1.0, 0.82, 0.45], // oltin
  [1.0, 0.56, 0.72], // pushti
  [1.0, 0.95, 0.9], // oq
  [1.0, 0.7, 0.5], // shaftoli
]
function emitSpark(omega, burst = 0) {
  const i = spNext
  spNext = (spNext + 1) % SP_N
  const a = Math.random() * Math.PI * 2
  const r0 = 0.05 + Math.random() * 0.33
  const ca = Math.cos(a),
    sa = Math.sin(a)
  spPos[i * 3] = _heart.x + ca * r0
  spPos[i * 3 + 1] = _heart.y + Math.random() * 0.25
  spPos[i * 3 + 2] = _heart.z + sa * r0
  const sk = Math.min(Math.abs(omega) / 8, 2) + burst
  const out = (0.5 + Math.random() * 1.2) * (0.6 + sk)
  const tang = (0.3 + Math.random()) * 1.4 * omega * 0.25
  spVel[i * 3] = ca * out + sa * tang
  spVel[i * 3 + 1] = 0.6 + Math.random() * 1.7 + burst * 0.8
  spVel[i * 3 + 2] = sa * out - ca * tang
  spAge[i] = 0
  spLife[i] = 0.9 + Math.random() * 1.4
  spSize0[i] = 0.03 + Math.pow(Math.random(), 2.2) * 0.21
  spSeed[i] = Math.random() * 50
  spStar[i] = spSize0[i] > 0.1 || Math.random() < 0.15 ? 1 : 0
  const c = SP_COLS[(Math.random() * SP_COLS.length) | 0]
  spCol.set(c, i * 3)
}
function burstSparks(n) {
  rose.localToWorld(_heart.set(0, 0.55, 0))
  for (let k = 0; k < n; k++) emitSpark((Math.random() - 0.5) * 10, 0.8)
}
function updateSpinSparks(t, dt) {
  spMat.uniforms.uScale.value = trailMat.uniforms.uScale.value
  const w = Math.abs(spin.omega)
  const rate = clampN((w - 1.0) * 42, 0, 620)
  if (rate > 0 && head.visible) {
    rose.localToWorld(_heart.set(0, 0.55, 0))
    spAcc += rate * dt
    while (spAcc >= 1) {
      spAcc -= 1
      emitSpark(spin.omega)
    }
  } else spAcc = 0
  const drag = Math.exp(-dt * 1.1)
  for (let i = 0; i < SP_N; i++) {
    if (spAge[i] > spLife[i]) {
      spAlpha[i] = 0
      continue
    }
    spAge[i] += dt
    spVel[i * 3 + 1] -= 0.9 * dt
    spVel[i * 3] *= drag
    spVel[i * 3 + 1] *= drag
    spVel[i * 3 + 2] *= drag
    spPos[i * 3] += spVel[i * 3] * dt
    spPos[i * 3 + 1] += spVel[i * 3 + 1] * dt
    spPos[i * 3 + 2] += spVel[i * 3 + 2] * dt
    const age = spAge[i],
      life = spLife[i]
    const tw = 0.62 + 0.38 * Math.sin(age * 22 + spSeed[i])
    spAlpha[i] = smooth(0, 0.07, age) * (1 - smooth(life * 0.5, life, age)) * tw
    spSize[i] = spSize0[i] * (1 - 0.4 * (age / life))
  }
  ;['position', 'aSize', 'aAlpha', 'aColor', 'aStar'].forEach(
    (n) => (spGeo.attributes[n].needsUpdate = true)
  )
}

/* =====================================================================
   SILKITISH: gulbarglar to'kiladi -> gul qaytadan o'sadi, musiqa qaytadan
   ===================================================================== */
const REGROW_DELAY = 7.2 // barglar to'kilib bo'lgach (~2 s) yana ~5 s bo'sh turadi
const REGROW_SPEED = 0.5 // qayta o'sish 2 baravar sekinroq
const SHED = { active: false, t0: 0, regrowAt: 0, regrown: false, regrowStart: null, count: 0 }
const shedClones = []
let pendingShake = false
function requestShake() {
  if (spin.enabled && !SHED.active) pendingShake = true
}
function vibrate(p) {
  try {
    if (navigator.vibrate) navigator.vibrate(p)
  } catch (e) {}
}
function startShed(t) {
  SHED.active = true
  SHED.t0 = t
  SHED.regrowAt = t + REGROW_DELAY
  SHED.regrown = false
  SHED.count++
  vibrate([80, 40, 120, 40, 200])
  spin.jig = 1
  hideHint()
  // tashqi gulbarglar birinchi uchadi, ichkilari keyin
  petals.forEach((p) => {
    p.shedAt = t + (1 - p.s) * 1.7 + Math.random() * 0.35
    p.shed = false
  })
  burstSparks(70)
  // qo'ng'izcha ekranga uchib keladi: 1-marta kuladi, 2-marta jahli chiqadi (navbatma-navbat)
  startClose(t, SHED.count % 2 === 1 ? 'smile' : 'angry')
}
// gul boshining "soati": qayta o'sganda kurtak bosqichidan boshlanadi
function headClock(t) {
  return SHED.regrowStart != null && t >= SHED.regrowStart
    ? T.budStart - 0.25 + (t - SHED.regrowStart) * REGROW_SPEED
    : t
}
function shedShrink(t) {
  return SHED.active && !SHED.regrown ? 1 - smooth(SHED.regrowAt - 0.7, SHED.regrowAt, t) : 1
}
const _dp = new THREE.Vector3(),
  _ax = new THREE.Vector3()
function detachPetal(p) {
  p.shed = true
  p.mesh.updateWorldMatrix(true, false)
  const m = new THREE.Mesh(p.geo.clone(), petalMat)
  m.castShadow = true
  p.mesh.matrixWorld.decompose(m.position, m.quaternion, m.scale)
  scene.add(m)
  p.mesh.visible = false
  rose.localToWorld(_heart.set(0, 0.55, 0))
  _dp.subVectors(m.position, _heart)
  _dp.y = 0
  if (_dp.lengthSq() < 1e-6) _dp.set(Math.random() - 0.5, 0, Math.random() - 0.5)
  _dp.normalize()
  const v = _dp.clone().multiplyScalar(0.7 + Math.random() * 1.4)
  v.y += 0.4 + Math.random() * 1.1
  v.x += (Math.random() - 0.5) * 0.5 + _dp.z * spin.omega * 0.15
  v.z += (Math.random() - 0.5) * 0.5 - _dp.x * spin.omega * 0.15
  shedClones.push({
    m,
    v,
    age: 0,
    life: 4.2 + Math.random() * 1.3,
    s0: m.scale.clone(),
    ph: Math.random() * 6.28,
    ax: _ax.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().clone(),
    rs: (Math.random() - 0.5) * 7,
  })
}
function updateShed(t, dt) {
  if (SHED.active) {
    if (!SHED.regrown) petals.forEach((p) => !p.shed && t >= p.shedAt && detachPetal(p))
    if (!SHED.regrown && t >= SHED.regrowAt) {
      SHED.regrown = true
      SHED.regrowStart = t
      petals.forEach((p) => {
        p.mesh.visible = true
        p.shed = false
      })
      restartMusic()
    }
    if (SHED.regrown && t > SHED.regrowStart + 8.8) SHED.active = false
  }
  for (let i = shedClones.length - 1; i >= 0; i--) {
    const f = shedClones[i]
    f.age += dt
    f.v.y -= 1.9 * dt
    f.v.multiplyScalar(Math.exp(-dt * 1.3))
    f.m.position.addScaledVector(f.v, dt)
    f.m.position.x += Math.sin(f.age * 2.6 + f.ph) * 0.5 * dt
    f.m.position.z += Math.cos(f.age * 2.1 + f.ph) * 0.3 * dt
    f.m.rotateOnAxis(f.ax, f.rs * dt)
    const k = 1 - smooth(f.life - 0.9, f.life, f.age)
    f.m.scale.copy(f.s0).multiplyScalar(Math.max(k, 1e-4))
    if (f.age >= f.life) {
      scene.remove(f.m)
      f.m.geometry.dispose()
      shedClones.splice(i, 1)
    }
  }
}

/* =====================================================================
   QO'NG'IZCHA (erkin rejim, qo'ngandan keyin):
   - gul aylansa boshi chayqaladi (boshi aylanadi), tepasida yulduzchalar
   - gul to'liq aylansa — uchib chetda turadi, gul to'xtasa yana qo'nadi
   - silkitilsa — ekranga yaqin uchib keladi: kuladi yoki jahli chiqadi
   ===================================================================== */
const BF = {
  started: false,
  mode: 'rest',
  fly: 0,
  dizzy: 0,
  calm: 0,
  side: 1,
  prev: new THREE.Vector3(),
  c: null,
  smile: 0,
  angry: 0,
  blink: 0,
  nextBlink: 2,
  closeness: 0,
  sad: null,
  sadF: 0,
  sc: 1,
}
const _cr = new THREE.Vector3(),
  _cu = new THREE.Vector3(),
  _cf = new THREE.Vector3(),
  _tgt = new THREE.Vector3(),
  _fa = new THREE.Vector3(),
  _fb = new THREE.Vector3(),
  _st = new THREE.Vector3(),
  _hc = new THREE.Vector3(),
  _end = new THREE.Vector3(),
  _ctl = new THREE.Vector3(),
  _qc = new THREE.Quaternion(),
  _qf = new THREE.Quaternion(),
  _wup = new THREE.Vector3(0, 1, 0)

function camBasis() {
  camera.updateMatrixWorld()
  _cr.setFromMatrixColumn(camera.matrixWorld, 0)
  _cu.setFromMatrixColumn(camera.matrixWorld, 1)
  _cf.setFromMatrixColumn(camera.matrixWorld, 2).negate()
}
function hoverPoint(t, out) {
  rose.localToWorld(_heart.set(0, 0.55, 0))
  const dist = camera.position.distanceTo(_heart)
  const visW = 2 * dist * Math.tan(deg(camera.fov) / 2) * camera.aspect
  const off = Math.min(2.1, visW * 0.3)
  out.copy(_heart).addScaledVector(_cr, BF.side * off).addScaledVector(_cu, 0.55).addScaledVector(_cf, -0.6)
  out.x += 0.12 * Math.sin(t * 1.7)
  out.y += 0.16 * Math.sin(t * 2.3)
  out.z += 0.1 * Math.cos(t * 1.3)
  return out
}
function follow(target, dt, k, maxSpeed = 4) {
  _st.subVectors(target, beetle.position).multiplyScalar(1 - Math.exp(-dt * k))
  const mx = maxSpeed * dt
  if (_st.length() > mx) _st.setLength(mx)
  beetle.position.add(_st)
}
// uchayotganda: harakat yo'nalishiga, sekin bo'lsa — bizga qaraydi
function faceFlight(dt, q) {
  _fa.subVectors(beetle.position, BF.prev)
  const sp = _fa.length() / Math.max(dt, 1e-3)
  _fb.subVectors(camera.position, beetle.position).normalize()
  if (sp > 0.5) _fa.normalize().lerp(_fb, 0.35).normalize()
  else {
    rose.localToWorld(_heart.set(0, 0.55, 0))
    _fa.subVectors(_heart, beetle.position).normalize().lerp(_fb, 0.7).normalize()
  }
  frameQuat(_fa, _wup, q)
}
function takeOff() {
  BF.mode = 'hover'
  BF.calm = 0
  rose.localToWorld(_heart.set(0, 0.55, 0))
  BF.side = Math.sign(_fa.subVectors(beetle.position, _heart).dot(_cr)) || 1
}
function startClose(t, kind) {
  BF.c = { t0: t + 0.15, kind, from: beetle.position.clone(), fromS: beetle.scale.x, voiced: false }
  BF.mode = 'close'
}
const bez = (a, b, c, u, out) =>
  out.copy(a).multiplyScalar((1 - u) * (1 - u)).addScaledVector(b, 2 * u * (1 - u)).addScaledVector(c, u * u)

// ekranga yaqin uchib kelish: yuzi ekranni egallaydi
function closeUpdate(t, dt, q) {
  const C = BF.c
  const c = Math.max(0, t - C.t0)
  const D = 1.55
  const visH = 2 * D * Math.tan(deg(camera.fov) / 2)
  const visW = visH * camera.aspect
  const S = Math.min((0.72 * visH) / 0.15, (0.9 * visW) / 0.2, 4.5)
  frameQuat(_fa.copy(_cf).negate(), _cu, _qc)
  _hc.set(0, 0.005, 0.185).applyQuaternion(_qc).multiplyScalar(S)
  _end.copy(camera.position).addScaledVector(_cf, D).sub(_hc).addScaledVector(_cu, 0.003 * S * Math.sin(t * 2.6))
  const A = 1.0,
    HOLD = 3.1
  let s
  if (c < A) {
    const u = easeInOut(c / A)
    _ctl.copy(C.from).lerp(_end, 0.5).addScaledVector(_cu, 1.0)
    bez(C.from, _ctl, _end, u, beetle.position)
    s = lerp(C.fromS, S, Math.pow(u, 2.4))
    q.copy(_qc)
  } else if (c < HOLD) {
    beetle.position.copy(_end)
    s = S
    q.copy(_qc)
  } else {
    // gulbarglar to'kildi — endi xafa bo'ladi
    beetle.position.copy(_end)
    s = S
    q.copy(_qc)
    BF.mode = 'sad'
    BF.sad = { t0: t, from: _end.clone(), fromS: S, sighed: false, sniffed: 0, hoped: false, joyed: false }
    BF.c = null
  }
  BF.closeness = clamp01((s - 1) / Math.max(0.01, S - 1))
  // yuz ifodasi
  const on = c > 1.05 && c < HOLD - 0.15 ? 1 : 0
  const tS = C.kind === 'smile' ? on : 0,
    tA = C.kind === 'angry' ? on : 0
  BF.smile += (tS - BF.smile) * (1 - Math.exp(-dt * 9))
  BF.angry += (tA - BF.angry) * (1 - Math.exp(-dt * 9))
  if (!C.voiced && c > 1.15) {
    C.voiced = true
    duckMusic(0.3, 1400)
    if (C.kind === 'smile') {
      sfx.giggle()
      spawnHearts(5)
    } else {
      sfx.grumble()
      vibrate([40, 30, 40, 30, 70])
    }
  }
  return s
}

const _hw = new THREE.Vector3()
function spawnHearts(n) {
  headG.localToWorld(_hw.set(0, 0.06, 0.12))
  let k = 0
  for (const h of hearts) {
    if (k >= n) break
    if (h.age < h.life) continue
    k++
    h.age = -k * 0.12
    h.life = 1.7 + Math.random() * 0.5
    h.sp.position.copy(_hw).addScaledVector(_cr, (Math.random() - 0.5) * 0.5)
    h.v.copy(_cu).multiplyScalar(0.35 + Math.random() * 0.25).addScaledVector(_cr, (Math.random() - 0.5) * 0.4)
    h.sp.visible = false
  }
}
function updateHearts(dt) {
  for (const h of hearts) {
    if (h.age >= h.life) {
      h.sp.visible = false
      continue
    }
    h.age += dt
    if (h.age < 0) continue
    h.sp.visible = true
    h.sp.position.addScaledVector(h.v, dt)
    const k = h.age / h.life
    h.sp.material.opacity = smooth(0, 0.12, h.age) * (1 - smooth(0.6, 1, k))
    h.sp.scale.setScalar(0.07 + 0.05 * Math.sin(Math.min(1, k * 3) * Math.PI * 0.5) + 0.01 * Math.sin(h.age * 9))
  }
}

/* ---------- xafa qo'ng'izcha: gul yonida, gul qayta o'sguncha ---------- */
function sadSpot(t, out) {
  rose.localToWorld(_heart.set(0, 0.55, 0))
  const dR = camera.position.distanceTo(_heart)
  const tanH = Math.tan(deg(camera.fov) / 2)
  const d = Math.min(5, dR * 0.35)
  const visH = 2 * d * tanH,
    visW = visH * camera.aspect
  const S2 = Math.min((0.24 * visH) / 0.15, (0.36 * visW) / 0.2)
  const visHR = 2 * dR * tanH,
    visWR = visHR * camera.aspect
  _tgt.copy(_heart)
  if (camera.aspect < 0.8) {
    // tik ekran: gul boshining ostida, sal chetroqda
    const off = 0.8 / visHR + (0.15 * S2) / visH / 2 + 0.03
    _tgt.addScaledVector(_cu, -off * visHR).addScaledVector(_cr, BF.side * 0.1 * visWR)
  } else {
    // yotiq ekran: gul boshining yonida
    const fw = (0.2 * S2) / visW
    const off = Math.min(0.8 / visWR + fw / 2 + 0.03, 0.5 - fw / 2 - 0.02)
    _tgt.addScaledVector(_cr, BF.side * off * visWR).addScaledVector(_cu, -0.9)
  }
  _fa.subVectors(_tgt, camera.position).normalize()
  out.copy(camera.position).addScaledVector(_fa, d).addScaledVector(_cu, 0.01 * S2 * Math.sin(t * 1.6))
  return S2
}
function sadUpdate(t, dt, q) {
  const Sd = BF.sad
  const c = t - Sd.t0
  const S2 = sadSpot(t, _end)
  let s
  if (c < 1.1) {
    const u = easeInOut(c / 1.1)
    _ctl.copy(Sd.from).lerp(_end, 0.5).addScaledVector(_cu, 0.3)
    bez(Sd.from, _ctl, _end, u, beetle.position)
    s = lerp(Sd.fromS, S2, u)
  } else {
    beetle.position.copy(_end)
    s = S2
  }
  // bizga qaraydi, lekin ko'zi gulda
  rose.localToWorld(_heart.set(0, 0.55, 0))
  _fb.subVectors(camera.position, beetle.position).normalize()
  _fa.subVectors(_heart, beetle.position).normalize()
  frameQuat(_fb.addScaledVector(_fa, 0.3).normalize(), _cu, q)

  const since = SHED.regrown && SHED.regrowStart != null ? t - SHED.regrowStart : -1
  let tSad = 1,
    tSm = 0
  if (since >= 1.3) {
    tSad = 0
    tSm = 0.45 // kurtak ko'rindi — umid
  }
  if (since >= 3.3) tSm = 1 // gul ochilmoqda — quvonch
  BF.sadF += (tSad - BF.sadF) * (1 - Math.exp(-dt * 4))
  BF.smile += (tSm - BF.smile) * (1 - Math.exp(-dt * 6))
  BF.angry += (0 - BF.angry) * (1 - Math.exp(-dt * 8))

  if (!Sd.sighed && c > 1.0) {
    Sd.sighed = true
    duckMusic(0.35, 1700)
    sfx.sigh()
  }
  if (Sd.sniffed < 2 && since < 0 && c > 2.7 + Sd.sniffed * 1.6) {
    Sd.sniffed++
    sfx.sniff()
  }
  if (!Sd.hoped && since >= 1.3) {
    Sd.hoped = true
    sfx.oh()
  }
  if (!Sd.joyed && since >= 3.3) {
    Sd.joyed = true
    duckMusic(0.35, 1300)
    sfx.giggle()
    spawnHearts(4)
  }
  if (since >= 4.7) {
    BF.mode = 'return'
    BF.sad = null
  }
  return s
}

function freeBeetle(t, dt) {
  if (!BF.started) {
    BF.started = true
    BF.prev.copy(rest.pos)
    enableInteraction()
  }
  camBasis()
  const w = Math.abs(spin.omega)
  // bosh aylanishi: tez ko'tariladi, sekin o'tadi
  const dz = smooth(0.35, 3.2, w)
  BF.dizzy += (dz - BF.dizzy) * (1 - Math.exp(-dt * (dz > BF.dizzy ? 2.2 : 0.55)))

  let flying = true,
    scale = 1
  const q = _qf
  switch (BF.mode) {
    case 'rest':
      beetle.position.copy(rest.pos)
      q.copy(rest.q)
      flying = false
      if ((spin.accum > Math.PI * 2 && w > 1.2) || w > 6) takeOff()
      break
    case 'hover':
      follow(hoverPoint(t, _tgt), dt, 2.6, 6)
      faceFlight(dt, q)
      BF.calm = w < 0.5 ? BF.calm + dt : 0
      if (BF.calm > 0.8) BF.mode = 'return'
      break
    case 'return': {
      follow(rest.pos, dt, 3.2, 3.2 + beetle.position.distanceTo(rest.pos))
      faceFlight(dt, q)
      const d = beetle.position.distanceTo(rest.pos)
      if (d < 0.45) q.slerp(rest.q, smooth(0.45, 0.06, d))
      if (d < 0.035) BF.mode = 'rest'
      if (w > 6 || (spin.accum > Math.PI * 2 && w > 1.2)) takeOff()
      break
    }
    case 'close':
      scale = closeUpdate(t, dt, q)
      break
    case 'sad':
      scale = sadUpdate(t, dt, q)
      break
  }
  const staged = BF.mode === 'close' || BF.mode === 'sad'
  if (staged) BF.sc = scale
  else {
    // uzoqlashganda asta kichrayadi
    BF.sc += (1 - BF.sc) * (1 - Math.exp(-dt * 2.2))
    scale = BF.sc
  }
  if (BF.mode !== 'close') BF.closeness = clamp01((scale - 1) / 3)
  if (!staged) {
    BF.smile += (0 - BF.smile) * (1 - Math.exp(-dt * 6))
    BF.angry += (0 - BF.angry) * (1 - Math.exp(-dt * 6))
    BF.sadF += (0 - BF.sadF) * (1 - Math.exp(-dt * 6))
  }
  beetle.quaternion.slerp(q, 1 - Math.exp(-dt * (BF.mode === 'rest' ? 14 : 7)))
  BF.prev.copy(beetle.position)
  beetle.scale.setScalar(scale)

  // qanotlar
  BF.fly += ((flying ? 1 : 0) - BF.fly) * (1 - Math.exp(-dt * 6))
  const fly = BF.fly
  elytra.forEach(({ piv, s }) => (piv.rotation.z = s * 0.85 * fly))
  const flap = Math.sin(t * 38)
  wings.forEach(({ piv, s }) => {
    piv.visible = fly > 0.03
    piv.rotation.z = s * (0.15 + 0.55 * flap) * fly
  })
  // yaqin planda tebranish kichrayadi (aks holda kattalashtirilgan yuz sakrab ketadi)
  rig.position.y =
    (fly > 0.5 ? 0.02 * Math.sin(t * 9) : 0.006 * Math.sin(t * 2.2)) * (1 - 0.92 * BF.closeness)

  // bosh: aylanish, kulgi, jahl
  const dzz = staged ? 0 : BF.dizzy
  const sm = BF.smile,
    an = BF.angry,
    sd = BF.sadF
  headG.rotation.z = dzz * 0.55 * Math.sin(t * 6.2) + sd * 0.07 * Math.sin(t * 1.4)
  headG.rotation.x =
    dzz * 0.22 * Math.cos(t * 6.2) + sm * 0.08 * Math.abs(Math.sin(t * 15)) + sd * 0.24 // xafa: boshi egik
  headG.rotation.y = dzz * 0.3 * Math.sin(t * 3.1) + an * 0.2 * Math.sin(t * 15)
  rig.rotation.z = dzz * 0.28 * Math.sin(t * 6.2 + 1) // butun tanasi gandiraklaydi
  rig.rotation.x = dzz * 0.12 * Math.cos(t * 6.2 + 1)
  antennae.forEach(({ piv, s }, i) => {
    piv.rotation.z =
      s * (0.12 + 0.35 * an) * Math.sin(t * (2.4 + 6 * dzz + 8 * sm) + i * 1.3) + s * 0.25 * an - s * 0.75 * sd
    piv.rotation.x = 0.1 * Math.sin(t * 1.9 + i) - 0.3 * an + 0.35 * sd // xafa: mo'ylovlari osilgan
  })
  dizzyStars.forEach((sp, i) => {
    sp.visible = dzz > 0.06
    const a = t * 5 + i * 2.094
    sp.position.set(0.1 * Math.cos(a), 0.13 + 0.015 * Math.sin(t * 7 + i), 0.04 + 0.1 * Math.sin(a))
    sp.material.opacity = smooth(0.06, 0.4, dzz)
  })

  // ko'z pirpiratish
  BF.nextBlink -= dt
  if (BF.nextBlink < 0) {
    BF.blink = 1
    BF.nextBlink = 2 + Math.random() * 3
  }
  const blinkK = BF.blink > 0 ? Math.sin((1 - BF.blink) * Math.PI) : 0
  BF.blink = Math.max(0, BF.blink - dt * 7)
  setFace(sm, an, blinkK, t, sd)

  // nur: yaqin kelganda ekranni "kuydirmasin"
  const cl = BF.closeness
  legs.forEach((l) => (l.visible = cl < 0.2)) // yaqin planda oyoqlar yuz ortidan chiqib turmasin
  stage.classList.toggle('closeup', cl > 0.25) // yaqin planda pastdagi yozuv yuzni to'smasin
  const pulse = 0.88 + 0.12 * Math.sin(t * 2.8)
  halo.scale.setScalar((0.95 + 0.25 * fly) * pulse * (1 - 0.9 * cl))
  halo.material.opacity = 1 - cl
  beetleLight.intensity = 1.7 * (0.55 + 0.45 * fly) * pulse * (1 - 0.8 * cl)
  shellMat.emissiveIntensity = 0.8 * (1 - 0.6 * cl) + an * 0.35
  sfx.setBuzz(BF.mode === 'close' ? cl * (1 - 0.6 * Math.max(sm, an)) : 0)
  updateHearts(dt)
}

/* =====================================================================
   BOKEH: kamera oldida va ortida suzib yurgan, fokusdan tashqari nur doiralari
   ===================================================================== */
const BOKEH_N = 46
const bokehGeo = new THREE.BufferGeometry()
{
  const pos = new Float32Array(BOKEH_N * 3), sd = new Float32Array(BOKEH_N)
  for (let i = 0; i < BOKEH_N; i++) {
    const front = i % 3 === 0
    pos[i * 3] = (Math.random() - 0.5) * (front ? 7 : 12)
    pos[i * 3 + 1] = -6 + Math.random() * 11
    pos[i * 3 + 2] = front ? 3 + Math.random() * 5 : -3 - Math.random() * 5
    sd[i] = Math.random()
  }
  bokehGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  bokehGeo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
}
const bokehMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uAppear: { value: 0 } },
  vertexShader: `
    attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uAppear;
    varying float vA; varying float vS;
    void main() {
      vec3 p = position;
      p.y += mod(uTime * (0.05 + aSeed * 0.08) + aSeed * 11.0, 11.0) - 5.5 - position.y * 0.0;
      p.x += sin(uTime * 0.2 + aSeed * 20.0) * 0.4;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float dist = -mv.z;
      float defocus = abs(dist - 17.0);
      gl_PointSize = (0.08 + defocus * 0.055) * uScale / dist;
      vA = uAppear * (0.035 + 0.05 * aSeed) * clamp(2.5 / (defocus + 1.0), 0.15, 1.0)
           * (0.6 + 0.4 * sin(uTime * 0.7 + aSeed * 30.0));
      vS = aSeed;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA; varying float vS;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float disk = smoothstep(1.0, 0.9, d);
      float ring = smoothstep(0.7, 0.95, d) * disk;
      vec3 col = mix(vec3(1.0, 0.35, 0.45), vec3(1.0, 0.75, 0.55), vS);
      gl_FragColor = vec4(col, (disk * 0.55 + ring * 0.6) * vA);
    }`,
})
const bokeh = new THREE.Points(bokehGeo, bokehMat)
bokeh.frustumCulled = false
scene.add(bokeh)

function renderFrame(t) {
  updateSSS()
  gradePass.uniforms.uTime.value = t
  gradePass.uniforms.uGlow.value = smooth(1.5, 7.5, t)
  bokehMat.uniforms.uTime.value = t
  bokehMat.uniforms.uAppear.value = smooth(3, 8, t)
  bokehMat.uniforms.uScale.value = trailMat.uniforms.uScale.value
  composer.render()
}

/* =====================================================================
   VAQT BO'YICHA YANGILASH (t = tugma bosilgandan beri soniya)
   ===================================================================== */
function update(t, dt) {
  if (pendingShake) {
    pendingShake = false
    startShed(t)
  }
  const hc = headClock(t) // silkitilgandan keyin gul boshi qaytadan o'sadi

  // ---- poya o'sishi (pastdan yuqoriga) ----
  const sp = easeOut(clamp01((t - T.stemStart) / T.stemDur))
  plant.visible = sp > 0.001
  plant.scale.y = Math.max(sp, 0.001)

  // ---- barglar ochilishi ----
  leaves.forEach((lf, i) => {
    const u = clamp01((t - lf.delay) / T.leafDur),
      e = easeOut(u)
    lf.group.visible = u > 0
    lf.group.scale.setScalar(lerp(0.05, lf.scale, e))
    lf.group.rotation.x = lerp(-1.45, lf.pitch, e)
    const spread = lerp(0.1, 1.0, easeInOut(clamp01((u - 0.15) / 0.85)))
    lf.sides.forEach(({ pivot, s }) => {
      pivot.rotation.y = s * 1.0 * spread
    })
    lf.group.rotation.z = Math.sin(t * 0.9 + i * 1.7) * 0.03 * u
  })

  // ---- kosacha va kurtak ----
  const hs = easeOut(clamp01((hc - T.headStart) / T.headDur))
  head.visible = hs > 0.001
  hip.scale.setScalar(Math.max(hs, 0.001))
  const b1 = clamp01((hc - T.budStart) / T.budDur)
  const op = clamp01((hc - T.openStart) / T.openDur)

  const bud = easeOut(b1) * 0.7
  rose.scale.setScalar(
    Math.max(
      0.0001,
      CONFIG.roseScale *
        (b1 < 1 ? Math.max(bud, 0.0001) : 0.7 + 0.3 * easeInOut(op)) *
        shedShrink(t)
    )
  )
  petals.forEach((p) => {
    p.azG.visible = b1 > 0.001
    const e = easeInOut(clamp01((op - p.delay) / p.dur))
    if (Math.abs(e - p.lastE) > 1e-4) {
      applyPetal(p, e)
      p.lastE = e
    }
  })

  // kosacha barglari: dastlab kurtakni o'rab turadi, keyin pastga qayriladi
  const reflex = easeInOut(clamp01((op - 0.04) / 0.55))
  sepals.forEach((s, i) => {
    s.pivot.rotation.x = lerp(-1.22, 1.3 + i * 0.03, reflex)
    s.pivot.scale.setScalar(Math.max(hs, 0.001))
  })

  heartLight.intensity = 1.4 * smooth(5.0, 7.5, hc)

  // ---- sekin tebranish (shamolda) ----
  const idle = smooth(2.5, 7, t)
  plant.rotation.y = 0.36 * Math.sin(t * 0.33) * idle
  plant.rotation.z = 0.02 * Math.sin(t * 0.8) * idle
  updateSpin(t, dt)

  // ---- yulduzchalar ----
  if (sparkMat) {
    sparkMat.uniforms.uTime.value = t
    sparkMat.uniforms.uAppear.value = smooth(
      T.sparkleStart,
      T.sparkleStart + 1.5,
      t
    )
  }

  // ---- qo'ng'izcha ----
  updateBeetle(t, dt)

  // ---- aylanish yulduzchalari, to'kilgan gulbarglar ----
  updateSpinSparks(t, dt)
  updateShed(t, dt)

  // ---- tushuvchi gulbarglar ----
  if (dt > 0 && t > T.fallStart) {
    fallTimer -= dt
    if (fallTimer <= 0 && falling.length < CONFIG.fallMax) {
      spawnFall()
      fallTimer = 0.9 + Math.random() * 1.3
    }
  }
  for (let i = falling.length - 1; i >= 0; i--) {
    const f = falling[i]
    f.age += dt
    f.m.position.y -= f.vy * dt
    f.m.position.x = f.x0 + Math.sin(f.age * 1.3 + f.ph) * f.sway
    f.m.position.z = f.z0 + Math.cos(f.age * 1.1 + f.ph) * f.sway * 0.6
    f.m.rotation.x += f.spin.x * dt
    f.m.rotation.y += f.spin.y * dt
    f.m.rotation.z += f.spin.z * dt
    const k = Math.min(
      smooth(0, 0.6, f.age),
      1 - smooth(f.life - 1.2, f.life, f.age)
    )
    f.m.scale.setScalar(Math.max(k, 0.0001))
    if (f.age >= f.life) {
      scene.remove(f.m)
      falling.splice(i, 1)
    }
  }
}

/* =====================================================================
   ISHGA TUSHIRISH
   ===================================================================== */
let startMs = null,
  lastMs = 0
function loop(now) {
  const t = (now - startMs) / 1000
  const dt = Math.min(0.05, (now - lastMs) / 1000)
  lastMs = now
  update(t, dt)
  renderFrame(t)
  requestAnimationFrame(loop)
}

function begin() {
  if (startMs !== null) return
  card.classList.add('hide')
  stage.classList.add('grow') // CSS: nur va matn animatsiyalari
  startMusic()
  sfx.initSfx()
  enableMotion() // iOS: silkitishni sezish uchun ruxsat (tugma bosilganda so'raladi)
  muteBtn.classList.add('show')
  startMs = performance.now()
  lastMs = startMs
  requestAnimationFrame(loop)
}
btn.addEventListener('click', begin)

// ovozni o'chirish / yoqish tugmasi
const muteBtn = document.getElementById('muteBtn')
let isMuted = false
muteBtn.addEventListener('click', () => {
  isMuted = !isMuted
  setMuted(isMuted)
  sfx.setSfxMuted(isMuted)
  muteBtn.textContent = isMuted ? '🔇' : '🔊'
})

// Sozlash uchun: ?t=8 deb ochsangiz, animatsiya 8-soniyada qotib turadi
const freeze = new URLSearchParams(window.location.search).get('t')
if (freeze !== null) {
  const go = () => {
  const tf = parseFloat(freeze)
  card.classList.add('hide')
  stage.classList.add('grow')
  for (let s = 0; s <= tf; s += 0.1) update(s, 0.1) // oraliq holatlar (tushuvchi gulbarglar ham)
  update(tf, 0.016)
  renderFrame(tf)
  window.__frozen = true
  }
  Promise.resolve(document.fonts ? document.fonts.load('170px "Great Vibes"') : 0).catch(() => {}).then(() => { textData = null; go() })
}

// Sozlash uchun: ?debug — konsolda window.__rose.shake() bilan silkitishni sinash mumkin
if (new URLSearchParams(location.search).has('debug')) {
  window.__rose = {
    shake: requestShake,
    spin,
    BF,
    SHED,
    petals,
    beetle,
    headG,
    camera,
    ff: (sec) => startMs !== null && (startMs -= sec * 1000), // vaqtni oldinga surish
  }
}
