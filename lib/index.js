// ============================================================================
// emoking · 宿主半区（Cordis 插件）
// ----------------------------------------------------------------------------
// 职责：
//   1) 桌面端唯一可行的注入通道：向 webserver/index-inject 注入一条「内联 script 行」，
//      由页面内联代码创建 <script src="/smoke/widget.js">（吞掉 onerror，绝不让宿主起不来）。
//      web 形态另用 ctx.webServer.tapIndex 注入 <script defer>，两条并存、各自去重。
//   2) 注册 /smoke/* 同源路由：前端脚本/品牌数据/音效/贴图/图标热读 + config/stats 持久化
//      + state.json（当前会话 turn 运行中 / 等待提问、授权）+ about.json（自检）。
//   3) 不依赖任何凭据服务、不联网、不碰其他插件；所有失败静默降级，不影响 DSH 本体。
//
// 参考实现：dsh-whale-widget（同类挂件插件）的注入与路由模式，按本插件需要精简重写。
// 契约见仓库根 SPEC.md 第 2/5 节。
// ============================================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// 路径与版本
// ---------------------------------------------------------------------------
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = path.join(PACKAGE_ROOT, 'assets')
const AUDIO_DIR = path.join(ASSETS_DIR, 'audio')
const IMG_DIR = path.join(ASSETS_DIR, 'img')

// DSH_HOME 默认 ~/.dsh；测试/隔离环境可用环境变量覆盖
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DATA_DIR = path.join(DSH_HOME, 'smoke')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const STATS_FILE = path.join(DATA_DIR, 'stats.json')

let PACKAGE_VERSION = '0.1.0'
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  if (pkg && typeof pkg.version === 'string' && pkg.version) PACKAGE_VERSION = pkg.version
} catch (err) { /* 版本号取不到不影响功能 */ }

// 桌面端注入行：必须是内联 script 且自己吞掉加载失败（推 script-src 行加载失败会让桌面端整个 boot reject）
const DESKTOP_WIDGET_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
  'var s=document.createElement("script");s.src="/smoke/widget.js";' +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

const WIDGET_JS_PATH = '/smoke/widget.js'

// 默认配置（宿主只做对象存储，业务字段由前端解释；缺字段一律沿用已有值，绝不洗掉用户设置）
const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  scale: 1,
  x: null,
  y: null,
  soundOn: true,
  volume: 0.7,
  density: 1,
  autoPuffSec: 6,
  showHints: true,
  hideMenuBtn: false,
  lastProductId: 'chunghwa-hard',
  reduceMotion: false,
  edgeSnap: true,
})

const CONFIG_MAX_BYTES = 64 * 1024
const STATS_MAX_BYTES = 256 * 1024

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
})

const MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.js': 'application/javascript; charset=utf-8',
})

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 路径脱敏：DSH_HOME → $DSH_HOME，用户主目录 → %USERPROFILE%（自检面板用） */
function maskPath(input) {
  let s = String(input == null ? '' : input)
  try {
    if (DSH_HOME) {
      s = s.split(DSH_HOME).join('$DSH_HOME')
      s = s.split(DSH_HOME.replace(/\\/g, '/')).join('$DSH_HOME')
    }
    const home = os.homedir()
    if (home) {
      s = s.split(home).join('%USERPROFILE%')
      s = s.split(home.replace(/\\/g, '/')).join('%USERPROFILE%')
    }
    s = s.replace(/[A-Za-z]:\\Users\\[^\\/]+/g, '%USERPROFILE%')
    s = s.replace(/\/(Users|home)\/[^\/]+/g, '%USERPROFILE%')
  } catch (err) { /* 脱敏失败就原样返回，不阻塞 */ }
  return s
}

function ensureDataDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    return true
  } catch (err) {
    return false
  }
}

/**
 * 读取 JSON 对象文件。
 * 文件不存在 → 返回 fallback；内容坏掉 → 把原文件改名为 .corrupt-<ts>.bak 后返回 fallback，
 * 绝不在坏数据上覆盖写（保护用户记录）。
 */
function readJsonObjectFile(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.trim()) return { ok: true, value: fallback, missing: false }
    const parsed = JSON.parse(text)
    if (isPlainObject(parsed)) return { ok: true, value: parsed, missing: false }
    throw new Error('JSON root is not an object')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, value: fallback, missing: true }
    try {
      if (fs.existsSync(file)) fs.renameSync(file, file + '.corrupt-' + Date.now() + '.bak')
    } catch (renameErr) { /* 改名失败也不抛 */ }
    return { ok: false, value: fallback, missing: false, error: String((err && err.message) || err) }
  }
}

