import { createClient } from "@supabase/supabase-js";
import { availableProduct } from "./availability.js";
import {
  escapeHTML as e,
  kinds,
  total,
  currentPrice,
  orderFromRevision,
} from "./domain.js";
import {
  documentHTML,
  resolvedHeaders,
  priceExplanation,
} from "./documents.js";
import "./style.css";
import {
  exportRevision,
  previousExports,
  downloadPrevious,
} from "./exports.js";
import { exportKinds } from "./export-model.js";
import { masterProduct, masterPriceColumns } from "./master-catalog.js";
import { isEnglishDocument, documentFieldLabel } from "./document-language.js";
const db = createClient(
  "https://qfwvlhzvgbqmcajdmczj.supabase.co",
  "sb_publishable_j7NC2Zo47BrPQC2SfdGYuA_k3XSqQVX",
);
const app = document.querySelector("#app"),
  dialog = document.querySelector("#editor");
const tables = [
  "empresas",
  "roles_empresa",
  "domicilios_empresa",
  "unidades",
  "productos",
  "precios_compra",
  "precios_venta",
];
let catalogs = {},
  orders = [],
  order = null,
  view = "orders",
  selectedKind = "purchase_order",
  dirty = false,
  session = null;
let exporting = false;
const today = () => new Date().toLocaleDateString("en-CA");
function notify(s) {
  document.querySelector("#notice").textContent = s;
}
async function run(fn) {
  try {
    await fn();
  } catch (x) {
    notify(x.message || String(x));
  }
}
async function query(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data;
}
async function all(table) {
  let result = [];
  for (let page = 0; ; page++) {
    const rows = await query(
      db
        .from(table)
        .select("*")
        .range(page * 1000, page * 1000 + 999),
    );
    result.push(...rows);
    if (rows.length < 1000) return result;
  }
}
function label(t, id) {
  const row = (catalogs[t] || []).find((x) => x.id === id);
  return row
    ? row.razon_social ||
        [row.codigo, row.descripcion_compra || row.nombre || row.direccion]
          .filter(Boolean)
          .join(" · ")
    : id || "";
}
function opts(rows, value, empty = true) {
  return (
    (empty ? '<option value="">Seleccionar…</option>' : "") +
    rows
      .map(
        (r) =>
          `<option value="${e(r.id)}" ${r.id === value ? "selected" : ""}>${e(r.razon_social || r.codigo || r.nombre)}</option>`,
      )
      .join("")
  );
}
function byRole(role) {
  const ids = new Set(
    catalogs.roles_empresa
      .filter((r) => r.rol === role)
      .map((r) => r.empresa_id),
  );
  return catalogs.empresas.filter(
    (c) =>
      ids.has(c.id) && c.activa && (role !== "proveedor" || c.pais === "CN"),
  );
}
function field(name, title, value = "", type = "text", extra = "") {
  return `<label>${e(title)}<input name="${e(name)}" type="${type}" value="${e(value)}" ${extra}></label>`;
}
function shell(content) {
  app.innerHTML = `<aside><a class="brand" href="#">PHASA<span>ORDERS</span></a><p>Operaciones de importación</p><nav><button data-nav="orders" class="${view === "orders" ? "selected" : ""}">Órdenes e historial</button><button data-nav="catalogs" class="${view === "catalogs" ? "selected" : ""}">Catálogos</button></nav><small>Tu información se guarda<br>con historial de versiones.</small><button id="logout" class="quiet">Cerrar sesión</button></aside><main>${content}</main>`;
  document.querySelectorAll("[data-nav]").forEach(
    (b) =>
      (b.onclick = () =>
        run(async () => {
          if (
            dirty &&
            !confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")
          )
            return;
          dirty = false;
          view = b.dataset.nav;
          order = null;
          render();
        })),
  );
  document.querySelector("#logout").onclick = () =>
    run(async () => {
      if (dirty && !confirm("Hay cambios sin guardar. ¿Salir?")) return;
      await db.auth.signOut();
    });
}
async function refresh() {
  const data = await Promise.all(tables.map(all));
  tables.forEach((t, i) => (catalogs[t] = data[i]));
  orders = await query(
    db
      .from("purchase_orders")
      .select("*")
      .order("updated_at", { ascending: false }),
  );
}
function login() {
  app.innerHTML = `<div class="login"><div class="intro"><span class="eyebrow">PHASA / OPERACIONES</span><h1>De una orden<br>a todo el flujo.</h1><p>Productos, documentos e historial.<br>En un solo lugar.</p></div><form id="login"><span class="badge">Acceso privado</span><h2>Bienvenida</h2><p>Recibe un enlace de acceso en tu correo autorizado.</p>${field("email", "Correo electrónico", "", "email", 'required autocomplete="email"')}<button>Enviar enlace de acceso</button><small>Solo el correo autorizado puede consultar la información.</small></form></div>`;
  document.querySelector("#login").onsubmit = (ev) => {
    ev.preventDefault();
    run(async () => {
      const b = ev.target.querySelector("button");
      b.disabled = true;
      try {
        const { error } = await db.auth.signInWithOtp({
          email: new FormData(ev.target).get("email"),
          options: { emailRedirectTo: location.origin },
        });
        if (error) throw error;
        notify("Revisa tu correo y abre el enlace para entrar.");
      } finally {
        b.disabled = false;
      }
    });
  };
}
function newOrder() {
  order = {
    folio: "",
    fecha: today(),
    empresa_usa_id: byRole("empresa_usa")[0]?.id,
    proveedor_id: "",
    cliente_id: "",
    domicilio_entrega_id: "",
    moneda_compra: "USD",
    moneda_venta: "USD",
    partidas: [],
    encabezados: {},
  };
  selectedKind = "purchase_order";
  dirty = false;
  render();
}
function render() {
  if (order) return renderOrder();
  if (view === "catalogs") return renderCatalogs();
  shell(
    `<header><div><span class="eyebrow">OPERACIONES</span><h1>Órdenes e historial</h1><p>Consulta cada operación y las versiones de sus documentos.</p></div><button id="new">＋ Nueva Purchase Order</button></header><div class="metrics"><article><span>Órdenes guardadas</span><strong>${orders.length}</strong></article><article><span>Productos en catálogo</span><strong>${catalogs.productos.length}</strong></article><article><span>Clientes</span><strong>${byRole("cliente_mexico").length}</strong></article></div><section><input id="searchOrders" placeholder="Buscar por folio, cliente o proveedor" aria-label="Buscar órdenes"><div id="orderList"></div></section>`,
  );
  document.querySelector("#new").onclick = newOrder;
  document.querySelector("#searchOrders").oninput = orderList;
  orderList();
}
function orderList() {
  const search = document.querySelector("#searchOrders").value.toLowerCase();
  const rows = orders.filter((o) =>
    [
      o.folio,
      label("empresas", o.cliente_id),
      label("empresas", o.proveedor_id),
    ]
      .join(" ")
      .toLowerCase()
      .includes(search),
  );
  document.querySelector("#orderList").innerHTML = rows.length
    ? `<table><thead><tr><th>Purchase Order</th><th>Cliente</th><th>Fecha</th><th>Versión</th><th></th></tr></thead><tbody>${rows.map((o) => `<tr><td><b>${e(o.folio)}</b><small>${e(label("empresas", o.proveedor_id))}</small></td><td>${e(label("empresas", o.cliente_id))}</td><td>${e(o.fecha)}</td><td>v${o.revision}</td><td><button class="quiet" data-open="${o.id}">Abrir historial</button></td></tr>`).join("")}</tbody></table>`
    : '<div class="empty"><h2>Aquí comienza el historial</h2><p>Crea una Purchase Order para guardar la operación y sus documentos.</p></div>';
  document
    .querySelectorAll("[data-open]")
    .forEach((b) => (b.onclick = () => run(() => openHistory(b.dataset.open))));
}
async function openHistory(id, trash = false) {
  const revisions = await query(
    db
      .from("revisiones_operacion")
      .select("*")
      .eq("purchase_order_id", id)
      .order("numero_revision", { ascending: false }),
  );
  const latest = orders.find((o) => o.id === id);
  const visible = revisions.filter((r) => Boolean(r.eliminada_at) === trash);
  dialog.innerHTML = `<h2>${e(latest.folio)}${trash ? " · Papelera" : ""}</h2><p>${trash ? "Puedes restaurar las versiones eliminadas y sus archivos." : "Eliminar una versión la envía a la papelera. Las otras versiones no cambian."}</p>${visible.map((r) => `<article class="revision"><div><b>Versión ${r.numero_revision}</b><small>${e(new Date(r.created_at).toLocaleString("es-MX"))} · ${e(r.motivo || "Guardado de operación")}</small></div><div class="actions">${trash ? "" : `<button data-rev="${r.id}">Abrir versión</button>`}<button class="quiet" data-trash="${r.id}">${trash ? "Restaurar" : "Eliminar versión"}</button></div></article>`).join("")}${!visible.length ? "<p>No hay versiones en esta vista.</p>" : ""}<div class="actions"><button id="toggleTrash" class="quiet">${trash ? "Volver al historial" : `Ver papelera (${revisions.filter((r) => r.eliminada_at).length})`}</button><button id="closeDialog" class="quiet">Cerrar</button></div><p id="historyError" role="status"></p>`;
  if (!dialog.open) dialog.showModal();
  document.querySelector("#toggleTrash").onclick = () =>
    run(() => openHistory(id, !trash));
  dialog.querySelectorAll("[data-trash]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await query(
            db.rpc("papelera_revision", {
              revision_id: b.dataset.trash,
              eliminar: !trash,
            }),
          );
          await openHistory(id, trash);
        } catch (error) {
          document.querySelector("#historyError").textContent = error.message;
          b.disabled = false;
        }
      }),
  );
  document.querySelector("#closeDialog").onclick = () => dialog.close();
  dialog.querySelectorAll("[data-rev]").forEach(
    (b) =>
      (b.onclick = () => {
        order = orderFromRevision(
          revisions.find((r) => r.id === b.dataset.rev),
          latest.revision,
        );
        dirty = false;
        dialog.close();
        renderOrder();
        notify(
          "Puedes editar esta versión. Al guardar se creará una nueva para los cuatro documentos.",
        );
      }),
  );
}
const headerFields = [
  ["folio", "Folio del documento"],
  ["fecha", "Fecha del documento", "date"],
  ["condiciones_pago", "Condiciones de pago"],
  ["incoterm", "Incoterm y lugar"],
  ["via_transporte", "Vía de transporte"],
  ["puerto_entrada", "Puerto de entrada"],
  ["referencia_cliente", "Referencia del cliente"],
  ["referencia_proveedor", "Referencia del proveedor"],
  ["observaciones", "Observaciones"],
];
function renderOrder() {
  shell(
    `<header><div><span class="eyebrow">CAPTURA DE OPERACIÓN</span><h1>${e(order.folio || "Nueva Purchase Order")}</h1><p>Los cambios compartidos actualizan los cuatro documentos y conservan el historial.</p></div><button id="save">Guardar nueva versión</button></header><form id="orderForm"><section><h2>1. Proveedor y destino</h2><div class="grid">${field("folio", "Folio de Purchase Order", order.folio, "text", "required")}${field("fecha", "Fecha", order.fecha, "date", "required")}<label>Proveedor chino<select name="proveedor_id" required>${opts(byRole("proveedor"), order.proveedor_id)}</select></label><label>Ship To · Cliente mexicano<select name="cliente_id" required>${opts(byRole("cliente_mexico"), order.cliente_id)}</select></label>${field("moneda_compra", "Moneda de compra", order.moneda_compra, "text", 'required pattern="[A-Z]{3}"')}${field("moneda_venta", "Moneda de venta", order.moneda_venta, "text", 'required pattern="[A-Z]{3}"')}</div><p id="address" class="hint"></p></section><section><h2>2. Productos</h2><p>Busca por código o nombre. Los precios se toman del proveedor y cliente seleccionados.</p><input id="productSearch" placeholder="Buscar código o nombre del producto" aria-label="Buscar producto" autocomplete="off"><div id="productResults"></div><button type="button" id="refreshPrices" class="quiet">Completar precios desde el catálogo</button><p class="hint">Compra: lo que paga la empresa estadounidense al proveedor chino. Venta: lo que paga el cliente mexicano a la empresa estadounidense. Ambos precios corresponden a la unidad indicada.</p><div class="table-scroll" id="lines"></div><div id="totals" class="totals"></div></section><section><h2>3. Documentos</h2><div class="tabs">${Object.entries(
      kinds,
    )
      .map(
        ([k, v]) =>
          `<button type="button" data-kind="${k}" class="${k === selectedKind ? "selected" : ""}">${v}</button>`,
      )
      .join(
        "",
      )}</div><p id="documentHelp">Estos campos pertenecen al documento seleccionado. Las cantidades y precios se editan arriba.</p><div class="grid" id="headers"></div><div id="documentPreview"></div></section><section>${field("motivo", "Motivo del cambio (opcional)", order.motivo || "")}<p class="hint">Revisa los folios y las condiciones comerciales antes de descargar. Cada cambio guardado conserva la versión anterior.</p></section></form>`,
  );
  const form = document.querySelector("#orderForm");
  form.onchange = (ev) => {
    if (ev.target.closest("#headers") || ev.target.closest("#lines")) return;
    const k = ev.target.name;
    if (k) {
      const old = order[k];
      if (
        [
          "proveedor_id",
          "cliente_id",
          "moneda_compra",
          "moneda_venta",
          "fecha",
        ].includes(k) &&
        order.partidas.length
      ) {
        const proposed = { ...order, [k]: ev.target.value };
        const incompatible = order.partidas.filter(
          (l) =>
            !availableProduct(
              catalogs.productos.find((p) => p.id === l.producto_id),
              proposed,
              catalogs,
            ),
        );
        if (incompatible.length) {
          ev.target.value = old;
          notify(
            `No se cambió la selección: ${incompatible.map((l) => l.codigo).join(", ")} ya no están activos en el catálogo.`,
          );
          return;
        }
        if (
          !confirm(
            "Este cambio volverá a buscar los precios para todos los productos. Los precios capturados se reemplazarán por los disponibles para la nueva selección. ¿Continuar?",
          )
        ) {
          ev.target.value = old;
          return;
        }
      }
      order[k] = ev.target.value;
      dirty = true;
      if (k === "cliente_id") {
        order.domicilio_entrega_id =
          catalogs.domicilios_empresa.find(
            (a) =>
              a.empresa_id === order.cliente_id &&
              a.activo &&
              a.es_domicilio_entrega,
          )?.id || "";
        showAddress();
      }
      if (
        [
          "proveedor_id",
          "cliente_id",
          "moneda_compra",
          "moneda_venta",
          "fecha",
        ].includes(k)
      ) {
        delete order._snapshot;
        reprice();
        searchProducts();
      }
      showHeaders();
    }
  };
  document.querySelector("#refreshPrices").onclick = () => {
    if (
      confirm(
        "¿Actualizar los precios de esta orden desde el catálogo? Se conservarán las partidas que no tengan una cotización completa disponible.",
      )
    ) {
      reprice();
      notify(
        "Precios consultados para el proveedor, cliente, moneda y fecha seleccionados.",
      );
    }
  };
  document.querySelector("#save").onclick = () => run(saveOrder);
  document
    .querySelector("#orderForm")
    .insertAdjacentHTML(
      "beforeend",
      `<section><h2>4. Descargar documentos</h2><p>Los archivos conservan logos, colores y columnas de cada documento. Los cambios se guardan como una nueva versión antes de descargar.</p><div class="actions"><button type="button" data-export="pdf">PDF del documento seleccionado</button><button type="button" data-export="xlsx">Excel del documento seleccionado</button></div><div class="actions"><button type="button" data-export="pdf" data-all="true" class="quiet">PDF de todo el flujo</button><button type="button" data-export="xlsx" data-all="true" class="quiet">Excel de todo el flujo</button><button type="button" data-export="zip" data-all="true" class="quiet">PDF separados (ZIP)</button></div><p class="hint">Documento seleccionado: <strong id="exportKind"></strong>. El flujo incluye Purchase Order, Invoice, Orden de compra y Packing List.</p><p id="exportStatus" role="status" aria-live="polite"></p><button type="button" id="previousExports" class="quiet">Descargas anteriores de esta versión</button><div id="exportHistory"></div></section>`,
    );
  document.querySelector("#exportKind").textContent = kinds[selectedKind];
  document.querySelectorAll("[data-export]").forEach((b) => {
    b.disabled = exporting;
    b.onclick = () =>
      run(() =>
        downloadOrder(
          b.dataset.export,
          b.dataset.all ? exportKinds : [selectedKind],
        ),
      );
  });
  document.querySelector("#previousExports").onclick = () =>
    run(showExportHistory);
  document.querySelector("#productSearch").oninput = searchProducts;
  document.querySelector("#productSearch").onfocus = searchProducts;
  document.querySelectorAll("[data-kind]").forEach(
    (b) =>
      (b.onclick = () => {
        selectedKind = b.dataset.kind;
        document
          .querySelectorAll("[data-kind]")
          .forEach((x) => x.classList.toggle("selected", x === b));
        showHeaders();
        document.querySelector("#exportKind").textContent = kinds[selectedKind];
      }),
  );
  showAddress();
  showLines();
  showHeaders();
  searchProducts();
}
function showAddress() {
  const a = catalogs.domicilios_empresa.find(
    (x) => x.id === order.domicilio_entrega_id,
  );
  document.querySelector("#address").textContent = a
    ? `Entrega: ${a.direccion}, ${a.ciudad || ""}`
    : "Selecciona un cliente con domicilio de entrega en su catálogo.";
}
function searchProducts() {
  if (!order.proveedor_id || !order.cliente_id) {
    document.querySelector("#productResults").innerHTML =
      '<p class="hint">Selecciona primero el proveedor y el cliente para ver sus productos disponibles.</p>';
    return;
  }
  const text = document
    .querySelector("#productSearch")
    .value.toLowerCase()
    .trim();
  const results = catalogs.productos
    .filter(
      (p) =>
        availableProduct(p, order, catalogs) &&
        [
          p.codigo,
          p.descripcion_compra,
          p.descripcion_venta,
          p.descripcion_mexico,
        ]
          .join(" ")
          .toLowerCase()
          .includes(text),
    )
    .slice(0, 30);
  document.querySelector("#productResults").innerHTML = results.length
    ? results
        .map(
          (p) =>
            `<button type="button" data-product="${p.id}"><b>${e(p.codigo)}</b> ${e(p.descripcion_compra)}</button>`,
        )
        .join("")
    : text
      ? '<p class="hint">No hay productos activos con ese código o descripción.</p>'
      : "";
  document
    .querySelectorAll("[data-product]")
    .forEach((b) => (b.onclick = () => addProduct(b.dataset.product)));
}
function addProduct(id) {
  if (!order.proveedor_id || !order.cliente_id) {
    notify("Primero selecciona proveedor y cliente.");
    return;
  }
  const p = catalogs.productos.find((x) => x.id === id);
  if (!availableProduct(p, order, catalogs)) {
    notify("Este producto ya no está activo en el catálogo.");
    searchProducts();
    return;
  }
  const buy = currentPrice(
    catalogs.precios_compra,
    {
      proveedor_id: order.proveedor_id,
      producto_id: id,
      unidad_id: p.unidad_compra_id,
      moneda: order.moneda_compra,
    },
    order.fecha,
  );
  const sell = currentPrice(
    catalogs.precios_venta,
    {
      vendedor_id: order.empresa_usa_id,
      cliente_id: order.cliente_id,
      producto_id: id,
      unidad_id: p.unidad_compra_id,
      moneda: order.moneda_venta,
    },
    order.fecha,
  );
  order.partidas.push({
    producto_id: id,
    codigo: p.codigo,
    descripcion_compra: p.descripcion_compra,
    descripcion_venta: p.descripcion_venta || p.descripcion_compra,
    descripcion_mexico: p.descripcion_mexico || p.descripcion_compra,
    unidad:
      catalogs.unidades.find((u) => u.id === p.unidad_compra_id)?.codigo || "",
    cantidad: "1",
    precio_compra: buy?.precio ?? null,
    precio_venta: sell?.precio ?? null,
    peso_unitario_kg: p.peso_unitario_kg,
  });
  dirty = true;
  document.querySelector("#productSearch").value = "";
  document.querySelector("#productResults").innerHTML = "";
  showLines();
}
function showLines() {
  document.querySelector("#lines").innerHTML = order.partidas.length
    ? `<table><thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Precio de compra por unidad</th><th>Precio de venta por unidad</th><th>Kg / unidad</th><th></th></tr></thead><tbody>${order.partidas.map((l, i) => `<tr><td><b>${e(l.codigo)}</b><small>${e(l.descripcion_compra)}</small></td>${["cantidad", "unidad", "precio_compra", "precio_venta", "peso_unitario_kg"].map((k) => `<td><input aria-label="${k} de ${e(l.codigo)}" data-i="${i}" data-key="${k}" type="${k === "unidad" ? "text" : "number"}" ${k === "unidad" ? "readonly" : 'step="any" min="0"'} value="${e(l[k])}" placeholder="Falta dato">${["precio_compra", "precio_venta"].includes(k) ? `<small class="price-explanation">${e(priceNote(l, k))}${l[k] !== null && Number(l[k]) === 0 ? " Precio capturado en cero; revisa si es intencional." : ""}</small>` : ""}</td>`).join("")}<td><button type="button" data-remove="${i}" class="quiet" aria-label="Quitar ${e(l.codigo)}">×</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="hint">Agrega el primer producto para comenzar.</p>';
  document.querySelectorAll("[data-key]").forEach(
    (input) =>
      (input.oninput = () => {
        order.partidas[Number(input.dataset.i)][input.dataset.key] =
          input.value === "" ? null : input.value;
        dirty = true;
        showTotals();
        showDocument();
      }),
  );
  document.querySelectorAll("[data-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        order.partidas.splice(Number(b.dataset.remove), 1);
        dirty = true;
        showLines();
      }),
  );
  showTotals();
  showDocument();
}
function showTotals() {
  const amount = (key) =>
    order.partidas.some(
      (l) =>
        l[key] === null || l[key] === undefined || l[key] === "" || !l.cantidad,
    )
      ? "Incompleto"
      : total(order.partidas, key);
  document.querySelector("#totals").innerHTML =
    `<span>Compra <b>${e(order.moneda_compra)} ${amount("precio_compra")}</b></span><span>Venta <b>${e(order.moneda_venta)} ${amount("precio_venta")}</b></span><span>Peso <b>${amount("peso_unitario_kg")} kg</b></span>`;
}
function showDocument() {
  document.querySelector("#documentPreview").innerHTML = documentHTML(
    order,
    selectedKind,
    catalogs,
  );
}
function priceCriteria(line, key) {
  const p = catalogs.productos.find((p) => p.id === line.producto_id);
  return key === "precio_compra"
    ? {
        proveedor_id: order.proveedor_id,
        producto_id: line.producto_id,
        unidad_id: p?.unidad_compra_id,
        moneda: order.moneda_compra,
      }
    : {
        vendedor_id: order.empresa_usa_id,
        cliente_id: order.cliente_id,
        producto_id: line.producto_id,
        unidad_id: p?.unidad_compra_id,
        moneda: order.moneda_venta,
      };
}
function priceNote(line, key) {
  return priceExplanation(
    catalogs[key === "precio_compra" ? "precios_compra" : "precios_venta"],
    priceCriteria(line, key),
    order.fecha,
    catalogs.empresas,
  );
}
function reprice() {
  for (const l of order.partidas) {
    if (
      !availableProduct(
        catalogs.productos.find((p) => p.id === l.producto_id),
        order,
        catalogs,
      )
    )
      continue;
    for (const key of ["precio_compra", "precio_venta"]) {
      l[key] =
        currentPrice(
          catalogs[
            key === "precio_compra" ? "precios_compra" : "precios_venta"
          ],
          priceCriteria(l, key),
          order.fecha,
        )?.precio ?? null;
    }
  }
  dirty = true;
  delete order.clave_guardado;
  showLines();
}
function showHeaders() {
  const english = isEnglishDocument(selectedKind);
  document.querySelector("#documentHelp").textContent = english
    ? "Enter terms and notes in English. Edit shared quantities and prices in the Products section above."
    : "Estos campos pertenecen al documento seleccionado. Las cantidades y precios se editan arriba.";
  const values = resolvedHeaders(order)[selectedKind];
  const automatic = {
    purchase_order: ["folio", "fecha"],
    invoice: ["referencia_cliente", "referencia_proveedor"],
    orden_compra_mexico: [],
    packing_list: ["folio", "fecha", "referencia_cliente", "invoice_num"],
  }[selectedKind];
  const visible = {
    purchase_order: [
      "folio",
      "fecha",
      "condiciones_pago",
      "incoterm",
      "referencia_proveedor",
      "observaciones",
    ],
    invoice: [
      "folio",
      "fecha",
      "condiciones_pago",
      "incoterm",
      "via_transporte",
      "puerto_entrada",
      "referencia_cliente",
      "referencia_proveedor",
      "observaciones",
    ],
    orden_compra_mexico: [
      "folio",
      "fecha",
      "condiciones_pago",
      "incoterm",
      "observaciones",
    ],
    packing_list: [
      "folio",
      "fecha",
      "invoice_num",
      "referencia_cliente",
      "observaciones",
    ],
  }[selectedKind];
  document.querySelector("#headers").innerHTML = [
    ...headerFields,
    ["invoice_num", "Número de Invoice"],
  ]
    .filter(([k]) => visible.includes(k))
    .map(([k, t, type]) =>
      field(
        k,
        documentFieldLabel(selectedKind, k, t) +
          (automatic.includes(k)
            ? english
              ? " · automatic"
              : " · automático"
            : ""),
        values[k] || "",
        type || "text",
        automatic.includes(k) ? "readonly" : "",
      ),
    )
    .join("");
  document.querySelectorAll("#headers input").forEach(
    (input) =>
      (input.oninput = () => {
        if (input.readOnly) return;
        order.encabezados[selectedKind] ??= {};
        order.encabezados[selectedKind][input.name] = input.value;
        dirty = true;
        showDocument();
      }),
  );
  showDocument();
}
async function saveOrder() {
  if (!document.querySelector("#orderForm").reportValidity()) return false;
  if (!order.domicilio_entrega_id)
    throw Error("Completa el domicilio de entrega del cliente.");
  if (!order.partidas.length) throw Error("Agrega al menos un producto.");
  const b = document.querySelector("#save");
  b.disabled = true;
  try {
    order.clave_guardado ??= crypto.randomUUID();
    const result = await query(
      db.rpc("guardar_operacion", {
        p: { ...order, encabezados: resolvedHeaders(order) },
      }),
    );
    order.id = result.id;
    order.revision = result.revision;
    order.revision_origen_id = result.revision_id;
    delete order.clave_guardado;
    delete order._snapshot;
    dirty = false;
    await refresh();
    renderOrder();
    notify(`Versión ${result.revision} guardada con sus cuatro documentos.`);
    return true;
  } finally {
    b.disabled = false;
  }
}
async function downloadOrder(format, selected) {
  if (exporting) return;
  exporting = true;
  const setStatus = (text) => {
    const box = document.querySelector("#exportStatus");
    if (box) box.textContent = text;
  };
  try {
    document
      .querySelectorAll("[data-export]")
      .forEach((b) => (b.disabled = true));
    if ((dirty || !order.revision_origen_id) && !(await saveOrder())) return;
    const name = await exportRevision(
      db,
      order.revision_origen_id,
      format,
      selected,
      setStatus,
    );
    setStatus(`Archivo guardado y descargado: ${name}`);
    notify(
      "Descarga lista. El archivo queda disponible en el historial de esta versión.",
    );
  } catch (error) {
    setStatus(error.message || String(error));
    throw error;
  } finally {
    exporting = false;
    document
      .querySelectorAll("[data-export]")
      .forEach((b) => (b.disabled = false));
  }
}
async function showExportHistory() {
  if (!order.revision_origen_id)
    throw Error("Guarda la orden para consultar sus descargas.");
  const rows = await previousExports(db, order.revision_origen_id);
  const box = document.querySelector("#exportHistory");
  if (!box) return;
  box.innerHTML = rows.length
    ? rows
        .map(
          (r, i) =>
            `<p><button type="button" class="quiet" data-download="${i}">${e(r.nombre_archivo)}</button> · ${e(new Date(r.created_at).toLocaleString("es-MX"))}</p>`,
        )
        .join("")
    : "<p>Todavía no se han generado archivos para esta versión.</p>";
  box
    .querySelectorAll("[data-download]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          run(() => downloadPrevious(db, rows[Number(b.dataset.download)]))),
    );
}
const names = {
  empresas: "Empresas",
  roles_empresa: "Funciones de empresas",
  domicilios_empresa: "Domicilios",
  unidades: "Unidades",
  productos: "Productos",
  precios_compra: "Precios de compra",
  precios_venta: "Precios de venta",
};
let catalogTable = "productos";
const definitions = {
  empresas: [
    ["codigo_interno", "Código interno"],
    ["razon_social", "Razón social"],
    ["pais", "País (CN, MX, US, ES)"],
    ["identificacion_fiscal", "Identificación fiscal"],
    ["telefono", "Teléfono"],
    ["email", "Correo"],
    ["activa", "Activa", "boolean"],
  ],
  roles_empresa: [
    ["empresa_id", "Empresa", "empresas"],
    ["rol", "Función", "role"],
    ["codigo_catalogo_origen", "Código en catálogo de origen"],
  ],
  domicilios_empresa: [
    ["empresa_id", "Empresa", "empresas"],
    ["direccion", "Calle y número"],
    ["ciudad", "Ciudad"],
    ["estado", "Estado"],
    ["codigo_postal", "Código postal"],
    ["pais", "País (CN, MX, US, ES)"],
    ["es_domicilio_entrega", "Domicilio de entrega", "boolean"],
    ["activo", "Activo", "boolean"],
  ],
  unidades: [
    ["codigo", "Código"],
    ["nombre", "Nombre"],
    ["etiqueta_es", "Etiqueta en español"],
    ["etiqueta_en", "Etiqueta en inglés"],
    ["permite_fraccion", "Permite fracciones", "boolean"],
    ["activa", "Activa", "boolean"],
  ],
  productos: [
    ["codigo", "Código"],
    ["descripcion_mexico", "Descripción para recepción y facturas en México"],
    ["unidad_mexico_id", "UOM · México", "unidades"],
    ["descripcion_compra", "Descripción para órdenes de compra"],
    ["peso_unitario_kg", "KGS por unidad de compra", "number"],
    ["unidad_compra_id", "UOM · Compra", "unidades"],
    masterPriceColumns[0],
    ["factor_conversion", "Factor de unidad", "number"],
    ["precio_heq_kimix", "Precio VTA HEQ a KIMIX", "number"],
    ["factor_columna_115", "Columna «1.15» · valor por producto", "number"],
    ["precio_kimix_pha", "Precio VTA KIMIX a PHA", "number"],
    masterPriceColumns[1],
    [
      "descripcion_venta",
      "Descripción para Invoices de PHA Industrial Supplies",
    ],
    masterPriceColumns[2],
    ["unidad_venta_id", "UOM · Venta a HEQ", "unidades"],
    ["activo", "Activo", "boolean"],
  ],
  precios_compra: [
    ["proveedor_id", "Proveedor", "empresas"],
    ["producto_id", "Producto", "productos"],
    ["unidad_id", "Unidad", "unidades"],
    ["moneda", "Moneda (USD, MXN)"],
    ["precio", "Precio por unidad", "number"],
    ["vigente_desde", "Vigente desde (incluido)", "date"],
    ["vigente_hasta", "Vigente hasta (excluido)", "date"],
  ],
  precios_venta: [
    ["vendedor_id", "Empresa estadounidense", "empresas"],
    ["cliente_id", "Cliente mexicano", "empresas"],
    ["producto_id", "Producto", "productos"],
    ["unidad_id", "Unidad", "unidades"],
    ["moneda", "Moneda (USD, MXN)"],
    ["precio", "Precio por unidad", "number"],
    ["vigente_desde", "Vigente desde (incluido)", "date"],
    ["vigente_hasta", "Vigente hasta (excluido)", "date"],
  ],
};
function renderCatalogs() {
  shell(
    `<header><div><span class="eyebrow">INFORMACIÓN DEL NEGOCIO</span><h1>Catálogos</h1><p>Agrega y actualiza los datos que alimentan tus órdenes.</p></div><button id="addCatalog">＋ Agregar registro</button></header><section><p>Para una empresa nueva: agrega sus datos, asigna su función y registra su domicilio. Después puedes asignarle precios por producto.</p><div class="tabs">${tables.map((t) => `<button data-table="${t}" class="${catalogTable === t ? "selected" : ""}">${names[t]}</button>`).join("")}</div><input id="catalogSearch" placeholder="Buscar en este catálogo" aria-label="Buscar en catálogo"><div class="table-scroll" id="catalogRows"></div></section>`,
  );
  document.querySelectorAll("[data-table]").forEach(
    (b) =>
      (b.onclick = () => {
        catalogTable = b.dataset.table;
        renderCatalogs();
      }),
  );
  document.querySelector("#addCatalog").onclick = () => editCatalog({});
  document.querySelector("#catalogSearch").oninput = catalogRows;
  document
    .querySelector("#catalogRows")
    .classList.toggle("master-table", catalogTable === "productos");
  if (catalogTable === "productos")
    document
      .querySelector("#catalogSearch")
      .insertAdjacentHTML(
        "beforebegin",
        '<p class="hint">Se muestran todas las columnas del Master. Desliza la tabla hacia la derecha. AOCHEN y HUANTENG se editan en Precios de compra; la venta a HEQ, en Precios de venta. Los campos vacíos se pueden completar después.</p>',
      );
  catalogRows();
}
function catalogRows() {
  const search = document.querySelector("#catalogSearch").value.toLowerCase();
  const cols =
    catalogTable === "productos"
      ? definitions.productos
      : definitions[catalogTable].slice(0, 5);
  const rows = catalogs[catalogTable]
    .map((r, i) => ({
      r: catalogTable === "productos" ? masterProduct(r, catalogs, today()) : r,
      i,
    }))
    .filter(({ r }) =>
      cols
        .map(([k, , type]) =>
          tables.includes(type) ? label(type, r[k]) : r[k],
        )
        .join(" ")
        .toLowerCase()
        .includes(search),
    );
  document.querySelector("#catalogRows").innerHTML = `<table><thead><tr>${cols
    .map(([, t]) => `<th>${e(t)}</th>`)
    .join("")}<th></th></tr></thead><tbody>${rows
    .slice(0, 150)
    .map(
      ({ r, i }) =>
        `<tr>${cols
          .map(
            ([k, , type]) =>
              `<td>${e(tables.includes(type) ? label(type, r[k]) : typeof r[k] === "boolean" ? (r[k] ? "Sí" : "No") : r[k])}</td>`,
          )
          .join(
            "",
          )}<td><button class="quiet" data-edit="${i}">Editar</button></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table><p>${rows.length > 150 ? "Se muestran 150 coincidencias. Escribe una búsqueda más específica." : `${rows.length} registros`}</p>`;
  document
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          editCatalog(catalogs[catalogTable][Number(b.dataset.edit)])),
    );
}
function editCatalog(row) {
  if (catalogTable === "productos") row = masterProduct(row, catalogs, today());
  const cols = definitions[catalogTable];
  dialog.innerHTML = `<form id="catalogForm"><h2>${row.id || row.empresa_id ? "Editar" : "Agregar"} · ${names[catalogTable]}</h2><div class="grid">${cols
    .map(([k, t, type]) =>
      type === "boolean"
        ? `<label class="check"><input name="${k}" type="checkbox" ${(row[k] ?? ["activo", "activa"].includes(k)) ? "checked" : ""}>${e(t)}</label>`
        : tables.includes(type)
          ? `<label>${e(t)}<select name="${k}">${opts(
              catalogs[type].map((r) => ({
                ...r,
                razon_social: label(type, r.id),
              })),
              row[k],
            )}</select></label>`
          : type === "role"
            ? `<label>Función<select name="rol">${[
                ["proveedor", "Proveedor"],
                ["cliente_mexico", "Cliente mexicano"],
                ["empresa_usa", "Empresa estadounidense"],
              ]
                .map(
                  ([v, t]) =>
                    `<option value="${v}" ${row.rol === v ? "selected" : ""}>${t}</option>`,
                )
                .join("")}</select></label>`
            : type === "master_price"
              ? field(
                  k,
                  t + " · USD (editar en Precios)",
                  row[k] ?? "",
                  "number",
                  "readonly",
                )
              : field(
                  k,
                  t,
                  row[k] ?? "",
                  type || "text",
                  type === "number" ? 'step="any" min="0"' : "",
                ),
    )
    .join(
      "",
    )}</div><div class="actions"><button>Guardar</button><button type="button" id="cancel" class="quiet">Cancelar</button></div><p id="catalogError" role="alert"></p></form>`;
  dialog.showModal();
  document.querySelector("#cancel").onclick = () => dialog.close();
  document.querySelector("#catalogForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button");
    btn.disabled = true;
    try {
      const f = new FormData(ev.target);
      const values = Object.fromEntries(
        cols
          .filter(([, , type]) => type !== "master_price")
          .map(([k, , type]) => [
            k,
            type === "boolean" ? f.has(k) : f.get(k) || null,
          ]),
      );
      let q;
      if (row.id) q = db.from(catalogTable).update(values).eq("id", row.id);
      else if (catalogTable === "roles_empresa" && row.empresa_id)
        q = db
          .from(catalogTable)
          .update(values)
          .eq("empresa_id", row.empresa_id)
          .eq("rol", row.rol);
      else q = db.from(catalogTable).insert(values);
      await query(q.select());
      await refresh();
      dialog.close();
      renderCatalogs();
      notify(
        "Catálogo actualizado. Las versiones guardadas conservan sus datos anteriores.",
      );
    } catch (x) {
      document.querySelector("#catalogError").textContent = x.message;
    } finally {
      btn.disabled = false;
    }
  };
}
async function loadSession(s) {
  session = s;
  if (!s) {
    catalogs = {};
    orders = [];
    order = null;
    dirty = false;
    login();
    return;
  }
  const allowed = await query(db.rpc("acceso_permitido"));
  if (!allowed) {
    await db.auth.signOut();
    notify("Este correo no tiene acceso al sistema.");
    return;
  }
  await refresh();
  render();
}
db.auth.onAuthStateChange((event, s) => {
  if (
    event === "SIGNED_OUT" ||
    (event === "SIGNED_IN" && session?.user.id !== s?.user.id)
  )
    setTimeout(() => run(() => loadSession(s)), 0);
});
window.addEventListener("beforeunload", (ev) => {
  if (dirty) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});
run(async () => {
  const {
    data: { session: s },
    error,
  } = await db.auth.getSession();
  if (error) throw error;
  await loadSession(s);
});
