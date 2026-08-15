// Shopify price updater (step 2).
//
// Takes the scraped Uttermost products ({ sku, price, compareAtPrice }), finds
// the matching Shopify variant by SKU, and updates its price via the Admin
// GraphQL API. Runs as a DRY RUN by default (SHOPIFY_DRY_RUN=true) so you can
// review every change before anything is written.
//
// Price mapping (adjust in mapPrices() to fit your business rules):
//   Shopify price          = scraped Uttermost price * PRICE_MARKUP
//   Shopify compareAtPrice = scraped compareAtPrice  * PRICE_MARKUP (if present)
//
// NOTE: The scraped price is Uttermost's (trade) price. Set PRICE_MARKUP to your
// retail multiplier, or edit mapPrices() for a more nuanced formula.

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

function shopifyEndpoint() {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error('Missing SHOPIFY_STORE_DOMAIN env var.');
  return `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
}

async function shopifyGraphQL(query, variables) {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (!token) throw new Error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN env var.');

  const res = await fetch(shopifyEndpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 * Turn a scraped price string ("199.00") into a Shopify money string, applying
 * the markup. Shopify price      = scraped price      * PRICE_MARKUP,
 *          Shopify compareAtPrice = scraped compareAt  * PRICE_MARKUP.
 * Default markup is 2.4x. Null/empty/zero inputs return null (left off).
 */
function mapPrices({ price, compareAtPrice }) {
  const markup = Number(process.env.PRICE_MARKUP || '2.4') || 2.4;
  const toMoney = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return null;
    return (n * markup).toFixed(2);
  };
  return { price: toMoney(price), compareAtPrice: toMoney(compareAtPrice), markup };
}

/** Look up a variant (id + product id) by exact SKU. Returns null if not found. */
async function findVariantBySku(sku) {
  const data = await shopifyGraphQL(
    `query FindVariant($q: String!) {
       productVariants(first: 1, query: $q) {
         edges { node { id sku price compareAtPrice product { id title } } }
       }
     }`,
    { q: `sku:${JSON.stringify(sku)}` }
  );
  return data?.productVariants?.edges?.[0]?.node || null;
}

/** Update a single variant's price via productVariantsBulkUpdate. */
async function updateVariantPrice(productId, variantId, price, compareAtPrice) {
  const variant = { id: variantId, price };
  if (compareAtPrice) variant.compareAtPrice = compareAtPrice;

  const data = await shopifyGraphQL(
    `mutation Update($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
       productVariantsBulkUpdate(productId: $productId, variants: $variants) {
         productVariants { id price compareAtPrice }
         userErrors { field message }
       }
     }`,
    { productId, variants: [variant] }
  );

  const errors = data?.productVariantsBulkUpdate?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }
  return data.productVariantsBulkUpdate.productVariants[0];
}

/**
 * Sync scraped prices into Shopify. Applies the markup (default 2.4x) to both
 * price and compare-at price. Items with no scraped price are LEFT OFF (skipped)
 * and collected in `skippedNoPrice` so the UI can list them separately.
 *
 * @param {Array<{sku,price,compareAtPrice}>} products
 * @param {{ dryRun?: boolean }} [opts]
 * @returns summary {
 *   dryRun, markup,
 *   updated, unchanged, noMatch, failed, noPrice,     // counts
 *   changes[],            // priced items (updated/would-update/unchanged/no-match/failed)
 *   skippedNoPrice[],     // { sku } for items with no scraped price
 * }
 */
export async function syncPricesToShopify(products, opts = {}) {
  const dryRun =
    opts.dryRun ?? (process.env.SHOPIFY_DRY_RUN ?? 'true') !== 'false';
  const markup = Number(process.env.PRICE_MARKUP || '2.4') || 2.4;

  const changes = [];
  const skippedNoPrice = [];
  const summary = {
    dryRun,
    markup,
    updated: 0,
    unchanged: 0,
    noMatch: 0,
    failed: 0,
    noPrice: 0,
  };

  for (const p of products) {
    if (!p.sku) continue;
    const { price, compareAtPrice } = mapPrices(p);

    // No scraped price -> leave it off entirely (noted separately, not uploaded).
    if (!price) {
      summary.noPrice += 1;
      skippedNoPrice.push({ sku: p.sku });
      continue;
    }

    let variant;
    try {
      variant = await findVariantBySku(p.sku);
    } catch (err) {
      summary.failed += 1;
      changes.push({
        sku: p.sku,
        status: 'lookup-failed',
        error: err.message,
        to: { price, compareAtPrice },
      });
      continue;
    }

    if (!variant) {
      summary.noMatch += 1;
      changes.push({
        sku: p.sku,
        status: 'no-shopify-match',
        to: { price, compareAtPrice },
      });
      continue;
    }

    const change = {
      sku: p.sku,
      product: variant.product?.title,
      from: { price: variant.price, compareAtPrice: variant.compareAtPrice },
      to: { price, compareAtPrice },
    };

    const same =
      variant.price === price &&
      (!compareAtPrice || variant.compareAtPrice === compareAtPrice);
    if (same) {
      change.status = 'unchanged';
      summary.unchanged += 1;
      changes.push(change);
      continue;
    }

    if (dryRun) {
      change.status = 'would-update';
      summary.updated += 1;
      changes.push(change);
      continue;
    }

    try {
      await updateVariantPrice(variant.product.id, variant.id, price, compareAtPrice);
      change.status = 'updated';
      summary.updated += 1;
    } catch (err) {
      change.status = 'update-failed';
      change.error = err.message;
      summary.failed += 1;
    }
    changes.push(change);
  }

  return { ...summary, changes, skippedNoPrice };
}
