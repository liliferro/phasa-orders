import test from "node:test";
import assert from "node:assert/strict";
import { availableProduct } from "../src/availability.js";
const product = {
  id: "p",
  codigo: "P",
  descripcion_compra: "Product",
  activo: true,
  unidad_compra_id: "u",
  unidad_venta_id: "u",
  peso_unitario_kg: 24,
};
const order = {
  proveedor_id: "supplier",
  cliente_id: "client",
  empresa_usa_id: "issuer",
  fecha: "2026-09-06",
  moneda_compra: "USD",
  moneda_venta: "USD",
};
const catalogs = {
  unidades: [{ id: "u", codigo: "ROLL", activa: true }],
  precios_compra: [
    {
      producto_id: "p",
      proveedor_id: "supplier",
      unidad_id: "u",
      moneda: "USD",
      precio: 16,
      vigente_desde: "2026-09-05",
      vigente_hasta: null,
    },
  ],
  precios_venta: [
    {
      producto_id: "p",
      vendedor_id: "issuer",
      cliente_id: "client",
      unidad_id: "u",
      moneda: "USD",
      precio: 20,
      vigente_desde: "2026-09-05",
      vigente_hasta: null,
    },
  ],
};
test("offers only complete products priced for selected supplier and client", () => {
  assert.ok(availableProduct(product, order, catalogs));
  for (const override of [
    { proveedor_id: "other" },
    { cliente_id: "other" },
    { cliente_id: "" },
    { fecha: "2026-09-04" },
    { moneda_compra: "MXN" },
  ])
    assert.equal(
      availableProduct(product, { ...order, ...override }, catalogs),
      null,
    );
});
test("excludes missing/zero prices, missing weights, inactive or incompatible units", () => {
  for (const value of [null, "", 0, -1]) {
    const c = structuredClone(catalogs);
    c.precios_compra[0].precio = value;
    assert.equal(availableProduct(product, order, c), null);
    c.precios_compra[0].precio = 16;
    c.precios_venta[0].precio = value;
    assert.equal(availableProduct(product, order, c), null);
  }
  for (const override of [
    { peso_unitario_kg: null },
    { peso_unitario_kg: 0 },
    { unidad_compra_id: null },
    { unidad_venta_id: "other" },
    { activo: false },
    { descripcion_compra: "" },
  ])
    assert.equal(
      availableProduct({ ...product, ...override }, order, catalogs),
      null,
    );
});
test("expired prices do not make a product available", () => {
  const c = structuredClone(catalogs);
  c.precios_compra[0].vigente_hasta = order.fecha;
  assert.equal(availableProduct(product, order, c), null);
});
