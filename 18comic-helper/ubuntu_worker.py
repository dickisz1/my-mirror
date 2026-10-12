#!/usr/bin/env python3
"""
Ubuntu Worker — 方案2 部署版

流程：
  1. 轮询 Vercel 获取任务
  2. 用 CloakBrowser 过盾 + 取数
  3. POST 结果回 Vercel
  4. 循环

依赖：
  - pip install cloakbrowser
  - apt install xvfb fonts-liberation
"""

import sys
import json
import time
import urllib.request
import urllib.error
import ssl
import os

# 配置
VERCEL_URL = "https://my-mirror-three.vercel.app"
TASK_POLL_INTERVAL = 2  # 秒
PROXY = "http://172.21.128.1:20810"
MAX_RETRIES = 3

def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    print(f"[ubuntu-worker] {ts} {msg}", flush=True)

def poll_task():
    """认领 Vercel 上的待办任务（无任务返回 None）"""
    url = f"{VERCEL_URL}/api/proxy/claim"
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'ubuntu-worker/1.0',
        })
        # 通过代理访问 Vercel
        proxy_handler = urllib.request.ProxyHandler({
            'https': PROXY,
            'http': PROXY,
        })
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        opener = urllib.request.build_opener(proxy_handler, urllib.request.HTTPSHandler(context=ctx))
        resp = opener.open(req, timeout=30)
        if resp.status == 204:
            return None  # 没有待办任务
        raw = resp.read().decode('utf-8')
        if not raw.strip():
            return None
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        if e.code == 204:
            return None  # 没有任务
        log(f"claim task HTTP error: {e.code}")
        return None
    except Exception as e:
        log(f"claim task error: {e}")
        return None

def _cf_cleared(page):
    """真正判据：cf_clearance cookie 是否已下发（标题不可靠）"""
    try:
        for c in page.context.cookies():
            if c.get('name') == 'cf_clearance' and c.get('value'):
                return True
    except Exception:
        pass
    return False


def _title_settled(page):
    """标题既不含挑战特征、也不是导航中途的 Loading/空白"""
    try:
        t = (page.title() or '').strip()
    except Exception:
        return False
    if not t:
        return False
    bad = ('Just a moment', '请稍候', 'Attention Required', 'Loading', 'about:blank')
    return not any(b in t for b in bad)


def _wait_cf(page, budget_s=240):
    """等 CF 过盾：cf_clearance 下发 且 标题稳定，二者同时满足才算通过"""
    deadline = time.time() + budget_s
    while time.time() < deadline:
        if _cf_cleared(page) and _title_settled(page):
            return True
        page.wait_for_timeout(2000)
    return False


def solve_and_fetch(task_id, api_path):
    """用 CloakBrowser 过盾 + 取数（持久会话：过盾一次，后续任务复用同一 IP）"""
    from cloakbrowser import launch

    log(f"启动 CloakBrowser 过盾+取数: {api_path}")

    try:
        browser = launch(
            headless=False,
            proxy=PROXY,
            humanize=True,
            locale="en-US",
            timezone="Europe/London",
        )
    except Exception as e:
        log(f"CloakBrowser 启动失败: {e}")
        return {
            "task_id": task_id,
            "api_path": api_path,
            "status": "failed",
            "error": f"CloakBrowser 启动失败: {e}",
        }

    try:
        page = browser.new_page()

        # 步骤 1：过盾（判据用 cf_clearance，不用标题）
        page.goto("https://18comic.vip/", wait_until="domcontentloaded", timeout=60000)

        if not _wait_cf(page, budget_s=240):
            log("CF 挑战超时（240s）")
            return {
                "task_id": task_id,
                "api_path": api_path,
                "status": "failed",
                "error": "CF 挑战超时（240s）—— 代理出口不稳，建议重试",
            }

        log(f"CF 过盾成功（cf_clearance 已下发）: {page.title()}")

        # 步骤 2：取数
        target_url = f"https://18comic.vip{api_path}"
        log(f"访问: {target_url}")

        try:
            page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            log(f"导航异常: {e}")

        # 取数后也等一次，避免读到导航中途的空白
        _wait_cf(page, budget_s=60)
        page.wait_for_timeout(1500)

        title = page.title()
        content = page.content()

        # 取数后如果又撞盾，说明 cookie 没生效
        if not _cf_cleared(page) or 'Just a moment' in title or '请稍候' in title:
            log(f"取数时遇到 CF 挑战（title={title}）")
            return {
                "task_id": task_id,
                "api_path": api_path,
                "status": "failed",
                "error": f"取数时遇到 CF 挑战（title={title}）—— cookie 失效或出口 IP 变了",
            }

        if len(content) < 1000:
            log(f"内容过短: {len(content)} 字节")
            return {
                "task_id": task_id,
                "api_path": api_path,
                "status": "failed",
                "error": f"内容过短: {len(content)} 字节",
            }

        log(f"取数成功: {len(content)} 字节")

        return {
            "task_id": task_id,
            "api_path": api_path,
            "status": "ok",
            "title": title,
            "content": content,
            "content_length": len(content),
        }

    finally:
        browser.close()

def post_callback(result):
    """POST 结果回 Vercel"""
    url = f"{VERCEL_URL}/api/proxy/callback"
    data = json.dumps(result).encode('utf-8')
    
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, data=data, headers={
                'Content-Type': 'application/json',
                'User-Agent': 'ubuntu-worker/1.0',
            })
            proxy_handler = urllib.request.ProxyHandler({
                'https': PROXY,
                'http': PROXY,
            })
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            opener = urllib.request.build_opener(proxy_handler, urllib.request.HTTPSHandler(context=ctx))
            resp = opener.open(req, timeout=30)
            log(f"回调成功: {resp.status}")
            return True
        except Exception as e:
            log(f"回调失败 (尝试 {attempt+1}/{MAX_RETRIES}): {e}")
            time.sleep(2)
    
    return False

def main():
    log("=" * 60)
    log("Ubuntu Worker 启动")
    log("=" * 60)
    log(f"Vercel: {VERCEL_URL}")
    log(f"代理: {PROXY}")
    log(f"轮询间隔: {TASK_POLL_INTERVAL}秒")
    log("")
    
    # 检查 cloakbrowser
    try:
        import cloakbrowser
        log("cloakbrowser 已安装")
    except ImportError:
        log("错误: cloakbrowser 未安装")
        log("运行: pip install cloakbrowser")
        sys.exit(1)
    
    # 主循环
    while True:
        try:
            # 轮询任务
            task = poll_task()
            
            if task and task.get('task_id'):
                task_id = task['task_id']
                api_path = task.get('api_path', '/albums')
                
                log(f"收到任务: {task_id} -> {api_path}")
                
                # 取数
                result = solve_and_fetch(task_id, api_path)
                
                if result:
                    # 回传
                    post_callback(result)
                else:
                    # 回传失败
                    post_callback({
                        "task_id": task_id,
                        "api_path": api_path,
                        "status": "failed",
                        "error": "CloakBrowser 取数失败",
                    })
            else:
                # 没有任务，继续轮询
                pass
            
            time.sleep(TASK_POLL_INTERVAL)
            
        except KeyboardInterrupt:
            log("收到中断信号，退出")
            break
        except Exception as e:
            log(f"主循环异常: {e}")
            time.sleep(5)

if __name__ == "__main__":
    main()
