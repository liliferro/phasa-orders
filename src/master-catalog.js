import { currentPrice } from "./domain.js";
export const masterPriceColumns = [
  ["precio_aochen", "PRECIO AOCHEN", "master_price"],
  ["precio_huanteng", "HUANTENG", "master_price"],
  ["precio_heq", "PRECIO VTA A HEQ", "master_price"],
];
export function masterProduct(product, catalogs, date) {
  const company = (code) =>
    catalogs.empresas.find((e) => e.codigo_interno === code)?.id;
  const buy = (code) =>
    currentPrice(
      catalogs.precios_compra,
      {
        proveedor_id: company(code),
        producto_id: product.id,
        unidad_id: product.unidad_compra_id,
        moneda: "USD",
      },
      date,
    )?.precio ?? null;
  return {
    ...product,
    precio_aochen: buy("SUP-1"),
    precio_huanteng: buy("SUP-13"),
    precio_heq:
      currentPrice(
        catalogs.precios_venta,
        {
          vendedor_id: company("SUP-9"),
          cliente_id: company("CLI-1"),
          producto_id: product.id,
          unidad_id: product.unidad_venta_id,
          moneda: "USD",
        },
        date,
      )?.precio ?? null,
  };
}
