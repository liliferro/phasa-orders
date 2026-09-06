// Missing prices are fields to complete, not reasons to hide products.
export function availableProduct(product) {
  return Boolean(product?.activo && product.codigo?.trim());
}
