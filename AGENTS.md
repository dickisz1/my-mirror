# 项目 AI 上下文 (AGENTS.md)

> 本文档描述**当前代码的真实状态**。此前版本曾把本项目描述成含"广告拦截 + HTML 注入 + 自动阅读引擎 + DOM 沙箱"的 Edge Runtime 版本，与代码不符，已订正。

## 项目是什么

**my-mirror** 是一个漫画代理镜像站（书源阅读器），部署在 Vercel 上。用户访问站点地址后，看到一个漫画阅读器界面，所有数据请求都经过代理中转，用户不需要知道背后是哪些站在干活。

核心流程：用户打开浏览器 → 访问站点 → 看到阅读器界面 → 在界面上点漫画/选章节/往下滑 → 前端按书源规则去真实网站取数据 → 全部经代理中转 → 漫画图片正常显示。

已注册两个书源（详见「书源定义」一节）：

| key | 名称 | 数据来源 | 图片 |
|-----|------|----------|------|
| `manwaxu` | 漫蛙漫画（**默认源**） | manwaxu.cc | AES-256-CBC 加密，CDN 容灾链 `tu.mhttu.cc` → `mwtuwu.cc` → `tu.mwzu.cc` → `mwtusi.cc` |
| `pixiv` | pixiv | www.pixiv.net | 明文图，固定 host `i.pximg.net`（靠 Referer 防盗链），免登录 |

访问时用 `?src=<key>` 选源；**不带 `src` 一律走默认源 manwaxu**。

## 技术栈

- **语言**：JavaScript (100%)
- **部署平台**：Vercel
- **后端**：`api/proxy.js` —— **Node.js Serverless Function**（`@vercel/node`，构建解析为 Node 24），**不是 Edge Runtime**。代码使用 `fs` / `path` / `http` / `https` / `crypto`，这些在 Edge Runtime 下不可用，因此不能改成 `runtime: "edge"`。
- **前端**：`manga_reader.html`（单页应用，Vanilla JS，无框架）
- **样式**：CSS Variables + 内联 CSS（暗色主题）
- **数据存储**：无后端数据库，阅读进度存浏览器 localStorage
- **图片解密**：AES-256-CBC（IV 16 字节 + 密文，PKCS#7），密钥 `0B6666A0-BB59-1381-B746-a0E4C9AC`
- **构建/部署**：Vercel CLI / Vercel Dashboard

## 代理端不做的事（重要）

`api/proxy.js` 是一个**纯书源代理**，只做三件事：返回前端界面、按规则转发数据请求、按规则取图片并解密。它**没有**以下能力，文档与代码中都不应出现：

- ❌ 广告域名黑名单（无 `AD_DOMAINS`）
- ❌ HTML 响应注入（无防弹窗 JS、无自动阅读 JS、无图片解锁 JS、无广告屏蔽 CSS、无 DOM 沙箱）
- ❌ 域名引用替换（不把源站域名改写成当前站点域名）
- ❌ 静态资源代理（无 `/__assets__/` 前缀，不代理 `mwappimgs.cc`）
- ❌ `targetHost` 字段（数据源就是各源的 `baseUrl`）

## 目录结构

```
my-mirror/
├── api/
│   └── proxy.js          # 后端：书源规则表 + 路由 + 数据转发 + 图片 CDN 容灾 + AES 解密
├── manga_reader.html     # 前端：SPA 阅读器 + 书源规则配置 + API 客户端
├── vercel.json           # Vercel 配置：路由门卫，所有请求转给 proxy.js
├── AGENTS.md             # 本文件：项目 AI 上下文
├── docs/
│   └── architecture.md   # 架构说明 + 数据流 + 契约
├── README.md             # 面向使用者的说明文档
└── .gitignore            # Git 忽略规则
```

