#!/usr/bin/env bash
set -euo pipefail
cd /opt/zhihe-yunqi
case "${1:-}" in
  api) exec /opt/zhihe-yunqi-venv/bin/python server/app.py ;;
  agent) exec /usr/bin/node server/dev-server.mjs ;;
  courses) exec /usr/bin/node server/index.js ;;
  dream) exec /opt/zhihe-yunqi-venv/bin/python scripts/dream-monitor.py --port 8770 ;;
  *) echo 'Unknown service' >&2; exit 2 ;;
esac
