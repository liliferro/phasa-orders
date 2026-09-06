import { currentPrice } from "./domain.js";
const positive = (v) =>
  v !== null &&
  v !== undefined &&
  String(v).trim() !== "" &&
  Number.isFinite(Number(v)) &&
  Number(v) > 0;
export function availableProduct(product, order, catalogs) {
  if (
    !product?.activo ||
    !product.codigo?.trim() ||
    !product.descripcion_compra?.trim() ||
    !order.proveedor_id ||
    !order.cliente_id ||
    !order.empresa_usa_id ||
    !order.fecha
  )
    return null;
  const unit = catalogs.unidades.find(
    (u) => u.id === product.unidad_compra_id && u.activa && u.codigo?.trim(),
  );
  if (
    !unit ||
    product.unidad_compra_id !== product.unidad_venta_id ||
    !positive(product.peso_unitario_kg)
  )
    return null;
  const buy = currentPrice(
    catalogs.precios_compra,
    {
      proveedor_id: order.proveedor_id,
      producto_id: product.id,
      unidad_id: unit.id,
      moneda: order.moneda_compra,
    },
    order.fecha,
  );
  const sell = currentPrice(
    catalogs.precios_venta,
    {
      vendedor_id: order.empresa_usa_id,
      cliente_id: order.cliente_id,
      producto_id: product.id,
      unidad_id: unit.id,
      moneda: order.moneda_venta,
    },
    order.fecha,
  );
  return positive(buy?.precio) && positive(sell?.precio)
    ? { buy, sell, unit }
    : null;
}
