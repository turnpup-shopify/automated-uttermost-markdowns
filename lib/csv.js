// CSV formatting — matches the header and quoting of the original console script.

/**
 * @param {Array<{sku:string, price:string, compareAtPrice:string}>} products
 * @returns {string} CSV text
 */
export function toCsv(products) {
  let csv = 'SKU,Price,Compare At Price\n';
  for (const item of products) {
    const sku = item.sku ?? '';
    const price = item.price ?? '';
    const compareAt = item.compareAtPrice ?? '';
    csv += `"${sku}","${price}","${compareAt}"\n`;
  }
  return csv.trim() + '\n';
}