## vercel.json 配置说明

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "version": 2,
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/proxy" }
  ],
  "functions": {
    "api/proxy.js": {
      "includeFiles": "manga_reader.html",
      "memory": 1024,
      "maxDuration": 30
    }
  }
}
```

- `rewrites`：所有路径 `/(.*)` 统一路由到 `/api/proxy`
- `functions.api/proxy.js.includeFiles`：确保 proxy 运行时能读取 `manga_reader.html` 文件
- `memory`：1024MB 内存限制
- `maxDuration`：30 秒最大执行时间
- **未设置 `runtime`** → 走默认的 Node.js 运行时（`@vercel/node`）。不要改成 `edge`。

## 各文件职责

### `api/proxy.js`（后端核心，多书源版）

| 区块 | 职责 |
|------|------|
| `SOURCES` 源注册表 | key → 源定义（`baseUrl`/`referer`/`timeout`/`userAgent`/`imageCdn`/`decrypt`/`rules`/`imageRule`/`adapt`/`homeSections`） |
| `DEFAULT_SOURCE` / `resolveSource()` | `?src=<key>` 选源；**未知或缺省回落默认源**（兼容契约） |
| `sourceList()` | `/api/sources` 的载荷（只暴露 key/name/version/baseUrl） |
| `fetchRaw()` | 带超时（取源的 `timeout`）+ 最多 3 次重定向跟随的 GET |
| `sniffMime()` | 图片魔数嗅探（JPEG/PNG/GIF/WebP/BMP） |
| `decryptImage(src, buf)` | 先嗅探魔数，已是明文则原样返回；否则按**该源**的 AES 参数解密 |
| `upstreamHeaders(src, req)` | 统一上游请求头（Referer / Origin / UA / Accept）——pixiv 防盗链靠它 |
| `setCors()` | 设置 CORS 头 |
| `readFrontend()` | 读取并缓存 `manga_reader.html`（多路径兜底） |
| `getByPath()` / `fillPath()` / `extractVars()` | 嵌套取值、路径占位符填充、路径变量抽取 |
| `buildUpstreamQuery()` | 上游 query 构造：白名单 + `paramMap` 改名 + `paramDefaults` 默认值 |
| `mapItem()` / `normalizeList()` / `normalizeDetail()` / `normalizeImages()` | 按 `adapt` 声明把上游 JSON 归一化成前端认的结构 |
| `serveFrontend()` | 返回前端界面；读不到则返回带排查提示的 500 |
| `serveRules(src, res)` | `/api/source/rules`，返回**单个源对象**（含 `rules`），`max-age=300` |
| `serveSources(res)` | `/api/sources`，源列表（不含密钥/rules/UA） |
| `serveData()` | 按规则转发；支持 `multi`（多请求组装）、`__fake_chapters__`（合成单话）、`adapt` 归一化 |
| `serveImage(src, target)` | 按源 `imageRule.host`（固定）或 `imageCdn`（容灾链）取图 + 可选解密 |
| `handler()` | 入口：路由分发 |

**入口路由顺序**（`handler`）：

1. `OPTIONS` → 204 + CORS
2. `resolveSource(searchParams.get('src'))` 选定源
3. 计算 `target`：优先查询参数 `p`，否则用裸路径（并剥掉 `/api/proxy` 前缀）
4. 无 `p` 且 target 为 `/`、`/index.html`、`/manga_reader.html` → `serveFrontend()`
5. `target === '/api/source/rules'` → `serveRules()`；`target === '/api/sources'` → `serveSources()`
6. 该源 `imageRule.match` 命中 → `serveImage()`
7. 逐个匹配该源 `rules[*].match` → `serveData()`
8. 都不命中 → 404 JSON（`no rule matched`），避免变成任意转发器

**上游路径模板占位符**（`fillPath`）：

| 写法 | 取值来源 | 例 |
|------|----------|-----|
| `{id}` / `{cid}` | `rule.match` 的正则捕获组（`rule.vars` 写组号） | `/api/comic/{id}` |
| `{keyword}` | query（`rule.vars` 写 `'query:keyword'`） | `/ajax/search/artworks/{keyword}` |

> pixiv 的搜索词在**路径段**里而非 query，所以必须有路径占位符能力。

**`adapt` 归一化声明**（数据驱动，不是每源写一段代码）：

| 字段 | 作用 |
|------|------|
| `listPath` / `searchListPath` / `detailPath` / `imagesPath` / `totalPath` | 上游响应取值路径（支持 `a.b.c`） |
| `field` | 字段改名映射（`id`/`title`/`pic`/`author`/`tags`/`hits`） |
| `searchField` | **搜索端点单独一套字段名**（pixiv 的 ranking 用 `illust_id`，search 用 `id`） |
| `tagsJoin` | tags 数组 → 逗号串（前端要逗号串） |
| `filterMasked` | 过滤 `is_masked`（需登录，取图必失败） |
| `fakeChapters` | 无章节源 → 合成单话（同时触发前端单话 UI） |

### `manga_reader.html`（前端，单文件 SPA）

单文件 SPA，包含 HTML + CSS + JS：

1. **书源配置**：`BOOK_SOURCES_DEFAULT` 仅作**拉取失败时的兜底**；权威副本在代理端 `SOURCES` 注册表
2. **书源选择**：`loadSourceList()` 拉 `/api/sources` → `renderSourceSelect()` 渲染顶栏下拉 → `switchSource(key)` 切换（存 `manga_prefs.srcKey`）；`SRC_KEY` 随每个请求带上
3. **API 客户端**：`buildUrl()` / `apiGet()` 构建请求 URL（**自动追加 `&src=`**）；`toProxyPath(u, orig)` 把图片绝对地址转成代理路径（**同样追加 `&src=`**，是防多源串图的唯一注入点）
4. **视图渲染**：
   - 首页（`renderHome`）：栏目由源的 **`homeSections`** 驱动（manwaxu 六栏 / pixiv 日周月三榜）；**非本源栏目会清空并隐藏**，否则残留上一个源的卡片
   - 分类（`renderCategory` / `loadCategory`）：按类型筛选 + 分页加载
   - 搜索（`renderSearch`）：关键词搜索 + 防抖
   - 详情（`openDetail`）：漫画信息 + 章节列表
   - 阅读器（`openChapter` / `setupLazy`）：图片懒加载 + 阅读进度条
   - **连续阅读**（`toggleContinuous` / `preloadNextChapter` / `setupContinuousLoader`）：滚到底自动把下一话图片追加到页面底部，不翻页
   - **显示设置**（`setImgWidth` / `setImgWidthPct` / `setBrightness` / `loadReaderPrefs`）：宽度滑杆（30–100%）+ 预设（fit/orig）+ 亮度 30–130%，存 `localStorage.manga_prefs`
   - **双栏自动隐藏**（`enterReaderTopbar` / `hideTopbar` / `hideHeaderBar`）：上栏站点导航吸顶、下栏操作栏吸底，鼠标靠近哪边唤出哪边，各 2 秒淡出
   - **自动推进**（`toggleAutoScroll` / `setAutoSpeed` / `setAutoStepMode` / `setAutoDwell` / `autoScrollTick` / `autoImgStep`）：两种模式——像素滚动（速度滑杆 10–300 px/s）与逐张翻（停留滑杆 500–10000ms）；滚到底自动衔接连续阅读；滚轮/触摸/按键立即停止
   - **「第 N 张」提示开关**（`setShowToast` / `showReaderToast(msg, force)`）：设置面板可关，存 `manga_prefs.showToast`；状态类提示带 `force` 始终显示
   - **鼠标交互**（`bindReaderMouseUI` / `toggleZoom` / `clickZoneAt` / `scrollToAdjacentImage` / `openCtxMenu`，Pixiv 竖读模型）：单击 上=上一张切图 中=放大 下=下一张切图（末张则下一话）、右键快捷菜单
   - **返回详情页**（`backToDetail`）：底部栏「← 详情」与 `Esc` 均可返回（对应 Pixiv ③）
   - **章节快速跳转**（`openJumpPanel` / `jumpToChapter`）：阅读器内浮层列全部话，当前话高亮，Esc 关闭
   - **话内位置记忆**（`savePos` / `loadPos` / `restorePos`）：存话内偏移到 `localStorage.manga_pos`（**带 `src` 字段**，见下）
   - **单话源 UI**（`isSingleChapterSource` / `applySingleChapterUI`）：`adapt.fakeChapters && 章节数<=1` 时上下话入口置灰 + 提示「本作品仅 1 话」
5. **阅读历史**：`localStorage` 存储最近 20 本阅读记录（**带 `src` 字段**，见下）
6. **书源规则面板**：`renderRulesPanel()` 展示当前生效的规则（调试用；对无 `imageCdn`/`decrypt.enabled=false` 的源有防御）
7. **启动流程**：`boot()` → `loadReaderPrefs()` → `loadSourceList()` → `loadRules()` → `navigate('home')`

#### 多书源的约定

书源定义集中在代理端 `api/proxy.js` 的 `SOURCES` 注册表。**新增一个源 = 在 `SOURCES` 加一项**，前端无需改动（源列表与首页栏目都由代理端下发）。

**`src` 参数是整套机制的枢纽：**

- 前端 `buildUrl()` 与 `toProxyPath()` **统一追加 `&src=`**，这两个函数是唯一注入点。
- **图片请求漏带 `src` 会导致「封面正常、正文错乱」** —— 多源下最难排查的一类 bug。
- `src` 缺省或未知时回落 `DEFAULT_SOURCE`（`manwaxu`）：这是**旧链接、旧缓存、书签继续可用**的唯一保证，改动 `resolveSource()` 时必须保留。
- `src` 不会透传给上游（`handler` 里从 query 剔除）。

**`/api/source/rules` 必须返回单个源对象**（含 `.rules`）：前端是 `if(j && j.rules)` 判定成功，若改成数组会**静默回落内联默认值且不报错**，极难排查。

**`/api/sources` 只暴露展示字段**（key/name/version/baseUrl），**不得**包含 `decrypt.key`、`rules`、`userAgent`。

**源之间的差异靠 `adapt` 声明吸收**，不要在前端写字段映射：

- 字段名不同 → `adapt.field`；**某端点字段名与其它端点不同 → `adapt.searchField`**
  （pixiv 的 `/ranking.php` 用 `illust_id`/`user_name`，`/ajax/search` 用 `id`/`userName`；只声明一套会让搜索结果 id/author 全空、点进详情 404 —— 这是线上实测踩到的坑）
- 无章节的源 → `adapt.fakeChapters`，代理端合成单话，前端据此启用单话 UI
- 需登录的内容 → `adapt.filterMasked` 过滤 `is_masked`（无 cookie 取图必失败）

**图片规则按源独立**：`imageRule.host`（固定单 host，如 pixiv 的 `i.pximg.net`）或 `imageCdn[]`（容灾链，如 manwaxu）；`decrypt.enabled` 决定是否解密。**跨源的图片路径不匹配对方的 `imageRule.match` 时会 404，这是正确的隔离行为**（pixiv 源下 `/en_images/` 不匹配）。

**历史与阅读位置按源隔离**：`manga_history` / `manga_pos` 的记录带 `src` 字段，`recSrc(rec)` 缺省回落默认源（兼容无 `src` 的旧记录）。`comicId` 是**源相关**的（manwaxu 的 `94789` 与 pixiv 的 `94789` 是不同作品），不加隔离会导致切源后历史点进去 404、位置错乱恢复。

#### 连续阅读模式的关键约定

- 图片地址表统一为 `state.flatImgs`，下标 = 图片元素的 `data-i`，**跨章节全局连续**。`setupLazy()` 的 observer 回调一律从 `state.flatImgs[i]` 取地址，不要退回"按章节闭包捕获 imgs"的写法，否则第二话起图片会整片越界失败。
- 底部哨兵 `#readerSentinel` 必须始终是 `#readerArea` 的最后一个子节点，由 `ensureSentinel()` 统一维护；追加新章节后必须再次调用它，否则滚动触发点会跑到页面中间。
- 新章节起始下标以 `state.flatImgs.length` 为准，不要用 `querySelectorAll('.cimg').length`（图片加载失败被移除后会错位）。
- 离开阅读器或关闭开关时，需断开 `observer` 与 `continuousObserver` 并清理 `state.flatImgs` / `loadedChaps`。

