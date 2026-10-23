#!/usr/bin/env node
/**
 * 初始化公开仓库元数据：替换 GitHub 用户名 / 作者占位符
 * 用法：node scripts/init-repo.mjs --owner <GitHub用户名> [--repo emoking] [--author "<作者名>"]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const get = (name, def) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}

const owner = get('owner')
const repo = get('repo', 'emoking')
const author = get('author', owner)

if (!owner) {
  console.error('用法：node scripts/init-repo.mjs --owner <GitHub用户名> [--repo emoking] [--author "<作者名>"]')
  process.exit(1)
}
if (!/^[A-Za-z0-9-]+$/.test(owner)) {
  console.error('GitHub 用户名不合法：' + owner)
  process.exit(1)
}

const base = `https://github.com/${owner}/${repo}`
const pkgPath = path.join(ROOT, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.repository = { type: 'git', url: `git+${base}.git` }
pkg.bugs = { url: `${base}/issues` }
pkg.homepage = `${base}#readme`
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')

const readmePath = path.join(ROOT, 'README.md')
let readme = fs.readFileSync(readmePath, 'utf8')
readme = readme.split('YOUR_GITHUB_USER').join(owner).split('YOUR_REPO').join(repo)
fs.writeFileSync(readmePath, readme, 'utf8')

const licensePath = path.join(ROOT, 'LICENSE')
let license = fs.readFileSync(licensePath, 'utf8')
license = license.split('YOUR_NAME').join(author)
fs.writeFileSync(licensePath, license, 'utf8')

console.log('已写入仓库元数据：')
console.log('  repository:', pkg.repository.url)
console.log('  homepage  :', pkg.homepage)
console.log('  author    :', author)
console.log('\n下一步：')
console.log('  git init && git add -A && git commit -m "chore: initial public release"')
console.log('  git branch -M main && git remote add origin ' + base + '.git')
console.log('  git push -u origin main')
console.log('  # 然后按 PUBLISHING.md 打 tag / 发布 npm / 提交插件市场')
