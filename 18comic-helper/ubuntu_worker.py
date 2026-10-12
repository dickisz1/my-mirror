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

def solve_and_fetch(task_id, api_path):
    """用 CloakBrowser 过盾 + 取数"""
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
        
        # 步骤 1：过盾
        page.goto("https://18comic.vip/", wait_until="domcontentloaded", timeout=60000)
        
        passed = False
        # CF 挑战耗时不稳定：实测 26s~120s+，窗口放宽到 180s
        for i in range(90):
            title = page.title()
            if 'Just a moment' not in title and '请稍候' not in title and 'Attention Required' not in title:
                passed = True
                break
            page.wait_for_timeout(2000)
        
        if not passed:
            log("CF 挑战超时（180s）")
            return {
                "task_id": task_id,
                "api_path": api_path,
                "status": "failed",
                "error": "CF 挑战超时（180s）—— 代理出口可能不稳，建议重试",
            }
        
        log(f"CF 挑战通过: {page.title()}")
        
        # 步骤 2：取数（构造完整 URL）
        target_url = f"https://18comic.vip{api_path}"
        log(f"访问: {target_url}")
        
        try:
            page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            log(f"导航异常: {e}")
        
        page.wait_for_timeout(2000)
        
        title = page.title()
        content = page.content()
        
        # 检查是否还是 CF 挑战
        if 'Just a moment' in title or '请稍候' in title:
            log("取数时遇到 CF 挑战")
            return {
                "task_id": task_id,
                "api_path": api_path,
                "status": "failed",
                "error": "取数时遇到 CF 挑战 —— cookie 失效或出口 IP 变了",
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
