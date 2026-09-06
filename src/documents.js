import Decimal from "decimal.js";
import { escapeHTML as e, total } from "./domain.js";
export const documentColumns = {
  purchase_order: [
    ["codigo", "CODE"],
    ["cantidad", "QTY"],
    ["unidad", "UOM"],
    ["descripcion_compra", "DESCRIPTION"],
    ["precio_compra", "PRICE"],
    ["importe_compra", "AMOUNT"],
    ["peso_unitario_kg", "WEIGHT PER UNIT"],
    ["peso_total_kg", "WEIGHT PER ITEM"],
  ],
  invoice: [
    ["cantidad", "QUANTITY"],
    ["unidad", "U.O.M."],
    ["codigo", "PART NO."],
    ["descripcion_compra", "DESCRIPTION"],
    ["precio_venta", "UNIT PRICE"],
    ["importe_venta", "TOTAL"],
  ],
  orden_compra_mexico: [
    ["cantidad", "QUANTITY"],
    ["unidad", "U.O.M."],
    ["codigo", "CODE"],
    ["descripcion_compra", "DESCRIPTION"],
    ["precio_venta", "PRICE"],
    ["importe_venta", "AMOUNT"],
  ],
  packing_list: [
    ["numero_partida", "ITEM"],
    ["codigo", "CODE"],
    ["cantidad", "QTY"],
    ["unidad", "UOM"],
    ["descripcion_compra", "DESCRIPTION"],
    ["peso_unitario_kg", "WEIGHT PER UNIT"],
    ["peso_total_kg", "GROSS WEIGHT"],
  ],
};
export function resolvedHeaders(order) {
  const h = order.encabezados || {};
  const po = { ...h.purchase_order, folio: order.folio, fecha: order.fecha };
  const invoice = {
    ...h.invoice,
    fecha: h.invoice?.fecha || order.fecha,
    referencia_cliente: order.folio,
    referencia_proveedor: po.referencia_proveedor || "",
  };
  const mx = {
    ...h.orden_compra_mexico,
    fecha: h.orden_compra_mexico?.fecha || order.fecha,
  };
  const pack = {
    ...h.packing_list,
    folio: invoice.folio ? `${invoice.folio}PL` : "",
    fecha: invoice.fecha,
    invoice_num: invoice.folio || "",
    referencia_cliente: mx.folio || "",
  };
  return {
    purchase_order: po,
    invoice,
    orden_compra_mexico: mx,
    packing_list: pack,
  };
}
const missing = (v) => v === null || v === undefined || v === "";
export function calculatedLines(lines) {
  return lines.map((l, i) => {
    const multiply = (k, dp) =>
      missing(l[k]) || missing(l.cantidad)
        ? null
        : new Decimal(l.cantidad)
            .mul(l[k])
            .toDecimalPlaces(dp, Decimal.ROUND_HALF_UP)
            .toFixed(dp);
    return {
      ...l,
      numero_partida: i + 1,
      importe_compra: multiply("precio_compra", 2),
      importe_venta: multiply("precio_venta", 2),
      peso_total_kg: multiply("peso_unitario_kg", 6),
    };
  });
}
export function priceExplanation(prices, criteria, date, companies) {
  const exact = prices.filter((p) =>
    Object.entries(criteria).every(([k, v]) => p[k] === v),
  );
  if (
    exact.some(
      (p) =>
        p.vigente_desde <= date && (!p.vigente_hasta || p.vigente_hasta > date),
    )
  )
    return "";
  if (exact.length)
    return "Hay un precio registrado, pero no está vigente en la fecha de esta orden.";
  const alternatives = prices.filter(
    (p) =>
      p.producto_id === criteria.producto_id &&
      p.unidad_id === criteria.unidad_id &&
      p.moneda === criteria.moneda,
  );
  const names = [
    ...new Set(
      alternatives
        .map(
          (p) =>
            companies.find((c) => c.id === (p.proveedor_id || p.cliente_id))
              ?.razon_social,
        )
        .filter(Boolean),
    ),
  ];
  return `Sin precio para ${criteria.proveedor_id ? "este proveedor" : "este cliente"}, unidad y moneda.${names.length ? ` El catálogo tiene precios para: ${names.join("; ")}.` : " Registra el precio en el catálogo o captura un precio acordado en esta orden."}`;
}
export function documentHTML(order, kind, catalogs) {
  const saved = order._snapshot;
  const find = (id) => catalogs.empresas.find((c) => c.id === id) || {};
  const usa = saved?.empresa_usa || find(order.empresa_usa_id),
    client = saved?.cliente || find(order.cliente_id),
    supplier = saved?.proveedor || find(order.proveedor_id);
  const address =
    saved?.domicilio ||
    catalogs.domicilios_empresa.find(
      (a) => a.id === order.domicilio_entrega_id,
    ) ||
    {};
  const companyAddress = (id, key) =>
    saved?.[key]?.[0] ||
    catalogs.domicilios_empresa.find((a) => a.empresa_id === id && a.activo) ||
    {};
  const usaAddress = companyAddress(usa.id, "empresa_usa_domicilios"),
    supplierAddress = companyAddress(supplier.id, "proveedor_domicilios");
  const h = resolvedHeaders(order)[kind],
    cols = documentColumns[kind];
  const block = (title, company, a) =>
    `<div><small>${e(title)}</small><b>${e(company.razon_social || "Por seleccionar")}</b><span>${e([a.direccion, a.ciudad, a.estado, a.codigo_postal, a.pais].filter(Boolean).join(", "))}</span><span>${e([company.telefono, company.email, company.identificacion_fiscal].filter(Boolean).join(" · "))}</span></div>`;
  const parties =
    kind === "purchase_order"
      ? block("SUPPLIER", supplier, supplierAddress) +
        block("BILL TO", usa, usaAddress) +
        block("SHIP TO", client, address)
      : kind === "orden_compra_mexico"
        ? block("SUPPLIER", usa, usaAddress) +
          block("BILL TO", client, address) +
          block("SHIP TO", client, address)
        : block(kind === "invoice" ? "SOLD TO" : "CUSTOMER", client, address) +
          block("SHIP TO", client, address);
  const titles = {
    purchase_order: "PURCHASE ORDER",
    invoice: "COMMERCIAL INVOICE",
    orden_compra_mexico: "ORDEN DE COMPRA",
    packing_list: "PACKING LIST",
  };
  const lines = calculatedLines(order.partidas);
  const priceKey =
    kind === "purchase_order"
      ? "precio_compra"
      : kind === "packing_list"
        ? "peso_unitario_kg"
        : "precio_venta";
  const incomplete = lines.some(
    (l) => missing(l[priceKey]) || missing(l.cantidad),
  );
  const sum = incomplete
    ? "Incompleto: faltan datos"
    : total(order.partidas, priceKey) +
      (kind === "packing_list"
        ? " kg"
        : ` ${kind === "purchase_order" ? order.moneda_compra : order.moneda_venta}`);
  return `<article class="document-preview"><div class="document-title"><div><b>${e((kind === "orden_compra_mexico" ? client : usa).razon_social || "")}</b><h2>${titles[kind]}</h2></div><span>NO. <b>${e(h.folio || "Pendiente de capturar")}</b><br>DATE ${e(h.fecha || "")}</span></div><div class="document-parties">${parties}</div><div class="document-meta">${[
    ["TERMS", h.condiciones_pago],
    ["INCOTERM", h.incoterm],
    ["SHIP VIA", h.via_transporte],
    ["PUERTO", h.puerto_entrada],
    ["REFERENCE", h.referencia_cliente],
    ["SUPPLIER REF.", h.referencia_proveedor],
    ["INVOICE NUM", h.invoice_num],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<span><small>${k}</small>${e(v)}</span>`)
    .join(
      "",
    )}</div><div class="table-scroll"><table><thead><tr>${cols.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${lines.map((l) => `<tr>${cols.map(([key]) => `<td>${missing(l[key]) ? "<em>Falta dato</em>" : e(l[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="document-total">TOTAL <b>${e(sum)}</b></div>${h.observaciones ? `<p>${e(h.observaciones)}</p>` : ""}</article>`;
}
