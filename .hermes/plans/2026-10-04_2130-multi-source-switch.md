# 多书源切换 UI — 变更方案（未实施）

> 按 `AGENTS.md` 第 6 条：跨层变更先出方案，不直接改代码。
> 本文件是**提案**，不是已落地的变更。

**目标：** 让阅读器能在多个书源之间切换，前端有切换 UI，代理端按所选源取数、取图、解密。

**架构：** 跨层变更（书源规则层 + 代理路由层 + 前端 UI 层）。核心是把 `BOOK_SOURCES` 从「单一扁平对象」改为「带 key 的源注册表 + 默认源」，并让**源 key 随每个请求传递**（含图片请求）。

**技术栈：** 不变（Node.js Serverless Function + Vanilla JS 单页）。

---

## 0. 前提订正（Task 0 已完成，原判断有误）

### 0.1 运行时描述 — **仓库文档本来就是对的**

实测 `.vercel/output/functions/api/proxy.func/.vc-config.json`：

```json
"runtime": "nodejs24.x"
```

`api/proxy.js` 是 Node 写法（`require('https'/'fs'/'path'/'crypto')` + `module.exports`）。

**订正说明**：本方案初稿写「AGENTS.md/architecture.md 把运行时写成 Edge，是错的」——**该结论基于 `C:\Users\Administrator\Downloads\AGENTS.md` 这份旧附件，不是仓库当前状态**。仓库文档早已订正（`AGENTS.md:18`「Node.js Serverless Function…不是 Edge Runtime」、`AGENTS.md:337`「不把 api/proxy.js 改成 Edge Runtime」），与代码一致；两份 AGENTS.md 相差 278 行。

Task 0 实际只剩一处收尾：`docs/architecture.md` 架构图里的 `Vercel Edge Network` 是 **CDN 边缘网络**（与函数运行时无关），已加注说明以免再次被误读为 Edge Runtime。

→ **本方案的其余部分不受影响**：Node 运行时可用 `fs`/`path`，源配置放独立 JSON 文件这条路依然成立。

### 0.2 目前只有**一个**可用书源 → 切换 UI 无内容可切

| 域名 | DNS | HTTP | 结论 |
|---|---|---|---|
| `manwaxu.cc` | 解析正常（104.17.x.x，Cloudflare） | 200，返回 `comicList` | **可用**（当前唯一源） |
| `manwari.cc` | 解析正常（104.18.37.92 等） | **000，无响应** | 已失效 |

探测命令（本机需 `--ssl-no-revoke` 绕开已知的 OCaml/schannel 问题）：

```bash
curl -s --ssl-no-revoke --max-time 15 -H "Referer: https://manwaxu.cc/" \
  "https://manwaxu.cc/api/home?page=1&pageSize=1&type=0&flag=1"   # → {"code":200,...,"comicList":[...]}
curl -s --ssl-no-revoke --max-time 15 "https://manwari.cc/api/home?..."  # → 000
```

`AGENTS.md` 里「前端配置 manwaxu.cc / 代理端 targetHost manwari.cc」的说法**与代码不符**：代码里 `BOOK_SOURCES.baseUrl` 只有一个值 `https://manwaxu.cc`，全仓库没有 `targetHost` 这个东西。

→ **多书源切换 UI 的价值取决于是否存在第 2 个源。** 在拿到可用源之前，本方案只能做到「注册表就位 + UI 就位 + 单源正常工作」，切换下拉里只有一项。

**需要你提供：** 至少一个可用书源（域名 + 是否同一套 API 路径 + 是否同样的图片 CDN/解密）。或者确认「先只做单源骨架，等有源再加」。

---

## 1. 现状（精确到代码位置）

**代理端 `api/proxy.js`（384 行）**

