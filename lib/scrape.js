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
      const actions = root.querySelector('.item-actionsContainer-KOk');
      out.actionsContainerFound = !!actions;
      out.actionsContainerHtml = actions ? actions.outerHTML.slice(0, 3000) : null;
      out.priceInnerFound = !!root.querySelector(
        '.item-actionsContainer-KOk .flex.items-center.gap-4'
      );

      // Find the price by CONTENT, not by hashed class — resilient to redeploys.
      // Locate the deepest element whose text looks like a price and dump the
      // surrounding markup so the price selector can be fixed from one response.
      const priceEls = [...root.querySelectorAll('*')].filter((el) => {
        const t = el.textContent || '';
        return /\$\s*\d/.test(t) && el.children.length <= 3;
      });
      out.dollarElementCount = priceEls.length;
      if (priceEls.length) {
        const el = priceEls[0];
        const container = el.closest('[class*="actions"]') || el.parentElement || el;
        out.priceByContentHtml = (container.outerHTML || '').slice(0, 1500);
        out.priceElementClasses = el.className;
      } else {
        // No "$" anywhere in the card (logged-out state) — dump the card tail
        // where the price/actions normally live, so we can still inspect it.
        out.productTailHtml = root.outerHTML.slice(-2500);
      }
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
async function loadAllProducts(page, { loadMoreSelector, log, msLeft }) {
  const countProducts = () =>
    page.evaluate(() => document.querySelectorAll('.item-root-Chs').length);

  let previous = -1;
  let stableRounds = 0;
  const maxRounds = 30;

  for (let round = 0; round < maxRounds; round++) {
    // Leave enough budget for the price wait + extraction + diagnostics.
    if (msLeft && msLeft() < 16000) {
      log('  stopping scroll early to stay within time budget.');
      break;
    }
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
 * Log into uttermost.com. Anchors on the real login form (the one containing a
 * password field) so we never type into an unrelated newsletter email box.
 * Never throws — returns a diagnostics object so a failed login still yields a
 * useful response instead of a 500.
 */
async function login(page, { log }) {
  const email = process.env.UTTERMOST_EMAIL;
  const password = process.env.UTTERMOST_PASSWORD;
  const diag = { attempted: true };
  if (!email || !password) {
    diag.error = 'Missing UTTERMOST_EMAIL / UTTERMOST_PASSWORD env vars.';
    log(diag.error);
    return diag;
  }

  const loginUrl = process.env.UTTERMOST_LOGIN_URL || 'https://uttermost.com/sign-in';
  const triggerSelector = process.env.UTTERMOST_SIGNIN_TRIGGER_SELECTOR || '';

  log(`Navigating to login: ${loginUrl}`);
  // domcontentloaded, NOT networkidle2 — this SPA polls forever and never idles.
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  diag.resolvedUrl = page.url();

  if (triggerSelector) {
    const trigger = await page.$(triggerSelector);
    if (trigger) {
      log('Clicking sign-in trigger to reveal the form.');
      await trigger.click();
      await sleep(1200);
    }
  }

  // The /sign-in page has MULTIPLE forms — the hidden account-menu flyout
  // (accountMenu-formContainer-*) AND the real page form (signIn-form-*), plus a
  // HubSpot newsletter form. Scope to the real, VISIBLE sign-in form, tag its
  // email/password/submit, and only then type. This avoids driving the hidden
  // flyout form (which silently does nothing).
  log('Locating the visible sign-in form.');
  const tagged = await page
    .waitForFunction(
      (emailSelOverride) => {
        const isVisible = (el) =>
          !!el && el.offsetParent !== null && el.getClientRects().length > 0;

        // Prefer Venia's page sign-in form; fall back to any form whose password
        // field is actually visible (never the hidden flyout).
        let form = document.querySelector('form[class*="signIn-form"]');
        if (!form || !isVisible(form.querySelector('input[type="password"]'))) {
          form = [...document.querySelectorAll('form')].find((f) =>
            isVisible(f.querySelector('input[type="password"]'))
          );
        }
        if (!form) return false;

        const pw = form.querySelector('input[type="password"]');
        if (!isVisible(pw)) return false;

        let emailEl = emailSelOverride ? form.querySelector(emailSelOverride) : null;
        if (!emailEl) {
          emailEl =
            form.querySelector('input[type="email"], #email, input[name="email"]') ||
            [...form.querySelectorAll('input')].find((i) =>
              /email|user|login/i.test(`${i.name} ${i.id} ${i.autocomplete}`)
            ) ||
            [...form.querySelectorAll('input')].find(
              (i) => i.type === 'text' || !i.type
            );
        }
        const submit =
          form.querySelector('button[type="submit"], input[type="submit"]') ||
          [...form.querySelectorAll('button')].find((b) =>
            /sign\s*in|log\s*in|submit/i.test(b.textContent || '')
          ) ||
          form.querySelector('button');

        // Clear any stale tags, then mark the right elements.
        document
          .querySelectorAll('[data-scrape-email],[data-scrape-pw],[data-scrape-submit]')
          .forEach((el) => {
            el.removeAttribute('data-scrape-email');
            el.removeAttribute('data-scrape-pw');
            el.removeAttribute('data-scrape-submit');
          });
        if (emailEl) emailEl.setAttribute('data-scrape-email', '1');
        pw.setAttribute('data-scrape-pw', '1');
        if (submit) submit.setAttribute('data-scrape-submit', '1');
        return true;
      },
      { timeout: 15000, polling: 500 },
      process.env.UTTERMOST_EMAIL_SELECTOR || ''
    )
    .then(() => true)
    .catch(() => false);

  diag.passwordFieldFound = tagged;

  if (!tagged) {
    diag.formsOnPage = await page.evaluate(() =>
      [...document.querySelectorAll('form')].slice(0, 5).map((f) => ({
        classes: f.className,
        inputTypes: [...f.querySelectorAll('input')].map((i) => i.type || i.name),
      }))
    );
    diag.error = 'Could not find a visible sign-in form — see formsOnPage / resolvedUrl.';
    log(diag.error);
    return diag;
  }

  diag.form = await page.evaluate(() => {
    const e = document.querySelector('[data-scrape-email]');
    const s = document.querySelector('[data-scrape-submit]');
    const form = (document.querySelector('[data-scrape-pw]') || {}).closest
      ? document.querySelector('[data-scrape-pw]').closest('form')
      : null;
    return {
      formClasses: form ? form.className : null,
      emailField: e ? e.name || e.id : null,
      submitText: s ? (s.textContent || '').trim().slice(0, 40) : null,
    };
  });
  log(`Sign-in form found (${diag.form.formClasses || 'n/a'}). Filling credentials.`);

  await page.type('[data-scrape-email]', email, { delay: 15 });
  await page.type('[data-scrape-pw]', password, { delay: 15 });

  log(`Submitting credentials (button: "${diag.form.submitText || 'n/a'}").`);
  const clicked = await page
    .click('[data-scrape-submit]')
    .then(() => true)
    .catch(() => false);
  if (!clicked) await page.keyboard.press('Enter');

  // Resolve as soon as an auth token lands (Venia logs in via XHR) OR a
  // navigation completes — whichever first, capped short.
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

  // Did it work? And if not, what did the site say?
  const after = await page.evaluate(() => {
    let token = false;
    try {
      token = Object.keys(localStorage).some((k) => /signin[_-]?token/i.test(k));
    } catch {}
    const messages = [
      ...document.querySelectorAll(
        '[role="alert"], .messages, [class*="message"], [class*="error"], [class*="Error"]'
      ),
    ]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 200)
      .slice(0, 6);
    return { token, url: location.href, messages };
  });
  diag.loggedIn = after.token;
  diag.afterUrl = after.url;
  diag.pageMessages = after.messages;
  log(after.token ? 'Login SUCCESS (auth token present).' : 'Login FAILED (no auth token).');
  return diag;

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

  // Hard wall-clock budget so we ALWAYS return (with diagnostics) instead of
  // letting Vercel kill the function at its maxDuration and return a 504.
  const t0 = Date.now();
  const budgetMs = Number(process.env.SCRAPE_BUDGET_MS || '50000');
  const msLeft = () => budgetMs - (Date.now() - t0);

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

    // Block heavy resources we never read — images, media, fonts. This cuts
    // page-load time dramatically (the grid is image-heavy) and lowers memory.
    // Text/DOM (and thus SKU + price) is unaffected.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    const loginDiag = await login(page, { log });
    log(`Time budget after login: ${Math.round(msLeft() / 1000)}s left.`);

    log(`Navigating to overstocks: ${overstocksUrl}`);
    await page.goto(overstocksUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(8000, Math.min(30000, msLeft() - 15000)),
    });

    // Wait for the product grid to appear (prices are gated behind login).
    await page
      .waitForSelector('.item-root-Chs', {
        timeout: Math.max(4000, Math.min(20000, msLeft() - 12000)),
      })
      .catch(() => log('WARNING: product root .item-root-Chs not found yet.'));

    const total = await loadAllProducts(page, { loadMoreSelector, log, msLeft });
    log(`Finished loading. ${total} product roots present.`);

    // Prices are gated behind login and hydrate a beat AFTER the card (and its
    // SKU) render, via an authenticated GraphQL call. Wait until a "$" price
    // actually appears before extracting, so we don't read empty cards — but
    // never blow the remaining budget.
    const priceWait = Math.min(12000, msLeft() - 6000);
    const priceReady =
      priceWait > 1000
        ? await page
            .waitForFunction(
              () => {
                const el = document.querySelector('.item-actionsContainer-KOk');
                return !!el && /\$\s*\d/.test(el.textContent || '');
              },
              { timeout: priceWait, polling: 500 }
            )
            .then(() => true)
            .catch(() => false)
        : false;
    log(
      priceReady
        ? 'Prices detected in the DOM.'
        : 'No "$" prices detected — likely NOT logged in, or the price selector changed. See diagnostics.'
    );

    const products = await page.evaluate(extractProductsInPage);
    const withPrice = products.filter((p) => p.price).length;
    log(`Extracted ${products.length} products (${withPrice} with a price).`);

    // Surface diagnostics automatically when prices are missing (so you see the
    // real DOM without asking), or whenever debug is requested.
    const includeDiagnostics = debug || withPrice === 0;
    const diagnostics = includeDiagnostics
      ? { login: loginDiag, ...(await page.evaluate(collectDiagnosticsInPage)) }
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
