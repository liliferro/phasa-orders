import Decimal from "decimal.js";
import { calculatedLines, resolvedHeaders } from "./documents.js";
export const exportKinds = [
  "purchase_order",
  "invoice",
  "orden_compra_mexico",
  "packing_list",
];
export const exportNames = {
  purchase_order: "Purchase Order",
  invoice: "Invoice",
  orden_compra_mexico: "Orden de compra",
  packing_list: "Packing List",
};
const sum = (rows, key) =>
  rows.reduce((a, l) => a.plus(l[key] ?? 0), new Decimal(0)).toNumber();
const code = (company) =>
  company?.codigo_interno?.replace(/^(SUP|CLI)-/, "") || "";
const lineAddress = (a) =>
  [a?.direccion, a?.ciudad, a?.estado, a?.codigo_postal, a?.pais]
    .filter(Boolean)
    .join(", ");
export function validateExport(snapshot, kinds) {
  const o = snapshot.operacion;
  const headers = resolvedHeaders({ ...o, encabezados: snapshot.encabezados });
  const errors = [];
  if (!snapshot.partidas?.length) errors.push("Agrega productos.");
  for (const l of snapshot.partidas || []) {
    for (const k of [
      "cantidad",
      "peso_unitario_kg",
      ...(kinds.includes("purchase_order") ? ["precio_compra"] : []),
      ...(kinds.some((k) => ["invoice", "orden_compra_mexico"].includes(k))
        ? ["precio_venta"]
        : []),
    ])
      if (
        l[k] === null ||
        l[k] === undefined ||
        !Number.isFinite(Number(l[k])) ||
        Number(l[k]) <= 0
      )
        errors.push(`${l.codigo}: completa ${k.replaceAll("_", " ")}.`);
  }
  for (const kind of kinds) {
    const h = headers[kind];
    if (!h.folio)
      errors.push(
        `${exportNames[kind]}: falta el folio${kind === "packing_list" ? " de Invoice que genera su número" : ""}.`,
      );
    if (!h.fecha) errors.push(`${exportNames[kind]}: falta la fecha.`);
  }
  if (!snapshot.domicilio?.direccion)
    errors.push("Falta el domicilio de entrega.");
  return [...new Set(errors)];
}
export function buildPages(snapshot, bundle, kinds = exportKinds) {
  const errors = validateExport(snapshot, kinds);
  if (errors.length) throw Error(errors.join("\n"));
  const o = snapshot.operacion,
    h = resolvedHeaders({ ...o, encabezados: snapshot.encabezados });
  const usa = snapshot.empresa_usa,
    client = snapshot.cliente,
    supplier = snapshot.proveedor;
  const ship = snapshot.domicilio,
    usaAddr = snapshot.empresa_usa_domicilios?.[0] || {},
    supplierAddr = snapshot.proveedor_domicilios?.[0] || {};
  const allLines = calculatedLines(snapshot.partidas);
  const pages = [];
  for (const kind of kinds) {
    const layout = bundle.layouts[kind];
    const count = Math.ceil(allLines.length / layout.lineCount);
    for (let pageIndex = 0; pageIndex < count; pageIndex++) {
      const page = structuredClone(layout);
      page.kind = kind;
      page.pageIndex = pageIndex;
      page.pageCount = count;
      page.folio = h[kind].folio;
      page.cells.forEach((c) => {
        delete c.formula;
      });
      const cell = (r, c) => page.cells.find((x) => x.r === r && x.c === c);
      const set = (address, value, formula) => {
        const m = address.match(/^([A-Z]+)(\d+)$/);
        let col = 0;
        for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
        const x = cell(Number(m[2]), col);
        if (x) {
          x.value = value ?? "";
          if (formula) x.formula = formula;
        }
      };
      const merge = (r1, c1, r2, c2) => {
        const master = cell(r1, c1),
          last = cell(r2, c2);
        master.border = {
          ...master.border,
          ...(cell(r1, c2)?.border.right
            ? { right: cell(r1, c2).border.right }
            : {}),
          ...(last?.border.bottom ? { bottom: last.border.bottom } : {}),
        };
        page.merges = page.merges.filter(
          (m) => m[2] < r1 || m[0] > r2 || m[3] < c1 || m[1] > c2,
        );
        page.merges.push([r1, c1, r2, c2]);
      };
      const fillCompany = (row, col, company, address) => {
        const values = [
          company?.razon_social,
          address?.direccion,
          [address?.ciudad, address?.estado, address?.codigo_postal]
            .filter(Boolean)
            .join(", "),
          address?.pais,
          [company?.telefono, company?.identificacion_fiscal, company?.email]
            .filter(Boolean)
            .join("  "),
        ];
        values.forEach((v, i) => set(`${col}${row + i}`, v));
      };
      // Clear sample detail rows completely before filling this saved operation.
      for (let r = page.lineStart; r < page.lineStart + page.lineCount; r++)
        for (let c = 1; c <= page.cols; c++) cell(r, c).value = "";
      const rows = allLines.slice(
        pageIndex * page.lineCount,
        (pageIndex + 1) * page.lineCount,
      );
      rows.forEach((l, i) => {
        const r = page.lineStart + i;
        let values;
        if (kind === "purchase_order")
          values = [
            l.codigo,
            Number(l.cantidad),
            l.unidad,
            l.descripcion_compra,
            Number(l.precio_compra),
            Number(l.importe_compra),
            Number(l.peso_unitario_kg),
            Number(l.peso_total_kg),
          ];
        if (kind === "invoice")
          values = [
            Number(l.cantidad),
            l.unidad,
            l.codigo,
            l.descripcion_compra,
            "",
            "",
            "",
            Number(l.precio_venta),
            Number(l.importe_venta),
          ];
        if (kind === "orden_compra_mexico")
          values = [
            Number(l.cantidad),
            l.unidad,
            l.codigo,
            l.descripcion_compra,
            Number(l.precio_venta),
            Number(l.importe_venta),
          ];
        if (kind === "packing_list")
          values = [
            pageIndex * 10 + i + 1,
            l.codigo,
            Number(l.cantidad),
            l.unidad,
            l.descripcion_compra,
            Number(l.peso_unitario_kg),
            Number(l.peso_total_kg),
          ];
        values.forEach((v, j) => (cell(r, j + 1).value = v));
        if (kind === "purchase_order") {
          cell(r, 6).formula = `ROUND(B${r}*E${r},2)`;
          cell(r, 8).formula = `B${r}*G${r}`;
        }
        if (kind === "invoice") cell(r, 9).formula = `ROUND(A${r}*H${r},2)`;
        if (kind === "orden_compra_mexico")
          cell(r, 6).formula = `ROUND(A${r}*E${r},2)`;
        if (kind === "packing_list") cell(r, 7).formula = `C${r}*F${r}`;
        // Weight columns are numeric kilograms, never accounting currency.
        for (const c of kind === "packing_list"
          ? [6, 7]
          : kind === "purchase_order"
            ? [7, 8]
            : [])
          cell(r, c).numFmt = "#,##0.000";
      });
      if (kind === "purchase_order") {
        set(
          "A2",
          [lineAddress(usaAddr), usa.telefono].filter(Boolean).join("  "),
        );
        merge(2, 1, 2, 8);
        set("B5", code(supplier));
        fillCompany(6, "A", supplier, supplierAddr);
        set("A9", supplier.telefono);
        set("A10", supplier.email);
        fillCompany(14, "A", usa, usaAddr);
        set(
          "A18",
          [usa.identificacion_fiscal, usa.telefono].filter(Boolean).join("  "),
        );
        fillCompany(14, "D", client, ship);
        set("E14", code(client));
        set("E16", o.folio);
        set("E17", h.purchase_order.referencia_proveedor);
        set("F5", o.folio);
        set("E7", new Date(h.purchase_order.fecha + "T00:00:00Z"));
        set("E9", h.purchase_order.condiciones_pago);
        set("E11", h.purchase_order.incoterm);
        set("H18", sum(rows, "peso_total_kg"), "SUM(H23:H32)");
        set("F33", sum(rows, "importe_compra"), "SUM(F23:F32)");
        set("H33", sum(rows, "peso_total_kg"), "SUM(H23:H32)");
        if (count > 1) set("E33", "SUBTOTAL");
      }
      if (kind === "invoice") {
        set(
          "A3",
          [lineAddress(usaAddr), usa.telefono].filter(Boolean).join("  "),
        );
        merge(3, 1, 3, 9);
        set("B7", code(client));
        fillCompany(8, "A", client, ship);
        for (let r = 8; r <= 12; r++) merge(r, 1, r, 4);
        set("F8", `${client.razon_social}\n${lineAddress(ship)}`);
        merge(8, 6, 12, 7);
        cell(8, 6).align.wrap = true;
        set("H10", o.folio);
        set("H11", h.purchase_order.referencia_proveedor);
        set("A15", h.invoice.folio);
        set("C15", new Date(h.invoice.fecha + "T00:00:00Z"));
        set("D15", h.invoice.condiciones_pago);
        set("F15", h.invoice.via_transporte);
        set("H15", h.invoice.incoterm);
        set("I29", sum(rows, "importe_venta"), "SUM(I19:I28)");
        set("I30", 0);
        set("I31", sum(rows, "importe_venta"), "I29+I30");
        if (count > 1) set("H31", "SUBTOTAL");
      }
      if (kind === "orden_compra_mexico") {
        const words = client.razon_social.split(" ");
        let a = "";
        while (words.length && a.length + words[0].length < 25)
          a += (a ? " " : "") + words.shift();
        set("C1", a);
        set("C2", words.join(" "));
        set("A3", lineAddress(ship));
        set("A4", [client.telefono, client.email].filter(Boolean).join("  "));
        set("B7", code(usa));
        fillCompany(8, "A", usa, usaAddr);
        set("A11", usa.telefono);
        set("A12", usa.email);
        fillCompany(16, "A", client, ship);
        set("A21", client.identificacion_fiscal);
        set("D16", lineAddress(ship));
        merge(16, 4, 21, 4);
        cell(16, 4).align.wrap = true;
        set("F7", h.orden_compra_mexico.folio);
        set("E9", new Date(h.orden_compra_mexico.fecha + "T00:00:00Z"));
        set("E11", h.orden_compra_mexico.condiciones_pago);
        set("E13", h.orden_compra_mexico.incoterm);
        set("E21", o.moneda_venta);
        set("F35", sum(rows, "importe_venta"), "SUM(F25:F34)");
        if (count > 1) set("E35", "SUBTOTAL");
        if (client.codigo_interno !== bundle.mexicanLogoCompany)
          page.images = [];
      }
      if (kind === "packing_list") {
        set(
          "A2",
          [lineAddress(usaAddr), usa.telefono].filter(Boolean).join("  "),
        );
        merge(2, 1, 2, 7);
        fillCompany(6, "A", client, ship);
        set("G5", h.packing_list.folio);
        set("F7", new Date(h.packing_list.fecha + "T00:00:00Z"));
        cell(7, 6).numFmt = "d-mmm-yy";
        set("F9", h.invoice.folio);
        set("F11", h.orden_compra_mexico.folio);
        set("C26", sum(rows, "cantidad"), "SUM(C16:C25)");
        set("G26", sum(rows, "peso_total_kg"), "SUM(G16:G25)");
        cell(26, 7).numFmt = "#,##0.000";
      }
      if (
        kind !== "orden_compra_mexico" &&
        usa.codigo_interno !== bundle.usaLogoCompany
      )
        page.images = [];
      page.notes = [
        h[kind].observaciones,
        kind === "invoice" && h.invoice.puerto_entrada
          ? `Port of entry: ${h.invoice.puerto_entrada}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ");
      page.grandTotal =
        kind === "packing_list"
          ? sum(allLines, "peso_total_kg")
          : sum(
              allLines,
              kind === "purchase_order" ? "importe_compra" : "importe_venta",
            );
      page.currency =
        kind === "packing_list"
          ? "kg"
          : kind === "purchase_order"
            ? o.moneda_compra
            : o.moneda_venta;
      pages.push(page);
    }
  }
  return pages;
}
