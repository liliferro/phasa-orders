import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import {
  buildPages,
  validateExport,
  exportKinds,
} from "../src/export-model.js";
import { renderPdf, renderExcel, renderZip } from "../src/export-renderer.js";
import JSZip from "jszip";

function fixture(count = 1) {
  const snapshot = {
    operacion: {
      folio: "PO-TEST",
      revision: 3,
      fecha: "2026-06-02",
      moneda_compra: "USD",
      moneda_venta: "USD",
    },
    empresa_usa: { razon_social: "Issuer", codigo_interno: "US" },
    cliente: { razon_social: "Example client", codigo_interno: "MX" },
    proveedor: { razon_social: "Supplier" },
    domicilio: { direccion: "Delivery address" },
    encabezados: {
      invoice: { folio: "INV-TEST" },
      orden_compra_mexico: { folio: "MX-TEST" },
    },
    partidas: Array.from({ length: count }, (_, i) => ({
      codigo: "P-" + i,
      cantidad: 3,
      unidad: "ROLL",
      descripcion_compra: "Product " + i,
      precio_compra: 1.125,
      precio_venta: 2.345,
      peso_unitario_kg: 4.5,
    })),
  };
  const configs = [
    [8, 37, 23],
    [9, 31, 19],
    [6, 35, 25],
    [7, 26, 16],
  ];
  const layouts = Object.fromEntries(
    exportKinds.map((kind, i) => {
      const [cols, endRow, lineStart] = configs[i];
      return [
        kind,
        {
          name: kind,
          cols,
          endRow,
          lineStart,
          lineCount: 10,
          widths: Array(cols).fill(12),
          heights: Array(endRow).fill(18),
          images: [],
          merges: [],
          cells: Array.from({ length: cols * endRow }, (_, j) => ({
            r: Math.floor(j / cols) + 1,
            c: (j % cols) + 1,
            value: Math.floor(j / cols) + 1 >= lineStart ? "OLD DETAIL" : null,
            font: {
              name: "Arial",
              file: "arial.ttf",
              size: 10,
              color: "000000",
            },
            border: {},
            fill: null,
            align: {},
            numFmt: "#,##0.00",
          })),
        },
      ];
    }),
  );
  return {
    snapshot,
    bundle: { layouts, mexicanLogoCompany: "HEQ", usaLogoCompany: "PHA" },
  };
}
const cell = (page, r, c) => page.cells.find((x) => x.r === r && x.c === c);
test("exports use saved purchase and sale values, clear unused lines, and preserve source snapshot", () => {
  const { snapshot, bundle } = fixture();
  const before = structuredClone(snapshot);
  const pages = buildPages(snapshot, bundle);
  assert.equal(cell(pages[0], 23, 6).value, 3.38);
  assert.equal(cell(pages[1], 19, 9).value, 7.04);
  assert.equal(cell(pages[2], 25, 6).value, 7.04);
  assert.equal(cell(pages[3], 16, 7).value, 13.5);
  for (const p of pages)
    assert.ok(
      p.cells
        .filter((c) => c.r > p.lineStart && c.r < p.lineStart + 10)
        .every((c) => c.value === ""),
    );
  assert.deepEqual(snapshot, before);
  assert.ok(cell(pages[0], 7, 5).value instanceof Date);
});
test("missing prices or folios are rejected rather than exporting zero totals", () => {
  const { snapshot, bundle } = fixture();
  snapshot.partidas[0].precio_venta = null;
  assert.ok(
    validateExport(snapshot, ["invoice"]).some((x) =>
      x.includes("precio venta"),
    ),
  );
  assert.throws(() => buildPages(snapshot, bundle, ["invoice"]));
  assert.equal(buildPages(snapshot, bundle, ["purchase_order"]).length, 1);
  snapshot.encabezados.invoice.folio = "";
  assert.ok(
    validateExport(snapshot, ["packing_list"]).some((x) => x.includes("folio")),
  );
});
test("Excel logos use valid OOXML anchors and remain readable", async () => {
  const { snapshot, bundle } = fixture();
  bundle.usaLogoCompany = "US";
  bundle.layouts.purchase_order.images = [
    {
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      position: { col: 0, row: 0, colOff: 0, rowOff: 0, width: 12, height: 12 },
    },
  ];
  const bytes = await renderExcel(
    buildPages(snapshot, bundle, ["purchase_order"]),
  );
  const archive = await JSZip.loadAsync(bytes);
  const xml = await archive.file("xl/drawings/drawing1.xml").async("string");
  assert.ok(xml.includes("<xdr:oneCellAnchor>"));
  assert.ok(!xml.includes("oneCellAnchor editAs"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.equal(workbook.worksheets[0].getImages().length, 1);
});
test("23 lines paginate without omissions, Excel formulas point at their own pages, PDF and ZIP contain all documents", async () => {
  const { snapshot, bundle } = fixture(23);
  const pages = buildPages(snapshot, bundle);
  assert.equal(pages.length, 12);
  const pack = pages.filter((p) => p.kind === "packing_list");
  assert.equal(cell(pack[2], 16, 1).value, 21);
  assert.equal(cell(pack[2], 18, 2).value, "P-22");
  assert.equal(pack[0].grandTotal, 310.5);
  const bytes = await renderExcel(pages);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  assert.equal(wb.worksheets.length, 4);
  const po = wb.getWorksheet("purchase_order");
  assert.equal(po.getCell("F23").formula, "ROUND(B23*E23,2)");
  assert.equal(po.getCell("F62").formula, "ROUND(B62*E62,2)");
  assert.equal(po.getCell("F62").result, 3.38);
  assert.equal(po.getCell("A103").value, "P-22");
  const pdf = await PDFDocument.load(await renderPdf(pages, {}));
  assert.equal(pdf.getPageCount(), 12);
  const zip = await JSZip.loadAsync(await renderZip(pages, {}));
  assert.equal(Object.keys(zip.files).length, 4);
  for (const file of Object.values(zip.files))
    assert.equal(
      (await PDFDocument.load(await file.async("uint8array"))).getPageCount(),
      3,
    );
});
