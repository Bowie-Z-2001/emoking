# 发布指南 · Publishing emoking

从「本地通过」到「GitHub / npm / 插件市场可见」的完整流程。**发布是一次性对外动作，请先跑完自检再操作。**

---

## 0. 发布前自检

```bash
node scripts/release-check.mjs     # 必须全部 PASS（占位符提示除外）
npm pack --dry-run                 # 检查 npm 包内容（不应含 图鉴/photo-candidates/.test-home 等）
```

检查会校验：package 元数据、BOM、README 安装命令、截图/素材存在、本地路径与敏感目录是否混入、版本与占位符等。

---

## 1. 初始化仓库元数据

```bash
cd publish            # 本发布目录（publish/，仓库根）
node scripts/init-repo.mjs --owner <你的GitHub用户名> --author "<你的名字或昵称>"
```

会替换 `package.json` 的 repository/bugs/homepage、README 里的 `YOUR_GITHUB_USER`、LICENSE 里的 `YOUR_NAME`。

然后：

```bash
git init
git add -A
git commit -m "chore: initial public release v0.10.0"
git branch -M main
git remote add origin https://github.com/<owner>/emoking.git
git push -u origin main
```

### 仓库设置（GitHub）

- **Public** 仓库（私有仓库无法被插件市场索引）；
- **Topics** 至少添加：`dsh-plugin`、`deepseek-harness`、`dsh`、`widget`、`simulation`（市场按 `dsh-plugin` topic 扫描收录）；
- Description 建议：`模拟抽烟解闷挂件 · Real-photo cigarette simulation widget for DeepSeek Harness (DSH) — hold to inhale, release to exhale, ash, 18 achievements.`
- 首屏确认 README 渲染正常、demo.gif 与截图可见。

### 打 Release（tag 必须与 package.json.version 一致）

```bash
git tag v0.10.0
git push origin v0.10.0
# GitHub → Releases → Draft a new release → 选择 v0.10.0 → 发布（可附 zip）
```

> 版本纪律：正式版 `x.y.z` → npm `latest`；预发布 `x.y.z-beta.1` → npm `next`/`alpha` dist-tag。**GitHub tag 必须等于 `v${package.json.version}`。**

---

## 2. 发布到 npm

包名 `emoking` 当前在 npm 未被占用（发布前可再确认：`npm view emoking version`，404 即可用）。

```bash
npm login                     # 需要 npm 账号（建议开启 2FA）
npm whoami
npm publish --access public   # publishConfig 已设 public
```

发布后验证：

```bash
npm view emoking version
npm view emoking dist-tags
```

注意事项：

- `files` 白名单只包含 `lib/ assets/ icon.png cordis.patch.yml README.md CREDITS.md LICENSE`，不会把仓库其他内容带进 npm 包；
- 不要提交任何 `.npmrc`、token、会话日志；发布前 `git status` 检查；
- 首次发布即 0.10.0；之后每次发布先跑 `release-check`，且 tag/version 同步；
- 后悔药：72 小时内可 `npm unpublish emoking@0.10.0`（有使用量后不可）；更推荐 `npm deprecate`。

---

## 3. 安装验证（必须做）

### Web / CLI

```bash
dsh plugin --profile web add emoking
# 或 github:<owner>/emoking
dsh web        # 重启后打开浏览器
```

### 桌面端

DSH 桌面端不能用 CLI 管理 `desktop` profile：打开 DSH → 侧栏「插件」→「添加插件」→ 粘贴仓库地址或 npm 包名 → 完成后**完全退出 DSH（含托盘）再打开**。

### 验收清单

- [ ] 右下角出现悬浮烟盒，点开有开盒动画；
- [ ] 取烟/点火/按住抽/松手吐烟/抖灰/掐灭 全流程可用；
- [ ] 烟柜（国烟/外烟/雪茄）、设置、缩放、账本可打开；
- [ ] 无 console 报错；卸载后正常消失、数据保留（默认）。

> 更严格的发布门禁（隔离 profile 冷启动）可参考 DSH 社区 `plugin-release` skill：
> <https://github.com/NanmiCoder/dsh-agent-teams/blob/main/skills/plugin-release/SKILL.md>