- `BOOK_SOURCES`（第 38 行起）：扁平单对象，含 `name/version/baseUrl/referer/timeout/userAgent/imageCdn/decrypt/rules/imageRule`。
- `ALLOWED_DATA`（119 行）：`Object.keys(BOOK_SOURCES.rules).map(k => BOOK_SOURCES.rules[k].match)` —— 路径白名单。
- `BOOK_SOURCES.*` 被 12 处直接引用（190/213/214/215/275/277/288/296/304/329/367/382）。
- `/api/source/rules`（270 行）：`res.status(200).send(JSON.stringify(BOOK_SOURCES))` —— **返回整个对象，含解密密钥**。
- 请求形态：`/api/proxy?p=<目标路径>&<业务参数>`（显式携带目标路径，不依赖平台是否保留原始 path）。

**前端 `manga_reader.html`（1683 行）**

- `PROXY = '/api/proxy?p='`（285 行）。
- `BOOK_SOURCES_DEFAULT`（282 行附近）：与代理端同构的副本；`boot()` 时从 `/api/source/rules` 拉取覆盖（306/311-319 行）。
- `buildUrl(path, params)`（338 行附近）：拼 `PROXY + encodeURIComponent(path) + '&' + qs`。
- `toProxyPath(u)`（348 行）：从图片 URL 取 `pathname`，拼 `PROXY + encodeURIComponent(p)` —— **图片请求不带任何源标识**。
- `apiGet` 调用点 8 处（451/489/515/533/550/580/769）。
- `localStorage` 键：`manga_history`（历史）、`manga_pos`（话内位置）、`manga_prefs`（显示设置）。**前两者的 comic id 是源相关的。**

---

## 2. 方案设计

### 2.1 源注册表（代理端）

把 `BOOK_SOURCES` 改成：

```js
/* 源注册表：key → 源定义。新增源只需在此加一项。 */
const SOURCES = {
  manwaxu: {
    key: 'manwaxu',
    name: '漫蛙漫画',
    version: '2.0.0',
    baseUrl: 'https://manwaxu.cc',
    referer: 'https://manwaxu.cc/',
    timeout: 12000,
    userAgent: 'Mozilla/5.0 ...',
    imageCdn: ['https://tu.mhttu.cc', 'https://mwtuwu.cc', 'https://tu.mwzu.cc', 'https://mwtusi.cc'],
    decrypt: { enabled: true, algo: 'aes-256-cbc', key: '...', keyBytes: 32, ivBytes: 16 },
    rules: { /* 同现在 */ },
    imageRule: { desc: '图片资源', match: /^\/en_images\//, cdn: true, decrypt: true }
  }
  // 未来：second: { ... }
};
const DEFAULT_SOURCE = 'manwaxu';

/** 解析请求指定的源；未知 key 回落默认源（不报错，保证旧链接可用） */
function resolveSource(key){
  return (key && SOURCES[key]) || SOURCES[DEFAULT_SOURCE];
}
```

所有 `BOOK_SOURCES.*` 改为**局部变量** `const src = resolveSource(...)` 后的 `src.*`。

`ALLOWED_DATA` 改为按**解析后的源**计算：

```js
function allowedFor(src){
  return Object.keys(src.rules).map(k => src.rules[k].match);
}
```

### 2.2 源 key 的传递（关键）

源 key 走 **query 参数 `src`**，与 `p` 并列：

```
/api/proxy?p=/api/home&page=1&pageSize=12&type=0&flag=1&src=manwaxu
/api/proxy?p=/en_images/202605/cover/94789.jpg&src=manwaxu
```

- **`src` 缺省时用 `DEFAULT_SOURCE`** → 现有 URL、浏览器缓存、书签全部继续工作（这是最重要的兼容保证）。
- **图片请求也必须带 `src`**：否则多源下图片会按默认源去取，取错源（封面能显示、正文图错乱）。

### 2.3 新增 `/api/sources`（列表接口）

```
GET /api/sources → { code:200, data:[ {key,name,version,baseUrl}, ... ] }
```

**只返回展示所需字段，不含 `decrypt.key` / `userAgent` / `rules`。**

保留 `/api/source/rules` 的**现有语义不变**（返回单个源对象），只增加可选 `?src=`：