#### 两个"话号"的区别（易错点）

- `state.chapIdx` = **最后已加载话**，用于驱动预加载。
- `state.viewChapIdx` = **视口所在话**，用于下栏 meta、进度文本、历史记录、跳转面板高亮。
- 显示与记录一律用 `viewChapIdx`；用 `chapIdx` 会导致"连续阅读下历史记成最新一话""进度条随预加载倒退""标题剧透"。

#### 显示设置与宽度模式的约定

- `state.imgWidth` ∈ `fit`（适应宽度，800px 上限）/ `orig`（原始尺寸）/ `custom`（自定义百分比）。
- 自定义百分比由滑杆 `#widthRange`（30–100%）驱动，存 `state.widthPct`；宽度经 CSS 变量 `--reader-w`（vw 单位）传给 `#readerArea.w-pct`。
- `custom`/`orig` 额外给 `<body>` 加 `reader-wide` 类，用于突破 `.container{max-width:1200px}` 的限宽——否则百分比是相对被限宽的父容器，不是视口。
- 滑杆拖到 100% 即等价于旧的"铺满全宽"（该模式已移除）；旧数据 `imgWidth:'full'` 由 `loadReaderPrefs()` 自动迁移为 `custom 100%`。
- `applyImgWidth()` 在 `openChapter` 重新渲染后必须再调用一次（`#readerArea` 元素本身没换，但需保证 class 与状态一致）。
- 亮度通过 `#readerArea` 的 `--reader-brightness` CSS 变量驱动 `filter:brightness()`，不要直接写 `filter` 内联样式。
- 设置持久化在 `localStorage.manga_prefs`，与 `manga_history` / `manga_pos` 相互独立。

