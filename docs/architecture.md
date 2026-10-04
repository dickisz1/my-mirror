# 架构说明 (docs/architecture.md)

> 本文档描述**当前代码的真实架构**。此前版本曾描述"广告拦截层 + HTML 注入 + 自动阅读引擎 + DOM 沙箱 + Edge Runtime"，这些在代码中并不存在，已订正。若文档与代码冲突，以代码为准，并请同步修订本文档。

## 系统架构图

```
用户浏览器
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                      Vercel Edge Network                     │
│                                                               │
│  vercel.json (路由门卫)                                        │
│  └── /(.*) ─────────────────────────────────────┐             │
│                                                  │             │
│  functions: { includeFiles: manga_reader.html,   │             │
│               memory: 1024, maxDuration: 30 }    │             │
│  (未声明 runtime → 默认 Node.js 运行时)           │             │
└──────────────────────────────────────────────────┼─────────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│        api/proxy.js (Node.js Serverless Function, @vercel/node)   │
│                                                                   │
│  1. 请求路由 (handler)                                             │
│     ├── OPTIONS ──→ 204 + CORS                                    │
│     ├── 无 p 且路径 ∈ {/, /index.html, /manga_reader.html}         │
│     │        ──→ 返回 manga_reader.html（前端界面）                │
│     ├── /api/source/rules ──→ 返回书源规则 JSON                    │
│     ├── 匹配 /^\/en_images\// ──→ 图片处理                         │
│     ├── 匹配 ALLOWED_DATA（rules[*].match）──→ 数据转发            │
│     └── 其他 ──→ 404 JSON（no rule matched）                       │
│                                                                   │
│  2. 数据转发 (serveData)                                           │
│     ├── 目标 = BOOK_SOURCES.baseUrl + target + query               │
│     ├── 头：Referer / Origin / UA / Accept (upstreamHeaders)        │
│     ├── 跟随重定向（最多 3 次，fetchRaw）                           │
│     └── Cache-Control: no-store                                    │
│                                                                   │
│  3. 图片处理 (serveImage)                                          │
│     ├── 按 imageCdn 顺序依次重试，首个 200 即返回                   │
│     ├── 全部失败 ──→ 502 + tried[]（含每个域名失败原因）            │
│     ├── 魔数嗅探 sniffMime：明文图片直接下发                        │
│     └── 否则 AES-256-CBC 解密后下发                                │
│                                                                   │
│  4. 缓存策略                                                       │
│     ├── 图片: Cache-Control public, max-age=86400                  │
│     ├── /api/source/rules: public, max-age=300                     │
│     └── 数据/前端界面: no-store                                     │
└──────────────────────────────────────────────────────────────────┘
       │                                          │
       ▼                                          ▼
┌──────────────────┐                    ┌──────────────────────────┐
│  manwaxu.cc      │                    │  图片 CDN（备用链）        │
│  (数据源站点)     │                    │                          │
│                  │                    │  tu.mhttu.cc             │
│  /api/home       │                    │    └失败→ mwtuwu.cc       │
│  /api/search     │                    │    └失败→ tu.mwzu.cc      │
│  /api/comic/*    │                    │    └失败→ mwtusi.cc       │
│  /api/announce*  │                    │    └全失败→ 502           │
└──────────────────┘                    └──────────────────────────┘
                                                │
                                                ▼
                                ┌────────────────────────────────┐
                                │ 所有 CDN 返回 AES-256-CBC 密文   │
                                │ 前 16 字节 = IV，其余 = 密文     │
                                │ 代理端解密 → 下发明文图片        │
                                │ （已是明文则按魔数嗅探后原样下发）│
                                └────────────────────────────────┘
```

**代理端不存在的层（不要按旧文档实现）：** 广告拦截层（无 `AD_DOMAINS`）、HTML 响应注入、域名引用替换、`/__assets__/` 静态资源代理、`targetHost`。proxy 只返回 JSON 与图片，以及前端界面本身。