```
GET /api/source/rules          → 默认源（与现在完全一致）
GET /api/source/rules?src=xxx  → 指定源
```

> 这样做的原因：前端 `boot()` 里是 `if(j && j.rules){ BOOK_SOURCES = j; }`。若把 `/api/source/rules` 改成返回数组，旧前端会静默拿到数组、`j.rules` 为 undefined、**回落到内联默认值且不报错**——很难排查。保持单对象返回最安全。

### 2.4 前端改造

- `state.srcKey`（默认 `DEFAULT_SOURCE`），持久化到 `manga_prefs.srcKey`。
- `buildUrl(path, params)` 末尾追加 `&src=` + `encodeURIComponent(state.srcKey)`。
- `toProxyPath(u)` 同样追加 `&src=`（**所有图片路径都经过它，是唯一的注入点**）。
- `boot()`：
  1. `GET /api/sources` → 建下拉
  2. `GET /api/source/rules?src=<当前>` → 覆盖 `BOOK_SOURCES`
  3. `navigate('home')`
- UI：顶栏 `#srcBadge` 旁边放一个 `<select id="srcSelect">`；切换时调 `switchSource(key)`。
- `switchSource(key)`：
  - 写 `state.srcKey` + `saveReaderPrefs()`
  - **重置源相关状态**：`state.comic / chapters / homeList / detail` 全部清空
  - 重新拉规则 → `navigate('home')`
  - 若正处 reader，先 `stopAutoScroll()` 再退出

### 2.5 存储的源命名空间（易漏）

`manga_history` / `manga_pos` 里存的是**源相关的 comic id**，切源后会指向不存在的漫画。

两种做法（选一，需你定）：
- **A（推荐，改动小）**：历史/位置记录里增加 `src` 字段，读取时过滤掉非当前源的条目。
- **B（改动更小但不保留旧数据）**：键名改为 `manga_history:<src>` / `manga_pos:<src>`，旧键一次性迁移到默认源。

---

## 3. 不能破坏的契约（回归清单）

| # | 契约 | 保证方式 |
|---|---|---|
| 1 | `/api/proxy?p=...` **不带 `src`** 时行为与现在完全一致 | `resolveSource(undefined)` → 默认源；写回归测试逐条比对 |
| 2 | `/api/source/rules` 仍返回**单个源对象**（含 `.rules`） | 不改成数组；只加可选 `?src=` |
| 3 | JSON 字段名 `comicList` / `list` / `images` 不变 | 不在代理层做字段改名 |
| 4 | 图片解密参数与 CDN 顺序不变 | `decrypt` / `imageCdn` 原样搬进源定义，不改值 |
| 5 | HTML 类名/ID 不变（`#readerArea` `.cimg` `#srcBadge` 等） | 只新增 `#srcSelect`，不改既有选择器 |
| 6 | 前端不写代理逻辑、代理不写 UI 渲染 | 源注册表与路由在 proxy；下拉与状态在前端 |
| 7 | `manga_history` / `manga_pos` / `manga_prefs` 键名不改（若选 2.5-A） | 只加字段不改键名 |

---

## 4. 任务拆分（每步可独立验证、独立提交）

### Task 0 — 订正运行时描述（**已完成**）
- `AGENTS.md` / `docs/architecture.md` 早前已订正为 Node.js Serverless Function（commit `5b9f16f`），与代码一致，**无需再改**。
- 本次仅收尾：`docs/architecture.md` 架构图 `Vercel Edge Network` 加注「CDN 边缘网络，与函数运行时无关」。
- 验证：`grep -n "Edge" AGENTS.md docs/architecture.md` → 无「Edge Runtime」误述，仅剩 CDN 边缘与「不是 Edge Runtime」的正确表述。

### Task 1 — 代理端引入源注册表（行为不变）
- 新增 `SOURCES` / `DEFAULT_SOURCE` / `resolveSource()`；`BOOK_SOURCES` 保留为 `SOURCES[DEFAULT_SOURCE]` 的别名（零行为变化）。
- 验证：现有线上响应逐字节比对（同一 URL 请求，`diff` 响应体）。

