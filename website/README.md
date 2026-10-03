# nadavfriedman.com

Static website for Nadav Friedman, built to replace the Squarespace site. No framework, no
monthly fee: plain HTML, CSS and a little JavaScript.

## Layout

```
website/
  build.py          # assembles src/ into public/
  src/layout.html   # shared header, WhatsApp band, footer
  src/pages/*.html  # page content (first line = title/description/nav)
  public/           # the deployable site (this folder goes online)
    assets/js/concerts.js   # concert dates: edit here, no rebuild needed
    assets/js/site.js       # concerts list, video/Spotify players, contact form
    assets/css/site.css
    assets/photos/          # photos from the old site, resized
    _redirects              # /whatsapp short link + old Squarespace URLs
```

## Everyday updates

- **Add a concert:** add an entry to `public/assets/js/concerts.js`. Shows move from
  "Upcoming" to "Recent" on their own once the date passes.
- **Change page text:** edit `src/pages/<page>.html`, then run `python3 build.py`.

## Going live (Cloudflare Pages, free)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → connect this GitHub repo.
2. Build command: `python3 website/build.py` · Output directory: `website/public`.
3. Custom domains → add `nadavfriedman.com` and `www.nadavfriedman.com`, and follow the
   DNS steps. If the domain is registered at Squarespace, either point its DNS at
   Cloudflare or transfer the domain. Keep any email records (MX) as they are.
4. Cancel the Squarespace site plan only after the new site is live on the domain.

## Contact form

Until a form service is connected, the form opens the visitor's email app. To receive
messages directly, create a free form at formspree.io and put its
endpoint URL in `FORM_ENDPOINT` at the top of `public/assets/js/site.js`.