#### 自动滚动的约定

自动推进有两种模式，由 `state.autoStepMode` 选择（设置面板「自动翻张」行切换）：

| 模式 | 值 | 实现 | 适用 |
|---|---|---|---|
| 像素滚动 | `'px'`（默认） | `requestAnimationFrame` + `autoScrollTick` | 连续平滑，适合慢慢看 |
| 逐张翻 | `'img'` | `setTimeout` + `autoImgStep` | 每张停一下，适合快速过图 |

**像素滚动模式**

- 速度滑杆 `#speedRange`（10–300 px/s，步长 10）存 `state.autoSpeed`，持久化在 `manga_prefs.autoSpeed`。
- 推进公式：`window.scrollTo(0, scrollY + autoSpeed * dt / 1000)`，`dt` 由 `requestAnimationFrame` 时间戳相减得出。
- **`dt` 必须限幅**（`AUTOSCROLL.MAX_FRAME_MS = 100`）：标签页被切走后回来，`dt` 会是几千毫秒，不限幅会瞬间跳一大段。
- **首帧不移动**：第一帧只建立 `last` 基准（`dt = 0`），否则会用到无意义的时间差。
- 滚到底时：连续阅读开着就调 `preloadNextChapter()`，新内容撑开后自动继续；卡住超过 `AUTOSCROLL.STUCK_MS`(4000ms) 页面没长高 → 停止并提示。
- 判断"是否最后一话"必须用 `state.chapIdx`（最后已加载话），**不能用 `viewChapIdx`**——后者是用户视口所在话，预加载失败时会误报"加载失败"。

