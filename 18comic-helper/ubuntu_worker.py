#!/usr/bin/env python3
"""
Ubuntu Worker — API 模式（方案2 · 无 CloakBrowser）

流程：
  1. 轮询 Vercel 认领任务（/claim）
  2. 用 jmcomic.JmApiClient 调 18comic 移动端 JSON API（签名 + AES 解密由库内部完成）
  3. 把 jmcomic 实体映射成前端契约形状（comicList / list / images ...）
  4. POST 结果回 Vercel（/callback）

关键点：
  - 不再需要 CF 过盾：API 域名（www.cdnhjk.net 等）不拦 CF
  - 不再需要 xvfb / Chromium
  - 延迟从 26s~146s 降到几秒

依赖：
  - pip install jmcomic
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ── 配置 ──────────────────────────────────────────────
VERCEL_URL = "https://my-mirror-three.vercel.app"
TASK_POLL_INTERVAL = 2
PROXY = "http://172.31.112.1:20810"
MAX_RETRIES = 3

# jmcomic 内部用 curl_cffi，读环境变量走代理
os.environ.setdefault("http_proxy", PROXY)
os.environ.setdefault("https_proxy", PROXY)


def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    print(f"[ubuntu-worker] {ts} {msg}", flush=True)


# ── Vercel 通信 ───────────────────────────────────────
def _opener():
    proxy_handler = urllib.request.ProxyHandler({'https': PROXY, 'http': PROXY})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return urllib.request.build_opener(
        proxy_handler, urllib.request.HTTPSHandler(context=ctx))


def poll_task():
    """认领 Vercel 上的待办任务（无任务返回 None）"""
    url = f"{VERCEL_URL}/api/proxy/claim"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'ubuntu-worker/2.0'})
        resp = _opener().open(req, timeout=30)
        if resp.status == 204:
            return None
        raw = resp.read().decode('utf-8')
        if not raw.strip():
            return None
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        if e.code == 204:
            return None
        log(f"claim task HTTP error: {e.code}")
        return None
    except Exception as e:
        log(f"claim task error: {e}")
        return None


def post_callback(result):
    """POST 结果回 Vercel"""
    url = f"{VERCEL_URL}/api/proxy/callback"
    data = json.dumps(result).encode('utf-8')
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, data=data, headers={
                'Content-Type': 'application/json',
                'User-Agent': 'ubuntu-worker/2.0',
            })
            resp = _opener().open(req, timeout=30)
            log(f"回调成功: {resp.status}")
            return True
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='replace')[:300]
            log(f"回调失败 (尝试 {attempt+1}/{MAX_RETRIES}): HTTP {e.code} {body}")
            time.sleep(2)
        except Exception as e:
            log(f"回调失败 (尝试 {attempt+1}/{MAX_RETRIES}): {e}")
            time.sleep(2)
    return False


# ── jmcomic 客户端（懒加载单例）───────────────────────
_client = None
_cdn_host = None


def get_client():
    global _client, _cdn_host
    if _client is None:
        from jmcomic import JmOption, JmModuleConfig
        option = JmOption.default()
        option.client.impl = 'api'      # 移动端 JSON API（不拦 CF）
        _client = option.new_jm_client()
        try:
            hosts = JmModuleConfig.DOMAIN_IMAGE_LIST
            _cdn_host = hosts[0] if isinstance(hosts, (list, tuple)) else str(hosts)
        except Exception:
            _cdn_host = 'cdn-msp.jmapiproxy2.cc'
    return _client


def cdn():
    get_client()
    return _cdn_host


# ── 实体 → 前端契约 ───────────────────────────────────
def cover_url(album_id, size='_3x4'):
    """封面完整 URL（get_album_cover_url 已含协议+域名，勿再拼）"""
    from jmcomic import JmcomicText
    return JmcomicText.get_album_cover_url(album_id, size=size)


def card_of(album_id, title):
    """搜索/分类结果 → 卡片（搜索结果只有 id+标题，作者/标签留空）"""
    cu = cover_url(album_id)
    return {
        'id': album_id,
        'title': title,
        'pic': cu,
        'cover': cu,
        'author': '',
        'tags': '',
    }


def shape_home(q):
    """前端 /api/home → categories_filter（首页=分类列表）"""
    page = int(q.get('page', 1) or 1)
    type_map = {
        '0': 'all', '1': 'all', '2': 'all',
        'gufeng': 'gufeng', 'xuanhuan': 'xuanhuan', 'xiaoyuan': 'xiaoyuan',
        'doujin': 'doujin', 'hanman': 'hanman', 'manhua': 'manhua',
        'vip': 'all', 'another': 'another',
    }
    category = type_map.get(str(q.get('type', '0')), 'all')
    cf = get_client().categories_filter(page=page, time='a', category=category, order_by='mv')
    items = list(cf)
    return {
        'comicList': [card_of(aid, name) for aid, name in items],
        'total': getattr(cf, 'total', len(items)) or len(items),
        'page': page,
    }


def shape_search(q):
    """前端 /api/search → search()"""
    keyword = q.get('keyword', '') or ''
    page = int(q.get('page', 1) or 1)
    sp = get_client().search(
        search_query=keyword, page=page, main_tag=0,
        order_by='mr', time='a', category='0', sub_category=None,
    )
    items = list(sp)
    return {
        'list': [card_of(aid, name) for aid, name in items],
        'total': getattr(sp, 'total', len(items)) or len(items),
        'page': page,
    }


def shape_detail(album_id):
    """前端 /api/comic/{id} → get_album_detail"""
    d = get_client().get_album_detail(album_id)
    tags = d.tags
    if isinstance(tags, (list, tuple)):
        tags = ','.join(str(t) for t in tags)
    cu = cover_url(d.album_id)
    return {
        'id': d.album_id,
        'title': d.name,
        'author': d.author or '',
        'cover': cu,
        'pic': cu,
        'tags': tags or '',
        'intro': getattr(d, 'description', '') or '',
        'description': getattr(d, 'description', '') or '',
        'tHits': int(getattr(d, 'views', 0) or 0),
        'sHits': int(getattr(d, 'views', 0) or 0),
        'collection': int(getattr(d, 'likes', 0) or 0),
        'status': 1,
        'pageCount': int(getattr(d, 'page_count', 0) or 0),
    }


def shape_chapters(album_id):
    """前端 /api/comic/{id}/chapters → album.episode_list"""
    d = get_client().get_album_detail(album_id)
    pc = int(getattr(d, 'page_count', 0) or 0)
    out = []
    for ep in d.episode_list:
        if isinstance(ep, (list, tuple)):
            pid = ep[0]
            idx = ep[1] if len(ep) > 1 else ''
            name = ep[2] if len(ep) > 2 else ''
        else:
            pid, idx, name = ep.photo_id, ep.index, ep.name
        out.append({
            'id': pid,
            'title': name or f'第{idx}话',
            'sortId': idx,
            'picCount': pc,
            'isVip': False,
        })
    return {'list': out, 'total': len(out)}


def shape_images(cid):
    """前端 /api/comic/image/{cid} → get_photo_detail（含切片还原参数）"""
    from jmcomic import JmImageTool
    p = get_client().get_photo_detail(cid)
    imgs = list(p)
    scramble_id = int(getattr(p, 'scramble_id', 0) or 0)
    out = []
    for im in imgs:
        url = im.img_url
        try:
            block_num = JmImageTool.get_num(scramble_id, p.photo_id, im.filename_without_suffix)
        except Exception:
            block_num = 0
        out.append({
            'url': url,
            'urlOrig': url,
            'index': im.index,
            'blockNum': block_num,
        })
    return {
        'images': out,
        'scrambleId': scramble_id,
        'photoId': p.photo_id,
        'albumId': p.album_id,
        'title': p.name,
        'total': len(out),
    }


# ── 路径 → 形状映射 ───────────────────────────────────
def solve_task(task_id, api_path):
    """按前端路径分派到对应 jmcomic 调用"""
    parsed = urllib.parse.urlsplit(api_path)
    path = parsed.path
    q = dict(urllib.parse.parse_qsl(parsed.query))

    log(f"API 取数: {api_path}")
    t0 = time.time()

    try:
        if path == '/api/home':
            data = shape_home(q)
        elif path == '/api/search':
            data = shape_search(q)
        elif path.endswith('/chapters'):
            data = shape_chapters(path.split('/')[3])
        elif path.startswith('/api/comic/image/'):
            data = shape_images(path.split('/')[-1])
        elif path.startswith('/api/comic/'):
            data = shape_detail(path.split('/')[3])
        elif path == '/api/announcements':
            data = {'list': [], 'total': 0}
        else:
            return {
                'task_id': task_id, 'api_path': api_path, 'status': 'failed',
                'error': f'未知路径: {path}',
            }
    except Exception as e:
        import traceback
        log(f"API 调用失败: {e}")
        log(traceback.format_exc()[:800])
        return {
            'task_id': task_id, 'api_path': api_path, 'status': 'failed',
            'error': f'{type(e).__name__}: {e}',
        }

    content = json.dumps(data, ensure_ascii=False)
    dt = time.time() - t0
    title = ''
    if isinstance(data, dict):
        title = data.get('title') or ''
        if not title:
            lst = data.get('list') or data.get('comicList') or []
            if lst:
                title = lst[0].get('title', '')
    log(f"取数成功: {len(content)} 字节, 耗时 {dt:.2f}s")

    return {
        'task_id': task_id,
        'api_path': api_path,
        'status': 'ok',
        'title': title,
        'content': content,
        'content_length': len(content),
    }


# ── 主循环 ────────────────────────────────────────────
def main():
    log("=" * 60)
    log("Ubuntu Worker 启动（API 模式 · 无 CloakBrowser）")
    log("=" * 60)
    log(f"Vercel: {VERCEL_URL}")
    log(f"代理: {PROXY}")
    log(f"轮询间隔: {TASK_POLL_INTERVAL}秒")

    try:
        import jmcomic
        log(f"jmcomic 已安装: {jmcomic.__version__}")
    except ImportError:
        log("错误: jmcomic 未安装 → pip install jmcomic")
        sys.exit(1)

    try:
        get_client()
        log(f"API 客户端就绪, 图片 CDN: {cdn()}")
    except Exception as e:
        log(f"预热失败（继续）: {e}")

    log("")
    while True:
        try:
            task = poll_task()
            if task and task.get('task_id'):
                task_id = task['task_id']
                api_path = task.get('api_path', '/api/home')
                log(f"收到任务: {task_id} -> {api_path}")
                result = solve_task(task_id, api_path)
                post_callback(result)
            time.sleep(TASK_POLL_INTERVAL)
        except KeyboardInterrupt:
            log("收到中断信号，退出")
            break
        except Exception as e:
            log(f"主循环异常: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()