---

## 4. 提交到插件市场

插件市场是社区生态（非 DeepSeek 官方），主流收录方式：

1. **自动索引（最简单）**：仓库为 public 且带 `dsh-plugin` topic 后，[DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) 的 CI 每 2 小时扫描一次并收录，无需申请；[dshbase](https://dshbase.com/zh/plugins/directory/) 等目录也会扫描 topic。
2. **主动提交**：到 [DSH Plugin Hub 提交页](https://dsh-plugin.org/zh/submit) 填写仓库地址；免费、无审核费。收录初始状态为 `unconfirmed`，人工核实兼容性后变 `verified`。
   提交字段（名称/一句话简介/详细描述/标签/分类/截图/许可证/隐私声明）已整理在 [HUB-SUBMISSION.md](HUB-SUBMISSION.md)，可直接复制。
3. **精选列表**：可向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR 收录。
4. 提交前对照要求：公开仓库 ✔、`dsh-plugin` topic ✔、README 有可复制的安装命令 ✔、插件导出 `apply(ctx)` ✔、不冒充官方 ✔。

收录后可把市场徽章挂到 README（例如 dshbase 徽章），提高可信度。

---

## 5. 后续版本发布流程

```bash
# 1. 改代码 / 素材
# 2. 更新 CHANGELOG.md 与 package.json version
# 3. 自检
node scripts/release-check.mjs
npm pack --dry-run
# 4. 提交
git add -A && git commit -m "feat: ..." && git push
# 5. 打 tag + Release + npm
git tag vX.Y.Z && git push origin vX.Y.Z
npm publish
```

- 预发布：`npm publish --tag next`（或 `alpha`），GitHub Release 勾选 pre-release；
- 不要发布低于当前 `latest` 的版本号；发布失败优先回滚 tag/版本，不要用「补丁版本」掩盖问题；
- 大版本升级建议在 Release notes 写迁移说明（数据/配置兼容）。

---

## 6. 合规与素材注意（重要）

- 本仓库包含作者提供的真实烟盒/手部照片（来源不明）与 Wikimedia CC 素材。**代码 MIT，素材不适用 MIT**，详见 [CREDITS.md](CREDITS.md)。
- 公开仓库/包意味着再分发：请保留 CREDITS 署名与免责声明；对来源不明的照片，保留「权利人可要求删除」通道（GitHub Issues 标题 `[takedown]`）。
- 如果未来希望更彻底地规避风险，可切换到「仅代码 + SVG 参数化烟盒」发行版（README 说明用户可自行放入本地照片）；或把真实照片替换为 CC0/自制素材。
- 不要在任何渠道用本项目做烟草销售/推广；README 已包含 18+ 与健康提示。

---

## 7. 仓库结构

```
publish/                      ← 仓库根（= npm 包根）
├── package.json              # 包元数据 + dsh.bundle.patch
├── cordis.patch.yml          # DSH bundle 挂载声明
├── icon.png                  # 插件列表图标
├── lib/index.js              # 宿主半区：/smoke/* 路由、注入、持久化、任务状态
├── assets/
│   ├── smoke-widget.js       # 前端挂件（单文件原生 JS）
│   ├── brands.js             # 47 SKU 目录
│   ├── pack-images.js        # 真实烟盒/手图/雪茄剪映射
│   ├── audio/*.wav           # 25 个音效
│   └── img/*.png             # 33 张真实烟盒 + 手图/雪茄/烟灰缸/纹理
├── docs/screenshots/         # README 截图
├── docs/media/               # 宣传片/海报/分镜（promo）
├── demo.gif                  # README 演示
├── scripts/
│   ├── init-repo.mjs         # 替换 GitHub 用户名/作者占位符
│   └── release-check.mjs     # 发布自检
├── .github/workflows/ci.yml  # CI：语法 + 发布自检 + npm pack
├── LICENSE                   # 代码 MIT（素材见 CREDITS）
├── HUB-SUBMISSION.md         # DSH Plugin Hub 提交字段模板（名称/简介/tag/许可/隐私）
├── CREDITS.md                # 素材来源/许可/免责声明
├── CHANGELOG.md
├── SECURITY.md
└── README.md
```
