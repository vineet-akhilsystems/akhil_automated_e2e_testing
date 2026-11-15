// Which product a generic module discovery run belongs to: MODULE_PRODUCT, else PORTAL_PRODUCT_ID (set by the portal queue), else an error.
export function discoveryProduct(env) {
  const product = env.MODULE_PRODUCT || env.PORTAL_PRODUCT_ID || '';
  if (!product) throw new Error('MODULE_PRODUCT is not set (and PORTAL_PRODUCT_ID is empty). Example: MODULE_PRODUCT=augastam');
  return product;
}
