#!/usr/bin/env python3
"""验证 Vercel 无状态假设：任务建在实例 A，回调/查询打到实例 B 会 404"""
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


def req(method, url, body=None):
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={'User-Agent': 'stateless-probe/1.0',
                                        'Content-Type': 'application/json'})
    try:
        resp = opener.open(r, timeout=20)
        return resp.status, resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')


def main():
    print("=" * 60)
    print("验证：Vercel 任务状态是否跨实例可见")
    print("=" * 60)

    created = []
    print("\n[A] 连建 5 个任务，立刻查各自 status")
    for i in range(1, 6):
        c, b = req('GET', f"{BASE}/task?path=/albums")
        if c != 200:
            print(f"  {i}: 建任务失败 HTTP {c}")
            continue
        tid = json.loads(b)['task_id']
        created.append(tid)
        c2, b2 = req('GET', f"{BASE}/status?task_id={tid}")
        print(f"  {i}: {tid[:8]}... 建={c} 查={c2}")
        time.sleep(0.5)

    print("\n[B] 等 8 秒后，重查全部任务（可能已切实例）")
    time.sleep(8)
    lost = 0
    for tid in created:
        c, b = req('GET', f"{BASE}/status?task_id={tid}")
        mark = "✅" if c == 200 else "❌"
        if c != 200:
            lost += 1
        print(f"  {mark} {tid[:8]}... HTTP {c}")
        time.sleep(0.3)

    print("\n[C] 回调一个不存在的 task_id（模拟跨实例回调）")
    c, b = req('POST', f"{BASE}/callback", {
        "task_id": "00000000-dead-beef-0000-000000000000",
        "api_path": "/albums", "status": "ok",
        "title": "x", "content": "y", "content_length": 1,
    })
    print(f"  回调不存在任务 -> HTTP {c}  body={b[:120]}")

    print("\n" + "=" * 60)
    if lost:
        print(f"❌ {lost}/{len(created)} 个任务在 8 秒后丢失")
        print("   证实：Vercel 无状态多实例，内存 Map 不共享")
        print("   修法：任务状态存外部（Upstash Redis / Vercel KV）")
    else:
        print(f"✅ {len(created)} 个任务全部可见")
        print("   本次未复现跨实例丢失（可能命中同实例）")
    print("=" * 60)


if __name__ == "__main__":
    main()
