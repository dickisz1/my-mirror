# 漫蛙漫画 · 书源阅读器

输入一个网址 → **先给你前端界面** → 再按**书源规则 + 你的操作**去真实网站取数据 → 把漫画搬过来给你看。

## 一句话概括

你只做一件事：打开浏览器访问站点地址。系统先返回阅读器界面，之后你在界面上点漫画、选章节、往下滑，前端就按书源规则去 manwaxu.cc 和图片 CDN 取数据，全部经代理中转，你不需要知道背后是哪些站在干活。

## 输入 → 输出流程

### 输入是什么？

打开浏览器，访问部署好的站点地址（如 `your-site.vercel.app`）。

### 中间发生了什么？

| 步骤 | 发生了什么 |
|---|---|
| 第一步：请求被"截胡" | 浏览器请求到达 Vercel，`vercel.json` 像门卫，把 `/(.*)` 全部转交给 `api/proxy.js` |
| 第二步：先返回前端界面 | `proxy.js` 先返回 `manga_reader.html`，你看到列表页、搜索框、阅读器 |
| 第三步：按书源规则 + 用户行为取数据 | 你在界面上的操作触发对应书源规则，前端经 `proxy.js` 去真实网站取数据 |
| 第四步：浏览器渲染内容 | 浏览器拿到 JSON / 图片后渲染列表、详情、章节、懒加载图片，并把阅读进度记到本地 |

第三步里"什么操作触发什么规则"：

| 用户行为 | 触发的书源规则 | 实际请求 |
|---|---|---|
| 打开首页 / 切分类 / 翻页 | `home` 规则 | `/api/home?page=&pageSize=&type=&flag=` |
| 输入关键词 | `search` 规则 | `/api/search?keyword=&page=&pageSize=` |
| 点漫画 | `detail` 规则 | `/api/comic/{id}` |
| 看章节列表 | `chapters` 规则 | `/api/comic/{id}/chapters` |
| 选章节 | `images` 规则 | `/api/comic/image/{cid}?page=&page_size=&image_source=` |
| 往下滑 | 图片规则 + 备用 CDN 规则 | `/en_images/...` → 依次换 CDN 域名重试 → 代理端解密 |
| 图片加载失败 | 备用 CDN 规则 | 自动切换到下一个 CDN 域名 |

### 输出是什么？

一页页漫画图片正常显示，可以翻页、切换章节、切分类、搜索，下次打开接着看。

## 四个文件

| 文件 | 大白话 |
|---|---|
| `manga_reader.html` | 前端界面 + 书源规则配置（去哪取数据、怎么取） |
| `api/proxy.js` | 先返回前端界面，后续按书源规则帮前端去真实网站取数据（含图片解密、备用 CDN 重试） |
| `vercel.json` | 门卫，所有请求先经过它，统一转给 proxy |
| `README.md` | 说明文档 |

## 书源规则表

权威副本在 `api/proxy.js` 的 `SOURCES` 注册表，前端启动时通过 `/api/proxy?p=/api/source/rules&src=<key>` 按源拉取；
拉不到则退回 `manga_reader.html` 内联的默认值。阅读器顶栏「🔧 书源规则」可实时查看当前生效的规则。

**三个源**：`manwaxu`（默认，AES 加密图 + 4 域名 CDN 容灾）、`pixiv`（明文图 + Referer 防盗链，单话）、`comic18`（Cloudflare 盾 + 图片切片还原，**需 helper 进程**）。

`manwaxu` 的动作表：

| 动作 | 目标路径 | 参数 |
|---|---|---|
| `home` | `/api/home` | page, pageSize, type, flag |
| `search` | `/api/search` | keyword, page, pageSize |
| `detail` | `/api/comic/{id}` | — |
| `chapters` | `/api/comic/{id}/chapters` | — |
| `chapInfo` | `/api/comic/chapter/info/{cid}` | — |
| `images` | `/api/comic/image/{cid}` | page, page_size, image_source |
| `announce` | `/api/announcements` | — |

图片规则：路径匹配 `/en_images/`，备用 CDN 依次为
`tu.mhttu.cc` → `mwtuwu.cc` → `tu.mwzu.cc` → `mwtusi.cc`，全部失败才报错。

图片解密：CDN 返回的是 AES-256-CBC 密文（前 16 字节 = IV，其余 = 密文），
密钥取 `0B6666A0-BB59-1381-B746-a0E4C9AC` 的 UTF-8 前 32 字节。
代理端解密后下发明文 JPEG/PNG/WebP，前端无需关心加密。

## 加新源 / 换源

只需要改书源配置，不用动整个流程：

1. 在 `api/proxy.js` 的 `SOURCES` 里加一个源（`rules` + `imageRule` + 可选的 `adapt`/`homeSections`）；
2. 图片源改 `imageCdn` 数组，加解密方式改 `decrypt` 段；
3. 前端**无需改动**——源列表和栏目都由代理端下发。

> `comic18` 这类有 Cloudflare 盾的源，整源走 `viaHelper: true`，由 helper 进程承担取数。

## 部署

已接入 Vercel Git 集成，**push 到 `main` 即自动部署**。

环境变量（可选）：`COMIC_HELPER` —— 指定 18comic 的 helper 地址，默认 `http://127.0.0.1:8765`。
线上要真正能用 18comic，需把它指向一台墙外 VPS。

`vercel.json` 已声明 `functions.includeFiles: manga_reader.html`，
确保 `proxy.js` 在运行时能读到前端文件并作为「第二步」返回。

## 注意事项

- 数据来源：manwaxu.cc / pixiv.net / 18comic.vip（按所选书源）
- 代理只放行书源规则表内的路径，未命中规则的请求返回 404（避免成为任意转发器）
- `?helper=` 参数**只放行 loopback 地址**（localhost / 127.x / [::1]），防 SSRF
- 阅读进度仅存本地 `localStorage`，不存储任何用户数据

## 文档

| 文件 | 给谁看 |
|---|---|
| `使用说明.md` | **使用者**——怎么用、快捷键、常见问题 |
| `README.md`（本文） | 项目概览、部署 |
| `AGENTS.md` | 下一个 AI 会话——编码契约、不可破坏的约定 |
| `docs/architecture.md` | 架构、数据流、风险清单 |