**逐张翻模式**

- 停留滑杆 `#dwellRange`（500–10000ms，步长 500）存 `state.autoDwell`，持久化在 `manga_prefs.autoDwell`。
- `autoImgStep()`：调 `scrollToAdjacentImage(1)` 滚到下一张切图 → `setTimeout(autoImgStep, autoDwell)` 停留 → 再走下一张。
- 越过本章末张时由 `scrollToAdjacentImage` 自动调 `navByZone('next')` 切下一话，锚点随之复位。
- 放大看细节时**暂停推进但不停止**（复原后继续），避免放大期间被拖走。
- 运行中切换模式（`setAutoStepMode`）会 `stopAutoScroll()` 再 `startAutoScroll()`，否则旧定时器/帧会继续跑。
- `AUTOSCROLL.timer` 与 `AUTOSCROLL.raf` 互斥，`stopAutoScroll()` 两者都清。

**两种模式共同**

- **翻张锚点 `AUTOSCROLL.anchorPos` 是必需的**：`scrollToImg` 用 `behavior:'smooth'` 平滑滚动，途中持续触发 `scroll` → `updateProgressUI` 用 `computeViewPos()` 从滚动位置反推并覆写 `state.viewPos`。若推进直接读 `state.viewPos`，平滑途中读到的中间值会让步进变成 2、3 甚至回退（线上实测：停留设 1500ms，2.5 秒走了 3 张）。锚点隔离了这个污染，使步进恒为 1。
  - `scrollToAdjacentImage` 读写锚点；`state.viewPos` 同时更新，供未启用锚点的路径读取。
  - **手动滚动必须复位锚点**（`userInterruptAutoScroll()` 里置 `null`）：滚轮/触摸/按键意味着用户接管了位置，锚点若不复位会与用户实际操作打架。
  - **换话必须复位锚点**（`openChapter()` 里置 `null`）：图片集变了，旧索引无意义。
  - `anchorPos === null` 表示"跟随滚动位置反推的 `viewPos`"，是默认语义。
- 中断：`wheel` / `touchstart` / 键盘（输入框与滑杆聚焦时除外）→ 立即 `stopAutoScroll()` + 复位锚点。自动滚动自身走 `window.scrollTo`，不触发这些事件，不会自我中断。
- 速度/停留滑杆必须在滚动中可调：因此键盘处理里**先判断 `INPUT`/`TEXTAREA` 再调用中断**，否则操作滑杆会停掉自动滚动。
- 离开阅读器（`navigate` 非 reader 分支）调用 `stopAutoScroll()`。

#### 「第 N 张」提示的约定

- `state.showToast`（设置面板「提示」行）控制 `showReaderToast()` 是否显示，持久化在 `manga_prefs.showToast`。
- `showReaderToast(msg, force)`：`force=true` 时无视开关始终显示。**状态类提示必须带 `force`**（「已开启提示」/「已关闭提示」），否则用户关掉开关后就再也看不到自己操作的结果。
- 关闭只影响提示，**不影响翻张行为**。

#### 鼠标交互的约定（Pixiv 竖读模型）

Pixiv 官方原文（pixiv.help）：
- **① 前后页**：点屏幕**左右**翻页；**「縦読み」（竖读）模式则点「上下」区域**。
- **② 放大缩小**：点屏幕**中央** → 放大，**再点一次** → 复原（是**单击**，不是双击）。
- **③ 关闭**：关闭阅读器回到作品详情页。
- **⑤ 页码滑块**：拖动 ● 跳页。**⑥ 阅读方向切换**。
- 快捷键：`J/↓` 下一页、`K/↑` 上一页、`V` 原始尺寸、`Z` 缩略图、`L` 喜欢、`B` 收藏、`esc` 关闭。

