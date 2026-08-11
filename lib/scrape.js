// Core scraper: launches a headless Chromium, logs into uttermost.com, loads the
// overstocks page, makes sure every product is rendered, then extracts SKU +
// prices using the exact DOM logic that was validated in the browser console.
//
// Works in three environments:
//   1. Vercel serverless   -> @sparticuz/chromium (bundled, no external service)
//   2. A hosted browser    -> BROWSER_WS_ENDPOINT (browserless.io etc.)
//   3. Local `npm run dev` -> the full `puppeteer` devDependency's Chromium

import puppeteer from 'puppeteer-core';

const isVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/**
 * Resolve a launched/connected browser instance for the current environment.
 */
async function getBrowser() {
  const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;
  if (wsEndpoint) {
    return puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  }

  if (isVercel) {
    // Bundled Chromium for AWS Lambda / Vercel.
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({
      args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }

  // Local development: reuse the Chromium that ships with the `puppeteer`
  // devDependency. `puppeteer` is optional at runtime, so import lazily.
  const localPuppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: true,
    executablePath: localPuppeteer.executablePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

/**
 * The extraction logic, ported verbatim from the validated console script.
 * Returns an array of { sku, price, compareAtPrice } — the only change from the
 * original is that it RETURNS the data instead of showing a window.prompt().
 * Runs inside the page context, so it must be self-contained (no closures).
 */
function extractProductsInPage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const productRoots = document.querySelectorAll('.item-root-Chs');
  const productData = [];

  productRoots.forEach((root) => {
    const skuEl = root.querySelector('.item-skuAndDimensionsHolder-TkQ .font-semibold');
    const sku = skuEl ? clean(skuEl.textContent) : '';

    const priceContainer = root.querySelector(
      '.item-actionsContainer-KOk .flex.items-center.gap-4'
    );

    let compareAtPrice = '';
    let currentPrice = '';

    if (priceContainer) {
      const priceSpans = priceContainer.querySelectorAll('span > span');
      const compareAtPriceEl = priceContainer.querySelector('.line-through');

      if (compareAtPriceEl) {
        compareAtPrice = clean(
          compareAtPriceEl.textContent
            .replace('$', '')
            .replace(/,/g, '')
            .replace(/(\.\d{2}).*/, '$1')
        );
        if (priceSpans.length >= 2) {
          const currentPriceText = priceContainer.lastElementChild.textContent;
          currentPrice = clean(
            currentPriceText
              .replace('$', '')
              .replace(/,/g, '')
              .replace(/(\.\d{2}).*/, '$1')
          );
        }
      } else {
        const onlyPriceEl = priceContainer.querySelector('span:not(.line-through)');
        if (onlyPriceEl) {
          currentPrice = clean(
            onlyPriceEl.textContent
              .replace('$', '')
              .replace(/,/g, '')
              .replace(/(\.\d{2}).*/, '$1')
          );
        }
      }
    }

    if (sku) {
      productData.push({ sku, price: currentPrice, compareAtPrice });
    }
  });

  return productData;
}

/**
 * Diagnostics dump (runs in page context). Reveals login state and the REAL
 * price-area DOM so selectors can be fixed without direct site access. Kept as
 * plain text (no screenshot) so the response stays small and pasteable.
 */
function collectDiagnosticsInPage() {
  const out = {};
  try {
    out.url = location.href;
    out.title = document.title;
    // Magento/Venia stores the customer token in localStorage once signed in.
    let keys = [];
    try {
      keys = Object.keys(window.localStorage);
    } catch (e) {
      out.localStorageError = String(e);
    }
    out.localStorageKeys = keys;
    out.hasSigninToken = keys.some((k) => /signin[_-]?token/i.test(k));
    const bodyText = (document.body && document.body.innerText) || '';
    out.pageMentionsSignIn = /sign\s*in|log\s*in/i.test(bodyText);
    out.pageMentionsPriceGate = /sign in to (see|view)|log in to (see|view)|trade price/i.test(
      bodyText
    );

    const root = document.querySelector('.item-root-Chs');
    out.productRootFound = !!root;
    if (root) {
      // Trimmed outerHTML of one product card — this is what I read to fix selectors.
      out.firstProductHtml = root.outerHTML.slice(0, 6000);
      const actions = root.querySelector('.item-actionsContainer-KOk');
      out.actionsContainerFound = !!actions;
      out.actionsContainerHtml = actions ? actions.outerHTML.slice(0, 3000) : null;
      out.priceInnerFound = !!root.querySelector(
        '.item-actionsContainer-KOk .flex.items-center.gap-4'
      );
    }
  } catch (e) {
    out.error = String(e);
  }
  return out;
}

/**
 * Scroll to the bottom repeatedly so lazy-loaded / virtualized products render,
 * and click a "load more" button if one is configured, until the product count
 * stops growing.
 */
async function loadAllProducts(page, { loadMoreSelector, log }) {
  const countProducts = () =>
    page.evaluate(() => document.querySelectorAll('.item-root-Chs').length);

  let previous = -1;
  let stableRounds = 0;
  const maxRounds = 30;

  for (let round = 0; round < maxRounds; round++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(900);

    if (loadMoreSelector) {
      const clicked = await page
        .evaluate((sel) => {
          const btn = document.querySelector(sel);
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        }, loadMoreSelector)
        .catch(() => false);
      if (clicked) await sleep(1000);
    }

    const current = await countProducts();
    log(`  loaded ${current} products (round ${round + 1})`);

    if (current === previous) {
      stableRounds += 1;
      // Two consecutive stable rounds => we've reached the end.
      if (stableRounds >= 2) break;
    } else {
      stableRounds = 0;
    }
    previous = current;
  }

  return countProducts();
}

/**
 * Log into uttermost.com. Selectors are overridable via env for resilience
 * against markup changes. Returns nothing; throws if the email field never
 * appears (surfaced to the caller as a clear error).
 */
async function login(page, { log, debug }) {
  const email = process.env.UTTERMOST_EMAIL;
  const password = process.env.UTTERMOST_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing UTTERMOST_EMAIL / UTTERMOST_PASSWORD env vars.');
  }

  const loginUrl = process.env.UTTERMOST_LOGIN_URL || 'https://uttermost.com/sign-in';
  const emailSelector =
    process.env.UTTERMOST_EMAIL_SELECTOR ||
    'input[name="email"], input[type="email"], input[name="username"], #email';
  const passwordSelector =
    process.env.UTTERMOST_PASSWORD_SELECTOR ||
    'input[name="password"], input[type="password"], #password';
  const submitSelector =
    process.env.UTTERMOST_SUBMIT_SELECTOR || 'button[type="submit"]';
  const triggerSelector = process.env.UTTERMOST_SIGNIN_TRIGGER_SELECTOR || '';

  log(`Navigating to login: ${loginUrl}`);
  // Use domcontentloaded, NOT networkidle2 — this SPA polls continuously and
  // never goes idle, which would burn the full timeout on every navigation.
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Some Venia storefronts hide the form behind an account/sign-in trigger.
  if (triggerSelector) {
    const trigger = await page.$(triggerSelector);
    if (trigger) {
      log('Clicking sign-in trigger to reveal the form.');
      await trigger.click();
      await sleep(1200);
    }
  }

  log('Waiting for the email field.');
  await page.waitForSelector(emailSelector, { timeout: 15000 });

  await page.type(emailSelector, email, { delay: 15 });
  await page.type(passwordSelector, password, { delay: 15 });

  log('Submitting credentials.');
  await page.click(submitSelector).catch(() => page.keyboard.press('Enter'));

  // Resolve as soon as an auth token lands (Venia logs in via XHR, no
  // navigation) OR a navigation completes — whichever first, capped short.
  await Promise.race([
    page
      .waitForFunction(
        () => {
          try {
            return Object.keys(localStorage).some((k) => /signin[_-]?token/i.test(k));
          } catch {
            return false;
          }
        },
        { timeout: 12000, polling: 500 }
      )
      .catch(() => null),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
  ]);

  await sleep(1500);
  log('Login step complete.');

  if (debug) {
    await captureDebug(page, 'after-login');
  }
}

/**
 * Main entry point. Returns { products, count, scrapedAt, debug? }.
 */
export async function scrapeOverstocks({ debug = false, screenshot = false } = {}) {
  const logs = [];
  const log = (msg) => {
    logs.push(msg);
    // eslint-disable-next-line no-console
    console.log('[scrape]', msg);
  };

  const overstocksUrl =
    process.env.UTTERMOST_OVERSTOCKS_URL ||
    'https://uttermost.com/promotions/overstocks';
  const loadMoreSelector = process.env.UTTERMOST_LOAD_MORE_SELECTOR || '';

  let browser;
  try {
    log('Launching browser.');
    browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1440, height: 1000 });

    await login(page, { log, debug });

    log(`Navigating to overstocks: ${overstocksUrl}`);
    await page.goto(overstocksUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for the product grid to appear (prices are gated behind login).
    await page
      .waitForSelector('.item-root-Chs', { timeout: 20000 })
      .catch(() => log('WARNING: product root .item-root-Chs not found yet.'));

    const total = await loadAllProducts(page, { loadMoreSelector, log });
    log(`Finished loading. ${total} product roots present.`);

    // Prices are gated behind login and hydrate a beat AFTER the card (and its
    // SKU) render, via an authenticated GraphQL call. Wait until a "$" price
    // actually appears before extracting, so we don't read empty cards.
    const priceReady = await page
      .waitForFunction(
        () => {
          const el = document.querySelector('.item-actionsContainer-KOk');
          return !!el && /\$\s*\d/.test(el.textContent || '');
        },
        { timeout: 12000, polling: 500 }
      )
      .then(() => true)
      .catch(() => false);
    log(
      priceReady
        ? 'Prices detected in the DOM.'
        : 'No "$" prices detected after 20s — likely NOT logged in, or the price selector changed. See diagnostics.'
    );

    const products = await page.evaluate(extractProductsInPage);
    const withPrice = products.filter((p) => p.price).length;
    log(`Extracted ${products.length} products (${withPrice} with a price).`);

    // Surface diagnostics automatically when prices are missing (so you see the
    // real DOM without asking), or whenever debug is requested.
    const includeDiagnostics = debug || withPrice === 0;
    const diagnostics = includeDiagnostics
      ? await page.evaluate(collectDiagnosticsInPage)
      : undefined;

    let debugShot;
    if (debug || screenshot) {
      debugShot = await captureDebug(page, 'overstocks');
    }

    return {
      products,
      count: products.length,
      withPrice,
      priceReady,
      scrapedAt: new Date().toISOString(),
      logs,
      ...(diagnostics ? { diagnostics } : {}),
      ...(debugShot ? { debugScreenshot: debugShot } : {}),
    };
  } finally {
    if (browser) {
      // connect() -> disconnect(); launch() -> close().
      if (process.env.BROWSER_WS_ENDPOINT) await browser.disconnect().catch(() => {});
      else await browser.close().catch(() => {});
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

// A page-context sleep so the injected page scripts above can call sleep().
// Defined here and pushed into every page via addInitScript equivalent.
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureDebug(page, label) {
  try {
    const buffer = await page.screenshot({ fullPage: false, type: 'png' });
    return { label, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch {
    return undefined;
  }
}
