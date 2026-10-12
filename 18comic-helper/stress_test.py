#!/usr/bin/env python3
"""压测：连续 3 个任务，测 CF 过盾耗时波动 + 失败原因透传"""
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
    req = urllib.request.Request(url, headers={'User-Agent': 'stress/1.0'})
    try:
        r = opener.open(req, timeout=30)
        return r.status, r.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8')


def run_one(idx, api_path):
    t0 = time.time()
    code, body = get(f"{BASE}/task?path={api_path}")
    if code != 200:
        print(f"  任务{idx}: 创建失败 HTTP {code}")
        return None
    task_id = json.loads(body)['task_id']

    # 等 worker 处理（最多 240 秒，覆盖 180s CF 窗口）
    for i in range(48):
        time.sleep(5)
        code, body = get(f"{BASE}/status?task_id={task_id}")
        if code != 200:
            continue
        d = json.loads(body)
        if d.get('status') in ('done', 'failed'):
            elapsed = time.time() - t0
            res = d.get('result') or {}
            ok = res.get('status') == 'ok'
            print(f"  任务{idx}: {d['status']} ({elapsed:.0f}s) "
                  f"content={res.get('content_length')} error={res.get('error')}")
            return {'ok': ok, 'elapsed': elapsed, 'len': res.get('content_length'),
                    'error': res.get('error')}
    print(f"  任务{idx}: 超时（240s）")
    return {'ok': False, 'elapsed': 240, 'len': None, 'error': '客户端超时'}


def main():
    print("=" * 60)
    print("压测：连续 3 个任务（测 CF 波动 + 失败原因透传）")
    print("=" * 60)

    paths = ['/albums', '/albums/doujin', '/albums']
    results = []
    for i, p in enumerate(paths, 1):
        print(f"\n[{i}/3] path={p}")
        r = run_one(i, p)
        if r:
            results.append(r)

    print("\n" + "=" * 60)
    print("汇总")
    print("=" * 60)
    ok_count = sum(1 for r in results if r['ok'])
    print(f"成功 {ok_count}/{len(results)}")
    for i, r in enumerate(results, 1):
        status = "✅" if r['ok'] else "❌"
        print(f"  {status} 任务{i}: {r['elapsed']:.0f}s  content={r['len']}  err={r['error']}")
    if results:
        times = [r['elapsed'] for r in results if r['ok']]
        if times:
            print(f"\nCF 过盾+取数耗时: min={min(times):.0f}s  max={max(times):.0f}s  "
                  f"avg={sum(times)/len(times):.0f}s")


if __name__ == "__main__":
    main()