### Task 2 — 源 key 贯通（`src` 参数）
- 代理端：所有 `BOOK_SOURCES.*` → `src.*`；`allowedFor(src)`。
- 验证：`?src=manwaxu` 与不带 `src` 结果一致；`?src=不存在` 回落默认源不报错。

### Task 3 — 新增 `/api/sources`
- 返回列表（不含密钥字段）。
- 验证：断言响应里**不出现** `key` 的值、`decrypt`、`userAgent`。

### Task 4 — 前端 `src` 注入
- `buildUrl` / `toProxyPath` 追加 `&src=`；`state.srcKey` + prefs 持久化。
- 验证（jsdom）：8 个 `apiGet` 调用点产出的 URL 都含 `src`；图片 `src` 含 `src`。

### Task 5 — 切换 UI 与状态重置
- `<select id="srcSelect">` + `switchSource()`；重置源相关 state。
- 验证（jsdom）：切源后 `state.comic === null`、下拉选中项正确、prefs 已落盘。

### Task 6 — 存储命名空间（2.5 选定方案）
- 按 A 或 B 实现；旧数据迁移。
- 验证：默认源下历史/位置仍能恢复（回归）；切源后不串。

### Task 7 — 接入第二个源（**阻塞于 0.2**）
- 需要你提供可用源。若新源 JSON 字段与 manwaxu 不同 → 需在**前端渲染层**加字段映射，那是更深一层的跨层改动，**需另出方案**。

---

## 5. 验证方法

- **代理端**：Node 本地起 handler 直接打桩（`req`/`res` mock），断言路由、`src` 解析、白名单、密钥不外泄。现有 `api/proxy.js` 可 `require` 进测试（Node 运行时，不需要 Edge 模拟）。
- **前端**：沿用现有 jsdom 测试套件（`C:\Users\Administrator\AppData\Local\Temp\fdcheck\`，现有 9 个文件 / 361 项断言），新增 `multisrc.js`。
- **线上**：切源后走完 home → detail → chapters → reader → 图片全链路；用 `browser_exec` 真实点击验证（本机 curl 到 vercel.app 被阻断）。
- **部署确认**：`gh api repos/dickisz1/my-mirror/deployments` 轮询 status（push 自动部署已确认生效）。

---

## 6. 风险与权衡

| 风险 | 说明 | 缓解 |
|---|---|---|
| **无第二源** | `manwari.cc` 已失效；切换 UI 只有一项 | 先做骨架；拿到源再 Task 7 |
| **源间 JSON 字段不一致** | 若不同源字段名不同，前端渲染层要加映射 → 更深的跨层改动 | Task 7 前先比对两源响应结构 |
| **图片串源** | 图片请求漏带 `src` → 封面正常、正文错乱（最难排查） | `toProxyPath` 是唯一注入点，单点测试覆盖 |
| **旧链接失效** | 若 `src` 缺省不回落默认源 | Task 2 显式测试「不带 src」路径 |
| **历史数据串源** | comic id 源相关 | Task 6 命名空间 |
| **`/api/source/rules` 泄露密钥** | 现在就把 `decrypt.key` 发给前端 | 该密钥前端本来也有；新增 `/api/sources` 不重复泄露。若要收紧，另议 |
| 代理层变重 | 源注册表让 proxy 变大 | 源定义是数据不是逻辑；如需分离可用 `fs` 读 JSON（Node 运行时允许，见 0.1） |

---

## 7. 待你决策

1. **第二个源是什么？** 或「先只做单源骨架」。
2. 不同源的 API 路径/JSON 字段是否一致？（决定是否要加字段映射层）
3. 图片 CDN 与解密参数是否各源不同？（方案已按「源内独立」设计）
4. 存储命名空间选 **A**（加 `src` 字段，保留旧数据）还是 **B**（键名加前缀）？
5. 是否需要「源失效自动回退备用源」，还是纯手动切换？
6. 本方案文件是否要提交进仓库（`docs/`），还是仅作提案留在本地？
