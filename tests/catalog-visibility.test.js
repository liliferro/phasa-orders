import test from "node:test";
import assert from "node:assert/strict";
import { availableProduct } from "../src/availability.js";
import { masterProduct } from "../src/master-catalog.js";
test("active products remain visible without any prices, weight or units", () => {
  assert.equal(availableProduct({ activo: true, codigo: "P" }), true);
  assert.equal(availableProduct({ activo: false, codigo: "P" }), false);
  assert.equal(availableProduct(null), false);
});
test("master catalog uses AOCHEN and HUANTENG supplier prices and HEQ selling price without inventing missing values", () => {
  const product = {
    id: "p",
    unidad_compra_id: "roll",
    unidad_venta_id: "roll",
    precio_heq_kimix: 33,
    factor_columna_115: 1.1,
    precio_kimix_pha: 35,
  };
  const catalogs = {
    empresas: ["SUP-1", "SUP-13", "SUP-9", "CLI-1"].map((c) => ({
      id: c,
      codigo_interno: c,
    })),
    precios_compra: [
      ["SUP-1", 9.9],
      ["SUP-13", 9.6],
    ].map(([id, precio]) => ({
      proveedor_id: id,
      producto_id: "p",
      unidad_id: "roll",
      moneda: "USD",
      precio,
      vigente_desde: "2026-01-01",
    })),
    precios_venta: [
      {
        vendedor_id: "SUP-9",
        cliente_id: "CLI-1",
        producto_id: "p",
        unidad_id: "roll",
        moneda: "USD",
        precio: 11.385,
        vigente_desde: "2026-01-01",
      },
    ],
  };
  const result = masterProduct(product, catalogs, "2026-09-05");
  assert.equal(result.precio_aochen, 9.9);
  assert.equal(result.precio_huanteng, 9.6);
  assert.equal(result.precio_heq, 11.385);
  assert.equal(result.factor_columna_115, 1.1);
  catalogs.precios_compra = [];
  assert.equal(
    masterProduct(product, catalogs, "2026-09-05").precio_aochen,
    null,
  );
});
