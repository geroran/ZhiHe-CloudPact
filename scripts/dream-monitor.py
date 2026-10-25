#!/usr/bin/env python3
"""启动本地真实 dream-monitor 网页后端（vendor/dream-monitor）。

统一把工作目录切到 vendor/dream-monitor，让 config.yaml、data/identity.json、
data/shared_details.db 等相对路径都落在该目录下（上游 .gitignore 已忽略 data/ 与 config.yaml）。

用法：
    python scripts/dream-monitor.py                 # 127.0.0.1:8770
    python scripts/dream-monitor.py --port 8771
"""

from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / "vendor" / "dream-monitor"

if not (ROOT / "gui_server.py").exists():
    raise SystemExit(f"未找到 dream-monitor 源码：{ROOT}")

os.chdir(ROOT)
sys.argv = [str(ROOT / "gui_server.py")] + sys.argv[1:]
if "--host" not in sys.argv:
    sys.argv += ["--host", "127.0.0.1"]
if "--no-open" not in sys.argv:
    sys.argv.append("--no-open")

runpy.run_path(str(ROOT / "gui_server.py"), run_name="__main__")