**本项目是条漫（webtoon）竖向滚动**，一话 = 一长条故事被切成多张短图连贯拼接，所以按竖读模型映射：

| 操作 | 行为 | 实现 |
|---|---|---|
| 单击**上 1/3** | **上一张切图**；已在本章第一张则上一话 | `clickZoneAt` → `{zone:'prev'}` → `scrollToAdjacentImage(-1)` |
| 单击**中央 1/3** | 放大切换（再单击复原） | `{zone:'center'}` → `toggleZoom` |
| 单击**下 1/3** | **下一张切图**；已在本章最后一张则下一话 | `{zone:'next'}` → `scrollToAdjacentImage(1)` |
| 放大态下任意单击 | 只复原，不执行分区动作 | click 处理器优先 `isZoomed()` 分支 |
| 右键 | 快捷菜单：上一话/下一话/章节列表/自动滚动/阅读设置/复制图片链接 | `openCtxMenu` |
| `V` | 切换原始尺寸 / 适应宽度 | `setImgWidth` |
| `Esc` | 优先级：关右键菜单 → 复原放大 → 关章节浮层 → **返回详情页** | `keydown` 开头 + `backToDetail` |
| 底部栏「← 详情」 | 返回详情页（对应 Pixiv ③） | `backToDetail` |

**关键区分**：「下一张切图」≠「下一话」。切图是同一话内的分段（`scrollToAdjacentImage` 只滚动），只有越过本章首/末张才调用 `navByZone` 切话。

**设计教训（不要走回头路）**：
1. 曾用"单击左右翻话 + **双击**放大"，靠 `NAV_DELAY` 延时判定区分。实测证明该组合有根本缺陷——延时 <500ms（浏览器双击阈值）时稍慢的双击会**先翻话再放大**；延时 ≥500ms 则每次单击都要等半秒。**Pixiv 用"中央单击切换放大"从设计上消除冲突**，不要改回双击。
2. 分区必须按**视口高度**三等分，**不能按图片高度**——条漫长图会让分区边界落到屏幕外，产生大片"点了没反应"的死区。
3. `clickZoneAt` 循环里要记**元素本身**而非 `getBoundingClientRect()` 的返回值（曾因此报 `target.getBoundingClientRect is not a function`，翻页完全失效）。

- `scrollToAdjacentImage` 会同步写 `state.viewPos`，保证连点能连续推进；`state.viewPos` 由滚动监听（`updateProgressUI`）持续更新。
- 放大态下 `unzoomImage` 会恢复放大前的 `scrollY`。
- 右键菜单在**点击别处 / 滚动 / Esc / 离开阅读器**时关闭；`resetReaderMouseUI()` 统一复位。
- 事件只绑一次（`MOUSE_UI.bound`），绑在 `#readerArea` 上，避免与双栏/面板按钮冲突。
- 未加载的图片（无 `src`）不提供"复制图片链接"项。
- **未实现（有意放弃）**：`Z` 缩略图预览、`L` 喜欢、`B` 收藏、⑥ 阅读方向切换（我们是竖向滚动，无左右读概念）；源站也没有点赞/收藏数据。

#### 阅读器双栏（上栏站点导航 + 下栏操作栏）的约定

阅读器里有**两条独立的栏**，都吸附、都能自动隐藏：

| | 上栏 | 下栏 |
|---|---|---|
| 元素 | 站点 `<header>`（logo/书源徽章/首页/分类/搜索） | `.reader-top`（标题/meta/进度/7 个按钮） |
| 定位 | `position:sticky; top:0` | `position:fixed; bottom:0` |
| 隐藏类 | `header.bar-hidden`（`translateY(-100%)` 上滑） | `.reader-top.hidden`（`translateY(100%)` 下滑） |
| 唤出区 | 鼠标进入**顶部** 80px | 鼠标进入**底部** 80px |
| 定时器 | `READER_TOPBAR.headerTimer` | `READER_TOPBAR.timer` |

- 两栏**各自独立**显隐，互不干扰：鼠标在顶部只唤出上栏，在底部只唤出下栏（`onReaderMouseMove` 同时判断两侧，各走各的分支）。
- 各自悬停（`:hover`）时不隐藏，避免操作到一半消失。
- `READER_TOPBAR.REVEAL_ZONE`(80px) 与 `HIDE_DELAY`(2000ms) 为两栏共用参数。
- `mouseleave` / `window.blur` → 两栏都立即隐藏（不等 2 秒）。
- 离开阅读器（`leaveReaderTopbar`）：两栏复位显示、关掉面板、移除 `body.in-reader`。
- `body.in-reader` 只负责 `#view-reader` 的 `padding-bottom:64px`（内容不被底部栏遮住），**不再隐藏上栏**。
- 设置/规则面板吸附在**下栏上方**（`bottom:56px`）从底部弹出；面板打开时下栏不隐藏（否则面板会被一起吃掉，表现为"点设置没反应"）。
- `scrollToImg()` 用 `stickyOffset()` 只计算**下栏**高度（顶部无吸附栏需要避让）；下栏隐藏时留白回落到 10px。

