/* ============================================================================
 * emoking · 前端主体（虚拟烟替代工具）（单文件自包含，无 import / 无依赖 / 无 React）
 * ----------------------------------------------------------------------------
 * 分区：
 *   0. 常量与全局闸门        1. 工具函数            2. 主题检测
 *   3. 品牌数据与归一化      4. 烟盒 / 烟支 / 道具 SVG 渲染
 *   5. 样式注入              6. 主场景 DOM
 *   7. 状态机                8. Canvas 烟雾粒子
 *   9. 面板（烟柜/账本/设置） 10. 快捷菜单 / 气泡 / Toast
 *  11. 音效                  12. 宿主 API（/smoke/* + localStorage 降级）
 *  13. 任务状态轮询联动      14. 拖拽 / 缩放 / 吸附 / 启动 / 预览演示
 *
 * 约束：只写 #smk-root 内部 DOM；初始化与关键循环全部 try/catch；
 *       /smoke/* 不可用时自动降级 localStorage（设置里显示「预览模式」）。
 * emoking · 虚拟烟替代工具：帮助减少真实吸烟与二手烟污染。纯模拟，不含真实烟草，不涉及销售。吸烟有害健康。
 * ==========================================================================*/
(function () {
  'use strict';
  /* 只在同一个 window 初始化一次 */
  if (window.__dshSmokeWidget) return;
  window.__dshSmokeWidget = true;
  var WIDGET_VERSION = '0.12.0';
  var STYLE_ID = 'smk-style';
  var ROOT_ID = 'smk-root';
  var CFG_KEY = 'smk.config.v1';
  var STATS_KEY = 'smk.stats.v1';

  /* ==========================================================================
   * 0. 常量
   * ========================================================================*/
  var IS_PREVIEW = (function () {
    try {
      if (window.__SMOKE_PREVIEW) return true;
      if (/\/preview\/index\.html?$/i.test(location.pathname)) return true;
      if (location.protocol === 'file:') return true;
      return false;
    } catch (e) { return false; }
  })();

  var DEFAULT_CONFIG = {
    version: 1, scale: 1, x: null, y: null, soundOn: true, volume: 0.7,
    density: 1, autoPuffSec: 6, showHints: true, hideMenuBtn: false,
    lastProductId: 'chunghwa-hard', reduceMotion: false, edgeSnap: true,
    favorites: [], autoPuff: false, hidden: false, cabinetW: 560
  };
  var DEFAULT_STATS = {
    version: 1,
    buttCount: 0,
    days: {},
    total: { smoked: 0, puffs: 0, seconds: 0 },
    products: {},
    achievements: {},
    packOpened: 0,
    opens: 0,
    flicks: 0,
    handBurns: 0,
    cigars: 0,
    cigarCuts: 0,
    nightSmokes: 0,
    late2: 0,
    streak: { count: 0, last: 0, best: 0 },
    createdAt: 0,
    updatedAt: 0
  };
  var PACK_SIZE = 20;
  var DEFAULT_SCALE = 1;
  var SCALE_MIN = 0.7;
  var SCALE_MAX = 2.0;
  /* 粒子池上限（SPEC 要求 ≤220） */
  var PARTICLE_CAP = 560;
  /* 状态机相位 */
  var PHASE = {
    IDLE: 'idle', OPENING: 'opening', OUT: 'out', TAKEN: 'taken', CUTTING: 'cutting',
    LIGHTING: 'lighting', LIT: 'lit', BURNT: 'burnt', BUTT: 'butt', BUYING: 'buying'
  };
  var PHASE_LABEL = {
    idle: '闲着', opening: '开盒中', out: '等你拿', taken: '叼上了', cutting: '剪茄帽',
    lighting: '点着呢', lit: '燃着', burnt: '快灭了', butt: '收尾', buying: '补货中'
  };

  /* ==========================================================================
   * 1. 工具函数
   * ========================================================================*/
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return pad2(m) + ':' + pad2(s);
  }
  function fmtMinutes(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    if (m <= 0) return s + ' 秒';
    return m + ' 分' + (s ? ' ' + s + ' 秒' : '');
  }
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dayKeyOffset(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    return todayKey(d);
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { try { fn.apply(self, args); } catch (e) {} }, ms);
    };
  }
  function throttle(fn, ms) {
    var last = 0, t = 0, lastArgs = null;
    return function () {
      var now = Date.now(), args = arguments, self = this;
      lastArgs = args;
      if (now - last >= ms) { last = now; try { fn.apply(self, args); } catch (e) {} }
      else if (!t) {
        t = setTimeout(function () {
          t = 0; last = Date.now();
          try { fn.apply(self, lastArgs); } catch (e) {}
        }, ms - (now - last));
      }
    };
  }
  function deepMerge(base, patch) {
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (!patch || typeof patch !== 'object') return out;
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else if (v !== undefined) out[k] = v;
    }
    return out;
  }
  function svgText(t) { return escapeHtml(String(t)).replace(/\n/g, ' '); }
  function fmtPrice(p) {
    if (!p || !isFinite(p)) return '价格不详';
    if (!p) return '价格不详';
    return '¥' + (p >= 100 ? String(Math.round(p)) : String(p));
  }
  function productLabel(p) {
    if (!p) return '';
    return p.name || p.brand || p.id || '无名烟';
  }
  function nowMs() { try { return Date.now(); } catch (e) { return +new Date(); } }
  /* 轻量事件日志：仅调试接口读取，不产生副作用 */
  var SMK_LOG = [];
  function dlog(m) {
    try {
      SMK_LOG.push(Math.round(nowMs() % 1000000) + ' ' + m);
      if (SMK_LOG.length > 120) SMK_LOG.shift();
    } catch (e) {}
  }

  /* 颜色工具 */
  function hex2rgb(hex) {
    var h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
  }
  function rgb2hex(r, g, b) {
    function h(n) { n = clamp(Math.round(n), 0, 255); return (n < 16 ? '0' : '') + n.toString(16); }
    return '#' + h(r) + h(g) + h(b);
  }
  function tint(hex, amt) { /* amt>0 变亮，<0 变暗 */
    var c = hex2rgb(hex);
    if (amt >= 0) return rgb2hex(lerp(c.r, 255, amt), lerp(c.g, 255, amt), lerp(c.b, 255, amt));
    return rgb2hex(c.r * (1 + amt), c.g * (1 + amt), c.b * (1 + amt));
  }
  function rgba(hex, a) {
    var c = hex2rgb(hex);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + clamp(a, 0, 1) + ')';
  }
  function isLightColor(hex) {
    var c = hex2rgb(hex);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 150;
  }
  function contrastInk(bg, a, b) { return isLightColor(bg) ? (a || '#2a1c0d') : (b || '#fff6e8'); }

  /* 简易本地存储（file:// 下 localStorage 可能抛错） */
  var memoryStore = {};
  var store = {
    get: function (k) {
      try { var v = window.localStorage.getItem(k); return v == null ? null : v; }
      catch (e) { return Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem(k, v); return true; }
      catch (e) { memoryStore[k] = v; return false; }
    },
    remove: function (k) {
      try { window.localStorage.removeItem(k); } catch (e) {}
      try { delete memoryStore[k]; } catch (e) {}
    }
  };

  /* ==========================================================================
   * 2. 主题检测（DSH 暗/亮主题；暗色优先，卡片保持深色玻璃，仅微调外框）
   * ========================================================================*/
  var theme = { dark: true, sync: null };
  function detectTheme() {
    var dark = true;
    try {
      var de = document.documentElement;
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
      if (mq && mq.matches) dark = false;
      var attr = (de.getAttribute('data-theme') || de.getAttribute('data-color-scheme') || '').toLowerCase();
      var cls = (de.className || '').toString().toLowerCase();
      if (attr.indexOf('light') >= 0 || cls.indexOf('theme-light') >= 0) dark = false;
      if (attr.indexOf('dark') >= 0 || cls.indexOf('theme-dark') >= 0) dark = true;
      var cs = window.getComputedStyle && window.getComputedStyle(de);
      if (cs) {
        var bg = cs.getPropertyValue('background-color');
        var m = bg && bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          var lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
          dark = lum < 0.5;
        }
      }
    } catch (e) {}
    return dark;
  }
  function applyTheme() {
    try {
      var dark = detectTheme();
      theme.dark = dark;
      if (rootEl) {
        rootEl.classList.toggle('smk-theme-dark', dark);
        rootEl.classList.toggle('smk-theme-light', !dark);
      }
    } catch (e) {}
  }
  function watchTheme() {
    try {
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
      if (mq) {
        var onMq = function () { applyTheme(); };
        if (mq.addEventListener) mq.addEventListener('change', onMq);
        else if (mq.addListener) mq.addListener(onMq);
      }
      if (typeof MutationObserver === 'function') {
        var mo = new MutationObserver(throttle(applyTheme, 300));
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
        if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
      }
    } catch (e) {}
  }

  /* ==========================================================================
   * 3. 品牌数据与产品归一化（只依赖 window.SMOKE_BRANDS 结构）
   * ========================================================================*/
  var FALLBACK_PRODUCT = {
    id: 'fallback-chunghwa', brand: '中华', brandEn: 'Chunghwa', variant: '硬盒',
    name: '中华（硬）', category: 'cig', type: 'hard', blend: '烤烟型', origin: 'CN',
    tier: 'premium', price: 50, priceText: '约 ¥50/包', tar: 11, nicotine: 1.0,
    lengthMm: 84, burnPuffs: 10,
    pack: {
      style: 'hard', bg: '#a5121b', bg2: '#6e0b12', accent: '#e6c46a', ink: '#fff6e8',
      pattern: 'tiananmen', patternColor: '#f0d58a', band: 'top', bandColor: '#e6c46a',
      emblem: '中华', emblemStyle: 'brush', brandPosition: 'vertical', badge: '',
      foil: true, emboss: true, warningBand: true
    },
    cig: { paper: '#f5efe0', filterColor: '#c99a5b', filterPattern: 'cork', filterLength: 0.3, ringColor: '#d8b35a' },
    smoke: { density: 1.0, color: 'warm', drift: 1.0 },
    flavor: ['木香', '坚果'], tagline: '国烟经典', description: '兜底的一支烟。'
  };

  function normalizeProduct(raw, idx) {
    if (!raw || typeof raw !== 'object') return null;
    var p = deepMerge(FALLBACK_PRODUCT, raw);
    p.pack = deepMerge(FALLBACK_PRODUCT.pack, raw.pack || {});
    if (raw.pack && !raw.pack.pattern) p.pack.pattern = 'plain';
    if (raw.pack && raw.pack.band == null) p.pack.band = 'none';
    p.cig = deepMerge(FALLBACK_PRODUCT.cig, raw.cig || {});
    p.smoke = deepMerge(FALLBACK_PRODUCT.smoke, raw.smoke || {});
    p.category = (raw.category || 'cig');
    if (raw.origin == null) {
      if (p.category === '外烟') p.origin = 'XX';
      else if (p.category === '雪茄') p.origin = 'CU';
      else p.origin = 'CN';
    }
    p.type = (raw.type || p.category || 'hard');
    p.burnPuffs = clamp(+p.burnPuffs || 10, 6, 16);
    p.tar = isFinite(+p.tar) ? +p.tar : 10;
    p.nicotine = isFinite(+p.nicotine) ? +p.nicotine : 1;
    p.price = isFinite(+p.price) ? +p.price : 0;
    p.lengthMm = clamp(+p.lengthMm || 84, 70, 200);
    p.flavor = Array.isArray(p.flavor) ? p.flavor.slice(0, 3) : [];
    p.smoke.density = clamp(+p.smoke.density || 1, 0.4, 2.0);
    p.smoke.drift = clamp(+p.smoke.drift || 1, 0.6, 1.8);
    p.__idx = idx || 0;
    p.__search = [
      p.brand, p.brandEn, p.name, p.variant, p.id, p.blend,
      (p.flavor || []).join(' ')
    ].join(' ').toLowerCase();
    return p;
  }

  var brands = { version: '', products: [] };
  var REMOVED_SKUS = ['cohiba-lanceros', 'montecristo-no2', 'romeo-julieta-churchill'];
  function readBrandData() {
    var src = null;
    try {
      if (window.SMOKE_BRANDS && Array.isArray(window.SMOKE_BRANDS.products) && window.SMOKE_BRANDS.products.length) src = window.SMOKE_BRANDS;
    } catch (e) {}
    var products = [];
    if (src) {
      brands.version = src.version || '';
      for (var i = 0; i < src.products.length; i++) {
        var n = normalizeProduct(src.products[i], i);
        if (n && n.id && REMOVED_SKUS.indexOf(n.id) < 0) products.push(n);
      }
    }
    if (!products.length) {
      brands.version = 'fallback';
      products = [normalizeProduct(FALLBACK_PRODUCT, 0)];
    }
    brands.products = products;
    return products;
  }
  function findProduct(id) {
    var list = brands.products;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ==========================================================================
   * 3.5 v3：SKU 烟支真实规格 / 人生思考 / 烟灰缸图
   * ========================================================================*/
  var DIAMETER_BY_FORMAT = { regular: 7.8, slim: 5.4, medium: 6.5, short: 7.8, king: 7.9, cigar: 19.8 };
  function cigSpec(p) {
    p = p || product || {};
    var fmt = String(p.format || '').toLowerCase();
    var cat = String(p.category || 'cig');
    var isCigar = cat === 'cigar' || fmt === 'cigar' || fmt.indexOf('cigar') === 0 || fmt === 'robusto' || fmt === 'toro';
    if (!fmt) {
      if (cat === 'slim') fmt = 'slim';
      else if (cat === 'medium') fmt = 'medium';
      else if (isCigar) fmt = 'cigar';
      else if (+p.lengthMm && +p.lengthMm < 75) fmt = 'short';
      else fmt = 'regular';
    }
    var d = +p.diameterMm;
    if (!d || d < 2) d = DIAMETER_BY_FORMAT[fmt] || (cat === 'slim' ? 5.4 : cat === 'medium' ? 6.5 : isCigar ? 19.8 : 7.8);
    if (!isCigar && d > 9.5) d = DIAMETER_BY_FORMAT[fmt] || 7.8;
    var L = +p.lengthMm;
    if (!L || L < 30) L = isCigar ? 140 : cat === 'slim' ? 97 : fmt === 'short' ? 70 : 84;
    var fl = +p.filterLengthMm;
    if (!fl || fl < 6 || fl >= L * 0.75) {
      var frac = +((p.cig && p.cig.filterLength) || 0) || (isCigar ? 0 : 0.3);
      fl = isCigar ? 0 : Math.round(L * frac);
    }
    return {
      fmt: isCigar ? 'cigar' : fmt,
      isCigar: !!isCigar,
      isSlim: !isCigar && (fmt === 'slim' || d <= 5.7),
      isMedium: !isCigar && (fmt === 'medium' || (d > 5.7 && d < 7.2)),
      isShort: !isCigar && (fmt === 'short' || L < 76),
      diameter: d,
      length: L,
      filterMm: fl,
      filterFrac: isCigar ? 0 : clamp(fl / L, 0.08, 0.55),
      burnPuffs: clamp(+p.burnPuffs || (isCigar ? 14 : 10), 6, 24)
    };
  }
  function isCigarProduct(p) { return cigSpec(p).isCigar; }

  function ashtrayImageFor(p) {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      var isCigar = false;
      try { isCigar = cigSpec(p || product).isCigar; } catch (e) {}
      if (m) {
        if (isCigar && m.ashtrayCigar) return imgUrl(typeof m.ashtrayCigar === 'string' ? m.ashtrayCigar : (m.ashtrayCigar.img || m.ashtrayCigar.png));
        if (m.ashtray) return imgUrl(typeof m.ashtray === 'string' ? m.ashtray : (m.ashtray.img || m.ashtray.png));
      }
      return imgUrl(isCigar ? 'ashtray-cigar.png' : 'ashtray.png');
    } catch (e) { return null; }
  }
  /* 渲染烟灰缸（普通/雪茄陶瓷款），并重建烟蒂层 */
  function renderAshtrayView() {
    try {
      if (!ashtrayEl) return;
      var src = ashtrayImageFor(product);
      var oldButts = buttLayer ? buttLayer.innerHTML : '';
      if (src) {
        ashtrayEl.innerHTML = '';
        var img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.onerror = function () { try { img.style.display = 'none'; } catch (e) {} try { restoreSvgTray(); renderButts(); } catch (e) {} try { noteAssetFailure(); } catch (e) {} };
        img.src = src;
        ashtrayEl.appendChild(img);
        var bl = document.createElement('div');
        bl.className = 'smk-buttlayer';
        bl.id = 'smk-butts';
        ashtrayEl.appendChild(bl);
        ashtrayEl.classList.add('photo');
        buttLayer = bl;
        buttLayer.innerHTML = oldButts;
      } else {
        restoreSvgTray();
        renderButts();
      }
    } catch (e) {}
  }
  /* 宿主模式下 brands.js 可能晚于 widget.js 加载：动态引一次 */
  function ensureBrands(cb) {
    readBrandData();
    if (brands.products.length && brands.version !== 'fallback') { cb(); return; }
    if (IS_PREVIEW) { cb(); return; }
    try {
      var s = document.createElement('script');
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        try { readBrandData(); } catch (e) {}
        cb();
      }
      s.src = '/smoke/brands.js';
      s.async = true;
      s.onload = finish;
      s.onerror = finish;
      (document.head || document.documentElement).appendChild(s);
      setTimeout(finish, 2500);
    } catch (e) { cb(); }
  }

  /* ==========================================================================
   * 4. 视觉常量（颜色 / 字体栈 / 尺寸）
   * ========================================================================*/
  /* SVG 里 font-family 是双引号属性，字体栈内一律用单引号，避免把属性提前截断 */
  var FONT_UI = 'YouYuan,"YouYuan","幼圆","Yuanti SC",sans-serif';
  var FONT_SERIF = "'Songti SC','STSong','SimSun','Noto Serif SC',serif";
  var FONT_SANS = "'Segoe UI','Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif";
  var FONT_SCRIPT = "'Segoe Script','Brush Script MT','STXingkai','Kaiti SC',cursive";
  var FONT_BRUSH = "'STKaiti','KaiTi','Kaiti SC','STXingkai','Xingkai SC',cursive";
  var FONT_BLOCK = "'Arial Black','Impact','Haettenschweiler','Segoe UI Black',sans-serif";
  var EMBLEM_FONT = {
    serif: FONT_SERIF, sans: FONT_SANS, script: FONT_SCRIPT, brush: FONT_BRUSH, block: FONT_BLOCK
  };
  var SMOKE_PALETTE = {
    warm: { core: '#fff8ee', mid: '#f0e7db', soft: '#cfc3b4' },
    cool: { core: '#f7fbff', mid: '#e2eaf3', soft: '#b9c4d1' },
    white: { core: '#ffffff', mid: '#f4f6f5', soft: '#d3d8d5' },
    vapor: { core: '#ffffff', mid: '#f8f9fa', soft: '#dfe4e7' },
    ash: { core: '#d8d2c8', mid: '#a29b90', soft: '#6d675f' }
  };

  /* ==========================================================================
   * 5. 样式注入（一次性 <style>，全部 smk- 命名空间）
   * ========================================================================*/
  var CSS = [
    /* ---- 根 / 挂件骨架 ---- */
    '#smk-root{position:fixed;left:0;top:0;width:0;height:0;z-index:9990;font-family:' + FONT_UI + ';pointer-events:none;color-scheme:dark;line-height:1.35;-webkit-font-smoothing:antialiased}',
    '#smk-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}',
    '#smk-root button,#smk-root input,#smk-root textarea{font-family:inherit!important}',
    '.smk-widget{position:fixed;right:112px;bottom:18px;width:190px;height:272px;pointer-events:auto;user-select:none;-webkit-user-select:none;transform-origin:100% 100%;touch-action:none;z-index:9990}',
    '.smk-widget.smk-no-anim,.smk-widget.smk-no-anim *{transition:none!important;animation:none!important}',
    '.smk-card{position:absolute;inset:0;border-radius:17px;overflow:hidden;display:flex;flex-direction:column;background:linear-gradient(168deg,rgba(44,35,28,.94) 0%,rgba(26,21,18,.96) 46%,rgba(13,11,10,.985) 100%);border:1px solid rgba(236,203,138,.20);box-shadow:0 24px 44px -18px rgba(0,0,0,.78),0 4px 14px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,236,196,.10),inset 0 0 26px rgba(255,173,84,.045);transition:box-shadow .3s ease,transform .25s ease}',
    '.smk-card:before{content:"";position:absolute;right:-34px;top:-40px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(255,176,88,.20),rgba(255,140,60,.055) 55%,transparent 72%);pointer-events:none;z-index:0}',
    '.smk-card:after{content:"";position:absolute;inset:0;border-radius:17px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.035);pointer-events:none;z-index:6}',
    '.smk-widget:not(.smk-dragging):hover .smk-card{box-shadow:0 28px 54px -18px rgba(0,0,0,.82),0 4px 18px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,236,196,.14),inset 0 0 30px rgba(255,173,84,.06)}',
    '.smk-widget.smk-dragging .smk-card{transform:scale(.985);box-shadow:0 30px 60px -16px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,236,196,.14)}',
    '.smk-widget.smk-dragging{cursor:grabbing}',
    /* ---- 顶栏 ---- */
    '.smk-top{position:relative;z-index:5;display:flex;align-items:center;gap:5px;padding:7px 7px 6px 10px;cursor:grab;border-bottom:1px solid rgba(255,255,255,.055);background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,0));flex:0 0 auto}',
    '.smk-widget.smk-dragging .smk-top{cursor:grabbing}',
    '.smk-led{width:5px;height:5px;border-radius:50%;background:#8a7a68;flex:0 0 auto;transition:background .3s,box-shadow .3s}',
    '.smk-led.on{background:#ffb46b;box-shadow:0 0 7px 1px rgba(255,150,70,.75)}',
    '.smk-led.lit{background:#ff7a3c;box-shadow:0 0 9px 2px rgba(255,96,40,.8);animation:smk-breathe 2.6s ease-in-out infinite}',
    '.smk-top-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.smk-brandline{display:flex;align-items:center;gap:5px;font-size:10.5px;font-weight:650;letter-spacing:.02em;color:#f1e3c8;white-space:nowrap}',
    '.smk-brandname{overflow:hidden;text-overflow:ellipsis;max-width:74px}',
    '.smk-rest{color:#c4ad84;font-weight:500;font-variant-numeric:tabular-nums;font-size:9.5px}',
    '.smk-stat{font-size:8.5px;color:#9b8b74;letter-spacing:.03em;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.smk-stat .smk-lit-txt{color:#ffae6a}',
    '.smk-top-btns{display:flex;align-items:center;gap:2px;flex:0 0 auto}',
    '.smk-iconbtn{width:19px;height:19px;padding:0;border:none;border-radius:6px;background:transparent;color:#a9977c;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;transition:background .18s,color .18s}',
    '.smk-iconbtn:hover{background:rgba(236,203,138,.16);color:#ffe0a0}',
    '.smk-iconbtn svg{display:block;width:11px;height:11px}',
    '.smk-iconbtn.smk-hidden{display:none}',
    /* ---- 任务状态条 ---- */
    '.smk-turnbar{position:absolute;left:0;right:0;top:0;z-index:6;display:none;align-items:center;gap:5px;padding:3px 9px;font-size:8.5px;letter-spacing:.02em;color:#f2c98d;background:linear-gradient(180deg,rgba(64,40,16,.94),rgba(48,30,12,.72));border-bottom:1px solid rgba(255,190,110,.16);white-space:nowrap;overflow:hidden}',
    '.smk-turnbar.on{display:flex}',
    '.smk-turnbar .smk-spin{width:7px;height:7px;border-radius:50%;border:1.4px solid rgba(255,190,110,.25);border-top-color:#ffb45c;animation:smk-spin 1s linear infinite;flex:0 0 auto}',
    '.smk-turnbar .smk-turn-txt{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}',
    '.smk-turnbar .smk-turn-clock{font-variant-numeric:tabular-nums;color:#ffd9a3;flex:0 0 auto}',
    /* ---- 舞台 ---- */
    '.smk-stage{position:relative;flex:1 1 auto;overflow:hidden;min-height:0;background:radial-gradient(120% 90% at 50% 8%,rgba(255,180,100,.075),transparent 55%),radial-gradient(90% 70% at 50% 100%,rgba(0,0,0,.42),transparent 60%),linear-gradient(180deg,#191410 0%,#221a14 48%,#140f0c 100%)}',
    '.smk-stage:before{content:"";position:absolute;inset:0;background-image:repeating-linear-gradient(102deg,rgba(255,235,200,.028) 0 2px,transparent 2px 7px),repeating-linear-gradient(12deg,rgba(0,0,0,.22) 0 3px,transparent 3px 9px);opacity:.55;pointer-events:none;z-index:0}',
    '.smk-stage:after{content:"";position:absolute;inset:0;background:radial-gradient(115% 82% at 50% 44%,transparent 52%,rgba(0,0,0,.48) 100%);pointer-events:none;z-index:4}',
    '.smk-canvas{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5}',
    '.smk-effects{position:absolute;inset:0;pointer-events:none;z-index:2}',
    '.smk-packwrap{position:absolute;left:50%;bottom:24px;transform:translateX(-50%) rotate(-2.5deg);z-index:2;transition:transform .45s cubic-bezier(.2,.85,.25,1),filter .45s,opacity .35s;filter:drop-shadow(0 9px 9px rgba(0,0,0,.6)) drop-shadow(0 0 12px rgba(255,170,80,.06));cursor:pointer;will-change:transform}',
    '.smk-packwrap svg{display:block;height:auto}',
    '.smk-packwrap:hover{filter:drop-shadow(0 10px 12px rgba(0,0,0,.62)) drop-shadow(0 0 16px rgba(255,180,90,.18))}',
    '.smk-packwrap.smk-pack-open{transform:translateX(-50%) translateY(-9px) rotate(-7deg) scale(1.03)}',
    '.smk-packwrap.smk-pack-lit{transform:translateX(-50%) translateY(11px) scale(.93) rotate(-1deg);opacity:.9}',
    '.smk-packwrap.smk-pack-empty{opacity:.28;filter:grayscale(.85) drop-shadow(0 8px 8px rgba(0,0,0,.5));pointer-events:none}',
    '.smk-packwrap.smk-pack-gone{opacity:0;transform:translateX(-50%) translateY(6px) scale(.9);pointer-events:none}',
    '.smk-packshadow{position:absolute;left:50%;bottom:19px;width:92px;height:11px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.6),rgba(0,0,0,0) 70%);z-index:1;transition:opacity .4s}',
    /* ---- 烟支 ---- */
    '.smk-cigwrap{position:absolute;z-index:3;opacity:0;pointer-events:none;transform-origin:50% 100%;transition:opacity .3s,transform .5s cubic-bezier(.22,.9,.3,1),left .5s cubic-bezier(.22,.9,.3,1),top .5s cubic-bezier(.22,.9,.3,1),width .5s,height .5s,filter .3s;filter:drop-shadow(0 5px 6px rgba(0,0,0,.55))}',
    '.smk-cigwrap svg{display:block;width:100%;height:100%;overflow:visible}',
    '.smk-cigwrap.smk-show{opacity:1}',
    '.smk-cigwrap.smk-cig-held{transform:rotate(16deg)}',
    '.smk-cigwrap.smk-cig-holdable{pointer-events:auto;cursor:pointer}',
    '.smk-cigwrap.smk-cig-holdable:hover{filter:drop-shadow(0 6px 8px rgba(0,0,0,.6)) drop-shadow(0 0 10px rgba(255,170,80,.2))}',
    '.smk-cigwrap.smk-cig-puff{animation:smk-puffkick .4s ease}',
    '#smk-root .smk-cigwrap.smk-cig-lying,#smk-root .smk-cigwrap.smk-cig-held{transform-origin:50% 100%}',
    /* ---- 打火机 ---- */
    '.smk-lighter{position:absolute;right:9px;bottom:26px;width:26px;z-index:4;opacity:0;transform:translateY(7px) rotate(8deg);transition:opacity .28s,transform .35s;cursor:pointer;pointer-events:none;filter:drop-shadow(0 5px 5px rgba(0,0,0,.5))}',
    '.smk-lighter svg{display:block;width:100%;height:auto}',
    '.smk-lighter.on{opacity:1;transform:translateY(0) rotate(0);pointer-events:auto}',
    '.smk-lighter:hover{filter:drop-shadow(0 5px 7px rgba(0,0,0,.55)) drop-shadow(0 0 10px rgba(255,150,60,.35))}',
    '.smk-flame{position:absolute;left:50%;bottom:86%;width:11px;height:17px;margin-left:-5.5px;opacity:0;transform-origin:50% 100%;pointer-events:none;filter:blur(.2px)}',
    '.smk-flame.on{opacity:1}',
    '.smk-flame i{position:absolute;left:2px;bottom:0;width:7px;height:13px;border-radius:50% 50% 45% 45%;background:radial-gradient(ellipse at 50% 72%,#fff7cf 0%,#ffd57a 28%,#ff9a3d 62%,rgba(255,110,40,0) 82%);filter:blur(.6px);animation:smk-flame 0.55s ease-in-out infinite alternate}',
    '.smk-flame i.smk-f2{left:1px;width:9px;height:16px;opacity:.6;animation-duration:.42s;animation-direction:alternate-reverse}',
    /* ---- 烟灰缸 ---- */
    '.smk-ashtray{position:absolute;left:50%;bottom:-9px;transform:translateX(-50%);width:120px;z-index:1;opacity:.96;pointer-events:none;filter:drop-shadow(0 4px 8px rgba(0,0,0,.55))}',
    '.smk-ashtray svg{display:block;width:100%;height:auto}',
    '.smk-buttlayer{position:absolute;inset:0;pointer-events:none}',
    '.smk-butt{position:absolute;width:13px;height:3px;border-radius:2px;background:linear-gradient(90deg,#e9e2d0 0 58%,#b98a4d 58% 100%);box-shadow:0 0 2px rgba(0,0,0,.4)}',
    '.smk-butt.smk-butt-ash{background:linear-gradient(90deg,#58524c 0 22%,#8d8780 22% 66%,#c9a468 66% 100%)}',
    /* ---- 动作栏 ---- */
    '.smk-actions{position:relative;z-index:5;display:flex;gap:4px;padding:6px 6px 7px;background:linear-gradient(0deg,rgba(9,8,7,.96),rgba(9,8,7,.55) 60%,rgba(9,8,7,0));flex:0 0 auto}',
    '.smk-btn{flex:1 1 0;min-width:0;height:23px;padding:0 2px;border-radius:7px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.055);color:#e6d8bd;font-size:9.5px;letter-spacing:.02em;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .18s,border-color .18s,color .18s,transform .1s}',
    '.smk-btn:hover{background:rgba(236,203,138,.15);border-color:rgba(236,203,138,.42);color:#ffe6b4}',
    '.smk-btn:active{transform:scale(.97)}',
    '.smk-btn.smk-primary{background:linear-gradient(180deg,#ecc372 0%,#c8963e 52%,#a9772a 100%);border-color:#f3d38f;color:#2b1c07;font-weight:700;text-shadow:0 1px 0 rgba(255,255,255,.35);box-shadow:0 2px 9px -2px rgba(236,180,80,.55),inset 0 1px 0 rgba(255,255,255,.4)}',
    '.smk-btn.smk-primary:hover{background:linear-gradient(180deg,#f6d287,#d8a54c 55%,#b98430);color:#241605}',
    '.smk-btn:disabled{opacity:.34;cursor:default;transform:none;background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.07);color:#9c8f7b;box-shadow:none;filter:none}',
    '.smk-btn.smk-icon-only{flex:0 0 25px;font-size:12px}',
    '.smk-btn .smk-autodot{display:inline-block;width:4px;height:4px;border-radius:50%;background:#7be0a2;margin-left:3px;vertical-align:1px;box-shadow:0 0 5px #7be0a2}',
    /* ---- 缩放条（hover 显示） ---- */
    '#smk-root .smk-range{-webkit-appearance:none;appearance:none;flex:1;height:3px;border-radius:2px;background:linear-gradient(90deg,#c99a48,#5a4a35);outline:none;cursor:pointer;margin:0;min-width:0}',
    '#smk-root .smk-range::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:#f3d38f;border:1px solid #8a692f;box-shadow:0 1px 3px rgba(0,0,0,.5);cursor:pointer}',
    '#smk-root .smk-range::-moz-range-thumb{width:10px;height:10px;border:1px solid #8a692f;border-radius:50%;background:#f3d38f;cursor:pointer}',
    /* ---- 气泡提示 ---- */
    '.smk-hint{position:absolute;right:0;bottom:calc(100% + 10px);width:172px;padding:8px 10px;border-radius:11px 11px 3px 11px;background:linear-gradient(160deg,rgba(52,40,30,.97),rgba(28,22,18,.98));border:1px solid rgba(236,203,138,.34);box-shadow:0 12px 26px -8px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,236,196,.12);color:#f2e2c4;font-size:10.5px;line-height:1.5;z-index:30;opacity:0;transform:translateY(6px) scale(.96);transition:opacity .25s,transform .25s;pointer-events:none;cursor:pointer}',
    '.smk-hint:after{content:"";position:absolute;right:13px;bottom:-5px;width:9px;height:9px;background:rgba(28,22,18,.98);border-right:1px solid rgba(236,203,138,.34);border-bottom:1px solid rgba(236,203,138,.34);transform:rotate(45deg);border-radius:0 0 2px 0}',
    '.smk-hint.on{opacity:1;transform:none;pointer-events:auto}',
    '.smk-hint:hover{border-color:rgba(255,214,140,.6)}',
    '.smk-hint .smk-hint-act{color:#ffc871;font-weight:600;margin-top:2px;display:block;font-size:9.5px}',
    '.smk-hint .smk-hint-x{position:absolute;top:2px;right:3px;width:14px;height:14px;line-height:13px;text-align:center;font-size:10px;color:#8d7e69;border-radius:50%}',
    '.smk-hint .smk-hint-x:hover{color:#ffd9a0;background:rgba(255,255,255,.07)}',
    /* ---- Toast ---- */
    '.smk-toast{position:absolute;left:50%;top:34px;transform:translateX(-50%) translateY(-6px);z-index:20;max-width:160px;padding:4px 9px;border-radius:8px;background:rgba(14,11,9,.94);border:1px solid rgba(236,203,138,.3);color:#f4e4c6;font-size:9.5px;text-align:center;opacity:0;pointer-events:none;transition:opacity .22s,transform .22s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.smk-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}',
    /* ---- 快捷菜单 ---- */
    '.smk-menu{position:fixed;z-index:10050;min-width:140px;padding:5px;border-radius:10px;background:linear-gradient(165deg,rgba(40,32,25,.985),rgba(19,15,13,.995));border:1px solid rgba(236,203,138,.26);box-shadow:0 18px 40px -10px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,236,196,.09);opacity:0;transform:scale(.96) translateY(-3px);transform-origin:top right;transition:opacity .16s,transform .16s;pointer-events:none}',
    '.smk-menu.on{opacity:1;transform:none;pointer-events:auto}',
    '.smk-mi{display:flex;align-items:center;gap:7px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;color:#e9dcc4;font-size:11px;text-align:left;cursor:pointer;white-space:nowrap;transition:background .13s,color .13s}',
    '.smk-mi:hover{background:rgba(236,203,138,.15);color:#ffe5b0}',
    '.smk-mi .smk-mi-ico{width:13px;text-align:center;font-size:11px;flex:0 0 13px;color:#b9a482}',
    '.smk-mi .smk-mi-lab{flex:1}',
    '.smk-mi .smk-mi-key{font-size:8.5px;color:#7e7261;letter-spacing:.03em}',
    '.smk-mi .smk-mi-dot{width:5px;height:5px;border-radius:50%;background:#6d6355}',
    '.smk-mi.on .smk-mi-dot{background:#7be0a2;box-shadow:0 0 5px #7be0a2}',
    '.smk-mi.smk-danger:hover{background:rgba(210,90,70,.18);color:#ffb8a6}',
    '.smk-sep{height:1px;margin:4px 6px;background:rgba(255,255,255,.07)}',
    /* ---- 面板通用 ---- */
    '.smk-overlay{position:fixed;inset:0;z-index:10020;display:none;pointer-events:none}',
    '.smk-overlay.on{display:block}',
    '.smk-backdrop{position:absolute;inset:0;background:rgba(6,5,4,.46);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);opacity:0;transition:opacity .22s;pointer-events:auto}',
    '.smk-overlay.on .smk-backdrop{opacity:1}',
    '.smk-panel{position:absolute;right:112px;bottom:74px;width:min(560px,92vw);height:min(430px,78vh);display:flex;flex-direction:column;border-radius:15px;overflow:hidden;background:linear-gradient(168deg,rgba(38,31,25,.985),rgba(20,16,14,.995));border:1px solid rgba(236,203,138,.24);box-shadow:0 30px 70px -20px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,236,196,.08);pointer-events:auto;opacity:0;transform:translateY(10px) scale(.985);transition:opacity .22s,transform .25s cubic-bezier(.2,.85,.3,1);color-scheme:dark}',
    '.smk-panel.smk-panel-cabinet{width:var(--smk-cabw,600px)!important;height:min(640px,86vh)!important;max-width:calc(100vw - 28px)!important}',
    '.smk-panel.smk-panel-cabinet .smk-grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))!important}',
    '.smk-cabresize{position:absolute;right:4px;bottom:4px;width:20px;height:20px;cursor:nwse-resize;z-index:5;opacity:.55;touch-action:none}',
    '.smk-setrow.smk-hl{background:rgba(255,196,120,.12)!important;border-radius:8px;transition:background .3s}',
    '.smk-cabresize:after{content:"";position:absolute;right:5px;bottom:5px;width:9px;height:9px;border-right:2px solid #b9a687;border-bottom:2px solid #b9a687;border-radius:1px}',
    '.smk-overlay.on .smk-panel{opacity:1;transform:none}',
    '.smk-panel.smk-panel-settings,.smk-panel.smk-panel-stats{width:min(430px,92vw);height:min(470px,82vh)}',
    '.smk-phead{display:flex;align-items:center;gap:8px;padding:10px 12px 9px;border-bottom:1px solid rgba(255,255,255,.07);flex:0 0 auto;background:linear-gradient(180deg,rgba(255,255,255,.035),transparent)}',
    '.smk-ptitle{font-size:13px;font-weight:650;letter-spacing:.06em;color:#f5e7ca;flex:1;display:flex;align-items:center;gap:7px}',
    '.smk-ptitle .smk-ptitle-sub{font-size:9px;letter-spacing:.03em;color:#9c8b72;font-weight:400}',
    '.smk-pclose{width:22px;height:22px;padding:0;border:none;border-radius:6px;background:rgba(255,255,255,.055);color:#b8a78d;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}',
    '.smk-pclose:hover{background:rgba(236,203,138,.2);color:#ffe2ac}',
    /* ---- 烟柜 ---- */
    '.smk-tabs{display:flex;gap:3px;padding:7px 10px 0;overflow-x:auto;flex:0 0 auto;scrollbar-width:none}',
    '.smk-tabs::-webkit-scrollbar{display:none}',
    '.smk-tab{flex:0 0 auto;padding:3px 8px;border-radius:6px;border:1px solid transparent;background:transparent;color:#a8957b;font-size:10px;cursor:pointer;white-space:nowrap;transition:.15s}',
    '.smk-tab:hover{color:#f0dcb6;background:rgba(255,255,255,.05)}',
    '.smk-tab.on{background:linear-gradient(180deg,rgba(236,195,110,.24),rgba(200,150,62,.15));border-color:rgba(236,203,138,.4);color:#ffe3ae}',
    '.smk-tab .smk-tab-n{font-size:8px;opacity:.6;margin-left:2px}',
    '.smk-search{display:flex;align-items:center;gap:6px;margin:7px 10px 6px;padding:0 8px;height:26px;border-radius:7px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.09);flex:0 0 auto;transition:border-color .15s}',
    '.smk-search:focus-within{border-color:rgba(236,203,138,.42)}',
    '.smk-search svg{width:11px;height:11px;color:#8d7e69;flex:0 0 auto}',
    '.smk-search input{flex:1;min-width:0;background:transparent;border:none;outline:none;color:#f0e2c6;font-size:10.5px;font-family:inherit;padding:0}',
    '.smk-search input::placeholder{color:#7c6f5d}',
    '.smk-search .smk-clear{border:none;background:transparent;color:#8d7e69;cursor:pointer;font-size:12px;padding:0 1px;display:none}',
    '.smk-search.has-val .smk-clear{display:block}',
    '.smk-gridwrap{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:2px 9px 10px;scrollbar-width:thin;scrollbar-color:rgba(236,203,138,.28) transparent}',
    '.smk-gridwrap::-webkit-scrollbar{width:6px}',
    '.smk-gridwrap::-webkit-scrollbar-thumb{background:rgba(236,203,138,.22);border-radius:3px}',
    '.smk-gridwrap::-webkit-scrollbar-thumb:hover{background:rgba(236,203,138,.4)}',
    '.smk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:7px}',
    '.smk-carditem{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 5px 6px;border-radius:9px;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.035);cursor:pointer;transition:border-color .16s,background .16s,transform .16s;text-align:center;min-width:0}',
    '.smk-carditem:hover{border-color:rgba(236,203,138,.38);background:rgba(236,203,138,.075);transform:translateY(-1px)}',
    '.smk-carditem.on{border-color:rgba(255,205,120,.75);background:linear-gradient(180deg,rgba(236,190,100,.18),rgba(236,190,100,.06));box-shadow:0 0 0 1px rgba(255,205,120,.25),0 4px 12px -4px rgba(255,180,80,.28)}',
    '.smk-thumb{width:100%;height:64px;display:flex;align-items:center;justify-content:center}',
    '.smk-thumb svg{max-width:100%;max-height:100%;display:block;filter:drop-shadow(0 3px 3px rgba(0,0,0,.5))}',
    '.smk-thumb-img{max-width:100%;max-height:74px;width:auto;height:auto;object-fit:contain;display:block;filter:drop-shadow(0 3px 3px rgba(0,0,0,.5))}',
    '.smk-thumb-fallback{max-height:74px;display:flex;align-items:center;justify-content:center}',
    '.smk-cname{font-size:9.5px;font-weight:600;color:#f3e5ca;line-height:1.25;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.smk-cmeta{font-size:8px;color:#9e8d75;line-height:1.2;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '.smk-cmeta .smk-price{color:#e2be79}',
    '.smk-cfav{position:absolute;top:3px;right:3px;width:16px;height:16px;border:none;border-radius:50%;background:rgba(0,0,0,.25);color:#8a7b66;font-size:10px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:.15s}',
    '.smk-cfav:hover{color:#ffd88a;background:rgba(0,0,0,.4)}',
    '.smk-cfav.on{color:#ffc861;text-shadow:0 0 6px rgba(255,180,70,.7)}',
    '.smk-empty{padding:26px 12px;text-align:center;color:#9b8b74;font-size:11px;line-height:1.7}',
    '.smk-empty .smk-empty-ico{font-size:22px;display:block;margin-bottom:6px;opacity:.55}',
    '.smk-pfoot{display:flex;align-items:center;gap:8px;padding:7px 10px;border-top:1px solid rgba(255,255,255,.07);flex:0 0 auto;background:rgba(0,0,0,.14)}',
    '.smk-pfoot .smk-count{flex:1;font-size:9px;color:#8f816d;letter-spacing:.03em}',
    '.smk-lite{height:22px;padding:0 10px;border-radius:6px;border:1px solid rgba(236,203,138,.3);background:rgba(236,203,138,.09);color:#e8cf9e;font-size:9.5px;cursor:pointer;white-space:nowrap;transition:.15s}',
    '.smk-lite:hover{background:rgba(236,203,138,.2);border-color:rgba(236,203,138,.55);color:#ffe6b4}',
    '.smk-lite:disabled{opacity:.4;cursor:default}',
    '.smk-lite.smk-danger{color:#ffb8a6;border-color:rgba(220,100,80,.35);background:rgba(220,100,80,.1)}',
    '.smk-lite.smk-danger:hover{background:rgba(220,100,80,.22);border-color:rgba(220,100,80,.6)}',
    /* ---- 账本 ---- */
    '.smk-pbody{flex:1 1 auto;overflow-y:auto;padding:10px 12px 12px;scrollbar-width:thin;scrollbar-color:rgba(236,203,138,.28) transparent}',
    '.smk-pbody::-webkit-scrollbar{width:6px}',
    '.smk-pbody::-webkit-scrollbar-thumb{background:rgba(236,203,138,.22);border-radius:3px}',
    '.smk-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:9px}',
    '.smk-tile{padding:7px 6px;border-radius:8px;background:linear-gradient(165deg,rgba(255,255,255,.055),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.07);text-align:center}',
    '.smk-tile .smk-tv{font-size:16px;font-weight:700;color:#ffd79a;font-variant-numeric:tabular-nums;line-height:1.15}',
    '.smk-tile .smk-tv small{font-size:8.5px;font-weight:500;color:#b6a184;margin-left:1px}',
    '.smk-tile .smk-tl{font-size:8.5px;color:#9c8b72;letter-spacing:.04em;margin-top:1px}',
    '.smk-sect{margin:10px 0 5px;font-size:9px;letter-spacing:.1em;color:#a8957b;display:flex;align-items:center;gap:5px}',
    '.smk-sect:after{content:"";flex:1;height:1px;background:linear-gradient(90deg,rgba(236,203,138,.18),transparent)}',
    '.smk-rows{display:flex;flex-direction:column;gap:3px}',
    '.smk-row{display:flex;align-items:center;gap:7px;padding:4px 7px;border-radius:6px;background:rgba(255,255,255,.028);font-size:10px;color:#d8c9ae}',
    '.smk-row .smk-row-ico{width:14px;text-align:center;font-size:10px;flex:0 0 14px;opacity:.8}',
    '.smk-row .smk-row-lab{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.smk-row .smk-row-val{font-variant-numeric:tabular-nums;color:#f0d9ad;flex:0 0 auto}',
    '.smk-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.08);overflow:hidden;flex:0 0 52px;margin-left:auto}',
    '.smk-bar i{display:block;height:100%;border-radius:2px;background:linear-gradient(90deg,#c9903c,#ffd58b)}',
    '.smk-ach{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}',
    '.smk-achitem{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 3px;border-radius:7px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);text-align:center;opacity:.45;filter:grayscale(1)}',
    '.smk-achitem.got{opacity:1;filter:none;border-color:rgba(236,203,138,.32);background:linear-gradient(170deg,rgba(236,190,100,.16),rgba(236,190,100,.035));box-shadow:0 0 10px -4px rgba(255,190,90,.4)}',
    '.smk-achitem .smk-ach-ico{font-size:15px;line-height:1.1}',
    '.smk-achitem .smk-ach-name{font-size:8.5px;color:#ddcaa8;line-height:1.25}',
    '.smk-achitem .smk-ach-desc{font-size:7px;color:#8d7e6a;line-height:1.2}',
    /* ---- 设置 ---- */
    '.smk-setrow{display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid rgba(255,255,255,.045);min-height:29px}',
    '.smk-setrow:last-child{border-bottom:none}',
    '.smk-setlab{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.smk-setlab .smk-sname{font-size:10.5px;color:#e8dac0}',
    '.smk-setlab .smk-sdesc{font-size:8px;color:#8c7e6a;line-height:1.3}',
    '.smk-setval{font-size:9.5px;color:#c3ae8c;font-variant-numeric:tabular-nums;flex:0 0 auto;min-width:30px;text-align:right}',
    '.smk-setrow .smk-range{flex:1 1 80px;max-width:120px;margin:0 4px}',
    '.smk-switch{position:relative;flex:0 0 32px;width:32px;height:17px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:.2s;padding:0}',
    '.smk-switch:after{content:"";position:absolute;left:2px;top:1.5px;width:12px;height:12px;border-radius:50%;background:#b0a08a;transition:.2s}',
    '.smk-switch.on{background:linear-gradient(90deg,#b9873a,#e8c273);border-color:rgba(255,225,160,.4)}',
    '.smk-switch.on:after{left:16px;background:#fff6df;box-shadow:0 0 6px rgba(255,220,150,.6)}',
    '.smk-seg{display:flex;gap:3px;flex:0 0 auto}',
    '.smk-seg button{height:20px;padding:0 7px;border-radius:5px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#a8967c;font-size:9px;cursor:pointer;transition:.15s}',
    '.smk-seg button:hover{color:#f0dcb6;border-color:rgba(236,203,138,.35)}',
    '.smk-seg button.on{background:rgba(236,203,138,.22);border-color:rgba(236,203,138,.5);color:#ffe3ae}',
    '.smk-modechip{display:inline-flex;align-items:center;gap:4px;font-size:8.5px;padding:2px 7px;border-radius:999px;border:1px solid rgba(122,200,150,.3);background:rgba(122,200,150,.1);color:#9fd9b4;letter-spacing:.03em}',
    '.smk-modechip.preview{border-color:rgba(240,190,100,.3);background:rgba(240,190,100,.1);color:#e8c98b}',
    '.smk-about{margin-top:8px;padding:8px;border-radius:8px;border:1px dashed rgba(236,203,138,.2);background:rgba(0,0,0,.18);font-size:8.5px;line-height:1.55;color:#a99a83;white-space:pre-wrap;word-break:break-all;display:none;max-height:150px;overflow:auto}',
    '.smk-about.on{display:block}',
    '.smk-about b{color:#e6cf9f;font-weight:600}',
    '.smk-about .smk-ok{color:#8fd6a6}.smk-about .smk-bad{color:#e79a86}',
    '.smk-footnote{margin-top:10px;font-size:8px;color:#7c6f5d;line-height:1.6;text-align:center;letter-spacing:.02em}',
    /* ---- 确认条 ---- */
    '.smk-confirm{position:absolute;inset:0;z-index:20;display:none;align-items:center;justify-content:center;background:rgba(8,6,5,.62);backdrop-filter:blur(2px);pointer-events:auto;padding:20px}',
    '.smk-confirm.on{display:flex}',
    '.smk-confirm-box{width:min(300px,100%);padding:13px 14px;border-radius:11px;background:linear-gradient(165deg,rgba(48,38,29,.99),rgba(26,21,17,.99));border:1px solid rgba(236,203,138,.3);box-shadow:0 24px 50px -14px rgba(0,0,0,.8)}',
    '.smk-confirm-txt{font-size:11px;line-height:1.6;color:#ecdbba;margin-bottom:11px}',
    '.smk-confirm-acts{display:flex;gap:7px;justify-content:flex-end}',
    '.smk-confirm-acts .smk-lite{height:24px;padding:0 12px;font-size:10px}',
    /* ---- 载入 / 隐藏 ---- */
    '.smk-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#b7a68b;font-size:10px;letter-spacing:.1em;z-index:9;background:#171310}',
    '.smk-loading.gone{display:none}',
    '.smk-hidden{display:none!important}',
    '.smk-peek{position:fixed;right:112px;bottom:18px;width:16px;height:16px;border-radius:50%;border:1px solid rgba(236,203,138,.5);background:radial-gradient(circle at 35% 30%,#ffcf8a,#a55b22 62%,#3a2210);box-shadow:0 0 10px rgba(255,150,60,.55),0 2px 6px rgba(0,0,0,.6);cursor:pointer;z-index:9991;opacity:0;transition:opacity .25s;pointer-events:auto}',
    '.smk-peek.on{opacity:.92}',
    '.smk-peek:hover{opacity:1;transform:scale(1.12)}',
    /* ---- 动效 ---- */
    '@keyframes smk-breathe{0%,100%{opacity:.72}50%{opacity:1}}',
    '@keyframes smk-spin{to{transform:rotate(360deg)}}',
    '@keyframes smk-flame{0%{transform:scale(.92,.9) translateX(-1px);opacity:.85}55%{transform:scale(1.04,1.06) translateX(1px);opacity:1}100%{transform:scale(.97,.94) translateX(-.5px);opacity:.9}}',
    '@keyframes smk-puffkick{0%{filter:drop-shadow(0 5px 6px rgba(0,0,0,.55))}35%{filter:drop-shadow(0 5px 8px rgba(0,0,0,.55)) brightness(1.16) drop-shadow(0 0 12px rgba(255,150,60,.45))}100%{filter:drop-shadow(0 5px 6px rgba(0,0,0,.55))}}',
    '@keyframes smk-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '@keyframes smk-fadein{from{opacity:0}to{opacity:1}}',
    '@keyframes smk-slideout{to{opacity:0;transform:translateY(-10px) scale(.92)}}',
    '.smk-fadein{animation:smk-fadein .28s ease both}',
    '.smk-widget.smk-no-anim .smk-card:before,.smk-widget.smk-no-anim .smk-led.lit{animation:none!important}',
    /* ---- 亮色背景（挂件仍是深色玻璃，只微调对比） ---- */
    '.smk-theme-light .smk-card{box-shadow:0 24px 46px -18px rgba(60,40,20,.5),0 4px 14px rgba(60,40,20,.2),inset 0 1px 0 rgba(255,240,210,.12),inset 0 0 26px rgba(255,173,84,.05)}',
    '.smk-theme-light .smk-panel{box-shadow:0 30px 70px -18px rgba(50,32,15,.55),inset 0 1px 0 rgba(255,236,196,.1)}',
    '.smk-theme-light .smk-backdrop{background:rgba(30,22,14,.28)}',
    /* ---- 窄窗 / 小屏 ---- */
    '@media (max-width:760px){.smk-overlay .smk-panel{right:50%;bottom:50%;transform:translate(50%,50%) translateY(10px) scale(.985);width:min(560px,94vw);height:min(430px,80vh)}.smk-overlay.on .smk-panel{transform:translate(50%,50%)}.smk-panel.smk-panel-settings,.smk-panel.smk-panel-stats{width:min(430px,94vw);height:min(470px,84vh)}}',
    '@media (max-width:420px){.smk-panel .smk-tab{padding:3px 6px;font-size:9px;}.smk-grid{grid-template-columns:repeat(auto-fill,minmax(78px,1fr))}}',
    /* ================= v2 无外框场景（覆盖上面的玻璃卡片） ================= */
    '#smk-root .smk-card{background:none!important;border:none!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important;display:flex;flex-direction:column}',
    '#smk-root .smk-card:before,#smk-root .smk-card:after{display:none!important}',
    '#smk-root .smk-top{background:none!important;border-bottom:none!important;padding:2px 2px 0 3px;cursor:grab;gap:4px;align-items:flex-start;text-shadow:0 1px 3px rgba(0,0,0,.75),0 0 8px rgba(0,0,0,.55)}',
    '#smk-root .smk-brandline{font-size:9.5px;color:#f3e6cf;font-weight:600;gap:4px;opacity:.92}',
    '#smk-root .smk-rest{color:#d8c3a0;font-size:8px;background:rgba(12,10,8,.34);padding:0 4px;border-radius:4px;line-height:1.5;opacity:.92}',
    '#smk-root .smk-stat{font-size:7.5px;color:#cbbba2;opacity:.72;max-width:152px;letter-spacing:.01em}',
    '#smk-root .smk-led{box-shadow:0 0 6px rgba(0,0,0,.5)}',
    '#smk-root .smk-iconbtn{width:17px;height:17px;background:rgba(14,11,9,.34);color:#cfbda0;opacity:.72;border-radius:50%;font-size:10px;backdrop-filter:blur(4px)}',
    '#smk-root .smk-iconbtn:hover{opacity:1;background:rgba(14,11,9,.62);color:#ffe2ac}',
    '#smk-root .smk-top-btns{gap:1px;margin-top:1px}',
    '#smk-root .smk-turnbar{position:absolute;left:50%;top:0;right:auto;transform:translateX(-50%);border-radius:0 0 7px 7px;background:rgba(20,15,10,.5);border:none;padding:2px 8px;font-size:8px;backdrop-filter:blur(5px);max-width:184px}',
    '#smk-root .smk-stage{background:none!important}',
    '#smk-root .smk-stage:before{display:none!important}',
    '#smk-root .smk-stage:after{display:none!important}',
    '#smk-root .smk-packshadow{width:78px;height:10px;bottom:14px;background:radial-gradient(ellipse,rgba(0,0,0,.55),rgba(0,0,0,0) 72%);transition:opacity .4s,transform .4s}',
    '#smk-root .smk-packwrap{filter:drop-shadow(0 7px 7px rgba(0,0,0,.34));transition:transform .45s cubic-bezier(.2,.85,.25,1),opacity .45s,filter .45s}',
    '#smk-root .smk-packwrap.smk-pack-away{opacity:0!important;transform:translateX(-50%) translateY(13px) scale(.86) rotate(-4deg)!important;pointer-events:none!important;filter:drop-shadow(0 4px 4px rgba(0,0,0,.2))!important}',
    '#smk-root .smk-packwrap.smk-pack-lit{transform:translateX(-50%) translateY(8px) scale(.94);opacity:.9}',
    '#smk-root .smk-pack-img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none;-webkit-user-drag:none}',
    '#smk-root .smk-actions{background:none!important;padding:3px 2px 2px;gap:4px}',
    '#smk-root .smk-btn{height:21px;font-size:9px;background:rgba(16,12,10,.55);border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(6px);box-shadow:0 3px 9px rgba(0,0,0,.3);text-shadow:0 1px 2px rgba(0,0,0,.4)}',
    '#smk-root .smk-btn.smk-primary{background:linear-gradient(180deg,rgba(238,196,116,.95),rgba(181,131,50,.96));box-shadow:0 3px 12px -2px rgba(220,160,70,.55),inset 0 1px 0 rgba(255,255,255,.4)}',
    '#smk-root .smk-btn:disabled{background:rgba(16,12,10,.28);border-color:rgba(255,255,255,.07);color:#8f8371;opacity:.6}',
    '#smk-root .smk-loading{background:none;color:#b7a68b;text-shadow:0 1px 3px rgba(0,0,0,.6)}',
    '#smk-root .smk-toast{background:rgba(14,11,9,.72);border-color:rgba(236,203,138,.25);backdrop-filter:blur(5px);text-shadow:0 1px 2px rgba(0,0,0,.5)}',
    /* 第一视角手部 / 抖动 / 烫伤闪红 / 喉咙条 */
    '.smk-hand{position:absolute;right:-40px;bottom:22px;width:180px;z-index:2;pointer-events:none;opacity:0;transform:translate(12px,18px) scale(.94);transition:opacity .35s ease,transform .55s cubic-bezier(.2,.9,.3,1),filter .2s;filter:drop-shadow(0 10px 16px rgba(0,0,0,.5)) drop-shadow(0 2px 4px rgba(0,0,0,.4));will-change:transform}',
    '.smk-hand.on{opacity:1;transform:translate(0,0) scale(1)}',
    '.smk-hand.inhale{transform:translate(-9px,-7px) scale(1.055) rotate(-2deg)}',
    '.smk-hand.press{transform:translate(-52px,34px) scale(.96) rotate(7deg);transition:transform .5s cubic-bezier(.3,.6,.2,1)}',
    '.smk-hand.off{transform:translate(16px,24px) scale(.9);opacity:0}',
    '.smk-hand svg{display:block;width:100%;height:auto;overflow:visible}',
    '.smk-hand img{display:block;width:100%;height:auto;pointer-events:none}',
    /* 前景手指层：让烟从指间穿过（手背在下、手指在上） */
    '.smk-hand-front{position:absolute;right:-40px;bottom:22px;width:180px;z-index:4;pointer-events:none;opacity:0;transform:translate(12px,18px) scale(.94);transition:opacity .35s ease,transform .55s cubic-bezier(.2,.9,.3,1);filter:drop-shadow(0 6px 10px rgba(0,0,0,.35));will-change:transform}',
    '.smk-hand-front.on{opacity:1;transform:translate(0,0) scale(1)}',
    '.smk-hand-front.inhale{transform:translate(-9px,-7px) scale(1.055) rotate(-2deg)}',
    '.smk-hand-front.press{transform:translate(-52px,34px) scale(.96) rotate(7deg);transition:transform .5s cubic-bezier(.3,.6,.2,1)}',
    '.smk-hand-front.off{transform:translate(16px,24px) scale(.9);opacity:0}',
    '.smk-hand-front svg{display:block;width:100%;height:auto;overflow:visible}',
    '.smk-hand-front img{display:block;width:100%;height:auto;pointer-events:none}',
    '.smk-hand .smk-hand-svg{display:block}',
    '.smk-hand .smk-hand-img{display:none}',
    '.smk-hand.photo .smk-hand-svg{display:none!important}',
    '.smk-hand.photo .smk-hand-img{display:block!important;width:100%;height:auto;pointer-events:none;user-select:none;-webkit-user-drag:none}',
    '.smk-hand.photo{right:-56px!important;bottom:36px!important;width:236px!important;transform-origin:72% 78%}',
    '.smk-aboutbrand{background:rgba(120,210,150,.07);border:1px solid rgba(140,220,170,.22);border-radius:10px;padding:9px 10px;margin:2px 0 8px;transition:background .3s,box-shadow .3s}',
    '.smk-aboutbrand.smk-hl{background:rgba(120,210,150,.16);box-shadow:0 0 0 2px rgba(140,220,170,.35)}',
    '.smk-aname{font-size:11px;font-weight:700;color:#b9e8c8;margin-bottom:5px;letter-spacing:.03em}',
    '.smk-acopy{font-size:9px;line-height:1.55;color:#cddccf;margin-bottom:5px}',
    '.smk-awarn{font-size:9px;line-height:1.5;color:#e8cf9a;margin-bottom:4px}',
    '.smk-alegal{font-size:8.5px;line-height:1.45;color:#9aa79b;margin-bottom:6px}',
    '.smk-asetrow{display:flex;align-items:center;justify-content:space-between;gap:6px}',
    '.smk-ach-bar{display:inline-block;margin-left:5px;width:38px;height:3px;border-radius:2px;background:rgba(255,255,255,.14);vertical-align:middle;overflow:hidden}',
    '.smk-ach-bar i{display:block;height:100%;background:linear-gradient(90deg,#e8c078,#ffd98f);border-radius:2px}',
    /* ===== v12：设置面板字号/尺寸放大（仅设置面板） ===== */
    '.smk-panel.smk-panel-settings{width:min(460px,94vw)!important;height:min(520px,86vh)!important}',
    '.smk-panel-settings .smk-pbody{padding:12px 14px 16px}',
    '.smk-panel-settings .smk-setrow{min-height:36px;padding:8px 2px;gap:10px}',
    '.smk-panel-settings .smk-setlab .smk-sname{font-size:13px!important;line-height:1.35}',
    '.smk-panel-settings .smk-setlab .smk-sdesc{font-size:11px!important;line-height:1.4;color:#a99a82!important}',
    '.smk-panel-settings .smk-setval{font-size:12px!important;color:#e3cfa8!important;min-width:36px}',
    '.smk-panel-settings .smk-sect{font-size:12px!important;font-weight:700;letter-spacing:.05em;margin:13px 0 7px;color:#cfb791!important}',
    '.smk-panel-settings .smk-seg button{height:27px!important;font-size:12px!important;padding:0 10px!important;min-width:40px}',
    '.smk-panel-settings .smk-switch{width:40px!important;height:22px!important;flex:0 0 40px!important}',
    '.smk-panel-settings .smk-switch:after{width:16px!important;height:16px!important;left:2px!important;top:2px!important}',
    '.smk-panel-settings .smk-switch.on:after{left:21px!important}',
    '.smk-panel-settings .smk-range{height:5px!important}',
    '.smk-panel-settings .smk-range::-webkit-slider-thumb{width:14px!important;height:14px!important;margin-top:-1px!important}',
    '.smk-panel-settings .smk-setrow .smk-range{max-width:140px}',
    '.smk-panel-settings .smk-lite{font-size:11px!important;min-height:24px;padding:0 9px}',
    '.smk-panel-settings .smk-aboutbrand{padding:12px 12px 10px}',
    '.smk-panel-settings .smk-aname{font-size:13.5px!important}',
    '.smk-panel-settings .smk-acopy{font-size:12px!important;line-height:1.65!important}',
    '.smk-panel-settings .smk-awarn{font-size:12px!important;line-height:1.6!important}',
    '.smk-panel-settings .smk-alegal{font-size:11.5px!important;line-height:1.55!important}',
    '.smk-panel-settings .smk-asetrow .smk-sdesc{font-size:12.5px!important;color:#cfdccf!important}',
    '.smk-panel-settings .smk-footnote{font-size:10.5px;line-height:1.5}',
    '.smk-singlecig{display:block;width:100%;height:100%;object-fit:contain;transform:rotate(-22deg);filter:drop-shadow(0 4px 6px rgba(0,0,0,.55))}',
    '.smk-cutter{position:absolute;left:0;top:0;width:92px;height:70px;z-index:11;opacity:0;pointer-events:none;transform-origin:60% 60%}',
    '.smk-cutter img,.smk-cutter svg{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 4px 6px rgba(0,0,0,.55))}',
    '.smk-cutter.on{animation:smk-cut 1s cubic-bezier(.3,.7,.2,1) forwards}',
    '@keyframes smk-cut{0%{opacity:0;transform:translate(16px,14px) scale(.7) rotate(6deg)}18%{opacity:1}52%{opacity:1;transform:translate(0,0) scale(1.06) rotate(-3deg)}66%{opacity:1;transform:translate(-2px,2px) scale(.98) rotate(2deg)}100%{opacity:0;transform:translate(-22px,-12px) scale(1) rotate(-8deg)}}',
    '.smk-hand.photo.smk-hp-regular{right:14px!important;bottom:88px!important;width:150px!important;transform-origin:78% 70%}',
    '.smk-hand.photo.smk-hp-slim{right:14px!important;bottom:90px!important;width:148px!important;transform-origin:78% 70%}',
    '.smk-hand.photo.smk-hp-cigar{transform-origin:62% 55%}',
    '.smk-hand.photo.on{transform:rotate(6deg)!important}',
    '.smk-hand.photo.inhale{transform:rotate(6deg) translate(-7px,-5px) scale(1.03)!important}',
    '.smk-hand.photo.press{transform:rotate(6deg) translate(-40px,30px) scale(.96)!important}',
    /* ===== v3：开盒动画 / 人生思考 / 真实烟灰缸 / 雪茄 ===== */
    '.smk-openfx{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);width:108px;height:160px;z-index:6;pointer-events:none;opacity:0;transition:opacity .18s}',
    '.smk-openfx.on{opacity:1}',
    '.smk-openfx .smk-foil{position:absolute;left:12%;top:6%;width:76%;height:22%;border-radius:4px 4px 2px 2px;background:linear-gradient(120deg,rgba(255,255,255,.05),rgba(255,248,225,.85) 35%,rgba(214,197,150,.7) 55%,rgba(255,255,255,.55) 75%,rgba(255,255,255,.05));box-shadow:0 0 18px rgba(255,235,180,.5);transform:scaleY(0);transform-origin:50% 100%}',
    '.smk-openfx.on .smk-foil{animation:smk-foil-open .5s cubic-bezier(.2,.9,.3,1) forwards}',
    '.smk-openfx .smk-glint{position:absolute;left:-30%;top:0;width:60%;height:100%;background:linear-gradient(105deg,transparent,rgba(255,246,214,.65),transparent);transform:skewX(-16deg);opacity:0}',
    '.smk-openfx.on .smk-glint{animation:smk-glint-sweep .6s ease-out .12s forwards}',
    '.smk-openfx.smk-fx-soft .smk-foil{border-radius:3px;background:linear-gradient(120deg,rgba(255,255,255,.05),rgba(245,238,220,.8),rgba(255,255,255,.4))}',
    '.smk-openfx.smk-fx-cigar{width:150px;height:96px;bottom:30px}',
    '.smk-openfx.smk-fx-cigar .smk-foil{height:40%;top:30%;border-radius:3px;background:linear-gradient(120deg,rgba(90,58,32,.2),rgba(233,196,132,.85) 40%,rgba(140,96,52,.7) 70%,rgba(255,230,180,.5))}',
    '@keyframes smk-foil-open{0%{transform:scaleY(0);opacity:.2}45%{transform:scaleY(1.15);opacity:1}100%{transform:scaleY(1);opacity:.95}}',
    '@keyframes smk-glint-sweep{0%{transform:translateX(0) skewX(-16deg);opacity:0}30%{opacity:1}100%{transform:translateX(260%) skewX(-16deg);opacity:0}}',
    '.smk-packwrap.smk-opening{animation:smk-pack-open-hard .55s cubic-bezier(.2,.9,.3,1)}',
    '.smk-packwrap.smk-opening.smk-open-soft{animation:smk-pack-open-soft .62s cubic-bezier(.2,.9,.3,1)}',
    '.smk-packwrap.smk-opening.smk-open-tin{animation:smk-pack-open-tin .6s cubic-bezier(.2,.9,.3,1)}',
    '.smk-packwrap.smk-opening.smk-open-cigar{animation:smk-pack-open-cigar .68s cubic-bezier(.2,.9,.3,1)}',
    '@keyframes smk-pack-open-hard{0%{transform:translateX(-50%) rotate(-2.5deg)}30%{transform:translateX(-50%) translateY(-11px) rotate(-7deg) scale(1.03)}62%{transform:translateX(-50%) translateY(-5px) rotate(-3.5deg) scale(1.005)}100%{transform:translateX(-50%) translateY(-2px) rotate(-2deg)}}',
    '@keyframes smk-pack-open-soft{0%{transform:translateX(-50%) rotate(-2.5deg)}28%{transform:translateX(-50%) translateY(-8px) rotate(2deg) scaleX(1.04)}58%{transform:translateX(-50%) translateY(-4px) rotate(-1deg) scaleX(.99)}100%{transform:translateX(-50%) translateY(-2px) rotate(0deg)}}',
    '@keyframes smk-pack-open-tin{0%{transform:translateX(-50%) rotate(-2.5deg)}34%{transform:translateX(-50%) translateY(-6px) rotate(6deg) scale(1.02)}70%{transform:translateX(-50%) translateY(-2px) rotate(-1deg)}100%{transform:translateX(-50%) rotate(0)}}',
    '@keyframes smk-pack-open-cigar{0%{transform:translateX(-50%) rotate(-1deg)}32%{transform:translateX(-50%) translateY(-8px) rotate(-3deg) scaleX(1.05)}66%{transform:translateX(-50%) translateY(-4px) scaleX(1.02)}100%{transform:translateX(-50%) rotate(0)}}',
    /* 人生思考气泡：无底框悬浮小字，按 kind 轻微变色 */
    /* 真实烟灰缸图 */
    '.smk-photoburn{position:absolute;left:0;top:0;width:20px;height:20px;z-index:9;pointer-events:none;opacity:0;transition:opacity .25s;transform:translate(-50%,-50%)}',
    '.smk-photoburn.on{opacity:1}',
    '.smk-photoburn .smk-pb-ash{position:absolute;left:0;bottom:-2px;width:10px;height:4px;border-radius:3px 3px 2px 2px;background:linear-gradient(180deg,#d8d2c6,#8f8a80 55%,#6d675f);box-shadow:0 1px 2px rgba(0,0,0,.5);transform:skewX(-8deg)}',
    '.smk-photoburn .smk-pb-fire{position:absolute;left:-5px;top:-5px;width:10px;height:10px;border-radius:50%;background:radial-gradient(circle,rgba(255,110,40,.62) 0%,rgba(190,60,18,.45) 38%,rgba(120,30,8,.18) 62%,rgba(60,10,0,0) 82%);filter:blur(1px);opacity:.6}',
    '#smk-root .smk-ashtray.photo{width:150px;bottom:-8px;opacity:.97;filter:drop-shadow(0 6px 10px rgba(0,0,0,.5)) brightness(.94) saturate(.95)}',
    '#smk-root .smk-ashtray.photo img{display:block;width:100%;height:auto;pointer-events:none;user-select:none;-webkit-user-drag:none}',
    /* 雪茄：更粗的烟、两指夹持、木盒 */
    '.smk-widget.smk-cigar .smk-ashtray.photo{width:128px;bottom:-12px;opacity:.92}',
    '.smk-widget.smk-cigar .smk-hand{width:236px;right:-84px;bottom:-2px;z-index:2}',
    '.smk-widget.smk-cigar .smk-hand-front{display:none!important}',
    '.smk-widget.smk-cigar .smk-cigwrap{z-index:4!important}',
    '.smk-widget.smk-cigar .smk-hand.photo{right:-56px!important;bottom:36px!important;width:236px!important}',
    '.smk-widget.smk-cigar .smk-cigwrap{filter:drop-shadow(0 6px 8px rgba(0,0,0,.6)) drop-shadow(0 0 10px rgba(255,120,50,.14))}',
    '.smk-widget.smk-cigar .smk-ashdot{right:52px;bottom:112px}',
    '.smk-ashdot.mouth{right:auto;left:58px;bottom:150px}',
    '.smk-flash.mouth{background:radial-gradient(52% 44% at 42% 34%,rgba(255,66,34,.5),rgba(255,30,18,.14) 46%,transparent 72%)}',
    '.smk-flash{position:absolute;inset:0;z-index:7;pointer-events:none;opacity:0;transition:opacity .16s;background:radial-gradient(60% 50% at 58% 42%,rgba(255,66,34,.5),rgba(255,30,18,.14) 46%,transparent 72%)}',
    '.smk-flash.on{opacity:1;animation:smk-flashfade .7s ease-out forwards}',
    '.smk-ashdot{position:absolute;right:44px;bottom:104px;width:5px;height:5px;border-radius:50%;z-index:8;pointer-events:none;opacity:0;background:radial-gradient(circle at 40% 35%,#ffb08a,#d63a16 60%,#7d1706);box-shadow:0 0 7px rgba(255,90,40,.85)}',
    '.smk-ashdot.on{opacity:.92;animation:smk-ashpulse 1.8s ease-in-out infinite}',
    '.smk-intensity{position:absolute;left:5px;bottom:60px;width:3px;height:46px;border-radius:3px;background:rgba(255,255,255,.13);z-index:8;opacity:0;transition:opacity .2s;overflow:hidden;box-shadow:0 0 6px rgba(0,0,0,.4)}',
    '.smk-intensity.on{opacity:1}',
    '.smk-intensity i{position:absolute;left:0;bottom:0;width:100%;height:0%;border-radius:3px;background:linear-gradient(0deg,#6fd39a 0%,#e8c15f 46%,#ef7d3d 72%,#e33d28 100%);transition:height .09s linear}',
    '.smk-intensity span{position:absolute;left:5px;bottom:-2px;font-size:6.5px;color:#c9b593;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.7);letter-spacing:.05em}',
    '.smk-tipcover{position:absolute;left:5px;top:33%;width:26px;height:28px;border-radius:50%;z-index:8;pointer-events:none;display:none;background:radial-gradient(circle at 46% 46%,rgba(246,235,216,.99),rgba(233,218,192,.8) 46%,rgba(220,200,170,0) 72%);filter:blur(.7px)}',
    '.smk-tipcover.on{display:block}',
    '#smk-root .smk-stage.smk-packless:before{opacity:.26!important}',
    '.smk-widget.smk-shake .smk-stage{animation:smk-shake .52s cubic-bezier(.36,.07,.19,.97) both}',
    '.smk-widget.smk-shake .smk-hand{animation:smk-handshake .52s cubic-bezier(.36,.07,.19,.97) both}',
    '.smk-cigwrap.inhaling{filter:drop-shadow(0 5px 6px rgba(0,0,0,.55)) drop-shadow(0 0 10px rgba(255,140,60,.45))}',
    '@keyframes smk-shake{10%,90%{transform:translate(-1px,1px) rotate(-.3deg)}20%,80%{transform:translate(2px,-1px) rotate(.4deg)}30%,50%,70%{transform:translate(-3px,1px) rotate(-.5deg)}40%,60%{transform:translate(3px,-1px) rotate(.5deg)}}',
    '@keyframes smk-handshake{10%,90%{transform:translate(-2px,1px) rotate(-1deg)}25%{transform:translate(3px,-2px) rotate(1.4deg)}45%{transform:translate(-4px,2px) rotate(-1.6deg)}65%{transform:translate(3px,-1px) rotate(1deg)}85%{transform:translate(-2px,1px) rotate(-.6deg)}}',
    '@keyframes smk-flashfade{0%{opacity:.95}35%{opacity:.55}100%{opacity:0}}',
    '@keyframes smk-ashpulse{0%,100%{opacity:.55;box-shadow:0 0 5px rgba(255,90,40,.6)}50%{opacity:1;box-shadow:0 0 10px rgba(255,110,50,.95)}}',
    /* 亮色页面适配：去掉外框后文字/按钮要能读 */
    '#smk-root.smk-theme-light .smk-top{text-shadow:0 1px 0 rgba(255,255,255,.55)}',
    '#smk-root.smk-theme-light .smk-brandline{color:#2f2a22;opacity:1}',
    '#smk-root.smk-theme-light .smk-rest{color:#3a3126;background:rgba(255,252,245,.72);opacity:1}',
    '#smk-root.smk-theme-light .smk-stat{color:#4a4034;opacity:.9}',
    '#smk-root.smk-theme-light .smk-iconbtn{background:rgba(255,252,245,.55);color:#4b4236}',
    '#smk-root.smk-theme-light .smk-btn{background:rgba(255,252,246,.78);border-color:rgba(80,62,36,.24);color:#3a3226;text-shadow:none}',
    '#smk-root.smk-theme-light .smk-btn:disabled{background:rgba(255,252,246,.45);color:#9a8f7e}',
    '#smk-root.smk-theme-light .smk-turnbar{background:rgba(255,250,242,.68);color:#7a5320}',
    '#smk-root.smk-theme-light .smk-stage:before{display:none!important}',
    '#smk-root.smk-theme-light .smk-stage:after{display:none!important}',
    /* 只有一个按钮时不拉满整行 */
    '#smk-root .smk-actions.smk-solo .smk-btn.smk-primary{flex:0 0 auto;min-width:56px;padding:0 12px}',
    '#smk-root .smk-actions.smk-solo{justify-content:flex-start}'
  ].join('\n');

  function injectStyles() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.setAttribute('type', 'text/css');
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  /* ==========================================================================
   * 运行期状态（后面各分区共用）
   * ========================================================================*/
  var rootEl = null;          // #smk-root
  var widgetEl = null;        // 挂件本体
  var stageEl = null;
  var canvasEl = null;
  var ctx2d = null;
  var packWrap = null;
  var packShadowEl = null;
  var tipCoverEl = null;
  var openFxEl = null;
  var cutterEl = null;
  var cigWrap = null;
  var lighterEl = null;
  var ashtrayEl = null;
  var buttLayer = null;
  var topBrandEl = null;
  var topRestEl = null;
  var topStatEl = null;
  var ledEl = null;
  var turnBar = null;
  var turnTxt = null;
  var turnClock = null;
  var hintEl = null;
  var toastEl = null;
  var actionsEl = null;
  var peekEl = null;
  var menuEl = null;
  var overlayEl = null;
  var panelEl = null;
  var handEl = null;
  var handFrontEl = null;
  var flashEl = null;
  var ashdotEl = null;
  var intensityEl = null;
  var intensityFill = null;
  var scenePhoto = { pack: null, cig: null, hand: null };
  var photoHandMode = false;
  var photoHandOk = false;
  var packImages = { loaded: false, data: null };
  var confirmEl = null;
  var btns = {};               // 底部按钮引用
  var ui = { open: false, panel: '', hidden: false };
  var cfg = deepMerge(DEFAULT_CONFIG, {});
  var stats = null;
  var product = null;
  var host = { mode: 'unknown', base: '', lastError: '' };
  var booted = false;

  /* ==========================================================================
   * 6. 参数化 SVG 渲染
   *    6.1 烟盒几何           6.2 图案装饰层
   *    6.3 烟盒渲染入口        6.4 烟支 / 打火机 / 烟灰缸
   * ========================================================================*/

  /* ---- 6.1 烟盒几何：不同 type/style 给不同轮廓 ---- */
  function packGeom(p) {
    var fmt = String(p.format || '').toLowerCase();
    var style = String(p.packStyle || (p.pack && p.pack.style) || 'hard').toLowerCase();
    if (style === 'slim-box' || style === 'medium-box') { /* 细支盒/中支盒 */ }
    var type = p.type || fmt || 'hard';
    var slim = fmt === 'slim' || style === 'slim-box' || String(type) === 'slim' || p.category === 'slim';
    var medium = fmt === 'medium' || style === 'medium-box' || String(type) === 'medium' || p.category === 'medium';
    var short = fmt === 'short' || (!fmt && +p.lengthMm && +p.lengthMm < 76);
    var isCigarPack = style === 'cigar-box' || fmt === 'cigar' || p.category === '雪茄' || String(type) === '雪茄';
    if (isCigarPack) style = 'cigar-box';
    else if (style === 'slim-box' || style === 'medium-box') style = 'hard';
    var g = { style: style, type: type, slim: slim, medium: medium, short: short };
    if (style === 'tin') {
      g.vw = 112; g.vh = 128;
      g.fx = 6; g.fy = 22; g.fw = 100; g.fh = 84;
      g.rx = 5; g.face = 'tin';
      return g;
    }
    if (style === 'pod') {
      g.vw = 72; g.vh = 176;
      g.fx = 18; g.fy = 10; g.fw = 36; g.fh = 156;
      g.rx = 14; g.face = 'pod';
      return g;
    }
    if (style === 'cigar-box') {
      g.vw = 178; g.vh = 120;
      g.fx = 10; g.fy = 24; g.fw = 158; g.fh = 82;
      g.rx = 5; g.face = 'cigar';
      return g;
    }
    /* hard / soft（含细支、中支、短支变体） */
    var fw = 94, fh = 144;
    if (slim) { fw = 74; fh = 158; }
    else if (medium) { fw = 86; fh = 150; }
    else if (short) { fh = 126; }
    var pad = 8, top = 10, side = 8;
    g.vw = pad + fw + side + 2;
    g.vh = pad + top + fh + 4;
    g.fx = pad; g.fy = pad + top;
    g.fw = fw; g.fh = fh;
    g.rx = slim ? 4 : 5;
    g.side = side;
    g.face = style === 'soft' ? 'soft' : 'hard';
    return g;
  }

  function packColors(p) {
    var pk = p.pack;
    var light = isLightColor(pk.bg);
    return {
      bg: pk.bg || '#7a1b1b',
      bg2: pk.bg2 || tint(pk.bg || '#7a1b1b', -0.35),
      accent: pk.accent || '#e6c46a',
      ink: pk.ink || contrastInk(pk.bg || '#7a1b1b'),
      pc: pk.patternColor || pk.accent || '#e6c46a',
      band: pk.bandColor || pk.accent || '#e6c46a',
      light: light,
      darkInk: light ? '#20201e' : pk.ink || '#fff6e8'
    };
  }

  function uidFor(p) {
    return 'smk' + String(p.id || 'x').replace(/[^a-zA-Z0-9]/g, '').slice(0, 18);
  }

  /* ---- 6.2 图案装饰层（在正面裁剪区域内绘制） ---- */
  function patternDefsAndDecor(p, g, C, uid) {
    var pat = (p.pack.pattern || 'plain').toLowerCase();
    var w = g.fw, h = g.fh, pc = C.pc;
    var defs = '';
    var decor = '';
    var clipId = uid + 'clip';
    var tileable = { stripe: 1, diamond: 1, grid: 1, star: 1, cross: 1, dots: 1 };
    if (tileable[pat]) {
      var tile = '';
      if (pat === 'stripe') {
        tile = '<path d="M-8 8 L8 -8 M0 16 L16 0 M8 24 L24 8" stroke="' + pc + '" stroke-width="1.15" opacity=".55" fill="none"/>';
      } else if (pat === 'diamond') {
        tile = '<path d="M7 0 L14 7 L7 14 L0 7 Z" stroke="' + pc + '" stroke-width=".85" fill="none" opacity=".6"/><path d="M7 3.4 L10.6 7 L7 10.6 L3.4 7 Z" fill="' + pc + '" opacity=".22"/>';
      } else if (pat === 'grid') {
        tile = '<path d="M0 9 H18 M9 0 V18" stroke="' + pc + '" stroke-width=".7" opacity=".42" fill="none"/>';
      } else if (pat === 'star') {
        tile = '<path d="M9 1.5 L10.7 6.6 L16 6.6 L11.7 9.7 L13.4 14.8 L9 11.7 L4.6 14.8 L6.3 9.7 L2 6.6 L7.3 6.6 Z" fill="' + pc + '" opacity=".5"/>';
      } else if (pat === 'dots') {
        tile = '<circle cx="5" cy="5" r="1.1" fill="' + pc + '" opacity=".55"/><circle cx="14" cy="12" r=".8" fill="' + pc + '" opacity=".4"/>';
      }
      var s = pat === 'stripe' ? 16 : pat === 'grid' ? 9 : 18;
      defs += '<pattern id="' + uid + 'pat" width="' + s + '" height="' + s + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + (pat === 'stripe' ? -32 : 0) + ')">' + tile + '</pattern>';
      decor += '<rect x="' + g.fx + '" y="' + g.fy + '" width="' + w + '" height="' + h + '" fill="url(#' + uid + 'pat)" opacity="' + (pat === 'grid' ? '.9' : '.75') + '"/>';
      return { defs: defs, decor: decor };
    }
    var X = g.fx, Y = g.fy;
    var o;
    if (pat === 'sunburst') {
      o = '<g opacity=".5">';
      for (var i = 0; i < 22; i++) {
        var a = -90 + (i - 11) * 8.2;
        var rad = a * Math.PI / 180;
        var x2 = X + w / 2 + Math.cos(rad) * (h * 1.25);
        var y2 = Y - 4 + Math.sin(rad) * (h * 1.25);
        o += '<line x1="' + (X + w / 2) + '" y1="' + (Y - 6) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + pc + '" stroke-width="1.6" opacity=".38"/>';
      }
      o += '<circle cx="' + (X + w / 2) + '" cy="' + (Y - 4) + '" r="' + (w * 0.32) + '" fill="' + rgba(pc, 0.1) + '"/></g>';
    } else if (pat === 'wave') {
      o = '<g opacity=".5" fill="none" stroke="' + pc + '" stroke-width="1.2">';
      for (var wi = 0; wi < 6; wi++) {
        var wy = Y + h * 0.16 + wi * h * 0.145;
        o += '<path d="M' + X + ' ' + wy.toFixed(1) + ' q ' + (w * 0.12) + ' ' + (-h * 0.055) + ' ' + (w * 0.25) + ' 0 t ' + (w * 0.25) + ' 0 t ' + (w * 0.25) + ' 0 t ' + (w * 0.25) + ' 0" opacity="' + (0.16 + wi * 0.04) + '"/>';
      }
      o += '</g>';
    } else if (pat === 'cloud') {
      o = '<g opacity=".45" fill="' + pc + '">';
      var clouds = [[0.2, 0.1, 1], [0.68, 0.07, .8], [0.4, 0.17, 1.1], [0.24, 0.42, .7], [0.72, 0.38, .9]];
      for (var ci = 0; ci < clouds.length; ci++) {
        var cx = X + w * clouds[ci][0], cy = Y + h * clouds[ci][1], sc = clouds[ci][2];
        o += '<g transform="translate(' + cx.toFixed(1) + ',' + cy.toFixed(1) + ') scale(' + sc + ')" opacity=".55"><path d="M-14 2 a5 5 0 0 1 6-5 a6 6 0 0 1 11-1 a5 5 0 0 1 6 5 a3 3 0 0 1-1 2 H-13 a3 3 0 0 1-1-1z" fill="' + pc + '"/></g>';
      }
      o += '</g>';
    } else if (pat === 'floral') {
      o = '<g opacity=".55">';
      var spots = [[0.24, 0.2], [0.72, 0.13], [0.5, 0.38], [0.2, 0.58], [0.78, 0.55], [0.42, 0.72]];
      for (var fi = 0; fi < spots.length; fi++) {
        var fx = X + w * spots[fi][0], fy = Y + h * spots[fi][1];
        o += '<g transform="translate(' + fx.toFixed(1) + ',' + fy.toFixed(1) + ') scale(' + (0.7 + (fi % 3) * 0.18) + ')"><g fill="' + pc + '" opacity=".75">';
        for (var pet = 0; pet < 5; pet++) {
          var pa = pet * 72 * Math.PI / 180;
          o += '<ellipse cx="' + (Math.cos(pa) * 3.4).toFixed(2) + '" cy="' + (Math.sin(pa) * 3.4).toFixed(2) + '" rx="2.1" ry="1.3" transform="rotate(' + (pet * 72) + ' ' + (Math.cos(pa) * 3.4).toFixed(2) + ' ' + (Math.sin(pa) * 3.4).toFixed(2) + ')"/>';
        }
        o += '</g><circle r="1.1" fill="' + C.accent + '"/><path d="M1 3 q4 6 1 11" stroke="' + rgba(pc, 0.5) + '" stroke-width=".8" fill="none"/></g>';
      }
      o += '</g>';
    } else if (pat === 'mountain') {
      o = '<g opacity=".62"><path d="M' + X + ' ' + (Y + h * 0.9) + ' L' + (X + w * 0.16) + ' ' + (Y + h * 0.62) + ' L' + (X + w * 0.3) + ' ' + (Y + h * 0.76) + ' L' + (X + w * 0.48) + ' ' + (Y + h * 0.5) + ' L' + (X + w * 0.66) + ' ' + (Y + h * 0.74) + ' L' + (X + w * 0.84) + ' ' + (Y + h * 0.6) + ' L' + (X + w) + ' ' + (Y + h * 0.88) + ' L' + (X + w) + ' ' + (Y + h) + ' L' + X + ' ' + (Y + h) + ' Z" fill="' + rgba(pc, 0.34) + '"/>' +
        '<path d="M' + X + ' ' + (Y + h * 0.97) + ' L' + (X + w * 0.22) + ' ' + (Y + h * 0.8) + ' L' + (X + w * 0.4) + ' ' + (Y + h * 0.92) + ' L' + (X + w * 0.62) + ' ' + (Y + h * 0.7) + ' L' + (X + w * 0.8) + ' ' + (Y + h * 0.9) + ' L' + (X + w) + ' ' + (Y + h * 0.78) + ' L' + (X + w) + ' ' + (Y + h) + ' L' + X + ' ' + (Y + h) + ' Z" fill="' + rgba(pc, 0.55) + '"/></g>';
    } else if (pat === 'pagoda') {
      var px = X + w * 0.5, baseY = Y + h * 0.98, ph = h * 0.62;
      o = '<g opacity=".62" fill="none" stroke="' + pc + '" stroke-width="1.1" stroke-linecap="round">';
      o += '<path d="M' + (px - w * 0.3) + ' ' + baseY + ' h' + (w * 0.6) + '"/>';
      for (var ti = 0; ti < 4; ti++) {
        var tw = w * (0.34 - ti * 0.065);
        var ty = baseY - ph * 0.18 - ti * ph * 0.2;
        o += '<path d="M' + (px - tw / 2) + ' ' + ty + ' h' + tw + '"/>';
        o += '<path d="M' + (px - tw / 2) + ' ' + (ty - 1) + ' q-' + (tw * 0.16) + ' -3 -' + (tw * 0.24) + ' 1" stroke-width=".9"/>';
        o += '<path d="M' + (px + tw / 2) + ' ' + (ty - 1) + ' q' + (tw * 0.16) + ' -3 ' + (tw * 0.24) + ' 1" stroke-width=".9"/>';
        o += '<path d="M' + (px - tw * 0.3) + ' ' + ty + ' v' + (-ph * 0.16) + ' M' + (px + tw * 0.3) + ' ' + ty + ' v' + (-ph * 0.16) + '"/>';
      }
      o += '<path d="M' + px + ' ' + (baseY - ph * 1.02) + ' v' + (-h * 0.05) + '"/><circle cx="' + px + '" cy="' + (baseY - ph * 1.02 - h * 0.05) + '" r="1.5" fill="' + pc + '" stroke="none"/>';
      o += '<path d="M' + (px - w * 0.34) + ' ' + (baseY - 1) + ' q' + (w * 0.34) + ' ' + (-h * 0.07) + ' ' + (w * 0.68) + ' 0" stroke-width=".8" opacity=".55"/>';
      o += '</g>';
    } else if (pat === 'window') {
      var wx = X + w * 0.5, wy = Y + h * 0.34, wr = w * 0.3;
      o = '<g opacity=".5" fill="none" stroke="' + pc + '">';
      o += '<circle cx="' + wx + '" cy="' + wy + '" r="' + wr + '" stroke-width="1.4"/>';
      o += '<circle cx="' + wx + '" cy="' + wy + '" r="' + (wr - 3) + '" stroke-width=".7" opacity=".7"/>';
      for (var gi = -1; gi <= 1; gi++) {
        o += '<path d="M' + (wx + gi * wr * 0.42) + ' ' + (wy - Math.sqrt(Math.max(0, wr * wr - Math.pow(gi * wr * 0.42, 2)))) + ' V' + (wy + Math.sqrt(Math.max(0, wr * wr - Math.pow(gi * wr * 0.42, 2)))) + '" stroke-width=".8"/>';
        o += '<path d="M' + (wx - Math.sqrt(Math.max(0, wr * wr - Math.pow(gi * wr * 0.42, 2)))) + ' ' + (wy + gi * wr * 0.42) + ' H' + (wx + Math.sqrt(Math.max(0, wr * wr - Math.pow(gi * wr * 0.42, 2)))) + '" stroke-width=".8"/>';
      }
      o += '</g>';
    } else if (pat === 'smoke') {
      o = '<g opacity=".5" fill="none" stroke="' + pc + '" stroke-width="1.3" stroke-linecap="round">';
      for (var si = 0; si < 4; si++) {
        var sx = X + w * (0.28 + si * 0.16), sy = Y + h * 0.92;
        o += '<path d="M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ' c ' + (-w * 0.14) + ' ' + (-h * 0.14) + ' ' + (w * 0.16) + ' ' + (-h * 0.22) + ' ' + (w * 0.02) + ' ' + (-h * 0.32) + ' c ' + (-w * 0.1) + ' ' + (-h * 0.1) + ' ' + (w * 0.1) + ' ' + (-h * 0.14) + ' ' + (w * 0.02) + ' ' + (-h * 0.22) + '" opacity="' + (0.3 + si * 0.12) + '"/>';
      }
      o += '</g>';
    } else if (pat === 'shield') {
      var sx2 = X + w * 0.5, sy2 = Y + h * 0.3, sw = w * 0.42, sh = h * 0.34;
      o = '<g opacity=".55" fill="none" stroke="' + pc + '" stroke-width="1.3">';
      o += '<path d="M' + (sx2 - sw / 2) + ' ' + (sy2 - sh / 2) + ' H' + (sx2 + sw / 2) + ' V' + (sy2 + sh * 0.12) + ' Q' + (sx2 + sw / 2) + ' ' + (sy2 + sh / 2) + ' ' + sx2 + ' ' + (sy2 + sh / 2) + ' Q' + (sx2 - sw / 2) + ' ' + (sy2 + sh / 2) + ' ' + (sx2 - sw / 2) + ' ' + (sy2 + sh * 0.12) + ' Z"/>';
      o += '<path d="M' + (sx2 - sw / 2 + 3) + ' ' + (sy2 - sh / 2 + 3) + ' H' + (sx2 + sw / 2 - 3) + ' V' + (sy2 + sh * 0.1) + ' Q' + (sx2 + sw / 2 - 3) + ' ' + (sy2 + sh / 2 - 4) + ' ' + sx2 + ' ' + (sy2 + sh / 2 - 4) + ' Q' + (sx2 - sw / 2 + 3) + ' ' + (sy2 + sh / 2 - 4) + ' ' + (sx2 - sw / 2 + 3) + ' ' + (sy2 + sh * 0.1) + ' Z" stroke-width=".7" opacity=".7"/>';
      o += '</g>';
    } else if (pat === 'tiananmen') {
      var tx = X + w * 0.5, by = Y + h * 0.9, bw = w * 0.86, bh = h * 0.15;
      o = '<g opacity=".72">';
      o += '<path d="M' + (tx - bw / 2) + ' ' + by + ' v' + (-bh * 0.45) + ' h' + bw + ' v' + (bh * 0.45) + ' Z" fill="' + rgba(pc, 0.5) + '"/>';
      o += '<path d="M' + (tx - bw * 0.4) + ' ' + (by - bh * 0.45) + ' h' + (bw * 0.8) + ' l' + (bw * 0.045) + ' -' + (bh * 0.22) + ' h' + (-bw * 0.89) + ' Z" fill="' + rgba(pc, 0.62) + '"/>';
      o += '<path d="M' + (tx - bw * 0.22) + ' ' + (by - bh * 0.67) + ' h' + (bw * 0.44) + ' l' + (bw * 0.03) + ' -' + (bh * 0.18) + ' h' + (-bw * 0.5) + ' Z" fill="' + rgba(pc, 0.55) + '"/>';
      o += '<path d="M' + (tx - bw * 0.075) + ' ' + by + ' v' + (-bh * 0.3) + ' a' + (bw * 0.075) + ' ' + (bh * 0.3) + ' 0 0 1 ' + (bw * 0.15) + ' 0 v' + (bh * 0.3) + ' Z" fill="' + rgba(C.bg, 0.85) + '"/>';
      for (var li = 0; li < 5; li++) {
        o += '<rect x="' + (tx - bw / 2 + 6 + li * (bw - 12) / 4) + '" y="' + (by - bh * 0.3) + '" width="1" height="' + (bh * 0.3) + '" fill="' + rgba(pc, 0.3) + '"/>';
      }
      o += '</g>';
    } else if (pat === 'wood') {
      o = '<g opacity=".55">';
      for (var wj = 0; wj < 18; wj++) {
        var gx = X + w * wj / 17;
        o += '<path d="M' + gx.toFixed(1) + ' ' + Y + ' q' + rand(-3, 3).toFixed(1) + ' ' + (h * 0.3) + ' ' + rand(-4, 4).toFixed(1) + ' ' + (h * 0.6) + ' q' + rand(-3, 3).toFixed(1) + ' ' + (h * 0.25) + ' ' + rand(-3, 3).toFixed(1) + ' ' + (h * 0.1) + '" stroke="' + rgba(pc, 0.16 + Math.random() * 0.16) + '" stroke-width="' + (0.4 + Math.random() * 0.9).toFixed(2) + '" fill="none"/>';
      }
      o += '<ellipse cx="' + (X + w * 0.8) + '" cy="' + (Y + h * 0.3) + '" rx="5" ry="8" fill="none" stroke="' + rgba(pc, 0.3) + '" stroke-width=".8"/><ellipse cx="' + (X + w * 0.8) + '" cy="' + (Y + h * 0.3) + '" rx="2.4" ry="4" fill="' + rgba(pc, 0.2) + '"/>';
      o += '</g>';
    } else {
      /* plain：极轻的斜向丝绸高光 */
      o = '<path d="M' + X + ' ' + (Y + h * 0.32) + ' L' + (X + w) + ' ' + (Y + h * 0.06) + ' L' + (X + w) + ' ' + (Y + h * 0.02) + ' L' + X + ' ' + (Y + h * 0.26) + ' Z" fill="' + rgba('#ffffff', 0.05) + '"/>';
    }
    return { defs: defs, decor: o || '' };
  }

  /* ---- 6.2b 品牌主视觉 / 条带 / 警示语 / 徽标 ---- */
  function emblemSize(text, vertical) {
    var t = String(text || '');
    var n = t.length;
    var cjk = /[\u4e00-\u9fa5]/.test(t);
    if (vertical) {
      if (cjk) return n <= 2 ? 30 : n === 3 ? 24 : n === 4 ? 20 : 15;
      return n <= 7 ? 13 : 10;
    }
    if (cjk) return n <= 2 ? 28 : n === 3 ? 22 : n === 4 ? 18 : 14;
    return n <= 7 ? 15 : n <= 10 ? 12 : 9.5;
  }

  function emblemMarkup(p, g, C, uid) {
    var pk = p.pack;
    var text = String(pk.emblem || p.brand || '').trim();
    if (!text) return '';
    var vertical = (pk.brandPosition === 'vertical' && g.face !== 'cigar' && g.face !== 'tin') || g.face === 'pod';
    var font = EMBLEM_FONT[pk.emblemStyle] || FONT_SERIF;
    var bold = pk.emblemStyle === 'block' ? '900' : (pk.emblemStyle === 'brush' ? '700' : '600');
    var x, y, rot = 0, anchor = 'middle';
    if (vertical) {
      x = g.fx + g.fw * 0.5;
      y = g.fy + g.fh * 0.36;
      rot = 0;
    } else {
      x = g.fx + g.fw * 0.5;
      y = g.fy + (g.fh * (g.face === 'pod' ? 0.42 : 0.3));
    }
    var size = emblemSize(text, vertical);
    if (g.face === 'pod') size = Math.min(size, text.length > 4 ? 10 : 13);
    var ls = pk.emblemStyle === 'block' ? (vertical ? 1.2 : 1.1) : (vertical ? 0.5 : 0.6);
    var fill = 'url(#' + uid + 'foil)';
    var out = '<g class="smk-emblem">';
    if (vertical) {
      /* 竖排：逐字直立堆叠（比整段旋转更接近真实烟盒） */
      var chars = text.split('');
      var n = chars.length;
      var step = size * (n <= 3 ? 1.02 : 0.98);
      var total = step * (n - 1);
      var firstY = y - total / 2 + size * 0.34;
      for (var i = 0; i < n; i++) {
        var cy = firstY + i * step;
        var isAscii = /[A-Za-z0-9]/.test(chars[i]);
        var cSize = isAscii ? size * 0.86 : size;
        var t = '<text x="' + x + '" y="' + cy.toFixed(2) + '" font-family="' + font + '" font-size="' + cSize.toFixed(2) + '" font-weight="' + bold + '" text-anchor="' + anchor + '" letter-spacing="' + ls + '"' +
          (pk.emblemStyle === 'script' || pk.emblemStyle === 'brush' ? ' font-style="italic"' : '') + '>' + svgText(chars[i]) + '</text>';
        if (pk.emboss) {
          out += '<g fill="' + rgba('#000000', 0.42) + '" transform="translate(1,1)">' + t + '</g>';
          out += '<g fill="' + rgba('#ffffff', 0.26) + '" transform="translate(-0.6,-0.6)">' + t + '</g>';
        }
        out += t.replace(/<text /, '<text fill="' + fill + '" stroke="' + rgba(C.light ? '#ffffff' : '#000000', 0.16) + '" stroke-width=".3" ');
      }
    } else {
      var tx = '<text x="' + x + '" y="' + y + '" font-family="' + font + '" font-size="' + size + '" font-weight="' + bold + '" text-anchor="' + anchor + '" letter-spacing="' + ls + '"' +
        (pk.emblemStyle === 'script' || pk.emblemStyle === 'brush' ? ' font-style="italic"' : '') + '>' + svgText(text) + '</text>';
      if (pk.emboss) {
        out += '<g fill="' + rgba('#000000', 0.42) + '" transform="translate(1,1)">' + tx + '</g>';
        out += '<g fill="' + rgba('#ffffff', 0.26) + '" transform="translate(-0.6,-0.6)">' + tx + '</g>';
      }
      out += tx.replace(/<text /, '<text fill="' + fill + '" style="paint-order:stroke" stroke="' + rgba(C.light ? '#ffffff' : '#000000', 0.16) + '" stroke-width=".35" ');
    }
    out += '</g>';
    return out;
  }

  function bandMarkup(p, g, C, uid) {
    var pk = p.pack, band = pk.band || 'none';
    if (band === 'none') return '';
    var x = g.fx, w = g.fw, y, h;
    var col = C.band;
    if (band === 'top') { y = g.fy + 3; h = Math.max(5, g.fh * 0.045); }
    else if (band === 'middle') { y = g.fy + g.fh * 0.5; h = Math.max(4, g.fh * 0.033); }
    else if (band === 'bottom') { y = g.fy + g.fh - 30; h = Math.max(4, g.fh * 0.032); }
    var out = '';
    if (band === 'diagonal') {
      out += '<path d="M' + x + ' ' + (g.fy + g.fh * 0.46) + ' L' + (x + w) + ' ' + (g.fy + g.fh * 0.18) + ' L' + (x + w) + ' ' + (g.fy + g.fh * 0.24) + ' L' + x + ' ' + (g.fy + g.fh * 0.52) + ' Z" fill="url(#' + uid + 'bandG)" opacity=".92"/>';
    } else {
      out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="url(#' + uid + 'bandG)" opacity=".92"/>';
      out += '<rect x="' + x + '" y="' + (y + h - 0.6) + '" width="' + w + '" height=".6" fill="' + rgba(col, 0.5) + '"/>';
      out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height=".6" fill="' + rgba('#ffffff', 0.3) + '"/>';
    }
    return out;
  }

  function warningMarkup(p, g, C) {
    if (!p.pack.warningBand) return '';
    var stripH = Math.max(14, g.fh * 0.105);
    var y = g.fy + g.fh - stripH;
    var bgc = C.light ? 'rgba(250,247,238,.92)' : 'rgba(0,0,0,.36)';
    var txc = C.light ? '#24221d' : rgba(C.ink, 0.92);
    var line1 = '本公司提示：吸烟有害健康';
    var line2 = '请勿在禁烟场所吸烟';
    var fs = Math.max(3.6, Math.min(4.6, g.fw / 20));
    return '<g class="smk-warn">' +
      '<rect x="' + g.fx + '" y="' + y + '" width="' + g.fw + '" height="' + stripH + '" fill="' + bgc + '"/>' +
      '<text x="' + (g.fx + g.fw / 2) + '" y="' + (y + stripH * 0.42) + '" font-family="' + FONT_SANS + '" font-size="' + fs + '" fill="' + txc + '" text-anchor="middle" letter-spacing=".2">' + line1 + '</text>' +
      '<text x="' + (g.fx + g.fw / 2) + '" y="' + (y + stripH * 0.8) + '" font-family="' + FONT_SANS + '" font-size="' + (fs * 0.86) + '" fill="' + txc + '" text-anchor="middle" opacity=".78" letter-spacing=".2">' + line2 + '</text>' +
      '</g>';
  }

  function badgeMarkup(p, g, C) {
    var badge = String(p.pack.badge || '').trim();
    if (!badge) return '';
    var text = badge.length > 3 ? badge.slice(0, 3) : badge;
    var fs = 5.4;
    var w = Math.max(13, text.length * fs + 5);
    var x = g.fx + g.fw - w - 4;
    var y = g.fy + g.fh - (p.pack.warningBand ? Math.max(14, g.fh * 0.105) : 4) - 10;
    return '<g class="smk-badge"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + 9.5 + '" rx="2.2" fill="' + rgba(C.accent, 0.92) + '"/>' +
      '<text x="' + (x + w / 2) + '" y="' + (y + 7) + '" font-family="' + FONT_SANS + '" font-size="' + fs + '" font-weight="700" fill="' + contrastInk(C.accent) + '" text-anchor="middle">' + svgText(text) + '</text></g>';
  }

  function countMarkup(p, g, C) {
    var label, unit;
    if (p.category === 'vape') { label = '1'; unit = '杆'; }
    else if (p.category === 'cigar') { label = '10'; unit = '支'; }
    else if (p.category === 'roll') { label = '40'; unit = 'g'; }
    else { label = '20'; unit = '支'; }
    var x = g.fx + g.fw - 8;
    var y = g.fy + g.fh - (p.pack.warningBand ? Math.max(14, g.fh * 0.105) : 2) - (p.pack.badge ? 22 : 3);
    return '<g class="smk-count"><text x="' + x + '" y="' + y + '" font-family="' + FONT_SANS + '" font-size="9.2" font-weight="700" fill="' + rgba(C.light ? '#26231c' : C.ink, 0.85) + '" text-anchor="end" letter-spacing=".2">' + label + '</text>' +
      '<text x="' + (x + 1) + '" y="' + y + '" font-family="' + FONT_SANS + '" font-size="4.4" fill="' + rgba(C.light ? '#26231c' : C.ink, 0.6) + '" text-anchor="start">' + unit + '</text></g>';
  }

  function brandEnMarkup(p, g, C) {
    var en = String(p.pack.brandEn || p.brandEn || '').trim();
    if (!en) return '';
    var fs = Math.min(5.4, Math.max(3.8, 50 / Math.max(4, en.length)));
    return '<text x="' + (g.fx + 5) + '" y="' + (g.fy + g.fh - (p.pack.warningBand ? Math.max(14, g.fh * 0.105) : 2) - 3) + '" font-family="' + FONT_SANS + '" font-size="' + fs + '" fill="' + rgba(C.light ? '#2a2620' : C.ink, 0.62) + '" letter-spacing=".6" text-anchor="start">' + svgText(en.toUpperCase()) + '</text>';
  }

  /* ---- 6.3 烟盒渲染入口 ---- */
  function renderPackSVG(p, opts) {
    try {
      opts = opts || {};
      var g = packGeom(p);
      var C = packColors(p);
      var uid = uidFor(p);
      var defs = '';
      /* 渐变 */
      defs += '<linearGradient id="' + uid + 'bg" x1="0" y1="0" x2="1" y2="1.1">' +
        '<stop offset="0" stop-color="' + tint(C.bg, 0.14) + '"/>' +
        '<stop offset=".42" stop-color="' + C.bg + '"/>' +
        '<stop offset="1" stop-color="' + C.bg2 + '"/></linearGradient>';
      defs += '<linearGradient id="' + uid + 'foil" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="' + tint(C.accent, 0.5) + '"/>' +
        '<stop offset=".32" stop-color="' + tint(C.accent, 0.18) + '"/>' +
        '<stop offset=".55" stop-color="' + tint(C.accent, -0.18) + '"/>' +
        '<stop offset=".78" stop-color="' + tint(C.accent, 0.32) + '"/>' +
        '<stop offset="1" stop-color="' + tint(C.accent, -0.08) + '"/></linearGradient>';
      defs += '<linearGradient id="' + uid + 'bandG" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0" stop-color="' + tint(C.band, -0.24) + '"/>' +
        '<stop offset=".22" stop-color="' + tint(C.band, 0.28) + '"/>' +
        '<stop offset=".5" stop-color="' + C.band + '"/>' +
        '<stop offset=".78" stop-color="' + tint(C.band, 0.24) + '"/>' +
        '<stop offset="1" stop-color="' + tint(C.band, -0.3) + '"/></linearGradient>';
      defs += '<linearGradient id="' + uid + 'gloss" x1="0" y1="0" x2=".8" y2="1">' +
        '<stop offset="0" stop-color="#ffffff" stop-opacity=".20"/>' +
        '<stop offset=".35" stop-color="#ffffff" stop-opacity=".04"/>' +
        '<stop offset="1" stop-color="#000000" stop-opacity=".16"/></linearGradient>';
      var pd = patternDefsAndDecor(p, g, C, uid);
      defs += pd.defs;
      defs += '<clipPath id="' + uid + 'clip"><rect x="' + g.fx + '" y="' + g.fy + '" width="' + g.fw + '" height="' + g.fh + '" rx="' + (g.face === 'pod' ? g.rx : (g.face === 'tin' ? g.rx : 2.6)) + '"/></clipPath>';

      var body = '';
      if (g.face === 'hard') body = buildHardBody(p, g, C, uid);
      else if (g.face === 'soft') body = buildSoftBody(p, g, C, uid);
      else if (g.face === 'tin') body = buildTinBody(p, g, C, uid);
      else if (g.face === 'pod') body = buildPodBody(p, g, C, uid);
      else body = buildCigarBody(p, g, C, uid);

      var front = '<g clip-path="url(#' + uid + 'clip)">' +
        '<rect x="' + g.fx + '" y="' + g.fy + '" width="' + g.fw + '" height="' + g.fh + '" fill="url(#' + uid + 'bg)"/>' +
        (C.light ? '<g opacity=".62">' + pd.decor + '</g>' : pd.decor) +
        bandMarkup(p, g, C, uid) +
        emblemMarkup(p, g, C, uid) +
        brandEnMarkup(p, g, C) +
        warningMarkup(p, g, C) +
        badgeMarkup(p, g, C) +
        countMarkup(p, g, C) +
        '<rect x="' + g.fx + '" y="' + g.fy + '" width="' + g.fw + '" height="' + g.fh + '" fill="url(#' + uid + 'gloss)"/>' +
        '</g>';
      if (g.face === 'hard' || g.face === 'soft') {
        /* 顶面 / 纸口等外层已由 body 绘制，正面覆盖在中间占位处 */
        body = body.replace('<!--FRONT-->', front);
      } else {
        body += front;
      }
      return '<svg class="smk-pack-svg" viewBox="0 0 ' + g.vw + ' ' + g.vh + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
        '<defs>' + defs + '</defs>' + body + '</svg>';
    } catch (e) {
      try { return renderPackFallback(p); } catch (e2) { return ''; }
    }
  }

  function renderPackFallback(p) {
    var c = (p && p.pack && p.pack.bg) || '#7a1b1b';
    return '<svg viewBox="0 0 100 140" aria-hidden="true"><rect x="4" y="4" width="92" height="132" rx="5" fill="' + c + '" stroke="rgba(255,255,255,.2)"/></svg>';
  }

  /* 硬盒：顶面 + 右侧面 + 正面（正面用 <!--FRONT--> 占位） */
  function buildHardBody(p, g, C, uid) {
    var x = g.fx, y = g.fy, w = g.fw, h = g.fh, s = g.side || 8, t = 8;
    var out = '';
    /* 侧面 */
    out += '<path d="M' + (x + w) + ' ' + (y + 3) + ' L' + (x + w + s) + ' ' + (y - t + 4) + ' L' + (x + w + s) + ' ' + (y + h - 3) + ' L' + (x + w) + ' ' + (y + h) + ' Z" fill="' + tint(C.bg2, -0.16) + '" stroke="' + rgba('#000000', 0.35) + '" stroke-width=".6"/>';
    out += '<path d="M' + (x + w) + ' ' + (y + 3) + ' L' + (x + w + s) + ' ' + (y - t + 4) + ' L' + (x + w + s) + ' ' + (y - t + 9) + ' L' + (x + w) + ' ' + (y + 8) + ' Z" fill="' + rgba('#ffffff', 0.08) + '"/>';
    /* 顶面 */
    out += '<path d="M' + (x + 3) + ' ' + y + ' L' + (x + w - 2) + ' ' + y + ' L' + (x + w + s) + ' ' + (y - t + 4) + ' L' + (x + 3 + s) + ' ' + (y - t) + ' Z" fill="' + tint(C.bg, 0.26) + '" stroke="' + rgba('#000000', 0.28) + '" stroke-width=".6"/>';
    out += '<path d="M' + (x + 3) + ' ' + y + ' L' + (x + w - 2) + ' ' + y + ' L' + (x + w - 2) + ' ' + (y - 1.2) + ' L' + (x + 3) + ' ' + (y - 1.2) + ' Z" fill="' + rgba('#ffffff', 0.22) + '"/>';
    return out + '<!--FRONT-->';
  }

  /* 软盒：褶皱顶部 + 轻微鼓起的侧边（顶部纸口画在正面之上） */
  function buildSoftBody(p, g, C, uid) {
    var x = g.fx, y = g.fy, w = g.fw, h = g.fh;
    var out = '';
    /* 纸包立体边 */
    out += '<path d="M' + (x + w) + ' ' + (y + 4) + ' q7 3 6 ' + (h * 0.5) + ' q-1 ' + (h * 0.42) + ' -6 ' + (h * 0.45) + ' Z" fill="' + tint(C.bg2, -0.1) + '" opacity=".9"/>';
    /* 侧面折痕 */
    out += '<path d="M' + (x + 3) + ' ' + (y + 12) + ' q-2 ' + (h * 0.4) + ' 1 ' + (h * 0.8) + '" stroke="' + rgba('#ffffff', 0.1) + '" stroke-width=".8" fill="none"/>';
    out += '<!--FRONT-->';
    /* 顶部折纸口（正面之上） */
    var zig = '';
    var n = 12, zw = w / n;
    zig += 'M' + x + ' ' + (y + 9);
    for (var i = 0; i < n; i++) {
      zig += ' L' + (x + zw * (i + 0.5)).toFixed(1) + ' ' + (y + 1.2) + ' L' + (x + zw * (i + 1)).toFixed(1) + ' ' + (y + 9);
    }
    out += '<path d="' + zig + ' L' + (x + w) + ' ' + (y + 12) + ' L' + x + ' ' + (y + 12) + ' Z" fill="' + rgba('#f7f1e2', 0.9) + '"/>';
    out += '<path d="M' + x + ' ' + (y + 9.2) + ' h' + w + '" stroke="' + rgba('#ffffff', 0.55) + '" stroke-width=".5"/>';
    out += '<path d="M' + x + ' ' + (y + 12) + ' h' + w + '" stroke="' + rgba('#000000', 0.18) + '" stroke-width=".5"/>';
    /* 抽口撕开的缺口 */
    out += '<path d="M' + (x + w * 0.62) + ' ' + (y + 10) + ' q' + (w * 0.1) + ' 4 ' + (w * 0.16) + ' -1 q-' + (w * 0.08) + ' 1 -' + (w * 0.16) + ' 1 Z" fill="' + rgba(C.bg2, 0.9) + '"/>';
    return out;
  }

  /* 铁盒：圆柱金属质感 */
  function buildTinBody(p, g, C, uid) {
    var x = g.fx, y = g.fy, w = g.fw, h = g.fh;
    var out = '';
    out += '<ellipse cx="' + (x + w / 2) + '" cy="' + (y + 6) + '" rx="' + (w / 2) + '" ry="6.5" fill="' + tint(C.bg, 0.3) + '" stroke="' + rgba('#000000', 0.3) + '" stroke-width=".6"/>';
    out += '<rect x="' + x + '" y="' + (y + 6) + '" width="' + w + '" height="' + (h - 12) + '" fill="url(#' + uid + 'bg)"/>';
    out += '<rect x="' + x + '" y="' + (y + 6) + '" width="' + w + '" height="' + (h - 12) + '" fill="url(#' + uid + 'gloss)"/>';
    /* 金属竖向高光 */
    out += '<rect x="' + (x + w * 0.12) + '" y="' + (y + 8) + '" width="' + (w * 0.06) + '" height="' + (h - 16) + '" fill="' + rgba('#ffffff', 0.16) + '"/>';
    out += '<rect x="' + (x + w * 0.74) + '" y="' + (y + 8) + '" width="' + (w * 0.025) + '" height="' + (h - 16) + '" fill="' + rgba('#ffffff', 0.1) + '"/>';
    /* 盒盖缝 */
    out += '<path d="M' + x + ' ' + (y + 16) + ' H' + (x + w) + '" stroke="' + rgba('#000000', 0.4) + '" stroke-width="1"/>';
    out += '<path d="M' + x + ' ' + (y + 15) + ' H' + (x + w) + '" stroke="' + rgba('#ffffff', 0.24) + '" stroke-width=".5"/>';
    out += '<ellipse cx="' + (x + w / 2) + '" cy="' + (y + h - 6) + '" rx="' + (w / 2) + '" ry="6" fill="' + tint(C.bg, -0.2) + '" stroke="' + rgba('#000000', 0.32) + '" stroke-width=".6"/>';
    return out + '<!--FRONT-->';
  }

  /* 电子烟杆 */
  function buildPodBody(p, g, C, uid) {
    var x = g.fx, y = g.fy, w = g.fw, h = g.fh;
    var out = '';
    out += '<rect x="' + (x - 1) + '" y="' + (y - 1) + '" width="' + (w + 2) + '" height="' + (h + 2) + '" rx="15" fill="url(#' + uid + 'bg)"/>';
    /* 烟弹（顶部） */
    out += '<path d="M' + (x + 6) + ' ' + (y + 1) + ' h' + (w - 12) + ' a9 9 0 0 1 9 9 v' + (h * 0.12) + ' h' + (-(w - 12 - 18)) + ' Z" fill="' + tint(C.bg2, 0.32) + '" opacity=".95"/>';
    out += '<rect x="' + (x + w * 0.34) + '" y="' + (y - 4) + '" width="' + (w * 0.32) + '" height="12" rx="4" fill="' + tint(C.bg, 0.18) + '"/>';
    /* 烟弹观察窗 */
    out += '<rect x="' + (x + w * 0.22) + '" y="' + (y + h * 0.12) + '" width="' + (w * 0.56) + '" height="' + (h * 0.16) + '" rx="4" fill="rgba(0,0,0,.35)" stroke="' + rgba(C.accent, 0.4) + '" stroke-width=".5"/>';
    out += '<rect x="' + (x + w * 0.22) + '" y="' + (y + h * 0.12) + '" width="' + (w * 0.56) + '" height="' + (h * 0.16) + '" rx="4" fill="url(#' + uid + 'gloss)" opacity=".6"/>';
    /* 装饰环 */
    out += '<rect x="' + (x + 2) + '" y="' + (y + h * 0.34) + '" width="' + (w - 4) + '" height="1.4" fill="' + rgba(C.accent, 0.85) + '"/>';
    out += '<rect x="' + (x + 2) + '" y="' + (y + h * 0.52) + '" width="' + (w - 4) + '" height=".7" fill="' + rgba(C.accent, 0.45) + '"/>';
    /* 指示灯 */
    out += '<circle cx="' + (x + w / 2) + '" cy="' + (y + h * 0.88) + '" r="2" fill="' + rgba(C.accent, 0.95) + '"><animate attributeName="opacity" values=".35;1;.35" dur="2.6s" repeatCount="indefinite"/></circle>';
    out += '<circle cx="' + (x + w / 2) + '" cy="' + (y + h * 0.88) + '" r="4.4" fill="' + rgba(C.accent, 0.18) + '"/>';
    /* 进气孔 */
    out += '<circle cx="' + (x + w * 0.3) + '" cy="' + (y + h * 0.94) + '" r="1.1" fill="rgba(0,0,0,.5)"/><circle cx="' + (x + w * 0.7) + '" cy="' + (y + h * 0.94) + '" r="1.1" fill="rgba(0,0,0,.5)"/>';
    /* 底部 */
    out += '<rect x="' + (x - 1) + '" y="' + (y + h - 5) + '" width="' + (w + 2) + '" height="5" rx="2.5" fill="' + tint(C.bg2, -0.1) + '"/>';
    return out + '<!--FRONT-->';
  }

  /* 雪茄盒：木质 + 烫金 */
  function buildCigarBody(p, g, C, uid) {
    var x = g.fx, y = g.fy, w = g.fw, h = g.fh;
    var out = '';
    /* 顶盖 */
    out += '<path d="M' + (x + 4) + ' ' + y + ' L' + (x + w) + ' ' + y + ' L' + (x + w + 6) + ' ' + (y - 8) + ' L' + (x + 10) + ' ' + (y - 8) + ' Z" fill="' + tint(C.bg, 0.22) + '"/>';
    /* 侧面 */
    out += '<path d="M' + (x + w) + ' ' + (y + 2) + ' L' + (x + w + 6) + ' ' + (y - 6) + ' L' + (x + w + 6) + ' ' + (y + h - 6) + ' L' + (x + w) + ' ' + (y + h) + ' Z" fill="' + tint(C.bg2, -0.12) + '"/>';
    /* 正面木纹底 */
    out += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="url(#' + uid + 'bg)"/>';
    /* 铜角 */
    out += '<path d="M' + x + ' ' + (y + 10) + ' v-10 h10" fill="none" stroke="' + rgba(C.accent, 0.8) + '" stroke-width="1.6"/>';
    out += '<path d="M' + (x + w) + ' ' + (y + 10) + ' v-10 h-10" fill="none" stroke="' + rgba(C.accent, 0.8) + '" stroke-width="1.6"/>';
    out += '<path d="M' + x + ' ' + (y + h - 10) + ' v10 h10" fill="none" stroke="' + rgba(C.accent, 0.8) + '" stroke-width="1.6"/>';
    out += '<path d="M' + (x + w) + ' ' + (y + h - 10) + ' v10 h-10" fill="none" stroke="' + rgba(C.accent, 0.8) + '" stroke-width="1.6"/>';
    /* 烫金铭牌 */
    var pw = w * 0.62, ph = h * 0.38, px = x + (w - pw) / 2, py = y + h * 0.24;
    out += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph + '" rx="2" fill="' + rgba(C.accent, 0.12) + '" stroke="' + rgba(C.accent, 0.75) + '" stroke-width=".9"/>';
    out += '<rect x="' + (px + 2) + '" y="' + (py + 2) + '" width="' + (pw - 4) + '" height="' + (ph - 4) + '" rx="1.4" fill="none" stroke="' + rgba(C.accent, 0.4) + '" stroke-width=".5"/>';
    return out + '<!--FRONT-->';
  }

  /* 面板网格缩略图（保持 svg 不变，仅包裹容器） */
  function renderPackThumb(p) {
    var src = packImageFor(p);
    if (src) {
      return '<div class="smk-thumb"><img class="smk-thumb-img" src="' + escapeHtml(src) + '" alt="" draggable="false" loading="lazy"' +
        ' onerror="this.style.display=\'none\';if(this.nextSibling)this.nextSibling.style.display=\'flex\';try{if(window.__smkNoteAssetFail)window.__smkNoteAssetFail();}catch(e){}">' +
        '<span class="smk-thumb-fallback" style="display:none">' + renderPackSVG(p, { thumb: true }) + '</span></div>';
    }
    return '<div class="smk-thumb">' + renderPackSVG(p, { thumb: true }) + '</div>';
  }

  /* ---- 6.4 烟支 / 打火机 / 烟灰缸 ---- */
  /* progress 0..1 燃烧比例（从点燃端烧掉的比例）；state: lit / out */
  function renderCigSVG(p, progress, mode, ashAmt) {
    try {
      progress = clamp(progress || 0, 0, 0.68);
      ashAmt = clamp(ashAmt || 0, 0, 1);
      var isVape = p.category === 'vape' || p.type === 'pod';
      var isRoll = p.category === 'roll';
      var spec = cigSpec(p);
      var isCigar = spec.isCigar;
      var c = p.cig || {};
      var paper = c.paper || '#f7f2e4';
      var filter = c.filterColor || '#c99a5b';
      var ring = c.ringColor || '#d8b35a';
      if (isCigar && isLightColor(paper)) paper = '#8a5a32';
      if (isCigar) filter = c.bandColor || '#c9a25a';
      var fLen = isCigar ? 0 : clamp(spec.filterFrac, 0.1, 0.55);
      /* v3：按 SKU 真实直径/长度比例出图（viewBox 高 ≈ 烟支直径映射） */
      var W = 170;
      var H = clamp(W * spec.diameter / Math.max(40, spec.length), 7, 56);
      if (isCigar) H = Math.max(H, 20);
      var y = H / 2, cy = y;
      var th = H;
      var uid = uidFor(p) + (mode === 'hero' ? 'h' : 'c');
      var burn = progress * (1 - fLen) * W;
      var tipX = 6 + burn;
      var bodyLen = W - 6 - burn;
      var filterStart = W - 6 - W * fLen;
      var defs = '';
      defs += '<linearGradient id="' + uid + 'p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tint(paper, 0.22) + '"/><stop offset=".45" stop-color="' + paper + '"/><stop offset="1" stop-color="' + tint(paper, -0.2) + '"/></linearGradient>';
      defs += '<linearGradient id="' + uid + 'f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tint(filter, 0.26) + '"/><stop offset=".5" stop-color="' + filter + '"/><stop offset="1" stop-color="' + tint(filter, -0.28) + '"/></linearGradient>';
      defs += '<radialGradient id="' + uid + 'e" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3c8"/><stop offset=".35" stop-color="#ffc46b"/><stop offset=".72" stop-color="#ff7a2f"/><stop offset="1" stop-color="#c33d0d"/></radialGradient>';
      defs += '<linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + rgba('#ffffff', 0.4) + '"/><stop offset=".5" stop-color="' + rgba('#ffffff', 0.05) + '"/><stop offset="1" stop-color="' + rgba('#000000', 0.16) + '"/></linearGradient>';
      var out = '<svg class="smk-cig-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs>' + defs + '</defs>';
      if (isVape) {
        /* 电子烟：长条杆 + 发光烟弹 */
        var vx = tipX + 8, vw = Math.max(30, filterStart - vx + 6);
        out += '<rect x="' + vx + '" y="' + (cy - th / 2) + '" width="' + vw + '" height="' + th + '" rx="' + (th / 2) + '" fill="' + tint(paper, -0.55) + '" stroke="' + rgba('#000000', 0.4) + '" stroke-width=".5"/>';
        out += '<rect x="' + (vx + 2) + '" y="' + (cy - th / 2 + 1.4) + '" width="' + (vw - 4) + '" height="' + th * 0.32 + '" rx="' + (th * 0.18) + '" fill="' + rgba('#ffffff', 0.14) + '"/>';
        out += '<rect x="' + (filterStart) + '" y="' + (cy - th / 2 - 1.6) + '" width="' + (W - 6 - filterStart + 4) + '" height="' + (th + 3.2) + '" rx="' + (th / 2) + '" fill="url(#' + uid + 'f)"/>';
        out += '<circle cx="' + (filterStart + 7) + '" cy="' + cy + '" r="2.4" fill="' + (mode === 'lit' ? '#7df0ff' : '#4a5a60') + '"' + (mode === 'lit' ? ' opacity=".95"' : ' opacity=".5"') + '/>';
        out += '<rect x="' + (filterStart + 13) + '" y="' + (cy - 1) + '" width="' + (W - 6 - filterStart - 18) + '" height="2" rx="1" fill="' + rgba(ring, 0.55) + '"/>';
        if (mode === 'lit') {
          out += '<circle cx="' + (vx + 5) + '" cy="' + cy + '" r="9" fill="url(#' + uid + 'e)" opacity=".18"/>';
        }
      } else if (isCigar) {
        out += '<rect x="' + tipX + '" y="' + (cy - th / 2) + '" width="' + bodyLen + '" height="' + th + '" rx="' + (th * 0.3) + '" fill="url(#' + uid + 'p)"/>';
        /* 茄衣叶脉 */
        out += '<path d="M' + (tipX + 10) + ' ' + (cy - th * 0.24) + ' q' + (bodyLen * 0.3) + ' ' + (-th * 0.08) + ' ' + (bodyLen * 0.6) + ' 0" stroke="' + rgba('#000000', 0.2) + '" fill="none" stroke-width="' + (th * 0.045).toFixed(2) + '"/>';
        out += '<path d="M' + (tipX + 14) + ' ' + (cy + th * 0.2) + ' q' + (bodyLen * 0.25) + ' ' + (th * 0.1) + ' ' + (bodyLen * 0.55) + ' 0" stroke="' + rgba('#000000', 0.15) + '" fill="none" stroke-width="' + (th * 0.04).toFixed(2) + '"/>';
        out += '<path d="M' + (tipX + 6) + ' ' + (cy - th / 2 + 1.4) + ' h' + Math.max(0, bodyLen - 12) + '" stroke="' + rgba('#ffffff', 0.16) + '" stroke-width="' + (th * 0.08).toFixed(2) + '"/>';
        /* 腰花（双道金圈 + 中央茄标） */
        var bandX = W - 6 - W * 0.3;
        out += '<rect x="' + bandX + '" y="' + (cy - th / 2 - 1.4) + '" width="' + (W * 0.13) + '" height="' + (th + 2.8) + '" rx="2" fill="url(#' + uid + 'f)"/>';
        out += '<rect x="' + bandX + '" y="' + (cy - th * 0.36) + '" width="' + (W * 0.13) + '" height="' + (th * 0.3) + '" fill="' + rgba(ring, 0.9) + '"/>';
        out += '<rect x="' + (bandX + 2) + '" y="' + (cy - th * 0.3) + '" width="' + (W * 0.13 - 4) + '" height="' + (th * 0.16) + '" fill="' + rgba('#1b1208', 0.7) + '"/>';
        try {
          var cBrand = /[A-Za-z]/.test(p.brandEn || '') ? String(p.brandEn || '') : String(p.brand || '');
          if (cBrand) out += '<text x="' + (bandX + W * 0.065) + '" y="' + (cy - th * 0.16) + '" font-family="' + FONT_SANS + '" font-size="' + Math.max(2.2, th * 0.14).toFixed(2) + '" fill="' + rgba('#f2e2b8', 0.9) + '" text-anchor="middle" letter-spacing=".4" textLength="' + (W * 0.1).toFixed(1) + '" lengthAdjust="spacingAndGlyphs">' + svgText(cBrand) + '</text>';
        } catch (e) {}
        /* 剪好的茄帽（右端深色收口） */
        out += '<path d="M' + (W - 7) + ' ' + (cy - th / 2) + ' q-' + (th * 0.42).toFixed(2) + ' ' + (th * 0.16).toFixed(2) + ' ' + (-th * 0.34).toFixed(2) + ' ' + (th * 0.5).toFixed(2) + ' q' + (th * 0.1).toFixed(2) + ' ' + (th * 0.34).toFixed(2) + ' ' + (th * 0.34).toFixed(2) + ' ' + (th * 0.5).toFixed(2) + ' Z" fill="' + tint(paper, -0.34) + '"/>';
        /* 雪茄燃烧端：更粗的灰 + 更大火头 */
        var cbx = tipX;
        if (mode === 'lit' || progress > 0.005) {
          var cashW = Math.min(bodyLen, 9 + ashAmt * 34);
          var chg = ashAmt > 0.55 ? (ashAmt - 0.55) * 26 : 0;
          out += '<path d="M' + cbx + ' ' + (cy - th / 2) + ' h' + cashW + ' v' + th + ' h-' + cashW + ' q-' + (th * 0.24).toFixed(2) + ' -' + (th * 0.5).toFixed(2) + ' 0 -' + th + ' Z" fill="#6d675f"/>';
          out += '<path d="M' + cbx + ' ' + (cy - th / 2) + ' h' + cashW + ' v' + (th * 0.5) + ' h-' + cashW + ' Z" fill="' + rgba('#c8c2b6', 0.55) + '"/>';
          out += '<path d="M' + (cbx + cashW) + ' ' + (cy - th / 2) + ' q' + (4 + chg) + ' ' + (chg * 0.4) + ' ' + (2 + chg * 0.4) + ' ' + (th + chg) + '" stroke="#9e988e" stroke-width="' + (th * 0.34).toFixed(2) + '" fill="none" stroke-linecap="round"/>';
          out += '<ellipse cx="' + (cbx + 1.5) + '" cy="' + cy + '" rx="' + (th * 0.5) + '" ry="' + (th * 0.56) + '" fill="url(#' + uid + 'e)"/>';
          if (mode === 'lit') {
            out += '<ellipse cx="' + (cbx + 1) + '" cy="' + cy + '" rx="' + (th * 1.25) + '" ry="' + (th * 1.4) + '" fill="' + rgba('#ff7a2c', 0.24) + '"/>';
          }
        } else {
          out += '<path d="M' + (cbx - 2) + ' ' + (cy - th / 2) + ' q' + (th * 0.3) + ' ' + (th * 0.5) + ' 0 ' + th + ' Z" fill="' + tint(paper, 0.12) + '"/>';
        }
      } else {
        /* 常规纸烟 / 细支 / 中支 / 短支 */
        out += '<rect x="' + tipX + '" y="' + (cy - th / 2) + '" width="' + Math.max(2, bodyLen) + '" height="' + th + '" rx="' + (th * 0.16) + '" fill="url(#' + uid + 'p)"/>';
        /* v4：燃烧线后的纸身变深 + 微卷焦边 */
        var charW = Math.min(bodyLen, 3 + progress * 9);
        out += '<rect x="' + tipX + '" y="' + (cy - th / 2) + '" width="' + charW + '" height="' + th + '" rx="' + (th * 0.16) + '" fill="' + rgba('#4a3a2a', 0.28) + '"/>';
        out += '<path d="M' + tipX + ' ' + (cy - th / 2) + ' q-' + (2 + progress * 6) + ' ' + (th * 0.2) + ' -' + (1 + progress * 3) + ' ' + (th * 0.5) + ' q-' + (1 + progress * 4) + ' ' + (th * 0.3) + ' ' + (1 + progress * 3) + ' ' + (th * 0.5) + '" stroke="' + rgba('#2f241a', 0.5) + '" stroke-width="' + (Math.max(0.6, th * 0.1)).toFixed(2) + '" fill="none" stroke-linecap="round"/>';
        /* 纸身细纹 */
        for (var pl = 0; pl < 3; pl++) {
          out += '<path d="M' + (tipX + 5) + ' ' + (cy - th / 2 + 1.6 + pl * (th - 3.2) / 2) + ' h' + Math.max(0, bodyLen - 8) + '" stroke="' + rgba('#000000', 0.07) + '" stroke-width=".4"/>';
        }
        /* 滤嘴 */
        var fl = W * fLen;
        out += '<rect x="' + (W - 6 - fl) + '" y="' + (cy - th / 2 - 0.6) + '" width="' + (fl + 2) + '" height="' + (th + 1.2) + '" rx="' + (th * 0.3) + '" fill="url(#' + uid + 'f)"/>';
        /* 滤嘴花纹 */
        var fp = c.filterPattern || 'cork';
        out += '<g>';
        if (fp === 'cork') {
          for (var k = 0; k < 22; k++) {
            var s1 = Math.abs(Math.sin(k * 12.9898 + 4.1414)) % 1, s2 = Math.abs(Math.sin(k * 78.233 + 1.7)) % 1;
            out += '<circle cx="' + (W - 6 - fl + 2 + s1 * (fl - 4)).toFixed(1) + '" cy="' + (cy - th / 2 + 1 + s2 * (th - 2)).toFixed(1) + '" r="' + (0.25 + s2 * 0.5).toFixed(2) + '" fill="' + rgba(tint(filter, -0.45), 0.55) + '"/>';
          }
        } else if (fp === 'dots') {
          for (var k2 = 0; k2 < 8; k2++) {
            out += '<circle cx="' + (W - 6 - fl + fl * 0.12 + (k2 % 3) * fl * 0.28) + '" cy="' + (cy - th / 2 + 1.4 + Math.floor(k2 / 3) * (th - 2.8) / 2.6) + '" r=".85" fill="' + rgba(tint(filter, -0.35), 0.55) + '"/>';
          }
        }
        out += '</g>';
        if (fp === 'goldring') {
          out += '<rect x="' + (W - 6 - fl - 1.6) + '" y="' + (cy - th / 2 - 0.6) + '" width="' + 1.8 + '" height="' + (th + 1.2) + '" fill="' + ring + '"/>';
          out += '<rect x="' + (W - 7 - fl - 4) + '" y="' + (cy - th / 2 - 0.6) + '" width="' + 1 + '" height="' + (th + 1.2) + '" fill="' + rgba(ring, 0.6) + '"/>';
        } else if (fp !== 'white') {
          out += '<rect x="' + (W - 6 - fl - 2) + '" y="' + (cy - th / 2 - 0.6) + '" width="' + 1.6 + '" height="' + (th + 1.2) + '" fill="' + rgba(ring, 0.85) + '"/>';
        }
        out += '<rect x="' + (W - 7) + '" y="' + (cy - th / 2) + '" width="1.4" height="' + th + '" fill="' + tint(filter, -0.35) + '"/>';
        /* v4：烟身品牌印字（靠近滤嘴上方沿烟身） */
        try {
          var plainBrand = /[A-Za-z]/.test(p.brandEn || '') ? String(p.brandEn || '') : String(p.brand || '');
          if (plainBrand) {
            var labSpan = Math.min(bodyLen * 0.6, W * 0.34);
            out += '<text x="' + (tipX + bodyLen * 0.52).toFixed(1) + '" y="' + (cy + th * 0.2).toFixed(2) + '"' +
              ' font-family="' + FONT_SANS + '" font-size="' + Math.max(2.4, th * 0.42).toFixed(2) + '"' +
              ' fill="' + rgba('#33291f', 0.5) + '" text-anchor="middle" letter-spacing=".5"' +
              ' textLength="' + labSpan.toFixed(1) + '" lengthAdjust="spacingAndGlyphs">' + svgText(plainBrand) + '</text>';
          }
        } catch (e) {}
        /* 燃烧端 */
        var bx = tipX;
        if (mode === 'lit' || progress > 0.005) {
          /* 灰烬：长度随 ashAmt 增长，过长时下垂 */
          var ashW = Math.min(bodyLen, 7 + ashAmt * 26);
          var hang = ashAmt > 0.55 ? (ashAmt - 0.55) * 18 : 0;
          out += '<rect x="' + bx + '" y="' + (cy - th / 2 - 0.4) + '" width="' + ashW + '" height="' + (th + 0.8) + '" rx="' + (th * 0.2) + '" fill="#6f6a63"/>';
          out += '<rect x="' + bx + '" y="' + (cy - th / 2 - 0.4) + '" width="' + ashW + '" height="' + (th + 0.8) + '" rx="' + (th * 0.2) + '" fill="' + rgba('#c2bcb1', 0.6) + '"/>';
          /* 灰烬颗粒 */
          for (var ax = 0; ax < 4; ax++) {
            out += '<circle cx="' + (bx + 2 + ax * (ashW - 3) / 4).toFixed(1) + '" cy="' + (cy - th / 2 + 1.6 + (ax % 2) * (th - 3.2)).toFixed(1) + '" r=".55" fill="rgba(40,38,35,.6)"/>';
          }
          out += '<rect x="' + (bx + ashW - 2) + '" y="' + (cy - th / 2 - 0.4) + '" width="2" height="' + (th + 0.8) + '" fill="' + rgba('#3e3a35', 0.8) + '"/>';
          if (hang > 0.6) {
            /* 悬垂的灰柱 */
            out += '<path d="M' + (bx + ashW) + ' ' + (cy - th / 2) + ' q' + (4 + hang) + ' ' + (hang * 0.5) + ' ' + (2 + hang * 0.5) + ' ' + (th + hang) + ' q-' + (3 + hang * 0.4) + ' ' + (2) + ' -' + (5 + hang * 0.5) + ' -' + (hang * 0.5) + ' Z" fill="' + rgba('#9e988e', 0.85) + '"/>';
          }
          out += '<ellipse cx="' + (bx + 1.5) + '" cy="' + cy + '" rx="' + (th * 0.42) + '" ry="' + (th * 0.5) + '" fill="url(#' + uid + 'e)"/>';
          if (mode === 'lit') {
            out += '<ellipse cx="' + (bx + 1) + '" cy="' + cy + '" rx="' + (th * 0.9) + '" ry="' + (th * 1.15) + '" fill="' + rgba('#ff8a3c', 0.22) + '"/>';
          }
        } else {
          out += '<rect x="' + (bx - 1.5) + '" y="' + (cy - th / 2) + '" width="2.4" height="' + th + '" rx="1" fill="' + tint(paper, -0.06) + '"/>';
        }
      }
      /* 高光 */
      out += '<rect x="' + (tipX + 2) + '" y="' + (cy - th / 2 + 0.7) + '" width="' + Math.max(0, W - 10 - (tipX - 6)) + '" height="' + (th * 0.28) + '" rx="' + (th * 0.14) + '" fill="url(#' + uid + 'g)"/>';
      out += '</svg>';
      return out;
    } catch (e) { return ''; }
  }

  function renderLighterSVG(p) {
    return '<svg viewBox="0 0 30 52" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="smk-lighter-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5d6670"/><stop offset=".45" stop-color="#2c333a"/><stop offset="1" stop-color="#171c21"/></linearGradient>' +
      '<linearGradient id="smk-lighter-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8edf2"/><stop offset=".5" stop-color="#9aa4ad"/><stop offset="1" stop-color="#525b63"/></linearGradient>' +
      '<linearGradient id="smk-lighter-wheel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8b949c"/><stop offset=".5" stop-color="#d9e0e6"/><stop offset="1" stop-color="#6d767e"/></linearGradient></defs>' +
      '<ellipse cx="15" cy="49.5" rx="9" ry="1.6" fill="rgba(0,0,0,.4)"/>' +
      '<rect x="7" y="14" width="16" height="36" rx="3.2" fill="url(#smk-lighter-body)" stroke="#0c0f12" stroke-width=".6"/>' +
      '<rect x="8.2" y="15.4" width="3" height="33" rx="1.5" fill="rgba(255,255,255,.13)"/>' +
      '<rect x="9" y="8" width="12" height="8.4" rx="1.6" fill="url(#smk-lighter-metal)" stroke="#3a4249" stroke-width=".5"/>' +
      '<rect x="9.4" y="8.6" width="11.2" height="2.4" rx="1" fill="rgba(255,255,255,.35)"/>' +
      '<circle cx="18" cy="11.2" r="2.5" fill="url(#smk-lighter-wheel)" stroke="#4a525a" stroke-width=".4"/>' +
      '<path d="M15.6 11.2 h4.8 M18 8.8 v4.8" stroke="#5b646c" stroke-width=".35" opacity=".7"/>' +
      '<rect x="11" y="7.2" width="4.4" height="1.6" rx=".8" fill="#c9d2da"/>' +
      '<rect x="11.4" y="26" width="7.2" height="1.2" rx=".6" fill="rgba(255,255,255,.12)"/>' +
      '<rect x="11.4" y="29" width="7.2" height=".7" rx=".35" fill="rgba(255,255,255,.08)"/>' +
      '</svg>';
  }

  function renderAshtraySVG() {
    return '<svg viewBox="0 0 130 42" aria-hidden="true" focusable="false">' +
      '<defs><linearGradient id="smk-tray-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(196,215,226,.55)"/><stop offset=".5" stop-color="rgba(120,145,160,.34)"/><stop offset="1" stop-color="rgba(60,78,90,.5)"/></linearGradient>' +
      '<radialGradient id="smk-tray-in" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="rgba(30,36,42,.9)"/><stop offset=".75" stop-color="rgba(52,62,70,.85)"/><stop offset="1" stop-color="rgba(80,96,106,.6)"/></radialGradient></defs>' +
      '<ellipse cx="65" cy="31" rx="58" ry="10.5" fill="rgba(0,0,0,.4)"/>' +
      '<ellipse cx="65" cy="26" rx="58" ry="12" fill="url(#smk-tray-rim)" stroke="rgba(210,228,240,.4)" stroke-width=".7"/>' +
      '<ellipse cx="65" cy="25" rx="51" ry="9.6" fill="url(#smk-tray-in)"/>' +
      '<ellipse cx="65" cy="24.6" rx="51" ry="9.6" fill="none" stroke="rgba(255,255,255,.14)" stroke-width=".6"/>' +
      '<ellipse cx="65" cy="24" rx="22" ry="4.4" fill="rgba(10,12,14,.55)"/>' +
      '<ellipse cx="65" cy="23.6" rx="22" ry="4.4" fill="none" stroke="rgba(255,255,255,.09)" stroke-width=".5"/>' +
      '<path d="M30 22 q6 -5 14 -2" stroke="rgba(226,238,246,.35)" stroke-width="1" fill="none"/>' +
      '<path d="M86 21 q7 -3 13 2" stroke="rgba(226,238,246,.28)" stroke-width=".8" fill="none"/>' +
      '</svg>';
  }

  function restoreSvgTray() {
    try {
      if (!ashtrayEl) return;
      ashtrayEl.classList.remove('photo');
      ashtrayEl.innerHTML = renderAshtraySVG() + '<div class="smk-buttlayer" id="smk-butts"></div>';
      buttLayer = ashtrayEl.querySelector('#smk-butts');
    } catch (e) {}
  }
  /* ---- 6.5 第一视角手部（真实图缺失时的 SVG 回退） ---- */
  function renderHandSVG() {
    /* 右手从右下伸入，食指+中指 V 字夹烟；viewBox 180x150，握点在 (100,72) 附近 */
    return '<svg viewBox="0 0 180 150" aria-hidden="true" focusable="false">' +
      '<defs>' +
      '<linearGradient id="smk-hand-skin" x1=".2" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="#f2c9a4"/><stop offset=".42" stop-color="#e2ab7f"/><stop offset="1" stop-color="#b97a52"/></linearGradient>' +
      '<linearGradient id="smk-hand-skin2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8b68c"/><stop offset="1" stop-color="#c98a5f"/></linearGradient>' +
      '<radialGradient id="smk-hand-soft" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="rgba(255,236,214,.55)"/><stop offset="1" stop-color="rgba(255,236,214,0)"/></radialGradient>' +
      '</defs>' +
      /* 前臂 */
      '<path d="M180 150 L180 103 Q160 94 146 104 L112 136 Q104 146 108 150 Z" fill="url(#smk-hand-skin2)"/>' +
      '<path d="M180 150 L180 124 Q162 118 150 126 L120 150 Z" fill="#a96942" opacity=".45"/>' +
      /* 手背 */
      '<path d="M150 120 Q128 114 110 96 Q96 82 104 71 Q116 60 132 72 Q152 88 158 100 Q162 114 150 120 Z" fill="url(#smk-hand-skin)"/>' +
      /* 无名指 / 小指（折起） */
      '<path d="M139 108 Q126 102 118 94" stroke="#d9a073" stroke-width="13" stroke-linecap="round" fill="none"/>' +
      '<path d="M148 120 Q138 115 132 110" stroke="#d19a6d" stroke-width="11" stroke-linecap="round" fill="none"/>' +
      /* 中指 */
      '<path d="M130 100 Q108 82 92 64" stroke="#e5b083" stroke-width="16.5" stroke-linecap="round" fill="none"/>' +
      '<path d="M130 100 Q108 82 92 64" stroke="url(#smk-hand-skin)" stroke-width="15" stroke-linecap="round" fill="none"/>' +
      /* 食指 */
      '<path d="M114 88 Q90 64 74 48" stroke="#e0a97c" stroke-width="15" stroke-linecap="round" fill="none"/>' +
      '<path d="M114 88 Q90 64 74 48" stroke="url(#smk-hand-skin)" stroke-width="13.6" stroke-linecap="round" fill="none"/>' +
      /* 指缝阴影 */
      '<path d="M116 90 Q96 72 82 56" stroke="rgba(96,52,30,.28)" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
      '<path d="M132 102 Q112 86 100 72" stroke="rgba(96,52,30,.22)" stroke-width="1.4" stroke-linecap="round" fill="none"/>' +
      /* 拇指（从下方压住烟） */
      '<path d="M158 132 Q136 118 104 82" stroke="#e2ad80" stroke-width="15" stroke-linecap="round" fill="none"/>' +
      '<path d="M158 132 Q136 118 104 82" stroke="#d99f72" stroke-width="12.6" stroke-linecap="round" fill="none"/>' +
      '<ellipse cx="104" cy="82" rx="6.5" ry="5" transform="rotate(-38 104 82)" fill="#e9b88d" stroke="rgba(120,70,40,.25)" stroke-width=".6"/>' +
      /* 指节高光 */
      '<ellipse cx="112" cy="82" rx="5.6" ry="4.2" transform="rotate(-44 112 82)" fill="rgba(255,238,220,.34)"/>' +
      '<ellipse cx="126" cy="94" rx="5.4" ry="4" transform="rotate(-42 126 94)" fill="rgba(255,238,220,.3)"/>' +
      '<path d="M150 120 Q128 114 110 96 Q96 82 104 71" stroke="rgba(255,242,228,.28)" stroke-width="2" fill="none" opacity=".7"/>' +
      /* 指甲 */
      '<ellipse cx="74" cy="48" rx="4.6" ry="6.2" transform="rotate(41 74 48)" fill="#f6ddc8" opacity=".82"/>' +
      '<ellipse cx="92" cy="64" rx="4.9" ry="6.4" transform="rotate(43 92 64)" fill="#f4d9c2" opacity=".8"/>' +
      '<ellipse cx="124" cy="104" rx="4.2" ry="5" transform="rotate(-52 124 104)" fill="#f6ddc8" opacity=".6"/>' +
      /* 柔光 */
      '<ellipse cx="120" cy="98" rx="52" ry="38" fill="url(#smk-hand-soft)" opacity=".5"/>' +
      '</svg>';
  }
  function packImageFor(p) {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      if (!m || !p) return null;
      /* B/Lead 指定回退 SVG 的 SKU（截图底板不干净）：不请求图片，直接参数化渲染 */
      if (m.svgFallback && m.svgFallback.indexOf(p.id) >= 0) return null;
      var v = (m && m.byProductId && m.byProductId[p.id]) || (m && m.byBrand && m.byBrand[p.brand]) || null;
      if (v) return imgUrl(v);
      /* B 逐张产出中：没有映射时也尝试约定文件名 pack-<id>.png，404 静默回退 SVG */
      return imgUrl('pack-' + p.id + '.png');
    } catch (e) { return null; }
  }
  function singleCigSrc() {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      if (m && m.cig) {
        var v = m.cig.single || m.cigSingle || null;
        if (v) return imgUrl(typeof v === 'string' ? v : (v.src || v.img || v.png));
      }
    } catch (e) {}
    return imgUrl('cig-single.png');
  }
  function attachSingleCigFallback(img) {
    try {
      var tried = false;
      img.onerror = function () {
        try { noteAssetFailure(); } catch (e) {}
        try { img.style.display = 'none'; } catch (e) {}
        try {
          if (!tried) {
            tried = true;
            var alt = singleCigFallbackSrc();
            if (alt) {
              var probe2 = new Image();
              probe2.onload = function () { try { img.src = alt; img.style.display = ''; } catch (e) {} };
              probe2.onerror = function () { try { var h = singleCigFallbackHTML(); if (h) { cigWrap.innerHTML = h; layoutCig(state.phase === PHASE.OUT ? 'lying' : 'held'); } } catch (e) {} };
              probe2.src = alt;
              return;
            }
          }
        } catch (e) {}
        try { var h2 = singleCigFallbackHTML(); if (h2) { cigWrap.innerHTML = h2; layoutCig(state.phase === PHASE.OUT ? 'lying' : 'held'); } } catch (e) {}
      };
    } catch (e) {}
  }
  function singleCigFallbackHTML() {
    try {
      var mode = (state.phase === PHASE.LIT || state.phase === PHASE.BURNT) ? 'lit' : 'out';
      return renderCigSVG(product, clamp(state.progress || 0, 0, 0.66), mode, state.ash || 0);
    } catch (e) { return ''; }
  }
  function singleCigFallbackSrc() {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      if (m && m.cig && m.cig.unlit) return imgUrl(m.cig.unlit);
    } catch (e) {}
    return imgUrl('cig-unlit.png');
  }
  function cigarCutterSrc() {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      if (m) {
        var v = m.cigarCutter || m.cutter || null;
        if (v) return imgUrl(typeof v === 'string' ? v : (v.src || v.img || v.png));
      }
    } catch (e) {}
    return null;
  }
  function cigarCapStage() {
    try {
      if (photoActive() && handEl && stageEl) {
        var img = handEl.querySelector('.smk-hand-img');
        if (!img) return null;
        var key = handFormatKey(product);
        var m = window.SMOKE_PACK_IMAGES;
        var cap = (m && m.hand && m.hand[key] && isFinite(+m.hand[key].capX)) ? [+m.hand[key].capX, +m.hand[key].capY] : [0.12, 0.86];
        var ir = img.getBoundingClientRect(), hr = handEl.getBoundingClientRect(), sr = stageEl.getBoundingClientRect();
        var cs = window.getComputedStyle(handEl);
        var mat = cs.transform || 'none';
        var hw = handEl.offsetWidth, hh = handEl.offsetHeight;
        var ox = hw * 0.62, oy = hh * 0.55;
        var px = img.offsetLeft + img.offsetWidth * cap[0];
        var py = img.offsetTop + img.offsetHeight * cap[1];
        if (mat && mat !== 'none' && mat.indexOf('matrix') === 0) {
          var q = mat.replace(/^matrix\(|\)$/g, '').split(',').map(Number);
          var dx = px - ox, dy = py - oy;
          px = ox + q[0] * dx + q[2] * dy + q[4];
          py = oy + q[1] * dx + q[3] * dy + q[5];
        }
        return { x: handEl.offsetLeft + px, y: handEl.offsetTop + py };
      }
      if (cigWrap && cigWrap.classList.contains('smk-show') && cigLayout && cigLayout.w) {
        var L = cigLayout;
        return { x: L.left + L.w * 0.95, y: L.top + L.h * 0.5 };
      }
    } catch (e) {}
    return { x: stageEl ? stageEl.clientWidth * 0.36 : 60, y: stageEl ? stageEl.clientHeight * 0.52 : 110 };
  }
  function cigarPhotoFor() {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      if (m && m.cigar != null) {
        var c = m.cigar;
        if (typeof c === 'string' && c) return imgUrl(c);
        if (c && (c.img || c.png || c.single)) return imgUrl(c.img || c.png || c.single);
      }
      if (m && m.cigarSingle) return imgUrl(typeof m.cigarSingle === 'string' ? m.cigarSingle : (m.cigarSingle.img || m.cigarSingle.png));
      return null;
    } catch (e) { return null; }
  }
  function cigImageFor(mode) {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      if (!m || !m.cig) return null;
      var v = m.cig[mode] || (m.cig[mode === 'lit' ? 'lit' : 'unlit']) || null;
      return v ? imgUrl(v) : null;
    } catch (e) { return null; }
  }
  /* 前景手指层（只画食指/中指/拇指，让烟从指间穿过） */
  function renderHandFrontSVG() {
    return '<svg viewBox="0 0 180 150" aria-hidden="true" focusable="false">' +
      '<defs>' +
      '<linearGradient id="smk-handf-skin" x1=".2" y1="0" x2=".85" y2="1"><stop offset="0" stop-color="#f2c9a4"/><stop offset=".42" stop-color="#e2ab7f"/><stop offset="1" stop-color="#b97a52"/></linearGradient>' +
      '</defs>' +
      /* 中指（前景） */
      '<path d="M130 100 Q108 82 92 64" stroke="#e5b083" stroke-width="16.5" stroke-linecap="round" fill="none"/>' +
      '<path d="M130 100 Q108 82 92 64" stroke="url(#smk-handf-skin)" stroke-width="15" stroke-linecap="round" fill="none"/>' +
      /* 食指（前景） */
      '<path d="M114 88 Q90 64 74 48" stroke="#e0a97c" stroke-width="15" stroke-linecap="round" fill="none"/>' +
      '<path d="M114 88 Q90 64 74 48" stroke="url(#smk-handf-skin)" stroke-width="13.6" stroke-linecap="round" fill="none"/>' +
      /* 指缝阴影 */
      '<path d="M116 90 Q96 72 82 56" stroke="rgba(96,52,30,.3)" stroke-width="1.7" stroke-linecap="round" fill="none"/>' +
      '<path d="M132 102 Q112 86 100 72" stroke="rgba(96,52,30,.24)" stroke-width="1.4" stroke-linecap="round" fill="none"/>' +
      /* 指甲 */
      '<ellipse cx="74" cy="48" rx="4.6" ry="6.2" transform="rotate(41 74 48)" fill="#f6ddc8" opacity=".85"/>' +
      '<ellipse cx="92" cy="64" rx="4.9" ry="6.4" transform="rotate(43 92 64)" fill="#f4d9c2" opacity=".82"/>' +
      /* 拇指尖（从下方压住烟） */
      '<path d="M158 132 Q136 118 104 82" stroke="#e2ad80" stroke-width="15" stroke-linecap="round" fill="none"/>' +
      '<path d="M158 132 Q136 118 104 82" stroke="#d99f72" stroke-width="12.6" stroke-linecap="round" fill="none"/>' +
      '<ellipse cx="104" cy="82" rx="6.2" ry="4.8" transform="rotate(-38 104 82)" fill="#e9b88d" stroke="rgba(120,70,40,.25)" stroke-width=".6"/>' +
      '</svg>';
  }
  function handFormatKey(p) {
    try {
      var sp = cigSpec(p || product);
      if (sp.isCigar) return 'cigar';
      if (sp.isSlim || sp.isMedium) return 'slim';
      return 'regular';
    } catch (e) { return 'regular'; }
  }
  function handImageFor(p) {
    try {
      var m = window.SMOKE_PACK_IMAGES;
      var key = handFormatKey(p);
      if (m && m.hand) {
        var v = m.hand[key] || null;
        if (v) return imgUrl(typeof v === 'string' ? v : (v.src || v.img || v.png));
      }
      /* 约定文件名：hand-regular / hand-slim / hand-cigar（B 的 v5 三张实拍手图） */
      var DEF = { regular: 'hand-regular.png', slim: 'hand-slim.png', cigar: 'hand-cigar.png' };
      if (DEF[key]) return imgUrl(DEF[key]);
      return imgUrl('hand-hold.png');
    } catch (e) { return null; }
  }
  /* 真实手图模式下火头/嘴部在画面中的位置（不同手图分别校准） */
  function handTips(fmt) {
    var key = fmt || handFormatKey(product);
    var D = { regular: [0.045, 0.50], slim: [0.045, 0.50], cigar: [0.60, 0.035] };
    try {
      var m = window.SMOKE_PACK_IMAGES;
      if (m && m.hand && m.hand[key] && isFinite(+m.hand[key].tipX) && isFinite(+m.hand[key].tipY)) {
        return [+m.hand[key].tipX, +m.hand[key].tipY];
      }
      var src = (m && (m.handTips || m.hand_tips)) || window.SMOKE_HAND_TIPS || null;
      if (src && src[key]) {
        var t = src[key];
        if (Array.isArray(t) && t.length >= 2) return [+t[0], +t[1]];
        if (t && isFinite(+t.tipX) && isFinite(+t.tipY)) return [+t.tipX, +t.tipY];
        if (t && isFinite(+t.x) && isFinite(+t.y)) return [+t.x, +t.y];
      }
    } catch (e) {}
    return D[key] || D.regular;
  }
  function photoGeom() {
    var key = handFormatKey(product);
    /* tip: 点燃端在手图内的百分比位置；dx/dy: 随燃烧进度（0~0.66）朝滤嘴/手方向移动的量 */
    var G = {
      regular: { tip: handTips('regular'), dx: 0.30, dy: -0.02, mouth: [0.92, 0.52], ash: 'h' },
      slim: { tip: handTips('slim'), dx: 0.30, dy: -0.02, mouth: [0.92, 0.50], ash: 'h' },
      cigar: { tip: handTips('cigar'), dx: -0.10, dy: 0.22, mouth: [0.92, 0.40], ash: 'v' }
    };
    return G[key] || G.regular;
  }
  function photoTipStage() {
    try {
      if (!handEl || !stageEl) return null;
      var img = handEl.querySelector('.smk-hand-img');
      if (!img || !img.offsetWidth) return null;
      var key = handFormatKey(product);
      var t = photoGeom().tip || handTips(key);
      var hw = handEl.offsetWidth || handEl.clientWidth, hh = handEl.offsetHeight || handEl.clientHeight;
      var lx = handEl.offsetLeft, ly = handEl.offsetTop;
      var px = (img.offsetLeft || 0) + img.offsetWidth * t[0];
      var py = (img.offsetTop || 0) + img.offsetHeight * t[1];
      /* 手图 rotate/scale/translate 用 computed matrix 精确换算（绕 transform-origin） */
      var cs = window.getComputedStyle(handEl);
      var m = cs.transform || 'none';
      var ox = hw * (key === 'cigar' ? 0.62 : 0.78), oy = hh * (key === 'cigar' ? 0.55 : 0.70);
      if (m && m !== 'none' && m.indexOf('matrix') === 0) {
        var nums = m.replace(/^matrix\(|\)$/g, '').split(',').map(Number);
        var a = nums[0], b = nums[1], c = nums[2], d = nums[3], e = nums[4], f = nums[5];
        var dx = px - ox, dy = py - oy;
        var rx = ox + a * dx + c * dy + e;
        var ry = oy + b * dx + d * dy + f;
        return { x: lx + rx, y: ly + ry };
      }
      return { x: lx + px, y: ly + py };
    } catch (e) { return null; }
  }
  function photoImgBox() {
    try {
      var img = handEl && handEl.querySelector('.smk-hand-img');
      if (!img || !stageEl || !img.getBoundingClientRect) return null;
      var r = img.getBoundingClientRect(), sr = stageEl.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
    } catch (e) { return null; }
  }
  /* ---- v3.1：真实 pack 图质量兜底（坏图静默回退 SVG，不露白块） ---- */
  var packPhotoCache = {};
  var packPhotoShown = false;
  function checkPackPhoto(img) {
    try {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return false;
      var ratio = w / h;
      var sp = cigSpec(product);
      var aspectOk = sp.isCigar ? (ratio >= 0.6 && ratio <= 2.4) : (ratio >= 0.45 && ratio <= 1.15);
      if (!aspectOk) return false;
      var sw = Math.min(120, w);
      var sh = Math.max(1, Math.round(h * sw / w));
      var cv = document.createElement('canvas');
      cv.width = sw; cv.height = sh;
      var g = cv.getContext('2d');
      if (!g) return true;
      g.drawImage(img, 0, 0, sw, sh);
      var data = g.getImageData(0, 0, sw, sh).data;
      var total = sw * sh, opaque = 0, light = 0;
      function isLight(r, gg, b) {
        var mn = Math.min(r, gg, b), mx = Math.max(r, gg, b);
        return mn > 205 || (mx - mn < 18 && (r + gg + b) / 3 > 150);
      }
      var i, x, y, o;
      for (i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 60) {
          opaque++;
          if (isLight(data[i], data[i + 1], data[i + 2])) light++;
        }
      }
      var tx = Math.max(1, Math.round(2 * sw / w));
      var ty = Math.max(1, Math.round(2 * sh / h));
      var ringN = 0, ringLight = 0;
      for (y = 0; y < sh; y++) {
        for (x = 0; x < sw; x++) {
          if (x < tx || x >= sw - tx || y < ty || y >= sh - ty) {
            ringN++;
            i = (y * sw + x) * 4;
            if (data[i + 3] > 60 && isLight(data[i], data[i + 1], data[i + 2])) ringLight++;
          }
        }
      }
      /* 四角：完全不透明且浅色 => 灰白矩形背景 */
      var cornerLightOpaque = 0;
      var corners = [[0, 0], [sw - 3, 0], [0, sh - 3], [sw - 3, sh - 3]];
      for (var ci = 0; ci < 4; ci++) {
        var cx = Math.max(0, corners[ci][0]), cy = Math.max(0, corners[ci][1]);
        var rs = 0, gs = 0, bs = 0, as = 0, n = 0;
        for (y = cy; y < Math.min(sh, cy + 3); y++) {
          for (x = cx; x < Math.min(sw, cx + 3); x++) {
            i = (y * sw + x) * 4;
            rs += data[i]; gs += data[i + 1]; bs += data[i + 2]; as += data[i + 3]; n++;
          }
        }
        if (n) {
          rs /= n; gs /= n; bs /= n; as /= n;
          if (as > 200 && isLight(rs, gs, bs)) cornerLightOpaque++;
        }
      }
      var opRatio = opaque / total;
      var lightRatio = light / total;
      var ringLightRatio = ringLight / Math.max(1, ringN);
      if (opRatio < 0.55 || opRatio > 0.985) return false;   /* 碎片/logo/整块不透明 */
      if (ringLightRatio > 0.10) return false;               /* 四边露白/灰 */
      if (lightRatio > 0.78) return false;                   /* 几乎整张都是浅色矩形背景（白盒身不吃这条） */
      if (cornerLightOpaque >= 2) return false;              /* 四角灰白底 */
      return true;
    } catch (e) {
      /* file:// 下 canvas 可能被污染，无法采样 -> 按可用处理 */
      return true;
    }
  }

  function photoActive() {
    try {
      if (!(photoHandMode && photoHandOk)) return false;
      return state.phase === PHASE.TAKEN || state.phase === PHASE.CUTTING || state.phase === PHASE.LIGHTING || state.phase === PHASE.LIT || state.phase === PHASE.BURNT || state.phase === PHASE.BUTT;
    } catch (e) { return false; }
  }
  /* 采样图片不透明像素比例：坏图（几乎全透明）自动回退 SVG */
  function checkImageAlpha(img, cb) {
    var done = false;
    function finish(ok) { if (done) return; done = true; try { cb(ok); } catch (e) {} }
    try {
      var w = Math.min(96, img.naturalWidth || 0);
      if (!w) { finish(true); return; }
      var h = Math.max(1, Math.round((img.naturalHeight || 1) * w / img.naturalWidth));
      if (h > 160) h = 160;
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var g = cv.getContext('2d');
      if (!g) { finish(true); return; }
      g.drawImage(img, 0, 0, w, h);
      var data = g.getImageData(0, 0, w, h).data;
      var opaque = 0;
      for (var i = 3; i < data.length; i += 4) if (data[i] > 24) opaque++;
      finish(opaque / (w * h) >= 0.02);
    } catch (e) {
      /* file:// 下 canvas 可能被跨源污染，无法采样时按可用处理 */
      finish(true);
    }
  }
  var assetWarned = false;
  try { window.__smkNoteAssetFail = noteAssetFailure; } catch (e) {}
  function showAssetWarning() {
    try {
      var txt = '素材未加载：请完全退出 DSH（含托盘）再重新打开。';
      hintState.on = true;
      var attempts = 0;
      function apply() {
        try {
          var el = (rootEl && rootEl.querySelector('.smk-hint')) || document.getElementById('smk-hint');
          if (!el) { if (++attempts < 12) setTimeout(apply, 150); return; }
          el.innerHTML = '<span class="smk-hint-x" data-smk-hintx="1">✕</span><span>' + escapeHtml(txt) + '</span>';
          el.classList.add('on');
          try { el.style.opacity = '1'; } catch (e) {}
          /* 兜底：启动阶段可能有其它逻辑误关气泡，前 3 秒内再钉住几次 */
          [300, 900, 1800].forEach(function (ms) { setTimeout(function () { try { el.classList.add('on'); } catch (e) {} }, ms); });
        } catch (e) {}
      }
      apply();
    } catch (e) {}
  }
  function noteAssetFailure() {
    try {
      if (assetWarned) return;
      assetWarned = true;
      setTimeout(function () { try { showAssetWarning(); } catch (e) {} }, 120);
    } catch (e) {}
  }
  function probeAssets() {
    try {
      var probe = new Image();
      probe.onerror = function () { noteAssetFailure(); };
      probe.onload = function () {};
      probe.src = imgUrl('ashtray.png') + '?probe=' + Date.now();
    } catch (e) {}
  }
  function imgUrl(v) {
    try {
      v = String(v);
      if (/^(https?:|data:)/.test(v)) return v;
      var base = (IS_PREVIEW || location.protocol === 'file:') ? '../plugin/assets/img/' : '/smoke/img/';
      /* v12：模拟 404 素材（QA/预览） */
      try { if (window.__SMOKE_FORCE_ASSET_FAIL) return base + '__missing__/' + v; } catch (e) {}
      if (v.indexOf('/') === 0) return IS_PREVIEW && location.protocol === 'file:' ? '..' + v : v;
      if (v.indexOf('img/') === 0) return base + v.slice(4);
      if (v.indexOf('/smoke/img/') === 0) return IS_PREVIEW ? base + v.slice(11) : v;
      return base + v;
    } catch (e) { return null; }
  }
  function ensurePackImages(cb) {
    try {
      if (window.SMOKE_PACK_IMAGES) { packImages.loaded = true; packImages.data = window.SMOKE_PACK_IMAGES; cb(); return; }
      var s = document.createElement('script');
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        try {
          packImages.loaded = true;
          packImages.data = window.SMOKE_PACK_IMAGES || null;
        } catch (e) {}
        cb();
      }
      s.src = (IS_PREVIEW || location.protocol === 'file:') ? '../plugin/assets/pack-images.js' : '/smoke/pack-images.js';
      s.async = true;
      s.onload = finish;
      s.onerror = finish;
      (document.head || document.documentElement).appendChild(s);
      setTimeout(finish, 2200);
    } catch (e) { cb(); }
  }

  /* ==========================================================================
   * 7. Canvas 烟雾粒子系统
   *    粒子池 ≤220；DPR 适配；页面隐藏 / 挂件隐藏暂停 rAF；三类发射源 + 烟圈/火星
   * ========================================================================*/
  var FX = (function () {
    var cvs = null, c = null;
    var cssW = 190, cssH = 180, dpr = 1;
    var pool = [];
    var rings = [];
    var raf = 0;
    var lastTs = 0;
    var running = false;
    var emitAcc = 0;
    var ambientAcc = 0;
    var spriteCache = {};
    var tipGetter = null, mouthGetter = null;
    var windX = 0.8;
    var paused = false;
    var ringCap = 14;

    function makePool() {
      pool.length = 0;
      for (var i = 0; i < PARTICLE_CAP; i++) {
        pool.push({
          live: false, x: 0, y: 0, vx: 0, vy: 0, size: 1, grow: 0,
          age: 0, life: 1, a0: 0.2, alpha: 0, turb: 0, wob: 1, seed: 0,
          sprite: 'warm', buoy: 10, kind: 0
        });
      }
    }
    function makeSprite(key, variant) {
      var pal = SMOKE_PALETTE[key] || SMOKE_PALETTE.warm;
      var S = 128;
      var cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      var g = cv.getContext('2d');
      if (!g) return cv;
      try { g.filter = 'blur(3px)'; } catch (e) {}
      var grd = g.createRadialGradient(S * 0.5, S * 0.52, 2, S * 0.5, S * 0.52, S * 0.5);
      grd.addColorStop(0, rgba(pal.core, 1.0));
      grd.addColorStop(0.34, rgba(pal.mid, 0.70));
      grd.addColorStop(0.7, rgba(pal.soft, 0.26));
      grd.addColorStop(1, rgba(pal.soft, 0));
      g.fillStyle = grd;
      g.beginPath(); g.arc(S * 0.5, S * 0.5, S * 0.5, 0, 6.2832); g.fill();
      var seed = (variant || 0) * 7.3 + 1.7;
      var lobes = 5 + ((variant || 0) % 3);
      for (var i = 0; i < lobes; i++) {
        var a = seed + i * 2.399;
        var rx = S * (0.10 + 0.05 * Math.abs(Math.sin(a * 1.7)));
        var ry = rx * (0.7 + 0.5 * Math.abs(Math.cos(a)));
        var cx = S * 0.5 + Math.cos(a) * S * (0.10 + 0.10 * Math.abs(Math.sin(a * 2.1)));
        var cy = S * 0.5 + Math.sin(a) * S * (0.10 + 0.09 * Math.abs(Math.cos(a * 1.3)));
        var lg = g.createRadialGradient(cx, cy, 1, cx, cy, Math.max(rx, ry));
        var mix = i % 2 ? pal.mid : pal.soft;
        lg.addColorStop(0, rgba(pal.core, 0.60));
        lg.addColorStop(0.5, rgba(mix, 0.34));
        lg.addColorStop(1, rgba(mix, 0));
        g.fillStyle = lg;
        g.beginPath(); g.ellipse(cx, cy, rx, ry, a * 0.3, 0, 6.2832); g.fill();
      }
      for (var k = 0; k < 24; k++) {
        var an = (seed + k * 1.618) * 3.1;
        var rr = S * 0.06 + (k % 5) * S * 0.02;
        var px = S * 0.5 + Math.cos(an) * rr, py = S * 0.5 + Math.sin(an * 1.3) * rr;
        g.fillStyle = rgba(pal.core, 0.04 + 0.05 * ((k % 3) / 2));
        g.beginPath(); g.arc(px, py, S * 0.02, 0, 6.2832); g.fill();
      }
      return cv;
    }
    function sprite(key, variant) {
      var k = key + ':' + (variant || 0);
      if (!spriteCache[k]) {
        try { spriteCache[k] = makeSprite(key, variant); } catch (e) { spriteCache[k] = null; }
      }
      return spriteCache[k];
    }
    function init(canvas) {
      cvs = canvas;
      c = cvs.getContext('2d', { alpha: true });
      makePool();
      resize();
      start();
    }
    function resize() {
      try {
        if (!cvs || !cvs.parentNode) return;
        var r = cvs.parentNode.getBoundingClientRect();
        cssW = Math.max(20, Math.round(r.width));
        cssH = Math.max(20, Math.round(r.height));
        dpr = clamp(window.devicePixelRatio || 1, 1, 3);
        cvs.width = Math.round(cssW * dpr);
        cvs.height = Math.round(cssH * dpr);
        cvs.style.width = cssW + 'px';
        cvs.style.height = cssH + 'px';
        if (c) {
          c.setTransform(dpr, 0, 0, dpr, 0, 0);
          c.clearRect(0, 0, cssW, cssH);
        }
      } catch (e) {}
    }
    function aliveCount() {
      var n = 0;
      for (var i = 0; i < pool.length; i++) if (pool[i].live) n++;
      return n;
    }
    function liveCoverage() {
      var s2 = 0;
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (p.live) s2 += p.alpha * p.size * p.size * 0.785 * (p.stretch || 1);
      }
      return s2;
    }
    function spawn(opt) {
      if (aliveCount() >= PARTICLE_CAP) return null;
      var cover = liveCoverage();
      var maxCover = Math.max(3400, cssW * cssH * 0.70);
      if (cover > maxCover * 1.15) return null;
      var a0 = opt.alpha == null ? 0.12 : opt.alpha;
      if (cover > maxCover * 0.55) a0 *= clamp(1 - (cover - maxCover * 0.55) / (maxCover * 0.5), 0.2, 1);
      for (var i = 0; i < pool.length; i++) {
        var p = pool[i];
        if (p.live) continue;
        p.live = true;
        p.x = opt.x; p.y = opt.y;
        p.vx = opt.vx || 0; p.vy = opt.vy || 0;
        p.size = opt.size || 4;
        p.size0 = p.size;
        p.grow = opt.grow || 8;
        p.age = 0;
        p.life = opt.life || 3;
        p.a0 = a0;
        p.alpha = 0;
        p.turb = opt.turb == null ? 3.5 : opt.turb;
        p.wob = opt.wob || 1;
        p.seed = Math.random() * 100;
        p.sprite = opt.sprite || 'warm';
        p.buoy = opt.buoy == null ? 12 : opt.buoy;
        p.rot = opt.rot == null ? rand(-0.5, 0.5) : opt.rot;
        p.vr = opt.vr == null ? rand(-0.28, 0.28) : opt.vr;
        p.stretch = opt.stretch == null ? 1 : opt.stretch;
        p.variant = randi(0, 3);
        p.soft = opt.soft !== false;
        p.kind = opt.kind || 'other';
        return p;
      }
      return null;
    }
    function tipPos() {
      try { return tipGetter ? tipGetter() : null; } catch (e) { return null; }
    }
    function mouthPos() {
      try { return mouthGetter ? mouthGetter() : null; } catch (e) { return null; }
    }
    function paletteFor(colorName) {
      return SMOKE_PALETTE[colorName] ? colorName : 'warm';
    }
    /* 烟头细烟（持续） */
    /* 烟头细烟（持续）——细长烟丝，快速拉长变淡 */
    function wisp(strength) {
      var tp = tipPos();
      if (!tp) return;
      var col = paletteFor(smokeCfg.color);
      var thick = strength === 'thick';
      var n = thick ? 2 : 1;
      for (var i = 0; i < n; i++) {
        spawn({
          x: tp.x + rand(-1.5, 1.5), y: tp.y + rand(-1, 1),
          vx: rand(-3, 3), vy: rand(-28, -15),
          size: rand(2.2, 3.8), grow: rand(6, 13),
          life: rand(1.5, 2.5), alpha: (thick ? 0.12 : 0.075) * (photoActive() ? 0.55 : 1),
          kind: 'wisp', turb: rand(2, 4.5), sprite: col,
          buoy: rand(11, 18) * driftScale(), stretch: rand(1.9, 2.9),
          rot: rand(-0.25, 0.25), vr: rand(-0.18, 0.18)
        });
      }
      if (thick && Math.random() < 0.55) {
        spawn({
          x: tp.x + rand(-3, 3), y: tp.y + rand(-2, 2),
          vx: rand(-8, 4), vy: rand(-20, -10),
          size: rand(5, 9), grow: rand(14, 24),
          life: rand(1.8, 2.8), alpha: 0.055,
          kind: 'wisp', turb: rand(2, 4), sprite: col === 'cool' ? 'warm' : 'cool',
          buoy: rand(8, 14) * driftScale(), stretch: rand(1.05, 1.25),
          rot: rand(-0.5, 0.5), vr: rand(-0.2, 0.2)
        });
      }
    }
    /* 每口：烟头小热团 */
    function puffBurst(power) {
      power = clamp(power == null ? 1 : power, 0.3, 2);
      var tp = tipPos();
      if (!tp) return;
      var col = paletteFor(smokeCfg.color);
      var count = 2 + Math.round(clamp(power, 0.4, 1.6) * 2);
      for (var i = 0; i < count; i++) {
        spawn({
          x: tp.x + rand(-2.5, 2.5), y: tp.y + rand(-2, 2),
          vx: rand(-12, 6), vy: rand(-34, -16),
          size: rand(3, 6), grow: rand(12, 24),
          life: rand(1.4, 2.4), alpha: 0.10,
          turb: 3.2, sprite: i % 2 ? col : 'warm',
          buoy: rand(14, 22) * driftScale(), stretch: rand(1.2, 1.7),
          rot: rand(-0.4, 0.4), vr: rand(-0.2, 0.2)
        });
      }
      sparks(3);
    }
    /* 吐烟：2~4 波有节奏地吐出，每波 3~4 片柔雾，轻/重分层但不糊屏 */
    /* v9：吐烟 = 3~5 团彼此分离的大柔团（不同起点/延迟/方向），每团低 alpha、先小后大 */
    var lastPuffs = [];
    function exhaleBurst(power) {
      power = clamp(power == null ? 1 : power, 0.2, 2.6);
      var isCigarNow = false;
      try { isCigarNow = cigSpec(product).isCigar; } catch (e) {}
      var heavy = power > 1.25;
      var col = paletteFor(smokeCfg.color);
      var cx = cssW * 0.5, cy = cssH * (isCigarNow ? 0.45 : 0.44);
      var count = isCigarNow ? 6 : (heavy ? 6 : 3);
      /* v9：团心位置（stage 归一化）——四角+中，团间最小中心距 ≥55px @190x220 */
      var POS = [
        { px: 0.20, py: 0.32, vx: -6, delay: 0 },
        { px: 0.80, py: 0.32, vx: 6, delay: 60 },
        { px: 0.50, py: 0.46, vx: -2, delay: 120 },
        { px: 0.26, py: 0.60, vx: 3, delay: 180 },
        { px: 0.74, py: 0.60, vx: -4, delay: 240 },
        { px: 0.50, py: 0.22, vx: 0, delay: 300 }
      ];
      var POS_LIGHT = [
        { px: 0.30, py: 0.35, vx: -4, delay: 0 },
        { px: 0.70, py: 0.37, vx: 4, delay: 120 },
        { px: 0.50, py: 0.50, vx: -1, delay: 240 }
      ];
      lastPuffs = [];
      function emitPuff(i2) {
        var arr = count <= 2 ? POS_LIGHT : POS;
        var of = arr[i2 % arr.length];
        var ox0 = cssW * of.px, oy0 = cssH * of.py;
        lastPuffs.push({ x: +(ox0 / cssW).toFixed(2), y: +(oy0 / cssH).toFixed(2) });
        setTimeout(function () {
          try {
            if (paused) return;
            var ox = ox0;
            var oy = oy0;
            var n = 4 + (heavy ? 0 : (i2 % 2));
            var sizeScale = heavy ? 0.81 : 1;
            var startSize = rand(34, 52) * sizeScale;
            var target = rand(115, 170) * sizeScale * (isCigarNow ? 1.1 : 1) * (heavy ? 1.1 : 0.92);
            for (var k = 0; k < n; k++) {
              var sz = startSize * (0.85 + k * 0.28);
              spawn({
                x: ox + rand(-7, 7), y: oy + rand(-6, 6),
                vx: of.vx * (0.6 + Math.random() * 0.7) + rand(-2, 2),
                vy: rand(-13, -7) * (heavy ? 1.1 : 0.9),
                size: sz, grow: target - sz,
                life: rand(1.5, 2.5),
                alpha: heavy ? rand(0.25, 0.40) : rand(0.18, 0.28),
                kind: 'exhale', turb: rand(0.8, 2.2),
                sprite: k % 4 === 0 ? 'white' : (k % 4 === 1 || k % 4 === 2 ? (col === 'cool' ? 'white' : 'warm') : 'cool'),
                buoy: rand(2.5, 6) * driftScale(), stretch: rand(0.9, 1.18),
                rot: rand(-0.7, 0.7), vr: rand(-0.18, 0.18)
              });
            }
          } catch (e) {}
        }, of.delay + i2 * 30);
      }
      for (var i2 = 0; i2 < count; i2++) emitPuff(i2);
    }
    function puffInfo() {
      return lastPuffs.slice(0, 6);
    }
    function ashBurst(n) {
      var tp = tipPos();
      var ox = tp ? tp.x : cssW * 0.45;
      var oy = tp ? tp.y : cssH * 0.55;
      n = n || 12;
      for (var i = 0; i < n; i++) {
        spawn({
          x: ox + rand(-4, 6), y: oy + rand(-2, 2),
          vx: rand(-14, 16), vy: rand(4, 22),
          size: rand(0.9, 2.4), grow: -0.4,
          life: rand(0.55, 1.25), alpha: rand(0.4, 0.8),
          turb: 6, sprite: 'ash', buoy: -90
        });
      }
    }
    /* 咳嗽：短促紊乱的烟团 */
    function coughBurst() {
      var mp = mouthPos();
      if (!mp) return;
      var d = densityScale();
      var col = smokeCfg.color;
      for (var i = 0; i < Math.round(10 * d); i++) {
        spawn({
          x: mp.x + rand(-16, 12), y: mp.y + rand(-8, 8),
          vx: rand(-52, 12), vy: rand(-24, 12),
          size: rand(4, 9), grow: rand(22, 44),
          life: rand(0.7, 1.6), alpha: rand(0.16, 0.3) * d,
          turb: 30, sprite: paletteFor(col), buoy: rand(2, 9)
        });
      }
      exhaleBurst(0.7);
    }
    /* v3：吐烟圈 —— 真涡环：从嘴边喷出、逐个扩散上飘、透视缩放消散 */
    function ringsBurst(n, power) {
      n = n || randi(5, 7);
      power = clamp(power == null ? 1 : power, 0.5, 2);
      var mp = mouthPos();
      /* 真实手图模式下嘴部被手挡住：烟圈从画面中左侧的空处喷出，视觉更清楚 */
      try {
        if (photoActive() && stageEl) mp = { x: stageEl.clientWidth * 0.18, y: stageEl.clientHeight * 0.40 };
      } catch (e) {}
      if (!mp) return;
      var col = smokeCfg.color;
      var vapor = col === 'vapor';
      var pal = SMOKE_PALETTE[paletteFor(col)] || SMOKE_PALETTE.warm;
      for (var i = 0; i < n; i++) {
        if (rings.length >= ringCap) rings.shift();
        rings.push({
          x: mp.x + rand(-3, 3), y: mp.y + rand(-2, 2),
          vx: rand(-7, -2) - power * 2, vy: rand(-16, -9) - i * 0.6,
          rx: rand(4.4, 6.4), ry: rand(2.3, 3.4),
          gr: rand(14, 22) * (0.9 + power * 0.12),
          life: rand(2.8, 4.0), age: 0, delay: i * 0.085,
          alpha: (vapor ? 0.58 : 0.5) * (0.9 + power * 0.1),
          rot: rand(-0.28, 0.28), vr: rand(-0.3, 0.3),
          thick: rand(2.6, 4.0) * (0.9 + power * 0.1),
          wob: rand(1.2, 2.4), seed: Math.random() * 9,
          color: pal.core, soft: pal.soft, ring: true
        });
        /* 环后跟着的小烟团，增强涡流感 */
        for (var j = 0; j < 2; j++) {
          spawn({
            x: mp.x + rand(-4, 4), y: mp.y + rand(-2, 2),
            vx: rand(-20, -6), vy: rand(-12, -4),
            size: rand(2.5, 5), grow: rand(10, 20),
            life: rand(1.0, 1.9), alpha: rand(0.16, 0.3) * densityScale(),
            turb: 12, sprite: paletteFor(col), buoy: 10
          });
        }
      }
    }
    /* 火星 */
    function sparks(n) {      var tp = tipPos();
      if (!tp) return;
      n = n || 4;
      for (var i = 0; i < n; i++) {
        if (rings.length < 0) break;
        spawn({
          x: tp.x + rand(-1.5, 1.5), y: tp.y + rand(-1.5, 1.5),
          vx: rand(-14, 18), vy: rand(-40, -14),
          size: rand(0.8, 1.9), grow: -1.4,
          life: rand(0.5, 1.1), alpha: rand(0.5, 0.95),
          turb: 20, sprite: 'spark', buoy: -3
        });
      }
    }
    /* 环境暖尘（让画面有空气感） */
    function ambient() {
      if (aliveCount() > 60) return;
      if (Math.random() < 0.45) return;
      spawn({
        x: rand(6, cssW - 6), y: rand(cssH * 0.15, cssH),
        vx: rand(-3, 3), vy: rand(-6, -2),
        size: rand(0.7, 1.8), grow: 0.6,
        life: rand(3.5, 7), alpha: rand(0.09, 0.2),
        kind: 'ambient', turb: 2, sprite: 'warm', buoy: 2
      });
    }
    function update(dt) {
      var i, p;
      for (i = 0; i < pool.length; i++) {
        p = pool[i];
        if (!p.live) continue;
        p.age += dt;
        if (p.age >= p.life) { p.live = false; continue; }
        var t = p.age / p.life;
        var sway = Math.sin(p.age * 1.35 * p.wob + p.seed * 0.7);
        var swirl = Math.sin(p.age * 0.85 + p.seed * 0.35);
        p.vx += (sway * p.turb + swirl * 2.2) * dt;
        p.vy = p.vy * (1 - dt * 0.55) - p.buoy * (1 - t * 0.45) * dt;
        p.x += (p.vx + windX * 0.45) * dt;
        p.y += p.vy * dt;
        var growEase = 1 - Math.exp(-p.age * 1.6);
        p.size = p.size0 + p.grow * growEase;
        var inA = Math.min(1, p.age / 0.22);
        var outA = Math.pow(1 - t, 1.55);
        p.alpha = Math.max(0, p.a0 * inA * outA);
        p.rot += p.vr * dt;
      }
      for (i = rings.length - 1; i >= 0; i--) {
        var r = rings[i];
        r.age += dt;
        if (r.age < (r.delay || 0)) continue;
        if (r.age >= r.life) { rings.splice(i, 1); continue; }
        var rt = r.age / r.life;
        var ease = 1 - Math.pow(1 - rt, 2.6);
        r.x += (r.vx + windX) * dt + Math.sin(r.age * 2.1 + (r.seed || 0)) * 3.2 * dt;
        r.y += r.vy * dt;
        r.vy += 2.6 * dt;
        r.rx += r.gr * (0.35 + ease * 0.9) * dt;
        r.ry += r.gr * 0.58 * dt;
        r.rot += r.vr * dt * (1 - rt * 0.6);
        r.alpha *= (1 - rt * 0.9);
      }
    }
    function draw() {
      if (!c) return;
      c.clearRect(0, 0, cssW, cssH);
      /* 烟头暖光（呼吸感） */
      try {
        if (isLit()) {
          var tp = tipPos();
          if (tp) {
            var inhaleBoost = state.inhaling ? 1.15 : 1;
            var pulse = (0.6 + 0.25 * Math.sin(Date.now() / 320)) * inhaleBoost;
            var rr = 7.5 * inhaleBoost;
            var gl = c.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, rr);
            gl.addColorStop(0, 'rgba(255,120,52,' + Math.min(0.6, 0.45 * pulse).toFixed(3) + ')');
            gl.addColorStop(0.5, 'rgba(210,80,26,' + Math.min(0.4, 0.22 * pulse).toFixed(3) + ')');
            gl.addColorStop(1, 'rgba(120,30,8,0)');
            c.fillStyle = gl;
            c.beginPath();
            c.arc(tp.x, tp.y, rr, 0, 6.2832);
            c.fill();
          }
        }
      } catch (e) {}
      var i, p;
      var bottomGuard = cssH * 0.93;
      for (i = 0; i < pool.length; i++) {
        p = pool[i];
        if (!p.live || p.alpha <= 0.002) continue;
        if (p.y > bottomGuard) continue;
        if (p.sprite === 'spark') {
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = clamp(p.alpha, 0, 1);
          c.fillStyle = 'rgb(255,' + Math.round(150 + 90 * Math.random()) + ',90)';
          c.beginPath();
          c.arc(p.x, p.y, Math.max(0.4, p.size), 0, 6.2832);
          c.fill();
          c.globalCompositeOperation = 'source-over';
        } else {
          var img = sprite(p.sprite, p.variant);
          if (!img) continue;
          c.globalAlpha = clamp(p.alpha, 0, 0.9);
          c.save();
          c.translate(p.x, p.y);
          c.rotate(p.rot || 0);
          var sw = p.size * (p.stretch || 1), sh = p.size;
          c.drawImage(img, -sw / 2, -sh / 2, sw, sh);
          c.restore();
        }
      }
      for (i = 0; i < rings.length; i++) {
        var r = rings[i];
        if (r.age < (r.delay || 0)) continue;
        var rt2 = clamp(r.age / r.life, 0, 1);
        var open = clamp(r.age * 2.6, 0, 1);
        c.save();
        c.translate(r.x, r.y);
        c.rotate(r.rot);
        /* 外圈柔光 */
        c.globalAlpha = clamp(r.alpha * 0.22 * open, 0, 1);
        c.strokeStyle = rgba(r.soft || r.color, 0.62);
        c.lineWidth = r.thick * 3.6;
        c.beginPath();
        c.ellipse(0, 0, r.rx, r.ry, 0, 0, 6.2832);
        c.stroke();
        /* 主涡环（上缘亮、下缘暗，做出厚度） */
        c.globalAlpha = clamp(r.alpha * open * (0.75 + 0.25 * Math.cos(r.age * 3)), 0, 1);
        c.strokeStyle = rgba(r.color, 0.8);
        c.lineWidth = r.thick * (1.05 - rt2 * 0.35);
        c.beginPath();
        c.ellipse(0, -r.ry * 0.16, r.rx, r.ry, 0, -Math.PI * 0.92, Math.PI * 0.18);
        c.stroke();
        c.globalAlpha = clamp(r.alpha * open * 0.5, 0, 1);
        c.strokeStyle = rgba(r.soft || r.color, 0.4);
        c.lineWidth = r.thick * 0.7;
        c.beginPath();
        c.ellipse(0, r.ry * 0.12, r.rx * 0.94, r.ry * 0.88, 0, Math.PI * 0.04, Math.PI * 1.0);
        c.stroke();
        c.restore();
      }
      c.globalAlpha = 1;
    }
    function frame(ts) {
      raf = 0;
      if (!running) return;
      if (!lastTs) lastTs = ts;
      var dt = clamp((ts - lastTs) / 1000, 0, 0.05);
      lastTs = ts;
      if (!paused) {
        try {
          update(dt);
          if (isLit()) {
            emitAcc += dt;
            var interval = (0.3 - clamp(state.progress || 0, 0, 0.7) * 0.16) / Math.max(0.4, densityScale());
            try { if (photoActive()) interval *= 2.4; } catch (e) {}
            if (emitAcc > interval) { emitAcc = 0; wisp(); }
            if (Math.random() < 0.5) ambient();
          } else if (isTaken()) {
            /* 没点着也有一点未燃的纸味（很淡） */
          } else {
            ambientAcc += dt;
            if (ambientAcc > 0.8) { ambientAcc = 0; ambient(); }
          }
          draw();
        } catch (e) {}
      }
      raf = requestAnimationFrame(frame);
    }
    function start() {
      if (running) return;
      running = true;
      lastTs = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) { try { cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
      try { if (c) c.clearRect(0, 0, cssW, cssH); } catch (e) {}
    }
    function setPaused(v) { paused = !!v; }
    function isPaused() { return paused; }
    function setEmitters(tip, mouth) { tipGetter = tip; mouthGetter = mouth; }
    function clear() {
      for (var i = 0; i < pool.length; i++) pool[i].live = false;
      rings.length = 0;
      try { if (c) c.clearRect(0, 0, cssW, cssH); } catch (e) {}
    }
    function stats() { return { particles: aliveCount() }; }
    function particlePoints(limit, kinds) {
      var out = [];
      var n = limit || 240;
      var allow = kinds || null;
      for (var i = 0; i < pool.length && out.length < n; i++) {
        var p = pool[i];
        if (!p.live || p.sprite === 'spark' || p.alpha <= 0.02) continue;
        if (allow && allow.length && allow.indexOf(p.kind) < 0) continue;
        if (!allow && p.kind !== 'exhale') continue;
        out.push({ x: +(p.x / Math.max(1, cssW)).toFixed(3), y: +(p.y / Math.max(1, cssH)).toFixed(3) });
      }
      return out;
    }
    return {
      init: init, resize: resize, start: start, stop: stop, setPaused: setPaused, isPaused: isPaused,
      setEmitters: setEmitters, wisp: wisp, puffBurst: puffBurst, exhaleBurst: exhaleBurst,
      ringsBurst: ringsBurst, sparks: sparks, ashBurst: ashBurst, coughBurst: coughBurst,
      clear: clear, stats: stats, particlePoints: particlePoints, puffInfo: puffInfo
    };
  })();

  /* 烟雾参数（由当前产品决定） */
  var smokeCfg = { density: 1, color: 'warm', drift: 1 };
  function densityScale() {
    try { return clamp((smokeCfg.density || 1) * (cfg.density || 1) * 1.3, 0.4, 2.8); } catch (e) { return 1.3; }
  }
  function driftScale() { return clamp(smokeCfg.drift || 1, 0.5, 2); }

  /* ==========================================================================
   * 8. 主场景 DOM
   * ========================================================================*/
  function buildWidgetDOM() {
    rootEl = document.createElement('div');
    rootEl.id = ROOT_ID;
    rootEl.className = 'smk-theme-dark';
    var ashtrayHTML = renderAshtraySVG();
    rootEl.innerHTML =
      '<div class="smk-widget" id="smk-widget">' +
        '<div class="smk-card">' +
          '<div class="smk-top" id="smk-drag" title="按住拖动 · 双击复位">' +
            '<span class="smk-led" id="smk-led"></span>' +
            '<div class="smk-top-main">' +
              '<div class="smk-brandline"><span class="smk-brandname" id="smk-top-brand">—</span><span class="smk-rest" id="smk-top-rest">剩 20</span></div>' +
              '<div class="smk-stat" id="smk-top-stat">—</div>' +
            '</div>' +
            '<div class="smk-top-btns">' +
              '<button class="smk-iconbtn" id="smk-btn-menu" type="button" title="快捷菜单" aria-label="快捷菜单">☰</button>' +
              '<button class="smk-iconbtn" id="smk-btn-hide" type="button" title="隐藏挂件" aria-label="隐藏挂件">✕</button>' +
            '</div>' +
          '</div>' +
          '<div class="smk-stage" id="smk-stage">' +
            '<div class="smk-turnbar" id="smk-turnbar"><span class="smk-spin"></span><span class="smk-turn-txt" id="smk-turn-txt">任务在跑</span><span class="smk-turn-clock" id="smk-turn-clock">00:00</span></div>' +
            '<div class="smk-ashtray" id="smk-ashtray">' + ashtrayHTML + '<div class="smk-buttlayer" id="smk-butts"></div></div>' +
            '<div class="smk-packshadow" id="smk-packshadow"></div>' +
            '<div class="smk-packwrap" id="smk-packwrap"></div>' +
            '<div class="smk-openfx" id="smk-openfx"><i class="smk-glint"></i><i class="smk-foil"></i></div>' +
            '<div class="smk-cigwrap" id="smk-cigwrap"></div>' +
            '<div class="smk-hand" id="smk-hand"></div>' +
            '<div class="smk-hand-front" id="smk-hand-front"></div>' +
            '<div class="smk-tipcover" id="smk-tipcover"></div>' +
            '<div class="smk-ciglabel" id="smk-ciglabel"></div>' +
            '<div class="smk-lighter" id="smk-lighter">' + renderLighterSVG() + '<div class="smk-flame" id="smk-flame"><i></i><i class="smk-f2"></i></div></div>' +
            '<canvas class="smk-canvas" id="smk-canvas"></canvas>' +
            '<div class="smk-photoburn" id="smk-photoburn" data-emitter="tip"><i class="smk-pb-ash"></i><i class="smk-pb-fire"></i></div>' +
            '<div class="smk-cutter" id="smk-cutter"></div>' +
            '<div class="smk-flash" id="smk-flash"></div>' +
            '<div class="smk-ashdot" id="smk-ashdot" title="烫痕"></div>' +
            '<div class="smk-intensity" id="smk-intensity"><i id="smk-intensity-fill"></i><span>喉咙</span></div>' +
            '<div class="smk-toast" id="smk-toast"></div>' +
            '<div class="smk-loading" id="smk-loading">正在备一支虚拟烟…</div>' +
          '</div>' +
          '<div class="smk-actions" id="smk-actions">' +
            '<button class="smk-btn smk-primary" type="button" data-act="open">开盒</button>' +
            '<button class="smk-btn" type="button" data-act="flick" disabled>抖灰</button>' +
            '<button class="smk-btn" type="button" data-act="dout" disabled>掐灭</button>' +
            '<button class="smk-btn smk-icon-only" type="button" data-act="cabinet" title="烟柜" aria-label="烟柜">◈</button>' +
          '</div>' +
        '</div>' +
        '<div class="smk-hint" id="smk-hint"></div>' +
      '</div>' +
      '<div class="smk-overlay" id="smk-overlay"><div class="smk-backdrop" data-smk-close="1"></div><div class="smk-panel" id="smk-panel"></div></div>' +
      '<div class="smk-menu" id="smk-menu"></div>' +
      '<div class="smk-peek" id="smk-peek" title="恢复抽烟挂件"></div>';
    (document.body || document.documentElement).appendChild(rootEl);

    widgetEl = rootEl.querySelector('#smk-widget');
    stageEl = rootEl.querySelector('#smk-stage');
    canvasEl = rootEl.querySelector('#smk-canvas');
    packWrap = rootEl.querySelector('#smk-packwrap');
    packShadowEl = rootEl.querySelector('#smk-packshadow');
    tipCoverEl = rootEl.querySelector('#smk-tipcover');
    cigWrap = rootEl.querySelector('#smk-cigwrap');
    lighterEl = rootEl.querySelector('#smk-lighter');
    ashtrayEl = rootEl.querySelector('#smk-ashtray');
    buttLayer = rootEl.querySelector('#smk-butts');
    topBrandEl = rootEl.querySelector('#smk-top-brand');
    topRestEl = rootEl.querySelector('#smk-top-rest');
    topStatEl = rootEl.querySelector('#smk-top-stat');
    ledEl = rootEl.querySelector('#smk-led');
    turnBar = rootEl.querySelector('#smk-turnbar');
    turnTxt = rootEl.querySelector('#smk-turn-txt');
    turnClock = rootEl.querySelector('#smk-turn-clock');
    hintEl = rootEl.querySelector('#smk-hint');
    toastEl = rootEl.querySelector('#smk-toast');
    actionsEl = rootEl.querySelector('#smk-actions');
    peekEl = rootEl.querySelector('#smk-peek');
    menuEl = rootEl.querySelector('#smk-menu');
    overlayEl = rootEl.querySelector('#smk-overlay');
    panelEl = rootEl.querySelector('#smk-panel');
    btns.open = actionsEl.querySelector('[data-act="open"]');
    btns.puff = actionsEl.querySelector('[data-act="flick"]');
    btns.dout = actionsEl.querySelector('[data-act="dout"]');
    btns.cabinet = actionsEl.querySelector('[data-act="cabinet"]');
    handEl = rootEl.querySelector('#smk-hand');
    flashEl = rootEl.querySelector('#smk-flash');
    ashdotEl = rootEl.querySelector('#smk-ashdot');
    intensityEl = rootEl.querySelector('#smk-intensity');
    intensityFill = rootEl.querySelector('#smk-intensity-fill');
    openFxEl = rootEl.querySelector('#smk-openfx');
    cutterEl = rootEl.querySelector('#smk-cutter');
    cutterEl = rootEl.querySelector('#smk-cutter');
    /* v3：真实烟灰缸图（缺失静默回退 SVG；雪茄用陶瓷款） */
    renderAshtrayView();
    if (handEl) {
      var hi = handImageFor();
      photoHandMode = !!hi;
      photoHandOk = false;
      handEl.innerHTML = '<span class="smk-hand-svg">' + renderHandSVG() + '</span>' +
        (hi ? '<img class="smk-hand-img" src="' + escapeHtml(hi) + '" alt="" draggable="false">' : '') +
        '';
      if (hi) {
        var im = handEl.querySelector('.smk-hand-img');
        var checkHand = function () {
          try {
            if (!im || !im.naturalWidth) { photoHandOk = false; return; }
            checkImageAlpha(im, function (ok) {
              photoHandOk = !!ok;
              if (!ok) {
                try { im.parentNode && im.parentNode.removeChild(im); } catch (e) {}
                photoHandMode = false;
                try { if (handFrontEl) handFrontEl.innerHTML = renderHandFrontSVG(); } catch (e) {}
              }
            });
          } catch (e) { photoHandMode = false; }
        };
        if (im.complete && im.naturalWidth) checkHand();
        else {
          im.onload = checkHand;
          im.onerror = function () {
            photoHandMode = false;
            try { im.parentNode && im.parentNode.removeChild(im); } catch (e) {}
            try { if (handFrontEl) handFrontEl.innerHTML = renderHandFrontSVG(); } catch (e) {}
          };
        }
      }
    }
    handFrontEl = rootEl.querySelector('#smk-hand-front');
    if (handFrontEl) {
      handFrontEl.innerHTML = photoHandMode ? '' : renderHandFrontSVG();
    }
  }

  /* 当前产品 / 包内剩余 */
  function productRemaining(p) {
    if (!p) return 0;
    var packs = cfg.packs && typeof cfg.packs === 'object' ? cfg.packs : {};
    var n = packs[p.id];
    if (typeof n !== 'number' || !isFinite(n)) return PACK_SIZE;
    return clamp(Math.floor(n), 0, PACK_SIZE);
  }
  function setProductRemaining(p, n) {
    if (!p) return;
    if (!cfg.packs || typeof cfg.packs !== 'object') cfg.packs = {};
    cfg.packs[p.id] = clamp(Math.floor(n), 0, PACK_SIZE);
    saveConfigSoon();
  }

  /* 烟盒在舞台里的显示宽度（按目标高度反推，保证不顶出舞台） */
  function packDisplayWidth(p) {
    var g = packGeom(p);
    var stageW = (stageEl && stageEl.clientWidth) || 190;
    var stageH = (stageEl && stageEl.clientHeight) || 200;
    var targetH;
    if (g.face === 'hard' || g.face === 'soft') targetH = stageH - 46;
    else if (g.face === 'tin') targetH = stageH * 0.62;
    else if (g.face === 'cigar') targetH = stageH * 0.46;
    else targetH = stageH * 0.88;
    var w = targetH * g.vw / g.vh;
    return Math.round(clamp(w, 40, stageW * 0.92));
  }
  function renderPackView() {
    if (!product || !packWrap) return;
    try {
      var g = packGeom(product);
      var w = packDisplayWidth(product);
      var h = Math.round(w * g.vh / g.vw);
      packWrap.style.width = w + 'px';
      packWrap.style.height = h + 'px';
      var imgSrc = packImageFor(product);
      packPhotoShown = false;
      /* 先渲染干净的参数化 SVG，真实图通过质量检测后再无缝替换 */
      packWrap.innerHTML = renderPackSVG(product);
      if (packShadowEl) packShadowEl.style.width = Math.round(w * 0.72) + 'px';
      if (!imgSrc) return;
      var cacheKey = product.id + '|' + imgSrc;
      if (packPhotoCache[cacheKey] === false) return;
      var img = new Image();
      img.alt = '';
      img.className = 'smk-pack-img';
      img.onload = function () {
        var ok = packPhotoCache[cacheKey];
        if (ok == null) { ok = checkPackPhoto(img); packPhotoCache[cacheKey] = ok; }
        if (!ok) return;
        try {
          var stageW = (stageEl && stageEl.clientWidth) || 190;
          var stageH = (stageEl && stageEl.clientHeight) || 220;
          var ratio = img.naturalHeight / img.naturalWidth;
          var targetH = g.face === 'cigar' ? stageH * 0.5 : stageH - 46;
          var iw = Math.round(targetH / ratio);
          if (iw > stageW * 0.94) iw = Math.round(stageW * 0.94);
          var ih = Math.round(iw * ratio);
          packWrap.style.width = iw + 'px';
          packWrap.style.height = ih + 'px';
          if (packShadowEl) packShadowEl.style.width = Math.round(iw * 0.72) + 'px';
          packWrap.innerHTML = '';
          packWrap.appendChild(img);
          packPhotoShown = true;
        } catch (e) {}
      };
      img.onerror = function () { try { img.style.display = 'none'; } catch (e) {} try { packPhotoCache[cacheKey] = false; } catch (e) {} try { noteAssetFailure(); } catch (e) {} };
      img.src = imgSrc;
    } catch (e) {}
  }
  var photoBurnEl = null, pbFireEl = null, pbAshEl = null;
  function updatePhotoBurn() {
    try {
      if (!photoBurnEl) {
        photoBurnEl = rootEl && rootEl.querySelector('#smk-photoburn');
        if (photoBurnEl) { pbFireEl = photoBurnEl.querySelector('.smk-pb-fire'); pbAshEl = photoBurnEl.querySelector('.smk-pb-ash'); }
      }
      if (!photoBurnEl) return;
      if (!photoActive()) { photoBurnEl.style.opacity = '0'; return; }
      /* v7：火光只在真正燃烧（lit/burnt）时出现，拿烟/点火阶段不显示浮空光斑 */
      if (!(state.phase === PHASE.LIT || state.phase === PHASE.BURNT)) { photoBurnEl.style.opacity = '0'; return; }
      var tp = computeTip();
      if (!tp) { photoBurnEl.style.opacity = '0'; return; }
      /* v7：火光直接锚定 computeTip 的 stage 坐标（与 canvas 火星/烟头白烟同一点） */
      photoBurnEl.style.left = Math.round(tp.x) + 'px';
      photoBurnEl.style.top = Math.round(tp.y) + 'px';
      photoBurnEl.setAttribute('data-tip-x', (+tp.x).toFixed(1));
      photoBurnEl.setAttribute('data-tip-y', (+tp.y).toFixed(1));
      photoBurnEl.style.opacity = '1';
      if (pbAshEl) pbAshEl.style.display = 'none';
      if (pbFireEl) {
        var inhale = state.inhaling ? 1 : 0;
        var breath = 0.5 + 0.5 * Math.sin(nowMs() / 430);
        pbFireEl.style.opacity = String(clamp(inhale ? 0.62 : 0.36 + breath * 0.1, 0.3, 0.66));
        pbFireEl.style.transform = 'scale(' + (inhale ? 1.22 : 0.95 + breath * 0.08).toFixed(2) + ')';
      }
    } catch (e) {}
  }
  function updateCigLabel() {
    try {
      var el = rootEl ? rootEl.querySelector('#smk-ciglabel') : null;
      if (!el) return;
      if (false && photoActive() && product) {
        var txt = /[A-Za-z]/.test(product.brandEn || '') ? String(product.brandEn || '') : String(product.brand || '');
        el.textContent = txt;
        el.classList.add('on');
      } else el.classList.remove('on');
    } catch (e) {}
  }
  function refreshCigVisual() {
    if (!product || !cigWrap) return;
    try {
      updateCigLabel();
      /* v5：真实手图照片里已有香烟——隐藏 SVG 烟支与 SVG 手指，避免叠影/悬空 */
      if (photoActive()) {
        try { cigWrap.style.display = 'none'; cigWrap.innerHTML = ''; } catch (e) {}
        if (handEl) handEl.classList.add('photo');
        updatePhotoBurn();
        return;
      }
      try { cigWrap.style.display = ''; } catch (e) {}
      var __isCigP = false;
      try { __isCigP = cigSpec(product).isCigar; } catch (e) {}
      if (!__isCigP && (state.phase === PHASE.OUT || state.phase === PHASE.TAKEN)) {
        try {
          var sc = singleCigSrc();
          cigWrap.innerHTML = '<img class="smk-singlecig" src="' + escapeHtml(sc) + '" alt="" draggable="false">';
          var sci = cigWrap.querySelector('.smk-singlecig');
          if (sci) attachSingleCigFallback(sci);
          updateCigLabel();
          return;
        } catch (e) {}
      }
      var prog = clamp(state.progress || 0, 0, 0.66);
      var mode = state.phase === PHASE.LIT || state.phase === PHASE.BURNT ? 'lit' : 'out';
      var isCig = false;
      try { isCig = cigSpec(product).isCigar; } catch (e) {}
      var photo = isCig ? cigarPhotoFor() : cigImageFor(mode);
      if (photo) {
        if (isCig) layoutCigarPhoto();
        cigWrap.innerHTML = '<img class="smk-cigar-photo" src="' + escapeHtml(photo) + '" alt="" draggable="false" style="display:block;width:100%;height:100%;object-fit:contain;pointer-events:none">';
        var cimg = cigWrap.querySelector('.smk-cigar-photo');
        if (cimg) cimg.onerror = function () {
          try {
            cigWrap.innerHTML = renderCigSVG(product, prog, mode, state.ash || 0);
            layoutCig('held');
          } catch (e) {}
        };
        return;
      }
      cigWrap.innerHTML = renderCigSVG(product, prog, mode, state.ash || 0);
      updateCigLabel();
      /* v3：燃烧变短（保持滤嘴端位置不动，从火头一侧缩短） */
      if (!cigLayout.baseW) return;
      var shrink = mode === 'lit' ? (1 - prog * 0.55) : 1;
      var w = Math.max(10, Math.round(cigLayout.baseW * shrink));
      var h = Math.max(6, Math.round(cigLayout.baseH * (0.9 + 0.1 * shrink)));
      var left = Math.round(cigLayout.baseLeft + (cigLayout.baseW - w));
      cigWrap.style.width = w + 'px';
      cigWrap.style.height = h + 'px';
      cigWrap.style.left = left + 'px';
      cigLayout.w = w;
      cigLayout.h = h;
      cigLayout.left = left;
    } catch (e) {}
  }
  /* 烟支在舞台上的位置 / 尺寸（px）—— 按 SKU 真实长度/直径比例换算 */
  var cigLayout = { left: 0, top: 0, w: 100, h: 24, angle: 0, baseW: 100, baseH: 24, baseLeft: 0 };
  function layoutCig(kind) {
    if (!cigWrap || !stageEl || !product) return;
    var W = stageEl.clientWidth, H = stageEl.clientHeight;
    var sp = cigSpec(product);
    var baseW, pxPerMm;
    if (kind === 'held') {
      baseW = W * (sp.isCigar ? 0.94 : sp.isSlim ? 0.78 : sp.isShort ? 0.62 : 0.8);
    } else {
      baseW = W * (sp.isCigar ? 0.8 : sp.isSlim ? 0.6 : sp.isShort ? 0.5 : 0.62);
    }
    baseW = Math.min(baseW, W * 0.94);
    pxPerMm = baseW / sp.length;
    /* v4：把直径差异放大到肉眼可辨（细支/中支/常规/雪茄等比放大） */
    var thickBoost = sp.isCigar ? 2.3 : 1.6;
    var baseH = Math.max(8, sp.diameter * pxPerMm * thickBoost);
    var prog = clamp(state.progress || 0, 0, 0.66);
    var shrink = kind === 'held' ? (1 - prog * 0.55) : 1;
    var w = Math.round(baseW * shrink);
    var h = Math.round(baseH * (0.92 + 0.08 * shrink));
    var left, top, angle;
    if (kind === 'held') {
      var isPhoto = false;
      try { isPhoto = photoActive(); } catch (e) {}
      left = Math.round(W * (isPhoto ? 0.02 : 0.07) + (baseW - w));
      top = Math.round(H * (sp.isCigar ? 0.10 : (isPhoto ? 0.31 : 0.44)));
      angle = sp.isCigar ? 12 : (isPhoto ? 24 : 18);
    } else {
      left = Math.round(W * 0.2);
      top = Math.round(H * 0.63);
      angle = -6;
    }
    cigWrap.style.width = w + 'px';
    cigWrap.style.height = h + 'px';
    cigWrap.style.left = left + 'px';
    cigWrap.style.top = top + 'px';
    cigWrap.style.transform = 'rotate(' + angle + 'deg)';
    cigLayout = { left: left, top: top, w: w, h: h, angle: angle, baseW: baseW, baseH: baseH, baseLeft: left };
  }
  function layoutCigarPhoto() {
    try {
      if (!cigWrap || !stageEl) return;
      var W = stageEl.clientWidth, H = stageEl.clientHeight;
      var w = Math.round(W * 0.98);
      var h = Math.round(w / 5); /* cigar.png 1200x240 */
      var left = Math.round(W * 0.02);
      var top = Math.round(H * 0.20);
      var angle = 10;
      cigWrap.style.width = w + 'px';
      cigWrap.style.height = h + 'px';
      cigWrap.style.left = left + 'px';
      cigWrap.style.top = top + 'px';
      cigWrap.style.transform = 'rotate(' + angle + 'deg)';
      cigLayout = { left: left, top: top, w: w, h: h, angle: angle, baseW: w, baseH: h, baseLeft: left };
    } catch (e) {}
  }
  function setCigMode(mode) {
    /* mode: hidden | lying | held */
    if (!cigWrap) return;
    try {
      cigWrap.classList.remove('smk-show', 'smk-cig-lying', 'smk-cig-held', 'smk-cig-holdable');
      if (mode === 'hidden') { cigWrap.style.opacity = '0'; return; }
      /* 真实手部图自带烟时，不再叠 SVG 烟支（除非有真实烟支图） */
      if (mode === 'held' && photoActive()) { cigWrap.style.opacity = '0'; return; }
      layoutCig(mode);
      cigWrap.style.opacity = '1';
      cigWrap.classList.add('smk-show');
      cigWrap.classList.add(mode === 'held' ? 'smk-cig-held' : 'smk-cig-lying');
      if (mode === 'lying' || state.phase === PHASE.TAKEN) cigWrap.classList.add('smk-cig-holdable');
    } catch (e) {}
  }

  /* 烟灰缸里的烟蒂（累计计数来自 stats.buttCount，视觉最多 8 个） */
  function renderButts() {
    if (!buttLayer) return;
    try {
      var n = clamp(stats.buttCount || 0, 0, 8);
      var html = '';
      var slots = [
        [30, 16, -18], [46, 14, 8], [62, 17, -6], [40, 12, 32], [56, 11, -26],
        [70, 15, 14], [34, 19, 44], [52, 9, -40]
      ];
      var cigarButt = false;
      try { cigarButt = cigSpec(product).isCigar; } catch (e) {}
      for (var i = 0; i < n; i++) {
        var sl = slots[i % slots.length];
        var ash = i % 3 === 0 ? ' smk-butt-ash' : '';
        var bs = cigarButt
          ? 'width:16px;height:5px;border-radius:3px;background:linear-gradient(90deg,#5a3a22 0 62%,#3a2414 62% 100%);'
          : '';
        html += '<span class="smk-butt' + ash + '" style="left:' + sl[0] + '%;bottom:' + sl[1] + 'px;transform:rotate(' + sl[2] + 'deg);' + bs + '"></span>';
      }
      /* 抖落的烟灰让烟缸里更脏一点（主动抖灰的安全反馈） */
      var piles = clamp(state.ashDrops || 0, 0, 10);
      for (var pi = 0; pi < piles; pi++) {
        html += '<span style="position:absolute;left:' + (30 + (pi * 7) % 40) + '%;bottom:' + (18 + (pi % 3) * 2) + 'px;width:' + (2 + pi % 2) + 'px;height:2px;border-radius:50%;background:#9b948a;opacity:.8;transform:rotate(' + (pi * 41) + 'deg)"></span>';
      }
      buttLayer.innerHTML = html;
    } catch (e) {}
  }

  /* 发射点：燃烧端 / 呼气口 */
  function computeTip() {
    try {
      if (!stageEl) return null;
      /* 真实手部图自带烟：按画面比例给一个火头位置 */
      if (photoActive()) {
        var pt = photoTipStage();
        if (pt) return pt;
        var g = photoGeom(), b = photoImgBox();
        if (b) return { x: b.x + b.w * g.tip[0], y: b.y + b.h * g.tip[1] };
        return { x: stageEl.clientWidth * g.tip[0], y: stageEl.clientHeight * g.tip[1] };
      }
      if (!cigWrap || !cigWrap.classList.contains('smk-show')) return null;
      var L = cigLayout;
      if (!L || !L.w) return null;
      var frac = clamp(0.035 + (state.progress || 0) * 0.7, 0.02, 0.74);
      var lx = L.left + L.w * frac;
      var ly = L.top + L.h * 0.5;
      var cx = L.left + L.w / 2;
      var cyb = L.top + L.h;
      var ang = (L.angle || 0) * Math.PI / 180;
      var dx = lx - cx, dy = ly - cyb;
      var x = cx + dx * Math.cos(ang) - dy * Math.sin(ang);
      var y = cyb + dx * Math.sin(ang) + dy * Math.cos(ang);
      return { x: x, y: y };
    } catch (e) { return null; }
  }
  function computeMouth() {
    try {
      if (photoActive() && stageEl) {
        var g2 = photoGeom(), b2 = photoImgBox();
        if (b2) return { x: b2.x + b2.w * g2.mouth[0], y: b2.y + b2.h * g2.mouth[1] };
        return { x: stageEl.clientWidth * g2.mouth[0], y: stageEl.clientHeight * g2.mouth[1] };
      }
      if (cigWrap && stageEl && cigWrap.classList.contains('smk-show')) {
        var L = cigLayout;
        if (!L || !L.w) return null;
        var lx = L.left + L.w * 0.99;
        var ly = L.top + L.h * 0.5;
        var cx = L.left + L.w / 2;
        var cyb = L.top + L.h;
        var ang = (L.angle || 0) * Math.PI / 180;
        var dx = lx - cx, dy = ly - cyb;
        var mx = cx + dx * Math.cos(ang) - dy * Math.sin(ang);
        var my = cyb + dx * Math.sin(ang) + dy * Math.cos(ang);
        /* 略向下一侧偏，像从嘴边吐出来 */
        return { x: mx, y: my + 4 };
      }
      if (!stageEl) return null;
      var W = stageEl.clientWidth, H = stageEl.clientHeight;
      return { x: W * 0.62, y: H * 0.82 };
    } catch (e) { return null; }
  }

  /* ==========================================================================
   * 9. 状态机（idle → 开盒 → 取烟 → 拿起 → 点火 → lit → 抽 → 掐灭 → 烟灰缸）
   * ========================================================================*/
  var state = {
    phase: PHASE.IDLE,
    puffs: 0,
    progress: 0,
    buttCount: 0,
    litAt: 0,
    takeAt: 0,
    puffing: false,
    busy: false,
    autoOn: false,
    autoSec: 6,
    lastPuffAt: 0,
    timer: 0,
    seq: 0,
    packRemaining: PACK_SIZE,
    /* v2：长按吸气 / 烟灰 / 烫手 / 喉咙 */
    inhaling: false,
    inhaleStart: 0,
    inhaleTier: 0,
    inhaleTimer: 0,
    inhaleHeld: 0,
    coughPending: false,
    ash: 0,
    ashTimer: 0,
    ashDrops: 0,
    burned: false,
    throat: 0,
    strongPuffs: 0,
    lastReleaseAt: 0,
    lastBurnCtx: 'hand',
    burnKind: '',
    cigarCutted: false,
    hintTick: 0
  };
  var autoTimerId = 0, litTickId = 0, throatTimerId = 0;
  function resetCigState() {
    try {
      dlog('reset');
      state.ash = 0;
      state.ashDrops = 0;
      state.burned = false;
      state.throat = 0;
      state.strongPuffs = 0;
      state.inhaling = false;
      state.inhaleTier = 0;
      state.coughPending = false;
      state.cigarCutted = false;
      state.burnKind = '';
      state.puffs = 0;
      state.progress = 0;
      state.litAt = 0;
      if (state.inhaleTimer) { clearInterval(state.inhaleTimer); state.inhaleTimer = 0; }
      if (state.ashTimer) { clearTimeout(state.ashTimer); state.ashTimer = 0; }
      if (ashdotEl) ashdotEl.classList.remove('on');
      if (intensityEl) intensityEl.classList.remove('on');
      if (flashEl) flashEl.classList.remove('on');
      if (handEl) handEl.classList.remove('inhale', 'press');
      if (handFrontEl) handFrontEl.classList.remove('inhale', 'press');
    } catch (e) {}
  }
  /* 喉咙/强度条（0~1） */
  function updateIntensity(v) {
    try {
      if (!intensityEl) return;
      if (v == null) v = 0;
      intensityEl.classList.toggle('on', v > 0.02);
      if (intensityFill) intensityFill.style.height = Math.round(clamp(v, 0, 1) * 100) + '%';
    } catch (e) {}
  }
  function updateThroatDecay() {
    try {
      if (throatTimerId) return;
      throatTimerId = setInterval(function () {
        try {
          state.throat = clamp((state.throat || 0) - 0.035, 0, 1);
          if (state.throat <= 0.01) { state.throat = 0; clearInterval(throatTimerId); throatTimerId = 0; }
        } catch (e) {}
      }, 700);
    } catch (e) {}
  }
  function showHand(on) {
    try {
      if (!handEl) return;
      var layers = [handEl, handFrontEl];
      for (var i = 0; i < layers.length; i++) {
        var el = layers[i];
        if (!el) continue;
        if (on) { el.classList.remove('off'); el.classList.add('on'); }
        else { el.classList.add('off'); el.classList.remove('on', 'inhale', 'press'); }
      }
    } catch (e) {}
  }
  function hidePackAway(away) {
    try {
      if (!packWrap) return;
      packWrap.classList.toggle('smk-pack-away', !!away);
      if (packShadowEl) packShadowEl.style.opacity = away ? '0' : '';
      if (stageEl) stageEl.classList.toggle('smk-packless', !!away);
    } catch (e) {}
  }
  /* 开始长按吸气 */
  function startInhale(source) {
    try {
      if (state.phase !== PHASE.LIT || state.inhaling) return;
      dlog('hold-start ' + (source || '?') + ' phase=' + state.phase);
      SFX.unlock();
      state.inhaling = true;
      state.inhaleStart = nowMs();
      state.inhaleTier = 0;
      state.coughPending = false;
      state.lastEvent = 'hold';
      if (handEl) { handEl.classList.add('inhale'); handEl.classList.remove('off'); handEl.classList.add('on'); }
      if (handFrontEl) { handFrontEl.classList.add('inhale'); handFrontEl.classList.remove('off'); handFrontEl.classList.add('on'); }
      if (cigWrap) {
        cigWrap.classList.add('inhaling');
        cigWrap.style.transform = 'rotate(' + (cigLayout.angle || 24) + 'deg) translate(-5px,-4px) scale(1.035)';
      }
      SFX.startCrackle();
      var sp = cigSpec(product);
      SFX.play(sp.isCigar ? 'cigar-puff' : 'puff', { vol: sp.isCigar ? 0.5 : 0.4 });
      if (state.inhaleTimer) clearInterval(state.inhaleTimer);
      state.inhaleTimer = setInterval(inhaleTick, 90);
      updateIntensity(0.06);
      state.throat = clamp((state.throat || 0) + 0.03, 0, 1);
    } catch (e) {}
  }
  function inhaleTick() {
    try {
      if (!state.inhaling || state.phase !== PHASE.LIT) return;
      var sp = cigSpec(product);
      var held = (nowMs() - state.inhaleStart) / 1000;
      state.inhaleHeld = held;
      var tier = held < 2 ? 1 : (held < 5 ? 2 : 3);
      if (tier !== state.inhaleTier) {
        state.inhaleTier = tier;
        if (tier >= 2) SFX.play('crackle', { vol: 0.1 });
      }
      /* 火花 / 烟头浓烟（雪茄更旺） */
      var sparkChance = sp.isCigar ? 0.3 + tier * 0.3 : 0.35 + tier * 0.22;
      if (Math.random() < sparkChance) FX.sparks(randi(1, sp.isCigar ? tier + 1 : tier));
      state._wispTick = (state._wispTick || 0) + 1;
      if (tier >= 2) FX.wisp('thick');
      else if (state._wispTick % 2 === 0) FX.wisp('normal');
      /* v3：烟灰增长 = 燃烧时长 + 口数 + 吸气强度/速度（猛吸明显更快、雪茄更慢更结实） */
      if (!sp.isCigar || sp.isCigar) {
        var puffFactor = 1 + Math.min(10, state.puffs || 0) * 0.07;
        var speedFactor = tier === 3 ? 1.9 : tier === 2 ? 1.35 : 1;
        var cigFactor = sp.isCigar ? 0.55 : 1;
        state.ash = clamp(state.ash + 0.0058 * speedFactor * puffFactor * cigFactor, 0, 1);
        if (state.ash > 0.5 && Math.random() < 0.1) FX.sparks(1);
      }
      refreshCigVisual();
      /* 按住靠近嘴边 */
      var prog = clamp(held / 4.5, 0, 1);
      if (cigWrap) cigWrap.style.transform = 'rotate(' + (cigLayout.angle || 24) + 'deg) translate(' + (-5 - prog * 5).toFixed(1) + 'px,' + (-4 - prog * 5).toFixed(1) + 'px) scale(' + (1.035 + prog * 0.035).toFixed(3) + ')';
      var isPhotoHand = false;
      try { isPhotoHand = photoActive(); } catch (e) {}
      var hx = isPhotoHand ? 0 : (-9 - prog * 5), hy = isPhotoHand ? 0 : (-7 - prog * 5);
      if (handEl) {
        handEl.classList.add('inhale');
        handEl.style.transform = 'translate(' + hx.toFixed(1) + 'px,' + hy.toFixed(1) + 'px) scale(' + (isPhotoHand ? 1.012 : 1.055 + prog * 0.02).toFixed(3) + ') rotate(' + (isPhotoHand ? 0 : -2 - prog * 1.2).toFixed(1) + 'deg)';
      }
      if (handFrontEl) {
        handFrontEl.classList.add('inhale');
        handFrontEl.style.transform = 'translate(' + hx.toFixed(1) + 'px,' + hy.toFixed(1) + 'px) scale(' + (1.055 + prog * 0.02).toFixed(3) + ') rotate(' + (-2 - prog * 1.2).toFixed(1) + 'deg)';
      }
      var shown = clamp(held / 5, 0, 1) * 0.85 + clamp((held - 5) / 2, 0, 1) * 0.15;
      updateIntensity(shown);
      state.throat = clamp(state.throat + (tier === 3 ? 0.006 : tier === 2 ? 0.003 : 0.0012), 0, 1);
      updateThroatDecay();
      if (held > 6.6) state.coughPending = true;
      if (held > 12 && DEMO !== 'hold' && DEMO !== 'v2-hold') endInhale('auto-12s');
    } catch (e) {}
  }
  /* 松开：吐烟（烟雾量随按住时长强分层） */
  function endInhale(reason) {
    try {
      if (!state.inhaling) return;
      state.inhaling = false;
      if (state.inhaleTimer) { clearInterval(state.inhaleTimer); state.inhaleTimer = 0; }
      var held = Math.max(0.25, (nowMs() - state.inhaleStart) / 1000);
      dlog('hold-end ' + (reason || '?') + ' held=' + held.toFixed(2) + ' demo=' + DEMO);
      var sp = cigSpec(product);
      state.inhaleHeld = held;
      state.lastReleaseAt = nowMs();
      state.lastBurnCtx = 'mouth';
      if (cigWrap) {
        cigWrap.classList.remove('inhaling');
        cigWrap.style.transform = '';
      }
      if (handEl) { handEl.classList.remove('inhale'); handEl.style.transform = ''; }
      if (handFrontEl) { handFrontEl.classList.remove('inhale'); handFrontEl.style.transform = ''; }
      updateIntensity(0);
      var cough = state.coughPending || held > (sp.isCigar ? 7.5 : 6.5);
      if (!cough && state.strongPuffs >= 2 && held > 4.2 && Math.random() < (sp.isCigar ? 0.5 : 0.35)) cough = true;
      state.lastEvent = cough ? 'cough' : 'release';
      state.puffs++;
      state.lastPuffAt = nowMs();
      state.progress = clamp(Math.max(state.progress, (state.puffs / sp.burnPuffs) * 0.62), 0, 0.66);
      if (cough) {
        doCough(held);
      } else {
        /* v3：轻吸 ~0.4 → 猛吸 ~1.9，粒子量差 ≥3 倍 */
        var strength = clamp(Math.pow(Math.max(0.2, held) / 2.5, 1.35), 0.24, 2.6);
        FX.exhaleBurst(strength);
        FX.puffBurst(0.16 + strength * 0.5);
        SFX.play(sp.isCigar ? 'cigar-puff' : 'exhale', { vol: 0.5, rate: 0.9 + Math.random() * 0.1 });
        if (state.inhaleTier >= 2) state.strongPuffs++;
        else state.strongPuffs = Math.max(0, state.strongPuffs - 1);
        updateChrome();
      }
      scheduleAshDrop();
      if (state.puffs >= sp.burnPuffs) {
        later(function () { if (state.phase === PHASE.LIT) extinguish(true); }, 1100);
      }
    } catch (e) {}
  }
  function scheduleAshDrop() {
    try {
      if (state.phase !== PHASE.LIT) return;
      var sp = cigSpec(product);
      if (state.ashTimer) { clearTimeout(state.ashTimer); state.ashTimer = 0; }
      var threshold = sp.isCigar ? 0.72 : 0.42;
      if (state.ash < threshold) return;
      updateButtons();
      var delay = sp.isCigar ? rand(3000, 6000) : rand(1500, 3000);
      state.ashTimer = setTimeout(function () {
        try {
          if (state.phase !== PHASE.LIT) return;
          dropAsh(true);
        } catch (e) {}
      }, delay);
    } catch (e) {}
  }
  /* 掉落烟灰：auto=true 按情境判定烫手/烫嘴 */
  function dropAsh(auto) {
    try {
      if (state.ash <= 0.05 && !auto) { toast('灰还没积起来', 1200); return; }
      var sp = cigSpec(product);
      state.ash = 0;
      if (state.ashTimer) { clearTimeout(state.ashTimer); state.ashTimer = 0; }
      state.ashDrops = clamp((state.ashDrops || 0) + 1, 0, 8);
      FX.ashBurst && FX.ashBurst(sp.isCigar ? 20 : 12);
      SFX.play(sp.isCigar ? 'cigar-ash' : 'ashdrop', { vol: sp.isCigar ? 0.35 : 0.45 });
      renderButts();
      refreshCigVisual();
      if (auto) {
        var nearMouth = state.inhaling || (nowMs() - (state.lastReleaseAt || 0) < 1600);
        var kind = nearMouth ? 'mouth' : 'hand';
        var chance = sp.isCigar ? 0.55 : (nearMouth ? 0.3 : 0.34);
        if (!state.burned && Math.random() < chance) {
          later(function () { if (state.phase === PHASE.LIT) burnHurt(kind); }, 250);
        } else {
          toast(nearMouth ? '灰差点掉嘴里' : '烟灰掉了', 1000);
        }
      } else {
        toast('抖了抖灰 · 安全', 1100);
        if (ashdotEl) ashdotEl.classList.remove('on', 'mouth');
      }
    } catch (e) {}
  }
  /* 被烫到（kind: hand | mouth） */
  function burnHurt(kind) {
    try {
      kind = kind === 'mouth' ? 'mouth' : 'hand';
      stats.handBurns = (stats.handBurns || 0) + 1;
      state.burned = true;
      state.burnKind = kind;
      state.lastEvent = kind === 'mouth' ? 'burn-mouth' : 'burn-hand';
      state.throat = clamp((state.throat || 0) + (kind === 'mouth' ? 0.38 : 0.25), 0, 1);
      updateThroatDecay();
      SFX.play(kind === 'mouth' ? 'ouch-mouth' : 'ouch-hand', { vol: 0.8 });
      FX.exhaleBurst(kind === 'mouth' ? 0.75 : 0.45);
      shakeWidget();
      if (flashEl) {
        flashEl.classList.remove('on', 'mouth');
        if (kind === 'mouth') flashEl.classList.add('mouth');
        void flashEl.offsetWidth;
        flashEl.classList.add('on');
        setTimeout(function () { try { flashEl.classList.remove('on', 'mouth'); } catch (e) {} }, 800);
      }
      if (ashdotEl) {
        ashdotEl.classList.remove('mouth');
        if (kind === 'mouth') ashdotEl.classList.add('mouth');
        ashdotEl.classList.add('on');
      }
      var txt = kind === 'mouth' ? '嘶——烫到嘴了' : '嘶——烫到手了';
      toast(txt, 2400);
      if (cfg.showHints !== false) showHint(txt + '，抖灰要趁早。', '', null, 5000);
      updateChrome();
    } catch (e) {}
  }
  /* 抽猛了咳嗽（v3：3 种更真实的咳嗽音效） */
  function doCough(held) {
    try {
      state.throat = 1;
      state.strongPuffs = 0;
      state.lastEvent = 'cough';
      updateThroatDecay();
      SFX.play('cough', { vol: 0.9 });
      shakeWidget();
      FX.coughBurst ? FX.coughBurst() : FX.exhaleBurst(1.4);
      FX.puffBurst(1.2);
      var isCigar = cigSpec(product).isCigar;
      toast(isCigar ? '咳……雪茄别猛吸' : '咳…抽猛了', 2400);
      if (cfg.showHints !== false) showHint(isCigar ? '咳……雪茄不能过肺，慢点。' : '咳…抽猛了，缓一口吧。', '', null, 5000);
      updateChrome();
    } catch (e) {}
  }
  function shakeWidget() {
    try {
      if (!widgetEl) return;
      widgetEl.classList.remove('smk-shake');
      void widgetEl.offsetWidth;
      widgetEl.classList.add('smk-shake');
      setTimeout(function () { try { widgetEl.classList.remove('smk-shake'); } catch (e) {} }, 620);
    } catch (e) {}
  }
  /* 主动抖灰（安全） */
  function flickAsh() {
    try {
      if (state.phase !== PHASE.LIT) { toast('点着了再抖灰', 1200); return; }
      if (state.ash < 0.12) { toast('还没什么灰', 1200); return; }
      state.lastEvent = 'flick';
      stats.flicks = (stats.flicks || 0) + 1;
      dropAsh(false);
      checkAchievements(true);
      saveStatsSoon();
    } catch (e) {}
  }

  /* ---- v3：人生思考气泡 ---- */

  /* ---- 雪茄 ---- */
  function cutterFallbackSVG() {
    return '<svg viewBox="0 0 120 90" fill="none"><path d="M8 58 Q18 30 44 26 L96 20 Q112 18 114 30 Q116 42 100 44 L48 50 Q24 52 14 64 Z" fill="#cfd4da" stroke="#7d848d" stroke-width="3"/><circle cx="34" cy="52" r="12" fill="#3a3f46" stroke="#9aa2ab" stroke-width="3"/><circle cx="34" cy="52" r="5" fill="#9aa2ab"/><path d="M96 22 L112 10" stroke="#9aa2ab" stroke-width="5" stroke-linecap="round"/><path d="M16 66 Q30 74 52 70" stroke="#7d848d" stroke-width="4" stroke-linecap="round"/></svg>';
  }
  function cutterHTML() {
    var src = cigarCutterSrc();
    if (src) return '<img class="smk-cutter-img" src="' + escapeHtml(src) + '" alt="" draggable="false">';
    return '<svg viewBox="0 0 120 90" fill="none"><path d="M8 58 Q18 30 44 26 L96 20 Q112 18 114 30 Q116 42 100 44 L48 50 Q24 52 14 64 Z" fill="#cfd4da" stroke="#7d848d" stroke-width="3"/><circle cx="34" cy="52" r="12" fill="#3a3f46" stroke="#9aa2ab" stroke-width="3"/><circle cx="34" cy="52" r="5" fill="#9aa2ab"/><path d="M96 22 L112 10" stroke="#9aa2ab" stroke-width="5" stroke-linecap="round"/><path d="M16 66 Q30 74 52 70" stroke="#7d848d" stroke-width="4" stroke-linecap="round"/></svg>';
  }
  function cutCigar() {
    try {
      if (!isCigarProduct(product)) return false;
      if (state.phase !== PHASE.TAKEN && state.phase !== PHASE.LIT) return false;
      try { setPhase(PHASE.CUTTING); } catch (e) {}
      state.cigarCutted = true;
      state.lastEvent = 'cigar-cut';
      stats.cigarCuts = Math.max(0, Math.floor(+stats.cigarCuts || 0) + 1);
      SFX.play('cigar-cut', { vol: 0.75 });
      try {
        var cap = cigarCapStage();
        if (cutterEl && cap) {
          cutterEl.innerHTML = cutterHTML();
          try {
            var cimg = cutterEl.querySelector('img');
            if (cimg) cimg.onerror = function () { try { cimg.style.display = 'none'; } catch (e) {} try { cutterEl.innerHTML = cutterFallbackSVG(); } catch (e) {} try { noteAssetFailure(); } catch (e) {} };
          } catch (e) {}
          cutterEl.style.left = Math.round(cap.x - 34) + 'px';
          cutterEl.style.top = Math.round(cap.y - 26) + 'px';
          cutterEl.classList.remove('on');
          void cutterEl.offsetWidth;
          cutterEl.classList.add('on');
          setTimeout(function () { try { cutterEl.classList.remove('on'); } catch (e) {} if (state.phase === PHASE.CUTTING) setPhase(PHASE.TAKEN); }, 1050);
        }
      } catch (e) {}
      toast('剪茄帽 · 咔嚓', 1600);
      showHint('茄帽剪好了，点火慢烤。', '', null, 3000);
      checkAchievements(true);
      saveStatsSoon();
      return true;
    } catch (e) { return false; }
  }
  function toastCigar() {
    try {
      if (state.phase !== PHASE.TAKEN) return lightCig();
      lightCig();
      return true;
    } catch (e) { return false; }
  }
  function forceBurnMode(kind) {
    try {
      state.ash = 0.9;
      refreshCigVisual();
      if (kind === 'mouth') state.lastReleaseAt = nowMs();
      burnHurt(kind === 'mouth' ? 'mouth' : 'hand');
      return state.lastEvent;
    } catch (e) { return 'burn-hand'; }
  }

  function isLit() {
    return state.phase === PHASE.LIT || state.phase === PHASE.BURNT;
  }
  function isTaken() {
    return state.phase === PHASE.TAKEN || state.phase === PHASE.LIGHTING || state.phase === PHASE.LIT;
  }
  function clearTimers() {
    if (state.timer) { clearTimeout(state.timer); state.timer = 0; }
    if (autoTimerId) { clearInterval(autoTimerId); autoTimerId = 0; }
    if (litTickId) { clearInterval(litTickId); litTickId = 0; }
    state.seq++;
  }
  function later(fn, ms) {
    var seq = state.seq;
    state.timer = setTimeout(function () {
      if (seq !== state.seq) return;
      try { fn(); } catch (e) {}
    }, ms);
    return state.timer;
  }

  function updateHandForProduct() {
    try {
      if (!handEl) return;
      var hi = handImageFor(product);
      var img = handEl.querySelector('.smk-hand-img');
      photoHandMode = !!hi;
      if (!hi) {
        photoHandOk = false;
        if (img && img.parentNode) img.parentNode.removeChild(img);
        handEl.classList.remove('photo');
        try { if (handFrontEl) handFrontEl.style.display = ''; } catch (e) {}
        return;
      }
      if (!img) {
        img = document.createElement('img');
        img.className = 'smk-hand-img';
        img.alt = '';
        img.draggable = false;
        handEl.appendChild(img);
      }
      var key = handFormatKey(product);
      handEl.classList.remove('smk-hp-regular', 'smk-hp-slim', 'smk-hp-cigar');
      handEl.classList.add('smk-hp-' + key);
      try { layoutHandPhoto(); } catch (e) {}
      var src = img.getAttribute('src');
      if (src !== hi) {
        photoHandOk = false;
        img.setAttribute('src', hi);
        img.onload = function () {
          try { checkImageAlpha(img, function (ok) { photoHandOk = !!ok; if (!ok && img.parentNode) img.parentNode.removeChild(img); }); } catch (e) {}
          try { layoutHandPhoto(); } catch (e) {}
        };
        img.onerror = function () { try { img.style.display = 'none'; } catch (e) {} photoHandMode = false; photoHandOk = false; try { if (img.parentNode) img.parentNode.removeChild(img); } catch (e) {} layoutHandPhoto(); try { noteAssetFailure(); } catch (e) {} };
      } else if (img.complete && img.naturalWidth) {
        try { checkImageAlpha(img, function (ok) { photoHandOk = !!ok; }); } catch (e) {}
      }
      try { layoutHandPhoto(); } catch (e) {}
    } catch (e) {}
  }
  function layoutHandPhoto() {
    try {
      if (!handEl) return;
      var key = handFormatKey(product);
      var img = handEl.querySelector('.smk-hand-img');
      handEl.style.width = ''; handEl.style.height = ''; handEl.style.right = ''; handEl.style.bottom = '';
      if (!img) return;
      if (key === 'cigar' && stageEl) {
        var W = stageEl.clientWidth, H = stageEl.clientHeight;
        var nw = img.naturalWidth || 675, nh = img.naturalHeight || 1016;
        /* 竖构图 1.5:1 + 手图 rotate(6deg)：以「旋转后 bbox 高 ≤78% stage、右/下留 ≥2px」反推显示尺寸 */
        var iw = Math.round(W * 0.41), ih = Math.round(iw * nh / nw);
        img.style.setProperty('width', iw + 'px', 'important');
        img.style.setProperty('height', ih + 'px', 'important');
        handEl.style.setProperty('width', iw + 'px', 'important');
        handEl.style.setProperty('height', ih + 'px', 'important');
        handEl.style.setProperty('right', '16px', 'important');
        handEl.style.setProperty('bottom', Math.round(H * 0.43) + 'px', 'important');
        handEl.style.transformOrigin = '62% 55%';
      } else {
        img.style.width = '';
        img.style.height = '';
        handEl.style.transformOrigin = '';
      }
    } catch (e) {}
  }
  function applyProduct(p) {
    product = p;
    smokeCfg = {
      density: (p.smoke && p.smoke.density) || 1,
      color: (p.smoke && p.smoke.color) || 'warm',
      drift: (p.smoke && p.smoke.drift) || 1
    };
    state.packRemaining = productRemaining(p);
    state.cigarCutted = false;
    try {
      if (widgetEl) widgetEl.classList.toggle('smk-cigar', cigSpec(p).isCigar);
    } catch (e) {}
    renderPackView();
    refreshCigVisual();
    renderAshtrayView();
    updateHandForProduct();
    updateChrome();
    if (state.phase === PHASE.LIT) { FX.clear(); }
  }

  function setPhase(ph) {
    state.phase = ph;
    try {
      if (packWrap) packWrap.classList.toggle('smk-pack-lit', ph === PHASE.LIT || ph === PHASE.BURNT);
      try {
        if (handEl) handEl.classList.toggle('photo', photoActive());
        if (handFrontEl) handFrontEl.style.display = photoActive() ? 'none' : '';
        if (tipCoverEl) tipCoverEl.classList.toggle('on', photoActive() && (ph === PHASE.TAKEN || ph === PHASE.LIGHTING));
        var ph2 = photoActive();
        if (cigWrap) cigWrap.style.display = ph2 ? 'none' : '';
        if (lighterEl) lighterEl.style.display = ph2 ? 'none' : '';
        if (handFrontEl) handFrontEl.style.display = ph2 ? 'none' : '';
        var svgHand = handEl ? handEl.querySelector('.smk-hand-svg') : null;
        if (svgHand) svgHand.style.display = ph2 ? 'none' : '';
        updateCigLabel();
        try { updatePhotoBurn(); } catch (ePB) {}
      } catch (eH) {}
    } catch (e) {}
    updateChrome();
    updateButtons();
    if (FX) { if (ph !== PHASE.LIT) FX.setPaused(false); }
  }

  function updateChrome() {
    try {
      if (!product || !topBrandEl) return;
      var rem = state.packRemaining;
      topBrandEl.textContent = product.brand || product.name;
      topRestEl.textContent = rem > 0 ? '剩 ' + rem : '空包';
      var stat = '';
      if (state.phase === PHASE.LIT || state.phase === PHASE.BURNT) {
        var sec = Math.max(0, Math.floor((nowMs() - state.litAt) / 1000));
        if (state.inhaling) {
          var tierTxt = state.inhaleTier >= 3 ? '猛吸' : state.inhaleTier === 2 ? '中吸' : '轻吸';
          stat = '已燃 ' + fmtDur(sec) + ' · ' + tierTxt + '中…';
        } else {
          stat = '已燃 ' + fmtDur(sec) + ' · 第 ' + Math.max(1, state.puffs) + ' 口' + (state.burned ? ' · 烫' : '');
        }
      } else if (state.phase === PHASE.TAKEN || state.phase === PHASE.LIGHTING) {
        stat = (product.variant || '') + ' · 焦油 ' + product.tar + 'mg · 等你点火';
      } else if (rem <= 0) {
        stat = '这包抽完了 · 再买一包';
      } else {
        var spx = cigSpec(product);
        stat = (product.variant || '') + ' · ' + (spx.isCigar ? '雪茄 ' + Math.round(spx.diameter) + 'mm 环径' : '焦油 ' + product.tar + 'mg · ' + spx.length + 'mm');
      }
      topStatEl.textContent = stat;
      ledEl.className = 'smk-led' + (state.phase === PHASE.LIT ? ' lit' : (isTaken() ? ' on' : ''));
      if (product.pack.warningBand) topStatEl.title = '纯模拟娱乐 · 吸烟有害健康';
    } catch (e) {}
  }
  function updateButtons() {
    try {
      var ph = state.phase;
      var rem = state.packRemaining;
      if (ph === PHASE.IDLE) {
        btns.open.textContent = rem > 0 ? '开盒' : '再买一包';
        btns.open.disabled = false;
      } else if (ph === PHASE.OUT) { btns.open.textContent = '拿起来'; btns.open.disabled = false; }
      else if (ph === PHASE.TAKEN) { btns.open.textContent = isCigarProduct(product) ? '剪茄帽' : '点火'; btns.open.disabled = false; }
      else if (ph === PHASE.CUTTING) { btns.open.textContent = '剪帽中…'; btns.open.disabled = true; }
      else if (ph === PHASE.LIGHTING) { btns.open.textContent = '点火中…'; btns.open.disabled = true; }
      else if (ph === PHASE.LIT) { btns.open.textContent = '按住抽'; btns.open.disabled = false; }
      else if (ph === PHASE.BURNT || ph === PHASE.BUTT) { btns.open.textContent = '收尾…'; btns.open.disabled = true; }
      else if (ph === PHASE.BUYING) { btns.open.textContent = '补货…'; btns.open.disabled = true; }
      btns.puff.disabled = !(ph === PHASE.LIT && (state.ash || 0) > 0.12);
      btns.puff.textContent = '抖灰';
      btns.dout.disabled = !(ph === PHASE.LIT || ph === PHASE.LIGHTING);
      /* 未点烟时只留主按钮，其余按状态淡出，避免按钮太杂 */
      btns.puff.style.display = (ph === PHASE.LIT) ? '' : 'none';
      btns.dout.style.display = (ph === PHASE.LIT || ph === PHASE.LIGHTING) ? '' : 'none';
      btns.cabinet.style.display = (ph === PHASE.IDLE || ph === PHASE.OPENING || ph === PHASE.BUYING) ? 'none' : '';
      if (actionsEl) actionsEl.classList.toggle('smk-solo', ph === PHASE.IDLE || ph === PHASE.OPENING || ph === PHASE.BUYING);
    } catch (e) {}
  }

  function toast(msg, ms) {
    if (!toastEl) return;
    try {
      toastEl.textContent = msg;
      toastEl.classList.add('on');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { try { toastEl.classList.remove('on'); } catch (e) {} }, ms || 1600);
    } catch (e) {}
  }

  /* 开盒 */
  function openPack() {
    if (state.busy) return;
    if (state.packRemaining <= 0) { buyPack(); return; }
    state.busy = true;
    state.lastEvent = 'open';
    hidePackAway(false);
    showHand(false);
    setPhase(PHASE.OPENING);
    packWrap.classList.add('smk-pack-open', 'smk-opening');
    try {
      var g0 = packGeom(product);
      packWrap.classList.remove('smk-open-soft', 'smk-open-tin', 'smk-open-cigar');
      if (g0.face === 'soft') packWrap.classList.add('smk-open-soft');
      else if (g0.face === 'tin') packWrap.classList.add('smk-open-tin');
      else if (g0.face === 'cigar') packWrap.classList.add('smk-open-cigar');
      if (openFxEl) {
        openFxEl.classList.remove('on', 'smk-fx-soft', 'smk-fx-cigar');
        if (g0.face === 'cigar') openFxEl.classList.add('smk-fx-cigar');
        else if (g0.face === 'soft') openFxEl.classList.add('smk-fx-soft');
        void openFxEl.offsetWidth;
        openFxEl.classList.add('on');
      }
    } catch (e) {}
    var gface = (function () { try { return packGeom(product).face; } catch (e) { return 'hard'; } })();
    SFX.play(gface === 'soft' ? 'open-tear' : gface === 'cigar' ? 'cigar-toast' : 'open-flip', { vol: 0.6 });
    SFX.play('foil', { vol: 0.42, delay: 180 });
    later(function () {
      state.busy = false;
      setPhase(PHASE.OUT);
      /* v9：开盒香烟在盒口停留 ≥700ms 再淡出 */
      if (openFxEl) openFxEl.classList.remove('on');
      packWrap.classList.remove('smk-opening');
      layoutCig('lying');
      refreshCigVisual();
      setCigMode('lying');
      cigWrap.classList.add('smk-cig-holdable');
      packWrap.classList.remove('smk-pack-open');
      SFX.play('tap', { vol: 0.32, pitch: 1.15 });
      FX.sparks(2);
    }, rand(360, 440));
  }

  /* 取烟 → 拿起（烟盒淡出，手伸进来） */
  function takeCig() {
    if (state.busy) return;
    if (state.phase !== PHASE.OUT) return;
    if (state.packRemaining <= 0) return;
    state.busy = true;
    state.lastEvent = 'take';
    state.packRemaining = Math.max(0, state.packRemaining - 1);
    setProductRemaining(product, state.packRemaining);
    packWrap.classList.add('smk-pack-open');
    state.cigarCutted = false;
    resetCigState();
    SFX.play('take-cig', { vol: 0.55 });
    later(function () {
      if (state.packRemaining <= 0) packWrap.classList.add('smk-pack-empty');
      setPhase(PHASE.TAKEN);
      state.takeAt = nowMs();
      state.ash = 0;
      state.burned = false;
      state.strongPuffs = 0;
      refreshCigVisual();
      setCigMode('held');
      hidePackAway(true);
      showHand(true);
      var isVape = product && product.category === 'vape';
      if (isVape || photoHandMode) lighterEl.classList.remove('on');
      else lighterEl.classList.add('on');
      state.busy = false;
      SFX.play('ui', { vol: 0.4 });
      updateChrome();
      updateButtons();
      if (isVape) showHint('烟杆在手。按住烟体加热，松开吐雾。', '点火', lightCig, 6000, true);
      else showHint('夹稳了。点打火机，或者按住烟支直接抽。', '点火', lightCig, 5000, true);
    }, 430);
  }

  /* 点火 */
  function lightCig() {
    if (state.busy) return;
    if (state.phase !== PHASE.TAKEN) return;
    var sp0 = cigSpec(product);
    if (sp0.isCigar && !state.cigarCutted) {
      state.cigarCutted = true;
      state.lastEvent = 'cigar-cut';
      setPhase(PHASE.CUTTING);
      SFX.play('cigar-cut', { vol: 0.75 });
      toast('剪茄帽 · 咔嚓', 1600);
      later(function () { setPhase(PHASE.TAKEN); lightCig(); }, 760);
      return;
    }
    state.busy = true;
    state.lastEvent = sp0.isCigar ? 'cigar-light' : 'light';
    setPhase(PHASE.LIGHTING);
    var isVape = product && product.category === 'vape';
    var flame = rootEl.querySelector('#smk-flame');
    if (flame && !isVape) flame.classList.add('on');
    if (isVape) {
      SFX.play('fizz', { vol: 0.6 });
    } else if (sp0.isCigar) {
      SFX.play('cigar-toast', { vol: 0.7 });
      SFX.play('light', { vol: 0.4, delay: 320 });
    } else {
      SFX.play('lighter', { vol: 0.6 });
      SFX.play('light', { vol: 0.5, delay: 120 });
    }
    later(function () {
      if (flame) flame.classList.remove('on');
      lighterEl.classList.remove('on');
      state.busy = false;
      state.puffs = 0;
      state.litAt = nowMs();
      state.lastPuffAt = state.litAt;
      state.progress = 0;
      state.ash = 0;
      state.burned = false;
      setPhase(PHASE.LIT);
      refreshCigVisual();
      setCigMode('held');
      try { cigWrap.classList.add('smk-cig-holdable'); } catch (e) {}
      FX.sparks(3);
      SFX.startCrackle();
      startLitTicker();
      startAutoTimer();
      updateChrome();
      updateButtons();
      toast(isVape ? '雾化器开了' : (sp0.isCigar ? '雪茄点着了 · 慢慢来' : '点着了，按住烟体抽'), 1600);
      showHint(isVape ? '按住烟杆吸气，松开吐雾。' : (sp0.isCigar ? '雪茄不过肺，按住慢慢吸；灰更结实。' : '按住烟体吸气，松开吐烟；按越久烟越多。'), '', null, 6500, true);
    }, sp0.isCigar ? 1050 : 520);
  }

  function startLitTicker() {
    if (litTickId) clearInterval(litTickId);
    var lastTick = nowMs();
    litTickId = setInterval(function () {
      try {
        if (!isLit()) return;
        var now = nowMs();
        var dt = clamp((now - lastTick) / 1000, 0, 0.4);
        lastTick = now;
        if (state.phase === PHASE.LIT) {
          var sp = cigSpec(product);
          var dur = burnDurationSec();
          var elapsed = (now - state.litAt) / 1000;
          var timeProg = Math.min(0.62, elapsed / dur * 0.62);
          state.progress = Math.max(state.progress, timeProg);
          /* v5：长时间不抽自动熄灭（常规 60s / 雪茄 90s，可用 setIdleTimeout 加速/关闭） */
          var idleLimitMs = state.idleTimeoutSec > 0 ? state.idleTimeoutSec * 1000 : (sp.isCigar ? 90000 : 60000);
          var lastAct = state.lastPuffAt || state.litAt || now;
          if (!state.inhaling && now - lastAct > idleLimitMs) {
            state.lastEvent = 'auto-extinguish';
            try { extinguish(true); } catch (e) {}
            toast(sp.isCigar ? '雪茄自己灭了' : '烟自己灭了', 2200);
            return;
          }
          /* v4：燃烧连续化——即便不抽，灰也缓慢生长（雪茄更慢更结实） */
          var idleRate = sp.isCigar ? 0.0035 : 0.009;
          state.ash = clamp(state.ash + idleRate * dt, 0, 1);
          if (state.ash > 0.7 && Math.random() < 0.10) { try { FX.ashBurst(2); } catch (e) {} }
          if (!state.busy) refreshCigVisual();
        }
        updateChrome();
      } catch (e) {}
    }, 120);
  }
  function startAutoTimer() {
    if (autoTimerId) clearInterval(autoTimerId);
    autoTimerId = setInterval(function () {
      try {
        if (!isLit() || state.phase !== PHASE.LIT) return;
        if (!state.autoOn) return;
        if (nowMs() - state.lastPuffAt >= state.autoSec * 1000) doPuff(rand(700, 1800));
      } catch (e) {}
    }, 500);
  }
  function burnDurationSec() {
    return Math.max(24, (product ? product.burnPuffs : 10) * 2 + 20);
  }

  /* 程序化「轻吸一口」（菜单/自动抽/QA 用）：按住 ms 毫秒后松开 */
  var simPuffTimer = 0;
  function doPuff(ms) {
    try {
      if (state.phase !== PHASE.LIT) return;
      if (state.inhaling) { endInhale('puff-toggle'); return; }
      startInhale('api');
      if (simPuffTimer) clearTimeout(simPuffTimer);
      simPuffTimer = setTimeout(function () {
        try { if (state.inhaling) endInhale('sim-puff-timer'); } catch (e) {}
      }, clamp(ms || 900, 300, 9000));
    } catch (e) {}
  }

  function extinguish(auto) {
    if (state.phase !== PHASE.LIT && state.phase !== PHASE.LIGHTING) return;
    if (state.busy && !auto) return;
    var wasLighting = state.phase === PHASE.LIGHTING;
    state.lastEvent = 'putout';
    /* 正在吸气就先松开 */
    if (state.inhaling) {
      state.inhaling = false;
      if (state.inhaleTimer) { clearInterval(state.inhaleTimer); state.inhaleTimer = 0; }
      if (cigWrap) { cigWrap.classList.remove('inhaling'); cigWrap.style.transform = ''; }
      updateIntensity(0);
    }
    state.busy = true;
    setPhase(PHASE.BURNT);
    SFX.stopCrackle();
    if (wasLighting) {
      var flame = rootEl.querySelector('#smk-flame');
      if (flame) flame.classList.remove('on');
      lighterEl.classList.remove('on');
    }
    SFX.play('puff', { vol: 0.25, pitch: 0.8 });
    FX.sparks(2);
    /* 手把烟按向烟灰缸 */
    later(function () {
      state.busy = false;
      setPhase(PHASE.BUTT);
      try {
        if (handEl) { handEl.classList.remove('inhale'); handEl.classList.add('press'); }
        if (handFrontEl) { handFrontEl.classList.remove('inhale'); handFrontEl.classList.add('press'); }
        cigWrap.style.transition = 'transform .6s cubic-bezier(.45,.05,.55,.95), opacity .6s, top .6s, left .6s';
        cigWrap.style.transform = 'rotate(-46deg) translate(-64px, 74px)';
        cigWrap.style.opacity = '0.55';
      } catch (e) {}
      SFX.play('butt', { vol: 0.55 });
      later(function () {
        try {
          cigWrap.style.opacity = '0';
          if (handEl) { handEl.classList.remove('press'); handEl.classList.add('off'); }
          if (handFrontEl) { handFrontEl.classList.remove('press'); handFrontEl.classList.add('off'); }
        } catch (e) {}
        later(function () {
          finalizeCig();
        }, 420);
      }, 520);
    }, 300);
  }

  function achievementDefs() {
    function P(cur, target) { return { cur: Math.max(0, cur | 0), target: target }; }
    function dayStreak() {
      var n = 0, d = new Date();
      for (var k = 0; k < 30; k++) {
        var key = dayKeyOffset(-k);
        var day = stats.days[key];
        if (day && (day.smoked || 0) > 0) n++;
        else if (k > 0) break;
      }
      return n;
    }
    function kindsCount() { return Object.keys(stats.products || {}).length; }
    function hasFmt(fmt) {
      var keys = stats.products || {};
      for (var id in keys) {
        if (!Object.prototype.hasOwnProperty.call(keys, id)) continue;
        if ((keys[id].smoked || 0) <= 0) continue;
        var p = findProduct(id);
        try { if (cigSpec(p).fmt === fmt) return true; } catch (e) {}
      }
      return false;
    }
    return [
      { key: 'first', icon: '🚬', name: '第一根', desc: '抽完第一支', progress: function () { return P(totalSmoked(), 1); }, test: function () { return totalSmoked() >= 1; } },
      { key: 'wholepack', icon: '📦', name: '一整包', desc: '累计抽完 20 支', progress: function () { return P(totalSmoked(), 20); }, test: function () { return totalSmoked() >= 20; } },
      { key: 'streak5', icon: '🔥', name: '五连抽', desc: '连着抽 5 支', progress: function () { return P((stats.streak && stats.streak.best) || 0, 5); }, test: function () { return ((stats.streak && stats.streak.best) || 0) >= 5; } },
      { key: 'collector', icon: '⭐', name: '收藏家', desc: '抽过 10 个品牌', progress: function () { return P(distinctBrands(), 10); }, test: function () { return distinctBrands() >= 10; } },
      { key: 'night', icon: '🌙', name: '深夜烟民', desc: '凌晨 0-5 点来一支虚拟烟', progress: function () { return P(stats.nightSmokes || 0, 1); }, test: function () { return (stats.nightSmokes || 0) >= 1; } },
      { key: 'quitfail', icon: '😮‍💨', name: '戒烟失败者', desc: '一天抽了 10 支', progress: function () { var t = stats.days[todayKey()]; return P((t && t.smoked) || 0, 10); }, test: function () { var t = stats.days[todayKey()]; return !!(t && t.smoked >= 10); } },
      { key: 'slim1', icon: '🪶', name: '细支初体验', desc: '抽完第一支细支', progress: function () { return P(hasFmt('slim') ? 1 : 0, 1); }, test: function () { return hasFmt('slim'); } },
      { key: 'cigar1', icon: '🍂', name: '雪茄入门', desc: '抽完第一支雪茄', progress: function () { return P(stats.cigars || 0, 1); }, test: function () { return (stats.cigars || 0) >= 1; } },
      { key: 'opens10', icon: '📬', name: '拆包达人', desc: '开盒 10 次', progress: function () { return P(stats.opens || 0, 10); }, test: function () { return (stats.opens || 0) >= 10; } },
      { key: 'total50', icon: '🏭', name: '老烟枪', desc: '累计抽完 50 支', progress: function () { return P(totalSmoked(), 50); }, test: function () { return totalSmoked() >= 50; } },
      { key: 'day20', icon: '💀', name: '一天一包', desc: '单日抽 20 支', progress: function () { var t = stats.days[todayKey()]; return P((t && t.smoked) || 0, 20); }, test: function () { var t = stats.days[todayKey()]; return !!(t && t.smoked >= 20); } },
      { key: 'brands20', icon: '🗂', name: '烟标收藏', desc: '抽过 20 个品牌', progress: function () { return P(distinctBrands(), 20); }, test: function () { return distinctBrands() >= 20; } },
      { key: 'burn1', icon: '🤕', name: '第一次烫手', desc: '被烫到手或嘴 1 次', progress: function () { return P(stats.handBurns || 0, 1); }, test: function () { return (stats.handBurns || 0) >= 1; } },
      { key: 'flick10', icon: '🌫', name: '弹灰高手', desc: '成功抖灰 10 次', progress: function () { return P(stats.flicks || 0, 10); }, test: function () { return (stats.flicks || 0) >= 10; } },
      { key: 'days3', icon: '📅', name: '三日之约', desc: '连续 3 天来一支虚拟烟', progress: function () { return P(dayStreak(), 3); }, test: function () { return dayStreak() >= 3; } },
      { key: 'kinds10', icon: '🎯', name: '尝百草', desc: '抽过 10 种不同的烟', progress: function () { return P(kindsCount(), 10); }, test: function () { return kindsCount() >= 10; } },
      { key: 'cigarcut', icon: '✂️', name: '剪茄帽', desc: '第一次剪雪茄帽', progress: function () { return P(stats.cigarCuts || 0, 1); }, test: function () { return (stats.cigarCuts || 0) >= 1; } },
      { key: 'late2', icon: '🕑', name: '凌晨两点', desc: '凌晨 1-4 点来一支虚拟烟', progress: function () { return P(stats.late2 || 0, 1); }, test: function () { return (stats.late2 || 0) >= 1; } }
    ];
  }
  function totalSmoked() { return (stats.total && stats.total.smoked) || 0; }
  function distinctBrands() {
    var set = {};
    var keys = stats.products || {};
    for (var id in keys) {
      if (!Object.prototype.hasOwnProperty.call(keys, id)) continue;
      var p = findProduct(id);
      set[p ? p.brand : id] = 1;
    }
    return Object.keys(set).length;
  }
  function checkAchievements(showToast) {
    try {
      var got = [];
      var defs = achievementDefs();
      for (var i = 0; i < defs.length; i++) {
        var d = defs[i];
        if (stats.achievements[d.key]) continue;
        if (d.test()) {
          stats.achievements[d.key] = nowMs();
          got.push(d);
        }
      }
      if (got.length && showToast) {
        got.forEach(function (d, idx) {
          setTimeout(function () {
            try {
              toast('🏅 成就解锁 · ' + d.name, 2400);
              SFX.play('chime', { vol: 0.3 });
            } catch (e) {}
          }, idx * 2600);
        });
      }
      return got;
    } catch (e) { return []; }
  }

  function finalizeCig() {
    try {
      var now = nowMs();
      var smokedSec = Math.max(1, Math.round((now - (state.litAt || now)) / 1000));
      var day = stats.days[todayKey()] || (stats.days[todayKey()] = { smoked: 0, puffs: 0, seconds: 0, products: {} });
      if (!day.products) day.products = {};
      day.smoked += 1;
      day.puffs += state.puffs || 0;
      day.seconds += smokedSec;
      day.products[product.id] = (day.products[product.id] || 0) + 1;
      if (!stats.total) stats.total = { smoked: 0, puffs: 0, seconds: 0 };
      stats.total.smoked += 1;
      stats.total.puffs += state.puffs || 0;
      stats.total.seconds += smokedSec;
      if (!stats.products) stats.products = {};
      var pr = stats.products[product.id] || (stats.products[product.id] = { smoked: 0, puffs: 0, seconds: 0 });
      pr.smoked += 1; pr.puffs += state.puffs || 0; pr.seconds += smokedSec;
      /* 连抽 */
      var prev = stats.streak || { count: 0, last: 0, best: 0 };
      if (prev.last && now - prev.last < 3 * 60 * 1000) prev.count += 1;
      else prev.count = 1;
      prev.last = now;
      prev.best = Math.max(prev.best || 0, prev.count);
      stats.streak = prev;
      stats.updatedAt = now;
      stats.buttCount = Math.max(0, Math.floor(+stats.buttCount || 0) + 1);
      try {
        var hr = new Date().getHours();
        if (cigSpec(product).isCigar) stats.cigars = (stats.cigars || 0) + 1;
        if (hr >= 0 && hr < 5) stats.nightSmokes = (stats.nightSmokes || 0) + 1;
        if (hr >= 1 && hr < 4) stats.late2 = (stats.late2 || 0) + 1;
      } catch (e) {}
      renderButts();
      checkAchievements(true);
      saveStatsSoon();
    } catch (e) {}
    state.busy = false;
    try {
      cigWrap.style.transition = 'opacity .3s';
      cigWrap.style.opacity = '0';
      cigWrap.style.transform = '';
      cigWrap.classList.remove('smk-show', 'smk-cig-lying', 'smk-cig-held', 'smk-cig-holdable', 'inhaling');
    } catch (e) {}
    /* v2：收起手、清掉本根的灰/烫痕、烟盒淡入回来 */
    showHand(false);
    resetCigState();
    try { cigWrap.style.transition = ''; } catch (e) {}
    hidePackAway(false);
    refreshCigVisual();
    updateButtons();
    updateChrome();
    if (state.packRemaining <= 0) {
      packWrap.classList.add('smk-pack-empty');
      setPhase(PHASE.IDLE);
      updateButtons();
      toast('这包抽完了，点「再买一包」', 2600);
      showHint('二十支，说多不多。空了就去烟柜再拿一包。', '再买一包', buyPack, 6000, true);
    } else {
      setPhase(PHASE.IDLE);
      updateButtons();
    }
    updateChrome();
  }

  function buyPack() {
    if (state.busy) return;
    if (state.phase !== PHASE.IDLE) return;
    state.busy = true;
    state.lastEvent = 'buy';
    hidePackAway(false);
    showHand(false);
    resetCigState();
    setPhase(PHASE.BUYING);
    SFX.play('tap', { vol: 0.5 });
    try {
      packWrap.classList.remove('smk-pack-empty');
      packWrap.classList.add('smk-pack-open');
    } catch (e) {}
    later(function () {
      state.packRemaining = PACK_SIZE;
      setProductRemaining(product, PACK_SIZE);
      if (stats) stats.packOpened = (stats.packOpened || 0) + 1;
      saveStatsSoon();
      state.busy = false;
      stats.opens = (stats.opens || 0) + 1;
      checkAchievements(true);
      saveStatsSoon();
      setPhase(PHASE.IDLE);
      try { packWrap.classList.remove('smk-pack-open'); } catch (e) {}
      SFX.play('tap', { vol: 0.6, pitch: 1.08 });
      toast('新的一包 · 20 支', 1800);
      updateChrome();
    }, 850);
  }

  /* 换烟 */
  function switchProduct(id, silent) {
    var p = findProduct(id);
    if (!p) return false;
    if (product && p.id === product.id && state.phase !== PHASE.IDLE) return false;
    clearTimers();
    state.busy = false;
    state.puffs = 0;
    state.progress = 0;
    state.litAt = 0;
    state.lastEvent = 'switch';
    hidePackAway(false);
    showHand(false);
    resetCigState();
    try { SFX.stopCrackle(); } catch (e) {}
    FX.setPaused(false);    try {
      cigWrap.classList.remove('smk-show', 'smk-cig-lying', 'smk-cig-held', 'smk-cig-holdable');
      cigWrap.style.opacity = '0';
      lighterEl.classList.remove('on');
      packWrap.classList.remove('smk-pack-empty', 'smk-pack-open');
      packWrap.style.opacity = '0';
      packWrap.style.transform = 'translateX(-50%) translateY(8px) rotate(-2.5deg)';
    } catch (e) {}
    cfg.lastProductId = p.id;
    saveConfigSoon();
    setTimeout(function () {
      try {
        cfg.lastProductId = p.id;
        applyProduct(p);
        renderButts();
        packWrap.style.opacity = '';
        packWrap.style.transform = '';
        setPhase(PHASE.IDLE);
        refreshCigVisual();
        if (!silent) { toast('换成了 ' + (p.brand || p.name), 1600); SFX.play('ui', { vol: 0.4 }); }
        checkAchievements(false);
      } catch (e) {}
    }, 260);
    return true;
  }

  function resolveInitialProduct() {
    var list = brands.products;
    var p = findProduct(cfg.lastProductId);
    if (!p) p = list[Math.floor(Math.random() * list.length)] || list[0];
    return p;
  }

  /* 烟支 / 烟盒 / 打火机点击 */
  function bindSceneEvents() {
    try {
      /* v5：补上 ☰ / ✕ 的点击事件（之前只有 DOM 没有监听） */
      var btnMenu = rootEl.querySelector('#smk-btn-menu');
      if (btnMenu) btnMenu.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        SFX.unlock();
        if (menuOpen) closeMenu(); else openMenu();
      });
      var btnHide = rootEl.querySelector('#smk-btn-hide');
      if (btnHide) btnHide.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        hideWidget();
      });
      packWrap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.phase === PHASE.IDLE) {
          if (state.packRemaining > 0) openPack(); else buyPack();
        } else if (state.phase === PHASE.OUT) {
          takeCig();
        }
      });
      /* v2：按住烟体 = 吸气；松开 = 吐烟 */
      cigWrap.addEventListener('pointerdown', function (e) {
        if (state.phase !== PHASE.LIT) return;
        e.preventDefault();
        e.stopPropagation();
        try { cigWrap.setPointerCapture(e.pointerId); } catch (err) {}
        SFX.unlock();
        startInhale('cig');
      });
      cigWrap.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.phase === PHASE.OUT) takeCig();
        else if (state.phase === PHASE.TAKEN) lightCig();
      });
      lighterEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.phase === PHASE.TAKEN) lightCig();
      });
      ashtrayEl.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state.phase === PHASE.LIT) flickAsh();
        else toast(stats.buttCount ? '缸里有 ' + stats.buttCount + ' 个烟蒂了' : '烟灰缸挺干净', 1400);
      });
      /* 按住主按钮也能吸气 */
      btns.open.addEventListener('pointerdown', function (e) {
        if (state.phase !== PHASE.LIT) return;
        e.preventDefault();
        SFX.unlock();
        startInhale('btn');
      });
      actionsEl.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn) return;
        var act = btn.getAttribute('data-act');
        if (act === 'open') {
          if (state.phase === PHASE.IDLE) { state.packRemaining > 0 ? openPack() : buyPack(); }
          else if (state.phase === PHASE.OUT) takeCig();
          else if (state.phase === PHASE.TAKEN) lightCig();
        } else if (act === 'flick') flickAsh();
        else if (act === 'dout') extinguish();
        else if (act === 'cabinet') openPanel('cabinet');
      });
      /* 松开指针 = 结束吸气 */
      document.addEventListener('pointerup', function () {
        try { if (state.inhaling) endInhale('doc-up'); } catch (e) {}
      }, true);
      document.addEventListener('pointercancel', function () {
        try { if (state.inhaling) endInhale('doc-cancel'); } catch (e) {}
      }, true);
      document.addEventListener('keydown', function (e) {
        try {
          if (e.key === 'Escape') {
            if (menuOpen) { closeMenu(); return; }
            if (ui.panel) { closePanel(); return; }
            if (hintState.on) hideHint();
          }
          if (e.key === ' ' || e.code === 'Space') {
            var ae = document.activeElement;
            var editing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable || (ae.getAttribute && ae.getAttribute('contenteditable') === 'true'));
            if (editing) return;
            if (!isLit()) return;
            e.preventDefault();
            if (e.repeat) return;
            startInhale('space');
          }
        } catch (err) {}
      });
      document.addEventListener('keyup', function (e) {
        try {
          if ((e.key === ' ' || e.code === 'Space') && state.inhaling) {
            e.preventDefault();
            endInhale();
          }
        } catch (err) {}
      });
      /* 右键 / 长按 */
      widgetEl.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      });
      var lpTimer = 0, lpStart = null;
      widgetEl.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.target && e.target.closest && e.target.closest('button')) return;
        lpStart = { x: e.clientX, y: e.clientY, t: nowMs() };
        clearTimeout(lpTimer);
        lpTimer = setTimeout(function () {
          if (!lpStart) return;
          openMenu(lpStart.x, lpStart.y);
          lpStart = null;
        }, 620);
      });
      widgetEl.addEventListener('pointermove', function (e) {
        if (!lpStart) return;
        if (Math.abs(e.clientX - lpStart.x) > 8 || Math.abs(e.clientY - lpStart.y) > 8) {
          clearTimeout(lpTimer);
          lpStart = null;
        }
      });
      widgetEl.addEventListener('pointerup', function () { clearTimeout(lpTimer); lpStart = null; });
      widgetEl.addEventListener('pointercancel', function () { clearTimeout(lpTimer); lpStart = null; });
    } catch (e) {}
  }

  /* ==========================================================================
   * 15. 拖拽 / 缩放 / 吸附 / 隐藏 / 配置应用
   * ========================================================================*/

  /* ==========================================================================
   * 10. 音效（懒加载 / 首次手势后创建 AudioContext / 缺失静默）
   * ========================================================================*/
  var SFX = (function () {
    var NAMES = ['tap', 'lighter', 'light', 'puff', 'exhale', 'crackle', 'butt', 'ui', 'chime', 'fizz',
      'cough', 'ouch', 'ashdrop', 'pack-open', 'foil', 'pick', 'ouch-hand', 'ouch-mouth',
      'cigar-cut', 'cigar-light', 'cigar-puff', 'cigar-ash', 'open-flip', 'open-tear', 'take-cig', 'cigar-toast'];
    var FALLBACK = {
      'pack-open': 'open-flip', foil: 'foil', pick: 'take-cig',
      'ouch-hand': 'ouch', 'ouch-mouth': 'ouch',
      'cigar-cut': 'tap', 'cigar-light': 'cigar-toast', 'cigar-puff': 'puff',
      'cigar-ash': 'ashdrop', 'cigar-toast': 'light',
      'open-flip': 'pack-open', 'open-tear': 'pack-open', 'take-cig': 'pick'
    };
    var ctx = null, raw = {}, buffers = {}, loading = {}, unlocked = false, crackle = null, failed = {};
    function master() {
      try { return cfg.soundOn === false ? 0 : clamp(cfg.volume == null ? 0.7 : cfg.volume, 0, 1); }
      catch (e) { return 0.7; }
    }
    function urlFor(name) {
      if (IS_PREVIEW || location.protocol === 'file:') return '../plugin/assets/audio/' + name + '.wav';
      return '/smoke/audio/' + name + '.wav';
    }
    function resolveName(name) {
      try { if (buffers[name]) return name; var f = FALLBACK[name]; if (f && buffers[f]) return f; } catch (e) {}
      return null;
    }
    function prefetch() {
      if (IS_PREVIEW && location.protocol === 'file:') return;
      NAMES.forEach(function (name) {
        if (raw[name] || loading[name]) return;
        loading[name] = 1;
        try {
          fetch(urlFor(name), { cache: 'force-cache' }).then(function (r) {
            if (!r || !r.ok) throw new Error('no audio');
            return r.arrayBuffer();
          }).then(function (b) { raw[name] = b; if (unlocked) decode(name); })
            .catch(function () { failed[name] = 1; });
        } catch (e) { failed[name] = 1; }
      });
    }
    function ensureCtx() {
      if (ctx) return ctx;
      try { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
      catch (e) { ctx = null; }
      return ctx;
    }
    function decode(name) {
      if (buffers[name] || !raw[name] || !ctx) return;
      try {
        var ab = raw[name];
        var pr = ctx.decodeAudioData(ab.slice(0), function (buf) { try { buffers[name] = buf; } catch (e) {} }, function () { failed[name] = 1; });
        if (pr && pr.then) pr.then(function (buf) { buffers[name] = buf; }, function () { failed[name] = 1; });
      } catch (e) { failed[name] = 1; }
    }
    function unlock() {
      if (unlocked) { try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) {} return; }
      unlocked = true;
      ensureCtx();
      if (!ctx) return;
      try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
      NAMES.forEach(function (n) { if (raw[n]) decode(n); });
      prefetch();
      if (isLit()) startCrackle();
    }
    function play(name, opt) {
      opt = opt || {};
      try {
        name = resolveName(name);
        if (!name || !ctx || !buffers[name] || master() <= 0) return;
        if (cfg.soundOn === false) return;
        var g = ctx.createGain();
        g.gain.value = clamp((opt.vol == null ? 1 : opt.vol) * master(), 0, 1);
        var src = ctx.createBufferSource();
        src.buffer = buffers[name];
        if (opt.rate) src.playbackRate.value = clamp(opt.rate, 0.6, 1.6);
        if (opt.pitch) src.playbackRate.value = clamp(opt.pitch, 0.6, 1.6);
        src.connect(g); g.connect(ctx.destination);
        var start = function () { try { src.start(0); } catch (e) {} };
        if (opt.delay) setTimeout(start, opt.delay); else start();
      } catch (e) {}
    }
    function startCrackle() {
      try {
        if (!ctx || !buffers.crackle || master() <= 0 || cfg.soundOn === false) return;
        stopCrackle();
        var src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buffers.crackle; src.loop = true; g.gain.value = 0.055 * master();
        src.connect(g); g.connect(ctx.destination);
        try { src.start(0); } catch (e) {}
        crackle = { src: src, gain: g };
      } catch (e) {}
    }
    function stopCrackle() {
      try { if (crackle) { crackle.src.stop(); crackle.src.disconnect(); crackle.gain.disconnect(); } } catch (e) {}
      crackle = null;
    }
    function suspend() { try { stopCrackle(); if (ctx && ctx.state === 'running') ctx.suspend(); } catch (e) {} }
    function resume() { try { if (ctx && ctx.state === 'suspended') ctx.resume(); } catch (e) {} if (isLit()) startCrackle(); }
    function setVolume() { try { if (crackle && crackle.gain) crackle.gain.gain.value = 0.055 * master(); } catch (e) {} }
    function status() {
      var decoded = [], failedNames = [], pending = [];
      for (var i = 0; i < NAMES.length; i++) {
        var n = NAMES[i];
        if (buffers[n]) decoded.push(n); else if (failed[n]) failedNames.push(n); else pending.push(n);
      }
      return { unlocked: unlocked, hasCtx: !!ctx, decoded: decoded, failed: failedNames, pending: pending, urls: NAMES.map(urlFor) };
    }
    return {
      prefetch: prefetch, unlock: unlock, play: play, startCrackle: startCrackle, stopCrackle: stopCrackle,
      suspend: suspend, resume: resume, setVolume: setVolume, status: status, NAMES: NAMES
    };
  })();

  /* ==========================================================================
   * 11. 宿主 API（/smoke/*）与 localStorage 降级
   * ========================================================================*/
  var API = {
    request: function (method, path, body, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var done = false, to = 0;
        function finish(fn, v) { if (done) return; done = true; if (to) clearTimeout(to); fn(v); }
        try {
          if (!window.fetch) { finish(reject, new Error('no fetch')); return; }
          if (IS_PREVIEW && location.protocol !== 'http:' && location.protocol !== 'https:') { finish(reject, new Error('preview')); return; }
          var opt = { method: method, cache: 'no-store', headers: {} };
          if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
          to = setTimeout(function () { finish(reject, new Error('timeout')); }, timeoutMs || 5000);
          fetch(path, opt).then(function (r) {
            return r.text().then(function (text) {
              if (!r.ok) { finish(reject, new Error('http ' + r.status)); return; }
              var data = null;
              try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
              finish(resolve, data || {});
            });
          }).catch(function (err) { finish(reject, err); });
        } catch (e) { finish(reject, e); }
      });
    },
    get: function (path, timeout) { return API.request('GET', path, undefined, timeout); },
    put: function (path, body) { return API.request('PUT', path, body, 6000); },
    post: function (path, body) { return API.request('POST', path, body, 6000); }
  };
  function loadLocalJSON(key) {
    try { var raw = store.get(key); if (!raw) return null; var v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; }
    catch (e) { return null; }
  }
  function saveLocalJSON(key, value) { try { store.set(key, JSON.stringify(value)); } catch (e) {} }
  function normalizeConfig(c) {
    var out = deepMerge(DEFAULT_CONFIG, c || {});
    out.version = 1;
    if (!Array.isArray(out.favorites)) out.favorites = [];
    if (!out.packs || typeof out.packs !== 'object') out.packs = {};
    out.scale = clamp(+out.scale || 1, SCALE_MIN, SCALE_MAX);
    out.volume = clamp(+out.volume, 0, 1);
    if (!isFinite(out.volume)) out.volume = 0.7;
    out.autoPuffSec = clamp(+out.autoPuffSec || 6, 3, 20);
    out.density = clamp(+out.density || 1, 0.6, 1.6);
    out.cabinetW = clamp(+out.cabinetW || 560, 380, 760);
    return out;
  }
  function normalizeStats(s) {
    var out = deepMerge(DEFAULT_STATS, s || {});
    if (!out.days || typeof out.days !== 'object') out.days = {};
    if (!out.total || typeof out.total !== 'object') out.total = { smoked: 0, puffs: 0, seconds: 0 };
    out.total.smoked = +out.total.smoked || 0;
    out.total.puffs = +out.total.puffs || 0;
    out.total.seconds = +out.total.seconds || 0;
    if (!out.products || typeof out.products !== 'object') out.products = {};
    if (!out.achievements || typeof out.achievements !== 'object') out.achievements = {};
    if (!out.streak || typeof out.streak !== 'object') out.streak = { count: 0, last: 0, best: 0 };
    out.packOpened = +out.packOpened || 0;
    ['opens','flicks','handBurns','cigars','cigarCuts','nightSmokes','late2'].forEach(function (k) { out[k] = Math.max(0, Math.floor(+out[k] || 0)); });
    out.buttCount = Math.max(0, Math.floor(+out.buttCount || 0));
    if (!out.createdAt) out.createdAt = nowMs();
    return out;
  }
  var saveConfigSoon = debounce(function () { persistConfig(); }, 500);
  var saveStatsSoon = debounce(function () { persistStats(); }, 700);
  function persistConfig() {
    try {
      var copy = deepMerge({}, cfg);
      saveLocalJSON(CFG_KEY, copy);
      if (host.mode === 'host') {
        API.put('/smoke/config.json', copy).catch(function () { if (host.mode !== 'preview') host.mode = 'preview'; });
      }
    } catch (e) {}
  }
  function persistStats() {
    try {
      var copy = normalizeStats(stats);
      copy.updatedAt = nowMs();
      saveLocalJSON(STATS_KEY, copy);
      stats = copy;
      if (host.mode === 'host') API.put('/smoke/stats.json', copy).catch(function () {});
    } catch (e) {}
  }
  function loadData(cb) {
    var localCfg = loadLocalJSON(CFG_KEY), localStats = loadLocalJSON(STATS_KEY);
    cfg = normalizeConfig(localCfg || {});
    stats = normalizeStats(localStats || {});
    var settled = false;
    function done() {
      if (settled) return;
      settled = true;
      cfg = normalizeConfig(cfg);
      stats = normalizeStats(stats);
      try { readBrandData(); } catch (e) {}
      if (cb) cb();
    }
    if (IS_PREVIEW && location.protocol === 'file:') { host.mode = 'preview'; done(); return; }
    var guard = setTimeout(function () { if (!settled) { host.mode = 'preview'; done(); } }, 2600);
    API.get('/smoke/config.json').then(function (res) {
      host.mode = 'host';
      try { if (res && res.config) cfg = normalizeConfig(deepMerge(cfg, res.config)); } catch (e) {}
      return API.get('/smoke/stats.json').then(function (sres) {
        try { if (sres && sres.stats && Object.keys(sres.stats).length) stats = normalizeStats(deepMerge(stats, sres.stats)); } catch (e) {}
      }).catch(function () {});
    }).catch(function (err) { host.mode = 'preview'; host.lastError = err && err.message ? err.message : 'unavailable'; })
      .then(function () { clearTimeout(guard); if (!settled) { if (host.mode !== 'host') host.mode = 'preview'; done(); } });
  }
  function resetData(what) {
    var doLocal = function () {
      try {
        if (what === 'stats' || what === 'all') { stats = normalizeStats({}); saveLocalJSON(STATS_KEY, stats); store.remove(STATS_KEY); }
        if (what === 'config' || what === 'all') { cfg = normalizeConfig({}); saveLocalJSON(CFG_KEY, cfg); store.remove(CFG_KEY); }
      } catch (e) {}
    };
    if (host.mode === 'host') {
      API.post('/smoke/reset.json', { what: what }).then(function () { doLocal(); location.reload(); })
        .catch(function () { doLocal(); location.reload(); });
    } else { doLocal(); location.reload(); }
  }

  /* ==========================================================================
   * 12. 任务状态轮询与等待联动
   * ========================================================================*/
  var turn = {
    running: false, since: 0, sessionTitle: '', waiting: null,
    prevRunning: false, hintShownTurn: 0, hintShownWaiting: false,
    lastPoll: 0, pollTimer: 0, clockTimer: 0, idleSince: 0, hintTick: 0
  };
  function mockState() {
    try {
      if (typeof window.__SMOKE_MOCK_STATE === 'function') return window.__SMOKE_MOCK_STATE();
      if (window.__SMOKE_MOCK_STATE && typeof window.__SMOKE_MOCK_STATE === 'object') return window.__SMOKE_MOCK_STATE;
    } catch (e) {}
    return null;
  }
  function pollState() {
    try {
      if (document.hidden) return;
      if (host.mode === 'preview' || IS_PREVIEW) { var m = mockState(); if (m) applyTurnState(m); return; }
      API.get('/smoke/state.json', 4000).then(function (res) { if (res && res.ok) applyTurnState(res); })
        .catch(function () { var m2 = mockState(); if (m2) applyTurnState(m2); });
    } catch (e) {}
  }
  function applyTurnState(res) {
    try {
      var wasRunning = turn.running, now = nowMs();
      var running = !!(res && res.turn && res.turn.running);
      var since = (res && res.turn && +res.turn.since) || 0;
      var waiting = (res && res.waiting && (res.waiting.kind || res.waiting)) || null;
      turn.running = running; turn.since = running ? since : 0;
      turn.sessionTitle = (res && res.turn && res.turn.sessionTitle) || '';
      turn.waiting = waiting; turn.lastPoll = now;
      if (running && !wasRunning) {
        turn.prevRunning = true; turn.hintShownTurn = 0; turn.hintShownWaiting = false; turn.idleSince = now;
      }
      if (waiting && !turn.hintShownWaiting) {
        turn.hintShownWaiting = true;
        if (cfg.showHints !== false) showHint('老哥在等你回话 · 先虚拟顶一下？', '虚拟顶一下', hintStartSmoke, 9000);
      }
      if (!running && wasRunning) { turn.prevRunning = false; onTurnEnded(); }
      updateTurnBar();
    } catch (e) {}
  }
  function onTurnEnded() {
    try {
      var today = (stats.days && stats.days[todayKey()] && stats.days[todayKey()].smoked) || 0;
      if (isLit()) {
        if (cfg.showHints !== false) showHint('任务跑完了，掐了这根？', '掐灭', function () { extinguish(); }, 9000);
      } else {
        if (cfg.showHints !== false) showHint('跑完了 · 再来一支虚拟烟？', '虚拟顶一下', hintStartSmoke, 7000);
        SFX.play('chime', { vol: 0.22 });
      }
    } catch (e) {}
  }
  function hintStartSmoke() {
    try {
      if (isLit()) return;
      if (state.phase === PHASE.IDLE) { if (state.packRemaining > 0) openPack(); else buyPack(); }
      else if (state.phase === PHASE.OUT) takeCig();
    } catch (e) {}
  }
  function updateTurnBar() {
    try {
      if (!turnBar) return;
      var show = turn.running || !!turn.waiting;
      turnBar.classList.toggle('on', show);
      if (!show) return;
      if (turn.running) {
        var sec = Math.max(0, Math.floor((nowMs() - turn.since) / 1000));
        turnTxt.textContent = turn.waiting ? '老哥在等你回话' : '任务在跑';
        turnClock.textContent = fmtDur(sec);
        turnBar.title = (turn.sessionTitle ? turn.sessionTitle + ' · ' : '') + '已等 ' + fmtDur(sec);
      } else {
        turnTxt.textContent = '老哥在等你回话';
        turnClock.textContent = '·';
      }
    } catch (e) {}
  }
  function startStateTimers() {
    if (turn.pollTimer) clearInterval(turn.pollTimer);
    turn.pollTimer = setInterval(function () { try { pollState(); } catch (e) {} }, 3000);
    if (turn.clockTimer) clearInterval(turn.clockTimer);
    turn.clockTimer = setInterval(function () {
      try {
        updateTurnBar();
        if (turn.running && !isTaken() && cfg.showHints !== false) {
          var runningMs = nowMs() - turn.since;
          if (runningMs > 20000 && turn.hintShownTurn !== turn.since) {
            turn.hintShownTurn = turn.since;
            showHint('任务还在跑，虚拟顶一下？', '虚拟顶一下', hintStartSmoke, 0);
          } else if (runningMs > 20000 && !hintState.on && nowMs() - (turn.hintTick || 0) > 45000) {
            turn.hintTick = nowMs();
            showHint('任务还在跑，虚拟顶一下？', '虚拟顶一下', hintStartSmoke, 0);
          }
        }
        if (state.phase === PHASE.LIT) updateChrome();
      } catch (e) {}
    }, 1000);
    setTimeout(pollState, 350);
  }
  var hintState = { on: false, action: null, timer: 0, sticky: false };
  function showHint(text, actionLabel, action, autoHideMs, sticky) {
    try {
      if (!hintEl) return;
      hintState.on = true; hintState.action = action || null; hintState.sticky = !!sticky;
      hintEl.innerHTML = '<span class="smk-hint-x" data-smk-hintx="1">✕</span>' +
        '<span>' + escapeHtml(text) + '</span>' +
        (actionLabel ? '<span class="smk-hint-act">' + escapeHtml(actionLabel) + ' →</span>' : '');
      hintEl.classList.add('on');
      clearTimeout(hintState.timer);
      if (autoHideMs) hintState.timer = setTimeout(hideHint, autoHideMs);
    } catch (e) {}
  }
  function hideHint() {
    try { hintState.on = false; hintState.action = null; if (hintEl) hintEl.classList.remove('on'); clearTimeout(hintState.timer); } catch (e) {}
  }
  function bindHintEvents() {
    try {
      hintEl.addEventListener('click', function (e) {
        var x = e.target && e.target.closest ? e.target.closest('[data-smk-hintx]') : null;
        if (x) { e.stopPropagation(); hideHint(); return; }
        var act = hintState.action; hideHint();
        if (act) { try { act(); } catch (err) {} }
      });
    } catch (e) {}
  }
  function layoutScene() {
    try {
      if (!stageEl) return;
      var ph = state.phase;
      if (ph === PHASE.LIT || ph === PHASE.TAKEN || ph === PHASE.LIGHTING || ph === PHASE.CUTTING || ph === PHASE.BURNT) { layoutCig('held'); refreshCigVisual(); }
      else if (ph === PHASE.OUT) { layoutCig('lying'); refreshCigVisual(); }
      try { layoutHandPhoto(); } catch (e) {}
      try { updatePhotoBurn(); } catch (e) {}
      FX.resize();
    } catch (e) {}
  }


  /* ==========================================================================
   * 13. 面板：烟柜 / 烟摊账本 / 设置（挂件内浮层）
   * ========================================================================*/
  var cabinet = { tab: 'cn', q: '' };
  var CAB_TABS = [
    { key: 'cn', label: '国烟' },
    { key: 'foreign', label: '外烟' },
    { key: 'cigar', label: '雪茄' }
  ];
  function statToday() { return stats.days[todayKey()] || { smoked: 0, puffs: 0, seconds: 0, products: {} }; }
  function statWeek() {
    var sum = 0;
    for (var i = 0; i < 7; i++) { var d = stats.days[dayKeyOffset(-i)]; if (d) sum += d.smoked || 0; }
    return sum;
  }
  function topBrands(n) {
    var agg = {}, keys = stats.products || {};
    for (var id in keys) {
      if (!Object.prototype.hasOwnProperty.call(keys, id)) continue;
      var p = findProduct(id);
      var brand = p ? p.brand : id;
      agg[brand] = (agg[brand] || 0) + (keys[id].smoked || 0);
    }
    var list = [];
    for (var b in agg) if (Object.prototype.hasOwnProperty.call(agg, b)) list.push({ brand: b, smoked: agg[b] });
    list.sort(function (a, b) { return b.smoked - a.smoked; });
    return list.slice(0, n || 3);
  }
  function cabinetFiltered() {
    var list = brands.products.slice();
    var tab = cabinet.tab || 'cn';
    function isCigarP(p) { try { return cigSpec(p).isCigar || p.category === '雪茄' || String(p.type) === '雪茄'; } catch (e) { return false; } }
    var hasCnCat = false;
    for (var ci = 0; ci < brands.products.length; ci++) {
      var c = brands.products[ci].category;
      if (c === '国烟' || c === '外烟' || c === '雪茄') { hasCnCat = true; break; }
    }
    if (hasCnCat) {
      if (tab === 'foreign') list = list.filter(function (p) { return p.category === '外烟' && !isCigarP(p); });
      else if (tab === 'cigar') list = list.filter(isCigarP);
      else list = list.filter(function (p) { return p.category === '国烟' && !isCigarP(p); });
    } else {
      if (tab === 'foreign') list = list.filter(function (p) { return !isCigarP(p) && p.origin !== 'CN'; });
      else if (tab === 'cigar') list = list.filter(isCigarP);
      else list = list.filter(function (p) { return !isCigarP(p) && p.origin === 'CN'; });
    }
    var q = (cabinet.q || '').trim().toLowerCase();
    if (q) list = list.filter(function (p) { return p.__search.indexOf(q) >= 0; });
    return list;
  }
  function tabCount(key) {
    var old = cabinet.tab; cabinet.tab = key;
    var n = cabinetFiltered().length; cabinet.tab = old; return n;
  }
  function cabinetGridHTML() {
    var list = cabinetFiltered();
    if (!list.length) return '<div class="smk-empty"><span class="smk-empty-ico">🚬</span>没找到这包烟。<br>换个关键词，或切到别的分类看看。</div>';
    var html = '<div class="smk-grid">';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var cur = product && product.id === p.id;
      var fav = (cfg.favorites || []).indexOf(p.id) >= 0;
      html += '<div class="smk-carditem' + (cur ? ' on' : '') + '" data-pid="' + escapeHtml(p.id) + '" title="' + escapeHtml(productLabel(p)) + '">' +
        '<button class="smk-cfav' + (fav ? ' on' : '') + '" data-fav="' + escapeHtml(p.id) + '" type="button" title="收藏">' + (fav ? '★' : '☆') + '</button>' +
        renderPackThumb(p) +
        '<div class="smk-cname">' + escapeHtml(p.brand) + '</div>' +
        '<div class="smk-cmeta">' + escapeHtml(p.variant || p.format || '') + ' · <span class="smk-price">' + escapeHtml(fmtPrice(p.price)) + '</span> · 焦油' + (p.tar || 0) + 'mg</div>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }
  function cabinetShell() {
    var tabs = '';
    for (var i = 0; i < CAB_TABS.length; i++) {
      var t = CAB_TABS[i];
      tabs += '<button class="smk-tab' + (cabinet.tab === t.key ? ' on' : '') + '" data-tab="' + t.key + '" type="button" role="tab">' + t.label +
        '<span class="smk-tab-n">' + tabCount(t.key) + '</span></button>';
    }
    return '<div class="smk-phead"><div class="smk-ptitle">烟柜<span class="smk-ptitle-sub">挑一包，慢慢抽</span></div>' +
      '<button class="smk-pclose" data-smk-close="1" type="button" title="关闭">✕</button></div>' +
      '<div class="smk-tabs">' + tabs + '</div>' +
      '<div class="smk-search' + (cabinet.q ? ' has-val' : '') + '" id="smk-searchwrap">' +
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 L14 14"/></svg>' +
        '<input id="smk-search" type="text" placeholder="搜品牌 / 拼音 / 英文" value="' + escapeHtml(cabinet.q) + '" autocomplete="off" spellcheck="false">' +
        '<button class="smk-clear" data-sact="clearsearch" type="button" title="清空">✕</button>' +
      '</div>' +
      '<div class="smk-gridwrap" id="smk-gridwrap">' + cabinetGridHTML() + '</div>' +
      '<div class="smk-pfoot"><span class="smk-count" id="smk-cab-count">' + cabinetFiltered().length + ' 款可挑</span>' +
        '<button class="smk-lite" data-sact="random" type="button">🎲 随机换一包</button></div>' +
      '<div class="smk-cabresize" id="smk-cabresize" title="拖动调整烟柜大小"></div>';
  }
  function refreshCabinetGrid() {
    var wrap = panelEl.querySelector('#smk-gridwrap');
    if (wrap) wrap.innerHTML = cabinetGridHTML();
    var count = panelEl.querySelector('#smk-cab-count');
    if (count) count.textContent = cabinetFiltered().length + ' 款可挑';
    var tabs = panelEl.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === cabinet.tab);
  }
  function confirmHTML() {
    return '<div class="smk-confirm" id="smk-confirm"><div class="smk-confirm-box">' +
      '<div class="smk-confirm-txt" id="smk-confirm-txt"></div>' +
      '<div class="smk-confirm-acts"><button class="smk-lite" data-cact="no" type="button">再想想</button>' +
      '<button class="smk-lite smk-danger" data-cact="yes" type="button">确定</button></div></div></div>';
  }
  function statsShell() {
    var today = statToday(), week = statWeek(), total = stats.total || { smoked: 0, puffs: 0, seconds: 0 };
    var top = topBrands(3), maxTop = top.length ? Math.max(1, top[0].smoked) : 1;
    var defs = achievementDefs(), ach = '', achUnlocked = 0;
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i], got = !!stats.achievements[d.key];
      if (got) achUnlocked++;
      var pr = null;
      try { if (typeof d.progress === 'function') pr = d.progress(); } catch (e) {}
      var prTxt = '', prBar = '';
      if (got) prTxt = '已解锁';
      else if (pr && pr.target > 0) {
        prTxt = Math.min(pr.cur, pr.target) + ' / ' + pr.target;
        prBar = '<span class="smk-ach-bar"><i style="width:' + Math.round(Math.min(1, pr.cur / pr.target) * 100) + '%"></i></span>';
      } else prTxt = escapeHtml(d.desc);
      ach += '<div class="smk-achitem' + (got ? ' got' : '') + '"><span class="smk-ach-ico">' + d.icon + '</span>' +
        '<span class="smk-ach-name">' + escapeHtml(d.name) + '</span>' +
        '<span class="smk-ach-desc">' + prTxt + prBar + '</span></div>';
    }
    var topRows = '';
    if (!top.length) topRows = '<div class="smk-row"><span class="smk-row-ico">·</span><span class="smk-row-lab">还没抽过，账本一片空白</span></div>';
    else for (var ti = 0; ti < top.length; ti++) {
      topRows += '<div class="smk-row"><span class="smk-row-ico">' + (ti + 1) + '</span><span class="smk-row-lab">' + escapeHtml(top[ti].brand) + '</span>' +
        '<span class="smk-row-val">' + top[ti].smoked + ' 支</span><span class="smk-bar"><i style="width:' + Math.round(top[ti].smoked / maxTop * 100) + '%"></i></span></div>';
    }
    var achCount = 0;
    for (var k in stats.achievements) if (Object.prototype.hasOwnProperty.call(stats.achievements, k)) achCount++;
    return '<div class="smk-phead"><div class="smk-ptitle">烟摊账本<span class="smk-ptitle-sub">纯模拟账，不进肺</span></div>' +
      '<button class="smk-pclose" data-smk-close="1" type="button" title="关闭">✕</button></div>' +
      '<div class="smk-pbody">' +
        '<div class="smk-tiles">' +
          '<div class="smk-tile"><div class="smk-tv">' + (today.smoked || 0) + '<small>根</small></div><div class="smk-tl">今日</div></div>' +
          '<div class="smk-tile"><div class="smk-tv">' + week + '<small>根</small></div><div class="smk-tl">本周</div></div>' +
          '<div class="smk-tile"><div class="smk-tv">' + (total.smoked || 0) + '<small>根</small></div><div class="smk-tl">累计</div></div>' +
        '</div>' +
        '<div class="smk-rows">' +
          '<div class="smk-row smk-row-emoking"><span class="smk-row-ico">🌱</span><span class="smk-row-lab">用虚拟烟替代真烟</span><span class="smk-row-val">' + (total.smoked || 0) + ' 支（≈ 少抽 ' + (total.smoked || 0) + ' 支真烟 · 少一份二手烟）</span></div>' +
          '<div class="smk-row"><span class="smk-row-ico">⏱</span><span class="smk-row-lab">今日抽吸时长</span><span class="smk-row-val">' + escapeHtml(fmtMinutes(today.seconds || 0)) + '</span></div>' +
          '<div class="smk-row"><span class="smk-row-ico">💨</span><span class="smk-row-lab">今日口数 / 累计口数</span><span class="smk-row-val">' + (today.puffs || 0) + ' / ' + (total.puffs || 0) + '</span></div>' +
          '<div class="smk-row"><span class="smk-row-ico">🚬</span><span class="smk-row-lab">烟灰缸累计烟蒂</span><span class="smk-row-val">×' + (stats.buttCount || 0) + '</span></div>' +
          '<div class="smk-row"><span class="smk-row-ico">📦</span><span class="smk-row-lab">开包数 · 当前连抽</span><span class="smk-row-val">' + (stats.packOpened || 0) + ' 包 · ' + ((stats.streak && stats.streak.count) || 0) + ' 连</span></div>' +
          '<div class="smk-row"><span class="smk-row-ico">🏆</span><span class="smk-row-lab">最长连抽</span><span class="smk-row-val">' + ((stats.streak && stats.streak.best) || 0) + ' 连</span></div>' +
        '</div>' +
        '<div class="smk-sect">常用品牌 Top 3</div><div class="smk-rows">' + topRows + '</div>' +
        '<div class="smk-sect">成就墙 · 已解锁 ' + achUnlocked + ' / ' + defs.length + '</div><div class="smk-ach">' + ach + '</div>' +
        '<div class="smk-footnote">数据只存在本机 · 换台电脑就清零了</div>' +
      '</div>' +
      '<div class="smk-pfoot"><span class="smk-count">已解锁 ' + achUnlocked + ' / ' + defs.length + ' 成就</span>' +
        '<button class="smk-lite smk-danger" data-sact="resetstats" type="button">重置账本</button></div>' + confirmHTML();
  }
  function settingsShell() {
    var modeChip = host.mode === 'host' ? '<span class="smk-modechip">● 宿主已连接</span>' : '<span class="smk-modechip preview">○ 预览模式 · localStorage</span>';
    var dens = cfg.density || 1;
    var densLab = dens <= 0.8 ? '少' : dens >= 1.25 ? '浓' : '标准';
    function switchRow(key, label, desc) {
      return '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">' + label + '</span><span class="smk-sdesc">' + desc + '</span></div>' +
        '<button class="smk-switch' + (cfg[key] ? ' on' : '') + '" data-sact="toggle:' + key + '" type="button" aria-label="' + label + '"></button></div>';
    }
    return '<div class="smk-phead"><div class="smk-ptitle">设置<span class="smk-ptitle-sub">' + modeChip + '</span></div>' +
      '<button class="smk-pclose" data-smk-close="1" type="button" title="关闭">✕</button></div>' +
      '<div class="smk-pbody" id="smk-setbody">' +
        '<div class="smk-setrow" id="smk-set-scale-row"><div class="smk-setlab"><span class="smk-sname">挂件缩放</span><span class="smk-sdesc">0.7 - 2.0 倍 · 拖动即时生效</span></div>' +
          '<input class="smk-range" id="smk-set-scale" type="range" min="0.7" max="2" step="0.05" value="' + cfg.scale + '">' +
          '<span class="smk-setval" id="smk-set-scale-v">' + Math.round(cfg.scale * 100) + '%</span></div>' +
        '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">缩放快捷</span><span class="smk-sdesc">小 / 标准 / 大 / 特大</span></div>' +
          '<div class="smk-seg" data-seg="scale">' +
            '<button type="button" data-sact="scale:0.8" class="' + (cfg.scale <= 0.9 ? 'on' : '') + '">80%</button>' +
            '<button type="button" data-sact="scale:1" class="' + (cfg.scale > 0.9 && cfg.scale < 1.15 ? 'on' : '') + '">100%</button>' +
            '<button type="button" data-sact="scale:1.3" class="' + (cfg.scale >= 1.15 && cfg.scale < 1.6 ? 'on' : '') + '">130%</button>' +
            '<button type="button" data-sact="scale:1.8" class="' + (cfg.scale >= 1.6 ? 'on' : '') + '">180%</button></div></div>' +
        '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">烟柜大小</span><span class="smk-sdesc">当前 ' + Math.round(clamp(+cfg.cabinetW || 560, 380, 760)) + 'px（也可拖烟柜右下角）</span></div>' +
          '<div class="smk-seg" data-seg="cabw">' +
            '<button type="button" data-sact="cabw:420" class="' + (cfg.cabinetW <= 470 ? 'on' : '') + '">中</button>' +
            '<button type="button" data-sact="cabw:560" class="' + (cfg.cabinetW > 470 && cfg.cabinetW < 620 ? 'on' : '') + '">大</button>' +
            '<button type="button" data-sact="cabw:700" class="' + (cfg.cabinetW >= 620 ? 'on' : '') + '">特大</button></div></div>' +
        switchRow('soundOn', '音效', '打火机、吸气、烟蒂入缸、任务完成铃') +
        '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">音量</span><span class="smk-sdesc">0 - 100%</span></div>' +
          '<input class="smk-range" id="smk-set-vol" type="range" min="0" max="1" step="0.05" value="' + cfg.volume + '">' +
          '<span class="smk-setval" id="smk-set-vol-v">' + Math.round(cfg.volume * 100) + '%</span></div>' +
        '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">烟量</span><span class="smk-sdesc">当前：' + densLab + '（按品牌烟量系数叠加）</span></div>' +
          '<div class="smk-seg" data-seg="density">' +
            '<button type="button" data-sact="density:0.6" class="' + (dens <= 0.8 ? 'on' : '') + '">少</button>' +
            '<button type="button" data-sact="density:1" class="' + (dens > 0.8 && dens < 1.25 ? 'on' : '') + '">标准</button>' +
            '<button type="button" data-sact="density:1.4" class="' + (dens >= 1.25 ? 'on' : '') + '">浓</button></div></div>' +
        '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">自动抽间隔</span><span class="smk-sdesc">开启后每隔多久来一口</span></div>' +
          '<input class="smk-range" id="smk-set-auto" type="range" min="3" max="15" step="1" value="' + cfg.autoPuffSec + '">' +
          '<span class="smk-setval" id="smk-set-auto-v">' + cfg.autoPuffSec + 's</span></div>' +
        switchRow('showHints', '任务提示气泡', '任务在跑 / 等你回话 / 跑完了时冒个气泡') +
        switchRow('hideMenuBtn', '隐藏菜单按钮', '右键或长按仍可呼出菜单') +
        switchRow('reduceMotion', '减少动效', '关闭开盒、呼吸等动画（省电）') +
        switchRow('edgeSnap', '四边吸附', '拖动到屏幕边缘时自动贴边') +
        '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">位置</span><span class="smk-sdesc">回到右下角默认位置</span></div>' +
          '<button class="smk-lite" data-sact="posreset" type="button">重置位置</button></div>' +
        '<div class="smk-setrow"><div class="smk-setlab"><span class="smk-sname">数据</span><span class="smk-sdesc">账本与设置都存本机；重置后需刷新</span></div>' +
          '<button class="smk-lite smk-danger" data-sact="resetall" type="button">数据重置</button></div>' +
        '<div class="smk-sect">关于 emoking</div>' +
        '<div class="smk-aboutbrand" id="smk-about-emoking">' +
          '<div class="smk-aname">emoking · 虚拟烟替代工具</div>' +
          '<div class="smk-acopy">emoking 不是抽烟游戏，而是「虚拟烟替代工具」：烟瘾上来时先点一支虚拟烟顶一下，帮助减少真实吸烟；在公共场所（工位 / 办公室 / 电梯 / 商场等不能吸烟的地方），避免真实吸烟造成的烟雾与二手烟污染。</div>' +
          '<div class="smk-awarn">模拟不能替代专业戒烟治疗；烟瘾明显时，建议咨询戒烟门诊或当地戒烟热线。</div>' +
          '<div class="smk-alegal">吸烟有害健康。纯模拟，不含真实烟草，不涉及任何销售。</div>' +
          '<div class="smk-asetrow"><span class="smk-sdesc">版本 ' + WIDGET_VERSION + ' · 品牌 ' + brands.products.length + ' 款</span>' +
            '<button class="smk-lite" data-sact="about" type="button">宿主自检</button></div>' +
          '<div class="smk-about" id="smk-about"></div>' +
        '</div>' +
        '<div class="smk-footnote">emoking · 用虚拟烟替代真烟：帮你戒烟、少污染。纯模拟，不含真实烟草。吸烟有害健康。</div>' +
      '</div>' + confirmHTML();
  }
  var confirmState = { cb: null };
  function showConfirm(text, cb) {
    var box = panelEl.querySelector('#smk-confirm');
    if (!box) return;
    confirmState.cb = cb;
    var t = panelEl.querySelector('#smk-confirm-txt');
    if (t) t.textContent = text;
    box.classList.add('on');
  }
  function hideConfirm() {
    var box = panelEl.querySelector('#smk-confirm');
    if (box) box.classList.remove('on');
    confirmState.cb = null;
  }
  function renderPanel(kind) {
    try {
      if (kind === 'cabinet') { panelEl.className = 'smk-panel smk-panel-cabinet'; panelEl.innerHTML = cabinetShell(); }
      else if (kind === 'stats') { panelEl.className = 'smk-panel smk-panel-stats'; panelEl.innerHTML = statsShell(); }
      else if (kind === 'settings') { panelEl.className = 'smk-panel smk-panel-settings'; panelEl.innerHTML = settingsShell(); }
      else panelEl.innerHTML = '';
    } catch (e) {
      try { panelEl.innerHTML = '<div class="smk-pbody"><div class="smk-empty">面板开小差了，重开一次试试。</div></div>'; } catch (e2) {}
    }
  }
  function applyCabinetWidth() {
    try {
      var w = clamp(+cfg.cabinetW || 560, 380, 760);
      if (panelEl) panelEl.style.setProperty('--smk-cabw', Math.round(w) + 'px');
    } catch (e) {}
  }
  function openPanel(kind) {
    try {
      if (!overlayEl || !panelEl) return;
      if (ui.panel === kind) { closePanel(); return; }
      SFX.unlock();
      ui.panel = kind;
      renderPanel(kind);
      applyCabinetWidth();
      overlayEl.classList.add('on');
      hideHint();
      closeMenu();
      SFX.play('ui', { vol: 0.4 });
      if (kind === 'cabinet' && !DEMO) {
        setTimeout(function () { try { var inp = panelEl.querySelector('#smk-search'); if (inp) inp.focus({ preventScroll: true }); } catch (e) {} }, 60);
      }
    } catch (e) { try { closePanel(); } catch (e2) {} }
  }
  function closePanel() {
    try {
      if (!overlayEl) return;
      overlayEl.classList.remove('on');
      ui.panel = '';
      hideConfirm();
      setTimeout(function () { try { if (!ui.panel) panelEl.innerHTML = ''; } catch (e) {} }, 240);
    } catch (e) {}
  }
  function loadAbout() {
    var box = panelEl.querySelector('#smk-about');
    if (!box) return;
    box.classList.add('on');
    box.textContent = '正在自检…';
    if (host.mode !== 'host') {
      box.innerHTML = '<b>预览模式</b>\n/smoke/* 不可用（无宿主），当前使用 localStorage 降级。\n品牌数据：' +
        escapeHtml(brands.version || '未知') + ' · ' + brands.products.length + ' 款\n<span class="smk-bad">宿主自检不可用</span>';
      return;
    }
    API.get('/smoke/about.json', 5000).then(function (res) {
      var lines = ['<b>版本</b> ' + escapeHtml(String(res.version || '?'))];
      lines.push('<b>数据目录</b> ' + escapeHtml(String(res.dataDir || '?')));
      if (res.files && res.files.length) {
        lines.push('<b>数据文件</b>');
        for (var i = 0; i < res.files.length; i++) {
          var f = res.files[i];
          lines.push(' · ' + escapeHtml(String(f.path)) + ' ' + (f.exists ? '<span class="smk-ok">✓</span>' : '<span class="smk-bad">✗ 不存在</span>'));
        }
      }
      if (res.routes) lines.push('<b>路由</b> ' + (Array.isArray(res.routes) ? res.routes.length : Object.keys(res.routes).length) + ' 条');
      lines.push('<b>品牌数据</b> ' + escapeHtml(brands.version || '?') + ' · ' + brands.products.length + ' 款');
      box.innerHTML = lines.join('\n');
    }).catch(function () { box.innerHTML = '<span class="smk-bad">自检请求失败</span>（网络或宿主不可用）'; });
  }
  function bindPanelEvents() {
    try {
      overlayEl.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('[data-smk-close]')) { closePanel(); return; }
        var cact = t.closest('[data-cact]');
        if (cact) {
          var yes = cact.getAttribute('data-cact') === 'yes';
          var cb = confirmState.cb;
          hideConfirm();
          if (yes && cb) { try { cb(); } catch (err) {} }
          return;
        }
        var tab = t.closest('[data-tab]');
        if (tab) { cabinet.tab = tab.getAttribute('data-tab'); refreshCabinetGrid(); SFX.play('ui', { vol: 0.25 }); return; }
        var fav = t.closest('[data-fav]');
        if (fav) {
          e.stopPropagation();
          var fid = fav.getAttribute('data-fav');
          var idx = (cfg.favorites || []).indexOf(fid);
          if (idx >= 0) cfg.favorites.splice(idx, 1); else cfg.favorites.push(fid);
          saveConfigSoon(); refreshCabinetGrid(); SFX.play('ui', { vol: 0.3, pitch: idx >= 0 ? 0.9 : 1.1 });
          return;
        }
        var card = t.closest('[data-pid]');
        if (card) {
          var pid = card.getAttribute('data-pid');
          var ok = switchProduct(pid);
          if (ok) setTimeout(function () { try { if (ui.panel === 'cabinet') refreshCabinetGrid(); } catch (err) {} }, 320);
          return;
        }
        var sact = t.closest('[data-sact]');
        if (!sact) return;
        var act = sact.getAttribute('data-sact');
        if (act === 'random') {
          var pool = cabinetFiltered(); if (!pool.length) pool = brands.products;
          if (!pool.length) return;
          switchProduct(pool[Math.floor(Math.random() * pool.length)].id);
          cabinet.q = '';
          setTimeout(function () { try { if (ui.panel === 'cabinet') { var inp = panelEl.querySelector('#smk-search'); if (inp) inp.value = ''; refreshCabinetGrid(); } } catch (err) {} }, 300);
          SFX.play('ui', { vol: 0.45 }); return;
        }
        if (act === 'clearsearch') {
          cabinet.q = '';
          var si = panelEl.querySelector('#smk-search');
          if (si) { si.value = ''; si.focus({ preventScroll: true }); }
          refreshCabinetGrid(); return;
        }
        if (act === 'resetstats') { showConfirm('确定把账本清零吗？成就、连抽、口数、烟蒂计数都会一起消失。', function () { resetData('stats'); }); return; }
        if (act === 'resetall') { showConfirm('重置全部数据（设置 + 账本）？重置后会刷新页面。', function () { resetData('all'); }); return; }
        if (act === 'posreset') { cfg.x = null; cfg.y = null; applyCfgPosition(); saveConfigSoon(); toast('挂件已回右下角', 1400); return; }
        if (act === 'about') { loadAbout(); return; }
        if (act.indexOf('toggle:') === 0) {
          var key = act.slice(7); cfg[key] = !cfg[key]; applyConfigFlags(); saveConfigSoon(); renderPanel('settings'); SFX.play('ui', { vol: 0.3 }); return;
        }
        if (act.indexOf('density:') === 0) { cfg.density = parseFloat(act.slice(8)) || 1; saveConfigSoon(); renderPanel('settings'); SFX.play('ui', { vol: 0.25 }); return; }
        if (act.indexOf('scale:') === 0) {
          var sc2 = clamp(parseFloat(act.slice(6)) || 1, SCALE_MIN, SCALE_MAX);
          cfg.scale = sc2; setScale(sc2, true);
          if (ui.panel === 'settings') renderPanel('settings');
          toast('缩放 ' + Math.round(sc2 * 100) + '%', 1200);
          SFX.play('ui', { vol: 0.3 });
          return;
        }
        if (act.indexOf('cabw:') === 0) { cfg.cabinetW = clamp(parseInt(act.slice(5), 10) || 560, 380, 760); applyCabinetWidth(); saveConfigSoon(); renderPanel('settings'); SFX.play('ui', { vol: 0.25 }); return; }
      });
      overlayEl.addEventListener('pointerdown', function (e) {
        try {
          var h = e.target && e.target.closest ? e.target.closest('#smk-cabresize') : null;
          if (!h || !panelEl) return;
          e.preventDefault();
          SFX.unlock();
          var rect = panelEl.getBoundingClientRect();
          var startX = e.clientX, startW = rect.width;
          function move(ev) {
            var w = clamp(startW + (ev.clientX - startX) * 2, 380, Math.min(760, window.innerWidth - 28));
            cfg.cabinetW = Math.round(w);
            applyCabinetWidth();
          }
          function up() {
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', up, true);
            saveConfigSoon();
          }
          document.addEventListener('pointermove', move, true);
          document.addEventListener('pointerup', up, true);
          try { h.setPointerCapture(e.pointerId); } catch (err) {}
        } catch (err) {}
      });
      overlayEl.addEventListener('input', function (e) {
        var t = e.target;
        if (!t || !t.id) return;
        try {
          if (t.id === 'smk-search') {
            cabinet.q = t.value || '';
            refreshCabinetGrid();
            var sw = panelEl.querySelector('#smk-searchwrap');
            if (sw) sw.classList.toggle('has-val', !!cabinet.q);
          } else if (t.id === 'smk-set-scale') {
            var sv = clamp(parseFloat(t.value) || 1, SCALE_MIN, SCALE_MAX);
            cfg.scale = sv; setScale(sv, false);
            var svl = panelEl.querySelector('#smk-set-scale-v'); if (svl) svl.textContent = Math.round(sv * 100) + '%';
            saveConfigSoon();
          } else if (t.id === 'smk-set-vol') {
            cfg.volume = clamp(parseFloat(t.value) || 0, 0, 1); SFX.setVolume();
            var vvl = panelEl.querySelector('#smk-set-vol-v'); if (vvl) vvl.textContent = Math.round(cfg.volume * 100) + '%';
            saveConfigSoon();
          } else if (t.id === 'smk-set-auto') {
            cfg.autoPuffSec = clamp(parseInt(t.value, 10) || 6, 3, 15); state.autoSec = cfg.autoPuffSec;
            var avl = panelEl.querySelector('#smk-set-auto-v'); if (avl) avl.textContent = cfg.autoPuffSec + 's';
            saveConfigSoon();
          }
        } catch (err) {}
      });
    } catch (e) {}
  }

  /* ==========================================================================
   * 14. 快捷菜单 / 长按 / 右键（无烟圈）
   * ========================================================================*/
  var menuOpen = false;
  function menuItems() {
    var lit = isLit();
    var items = [];
    items.push({ ico: '◈', lab: '换烟 · 烟柜', key: '', act: function () { openPanel('cabinet'); } });
    items.push({ ico: '💨', lab: lit ? '轻吸一口' : (state.phase === PHASE.TAKEN ? '点火' : '虚拟顶一下'), key: '按住烟体', act: function () {
      if (lit) doPuff(900);
      else if (state.phase === PHASE.TAKEN) lightCig();
      else if (state.phase === PHASE.IDLE) { if (state.packRemaining > 0) openPack(); else buyPack(); }
      else if (state.phase === PHASE.OUT) takeCig();
    } });
    items.push({ ico: '🌫', lab: '抖烟灰（安全）', key: '', act: function () { if (lit) flickAsh(); else toast('点着了再抖灰', 1200); } });
    items.push({ ico: '🔥', lab: lit ? '掐灭这根' : '点火', key: '', act: function () {
      if (lit) extinguish(); else if (state.phase === PHASE.TAKEN) lightCig(); else toast('先点一支虚拟烟再点火', 1300);
    } });
    items.push({ ico: '∞', lab: '自动抽', key: state.autoOn ? '开' : '关', on: state.autoOn, act: toggleAuto });
    items.push({ sep: true });
    items.push({ ico: '▤', lab: '烟摊账本', key: '', act: function () { openPanel('stats'); } });
    items.push({ ico: '⚙', lab: '设置', key: '', act: function () { openPanel('settings'); } });
    items.push({ ico: 'ℹ', lab: '关于 emoking', key: '', act: function () {
      openPanel('settings');
      setTimeout(function () { try { scrollToAboutEmoking(); } catch (e) {} }, 200);
    } });
    items.push({ ico: '⤢', lab: '缩放', key: Math.round((cfg.scale || 1) * 100) + '%', act: function () {
      openPanel('settings');
      setTimeout(function () { try { scrollToScaleRow(); } catch (e) {} }, 180);
    } });
    items.push({ ico: '◌', lab: '隐藏挂件', key: '', act: hideWidget });
    return items;
  }
  function scrollToAboutEmoking() {
    try {
      var blk = panelEl && panelEl.querySelector('#smk-about-emoking');
      if (!blk) return;
      blk.classList.add('smk-hl');
      try { blk.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      setTimeout(function () { try { blk.classList.remove('smk-hl'); } catch (e) {} }, 2200);
    } catch (e) {}
  }
  function scrollToScaleRow() {
    try {
      var row = panelEl && panelEl.querySelector('#smk-set-scale-row');
      if (!row) return;
      row.classList.add('smk-hl');
      try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      setTimeout(function () { try { row.classList.remove('smk-hl'); } catch (e) {} }, 1600);
      var inp = panelEl.querySelector('#smk-set-scale');
      if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) {} }
    } catch (e) {}
  }
  function toggleAuto() {
    state.autoOn = !state.autoOn;
    cfg.autoPuff = state.autoOn;
    saveConfigSoon();
    if (state.autoOn) { startAutoTimer(); toast('自动抽：开', 1300); }
    else { if (autoTimerId) { clearInterval(autoTimerId); autoTimerId = 0; } toast('自动抽：关', 1300); }
    updateButtons();
    if (menuOpen) buildMenu();
  }
  function buildMenu() {
    if (!menuEl) return;
    var items = menuItems(), html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.sep) { html += '<div class="smk-sep"></div>'; continue; }
      html += '<button class="smk-mi' + (it.on ? ' on' : '') + '" data-midx="' + i + '" type="button">' +
        '<span class="smk-mi-ico">' + it.ico + '</span><span class="smk-mi-lab">' + escapeHtml(it.lab) + '</span>' +
        (it.on ? '<span class="smk-mi-dot"></span>' : (it.key ? '<span class="smk-mi-key">' + escapeHtml(it.key) + '</span>' : '')) + '</button>';
    }
    menuEl.innerHTML = html;
    menuEl._items = items;
  }
  function openMenu(x, y) {
    try {
      if (!menuEl) return;
      buildMenu();
      menuEl.classList.add('on');
      menuOpen = true;
      var w = menuEl.offsetWidth || 150, h = menuEl.offsetHeight || 240;
      if (typeof x !== 'number' || typeof y !== 'number') {
        var r = widgetEl.getBoundingClientRect();
        x = r.right - w - 6; y = r.top - h - 8;
      }
      x = clamp(x, 8, window.innerWidth - w - 8);
      y = clamp(y, 8, window.innerHeight - h - 8);
      menuEl.style.left = Math.round(x) + 'px';
      menuEl.style.top = Math.round(y) + 'px';
      SFX.play('ui', { vol: 0.25 });
    } catch (e) {}
  }
  function closeMenu() { try { menuOpen = false; if (menuEl) menuEl.classList.remove('on'); } catch (e) {} }
  function toggleMenu(x, y) { if (menuOpen) closeMenu(); else openMenu(x, y); }
  function bindMenuEvents() {
    try {
      if (!menuEl) return;
      menuEl.addEventListener('click', function (e) {
        try {
          var b = e.target && e.target.closest ? e.target.closest('[data-midx]') : null;
          if (!b) return;
          e.preventDefault(); e.stopPropagation();
          var idx = parseInt(b.getAttribute('data-midx'), 10);
          var items = menuEl._items || menuItems();
          var it = items[idx];
          closeMenu();
          if (it && typeof it.act === 'function') { try { it.act(); } catch (err) {} }
        } catch (err) {}
      }, true);
      document.addEventListener('keydown', function (e) {
        try { if (menuOpen && (e.key === 'Escape' || e.key === 'Esc')) closeMenu(); } catch (err) {}
      });
    } catch (e) {}
  }

  var DEFAULT_RIGHT = 112;
  var DEFAULT_BOTTOM = 18;
  var DEMO = null;

  function applyCfgPosition() {
    try {
      if (!widgetEl) return;
      var right = cfg.x == null ? DEFAULT_RIGHT : clamp(+cfg.x, 4, Math.max(4, window.innerWidth - 60));
      var bottom = cfg.y == null ? DEFAULT_BOTTOM : clamp(+cfg.y, 4, Math.max(4, window.innerHeight - 60));
      widgetEl.style.right = Math.round(right) + 'px';
      widgetEl.style.bottom = Math.round(bottom) + 'px';
      if (peekEl) {
        peekEl.style.right = Math.round(right) + 'px';
        peekEl.style.bottom = Math.round(bottom) + 'px';
      }
    } catch (e) {}
  }
  function setScale(v, save) {
    try {
      v = clamp(+v || 1, SCALE_MIN, SCALE_MAX);
      cfg.scale = v;
      if (widgetEl) widgetEl.style.transform = 'scale(' + v + ')';
      if (save) saveConfigSoon();
      setTimeout(function () { try { layoutScene(); } catch (e) {} }, 60);
    } catch (e) {}
  }
  function applyConfigFlags() {
    try {
      if (!widgetEl) return;
      widgetEl.classList.toggle('smk-no-anim', !!cfg.reduceMotion);
      var mb = rootEl.querySelector('#smk-btn-menu');
      if (mb) mb.classList.toggle('smk-hidden', !!cfg.hideMenuBtn);
      SFX.setVolume();
    } catch (e) {}
  }
  function hideWidget() {
    try {
      ui.hidden = true;
      if (state.inhaling) endInhale();
      closeMenu();
      closePanel();
      hideHint();
      widgetEl.classList.add('smk-hidden');
      if (peekEl) peekEl.classList.add('on');
      FX.setPaused(true);
      SFX.suspend();
    } catch (e) {}
  }
  function showWidget() {
    try {
      ui.hidden = false;
      widgetEl.classList.remove('smk-hidden');
      if (peekEl) peekEl.classList.remove('on');
      FX.setPaused(false);
      SFX.resume();
      layoutScene();
      pollState();
    } catch (e) {}
  }
  /* v4：本体任意拖动（顶栏 + 场景空白处）+ 隐藏态小圆点可拖（共用位置记忆） */
  var peekDragMovedAt = 0;
  function bindDrag() {
    try {
      var handle = rootEl.querySelector('#smk-drag');
      var drag = null;
      function interactive(t) {
        if (!t || !t.closest) return false;
        return !!t.closest('.smk-packwrap,.smk-cigwrap,.smk-hand,.smk-hand-front,#smk-ashtray,.smk-lighter,.smk-actions,.smk-hint,.smk-buttcount,#smk-buttcount,.smk-intensity,.smk-toast,.smk-iconbtn,button,input');
      }
      function begin(e, capEl) {
        try {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          if (interactive(e.target)) return;
          var r = widgetEl.getBoundingClientRect();
          drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom, w: r.width, h: r.height, moved: false };
          widgetEl.classList.add('smk-dragging');
          try { if (capEl && capEl.setPointerCapture) capEl.setPointerCapture(e.pointerId); } catch (err) {}
          e.preventDefault();
        } catch (err) {}
      }
      function move(e) {
        try {
          if (!drag || e.pointerId !== drag.id) return;
          var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
          if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
          var right = clamp(drag.right - dx, 2, Math.max(2, window.innerWidth - drag.w - 2));
          var bottom = clamp(drag.bottom - dy, 2, Math.max(2, window.innerHeight - drag.h - 2));
          widgetEl.style.right = Math.round(right) + 'px';
          widgetEl.style.bottom = Math.round(bottom) + 'px';
          if (peekEl) { peekEl.style.right = Math.round(right) + 'px'; peekEl.style.bottom = Math.round(bottom) + 'px'; }
        } catch (err) {}
      }
      function end(e) {
        try {
          if (!drag) return;
          var r = widgetEl.getBoundingClientRect();
          var right = window.innerWidth - r.right;
          var bottom = window.innerHeight - r.bottom;
          if (cfg.edgeSnap !== false) {
            if (right < 30) right = 10;
            else if (right > window.innerWidth - r.width - 30) right = 10;
            if (bottom < 26) bottom = 10;
            else if (bottom > window.innerHeight - r.height - 26) bottom = 10;
          }
          cfg.x = clamp(Math.round(right), 2, Math.max(2, window.innerWidth - r.width - 2));
          cfg.y = clamp(Math.round(bottom), 2, Math.max(2, window.innerHeight - r.height - 2));
          applyCfgPosition();
          saveConfigSoon();
          if (drag.moved) hideHint();
          drag = null;
          widgetEl.classList.remove('smk-dragging');
        } catch (err) { drag = null; }
      }
      if (handle) handle.addEventListener('pointerdown', function (e) { begin(e, handle); });
      if (stageEl) stageEl.addEventListener('pointerdown', function (e) { begin(e, stageEl); });
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', end, true);
      document.addEventListener('pointercancel', end, true);
      if (handle) handle.addEventListener('dblclick', function (e) {
        if (interactive(e.target)) return;
        cfg.x = null; cfg.y = null;
        applyCfgPosition();
        saveConfigSoon();
        toast('位置已复位', 1200);
      });
      /* 隐藏态小圆点：可拖到任意位置，与本体共用 cfg.x / cfg.y */
      if (peekEl) {
        var pdrag = null;
        peekEl.addEventListener('pointerdown', function (e) {
          try {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            var r = peekEl.getBoundingClientRect();
            pdrag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom, moved: false };
            try { peekEl.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
          } catch (err) {}
        });
        peekEl.addEventListener('pointermove', function (e) {
          try {
            if (!pdrag || e.pointerId !== pdrag.id) return;
            var dx = e.clientX - pdrag.sx, dy = e.clientY - pdrag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 4) pdrag.moved = true;
            var right = clamp(pdrag.right - dx, 2, window.innerWidth - 22);
            var bottom = clamp(pdrag.bottom - dy, 2, window.innerHeight - 22);
            cfg.x = Math.round(right); cfg.y = Math.round(bottom);
            applyCfgPosition();
          } catch (err) {}
        });
        function pend(e) {
          try {
            if (!pdrag) return;
            if (pdrag.moved) { peekDragMovedAt = nowMs(); saveConfigSoon(); toast('小圆点位置已记住', 1100); }
            else { showWidget(); }
            pdrag = null;
          } catch (err) { pdrag = null; }
        }
        peekEl.addEventListener('pointerup', pend);
        peekEl.addEventListener('click', function (e) {
          try { e.stopPropagation(); if (nowMs() - peekDragMovedAt > 350) showWidget(); } catch (err) {}
        });
        peekEl.addEventListener('pointercancel', pend);
      }
    } catch (e) {}
  }

  function bindGlobalEvents() {
    try {
      /* v5：菜单点外关闭 */
      document.addEventListener('pointerdown', function (e) {
        try {
          if (!menuOpen) return;
          var t = e.target;
          if (t && t.closest && (t.closest('#smk-menu') || t.closest('#smk-btn-menu'))) return;
          closeMenu();
        } catch (err) {}
      }, true);
      document.addEventListener('click', function (e) {
        try {
          if (!menuOpen) return;
          var t = e.target;
          if (t && t.closest && (t.closest('#smk-menu') || t.closest('#smk-btn-menu'))) return;
          closeMenu();
        } catch (err) {}
      }, true);
      var rz = debounce(function () {
        try {
          applyCfgPosition();
          layoutScene();
          var r = widgetEl.getBoundingClientRect();
          if (cfg.x != null) cfg.x = clamp(cfg.x, 4, Math.max(4, window.innerWidth - r.width - 4));
          if (cfg.y != null) cfg.y = clamp(cfg.y, 4, Math.max(4, window.innerHeight - r.height - 4));
          applyCfgPosition();
        } catch (e) {}
      }, 180);
      window.addEventListener('resize', rz);
      document.addEventListener('visibilitychange', function () {
        try {
          if (document.hidden) {
            FX.setPaused(true);
            SFX.suspend();
          } else {
            if (!ui.hidden) FX.setPaused(false);
            SFX.resume();
            layoutScene();
            pollState();
          }
        } catch (e) {}
      });
      /* 首次手势解锁音频 */
      var unlock = function () { try { SFX.unlock(); } catch (e) {} };
      document.addEventListener('pointerdown', unlock, true);
      document.addEventListener('keydown', unlock, true);
    } catch (e) {}
  }

  /* ==========================================================================
   * 16. 启动 / 页面检测 / 预览演示 / 调试接口
   * ========================================================================*/
  function isChatRoot(r) {
    if (!r || !r.querySelector) return false;
    return !!(
      r.querySelector('textarea') ||
      r.querySelector('[contenteditable="true"]') ||
      r.querySelector('[data-composer-input]') ||
      r.querySelector('[data-composer-seat],[data-composer-card]') ||
      r.querySelector('[role="textbox"][aria-multiline="true"]')
    );
  }

  function finishBoot() {
    try {
      setTimeout(function () { try { probeAssets(); } catch (e) {} }, 1400);
      /* 预览/QA 模拟 404 时尽早给出一次提示（正常宿主不会命中） */
      try { if (window.__SMOKE_FORCE_ASSET_FAIL) setTimeout(function () { try { noteAssetFailure(); } catch (e) {} }, 350); } catch (e) {}
      var loading = rootEl && rootEl.querySelector('#smk-loading');
      if (loading) loading.classList.add('gone');
      updateChrome();
      updateButtons();
      startStateTimers();
      layoutScene();
      if (IS_PREVIEW) {
        setTimeout(function () {
          try {
            if (!DEMO && brands.version !== 'fallback' && (cfg.introCount || 0) < 3) {
              cfg.introCount = (cfg.introCount || 0) + 1;
              saveConfigSoon();
              showHint('想抽烟又不能在工位 / 公共场所抽？点一支虚拟烟顶一下 —— emoking 帮你少抽真烟、减少二手烟。', '开盒', function () { openPack(); }, 10000);
            }
          } catch (e) {}
        }, 1800);
      }
    } catch (e) {}
  }

  function initWidget() {
    try {
      if (booted) return;
      booted = true;
      injectStyles();
      loadData(function () {
        ensureBrands(function () {
          try { readBrandData(); } catch (e) {}
          ensurePackImages(function () {
          try {
            product = resolveInitialProduct();
            state.packRemaining = productRemaining(product);
            state.autoOn = !!cfg.autoPuff;
            state.autoSec = cfg.autoPuffSec || 6;
            state.buttCount = 0;
            buildWidgetDOM();
            applyTheme();
            watchTheme();
            applyCfgPosition();
            setScale(cfg.scale || 1, false);
            applyConfigFlags();
            FX.init(canvasEl);
            FX.setEmitters(computeTip, computeMouth);
            if (IS_PREVIEW && getParam('fx') === 'off') FX.setPaused(true);
            applyProduct(product);
            renderButts();
                  setPhase(PHASE.IDLE);
            updateButtons();
            bindSceneEvents();
            bindDrag();
            bindPanelEvents();
            bindMenuEvents();
            bindHintEvents();
            bindGlobalEvents();
            SFX.prefetch();
            finishBoot();
            if (IS_PREVIEW) runDemo();
          } catch (e) {
            try { console.warn('[smoke] init failed', e); } catch (e2) {}
          }
          });
        });
      });
    } catch (e) {
      try { console.warn('[smoke] boot failed', e); } catch (e2) {}
    }
  }

  function getParam(name) {
    try {
      var q = location.search || '';
      var m = q.match(new RegExp('[?&]' + name + '=([^&]*)'));
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    } catch (e) { return null; }
  }

  function firstCigarId() {
    try {
      for (var i = 0; i < brands.products.length; i++) {
        if (cigSpec(brands.products[i]).isCigar) return brands.products[i].id;
      }
    } catch (e) {}
    return brands.products[0] ? brands.products[0].id : null;
  }
  function doPuffCigOut() {
    try { if (state.phase === PHASE.OUT) { layoutCig('lying'); refreshCigVisual(); setCigMode('lying'); } } catch (e) {}
  }

  function runDemo() {
    try {
      DEMO = (getParam('demo') || '').toLowerCase();
      if (!DEMO) return;
      var themeParam = (getParam('theme') || '').toLowerCase();
      if (themeParam === 'light') {
        try {
          document.documentElement.setAttribute('data-theme', 'light');
          document.documentElement.classList.add('preview-light');
          if (document.body) document.body.classList.add('preview-light');
          applyTheme();
        } catch (e) {}
      }
      window.__SMOKE_DEMO = DEMO;
      var after = function (ms, fn) { setTimeout(function () { try { fn(); } catch (e) {} }, ms); };
      var doPanel = function (kind) {
        try {
          var tabParam = (getParam('tab') || '').toLowerCase();
          if (kind === 'cabinet' && tabParam) {
            for (var ti = 0; ti < CAB_TABS.length; ti++) {
              if (CAB_TABS[ti].key === tabParam) { cabinet.tab = tabParam; break; }
            }
          }
          var sq = getParam('search');
          if (kind === 'cabinet' && sq) cabinet.q = sq;
        } catch (e) {}
        after(420, function () { openPanel(kind); });
      };
      var baseLight = function () {
        after(300, openPack);
        after(900, takeCig);
        after(1450, lightCig);
      };
      var holdFor = function (startMs, durMs) {
        after(startMs, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
        if (durMs > 0) after(startMs + durMs, function () { if (state.inhaling) endInhale('demo-release'); });
      };
      if (DEMO === 'pack' || DEMO === 'packgone') {
        after(500, openPack);
        after(1300, takeCig);
      } else if (DEMO === 'smoke') {
        baseLight();
        holdFor(2500, 1000);
        holdFor(4300, 1500);
      } else if (DEMO === 'hold' || DEMO === 'v2-hold') {
        baseLight();
        holdFor(2400, 0);
      } else if (DEMO === 'release-light' || DEMO === 'v2-release-light') {
        baseLight();
        holdFor(2500, 1500);
      } else if (DEMO === 'release-heavy' || DEMO === 'v2-release-heavy') {
        baseLight();
        holdFor(2500, 4000);
      } else if (DEMO === 'cough' || DEMO === 'v2-cough') {
        baseLight();
        after(2300, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
        after(4600, function () { state.coughPending = true; if (state.inhaling) endInhale('demo-cough'); });
        after(4700, function () { if (state.phase === PHASE.LIT) doCough(7); });
      } else if (DEMO === 'ash' || DEMO === 'v2-ash') {
        baseLight();
        after(2400, function () {
          state.ash = 0.88;
          refreshCigVisual();
          updateButtons();
          scheduleAshDrop();
        });
      } else if (DEMO === 'burn' || DEMO === 'v2-burn') {
        baseLight();
        after(2400, function () {
          state.ash = 0.9;
          refreshCigVisual();
          state.lastEvent = 'ash';
        });
        after(2900, function () {
          if (state.phase === PHASE.LIT) forceBurn();
        });
      } else if (DEMO === 'putout' || DEMO === 'v2-putout') {
        baseLight();
        holdFor(2400, 900);
        after(3700, function () { if (state.phase === PHASE.LIT) extinguish(); });
      } else if (DEMO === 'v3-idle') {
        /* 无动作：展示真实烟盒 */
      } else if (DEMO === 'v3-open') {
        after(400, openPack);
        after(900, doPuffCigOut);
      } else if (DEMO === 'v3-taken') {
        after(300, openPack);
        after(1000, takeCig);
      } else if (DEMO === 'v3-hold') {
        baseLight();
        holdFor(2300, 0);
      } else if (DEMO === 'v3-release-light') {
        baseLight();
        holdFor(2400, 1100);
      } else if (DEMO === 'v3-release-heavy') {
        baseLight();
        holdFor(2400, 4000);
      } else if (DEMO === 'v3-ash') {
        baseLight();
        after(2300, function () {
          state.ash = 0.9;
          refreshCigVisual();
          updateButtons();
          scheduleAshDrop();
        });
      } else if (DEMO === 'v3-burn-hand') {
        baseLight();
        after(2400, function () { forceBurnMode('hand'); });
      } else if (DEMO === 'v3-burn-mouth') {
        baseLight();
        after(2400, function () { forceBurnMode('mouth'); });
      } else if (DEMO === 'v3-shake') {
        baseLight();
        after(2300, function () { state.ash = 0.6; refreshCigVisual(); flickAsh(); });
      } else if (DEMO === 'v3-cigar-open') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(700, openPack);
      } else if (DEMO === 'v3-cigar-cut') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(600, openPack);
        after(1200, takeCig);
        after(1900, toastCigar);
      } else if (DEMO === 'v3-cigar-light') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(600, openPack);
        after(1200, takeCig);
        after(1800, toastCigar);
        after(2700, function () { if (state.phase === PHASE.TAKEN) lightCig(); });
      } else if (DEMO === 'v3-cigar-hold') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(600, openPack);
        after(1200, takeCig);
        after(1800, toastCigar);
        after(2700, function () { if (state.phase === PHASE.TAKEN) lightCig(); });
        after(4200, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v3-panel') {
        doPanel('cabinet');
      } else if (DEMO === 'v4-idle') {
        /* 空闲 */
      } else if (DEMO === 'v4-open') {
        after(400, openPack);
      } else if (DEMO === 'v4-taken') {
        after(300, openPack);
        after(1000, takeCig);
      } else if (DEMO === 'v4-hold') {
        baseLight(); holdFor(2300, 0);
      } else if (DEMO === 'v4-release-light') {
        baseLight(); holdFor(2400, 1100);
      } else if (DEMO === 'v4-release-heavy') {
        baseLight(); holdFor(2400, 4000);
      } else if (DEMO === 'v4-ash') {
        baseLight();
        after(2300, function () { state.ash = 0.9; refreshCigVisual(); updateButtons(); scheduleAshDrop(); });
      } else if (DEMO === 'v4-burn') {
        baseLight();
        after(2600, function () { if (state.phase === PHASE.LIT) forceBurnMode('hand'); });
      } else if (DEMO === 'v4-cigar-big') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(700, openPack);
        after(1400, takeCig);
        after(2100, toastCigar);
        after(3100, function () { if (state.phase === PHASE.TAKEN) lightCig(); });
        after(5000, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v4-hidden-dot') {
        after(900, hideWidget);
      } else if (DEMO === 'v4-panel') {
        doPanel('cabinet');
      } else if (DEMO === 'v9-ember-clean') {
        baseLight();
        after(2600, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v9-smoke-spread') {
        baseLight(); holdFor(2400, 4200);
      } else if (DEMO === 'v9-open-real') {
        after(300, openPack);
      } else if (DEMO === 'v9-cigar-cut-real') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(700, openPack);
        after(1400, takeCig);
        after(2100, cutCigar);
      } else if (DEMO === 'v9-achievements') {
        doPanel('stats');
      } else if (DEMO === 'v8-ember-natural') {
        baseLight();
        after(2600, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v8-smoke-heavy2') {
        baseLight(); holdFor(2400, 4200);
      } else if (DEMO === 'v8-take-clear') {
        after(300, openPack);
      } else if (DEMO === 'v8-hand-up') {
        after(300, openPack);
        after(1000, takeCig);
      } else if (DEMO === 'v8-nocount') {
        after(500, function () { /* 只展示无计数标签的烟灰缸 */ });
      } else if (DEMO === 'v7-tip-ember') {
        baseLight();
        after(2600, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v7-exhale-center') {
        baseLight(); holdFor(2400, 1100);
      } else if (DEMO === 'v7-hand-large') {
        after(300, openPack);
        after(1000, takeCig);
      } else if (DEMO === 'v7-cigar-smoke') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(700, openPack);
        after(1400, takeCig);
        after(2100, toastCigar);
        after(3100, function () { if (state.phase === PHASE.TAKEN) lightCig(); });
        after(4500, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v6-photo-ember') {
        baseLight();
        after(2600, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v6-smoke-light') {
        baseLight(); holdFor(2400, 900);
      } else if (DEMO === 'v6-smoke-heavy') {
        baseLight(); holdFor(2400, 4200);
      } else if (DEMO === 'v6-cigar-full') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(700, openPack);
        after(1400, takeCig);
        after(2100, toastCigar);
        after(3100, function () { if (state.phase === PHASE.TAKEN) lightCig(); });
      } else if (DEMO === 'v5-menu') {
        after(700, function () {
          var r = widgetEl.getBoundingClientRect();
          openMenu(r.right - 150, r.top - 250);
        });
      } else if (DEMO === 'v5-hidden') {
        after(600, hideWidget);
      } else if (DEMO === 'v5-nozoom') {
        after(700, function () { toast('已删除缩放条，缩放请去设置', 2000); });
      } else if (DEMO === 'v5-glass') {
        after(500, function () { state.buttCount = 3; renderButts(); });
      } else if (DEMO === 'v5-autoff') {
        baseLight();
        after(2600, function () { state.idleTimeoutSec = 3; });
      } else if (DEMO === 'v5-burn-a') {
        baseLight();
        after(2400, function () { state.progress = 0.16; state.ash = 0.22; refreshCigVisual(); updatePhotoBurn(); });
      } else if (DEMO === 'v5-burn-b') {
        baseLight();
        after(2400, function () { state.progress = 0.46; state.ash = 0.78; refreshCigVisual(); updatePhotoBurn(); FX.ashBurst(6); });
      } else if (DEMO === 'v5-cabinet-large') {
        after(300, function () { cfg.cabinetW = 700; openPanel('cabinet'); });
      } else if (DEMO === 'v5-hand-regular') {
        baseLight();
        after(2400, function () { startInhale('demo'); });
      } else if (DEMO === 'v5-hand-slim') {
        after(200, function () { switchProduct('zhonghua-slim-5mg'); });
        after(900, openPack);
        after(1600, takeCig);
        after(2400, function () { if (state.phase === PHASE.TAKEN) lightCig(); });
        after(3400, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'v5-hand-cigar') {
        after(200, function () { switchProduct(firstCigarId(), true); });
        after(700, openPack);
        after(1400, takeCig);
        after(2100, toastCigar);
        after(3100, function () { if (state.phase === PHASE.TAKEN) lightCig(); });
        after(4500, function () { if (state.phase === PHASE.LIT) startInhale('demo'); });
      } else if (DEMO === 'panel' || DEMO === 'cabinet') {
        doPanel('cabinet');
      } else if (DEMO === 'settings') {
        doPanel('settings');
      } else if (DEMO === 'stats') {
        doPanel('stats');
      } else if (DEMO === 'waiting') {
        try {
          var since = nowMs() - 26000;
          window.__SMOKE_MOCK_STATE = {
            ok: true, now: nowMs(), version: WIDGET_VERSION,
            turn: { running: true, since: since, sessionTitle: '正在写代码' },
            waiting: null
          };
          after(500, pollState);
          after(900, function () {
            if (state.phase === PHASE.IDLE) showHint('任务还在跑，虚拟顶一下？', '虚拟顶一下', hintStartSmoke, 0);
          });
        } catch (e) {}
      } else if (DEMO === 'menu') {
        after(500, function () {
          var r = widgetEl.getBoundingClientRect();
          openMenu(r.right - 150, r.top - 250);
        });
      } else if (DEMO === 'smokelit') {
        baseLight();
        holdFor(2100, 800);
      }
    } catch (e) {}
  }

  /* QA / 预览调试：确定性演出入口 */
  function forceBurn() {
    try {
      state.ash = 0.9;
      refreshCigVisual();
      burnHurt();
      state.lastEvent = 'burn';
    } catch (e) {}
  }

  /* 预览页 / QA 调试接口 */
  function exposeDebug() {
    try {
      window.__SMOKE_WIDGET = {
        version: WIDGET_VERSION,
        getState: function (opts) {
          var packOp = 1;
          try {
            if (packWrap && packWrap.classList.contains('smk-pack-away')) packOp = 0;
            else if (packWrap) {
              var cs = window.getComputedStyle(packWrap);
              packOp = cs.opacity === '' ? 1 : parseFloat(cs.opacity);
            }
          } catch (e) {}
          var result = {
            mode: host.mode,
            products: brands.products.length,
            productId: product && product.id,
            phase: state.phase,
            puffs: state.puffs,
            progress: +state.progress.toFixed(2),
            packRemaining: state.packRemaining,
            panel: ui.panel,
            demo: DEMO,
            particles: FX.stats(),
            stage: stageEl ? { w: stageEl.clientWidth, h: stageEl.clientHeight } : null,
            cig: cigLayout,
            tip: computeTip(),
            mouth: computeMouth(),
            emit: (function () { try { return { x: 0.5, y: cigSpec(product).isCigar ? 0.45 : 0.44 }; } catch (e) { return { x: 0.5, y: 0.44 }; } })(),
            particlePoints: (function () { try { return FX.particlePoints ? FX.particlePoints(240) : []; } catch (e) { return []; } })(),
            smokePuffs: (function () { try { return FX.puffInfo ? FX.puffInfo() : []; } catch (e) { return []; } })(),
            achievements: (function () { try { var defs = achievementDefs(); var n = 0; for (var i = 0; i < defs.length; i++) if (stats.achievements[defs[i].key]) n++; return { unlocked: n, total: defs.length }; } catch (e) { return { unlocked: 0, total: 0 }; } })(),
            counters: { opens: stats.opens || 0, flicks: stats.flicks || 0, handBurns: stats.handBurns || 0, cigars: stats.cigars || 0, cigarCuts: stats.cigarCuts || 0 },
            allParticles: (function () { try { return FX.particlePoints ? FX.particlePoints(240, ['exhale', 'wisp', 'ambient', 'other']) : []; } catch (e) { return []; } })(),
            /* v2 新增 */
            inhaling: !!state.inhaling,
            holdMs: Math.round(state.inhaling ? (nowMs() - state.inhaleStart) : (state.inhaleHeld || 0) * 1000),
            holdTier: state.inhaleTier || 0,
            ash: +(state.ash || 0).toFixed(3),
            ashDrops: state.ashDrops || 0,
            burned: !!state.burned,
            throat: +(state.throat || 0).toFixed(2),
            cough: !!state.coughPending,
            packVisible: packOp > 0.05,
            packOpacity: +packOp.toFixed(2),
            handVisible: !!(handEl && handEl.classList.contains('on')),
            hasPackPhoto: !!packPhotoShown,
            packPhotoCandidate: !!packImageFor(product),
            hasCigPhoto: !!cigImageFor('lit'),
            hasHandPhoto: !!handImageFor(),
            lastEvent: state.lastEvent || '',
            burnKind: state.burnKind || '',
            buttCount: stats.buttCount || 0,
            autoExtinguishInSec: (function () {
              try {
                if (state.phase !== PHASE.LIT) return 0;
                var sp = cigSpec(product);
                var lim = state.idleTimeoutSec > 0 ? state.idleTimeoutSec : (sp.isCigar ? 90 : 60);
                var elapsed = (nowMs() - (state.lastPuffAt || state.litAt || nowMs())) / 1000;
                return Math.max(0, Math.ceil(lim - elapsed));
              } catch (e) { return 0; }
            })(),
            format: (function () { try { return cigSpec(product).fmt; } catch (e) { return ''; } })(),
            diameterMm: (function () { try { return +cigSpec(product).diameter.toFixed(1); } catch (e) { return 0; } })(),
            lengthMm: (function () { try { return cigSpec(product).length; } catch (e) { return 0; } })(),
            isCigar: (function () { try { return cigSpec(product).isCigar; } catch (e) { return false; } })(),
            log: SMK_LOG.slice(-12)
          };
          /* lean 模式：跳过体积大的调试字段，避免 CDP eval 命令行超长 */
          if (opts === 'lean' || (opts && opts.lean)) {
            delete result.particlePoints;
            delete result.allParticles;
            delete result.smokePuffs;
            delete result.log;
          }
          return result;
        },
        openPanel: openPanel,
        closePanel: closePanel,
        openPack: openPack,
        takeCig: takeCig,
        light: lightCig,
        puff: doPuff,
        /* v2：长按吸气 API（QA 可 --eval 调用） */
        holdStart: function (ms) { startInhale('api'); if (ms) doPuff(ms); },
        holdEnd: function () { endInhale('api-holdEnd'); },
        setAsh: function (v) { state.ash = clamp(+v || 0, 0, 1); refreshCigVisual(); updateButtons(); return state.ash; },
        forceDrop: function () { dropAsh(false); },
        autoDrop: function () { dropAsh(true); },
        forceBurn: forceBurn,
        flick: flickAsh,
        forceCough: function () { state.coughPending = true; if (state.inhaling) endInhale(); else doCough(7); },
        setRealism: function (v) { return true; },
        extinguish: extinguish,
        switchProduct: switchProduct,
        showHint: showHint,
        setMockState: function (s) { window.__SMOKE_MOCK_STATE = s; pollState(); },
        /* 音频自检：等 1.2s 后返回解码结果（QA/冒烟用） */
        audioTest: function () {
          return new Promise(function (resolve) {
            try {
              SFX.unlock();
              setTimeout(function () {
                try { resolve(SFX.status()); } catch (e) { resolve({ error: String(e && e.message || e) }); }
              }, 1200);
            } catch (e) { resolve({ error: String(e && e.message || e) }); }
          });
        },
        audioStatus: function () { return SFX.status(); },
        forceBurn: function (kind) { return forceBurnMode(kind); },
        hide: function () { hideWidget(); return true; },
        openMenu: function (x, y) { openMenu(x, y); return true; },
        closeMenu: function () { closeMenu(); return true; },
        toggleMenu: function () { if (menuOpen) closeMenu(); else openMenu(); return true; },
        show: function () { showWidget(); return true; },
        setProgress: function (v) { state.progress = clamp(+v || 0, 0, 0.66); refreshCigVisual(); return state.progress; },
        setIdleTimeout: function (sec) { state.idleTimeoutSec = Math.max(0, +sec || 0); return state.idleTimeoutSec; },
        seedStats: function (obj) {
          try {
            obj = obj || {};
            ['opens', 'flicks', 'handBurns', 'cigars', 'cigarCuts', 'nightSmokes', 'late2'].forEach(function (k) { if (obj[k] != null) stats[k] = Math.max(0, Math.floor(+obj[k] || 0)); });
            if (obj.totalSmoked != null) stats.total.smoked = Math.max(0, +obj.totalSmoked || 0);
            if (obj.products && typeof obj.products === 'object') stats.products = obj.products;
            if (obj.days && typeof obj.days === 'object') stats.days = obj.days;
            checkAchievements(true);
            saveStatsSoon();
            return { unlocked: Object.keys(stats.achievements || {}).length };
          } catch (e) { return { error: String(e) }; }
        },
        forceAchievements: function () { try { return checkAchievements(true).map(function (d) { return d.key; }); } catch (e) { return []; } },
        setButtCount: function (n) { stats.buttCount = Math.max(0, Math.floor(+n || 0)); renderButts(); if (ui.panel === 'stats') renderPanel('stats'); return stats.buttCount; },
        cutCigar: function () { return cutCigar(); },
        toastCigar: function () { return toastCigar(); },
        cigarStep: function (step) {
          try {
            if (!firstCigarId()) return false;
            if (step === 'open') { switchProduct(firstCigarId(), true); setTimeout(openPack, 400); }
            else if (step === 'take') takeCig();
            else if (step === 'cut') { if (state.phase === PHASE.TAKEN) lightCig(); }
            else if (step === 'light') { if (state.phase === PHASE.TAKEN) { state.cigarCutted = true; lightCig(); } }
            else if (step === 'hold') { if (isLit()) startInhale('api'); }
            return true;
          } catch (e) { return false; }
        },
        firstCigarId: function () { return firstCigarId(); },
        particles: function () { return FX.stats(); }
      };
    } catch (e) {}
  }

  function start() {
    try {
      exposeDebug();
      if (IS_PREVIEW) {
        var bootPreview = function () {
          try { initWidget(); } catch (e) {}
        };
        if (document.body) bootPreview();
        else document.addEventListener('DOMContentLoaded', bootPreview);
        return;
      }
      /* 宿主：只在 DSH 聊天主界面初始化（composer 检测） */
      if (isChatRoot(document.getElementById('root')) || isChatRoot(document.body)) {
        initWidget();
        return;
      }
      var started = false;
      var startOnce = function () {
        if (started) return;
        started = true;
        try { initWidget(); } catch (e) {}
      };
      try {
        if (typeof MutationObserver === 'function') {
          var mo = new MutationObserver(function () {
            try {
              if (isChatRoot(document.getElementById('root')) || isChatRoot(document.body)) {
                try { mo.disconnect(); } catch (e) {}
                startOnce();
              }
            } catch (e) {}
          });
          mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
        }
      } catch (e) {}
      var pollId = setInterval(function () {
        if (isChatRoot(document.getElementById('root')) || isChatRoot(document.body)) {
          clearInterval(pollId);
          startOnce();
        }
      }, 1800);
    } catch (e) {}
  }

  start();

  /*__SMK_EOF__*/
})();
