# DSH Plugin Hub 提交信息（可直接复制）

> 版本：**emoking v0.12.0** · 代码 MIT · 素材见 [CREDITS.md](CREDITS.md)
> 先把占位符替换掉：运行 `node scripts/init-repo.mjs --owner <你的GitHub用户名> --author "<你的名字>"`，或手动把 `YOUR_GITHUB_USER` / `YOUR_NAME` 换掉。

## 1. 基本字段

| 字段 | 填写内容 |
|---|---|
| 插件名（name） | `emoking` |
| 显示名（displayName） | emoking · 虚拟烟替代挂件 |
| 版本（version） | `0.12.0` |
| 一句话简介（tagline，≤ 60 字） | 用虚拟烟替代真烟：工位/公共场所顶一下烟瘾，少抽一支真烟，也少一份二手烟。 |
| 分类（category） | 桌面挂件 / 趣味解压 / 效率工具（按 Hub 实际分类择一） |
| 标签（tags） | `dsh-plugin`, `deepseek-harness`, `widget`, `desktop`, `simulation`, `quit-smoking`, `productivity` |
| 语言 | 中文（附英文简介） |
| 作者 | `YOUR_NAME` |
| 仓库（repo） | `https://github.com/YOUR_GITHUB_USER/emoking` |
| 主页（homepage） | `https://github.com/YOUR_GITHUB_USER/emoking` |
| 许可证（license） | 代码 MIT；素材非 MIT，见 CREDITS.md |
| 图标（icon） | `icon.png`（512×512） |
| 演示（demo） | `demo.gif` |
| 截图（screenshots） | `docs/screenshots/01-idle-ember.png` … `15-asset-fallback.png`（共 15 张，任选 4–8 张） |
| 宣传片（video） | `docs/media/emoking-promo.mp4`（47s / 1080p；公开发布建议用无声版并配授权音乐） |
| 安装命令（Web） | `dsh plugin --profile web add emoking`（npm 已发布 0.12.0；源码安装：`dsh plugin --profile web add github:Bowie-Z-2001/emoking`） |
| 安装方式（桌面） | DSH → 插件 → 添加插件 → 粘贴仓库地址 |
| 兼容性 | DSH 桌面版 0.2.1-rc.2 实测；Node ≥ 20.19；无需 API key |
| 更新日志 | `CHANGELOG.md` |
| 问题反馈 | GitHub Issues |

## 2. 简介（60 字内，审核列表用）

> 在 DSH 右下角放一包虚拟烟：开盒、取一支、按住抽、松手吐烟。用虚拟替代真烟，帮你在工位顶一下烟瘾，减少真实吸烟和二手烟。纯本地模拟，不含真实烟草。

## 3. 详细描述（详情页用，可直接粘贴）

**emoking 是一个给 DeepSeek Harness（DSH）用的「虚拟烟替代」桌面挂件。**

等 AI 跑任务、写代码、开会前的那几分钟，烟瘾上来又不能在工位/电梯/商场抽？打开 emoking，右下角悬浮一包真实烟盒照片：点开盒、取一支、按住吸气、松手吐烟；烟灰会变长、会掉，抽完把烟蒂按进玻璃烟灰缸。

它的定位不是「抽烟游戏」，而是**用虚拟烟替代真烟**：烟瘾上来时先点一支虚拟的顶一下，帮助减少真实吸烟；在不能吸烟的场所，用模拟代替真实吸烟，减少烟雾与二手烟污染。账本会记录「用虚拟烟替代真烟 N 支」，把「解闷」变成可量化的戒烟辅助。

**功能**
- 47 款烟 / 25 个品牌（33 张真实烟盒照片 + 14 款 SVG 回退），硬盒/软盒/细支/中支不同开盒动画
- 真实第一视角手部照片：按住吸气、松手吐烟，烟量随按住时长变化
- 烟头微光、烟灰生长/断落、可能烫手烫嘴；60 秒不抽自动熄灭
- 玻璃烟灰缸 / 雪茄烟熏缸；雪茄模式含真实雪茄剪「剪茄帽」动画
- 18 个成就 + 烟摊账本（含「替代真烟 N 支」统计）
- 可拖动、可缩放 0.7–2.0、可隐藏为小圆点、可换烟柜大小；跟着 DSH 任务状态显示等待时长
- 纯本地：不联网、不读凭据、不上传数据；配置与记录只写 `~/.dsh/smoke/`

