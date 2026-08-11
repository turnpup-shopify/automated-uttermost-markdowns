# Automated Uttermost Markdowns

A Vercel app that logs into **uttermost.com**, opens the
[overstocks page](https://uttermost.com/promotions/overstocks), and pulls the
latest markdown prices (SKU, price, compare-at price). Because the prices are
gated behind a trade login and rendered client-side, the app drives a real
headless Chromium — it reproduces the exact DOM-scraping logic that was
validated in the browser console.

It gives you the data three ways:

| Route | What it does |
|-------|--------------|
| **Web UI** (`/`) | "Scrape & preview" button + "Download CSV" button. |
| `GET /api/scrape` | JSON: `{ count, scrapedAt, products: [...] }`. Add `?debug=1` for logs + a screenshot. |
| `GET /api/csv` | Downloads `uttermost-overstocks-YYYY-MM-DD.csv` (`SKU,Price,Compare At Price`). |
| `GET /api/cron` | Scheduled weekly; archives a timestamped CSV + JSON snapshot to Vercel Blob. |
| `POST /api/shopify` | **Step 2:** pushes scraped prices into Shopify via GraphQL (dry-run by default). |

---

## 1. Deploy to Vercel

1. Push this repo to GitHub (already done on your branch).
2. In Vercel: **New Project → Import** this repo. Framework auto-detects as Next.js.
3. Add the environment variables below (**Project → Settings → Environment Variables**).
4. Deploy.

### Required env vars

| Variable | Purpose |
|----------|---------|
| `UTTERMOST_EMAIL` | Your uttermost.com trade-account email. |
| `UTTERMOST_PASSWORD` | Your uttermost.com password. |

Copy `.env.example` to `.env.local` for local development. **Never commit real
credentials** — `.env*` files are git-ignored.

### Optional env vars

See `.env.example` for the full annotated list. The most useful:

- `CRON_SECRET` — protects `/api/cron` and `/api/shopify`. Vercel Cron sends it
  automatically; for manual calls append `?token=<CRON_SECRET>`.
- `BROWSER_WS_ENDPOINT` — connect to a hosted browser (e.g. browserless.io)
  instead of the bundled Chromium. **Recommended** if you hit serverless time or
  size limits, or the catalog is large.
- `UTTERMOST_*_SELECTOR` — override the login form selectors without touching code.

---

## 2. Scheduled snapshots (Vercel Cron + Blob)

`vercel.json` registers a cron that hits `/api/cron` **every Monday at 09:00 UTC**.
Change the `schedule` (standard cron syntax) as needed. To archive each run:

1. In Vercel: **Storage → Create → Blob**, and connect it to this project.
   That injects `BLOB_READ_WRITE_TOKEN` automatically.
2. Each cron run writes `overstocks/<timestamp>.csv`, `.json`, and overwrites
   `overstocks/latest.csv` for easy consumption.

Without a Blob store the cron still runs and returns the data inline — it just
doesn't archive.

> Vercel Hobby allows one cron trigger per day; the weekly default is fine.
> For more frequent runs, upgrade the plan or trigger `/api/cron?token=...`
> yourself.

---

## 3. Tuning the login (if it fails)

The login selectors default to common Magento/Venia markup, but the site can
change. To diagnose:

```
https://<your-app>.vercel.app/api/scrape?debug=1
```

The JSON response includes step-by-step `logs` and a base64 `debugScreenshot`
of the page after the login attempt. If the email field wasn't found, set the
right selectors via env — no redeploy of code needed:

- `UTTERMOST_LOGIN_URL` — where the login form lives.
- `UTTERMOST_EMAIL_SELECTOR` / `UTTERMOST_PASSWORD_SELECTOR` / `UTTERMOST_SUBMIT_SELECTOR`.
- `UTTERMOST_SIGNIN_TRIGGER_SELECTOR` — a button that must be clicked to reveal
  the form first (common in Venia storefronts).
- `UTTERMOST_LOAD_MORE_SELECTOR` — if the list paginates behind a "load more"
  button instead of infinite scroll.

The product-grid selectors (`.item-root-Chs`, etc.) are the hashed CSS-module
classes from your validated script. If Uttermost redeploys their frontend these
hashes may change — update them in `lib/scrape.js` (`extractProductsInPage`).

---

## 4. Step 2 — push prices into Shopify (GraphQL)

`POST /api/shopify` scrapes fresh data (or accepts a `{ "products": [...] }`
body), matches each SKU to a Shopify variant, and updates its price via the
Admin GraphQL API.

Add these env vars when you're ready:

| Variable | Purpose |
|----------|---------|
| `SHOPIFY_STORE_DOMAIN` | e.g. `your-store.myshopify.com`. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Admin API token (`shpat_...`) with `write_products`. |
| `SHOPIFY_API_VERSION` | Defaults to `2025-01`. |
| `PRICE_MARKUP` | Multiplier applied to the scraped price. `1` = as-is. |
| `SHOPIFY_DRY_RUN` | `true` (default) reports changes without writing. |

**Dry run** (safe — writes nothing, shows exactly what would change):

```bash
curl -X POST "https://<your-app>.vercel.app/api/shopify?token=<CRON_SECRET>"
```

**Apply for real** (writes prices — set `SHOPIFY_DRY_RUN=false` or pass `?apply=1`):

```bash
curl -X POST "https://<your-app>.vercel.app/api/shopify?apply=1&token=<CRON_SECRET>"
```

The response summarizes `updated`, `skippedNoMatch`, `unchanged`, `failed`, and
a per-SKU `changes[]` list.

> The scraped price is Uttermost's **trade** price. Set `PRICE_MARKUP` to your
> retail multiplier, or edit `mapPrices()` in `lib/shopify.js` for a more
> nuanced formula (e.g. keep compare-at from the scrape, mark up only the sale
> price, round to `.99`, etc.).

---

## Local development

```bash
cp .env.example .env.local   # fill in UTTERMOST_EMAIL / UTTERMOST_PASSWORD
npm install
npm run dev                  # http://localhost:3000
```

Locally the app uses the full `puppeteer` dev dependency's Chromium; on Vercel
it uses the bundled `@sparticuz/chromium`.

## How it works

```
lib/scrape.js   launch/connect browser → login → load-all → extract (your DOM logic)
lib/csv.js      array → CSV (matches your original header/quoting)
lib/shopify.js  scraped prices → match SKU → GraphQL variant price update
lib/auth.js     CRON_SECRET guard for write/cron endpoints
app/api/*       thin route handlers over the libs
app/page.jsx    minimal UI (preview table + download)
```

## Notes & limits

- **Function duration:** login + scroll of a large catalog can take 20–60s. The
  routes request up to 60s (`maxDuration`). If you time out, use
  `BROWSER_WS_ENDPOINT` (hosted browser) or upgrade the Vercel plan.
- **Selector fragility:** Magento PWA CSS-module hashes can change on a
  frontend redeploy. All login selectors are env-overridable; the grid
  selectors live in one function in `lib/scrape.js`.
- **Terms:** make sure automated access to your own trade account is within
  Uttermost's terms of use.
