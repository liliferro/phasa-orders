import test from "node:test";
import assert from "node:assert/strict";
import { documentFieldLabel, pageSummary } from "../src/document-language.js";
import { documentHTML } from "../src/documents.js";
test("US documents use English labels, missing-data messages and page summaries", () => {
  const order = {
    folio: "",
    fecha: "2026-09-05",
    partidas: [
      { codigo: "P1", descripcion_compra: "Rubber sheet", cantidad: 1 },
    ],
    encabezados: { invoice: { puerto_entrada: "Manzanillo" } },
  };
  for (const kind of ["purchase_order", "invoice", "packing_list"]) {
    const html = documentHTML(order, kind, {
      empresas: [],
      domicilios_empresa: [],
    });
    assert.match(html, /Missing data/);
    assert.match(html, /Not entered/);
    assert.match(html, /Incomplete: missing data/);
    assert.doesNotMatch(
      html,
      /Falta dato|Pendiente de capturar|Por seleccionar|Incompleto|PUERTO/,
    );
    assert.equal(
      documentFieldLabel(kind, "observaciones", "Observaciones"),
      "Notes",
    );
    assert.equal(
      pageSummary({
        kind,
        pageIndex: 1,
        pageCount: 3,
        grandTotal: 42,
        currency: "USD",
      }),
      "Page 2 of 3 | Document total: 42.00 USD",
    );
  }
  assert.equal(documentFieldLabel("invoice", "folio", "Folio"), "Invoice No.");
  assert.equal(
    documentFieldLabel("purchase_order", "folio", "Folio"),
    "Purchase Order No.",
  );
  assert.equal(
    documentFieldLabel("packing_list", "referencia_cliente", "Referencia"),
    "Customer P.O.",
  );
  assert.equal(
    documentFieldLabel("orden_compra_mexico", "observaciones", "Observaciones"),
    "Observaciones",
  );
});
