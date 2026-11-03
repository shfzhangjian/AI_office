#!/usr/bin/env bash
# town_state.sh — 一条命令改小镇我的状态（抄 Star-Office-UI set_state.py 协议）
# 用法: town_state.sh <state> [detail]
# 状态: idle|writing|receiving|replying|researching|executing|syncing|error（working/running 等同义词自动归一）
set -u
# 状态文件位置与 collectord 一致：TOWN_DIR（默认 ~/ai-office-town）
TOWN="${TOWN_DIR:-$HOME/ai-office-town}"
mkdir -p "$TOWN"
F="$TOWN/state.json"
if [ -n "${TOWN_AGENT_ID:-}" ]; then
  case "$TOWN_AGENT_ID" in *[!a-zA-Z0-9_.-]*) echo "无效 TOWN_AGENT_ID" >&2; exit 1 ;; esac
  mkdir -p "$TOWN/agents"
  F="$TOWN/agents/$TOWN_AGENT_ID.json"
fi
S="${1:-idle}"
D="${2:-}"
case "$S" in
  working|busy|write) S=writing ;;
  run|running|execute|exec) S=executing ;;
  sync) S=syncing ;;
  research|search) S=researching ;;
  idle|writing|receiving|replying|researching|executing|syncing|error) : ;;
  *) echo "无效状态: $S（可用: idle writing receiving replying researching executing syncing error）" >&2; exit 1 ;;
esac
python3 -c "
import json, sys, time, os
from datetime import datetime, timezone
target=sys.argv[3]+'.tmp.'+str(os.getpid())
json.dump({'state': sys.argv[1], 'detail': sys.argv[2], 'progress': 0, 'updated_at': datetime.now(timezone.utc).isoformat()},
          open(target, 'w'), ensure_ascii=False)
os.replace(target,sys.argv[3])
" "$S" "$D" "$F"
echo "✓ town state = $S ${D:+（$D）}"
