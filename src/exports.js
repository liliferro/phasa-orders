import { buildPages, exportKinds, exportNames } from "./export-model.js";

const types = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};
const templates = new Map();
async function result(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function exportRevision(
  db,
  revisionId,
  format,
  kinds = exportKinds,
  status = () => {},
) {
  if (
    !types[format] ||
    !kinds.length ||
    kinds.some((k) => !exportKinds.includes(k))
  )
    throw Error("Selecciona documentos y un formato válido.");
  status("Preparando la versión guardada…");
  const revision = await result(
    db
      .from("revisiones_operacion")
      .select("id,datos,plantilla_id")
      .eq("id", revisionId)
      .single(),
  );
  if (!templates.has(revision.plantilla_id)) {
    const rows = await result(
      db
        .from("recursos_plantilla")
        .select("nombre,contenido")
        .eq("plantilla_id", revision.plantilla_id),
    );
    const resources = Object.fromEntries(
      rows.map((r) => [r.nombre, r.contenido]),
    );
    if (!resources["layout.json"])
      throw Error("No se encontró la plantilla de esta versión.");
    templates.set(revision.plantilla_id, {
      bundle: JSON.parse(resources["layout.json"]),
      resources,
    });
  }
  const { bundle, resources } = templates.get(revision.plantilla_id);
  const pages = buildPages(revision.datos, bundle, kinds);
  const id = crypto.randomUUID();
  const folio = String(revision.datos.operacion.folio)
    .replace(/[^\p{L}\p{N}_-]/gu, "-")
    .slice(0, 70);
  const name = `${kinds.length === 1 ? exportNames[kinds[0]] : "Flujo completo"}_${folio}_v${revision.datos.operacion.revision}.${format}`;
  const path = `${id}/${name}`;
  await result(
    db
      .from("exportaciones")
      .insert({
        id,
        revision_operacion_id: revisionId,
        formato: format,
        documentos: kinds,
        ruta_storage: path,
        nombre_archivo: name,
      }),
  );
  try {
    status(`Generando ${format.toUpperCase()} con el formato original…`);
    const { renderPdf, renderExcel, renderZip } =
      await import("./export-renderer.js");
    const bytes = await (format === "pdf"
      ? renderPdf(pages, resources)
      : format === "xlsx"
        ? renderExcel(pages)
        : renderZip(pages, resources));
    status("Guardando el archivo en el historial…");
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (n) => n.toString(16).padStart(2, "0"),
    ).join("");
    await result(
      db.storage
        .from("documentos")
        .upload(path, bytes, { contentType: types[format], upsert: false }),
    );
    await result(
      db.from("exportaciones").update({ estado: "listo", sha256 }).eq("id", id),
    );
    downloadBlob(new Blob([bytes], { type: types[format] }), name);
    return name;
  } catch (error) {
    await db
      .from("exportaciones")
      .update({
        estado: "error",
        error: String(error.message || error).slice(0, 1000),
      })
      .eq("id", id);
    throw error;
  }
}
export async function previousExports(db, revisionId) {
  return result(
    db
      .from("exportaciones")
      .select("id,nombre_archivo,ruta_storage,created_at")
      .eq("revision_operacion_id", revisionId)
      .eq("estado", "listo")
      .order("created_at", { ascending: false }),
  );
}
export async function downloadPrevious(db, item) {
  const blob = await result(
    db.storage.from("documentos").download(item.ruta_storage),
  );
  downloadBlob(blob, item.nombre_archivo);
}