## 数据流

### 用户阅读漫画的完整请求链

```
1. 用户打开站点 (https://your-site.vercel.app)
   │
   ▼
2. vercel.json 拦截 → 路由到 api/proxy.js
   │
   ▼
3. handler 判定为首页请求 → 返回 manga_reader.html（readFrontend 读文件并缓存）
   │
   ▼
4. 浏览器渲染 HTML，执行 JS
   │
   ▼
5. JS 执行 boot():
   ├── loadRules() → GET /api/proxy?p=/api/source/rules → 用代理端权威规则覆盖内联默认值
   └── navigate('home') → 渲染首页
   │
   ▼
6. renderHome() → apiGet('/api/home', {page:1, pageSize:12, type:0, flag:1})
   │
   ▼
7. 请求到达 proxy.js:
   ├── handler 取 target=/api/home，匹配 ALLOWED_DATA
   ├── serveData → https://manwaxu.cc/api/home?page=1&pageSize=12&type=0&flag=1
   └── 原样返回 JSON（no-store）
   │
   ▼
8. 前端渲染漫画卡片列表
   │
   ▼
9. 用户点击漫画 → openDetail(id) → apiGet('/api/comic/{id}')
   │
   ▼
10. 获取详情 + 章节列表（/api/comic/{id}/chapters）→ 渲染详情页
    │
    ▼
11. 用户选章节 → openChapter(idx) → apiGet('/api/comic/image/{cid}', ...)
    │
    ▼
12. 获取图片列表 → 写入 state.flatImgs → 渲染图片（懒加载）
    │
    ▼
13. 图片滚动到可视区域 → IntersectionObserver 触发
    │
    ▼
14. 图片 URL 经 toProxyPath() 转为 /api/proxy?p=/en_images/... → 请求 proxy.js
    │
    ▼
15. proxy.js:
    ├── 匹配 imageRule（/^\/en_images\//）→ serveImage
    ├── 按 imageCdn 顺序取图，首个 200 即用
    ├── 魔数嗅探：明文 → 直接下发；密文 → AES-256-CBC 解密后下发
    └── 响应头带 X-Source-Host / X-Source-Decrypted / X-Source-Rule
    │
    ▼
16. 浏览器渲染图片
```

### 连续阅读模式的数据流

```
用户在阅读器点「📜 连续阅读」(toggleContinuous)
   │
   ▼
state.continuous = true；ensureSentinel() + setupContinuousLoader()
   │
   ▼
当前章节图片渲染完毕（state.flatImgs = 本章图片，下标 = data-i）
   │
   ▼
底部哨兵 #readerSentinel 进入视口（rootMargin 200px）
   │
   ▼
preloadNextChapter():
   ├── 去重：state.loadedChaps[nextIdx] 已存在则跳过
   ├── 并发锁：state.loadingNext 为真则跳过
   ├── apiGet('/api/comic/image/{下一话cid}') 取图片列表
   ├── 插入章节分隔标记 .chap-sep
   ├── 起始下标 = state.flatImgs.length（不是 DOM 计数）
   ├── 追加 <figure class="imgwrap"> 到 #readerArea 末尾
   ├── ensureSentinel() 把哨兵移回末尾
   ├── 图片追加进 state.flatImgs，并 observer.observe() 新图片
   └── state.chapIdx 前移，下栏 meta 更新为当前话
   │
   ▼
用户继续下滑 → 哨兵再次进入视口 → 自动加载再下一话（循环直到最后一话）
```

### 显示设置与章节跳转的数据流

