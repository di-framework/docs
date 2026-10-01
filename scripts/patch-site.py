#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]
GITHUB_HEADER_JS = REPOSITORY / "Writerside/cfg/static/github-header.js"
GITHUB_SCRIPT_TAG = '<script src="github-header.js" defer></script>'

site = Path(sys.argv[1])
version = sys.argv[2]
endpoint = sys.argv[3].rstrip("/")

config = site / "config.json"
cfg = json.loads(config.read_text())
cfg["productId"] = "d"
cfg["productVersion"] = version
cfg["searchService"] = "custom"
cfg["searchServiceUrl"] = f"{endpoint}/preview-search/Writerside/d/{version}"
config.write_text(json.dumps(cfg, separators=(",", ":")))

if not GITHUB_HEADER_JS.is_file():
    raise SystemExit(f"missing GitHub header script: {GITHUB_HEADER_JS}")
(site / "github-header.js").write_text(GITHUB_HEADER_JS.read_text())

icon_link = re.compile(r'<link\b[^>]*\brel=(["\'])[^"\']*icon[^"\']*\1[^>]*>', re.I)
favicon = '\n'.join((
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon.png">',
    '<link rel="apple-touch-icon" href="/favicon.png">',
))
for path in site.rglob("*.html"):
    html = icon_link.sub("", path.read_text())
    if "</head>" in html:
        html = html.replace("</head>", f"  {favicon}\n</head>", 1)
    elif "<title>" in html:
        html = html.replace("<title>", f"{favicon}\n<title>", 1)
    if GITHUB_SCRIPT_TAG not in html:
        if "</body>" in html:
            html = html.replace("</body>", f"  {GITHUB_SCRIPT_TAG}\n</body>", 1)
        else:
            html = html + f"\n{GITHUB_SCRIPT_TAG}\n"
    path.write_text(html)
