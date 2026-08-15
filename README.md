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
| **Two promo pages** (`/` overstocks, `/quarterly`) | Identical scrape + Shopify-sync UI, one per promotion. Each has its own 24h cache. |
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

**Sync a specific list** instead of scraping fresh — POST the scraped payload
(the `SKU,Price,Compare At Price` shape) directly:

```bash
curl -X POST "https://<your-app>.vercel.app/api/shopify?apply=1&token=<CRON_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"products":[{"sku":"04358","price":"114.00","compareAtPrice":"228.00"}]}'
```

Each item maps to a Shopify variant found by exact SKU. A **markup** (default
**2.4×**, via `PRICE_MARKUP`) is applied to BOTH values before writing:
`price × 2.4` → the variant price, `compareAtPrice × 2.4` → the compare-at
(strike-through "was") price. Items with **no scraped price are left off** and
listed separately as skipped. The response summarizes `updated`, `unchanged`,
`noMatch`, `failed`, `noPrice`, a per-SKU `changes[]` list (each with
before→after `from`/`to`), and a `skippedNoPrice[]` list.

## Pagination

Overstocks is a single infinite-scroll page. **Quarterly is paginated** (`?page=N`),
so its scrape iterates pages, accumulating unique SKUs until a page returns nothing
new (or the time budget is hit). Config lives in `lib/sources.js` (`paginate`,
`maxPages`); override the page cap per source with e.g. `QUARTERLY_MAX_PAGES=30`.

The `/api/scrape?source=quarterly` response includes `pagesCovered`, `complete`,
`nextPage`, and a `logs` array with per-page counts (`Page 2: 24 products, 24
new …`) so you can confirm pagination is working.

**Resumable across runs:** if a run hits the ~50s time budget before finishing
all pages, it saves progress to the cache as `complete: false` with a `nextPage`.
The next run (the "Continue from page N" button, or the weekly cron) resumes from
that page and merges with what's already cached, until it reaches the end and
flips to `complete: true`. So a large paginated promo fills in over a few runs
rather than needing one long scrape. To finish in a single pass instead, set
`BROWSER_WS_ENDPOINT` (faster hosted browser) or raise `SCRAPE_BUDGET_MS` on a
plan that allows longer functions.

## 24-hour scrape cache

To avoid logging into uttermost.com more than necessary (and risking a block),
the scraped result is cached in Vercel Blob for **24 hours**. `/api/scrape`,
`/api/csv`, and `/api/shopify` all serve from this cache; the weekly cron
refreshes it. Controls:

- **Force a fresh scrape:** `/api/scrape?fresh=1`, or the **Scrape fresh** button.
- **Clear the cache** (e.g. after a code change): the **Clear cache** button, or
  `curl -X POST "https://<your-app>.vercel.app/api/cache?token=<CRON_SECRET>"`.
- **Cache status:** `GET /api/cache`.

Requires a Blob store; without one, every call scrapes fresh (no caching).

### Test mode (sync just the first row)

Before running the full list, use **test mode** to sync only the first priced
SKU — a safe end-to-end check of the Shopify connection and the 2.4× markup.

- **In the app:** scrape on the home page, then use the **🧪 Test mode** panel —
  *Dry-run first row* or *Apply first row*. (Enter `CRON_SECRET` once in the
  field near the top; it's remembered in your browser.)
- **Full run:** the **🚀 Full run** panel syncs all priced rows — *Dry-run all*,
  then *Apply all*.
- **Via API:** add `?test=1` (optionally `&apply=1`):

  ```bash
  curl -X POST "https://<your-app>.vercel.app/api/shopify?test=1&token=<CRON_SECRET>"
  ```

### The 7-day sync log

Every sync (dry-run or apply) is recorded to **Vercel Blob** and kept for
**7 days** (older entries are pruned automatically). View them in the app at
**`/logs`** — each run shows what was updated, skipped (no SKU match), left
unchanged, or failed, with before/after prices. This uses the same Blob store
as the cron snapshots; if no Blob store is connected, syncs still run but aren't
logged, and `/logs` shows a setup hint.

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