```
用户点「🎨 设置」(toggleReaderTools)
   │
   ├── 图片宽度滑杆：#widthRange (30–100%) → setImgWidthPct(v)
   │     └── applyImgWidth()：给 #readerArea 加 w-pct，
   │         宽度取自 CSS 变量 --reader-w（vw 单位），
   │         并给 <body> 加 reader-wide 解除 .container 限宽
   │
   ├── 图片宽度预设：setImgWidth('fit'|'orig')
   │     └── fit = 800px 上限；orig = 原始像素（w-orig）
   │
   └── 亮度：setBrightness(30–130)
         └── applyBrightness()：设置 #readerArea 的 --reader-brightness
              CSS 变量 → filter:brightness()
   │
   ▼
saveReaderPrefs() → localStorage.manga_prefs {imgWidth, widthPct, brightness}
   │
   ▼
下次启动 boot() → loadReaderPrefs() → 恢复宽度模式与亮度
（旧值 imgWidth:'full' 自动迁移为 custom 100%）

用户点「📖 章节」(openJumpPanel)
   │
   ▼
按 state.chapters 渲染浮层列表，state.viewChapIdx 对应的项高亮
   │
   ▼
点某一话 → jumpToChapter(i) → closeJumpPanel() → openChapter(i)
（点当前话直接返回，不重新加载）
Esc 或点 ✕ → closeJumpPanel()
```

### 阅读器双栏自动隐藏的数据流

```
进入阅读器 navigate('reader') → enterReaderTopbar()
   │
   ├── bindTopbarAutoHide()：绑定 document mousemove / mouseleave + window blur（只绑一次）
   ├── 上栏：showHeaderBar() + scheduleHeaderHide()   → 2 秒后 hideHeaderBar()
   └── 下栏：showTopbar()    + scheduleTopbarHide()   → 2 秒后 hideTopbar()
   │
   ▼
鼠标移动 onReaderMouseMove(e)（仅 state.view === 'reader' 生效，两栏独立判断）
   │
   ├── 上栏（吸顶）：e.clientY <= 80
   │     ├── 是 → cancelHeaderHide() + showHeaderBar()
   │     └── 否且上栏可见 → scheduleHeaderHide()
   │
   └── 下栏（吸底）：window.innerHeight - e.clientY <= 80
         ├── 是 → cancelTopbarHide() + showTopbar()
         └── 否且下栏可见 → scheduleTopbarHide()
   │
   ▼
hideHeaderBar() / hideTopbar()
   ├── 若自身 :hover（鼠标还停在上面）→ 跳过，不隐藏
   ├── hideTopbar() 额外：面板打开时跳过（面板吸附在下栏上方，否则会被一起吃掉）
   └── 加隐藏类：header.bar-hidden（上滑）/ .reader-top.hidden（下滑）
   │
   ▼
mouseleave / window blur → 两栏都立即隐藏（不等 2 秒）

离开阅读器 navigate(非 reader) → leaveReaderTopbar() → 两栏复位显示 + 关面板 + 移除 body.in-reader
```

> 两栏定位：上栏 `position:sticky; top:0`（z-index 100），下栏 `position:fixed; bottom:0`（z-index 200）。
> 下栏曾用 `sticky; top:0`，与上栏同时吸顶导致被盖住（表现为"往下翻就不见了"）；改为吸底后不再冲突。

### 自动滚动的数据流