**安装**
- 桌面版：DSH → 插件 → 添加插件 → 粘贴 `https://github.com/YOUR_GITHUB_USER/emoking`，安装后完全退出 DSH（含托盘）再打开
- Web / CLI：`dsh plugin --profile web add emoking`，重启 dsh web 并刷新页面

**说明**：18+；纯模拟娱乐，**不含真实烟草、不涉及任何烟草销售**；与 DeepSeek 及任何烟草品牌无隶属关系；**吸烟有害健康**，模拟不能替代专业戒烟治疗，烟瘾明显时建议咨询戒烟门诊或当地戒烟热线。

## 4. 英文简介（可选字段）

**emoking** — a small "simulated smoking" widget for DeepSeek Harness (DSH). It floats a real cigarette-pack photo in the bottom-right corner: open the pack, take a cigarette, hold to inhale, release to exhale, watch the ash build up and drop, extinguish in a glass ashtray. 47 SKUs / 25 brands (incl. one Cohiba cigar), real hand photos, real cigar-cutter animation, 18 achievements. Designed as a **virtual-cigarette substitute** to help reduce real smoking and second-hand smoke in offices/public places — not a smoking game, no real tobacco, not for sale. Simulation-only, 18+; tobacco is harmful to health.

Install (DSH Web): `dsh plugin --profile web add emoking`. Desktop: DSH → Plugins → Add plugin → paste the repo URL.

## 5. 权限 / 隐私声明（若 Hub 要求填写）

- **网络**：插件不发起任何外部网络请求；宿主提供的 HTTP 路由仅绑定本机回环，供挂件自身读取静态资源与状态。
- **文件读写**：仅写 `%USERPROFILE%\.dsh\smoke\`（macOS/Linux 为 `~/.dsh/smoke/`）下的 `config.json` / `stats.json`；不读取用户代码、对话内容或凭据。
- **会话监听**：仅监听 DSH 会话的「运行中 / 等待回答 / 结束」状态用于显示等待时长，不读取消息内容。
- **遥测**：无。

## 6. 素材与版权说明（审核可能询问）

- 代码 MIT；素材不适用 MIT，逐项来源与许可见 `CREDITS.md`。
- 内置 33 张真实烟盒图中：5 张来自 Wikimedia Commons（CC BY-SA / CC BY / Public domain，已按许可署名）；28 张为用户提供的个人图鉴素材（来源不明，仅个人模拟娱乐，权利人可要求删除）；手部照片为作者提供/自拍；咳嗽音效为作者录制；图标、纹理、音效为程序生成。
- 雪茄 / 单烟 / 雪茄剪 / 部分手图为 Wikimedia Commons 或作者素材。
- 若 Hub 对真实品牌包装有额外限制：可替换为仓库内已有的 **14 款 SVG 参数化烟盒**（`assets/pack-images.js` 的 `svgFallback`），我可以出一个「无商标版」构建。

## 7. 提交渠道与步骤

1. 先推送 GitHub 公开仓库并打 tag：`git tag v0.12.0 && git push origin v0.12.0`，创建 Release（上传 zip 可选）。
2. 给仓库加 topics：`dsh-plugin`、`deepseek-harness`、`dsh`、`widget`、`simulation`（会被 DSH-Plugins-Marketplace 等自动索引）。
3. 到以下渠道提交（填上面的字段）：
   - DSH Plugin Hub：<https://dsh-plugin.org/zh/submit>
   - dshbase 插件目录：<https://dshbase.com/zh/plugins/directory/>
   - GitHub `dsh-plugin` topic 自动索引（DSH-Plugins-Marketplace，约每 2 小时同步）
   - 可选：给 awesome-dsh 类列表提 PR
4. npm（Web CLI 安装需要）：`npm publish --access public`，确认 `emoking` 包名可用、版本与 tag 一致。
5. 提交后自查：README 截图/demo 能打开、安装命令可复制、许可证与免责声明齐全、无本地路径/凭据/私密文件。

## 8. 待办占位符

- [ ] `YOUR_GITHUB_USER` → 你的 GitHub 用户名（README、package.json、本文）
- [ ] `YOUR_NAME` → 作者署名（LICENSE/CREDITS/package.json）
- [ ] 建仓库并 push，打 `v0.12.0` tag
- [ ] 若有正式主页/演示链接，补到 homepage
- [x] 已发布 npm：`emoking@0.12.0`（`https://www.npmjs.com/package/emoking`）
- [ ] 决定宣传视频用带 BGM 版（版权音乐，仅本地）还是无声版+平台曲库
