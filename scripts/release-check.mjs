#!/usr/bin/env node
/**
 * 发布前自检（release gate）
 * 用法：node scripts/release-check.mjs
 * 可选：RELEASE_TAG=v0.10.0 node scripts/release-check.mjs   # 校验 tag 与 version 一致
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fails = []
const warns = []
const passes = []

const P = (...p) => path.join(ROOT, ...p)
const exists = (...p) => fs.existsSync(P(...p))
const read = (...p) => fs.readFileSync(P(...p), 'utf8')
const ok = (cond, msg) => (cond ? passes.push(msg) : fails.push(msg))
const warn = (cond, msg) => (cond ? passes.push(msg) : warns.push(msg))

// ---------- 基础文件 ----------
const required = [
  'package.json', 'cordis.patch.yml', 'icon.png', 'lib/index.js',
  'assets/smoke-widget.js', 'assets/brands.js', 'assets/pack-images.js',
  'README.md', 'CREDITS.md', 'CHANGELOG.md', 'LICENSE',
  '.gitignore', 'demo.gif', 'docs/screenshots'
]
for (const f of required) ok(exists(f), `存在 ${f}`)

// ---------- package.json ----------
let pkg = null
try {
  const raw = read('package.json')
  ok(raw.charCodeAt(0) !== 0xfeff, 'package.json 无 UTF-8 BOM')
  pkg = JSON.parse(raw)
  ok(true, 'package.json 可解析')
} catch (e) {
  fails.push('package.json 解析失败：' + e.message)
}

if (pkg) {
  ok(pkg.name === 'emoking', 'package.name = emoking')
  ok(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version || ''), `package.version 合法（${pkg.version}）`)
  ok(pkg.license === 'MIT', 'package.license = MIT')
  ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'package 无运行时依赖')
  ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'package.dsh.bundle.patch 正确')
  ok(pkg.icon === './icon.png', 'package.icon 指向 icon.png')
  ok(pkg.publishConfig && pkg.publishConfig.access === 'public', 'publishConfig.access = public')
  ok(pkg.engines && pkg.engines.node === '>=20.19', 'engines.node 已声明')
  const files = pkg.files || []
  for (const need of ['lib', 'assets', 'icon.png', 'cordis.patch.yml', 'README.md', 'CREDITS.md', 'LICENSE']) {
    ok(files.includes(need), `package.files 包含 ${need}`)
  }
  const placeholder = /YOUR_GITHUB_USER/.test(JSON.stringify(pkg) + read('README.md') + read('LICENSE'))
  warn(!placeholder, placeholder ? '仓库元数据含占位符（运行 node scripts/init-repo.mjs --owner <用户名> 替换）' : '仓库元数据占位符已替换')
}

// ---------- 本地路径 / 敏感信息 ----------
const textFiles = [
  'package.json', 'README.md', 'CREDITS.md', 'LICENSE', 'cordis.patch.yml',
  'lib/index.js', 'assets/smoke-widget.js', 'assets/brands.js', 'assets/pack-images.js'
]
const localPathRe = /[A-Za-z]:[\\\\/]Users[\\\\/]|34767/
for (const f of textFiles) {
  try {
    const t = read(f)
    ok(!localPathRe.test(t), `${f} 不含本机绝对路径/个人信息`)
  } catch { fails.push(`无法读取 ${f}`) }
}

// ---------- 禁止混入的本地目录 ----------
for (const d of ['香烟图鉴', 'photo-candidates', '.test-home', '.lead-test-home', 'node_modules', '.smoke-install-backup']) {
  ok(!exists(d), `仓库根未包含本地目录 ${d}/`)
}
const gi = read('.gitignore')
for (const ig of ['香烟图鉴/', 'photo-candidates/', '.test-home/', 'node_modules/']) {
  ok(gi.includes(ig), `.gitignore 忽略 ${ig}`)
}

// ---------- README 必备内容 ----------
const readme = read('README.md')
ok(/dsh plugin --profile web add/.test(readme), 'README 含 Web 安装命令（dsh plugin --profile web add）')
ok(readme.includes('CREDITS.md'), 'README 链接 CREDITS.md')
ok(readme.includes('吸烟有害健康'), 'README 含健康提示')
ok(/takedown|删除/.test(readme), 'README 含素材下架/删除说明')
ok(readme.includes('docs/screenshots/'), 'README 引用截图')
// 截图引用文件存在
const shotRefs = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]).filter(s => s.startsWith('docs/'))
for (const s of shotRefs) ok(exists(s), `截图存在：${s}`)

// ---------- 素材完整性 ----------
const imgDir = P('assets', 'img')
const imgs = fs.readdirSync(imgDir).filter(f => f.endsWith('.png'))
const packs = imgs.filter(f => /^pack-.+\.png$/.test(f))
ok(packs.length === 33, `真实烟盒图 33 张（实际 ${packs.length}）`)
for (const need of ['ashtray.png', 'ashtray-cigar.png', 'cig-single.png', 'cigar.png', 'cigar-cutter.png', 'hand-regular.png', 'hand-slim.png', 'hand-cigar.png']) {
  ok(imgs.includes(need), `素材存在：assets/img/${need}`)
}
const audio = fs.readdirSync(P('assets', 'audio')).filter(f => f.endsWith('.wav'))
ok(audio.length === 25, `音效 25 个（实际 ${audio.length}）`)
ok(audio.includes('cough.wav'), '音效含 cough.wav')

// ---------- 数据 ----------
try {
  const ctx = { window: {} }
  vm.createContext(ctx)
  vm.runInContext(read('assets', 'brands.js'), ctx)
  vm.runInContext(read('assets', 'pack-images.js'), ctx)
  const brands = ctx.window.SMOKE_BRANDS
  const maps = ctx.window.SMOKE_PACK_IMAGES
  ok(Array.isArray(brands.products) && brands.products.length === 47, `品牌目录 47 SKU（实际 ${brands.products && brands.products.length}）`)
  ok(!('thoughts' in brands), '品牌数据不含 thoughts 字段')
  ok(Array.isArray(maps.svgFallback) && maps.svgFallback.length === 14, `SVG 回退 14 款（实际 ${maps.svgFallback && maps.svgFallback.length}）`)
  ok(Object.keys(maps.byProductId || {}).length === 33, '真实图映射 33 条')
} catch (e) {
  fails.push('品牌/映射数据读取失败：' + e.message)
}

// ---------- 版本 / tag ----------
if (pkg && process.env.RELEASE_TAG) {
  ok(process.env.RELEASE_TAG === 'v' + pkg.version, `RELEASE_TAG(${process.env.RELEASE_TAG}) 与 version(v${pkg.version}) 一致`)
}

// ---------- 输出 ----------
console.log('\n=== emoking 发布自检 ===\n')
for (const s of passes) console.log('  ✓ ' + s)
for (const s of warns) console.log('  ! ' + s)
for (const s of fails) console.log('  ✗ ' + s)
console.log(`\n通过 ${passes.length} · 警告 ${warns.length} · 失败 ${fails.length}`)
if (fails.length) {
  console.log('\n发布自检未通过，请修复以上失败项。')
  process.exit(1)
}
console.log('\n发布自检通过 ✓')