```
用户点「▶ 自动滚动」(toggleAutoScroll) 或速度滑杆 (setAutoSpeed)
   │
   ├── setAutoSpeed(v)：钳制 10–300 → state.autoSpeed → saveReaderPrefs()
   │
   └── startAutoScroll()
         ├── 若已在最底部且无话可加载 → 提示「已是最后一话」并返回
         ├── AUTOSCROLL.running = true；last=0；stuckSince=0
         ├── updateAutoScrollBtn()：按钮变「⏸ 停止」
         ├── scheduleTopbarHide()：下栏让位
         └── requestAnimationFrame(autoScrollTick)
   │
   ▼
autoScrollTick(ts) 每帧：
   ├── 首帧只建立 last 基准（dt=0，不移动）
   ├── dt = ts - last，按 MAX_FRAME_MS(100ms) 限幅
   ├── window.scrollTo(0, scrollY + autoSpeed * dt / 1000)
   ├── 未能移动且已到底：
   │     ├── 连续阅读开着 → preloadNextChapter()，等新内容撑开
   │     └── 卡住超过 STUCK_MS(4000ms) → stopAutoScroll() + 提示
   └── requestAnimationFrame(autoScrollTick) 继续
   │
   ▼
中断（立即 stopAutoScroll）：
   ├── wheel / touchstart（用户主动滚动）
   ├── 键盘（INPUT/TEXTAREA 聚焦时除外，保证滚动中可调速度）
   └── navigate() 离开阅读器

> 自动滚动自身走 window.scrollTo，不触发 wheel/touch，因此不会自我中断。
```

## 各逻辑层职责

### 1. 前端 UI 层 (`manga_reader.html`)

**职责：** 页面渲染、用户交互、状态管理、API 调用

**允许：**
- 修改 HTML 结构/CSS 样式
- 新增视图（如"我的书架"页面）
- 修改 API 客户端逻辑
- 修改书源规则配置
- 新增阅读模式（连续阅读、双页等），但图片地址必须统一走 `state.flatImgs`
- 新增阅读器内的显示选项（宽度/亮度等），设置统一存 `localStorage.manga_prefs`

**禁止：**
- 写网络代理逻辑
- 直接请求外部站点（必须经 proxy）
- 存储敏感数据到 localStorage

### 2. 书源规则层 (`manga_reader.html` + `api/proxy.js`)

**职责：** 定义数据来源、API 路径、图片 CDN、解密参数

**关键配置：**
- `BOOK_SOURCES_DEFAULT`（前端）：前端启动时的默认规则
- `BOOK_SOURCES`（代理端）：权威规则副本，通过 `/api/source/rules` 提供；额外含 `timeout`、`userAgent`、每条规则的 `match` 正则

**同步规则：** 修改规则时，两处必须保持一致。前端启动时会从代理端拉取权威副本覆盖本地值；拉取失败则使用内联默认值。

### 3. 代理路由层 (`api/proxy.js` - `handler`)

**职责：** 请求路由、头处理、响应变换

**关键逻辑：**
- `target` 解析：优先 `?p=`，否则用裸路径（剥掉 `/api/proxy` 前缀）
- 放行判定：`ALLOWED_DATA` 由 `rules[*].match` 派生，未命中一律 404
- Header 处理：统一注入 `Referer` / `Origin` / `User-Agent` / `Accept`
- 响应头处理：CORS、缓存策略

### 4. 图片处理层 (`api/proxy.js` - `serveImage` / `decryptImage`)

**职责：** CDN 容灾 + 图片解密 + 图片代理

**关键逻辑：**
- CDN 容灾链：`tu.mhttu.cc` → `mwtuwu.cc` → `tu.mwzu.cc` → `mwtusi.cc`，全失败返回 502 + `tried[]`
- 解密算法：AES-256-CBC（前 16 字节 IV + 其余密文，PKCS#7）
- 密钥：`0B6666A0-BB59-1381-B746-a0E4C9AC`（UTF-8 前 32 字节）
- 明文嗅探：`sniffMime()` 命中 JPEG/PNG/GIF/WebP/BMP 魔数则跳过解密直接下发

**变更影响：** CDN 域名更换/加密算法变更时需要同步修改

### 5. 部署配置层 (`vercel.json`)

**职责：** Vercel 路由规则、函数配置

**关键配置：**
- `rewrites`：`/(.*)` → `/api/proxy`
- `functions.includeFiles`：确保前端文件可被函数读取
- `memory` / `maxDuration`
- 未声明 `runtime` → Node.js 运行时（**不是 Edge**）

## 关键接口/契约

### API 路径契约

