import "server-only";
import { PDFDocument, PageSizes } from "pdf-lib";
import { expandRange, type PagesPerSheet } from "../pricing";

export type ImpositionOptions = {
  pagesPerSheet?: PagesPerSheet; // 1, 2, 4, 6
  pageRange?: string | null;  // e.g. "1-5, 8, 11-13"
  copies?: number;         // 1 to 99
  orientation?: "portrait" | "landscape";
};

// Standard A4 dimensions in points (72 points/inch)
const A4_PORTRAIT: [number, number] = [PageSizes.A4[0], PageSizes.A4[1]]; // [595.28, 841.89]
const A4_LANDSCAPE: [number, number] = [PageSizes.A4[1], PageSizes.A4[0]]; // [841.89, 595.28]

const MARGIN = 18; // 0.25 inch printable margin

/**
 * Normalizes images (JPG, PNG) into a single-page A4 PDF.
 */
export async function convertImageToPdf(
  imageBytes: Uint8Array,
  kind: "jpg" | "png" | "jpeg"
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const image = kind === "png"
    ? await pdfDoc.embedPng(imageBytes)
    : await pdfDoc.embedJpg(imageBytes);

  const imgWidth = image.width;
  const imgHeight = image.height;

  // Choose portrait or landscape based on image aspect ratio
  const isLandscape = imgWidth > imgHeight;
  const [sheetW, sheetH] = isLandscape ? A4_LANDSCAPE : A4_PORTRAIT;

  const page = pdfDoc.addPage([sheetW, sheetH]);

  const maxW = sheetW - MARGIN * 2;
  const maxH = sheetH - MARGIN * 2;
  const scale = Math.min(maxW / imgWidth, maxH / imgHeight, 1.0);

  const drawW = imgWidth * scale;
  const drawH = imgHeight * scale;
  const x = MARGIN + (maxW - drawW) / 2;
  const y = MARGIN + (maxH - drawH) / 2;

  page.drawImage(image, { x, y, width: drawW, height: drawH });
  return await pdfDoc.save();
}

/**
 * Creates a normalized, print-ready PDF with:
 * - Page range filtering applied
 * - N-up imposition (1, 2, 4, 6 pages per sheet)
 * - Proportional scaling and margin alignment
 * - Preservation of reading order
 */
