#!/usr/bin/env bash
# 天气旁路：拉 open-meteo 实时天气，缓存 15 分钟，供小镇首页"现实同步"（下雪页内飘雪）。
# 坑：某些 VPN（fake-IP 劫持）会吞掉 open-meteo 域名。解法：源绑定物理网卡 IP 再发一次。
# 坐标 / 网卡可用环境变量覆盖：TOWN_LAT / TOWN_LON / TZ_NAME / NET_IFACE。
TOWN="${TOWN_DIR:-$HOME/ai-office-town}"
mkdir -p "$TOWN"
CACHE="$TOWN/weather.json"
AGE_FILE="$TOWN/.weather_ts"
LAT="${TOWN_LAT:-39.9042}"   # 默认北京
LON="${TOWN_LON:-116.4074}"
TZ_NAME="${TZ_NAME:-Asia/Shanghai}"
IFACE="${NET_IFACE:-en0}"
URL="https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&timezone=${TZ_NAME// //}"
NOW=$(date +%s)
AGE=0; [ -f "$AGE_FILE" ] && AGE=$(( NOW - $(cat "$AGE_FILE") ))
if [ ! -f "$CACHE" ] || [ "$AGE" -ge 900 ]; then
  IFACE_IP=$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)
  DATA=""
  if [ -n "$IFACE_IP" ]; then
    DATA=$(curl -s -m 10 --interface "$IFACE_IP" "$URL" 2>/dev/null)
  fi
  [ -z "$DATA" ] && DATA=$(curl -s -m 10 "$URL" 2>/dev/null)
  if [ -n "$DATA" ] && echo "$DATA" | python3 -c "import json,sys;d=json.load(sys.stdin);assert 'current' in d" 2>/dev/null; then
    echo "$DATA" > "$CACHE"; echo "$NOW" > "$AGE_FILE"
  fi
fi
[ -f "$CACHE" ] && cat "$CACHE"