前端一律通过 `/api/proxy?p=<目标路径>&<参数>` 访问；代理端同时兼容裸路径。

| 路径（`p=` 的值） | 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `/api/source/rules` | GET | — | JSON (书源规则) | 前端启动时拉取权威规则 |
| `/api/home` | GET | page, pageSize, type, flag | JSON (漫画列表) | 首页/分类列表 |
| `/api/search` | GET | keyword, page, pageSize | JSON (搜索结果) | 搜索漫画 |
| `/api/comic/{id}` | GET | — | JSON (漫画详情) | 漫画详情+封面+简介 |
| `/api/comic/{id}/chapters` | GET | — | JSON (章节列表) | 章节列表 |
| `/api/comic/chapter/info/{cid}` | GET | — | JSON (章节信息) | 章节元信息 |
| `/api/comic/image/{cid}` | GET | page, page_size, image_source | JSON (图片列表) | 章节图片 |
| `/api/announcements` | GET | — | JSON (公告) | 站点公告 |
| `/en_images/*` | GET | — | 图片(解密后) | 图片资源(经CDN容灾+解密) |

### 书源规则契约

书源规则是驱动整个系统的"配置文件"，前端和代理端各持有一份副本：

- **前端副本**：`manga_reader.html` 中的 `BOOK_SOURCES_DEFAULT` 常量
- **代理端副本**：`api/proxy.js` 中的 `BOOK_SOURCES` 对象（通过 `/api/source/rules` 接口提供）

**同步规则：** 修改规则时，两处必须保持一致。前端启动时会从代理端拉取权威副本覆盖本地值；拉取失败则使用内联默认值。

## 不能破坏的契约

1. **API 路径**：`/api/home`、`/api/search` 等路径不能改名，否则前端请求全部 404
2. **JSON 数据结构**：`comicList`、`list`、`images` 等字段名不能改
3. **书源规则格式**：`BOOK_SOURCES` 的 key/path/params 结构不能变
4. **图片解密参数**：算法(AES-256-CBC)、密钥、IV 长度不能变，否则图片全黑
5. **CDN 域名顺序**：容灾链顺序影响图片加载成功率
6. **HTML 类名/ID**：前端 JS 中大量使用 `querySelector` 选择器（如 `#readerArea`、`.cimg`、`.imgwrap`），改了类名会导致图片不显示
7. **连续阅读的索引契约**：图片 `data-i` 是跨章节全局连续下标，与 `state.flatImgs` 一一对应；`#readerSentinel` 必须始终是 `#readerArea` 的最后一个子节点
8. **运行时**：`api/proxy.js` 依赖 `fs`/`path`/`http`/`https`/`crypto`，不能改成 Edge Runtime
9. **两个话号的语义**：`chapIdx` = 最后已加载话（驱动预加载），`viewChapIdx` = 视口所在话（显示/历史/跳转高亮）。不可混用
10. **宽度模式与限宽**：`custom`/`orig` 依赖 `body.reader-wide` 解除 `.container` 的 1200px 限宽；改动 `.container` 样式时须一并检查
11. **localStorage 键**：`manga_history`（历史）、`manga_pos`（话内位置）、`manga_prefs`（显示设置）三者独立，改名会导致用户数据丢失
12. **双栏定位**：上栏（站点 `header`）`sticky; top:0` z-index 100；下栏（`.reader-top`）`fixed; bottom:0` z-index 200。下栏若改回吸顶会与上栏重叠被盖住
13. **双栏自动隐藏参数**：`READER_TOPBAR.REVEAL_ZONE`(80px，顶部/底部共用) 与 `HIDE_DELAY`(2000ms)；上栏隐藏类 `header.bar-hidden`、下栏 `.reader-top.hidden`，改动时须同步 `stickyOffset()` 的留白计算
14. **自动滚动的时间基准**：`dt` 必须按 `AUTOSCROLL.MAX_FRAME_MS`(100ms) 限幅，且首帧只建立基准不移动；判断"最后一话"用 `chapIdx` 而非 `viewChapIdx`
15. **自动滚动速度**：`state.autoSpeed`（10–300 px/s）存 `manga_prefs.autoSpeed`；键盘中断检查必须在 `INPUT`/`TEXTAREA` 判断之后，否则调速度会停掉滚动
16. **单击翻话的延时判定**：`MOUSE_UI.NAV_DELAY`(250ms) 是双击/单击共存的必要条件，`dblclick` 必须调 `cancelNav()`；改成单击立即翻话会让双击放大先跳一话
17. **鼠标交互的键位**：`#readerArea` 上的 `dblclick` / `click` / `contextmenu` 三个监听只绑一次（`MOUSE_UI.bound`）；`navZoneAt` 必须记元素而非 rect