### `vercel.json`（部署配置）

- 声明路由重定向：`/(.*)` → `/api/proxy`
- `functions.includeFiles` 包含 `manga_reader.html`，确保 proxy 运行时可读
- 内存 1024MB，最大执行时间 30s
- 不声明 `runtime` → Node.js Serverless Function

## 逻辑分层（关注点分离）

虽然物理文件只有 2 个核心代码文件，但逻辑上存在关注点分离：

| 逻辑层 | 所在文件 | 职责 | 变更频率 |
|--------|----------|------|----------|
| 前端 UI | `manga_reader.html` | 页面渲染、用户交互、状态管理 | 中（UI 调整/新功能） |
| 书源注册表 | `api/proxy.js`（`SOURCES`） | 定义数据来源、API 路径、图片 CDN、字段归一化 | 低（加源时才改） |
| 代理路由 | `api/proxy.js` | 请求路由、头处理、响应变换 | 低 |
| 字段归一化 | `api/proxy.js`（`adapt` 相关） | 把上游 JSON 转成前端认的结构 | 低（换源时按需加声明） |
| 图片处理 | `api/proxy.js` | CDN 容灾 / 固定 host + 可选 AES 解密 | 低（算法稳定） |
| 部署配置 | `vercel.json` | 路由规则、函数配置 | 极低 |

**分层决策验证（四个问题）：**

| 关注点 | 独立变化？ | 复用？ | 单独测试？ | 可替换？ | 结论 |
|--------|-----------|--------|-----------|---------|------|
| 书源规则配置 | 是 换源时独立改 | 是 可换不同源 | 需集成测试 | 是 可换源 | 独立配置层 |
| 图片解密逻辑 | 否 很少变 | 仅图片用 | 是 可单元测试 | 是 可换算法 | 独立函数 |
| CDN 容灾逻辑 | 是 换 CDN 时改 | 仅图片用 | 是 可模拟测试 | 是 可换域名 | 独立模块 |
| 前端 UI | 是 UI调整独立改 | 否 页面专用 | 需 E2E | 否 换了就是换 UI | 保持单一文件 |
| 代理路由 | 是 新增API路径 | 部分复用 | 需集成 | 是 可重写路由 | 保持集中 |

**结论：** 当前双文件架构对于这个规模的项目是合理的。如果未来需要支持多个书源/多个目标站点，应将"书源规则"提取为独立配置文件（JSON），实现真正的规则驱动。

## 变更规则

1. 改 UI/交互 → 只动 `manga_reader.html`
2. **加新书源 → 只改 `api/proxy.js` 的 `SOURCES` 注册表**（加一项），前端无需改动；若新源的 JSON 字段与现有源不同，用该源的 `adapt` 声明吸收，**不要在前端写映射**
3. 改某源的 CDN/解密 → 改该源定义里的 `imageCdn` / `decrypt` / `imageRule`（按源独立，不影响其它源）
4. 改部署配置 → 只改 `vercel.json`
5. **不允许**在 `manga_reader.html` 里写网络代理逻辑（反向也不行）
6. **不允许**在 `api/proxy.js` 里写前端 UI 渲染逻辑
7. 改完文档描述的行为时，同步更新本文件与 `docs/architecture.md`

> 改 `src` 相关逻辑（`resolveSource` / `buildUrl` / `toProxyPath` / `/api/source/rules` 的返回形状）前，先读「多书源的约定」一节——那里列的每一条都是踩过的坑。

## 每次让 AI 改动的标准指令模板

```
请基于 AGENTS.md 和 docs/architecture.md 完成以下变更：

目标：
当前问题：
期望行为：
不能破坏：

要求：
1. 先复述这个变更应该落在哪一层，会影响哪些模块。
2. 列出改动清单：新增、修改、删除的文件。
3. 给出完整可替换代码，不要省略关键部分。
4. 说明为什么不会破坏现有分层。
5. 列出回归风险和验证方法。
6. 如果现有架构接不住，先给出方案，不要直接改。
```

## 验证命令