/** 原子写 JSON：临时文件 + rename（Windows 上 rename 覆盖已有文件是原子替换） */
function writeJsonObjectFile(file, value) {
  ensureDataDir()
  const text = JSON.stringify(value, null, 2)
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
  return text.length
}

/** 只合并普通对象；禁止 __proto__ 之类原型污染键 */
function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return isPlainObject(base) ? base : {}
  const out = isPlainObject(base) ? Object.assign({}, base) : {}
  for (const key of Object.keys(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const next = patch[key]
    if (next === undefined) continue
    if (isPlainObject(next) && isPlainObject(out[key])) out[key] = deepMerge(out[key], next)
    else out[key] = next
  }
  return out
}

function methodOf(req) {
  return String((req && req.method) || 'GET').toUpperCase()
}

function pathnameOf(req) {
  try {
    return decodeURIComponent(new URL(String((req && req.url) || '/'), 'http://127.0.0.1').pathname)
  } catch (err) {
    return ''
  }
}

function sendJson(res, status, payload) {
  try {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(payload))
  } catch (err) { /* 连接可能已断开 */ }
}

function sendText(res, status, text) {
  try {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(String(text))
  } catch (err) {}
}

function sendBytes(res, status, bytes, mime) {
  try {
    res.writeHead(status, {
      'Content-Type': mime || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': String(bytes.length),
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(bytes)
  } catch (err) {}
}

function mimeOf(file) {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

function readBodyCapped(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (err) => {
      if (settled) return
      settled = true
      try { req.destroy && req.destroy() } catch (destroyErr) {}
      reject(err)
    }
    try {
      req.on('data', (chunk) => {
        if (settled) return
        size += chunk.length
        if (size > limit) { fail(new Error('body too large')); return }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (settled) return
        settled = true
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      req.on('error', (err) => fail(err))
    } catch (err) {
      fail(err)
    }
  })
}

// ---------------------------------------------------------------------------
// 本机写请求校验：配置/统计的写操作只接受回环地址（插件无凭据，但没理由让远端脚本改本地数据）
// ---------------------------------------------------------------------------
function headerHostname(hostHeader) {
  let host = String(hostHeader || '').trim().toLowerCase()
  if (!host) return ''
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end > 0 ? host.slice(1, end) : ''
  }
  const colon = host.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) return host.slice(0, colon)
  return host
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').toLowerCase()
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  if (Number(m[1]) !== 127) return false
  return [m[2], m[3], m[4]].every((part) => Number(part) <= 255)
}

/** 返回 '' 表示允许，否则返回拒绝原因（用于 403 响应体） */
function writeRejection(req) {
  const hostname = headerHostname(req && req.headers ? req.headers.host : '')
  if (!isLoopbackHostname(hostname)) return 'forbidden: write requests must come from a loopback host'
  const site = String((req && req.headers && req.headers['sec-fetch-site']) || '').toLowerCase()
  if (site === 'cross-site') return 'forbidden: cross-site write request'
  const origin = String((req && req.headers && req.headers.origin) || '').trim()
  if (origin) {
    try {
      const u = new URL(origin)
      if (String(u.hostname || '').toLowerCase() !== hostname.replace(/^\[|\]$/g, '')) {
        return 'forbidden: origin does not match host'
      }
    } catch (err) {
      return 'forbidden: bad origin'
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// 静态资源热读（前端 js 改动只需刷新页面：宿主按 mtime 重新读取）
// ---------------------------------------------------------------------------
const textAssetCache = new Map() // absolutePath -> { mtimeMs, text }

function loadTextAsset(absolutePath) {
  try {
    const stat = fs.statSync(absolutePath)
    const cached = textAssetCache.get(absolutePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.text
    const text = fs.readFileSync(absolutePath, 'utf8')
    textAssetCache.set(absolutePath, { mtimeMs: stat.mtimeMs, text })
    return text
  } catch (err) {
    return ''
  }
}

function safeAssetName(rawName, allowedExt) {
  const name = String(rawName || '').replace(/^\/+/, '')
  if (!name || name.includes('\\') || name.includes('/') || name.includes('..')) return ''
  if (name.startsWith('.') || name.includes(':')) return ''
  const ext = path.extname(name).toLowerCase()
  if (allowedExt.indexOf(ext) === -1) return ''
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return ''
  return name
}

function serveDirFile(res, dir, rawName, allowedExt) {
  const name = safeAssetName(rawName, allowedExt)
  if (!name) return sendText(res, 404, 'not found')
  const file = path.join(dir, name)
  const resolved = path.resolve(file)
  if (resolved !== path.resolve(dir, name) || !resolved.startsWith(path.resolve(dir) + path.sep)) {
    return sendText(res, 404, 'not found')
  }
  try {
    const bytes = fs.readFileSync(resolved)
    return sendBytes(res, 200, bytes, mimeOf(resolved))
  } catch (err) {
    return sendText(res, 404, 'not found')
  }
}

// ---------------------------------------------------------------------------
// session 状态：当前是否有 turn 在跑 / 是否在等提问或授权（供前端做「等待任务时来一根」联动）
// ---------------------------------------------------------------------------
function sessionIdOf(session) {
  if (session === null || session === undefined) return ''
  if (typeof session === 'string') return session
  if (typeof session === 'object') {
    const id = session.id || session.sessionId || session.key || session.name
    if (id !== undefined && id !== null) return String(id)
  }
  return ''
}

function sessionTitleOf(session) {
  try {
    if (session && typeof session === 'object') {
      const candidates = [session.title, session.name, session.summary]
      for (const value of candidates) {
        if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 64)
      }
    }
  } catch (err) {}
  return ''
}

// ---------------------------------------------------------------------------
// 插件本体
// ---------------------------------------------------------------------------
export default {
  name: 'emoking',

  apply(root) {
    // 行注册器在宿主启动时会被立即收集；先把注入行挂上（本行不依赖任何服务）
    const rowDisposers = []
    try {
      root.effect(() => () => {
        for (const dispose of rowDisposers) {
          try { dispose() } catch (err) {}
        }
      })
    } catch (err) {}

    try {
      rowDisposers.push(root.on('webserver/index-inject', (table) => {
        try {
          if (!Array.isArray(table)) return
          for (const row of table) {
            if (!row) continue
            if (row.kind === 'script-src' && row.src === WIDGET_JS_PATH) return // 旧实现推过，去重
            if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(WIDGET_JS_PATH) >= 0) return
          }
          table.push({ kind: 'script', placement: 'body', text: DESKTOP_WIDGET_ROW_TEXT })
        } catch (err) {}
      }))
    } catch (err) {
      // 老宿主没有该事件：web 形态仍可由 tapIndex 注入
    }

    try {
      root.inject(['webServer'], (ctx) => {
        // ---------------- 会话状态 ----------------
        const runningTurns = new Map() // sessionId -> startedAt
        const waitingStates = new Map() // sessionId -> { kind, since }
        const sessionTitles = new Map() // sessionId -> title
        let lastTurnStartAt = 0
        let lastTurnEndAt = 0

        const disposers = []

        function rememberTitle(sid, session) {
          if (!sid) return
          const fromSession = sessionTitleOf(session)
          if (fromSession) { sessionTitles.set(sid, fromSession); return }
          try {
            const svc = typeof ctx.get === 'function' ? ctx.get('sessionTitle') : null
            if (svc && typeof svc.get === 'function') {
              const value = svc.get(session && typeof session === 'object' ? session : { id: sid })
              const title = typeof value === 'string'
                ? value
                : (value && typeof value === 'object' ? (value.title || value.name || '') : '')
              if (typeof title === 'string' && title.trim()) sessionTitles.set(sid, title.trim().slice(0, 64))
            }
          } catch (err) { /* 可选服务，取不到就算了 */ }
        }

        function onSessionEvent(session, event) {
          try {
            const sid = sessionIdOf(session)
            if (!sid) return
            const type = String((event && event.type) || '')
            const data = (event && event.data) || {}
            const now = Date.now()

            if (type === 'turn/start') {
              runningTurns.set(sid, now)
              lastTurnStartAt = now
              waitingStates.delete(sid)
              if (typeof data.title === 'string' && data.title.trim()) sessionTitles.set(sid, data.title.trim().slice(0, 64))
              else rememberTitle(sid, session)
              return
            }
            if (type === 'turn/end') {
              runningTurns.delete(sid)
              waitingStates.delete(sid)
              lastTurnEndAt = now
              return
            }
            if (type === 'tool/call') {
              const name = String(data.name || data.toolName || '')
              if (name === 'ask_user_question') waitingStates.set(sid, { kind: 'question', since: now })
              return
            }
            if (type === 'approval/asked') {
              waitingStates.set(sid, { kind: 'approval', since: now })
              return
            }
            if (type.indexOf('approval/') === 0) {
              waitingStates.delete(sid)
              return
            }
          } catch (err) {}
        }

        function onSessionDisposed(session) {
          try {
            const sid = sessionIdOf(session)
            if (!sid) return
            runningTurns.delete(sid)
            waitingStates.delete(sid)
            sessionTitles.delete(sid)
          } catch (err) {}
        }

        try { disposers.push(ctx.on('session/event', onSessionEvent)) } catch (err) {}
        try { disposers.push(ctx.on('session/disposed', onSessionDisposed)) } catch (err) {}

        function statePayload() {
          const runningEntries = []
          for (const entry of runningTurns.entries()) runningEntries.push(entry)
          let turn = { running: false, since: null, sessionTitle: '' }
          if (runningEntries.length > 0) {
            const since = Math.min.apply(null, runningEntries.map((e) => e[1]))
            const sid = runningEntries[0][0]
            turn = {
              running: true,
              since,
              sessionTitle: sessionTitles.get(sid) || sessionTitleOf(null),
            }
          } else if (lastTurnStartAt) {
            turn = { running: false, since: lastTurnStartAt, sessionTitle: '' }
          }
          const waitingEntries = []
          for (const entry of waitingStates.entries()) waitingEntries.push(entry)
          let waiting = null
          if (waitingEntries.length > 0) {
            waiting = {
              kind: waitingEntries[0][1].kind,
              since: Math.min.apply(null, waitingEntries.map((e) => e[1].since)),
            }
          }
          return {
            ok: true,
            now: Date.now(),
            version: PACKAGE_VERSION,
            turn,
            waiting,
            lastTurnEndAt: lastTurnEndAt || null,
          }
        }

        // ---------------- 路由：统一包装（路由 handler 抛错只回 400，绝不冒泡到宿主） ----------------
        function registerRoute(method, routePath, handler) {
          const wrapped = {
            kind: 'exact',
            path: routePath,
            handler: async (req, res) => {
              try {
                const actual = methodOf(req)
                if (method !== 'ANY' && actual !== method) return sendJson(res, 405, { ok: false, error: 'method not allowed' })
                return await handler(req, res)
              } catch (err) {
                try {
                  if (!res.headersSent) sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
                  else res.destroy && res.destroy()
                } catch (e2) {}
              }
            },
          }
          return ctx.webServer.register(wrapped)
        }

        function registerPrefix(prefixPath, handler) {
          return ctx.webServer.register({
            kind: 'prefix',
            path: prefixPath,
            handler: async (req, res) => {
              try {
                return await handler(req, res)
              } catch (err) {
                try {
                  if (!res.headersSent) sendJson(res, 400, { ok: false, error: String((err && err.message) || err) })
                  else res.destroy && res.destroy()
                } catch (e2) {}
              }
            },
          })
        }

        // ---------------- 静态资源 ----------------
        disposers.push(registerRoute('GET', '/smoke/widget.js', (req, res) => {
          const text = loadTextAsset(path.join(ASSETS_DIR, 'smoke-widget.js'))
          if (!text) return sendText(res, 404, 'smoke-widget.js not found')
          try {
            res.writeHead(200, {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            })
            res.end(text)
          } catch (err) {}
        }))

        disposers.push(registerRoute('GET', '/smoke/brands.js', (req, res) => {
          const text = loadTextAsset(path.join(ASSETS_DIR, 'brands.js'))
          if (!text) return sendText(res, 404, 'brands.js not found')
          try {
            res.writeHead(200, {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            })
            res.end(text)
          } catch (err) {}
        }))

        // v2：真实图片素材映射表（可选文件，缺失 404，由前端静默回退 SVG）
        disposers.push(registerRoute('GET', '/smoke/pack-images.js', (req, res) => {
          const text = loadTextAsset(path.join(ASSETS_DIR, 'pack-images.js'))
          if (!text) return sendText(res, 404, 'pack-images.js not found')
          try {
            res.writeHead(200, {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            })
            res.end(text)
          } catch (err) {}
        }))

        disposers.push(registerRoute('GET', '/smoke/icon.png', (req, res) => {
          try {
            const bytes = fs.readFileSync(path.join(PACKAGE_ROOT, 'icon.png'))
            return sendBytes(res, 200, bytes, 'image/png')
          } catch (err) {
            return sendText(res, 404, 'icon not found')
          }
        }))

        disposers.push(registerPrefix('/smoke/audio', (req, res) => {
          if (methodOf(req) !== 'GET') return sendText(res, 405, 'method not allowed')
          const name = pathnameOf(req).slice('/smoke/audio'.length).replace(/^\/+/, '')
          return serveDirFile(res, AUDIO_DIR, name, ['.wav', '.mp3', '.ogg'])
        }))

        disposers.push(registerPrefix('/smoke/img', (req, res) => {
          if (methodOf(req) !== 'GET') return sendText(res, 405, 'method not allowed')
          const name = pathnameOf(req).slice('/smoke/img'.length).replace(/^\/+/, '')
          return serveDirFile(res, IMG_DIR, name, ['.png', '.webp', '.jpg', '.jpeg', '.gif'])
        }))

        // ---------------- config.json（GET 读 / PUT 部分合并写；同一路径只能注册一次） ----------------
        disposers.push(registerRoute('ANY', '/smoke/config.json', async (req, res) => {
          if (methodOf(req) === 'GET') {
            const stored = readJsonObjectFile(CONFIG_FILE, {})
            const config = stored.ok ? deepMerge(DEFAULT_CONFIG, stored.value) : Object.assign({}, DEFAULT_CONFIG)
            return sendJson(res, 200, { ok: true, version: PACKAGE_VERSION, config })
          }
          if (methodOf(req) !== 'PUT') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const rejection = writeRejection(req)
          if (rejection) return sendJson(res, 403, { ok: false, error: 'forbidden', reason: rejection })
          let body
          try {
            body = await readBodyCapped(req, CONFIG_MAX_BYTES)
          } catch (err) {
            return sendJson(res, 400, { ok: false, error: 'request body too large or unreadable' })
          }
          let patch
          try {
            patch = JSON.parse(body)
          } catch (err) {
            return sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
          }
          if (!isPlainObject(patch)) return sendJson(res, 400, { ok: false, error: 'config patch must be a JSON object' })
          const stored = readJsonObjectFile(CONFIG_FILE, {})
          const merged = deepMerge(deepMerge(DEFAULT_CONFIG, stored.ok ? stored.value : {}), patch)
          try {
            writeJsonObjectFile(CONFIG_FILE, merged)
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: 'failed to persist config: ' + String((err && err.message) || err) })
          }
          return sendJson(res, 200, { ok: true, config: merged })
        }))

        // ---------------- stats.json（GET 读 / PUT 整体写；同一路径只能注册一次） ----------------
        disposers.push(registerRoute('ANY', '/smoke/stats.json', async (req, res) => {
          if (methodOf(req) === 'GET') {
            const stored = readJsonObjectFile(STATS_FILE, {})
            return sendJson(res, 200, { ok: stored.ok, version: PACKAGE_VERSION, stats: stored.ok ? stored.value : {} })
          }
          if (methodOf(req) !== 'PUT') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const rejection = writeRejection(req)
          if (rejection) return sendJson(res, 403, { ok: false, error: 'forbidden', reason: rejection })
          let body
          try {
            body = await readBodyCapped(req, STATS_MAX_BYTES)
          } catch (err) {
            return sendJson(res, 400, { ok: false, error: 'request body too large or unreadable' })
          }
          let stats
          try {
            stats = JSON.parse(body)
          } catch (err) {
            return sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
          }
          if (!isPlainObject(stats)) return sendJson(res, 400, { ok: false, error: 'stats must be a JSON object' })
          try {
            writeJsonObjectFile(STATS_FILE, stats)
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: 'failed to persist stats: ' + String((err && err.message) || err) })
          }
          return sendJson(res, 200, { ok: true, stats })
        }))

        disposers.push(registerRoute('POST', '/smoke/reset.json', async (req, res) => {
          const rejection = writeRejection(req)
          if (rejection) return sendJson(res, 403, { ok: false, error: 'forbidden', reason: rejection })
          let body = ''
          try { body = await readBodyCapped(req, 4096) } catch (err) { body = '' }
          let parsed = {}
          if (body.trim()) {
            try {
              parsed = JSON.parse(body)
            } catch (err) {
              return sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
            }
          }
          const what = parsed && typeof parsed.what === 'string' ? parsed.what : 'all'
          if (what !== 'stats' && what !== 'config' && what !== 'all') {
            return sendJson(res, 400, { ok: false, error: 'invalid what' })
          }
          const removed = []
          try {
            if (what === 'stats' || what === 'all') { fs.rmSync(STATS_FILE, { force: true }); removed.push('stats') }
            if (what === 'config' || what === 'all') { fs.rmSync(CONFIG_FILE, { force: true }); removed.push('config') }
          } catch (err) {
            return sendJson(res, 500, { ok: false, error: 'failed to reset: ' + String((err && err.message) || err) })
          }
          return sendJson(res, 200, { ok: true, removed })
        }))

        // ---------------- state.json（前端轮询：等待任务联动） ----------------
        disposers.push(registerRoute('GET', '/smoke/state.json', (req, res) => {
          return sendJson(res, 200, statePayload())
        }))

        // ---------------- about.json（设置里的「自检」） ----------------
        disposers.push(registerRoute('GET', '/smoke/about.json', (req, res) => {
          const files = [
            ['plugin', path.join(PACKAGE_ROOT, 'package.json')],
            ['host', path.join(PACKAGE_ROOT, 'lib', 'index.js')],
            ['widget', path.join(ASSETS_DIR, 'smoke-widget.js')],
            ['brands', path.join(ASSETS_DIR, 'brands.js')],
            ['icon', path.join(PACKAGE_ROOT, 'icon.png')],
            ['packImages', path.join(ASSETS_DIR, 'pack-images.js')],
            ['config', CONFIG_FILE],
            ['stats', STATS_FILE],
          ].map(([label, file]) => {
            let exists = false
            let bytes = 0
            let mtime = null
            try {
              const stat = fs.statSync(file)
              exists = stat.isFile()
              bytes = stat.size
              mtime = stat.mtimeMs
            } catch (err) {}
            return { label, path: maskPath(file), exists, bytes, mtime }
          })
          const audioNames = []
          const imgNames = []
          try {
            for (const name of fs.readdirSync(AUDIO_DIR)) if (/\.(wav|mp3|ogg)$/i.test(name)) audioNames.push(name)
          } catch (err) {}
          try {
            for (const name of fs.readdirSync(IMG_DIR)) if (/\.(png|webp|jpg|jpeg|gif)$/i.test(name)) imgNames.push(name)
          } catch (err) {}
          return sendJson(res, 200, {
            ok: true,
            name: 'emoking',
            version: PACKAGE_VERSION,
            packageRoot: maskPath(PACKAGE_ROOT),
            dataDir: maskPath(DATA_DIR),
            files,
            assets: { audio: audioNames, img: imgNames },
            routes: [
              'GET /smoke/widget.js',
              'GET /smoke/brands.js',
              'GET /smoke/pack-images.js',
              'GET /smoke/icon.png',
              'GET /smoke/audio/<name>',
              'GET /smoke/img/<name>',
              'GET|PUT /smoke/config.json',
              'GET|PUT /smoke/stats.json',
              'POST /smoke/reset.json',
              'GET /smoke/state.json',
              'GET /smoke/about.json',
            ],
            host: {
              platform: process.platform,
              arch: process.arch,
              node: process.version,
              version: PACKAGE_VERSION,
              desktop: process.env.DSH_CLIENT_VERSION || process.env.DSH_VERSION || '',
            },
            injection: {
              desktopRow: true,
              sessionEvents: true,
            },
          })
        }))

        // ---------------- web 形态（dsh web 浏览器直接用 3080 端口）的 index 注入 ----------------
        try {
          disposers.push(ctx.webServer.tapIndex((html) => {
            try {
              if (typeof html !== 'string') return html
              if (html.indexOf(WIDGET_JS_PATH) !== -1) return html
              const tag = '<script defer src="' + WIDGET_JS_PATH + '"></script>'
              if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
              return html + tag
            } catch (err) {
              return html
            }
          }))
        } catch (err) { /* 老宿主/桌面端没有 tapIndex：靠注入行 */ }

        // ---------------- 卸载时清理路由/监听 ----------------
        try {
          ctx.effect(() => () => {
            for (const dispose of disposers) {
              try { dispose() } catch (err) {}
            }
          })
        } catch (err) {}
      })
    } catch (err) {
      // 没有 webServer 服务（极老宿主）：静默降级，不影响 DSH 启动
    }
  },
}