## 风险清单

| 风险 | 描述 | 缓解措施 |
|------|------|----------|
| 源站改版 | manwaxu.cc 的 API 路径/JSON 结构变化 | 书源规则可配置，优先改配置而非代码 |
| CDN 失效 | 所有图片 CDN 域名被屏蔽/失效 | 容灾链自动切换；需及时添加新 CDN |
| 加密变更 | 图片来源加密算法/密钥变更 | 代理端解密逻辑需同步更新 |
| 前端界面未打包 | proxy 读不到 `manga_reader.html` | `includeFiles` 已声明；读不到时返回带排查提示的 500 |
| Serverless 限制 | 函数有内存/时间限制 | 避免在函数中做重计算/大文件处理；已设 1024MB / 30s |
| CORS | 跨域请求被浏览器拦截 | 代理层统一设置 CORS 头 |
| 部署未触发 | 仓库无 Vercel Git 集成，push 不会自动部署 | 手动 `vercel --prod`；或接入 Git 集成 |
| 本地域名污染 | 本机 `*.vercel.app` 解析异常导致无法验证 | 用中转服务或修正 hosts |

## 分层决策验证

用之前讨论的四个问题验证当前架构的合理性：

| 关注点 | 独立变化？ | 复用？ | 单独测试？ | 可替换？ | 结论 |
|--------|-----------|--------|-----------|---------|------|
| 书源规则配置 | 是 换源时独立改 | 是 可换不同源 | 需集成测试 | 是 可换源 | 独立配置层 |
| 图片解密逻辑 | 否 很少变 | 仅图片用 | 是 可单元测试 | 是 可换算法 | 独立函数 |
| CDN 容灾逻辑 | 是 换 CDN 时改 | 仅图片用 | 是 可模拟测试 | 是 可换域名 | 独立模块 |
| 前端 UI | 是 UI调整独立改 | 否 页面专用 | 需 E2E | 否 换了就是换 UI | 保持单一文件 |
| 代理路由 | 是 新增API路径 | 部分复用 | 需集成 | 是 可重写路由 | 保持集中 |

**结论：** 当前双文件架构对于这个规模的项目是合理的。如果未来需要支持多个书源/多个目标站点，应将"书源规则"提取为独立配置文件（JSON），实现真正的规则驱动。

## 部署说明

### 本地开发

```bash
# 安装 Vercel CLI
npm i -g vercel

# 在项目根目录运行
vercel dev
```

### 生产部署

```bash
# 前置：本机需已登录
vercel login

# 生产部署
vercel --prod
```

> ⚠️ 本仓库未接入 Vercel Git 集成，`git push origin main` **不会**自动部署。如需自动部署，请在 Vercel Dashboard 导入仓库并连接 Git。

### 环境变量

本项目无需配置环境变量，所有配置内嵌在代码中。

### 验证

- 前端改动：先用 `node -e` 做 `<script>` 块语法自检（见 AGENTS.md「验证命令」）
- 线上验证：若本机 `*.vercel.app` 解析异常，用中转服务或修正 hosts 后再访问
