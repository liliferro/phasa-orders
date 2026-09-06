export const isEnglishDocument = (kind) =>
  ["purchase_order", "invoice", "packing_list"].includes(kind);
export function documentFieldLabel(kind, key, fallback) {
  if (!isEnglishDocument(kind)) return fallback;
  return (
    {
      folio: {
        purchase_order: "Purchase Order No.",
        invoice: "Invoice No.",
        packing_list: "Packing List No.",
      }[kind],
      fecha: kind === "invoice" ? "Invoice Date" : "Date",
      condiciones_pago: "Terms",
      incoterm: "Incoterm",
      via_transporte: "Ship Via",
      puerto_entrada: "Port of Entry",
      referencia_cliente:
        kind === "packing_list" ? "Customer P.O." : "Customer Reference",
      referencia_proveedor: "Supplier Reference",
      invoice_num: "Invoice No.",
      observaciones: "Notes",
    }[key] || fallback
  );
}
export function pageSummary(page) {
  return isEnglishDocument(page.kind)
    ? `Page ${page.pageIndex + 1} of ${page.pageCount} | Document total: ${page.grandTotal.toFixed(2)} ${page.currency}`
    : `Página ${page.pageIndex + 1} de ${page.pageCount} | Total documento: ${page.grandTotal.toFixed(2)} ${page.currency}`;
}