export async function imposeDocument(
  sourcePdfBytes: Uint8Array,
  options: ImpositionOptions = {}
): Promise<{ pdfBytes: Uint8Array; physicalSheetCount: number; logicalPageCount: number }> {
  const srcDoc = await PDFDocument.load(sourcePdfBytes, { ignoreEncryption: true });
  const totalSrcPages = srcDoc.getPageCount();

  if (totalSrcPages === 0) {
    throw new Error("Document contains 0 pages.");
  }

  // 1. Extract selected pages according to pageRange
  const selectedIndices: number[] = [];
  if (options.pageRange && options.pageRange.trim()) {
    const set = expandRange(options.pageRange, totalSrcPages);
    for (let i = 1; i <= totalSrcPages; i++) {
      if (set.has(i)) selectedIndices.push(i - 1);
    }
  } else {
    for (let i = 0; i < totalSrcPages; i++) selectedIndices.push(i);
  }

  if (selectedIndices.length === 0) {
    throw new Error("No pages selected from range.");
  }

  // 2. Handle copies
  const copies = Math.max(1, Math.min(99, options.copies ?? 1));
  const fullPageList: number[] = [];
  for (let c = 0; c < copies; c++) {
    for (const idx of selectedIndices) fullPageList.push(idx);
  }

  const pagesPerSheet = options.pagesPerSheet ?? 1;

  // Fast path for 1-up without imposition transformation
  if (pagesPerSheet === 1) {
    const outDoc = await PDFDocument.create();
    const copiedPages = await outDoc.copyPages(srcDoc, fullPageList);
    for (const page of copiedPages) {
      outDoc.addPage(page);
    }
    const pdfBytes = await outDoc.save();
    return {
      pdfBytes,
      physicalSheetCount: fullPageList.length,
      logicalPageCount: fullPageList.length,
    };
  }

  // 3. N-up imposition (2-up, 4-up, 6-up)
  const outDoc = await PDFDocument.create();
  const totalItems = fullPageList.length;

  if (pagesPerSheet === 2) {
    // 2-up: arranged side-by-side on Landscape A4
    const [sheetW, sheetH] = A4_LANDSCAPE;
    const colW = sheetW / 2;

    for (let i = 0; i < totalItems; i += 2) {
      const sheet = outDoc.addPage([sheetW, sheetH]);

      // Slot 1 (Left)
      const p1 = await outDoc.embedPage(srcDoc.getPage(fullPageList[i]));
      const maxW = colW - MARGIN * 1.5;
      const maxH = sheetH - MARGIN * 2;
      const scale1 = Math.min(maxW / p1.width, maxH / p1.height);
      const w1 = p1.width * scale1;
      const h1 = p1.height * scale1;
      sheet.drawPage(p1, {
        x: MARGIN + (maxW - w1) / 2,
        y: MARGIN + (maxH - h1) / 2,
        width: w1,
        height: h1,
      });

      // Slot 2 (Right)
      if (i + 1 < totalItems) {
        const p2 = await outDoc.embedPage(srcDoc.getPage(fullPageList[i + 1]));
        const scale2 = Math.min(maxW / p2.width, maxH / p2.height);
        const w2 = p2.width * scale2;
        const h2 = p2.height * scale2;
        sheet.drawPage(p2, {
          x: colW + MARGIN / 2 + (maxW - w2) / 2,
          y: MARGIN + (maxH - h2) / 2,
          width: w2,
          height: h2,
        });
      }
    }
  } else if (pagesPerSheet === 4) {
    // 4-up: 2x2 grid on Portrait A4
    const [sheetW, sheetH] = A4_PORTRAIT;
    const colW = sheetW / 2;
    const rowH = sheetH / 2;
    const maxW = colW - MARGIN * 1.5;
    const maxH = rowH - MARGIN * 1.5;

    for (let i = 0; i < totalItems; i += 4) {
      const sheet = outDoc.addPage([sheetW, sheetH]);

      const slots = [
        { x: MARGIN, y: rowH + MARGIN / 2 },              // Top-Left (Page 1)
        { x: colW + MARGIN / 2, y: rowH + MARGIN / 2 },   // Top-Right (Page 2)
        { x: MARGIN, y: MARGIN },                         // Bottom-Left (Page 3)
        { x: colW + MARGIN / 2, y: MARGIN },              // Bottom-Right (Page 4)
      ];

      for (let s = 0; s < 4; s++) {
        if (i + s < totalItems) {
          const p = await outDoc.embedPage(srcDoc.getPage(fullPageList[i + s]));
          const scale = Math.min(maxW / p.width, maxH / p.height);
          const w = p.width * scale;
          const h = p.height * scale;
          sheet.drawPage(p, {
            x: slots[s].x + (maxW - w) / 2,
            y: slots[s].y + (maxH - h) / 2,
            width: w,
            height: h,
          });
        }
      }
    }
  } else if (pagesPerSheet === 6) {
    // 6-up: 2 columns x 3 rows on Portrait A4
    const [sheetW, sheetH] = A4_PORTRAIT;
    const colW = sheetW / 2;
    const rowH = sheetH / 3;
    const maxW = colW - MARGIN * 1.5;
    const maxH = rowH - MARGIN * 1.2;

    for (let i = 0; i < totalItems; i += 6) {
      const sheet = outDoc.addPage([sheetW, sheetH]);

      const slots = [
        { x: MARGIN, y: rowH * 2 + MARGIN / 2 },          // Row 1, Col 1
        { x: colW + MARGIN / 2, y: rowH * 2 + MARGIN / 2 }, // Row 1, Col 2
        { x: MARGIN, y: rowH + MARGIN / 2 },              // Row 2, Col 1
        { x: colW + MARGIN / 2, y: rowH + MARGIN / 2 },   // Row 2, Col 2
        { x: MARGIN, y: MARGIN },                         // Row 3, Col 1
        { x: colW + MARGIN / 2, y: MARGIN },              // Row 3, Col 2
      ];

      for (let s = 0; s < 6; s++) {
        if (i + s < totalItems) {
          const p = await outDoc.embedPage(srcDoc.getPage(fullPageList[i + s]));
          const scale = Math.min(maxW / p.width, maxH / p.height);
          const w = p.width * scale;
          const h = p.height * scale;
          sheet.drawPage(p, {
            x: slots[s].x + (maxW - w) / 2,
            y: slots[s].y + (maxH - h) / 2,
            width: w,
            height: h,
          });
        }
      }
    }
  }

  const pdfBytes = await outDoc.save();
  return {
    pdfBytes,
    physicalSheetCount: outDoc.getPageCount(),
    logicalPageCount: totalItems,
  };
}