- **本地开发**：`vercel dev`（启动 Vercel 本地开发服务器）
- **部署**：`vercel`（预览部署）或 `vercel --prod`（生产部署）
- **检查函数**：`vercel functions`（列出所有函数）
- **查看日志**：`vercel logs`（查看函数执行日志）
- **JS 语法自检**（不依赖 Vercel，改完前端可先跑）：
  ```bash
  node -e "const h=require('fs').readFileSync('manga_reader.html','utf8');new Function(h.match(/<script>([\s\S]*?)<\/script>/)[1]);console.log('OK')"
  ```

### 部署须知

- 本仓库**未配置 Vercel Git 集成**（无 webhook），`git push` 不会自动触发部署。
- 部署需本机已 `vercel login`。未登录时只能创建匿名临时部署，且临时部署会过期。
- 若本机 `*.vercel.app` 域名解析被污染，浏览器/curl 无法直连站点，需用中转服务或改 hosts 验证。

## 禁止事项

- 不在 `manga_reader.html` 里写网络代理逻辑
- 不在 `api/proxy.js` 里写前端 UI 渲染
- 不修改未列出的文件
- 不删除已有 API 路径而不提供兼容层
- **不破坏 `src` 缺省回落默认源**（旧链接/旧缓存/书签全靠它）
- **不把 `/api/source/rules` 改成返回数组**（前端会静默回落内联默认值，不报错）
- **不在 `/api/sources` 里暴露 `decrypt.key` / `rules` / `userAgent`**
- **不在图片请求里漏带 `src`**（会「封面正常、正文错乱」）
- 不把 `api/proxy.js` 改成 Edge Runtime（它依赖 fs/path/http/https/crypto）
- 不在代理层做重计算（Serverless 函数有内存和时间限制）
- 不跨层乱改（前端不改代理逻辑，代理不改前端 UI）

## 关键数据模型

### 漫画列表项

```
{
  id: number|string,
  title: string,
  pic: string,          // 封面图 URL
  cover: string,        // 封面图 URL（备选）
  author: string,
  tags: string,         // 逗号分隔的标签
  status: number,       // 0=完结 1=连载中
  tHits: number,        // 人气
  collection: number,   // 收藏数
  intro: string,        // 简介
  description: string   // 简介（备选）
}
```

### 章节项

```
{
  id: string,
  title: string,
  sortId: number,
  picCount: number,     // 图片数
  isVip: boolean        // 是否 VIP 章节
}
```

### 书源定义（`SOURCES[key]`）

代理端 `SOURCES` 是**权威**；前端 `BOOK_SOURCES_DEFAULT` 只是拉取失败时的兜底。

```
{
  key: string,          // 源标识，前端用它作 ?src= 的值
  name: string,
  version: string,
  baseUrl: string,      // 数据源站点
  referer: string,
  timeout: number,
  userAgent: string,
  imageCdn: string[],   // 备用 CDN 域名列表（按优先级）；固定单 host 的源留空
  decrypt: {
    enabled: boolean,
    algo: string,       // 'aes-256-cbc'
    key: string,
    keyBytes: number,   // 32
    ivBytes: number     // 16
  },
  rules: {
    // match 正则匹配前端路径；path 是上游模板（支持 {id}/{cid}/{keyword}）
    // vars 声明路径变量来源（组号 或 'query:名字'）
    // params 白名单 / paramMap 改名 / paramDefaults 默认值 / multi 多请求组装
    home: { desc, path, params[], match, vars?, paramMap?, paramDefaults?, multi? },
    search: { ... },
    detail: { ... },
    chapters: { ... },   // 无章节源用哨兵 path '__fake_chapters__'
    chapInfo: { ... },
    images: { ... },
    announce: { ... }
  },
  imageRule: {
    desc, match,         // 图片路径正则（按源独立）
    cdn: boolean,        // true → 走 imageCdn 容灾链
    host?: string,       // 或固定单 host（如 https://i.pximg.net）
    decrypt: boolean
  },
  adapt: {               // 可选：字段归一化声明（上游结构≠前端结构时必填）
    listPath, searchListPath, detailPath, imagesPath, totalPath,
    field: { id, title, pic, author, tags, hits },
    searchField: { ... }, // 搜索端点单独一套字段名
    tagsJoin: boolean,
    filterMasked: boolean,
    fakeChapters: boolean
  },
  homeSections: [ { grid, title, key } ]   // 首页栏目；key 指向上游响应里的列表字段
}
```

**已注册的源：**

| key | 名称 | 特点 |
|-----|------|------|
| `manwaxu` | 漫蛙漫画（默认） | AES-256-CBC 加密图 + 4 域名 CDN 容灾链；6 个首页栏目；多话 |
| `pixiv` | pixiv | 明文图 + 固定 host `i.pximg.net`（靠 Referer 防盗链）；日/周/月三榜；免登录；**单话**（`adapt.fakeChapters`） |
