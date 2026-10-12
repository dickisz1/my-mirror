#!/usr/bin/env python3
"""端到端测试：前端建任务 → worker 认领取数 → 前端轮询拿结果"""
import json
import time
import urllib.request
import urllib.error
import ssl

PROXY = "http://172.21.128.1:20810"
BASE = "https://my-mirror-three.vercel.app/api/proxy"

opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({'https': PROXY, 'http': PROXY}),
    urllib.request.HTTPSHandler(context=ssl._create_unverified_context()),
)


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'e2e-test/1.0'})
    try:
        r = opener.open(req, timeout=30)
        return r.status, r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')


def main():
    print("=" * 60)
    print("端到端测试：comic18 完整流程（方案2 短轮询）")
    print("=" * 60)

    # 步骤 1：前端创建任务
    code, body = get(f"{BASE}/task?path=/albums")
    print(f"\n[1] 创建任务 HTTP {code}")
    if code != 200:
        print(f"❌ 失败: {body[:200]}")
        return
    task_id = json.loads(body)['task_id']
    print(f"    task_id = {task_id}")

    # 步骤 2：轮询状态，等 worker 认领并回传
    print(f"\n[2] 轮询任务状态（最多 120 秒）...")
    for i in range(24):
        time.sleep(5)
        code, body = get(f"{BASE}/status?task_id={task_id}")
        if code != 200:
            print(f"    [{i+1}] HTTP {code}")
            continue
        d = json.loads(body)
        status = d.get('status')
        print(f"    [{i+1}] status={status}")
        if status in ('done', 'failed'):
            print(f"\n[3] 任务完成，结果:")
            result = d.get('result') or {}
            print(f"    status      = {result.get('status')}")
            print(f"    title       = {result.get('title')}")
            print(f"    content_len = {result.get('content_length')}")
            print(f"    error       = {result.get('error')}")
            print()
            if result.get('status') == 'ok' and result.get('content_length', 0) > 10000:
                print("=" * 60)
                print("✅ 端到端验证通过")
                print("   前端建任务 → worker 认领 → CloakBrowser 取数 → 回传 → 前端拿到")
                print("=" * 60)
            else:
                print("=" * 60)
                print("❌ 取数失败")
                print("=" * 60)
            return

    print("\n❌ 超时：worker 未在 120 秒内完成任务")


if __name__ == "__main__":
    main()
