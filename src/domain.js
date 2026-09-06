import Decimal from "decimal.js";
export const kinds = {
  purchase_order: "Purchase Order",
  invoice: "Invoice",
  orden_compra_mexico: "Orden de compra",
  packing_list: "Packing List",
};
export const escapeHTML = (v = "") =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function total(lines, field) {
  return lines
    .reduce(
      (a, l) =>
        l[field] === null || l[field] === "" || l[field] === undefined
          ? a
          : a.plus(
              new Decimal(l.cantidad || 0)
                .mul(l[field])
                .toDecimalPlaces(
                  field === "peso_unitario_kg" ? 6 : 2,
                  Decimal.ROUND_HALF_UP,
                ),
            ),
      new Decimal(0),
    )
    .toFixed(field === "peso_unitario_kg" ? 3 : 2);
}
export function currentPrice(prices, criteria, date) {
  return prices.find(
    (p) =>
      Object.entries(criteria).every(([k, v]) => p[k] === v) &&
      p.vigente_desde <= date &&
      (!p.vigente_hasta || p.vigente_hasta > date),
  );
}
export function orderFromRevision(r, current) {
  return {
    ...r.datos.operacion,
    revision: current,
    revision_origen_id: r.id,
    partidas: structuredClone(r.datos.partidas),
    encabezados: structuredClone(r.datos.encabezados),
    motivo: "",
    _snapshot: structuredClone(r.datos),
  };
}
