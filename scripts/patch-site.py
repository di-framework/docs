#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

site = Path(sys.argv[1])
version = sys.argv[2]
endpoint = sys.argv[3].rstrip("/")

config = site / "config.json"
cfg = json.loads(config.read_text())
cfg["productId"] = "d"
cfg["searchService"] = "custom"
cfg["searchServiceUrl"] = f"{endpoint}/preview-search/Writerside/d/{version}"
config.write_text(json.dumps(cfg, separators=(",", ":")))

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
    path.write_text(html)
