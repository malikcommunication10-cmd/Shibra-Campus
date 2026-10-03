# Speed update

1. Upload ALL files of this folder to the GitHub repo (replace the old ones). `tailwind.css` is new and REQUIRED.
2. Tailwind no longer compiles in the browser. If you ever add a NEW Tailwind class to a page,
   rebuild the stylesheet once:  `npm install` then `npm run build:css`  (or ask Claude to rebuild tailwind.css).
3. Data cache: see SB_CACHE_TTL at the top of the cache block in config.js (default 90 seconds).
   Saving anything clears the cache automatically; the Refresh buttons and F5 always load fresh data.
