#!/bin/bash
# 重启 ubuntu worker（避免 pkill -f 自匹配）
cd /root

# 用 pgrep 找 python 进程，排除自己
for pid in $(pgrep -f "cloak-env/bin/python"); do
  # 跳过当前脚本自身
  if [ "$pid" != "$$" ]; then
    kill "$pid" 2>/dev/null
  fi
done
sleep 2

cp /mnt/c/Users/Administrator/fdasfsd/18comic-helper/ubuntu_worker.py /root/ubuntu_worker.py
echo "worker file updated: $(grep -c 'resp.status == 204' /root/ubuntu_worker.py) occurrence(s) of 204 fix"
echo "remaining python procs: $(pgrep -f 'cloak-env/bin/python' | wc -l)"
