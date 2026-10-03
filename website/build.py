#!/usr/bin/env python3
"""Builds the static site: src/pages/*.html + src/layout.html -> public/*.html.

Each page starts with a one-line JSON comment holding its title, description,
nav key and canonical path. Run `python3 build.py` after editing anything in
src/. Concert dates live in public/assets/js/concerts.js and need no rebuild.
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).parent
NAV = [("concerts", "concerts.html", "concerts"), ("projects", "projects.html", "projects"),
       ("about", "about.html", "about"), ("media", "media.html", "watch & listen"),
       ("teaching", "teaching.html", "teaching"), ("contact", "contact.html", "contact")]

def nav_html(active):
    current = ' aria-current="page"'
    return "".join(
        f'<a href="{href}"{current if key == active else ""}>{label}</a>'
        for key, href, label in NAV)

def build():
    layout = (ROOT / "src/layout.html").read_text(encoding="utf-8")
    out = ROOT / "public"
    for page in sorted((ROOT / "src/pages").glob("*.html")):
        raw = page.read_text(encoding="utf-8")
        m = re.match(r"<!--\s*(\{.*?\})\s*-->\n", raw)
        meta = json.loads(m.group(1))
        html = (layout.replace("{{title}}", meta["title"])
                      .replace("{{description}}", meta["description"])
                      .replace("{{path}}", meta["path"])
                      .replace("{{nav}}", nav_html(meta["nav"]))
                      .replace("{{body}}", raw[m.end():].rstrip()))
        (out / page.name).write_text(html, encoding="utf-8")
        print("built", page.name)

if __name__ == "__main__":
    build()
