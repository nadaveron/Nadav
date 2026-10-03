#!/usr/bin/env python3
"""Builds the classic-design site: src/pages/*.html + src/layout.html -> public/*.html.

Each page starts with a one-line JSON comment holding its title, description,
nav key and canonical path. Run `python3 build.py` after editing anything in
src/. Concert dates live in public/assets/js/concerts.js and need no rebuild.
"""
import json, re, pathlib

ROOT = pathlib.Path(__file__).parent
NAV = [("home", "index.html", "Home"), ("live", "live.html", "Live"),
       ("projects", "projects.html", "Projects"), ("about", "about.html", "About"),
       ("media", "media.html", "Media"), ("study", "study.html", "Study"),
       ("contact", "contact.html", "Contact")]

S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'
ICONS = [
    ("Instagram", "https://www.instagram.com/nadav.friedman/",
     f'<svg viewBox="0 0 24 24" {S}><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/></svg>'),
    ("Facebook", "https://www.facebook.com/nadav.friedman.5/",
     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21z"/></svg>'),
    ("YouTube", "https://www.youtube.com/@nadavfriedmanmusic",
     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z"/></svg>'),
    ("Spotify", "https://open.spotify.com/artist/2chajUYdkxp1uYYrN9xVXb",
     f'<svg viewBox="0 0 24 24" {S}><circle cx="12" cy="12" r="9.5"/><path d="M7 9.3c3.4-1 7.2-.7 10.2 1M7.6 12.6c2.8-.8 5.8-.5 8.3.9M8.2 15.7c2.2-.6 4.4-.4 6.4.7"/></svg>'),
    ("Apple Music", "https://music.apple.com/artist/nadav-friedman/1515865116",
     f'<svg viewBox="0 0 24 24" {S}><path d="M9 18V5.5l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/></svg>'),
    ("SoundCloud", "https://soundcloud.com/nadavfriedmanmusic",
     f'<svg viewBox="0 0 24 24" {S}><path d="M10 17V8.5a5 5 0 0 1 8.6 3.2A3 3 0 0 1 19.5 17zM7.5 17v-6M5 17v-4.5M2.5 17v-2.5"/></svg>'),
    ("Email", "mailto:nadaveron@gmail.com",
     f'<svg viewBox="0 0 24 24" {S}><rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/></svg>'),
]

def icons_html():
    external = ' target="_blank" rel="noopener"'
    return "".join(
        f'<a href="{href}" aria-label="{name}"{"" if href.startswith("mailto") else external}>{svg}</a>'
        for name, href, svg in ICONS)

def nav_html(active):
    current = ' aria-current="page"'
    return "".join(f'<a href="{href}"{current if key == active else ""}>{label}</a>' for key, href, label in NAV)

def build():
    layout = (ROOT / "src/layout.html").read_text(encoding="utf-8")
    for page in sorted((ROOT / "src/pages").glob("*.html")):
        raw = page.read_text(encoding="utf-8")
        m = re.match(r"<!--\s*(\{.*?\})\s*-->\n", raw)
        meta = json.loads(m.group(1))
        html = (layout.replace("{{title}}", meta["title"])
                      .replace("{{description}}", meta["description"])
                      .replace("{{path}}", meta["path"])
                      .replace("{{nav}}", nav_html(meta["nav"]))
                      .replace("{{icons}}", icons_html())
                      .replace("{{body}}", raw[m.end():].rstrip()))
        (ROOT / "public" / page.name).write_text(html, encoding="utf-8")
        print("built", page.name)

if __name__ == "__main__":
    build()
