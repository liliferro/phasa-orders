import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import ExcelJS from "exceljs";
import JSZip from "jszip";
export const decodeBase64 = (s) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (s) => {
  s = s || "000000";
  return rgb(
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  );
};
const geometry = (p) => ({
  widths: p.widths.map((w) => (w * 7 + 5) * 0.75),
  heights: p.heights,
});
const sum = (a) => a.reduce((x, y) => x + y, 0);
function imageBox(image, widths, heights) {
  const a = image.position,
    x = sum(widths.slice(0, a.col)) + a.colOff,
    y = sum(heights.slice(0, a.row)) + a.rowOff;
  return {
    x,
    y,
    width: a.width ?? sum(widths.slice(0, a.toCol)) + a.toColOff - x,
    height: a.height ?? sum(heights.slice(0, a.toRow)) + a.toRowOff - y,
  };
}
function printable(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (cell.numFmt.includes("mmm"))
      return `${v.getUTCDate()}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][v.getUTCMonth()]}-${String(v.getUTCFullYear()).slice(-2)}`;
    return `${v.getUTCMonth() + 1}/${v.getUTCDate()}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "number") {
    const fmt = cell.numFmt || "";
    const decimals = fmt.includes(".")
      ? Math.min(
          6,
          ((fmt.split(".")[1] || "").match(/^[0#]+/) || [""])[0].length,
        )
      : 0;
    return (
      (fmt.includes("$") ? "$ " : "") +
      v.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    );
  }
  return String(v);
}
function wrapText(text, font, size, width) {
  const result = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? line + " " + word : word;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        result.push(line);
        line = word;
      } else line = next;
    }
    result.push(line);
  }
  return result;
}
export async function renderPdf(pages, resources) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setCreator("PHASA Orders");
  const fonts = new Map();
  const fontFor = async (c) => {
    const file = c.font.file;
    if (!fonts.has(file)) {
      const source = resources[file];
      fonts.set(
        file,
        source
          ? await pdf.embedFont(
              typeof source === "string" ? decodeBase64(source) : source,
              { subset: false },
            )
          : await pdf.embedFont(
              c.font.bold
                ? StandardFonts.HelveticaBold
                : StandardFonts.Helvetica,
            ),
      );
    }
    return fonts.get(file);
  };
  for (const p of pages) {
    const pg = pdf.addPage([612, 792]);
    const { widths, heights } = geometry(p);
    const totalW = sum(widths),
      totalH = sum(heights),
      scale = Math.min(564 / totalW, 708 / totalH);
    const left = (612 - totalW * scale) / 2,
      top = 24;
    const xs = [0],
      ys = [0];
    widths.forEach((w) => xs.push(xs.at(-1) + w));
    heights.forEach((h) => ys.push(ys.at(-1) + h));
    const rect = (r, c, r2 = r, c2 = c) => ({
      x: left + xs[c - 1] * scale,
      y: top + ys[r - 1] * scale,
      w: (xs[c2] - xs[c - 1]) * scale,
      h: (ys[r2] - ys[r - 1]) * scale,
    });
    for (const c of p.cells) {
      const merged = p.merges.find(
        (m) => c.r >= m[0] && c.r <= m[2] && c.c >= m[1] && c.c <= m[3],
      );
      if (merged && (c.r !== merged[0] || c.c !== merged[1])) continue;
      const b = merged
        ? rect(merged[0], merged[1], merged[2], merged[3])
        : rect(c.r, c.c);
      if (c.fill)
        pg.drawRectangle({
          x: b.x,
          y: 792 - b.y - b.h,
          width: b.w,
          height: b.h,
          color: hex(c.fill),
        });
      for (const [side, border] of Object.entries(c.border)) {
        const line = {
          left: [
            [b.x, b.y],
            [b.x, b.y + b.h],
          ],
          right: [
            [b.x + b.w, b.y],
            [b.x + b.w, b.y + b.h],
          ],
          top: [
            [b.x, b.y],
            [b.x + b.w, b.y],
          ],
          bottom: [
            [b.x, b.y + b.h],
            [b.x + b.w, b.y + b.h],
          ],
        }[side];
        pg.drawLine({
          start: { x: line[0][0], y: 792 - line[0][1] },
          end: { x: line[1][0], y: 792 - line[1][1] },
          thickness:
            ({ hair: 0.25, thin: 0.5, medium: 1, thick: 1.5, double: 1.2 }[
              border.style
            ] || 0.5) * scale,
          color: hex(border.color),
        });
      }
    }
    for (const c of p.cells) {
      const text = printable(c);
      if (!text) continue;
      const merged = p.merges.find(
        (m) => c.r >= m[0] && c.r <= m[2] && c.c >= m[1] && c.c <= m[3],
      );
      if (merged && (c.r !== merged[0] || c.c !== merged[1])) continue;
      let b = merged
        ? rect(...[merged[0], merged[1], merged[2], merged[3]])
        : rect(c.r, c.c);
      if (
        !merged &&
        !c.align.wrap &&
        !c.border.right &&
        typeof c.value === "string" &&
        (!c.align.horizontal || c.align.horizontal === "left")
      ) {
        let end = c.c;
        while (end < p.cols) {
          const next = p.cells.find((x) => x.r === c.r && x.c === end + 1);
          if (
            next?.value !== null &&
            next?.value !== undefined &&
            next?.value !== ""
          )
            break;
          end++;
          if (next?.border.right) break;
        }
        if (end > c.c) b = rect(c.r, c.c, c.r, end);
      }
      const font = await fontFor(c);
      let size = c.font.size * scale;
      const pad = 1.5 * scale,
        maxW = b.w - pad * 2,
        maxH = b.h - pad * 2;
      let lines;
      for (let attempt = 0; attempt < 70; attempt++) {
        lines =
          c.align.wrap || text.includes("\n")
            ? wrapText(text, font, size, maxW)
            : [text];
        if (
          lines.every(
            (line) => font.widthOfTextAtSize(line, size) <= maxW + 0.05,
          ) &&
          lines.length * size * 1.08 <= maxH + 0.1
        )
          break;
        size *= 0.95;
      }
      if (size < 3)
        throw Error(
          `El texto en ${p.name}, fila ${c.r}, es demasiado largo para el formato. Acorta ese campo antes de exportar.`,
        );
      const blockH = lines.length * size * 1.08;
      const v = c.align.vertical;
      let offset =
        v === "center"
          ? (b.h - blockH) / 2
          : v === "top"
            ? pad
            : b.h - blockH - pad;
      offset = Math.max(pad, offset);
      lines.forEach((line, i) => {
        const tw = font.widthOfTextAtSize(line, size);
        const align =
          c.align.horizontal ||
          (typeof c.value === "number" ? "right" : "left");
        const x =
          align === "center"
            ? b.x + (b.w - tw) / 2
            : align === "right"
              ? b.x + b.w - pad - tw
              : b.x + pad;
        pg.drawText(line, {
          x,
          y: 792 - b.y - offset - size * 0.88 - i * size * 1.08,
          size,
          font,
          color: hex(c.font.color),
        });
      });
    }
    for (const image of p.images) {
      const box = imageBox(image, widths, heights);
      if (box.x + box.width > totalW) {
        const ratio = (totalW - box.x) / box.width;
        box.width *= ratio;
        box.height *= ratio;
      }
      const embedded = await pdf.embedPng(decodeBase64(image.base64));
      pg.drawImage(embedded, {
        x: left + box.x * scale,
        y: 792 - top - (box.y + box.height) * scale,
        width: box.width * scale,
        height: box.height * scale,
      });
    }
    const footer = await pdf.embedFont(StandardFonts.Helvetica);
    let note =
      p.pageCount > 1
        ? `${p.name} - ${p.folio} - Pagina ${p.pageIndex + 1} de ${p.pageCount} | Total documento: ${p.grandTotal.toFixed(2)} ${p.currency}`
        : "";
    if (p.notes) note += (note ? " | " : "") + p.notes;
    const noteLines = wrapText(note, footer, 7, 560);
    if (noteLines.length > 4)
      throw Error(
        "Las observaciones son demasiado largas para el pie de página.",
      );
    noteLines.forEach((text, i) =>
      pg.drawText(text, { x: 26, y: 46 - i * 9, size: 7, font: footer }),
    );
  }
  return pdf.save();
}
export async function renderExcel(pages) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PHASA Orders";
  wb.calcProperties.fullCalcOnLoad = true;
  for (const kind of [...new Set(pages.map((p) => p.kind))]) {
    const group = pages.filter((p) => p.kind === kind);
    const first = group[0];
    const ws = wb.addWorksheet(first.name, {
      pageSetup: {
        paperSize: 1,
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.25,
          bottom: 0.4,
          header: 0.1,
          footer: 0.15,
        },
      },
      views: [{ showGridLines: false }],
    });
    first.widths.forEach((width, i) => (ws.getColumn(i + 1).width = width));
    let offset = 0;
    for (const p of group) {
      const pageOffset = offset;
      p.heights.forEach(
        (height, i) => (ws.getRow(pageOffset + i + 1).height = height),
      );
      for (const c of p.cells) {
        const x = ws.getCell(c.r + pageOffset, c.c);
        let value = c.value;
        let formula = c.formula;
        if (formula && pageOffset)
          formula = formula.replace(
            /([A-Z]+)(\d+)/g,
            (_, col, row) => col + (Number(row) + pageOffset),
          );
        x.value = formula ? { formula, result: value } : value;
        x.font = {
          name: c.font.name,
          size: c.font.size,
          bold: c.font.bold,
          italic: c.font.italic,
          color: { argb: "FF" + c.font.color },
        };
        if (c.fill)
          x.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF" + c.fill },
          };
        x.border = Object.fromEntries(
          Object.entries(c.border).map(([key, b]) => [
            key,
            { style: b.style, color: { argb: "FF" + b.color } },
          ]),
        );
        x.alignment = {
          horizontal: c.align.horizontal || undefined,
          vertical:
            c.align.vertical === "center"
              ? "middle"
              : c.align.vertical || "bottom",
          wrapText: c.align.wrap,
          shrinkToFit: !c.align.wrap,
        };
        x.numFmt = c.numFmt;
      }
      for (const [r, c, r2, c2] of p.merges)
        ws.mergeCells(r + pageOffset, c, r2 + pageOffset, c2);
      const { widths, heights } = geometry(p);
      for (const im of p.images) {
        const box = imageBox(im, widths, heights);
        if (box.x + box.width > sum(widths)) {
          const ratio = (sum(widths) - box.x) / box.width;
          box.width *= ratio;
          box.height *= ratio;
        }
        const id = wb.addImage({
          base64: "data:image/png;base64," + im.base64,
          extension: "png",
        });
        ws.addImage(id, {
          tl: { col: im.position.col, row: im.position.row + pageOffset },
          ext: { width: box.width / 0.75, height: box.height / 0.75 },
          editAs: "absolute",
        });
      }
      const footerRow = pageOffset + p.endRow + 1;
      if (p.notes || p.pageCount > 1) {
        ws.mergeCells(footerRow, 1, footerRow, p.cols);
        ws.getCell(footerRow, 1).value = [
          p.notes,
          p.pageCount > 1
            ? `Página ${p.pageIndex + 1} de ${p.pageCount}. Total documento: ${p.grandTotal.toFixed(2)} ${p.currency}`
            : "",
        ]
          .filter(Boolean)
          .join(" | ");
        ws.getCell(footerRow, 1).alignment = { wrapText: true };
        ws.getRow(footerRow).height = 26;
      }
      offset = footerRow + 1;
      if (p.pageIndex < p.pageCount - 1) ws.getRow(offset).addPageBreak();
    }
    ws.pageSetup.printArea = `A1:${ws.getColumn(first.cols).letter}${offset - 1}`;
    ws.headerFooter.oddFooter = "&R&P / &N";
  }
  // ExcelJS emits editAs on oneCellAnchor, but OOXML permits it only on
  // twoCellAnchor. Remove it so strict spreadsheet readers retain the logos.
  const archive = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  for (const file of Object.values(archive.files)) {
    if (/^xl\/drawings\/drawing\d+\.xml$/.test(file.name)) {
      const xml = await file.async("string");
      archive.file(
        file.name,
        xml.replace(/(<xdr:oneCellAnchor) editAs="[^"]*"/g, "$1"),
      );
    }
  }
  return archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
export async function renderZip(pages, resources) {
  const zip = new JSZip();
  for (const kind of [...new Set(pages.map((p) => p.kind))]) {
    const selected = pages.filter((p) => p.kind === kind);
    zip.file(selected[0].name + ".pdf", await renderPdf(selected, resources));
  }
  return zip.generateAsync({ type: "uint8array" });
}
