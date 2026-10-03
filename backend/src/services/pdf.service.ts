import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, pushGraphicsState, popGraphicsState } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../utils/config.js';

/**
 * Tag detection and stamping for Adobe Sign text tags ({{Sig_es_:signer1:signature}})
 * and the legacy custom tags ([[SIGNATURE:role]], [[DATE:role]], [[TEXT:field]]).
 *
 * Detection uses pdf.js text extraction, which resolves fonts (incl. CID/Identity-H
 * fonts with ToUnicode maps), the CTM, Form XObjects and text split across several
 * show-text operators. Stamping uses pdf-lib: each tag is covered with a white box
 * and the value (signature image, date, text) is drawn in its place.
 */

export type PlaceholderType = 'SIGNATURE' | 'DATE' | 'TEXT';
export type AutoFill = 'name' | 'email' | 'initials' | 'date';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placeholder {
  type: PlaceholderType;
  role: string;
  fieldName?: string;
  originalTag: string;
  pageNumber: number;
  /** Interactive field box, PDF user space, origin bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Exact area covered by the tag text (whited out when stamping). */
  tagBox?: Box;
  fontSize?: number;
  /** Fields the signer does not type: filled from signer identity / signing date. */
  autoFill?: AutoFill;
  required?: boolean;
  /** Page MediaBox [x0, y0, x1, y1] so the viewer can map coordinates. */
  pageView?: [number, number, number, number];
  /** Parser version; placeholders without it come from the old regex parser. */
  v?: number;
}

export const PLACEHOLDER_VERSION = 2;

const ADOBE_TAG_RE = /\{\{[^{}]{0,200}?_es_[^{}]{0,200}?\}\}/g;
const CUSTOM_TAG_RE = /\[\[\s*(SIGNATURE|DATE|TEXT)\s*:[^[\]]{1,120}\]\]/gi;

// ─── Tag parsing ────────────────────────────────────────────────────────────

interface ParsedTag {
  type: PlaceholderType;
  role: string;
  fieldName: string;
  autoFill?: AutoFill;
  required: boolean;
}

/**
 * Parse a tag string into type / role / field name.
 * Adobe grammar: {{[*][fieldName]_es_[:role][:fieldType][:modifiers...]}}
 */
export function parseTag(rawTag: string): ParsedTag | null {
  const tag = rawTag.replace(/\s+/g, '');

  const custom = tag.match(/^\[\[(SIGNATURE|DATE|TEXT):([^\]:]+)(?::([^\]]+))?\]\]$/i);
  if (custom) {
    const type = custom[1].toUpperCase() as PlaceholderType;
    const ident = custom[2];
    if (type === 'TEXT') {
      // [[TEXT:fieldName]] or [[TEXT:fieldName:role]]
      return { type, role: custom[3] || 'signer', fieldName: ident, required: false };
    }
    return {
      type,
      role: ident,
      fieldName: type === 'DATE' ? `Date_${ident}` : `Sig_${ident}`,
      autoFill: type === 'DATE' ? 'date' : undefined,
      required: type === 'SIGNATURE',
    };
  }

  const adobe = tag.match(/^\{\{(\*?)([^{}]*?)_es_(.*)\}\}$/);
  if (!adobe) return null;

  const required = adobe[1] === '*';
  const name = adobe[2];
  const segments = adobe[3].split(':').filter(Boolean);

  const typeKeywords: Record<string, { type: PlaceholderType; autoFill?: AutoFill }> = {
    signature: { type: 'SIGNATURE' },
    sig: { type: 'SIGNATURE' },
    initials: { type: 'TEXT', autoFill: 'initials' },
    init: { type: 'TEXT', autoFill: 'initials' },
    date: { type: 'DATE', autoFill: 'date' },
    fullname: { type: 'TEXT', autoFill: 'name' },
    signername: { type: 'TEXT', autoFill: 'name' },
    name: { type: 'TEXT', autoFill: 'name' },
    email: { type: 'TEXT', autoFill: 'email' },
    signeremail: { type: 'TEXT', autoFill: 'email' },
  };

  let role = '';
  let kind: { type: PlaceholderType; autoFill?: AutoFill } | undefined;

  for (const seg of segments) {
    const keyword = seg.toLowerCase().replace(/\(.*$/, '');
    if (typeKeywords[keyword]) {
      kind = kind || typeKeywords[keyword];
    } else if (!role && !seg.includes('(')) {
      role = seg;
    }
  }

  if (!kind) {
    if (/^sig/i.test(name)) kind = { type: 'SIGNATURE' };
    else if (/^(dte|date)/i.test(name)) kind = { type: 'DATE', autoFill: 'date' };
    else if (/^int/i.test(name)) kind = { type: 'TEXT', autoFill: 'initials' };
    else kind = { type: 'TEXT' };
  }

  const fieldName = name || (kind.type === 'SIGNATURE' ? 'Sig' : kind.type === 'DATE' ? 'Date' : 'Text');

  return {
    type: kind.type,
    role: role || 'signer1',
    fieldName,
    autoFill: kind.autoFill,
    required: required || kind.type === 'SIGNATURE',
  };
}

// ─── Role → recipient resolution ────────────────────────────────────────────

export interface RecipientLike {
  roleName: string;
  order: number;
}

/**
 * Decide which recipient owns a tag role. Returns the index into `recipients`, or -1.
 *  1. exact role name match ("employee" ↔ roleName "employee")
 *  2. Adobe positional roles: signer1 → 1st signer by order, signer2 → 2nd, "signer" → 1st
 *  3. a single recipient owns every tag
 */
export function resolveRecipientIndex(role: string, recipients: RecipientLike[]): number {
  if (recipients.length === 0) return -1;
  const r = role.trim().toLowerCase();

  const exact = recipients.findIndex(x => x.roleName.trim().toLowerCase() === r);
  if (exact !== -1) return exact;

  const sorted = recipients
    .map((x, i) => ({ order: x.order, i }))
    .sort((a, b) => a.order - b.order);

  const positional = r.match(/^signer(\d*)$/);
  if (positional) {
    const n = positional[1] ? parseInt(positional[1], 10) : 1;
    if (n >= 1 && n <= sorted.length) return sorted[n - 1].i;
  }
  if (r === 'any' || r === '') return sorted[0].i;

  if (recipients.length === 1) return 0;
  return -1;
}

export function placeholdersForRecipient<T extends RecipientLike>(
  placeholders: Placeholder[],
  recipient: T,
  allRecipients: T[]
): Placeholder[] {
  const idx = allRecipients.indexOf(recipient);
  return placeholders.filter(p => resolveRecipientIndex(p.role, allRecipients) === idx);
}

// ─── Text extraction (pdf.js) ───────────────────────────────────────────────

let pdfjsPromise: Promise<any> | null = null;
function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

let helvetica: PDFFont | null = null;
async function getMeasureFont(): Promise<PDFFont> {
  if (!helvetica) {
    const doc = await PDFDocument.create();
    helvetica = await doc.embedFont(StandardFonts.Helvetica);
  }
  return helvetica;
}

/** Fraction of an item's advance width taken by its first `k` characters. */
function prefixRatio(font: PDFFont, str: string, k: number): number {
  if (k <= 0) return 0;
  if (k >= str.length) return 1;
  try {
    const total = font.widthOfTextAtSize(str, 1);
    if (total > 0) return font.widthOfTextAtSize(str.slice(0, k), 1) / total;
  } catch {
    // Characters outside WinAnsi - fall back to character count
  }
  return k / str.length;
}

interface PageTag {
  tag: string;
  pageNumber: number;
  box: Box;
  fontSize: number;
}

async function extractTags(pdfBytes: Uint8Array | Buffer): Promise<{
  tags: PageTag[];
  views: Array<[number, number, number, number]>;
}> {
  const pdfjs = await loadPdfjs();
  const font = await getMeasureFont();

  // pdf.js may transfer/detach the buffer it is given - always pass a copy
  const data = new Uint8Array(pdfBytes.byteLength);
  data.set(pdfBytes);

  const doc = await pdfjs.getDocument({
    data,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const tags: PageTag[] = [];
  const views: Array<[number, number, number, number]> = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      views.push(page.view as [number, number, number, number]);
      const content = await page.getTextContent();
      const items: TextItem[] = content.items.filter((i: any) => typeof i.str === 'string');

      // Concatenate page text, remembering which item each character came from
      let text = '';
      const spans: Array<{ start: number; end: number; item: TextItem }> = [];
      for (const item of items) {
        spans.push({ start: text.length, end: text.length + item.str.length, item });
        text += item.str;
        if (item.hasEOL) text += '\n';
      }

      const matches: Array<{ index: number; tag: string }> = [];
      for (const re of [ADOBE_TAG_RE, CUSTOM_TAG_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) matches.push({ index: m.index, tag: m[0] });
      }

      for (const { index, tag } of matches) {
        const end = index + tag.length;
        const parts = spans.filter(s => s.end > index && s.start < end && s.item.str.length > 0);
        if (parts.length === 0) continue;

        const first = parts[0].item;
        const [a, b, c, d, e, f] = first.transform;
        const fontSize = first.height || Math.hypot(c, d) || 10;
        const scaleX = Math.hypot(a, b) || 1;
        const dirX = a / scaleX;
        const dirY = b / scaleX;

        const offsetIn = (span: { start: number; item: TextItem }, pos: number) =>
          span.item.width * prefixRatio(font, span.item.str, pos - span.start);

        // Start of the tag along the baseline of the first item
        const startAdvance = offsetIn(parts[0], index);
        const x0 = e + dirX * startAdvance;
        const y0 = f + dirY * startAdvance;

        // End of the tag: last part on the same baseline as the first
        let x1 = x0;
        for (const part of parts) {
          const [pa, pb, , , pe, pf] = part.item.transform;
          if (Math.abs(pf - f) > fontSize * 0.5 || Math.abs(pb) > 0.01 !== Math.abs(b) > 0.01) continue;
          const pScale = Math.hypot(pa, pb) || 1;
          const advance = offsetIn(part, Math.min(end, part.end));
          x1 = Math.max(x1, pe + (pa / pScale) * advance);
        }

        const width = Math.max(x1 - x0, fontSize);
        const descent = fontSize * 0.25;
        tags.push({
          tag: tag.replace(/\n/g, ''),
          pageNumber,
          box: { x: x0, y: y0 - descent, width, height: fontSize * 1.2 },
          fontSize,
        });
      }

      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return { tags, views };
}

/**
 * Parse a PDF and return a placeholder for every tag occurrence.
 */
export async function parseTemplatePlaceholdersFromBuffer(pdfBytes: Buffer | Uint8Array): Promise<Placeholder[]> {
  const { tags, views } = await extractTags(pdfBytes);
  const placeholders: Placeholder[] = [];

  for (const t of tags) {
    const parsed = parseTag(t.tag);
    if (!parsed) {
      console.log(`[PDF] Could not parse tag: ${t.tag.substring(0, 60)}`);
      continue;
    }

    const box = t.box;
    let width = box.width;
    let height = box.height;
    if (parsed.type === 'SIGNATURE') {
      width = Math.max(width, 110);
      height = Math.max(t.fontSize * 2.4, 26);
    } else {
      width = Math.max(width, parsed.type === 'DATE' ? 60 : 40);
      height = Math.max(height, 12);
    }

    placeholders.push({
      type: parsed.type,
      role: parsed.role,
      fieldName: parsed.fieldName,
      originalTag: t.tag,
      pageNumber: t.pageNumber,
      x: box.x,
      y: box.y,
      width,
      height,
      tagBox: box,
      fontSize: t.fontSize,
      autoFill: parsed.autoFill,
      required: parsed.required,
      pageView: views[t.pageNumber - 1],
      v: PLACEHOLDER_VERSION,
    });
  }

  console.log(`[PDF] Found ${placeholders.length} placeholders` +
    (placeholders.length ? `: ${summarize(placeholders)}` : ''));
  return placeholders;
}

function summarize(placeholders: Placeholder[]): string {
  const counts = new Map<string, number>();
  for (const p of placeholders) {
    const key = `${p.type}:${p.fieldName}@${p.role}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(', ');
}

/** Parse PDF file from path (convenience wrapper). */
export async function parseTemplatePlaceholders(pdfPath: string): Promise<Placeholder[]> {
  return parseTemplatePlaceholdersFromBuffer(await fs.readFile(pdfPath));
}

/** Unique roles referenced by placeholders. */
export function getUniqueRoles(placeholders: Placeholder[]): string[] {
  return Array.from(new Set(placeholders.map(p => p.role)));
}

// ─── Stamping ───────────────────────────────────────────────────────────────

export interface SignatureData {
  /** data:image/png;base64,... for drawn (and rendered typed) signatures; plain name otherwise */
  signatureImage?: string;
  typedName: string;
  signatureType: 'drawn' | 'typed';
  textFields?: Record<string, string>;
}

export interface StampConfig {
  role: string;
  order?: number;
  name?: string;
  email?: string;
  signatureData: SignatureData;
  timestamp: Date;
}

export function formatSigningDate(date: Date): string {
  try {
    return date.toLocaleDateString('en-US', {
      timeZone: config.TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    return date.toLocaleDateString('en-US');
  }
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase())
    .join('');
}

/** Value a signer supplies (or that is auto-filled) for a non-signature placeholder. */
export function valueForPlaceholder(p: Placeholder, stamp: StampConfig): string {
  const fields = stamp.signatureData.textFields || {};
  const name = stamp.signatureData.typedName || stamp.name || '';
  switch (p.autoFill) {
    case 'date': return formatSigningDate(stamp.timestamp);
    case 'name': return fields[p.fieldName || ''] || name;
    case 'email': return fields[p.fieldName || ''] || stamp.email || '';
    case 'initials': return fields[p.fieldName || ''] || initialsOf(name);
  }
  if (p.type === 'DATE') return formatSigningDate(stamp.timestamp);
  return fields[p.fieldName || ''] ?? '';
}

/** Replace characters the standard (WinAnsi) fonts cannot encode. */
function encodable(font: PDFFont, text: string): string {
  const clean = text.replace(/[\r\n\t]+/g, ' ');
  try {
    font.encodeText(clean);
    return clean;
  } catch {
    let out = '';
    for (const ch of clean.normalize('NFD').replace(/[̀-ͯ]/g, '')) {
      try {
        font.encodeText(ch);
        out += ch;
      } catch {
        out += '?';
      }
    }
    return out;
  }
}

function fitTextSize(font: PDFFont, text: string, maxWidth: number, preferred: number): number {
  let size = preferred;
  const w = font.widthOfTextAtSize(text, size);
  if (w > maxWidth && w > 0) size = Math.max(5, (size * maxWidth) / w);
  return size;
}

/** Protect our drawing from graphics state left behind by the page's own content. */
function isolatePageContent(pdfDoc: PDFDocument, page: PDFPage) {
  page.node.normalize();
  const start = pdfDoc.context.register(pdfDoc.context.contentStream([pushGraphicsState()]));
  const end = pdfDoc.context.register(pdfDoc.context.contentStream([popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
}

function decodeImage(dataUrl: string): { bytes: Buffer; kind: 'png' | 'jpg' } | null {
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!m) return null;
  return { bytes: Buffer.from(m[2], 'base64'), kind: m[1].toLowerCase() === 'png' ? 'png' : 'jpg' };
}

/**
 * Stamp all signer values onto the original PDF.
 *
 * Placeholders are re-detected from the original document so geometry is always
 * computed by the current parser; `_storedPlaceholders` is kept for API compatibility.
 */
export async function stampSignatureFromBuffer(
  originalPdfBytes: Buffer | Uint8Array,
  stamps: StampConfig[],
  _storedPlaceholders?: Placeholder[]
): Promise<Uint8Array> {
  const placeholders = await parseTemplatePlaceholdersFromBuffer(originalPdfBytes);

  const pdfDoc = await PDFDocument.load(originalPdfBytes, { updateMetadata: false });
  const textFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const scriptFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const recipientsLike: RecipientLike[] = stamps.map((s, i) => ({ roleName: s.role, order: s.order ?? i + 1 }));

  // Embed each signer's signature image once
  const images = new Map<number, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (let i = 0; i < stamps.length; i++) {
    const raw = stamps[i].signatureData.signatureImage;
    const img = raw ? decodeImage(raw) : null;
    if (!img) continue;
    try {
      images.set(i, img.kind === 'png' ? await pdfDoc.embedPng(img.bytes) : await pdfDoc.embedJpg(img.bytes));
    } catch (err) {
      console.error(`[PDF] Could not embed signature image for ${stamps[i].role}:`, err);
    }
  }

  const isolated = new Set<number>();
  const signaturePlaced = new Set<number>();
  const ink = rgb(0.05, 0.1, 0.45);

  for (const p of placeholders) {
    const pageIndex = p.pageNumber - 1;
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue;
    const page = pdfDoc.getPage(pageIndex);
    if (!isolated.has(pageIndex)) {
      isolatePageContent(pdfDoc, page);
      isolated.add(pageIndex);
    }

    // Remove the tag text
    const tb = p.tagBox || { x: p.x, y: p.y, width: p.width, height: p.height };
    page.drawRectangle({
      x: tb.x - 0.5, y: tb.y, width: tb.width + 1, height: tb.height,
      color: rgb(1, 1, 1), borderWidth: 0,
    });

    const owner = resolveRecipientIndex(p.role, recipientsLike);
    if (owner === -1) {
      console.warn(`[PDF] No signer for tag ${p.originalTag} (role "${p.role}") - tag removed, left blank`);
      continue;
    }
    const stamp = stamps[owner];
    const fontSize = p.fontSize || 10;

    if (p.type === 'SIGNATURE') {
      const image = images.get(owner);
      if (image) {
        const scale = Math.min(p.width / image.width, p.height / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawImage(image, { x: p.x, y: p.y, width: w, height: h });
      } else {
        const name = encodable(scriptFont, stamp.signatureData.typedName || stamp.name || '');
        const size = fitTextSize(scriptFont, name, p.width, Math.min(p.height * 0.7, Math.max(fontSize * 1.6, 14)));
        page.drawText(name, { x: p.x, y: p.y + p.height * 0.25, size, font: scriptFont, color: ink });
      }
      signaturePlaced.add(owner);
      continue;
    }

    const value = encodable(textFont, valueForPlaceholder(p, stamp));
    if (!value) continue;
    const size = fitTextSize(textFont, value, Math.max(p.width, tb.width), Math.min(fontSize, 12));
    const baseline = (p.tagBox ? p.tagBox.y : p.y) + fontSize * 0.25;
    page.drawText(value, { x: tb.x, y: baseline, size, font: textFont, color: rgb(0, 0, 0) });
  }

  // Any signer whose signature had no field gets it on a signature page
  const unplaced = stamps.map((s, i) => ({ s, i })).filter(({ i }) => !signaturePlaced.has(i));
  if (unplaced.length > 0) {
    await appendSignaturePage(pdfDoc, unplaced.map(({ s, i }) => ({ stamp: s, image: images.get(i) })), textFont, scriptFont);
  }

  return pdfDoc.save();
}

async function appendSignaturePage(
  pdfDoc: PDFDocument,
  entries: Array<{ stamp: StampConfig; image?: Awaited<ReturnType<PDFDocument['embedPng']>> }>,
  font: PDFFont,
  scriptFont: PDFFont
) {
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([612, 792]);
  let y = 730;
  page.drawText('Signatures', { x: 50, y, size: 18, font: bold });
  y -= 40;

  for (const { stamp, image } of entries) {
    if (y < 140) {
      page = pdfDoc.addPage([612, 792]);
      y = 730;
    }
    const name = encodable(font, stamp.signatureData.typedName || stamp.name || stamp.role);
    page.drawText(`${name}${stamp.email ? ` (${encodable(font, stamp.email)})` : ''}`, { x: 50, y, size: 11, font: bold });
    y -= 60;
    if (image) {
      const scale = Math.min(220 / image.width, 50 / image.height);
      page.drawImage(image, { x: 50, y, width: image.width * scale, height: image.height * scale });
    } else {
      page.drawText(encodable(scriptFont, name), { x: 50, y: y + 12, size: 24, font: scriptFont, color: rgb(0.05, 0.1, 0.45) });
    }
    page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: 300, y: y - 4 }, thickness: 0.75 });
    y -= 18;
    page.drawText(`Signed electronically on ${formatSigningDate(stamp.timestamp)} - role: ${encodable(font, stamp.role)}`, {
      x: 50, y, size: 9, font, color: rgb(0.3, 0.3, 0.3),
    });
    y -= 40;
  }
}

/** Stamp signatures from a file path (convenience wrapper). */
export async function stampSignature(
  pdfPath: string,
  stamps: StampConfig[],
  placeholders?: Placeholder[]
): Promise<Uint8Array> {
  return stampSignatureFromBuffer(await fs.readFile(pdfPath), stamps, placeholders);
}

/** Save stamped PDF to disk */
export async function saveStampedPdf(pdfBytes: Uint8Array, packetId: string): Promise<string> {
  const signedDir = path.join(process.cwd(), 'signed');
  await fs.mkdir(signedDir, { recursive: true });
  const filePath = path.join(signedDir, `signed_${packetId}_${Date.now()}.pdf`);
  await fs.writeFile(filePath, pdfBytes);
  return filePath;
}

/** Create a PDF with sample placeholders for demo purposes */
export async function createSampleTemplate(name: string, roles: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawText(name, { x: 50, y: 720, size: 24, font: boldFont });
  page.drawText('This document requires signatures from the following parties:', { x: 50, y: 680, size: 12, font });

  let yPos = 620;
  for (const role of roles) {
    page.drawText(`${role.charAt(0).toUpperCase() + role.slice(1)} Signature:`, { x: 50, y: yPos, size: 12, font: boldFont });
    page.drawText(`[[SIGNATURE:${role}]]`, { x: 50, y: yPos - 25, size: 10, font, color: rgb(0.6, 0.6, 0.6) });
    page.drawLine({ start: { x: 50, y: yPos - 40 }, end: { x: 250, y: yPos - 40 }, thickness: 1 });
    page.drawText('Date:', { x: 300, y: yPos - 25, size: 10, font });
    page.drawText(`[[DATE:${role}]]`, { x: 340, y: yPos - 25, size: 10, font, color: rgb(0.6, 0.6, 0.6) });
    yPos -= 100;
  }

  page.drawText('This is a sample document for demonstration purposes.', {
    x: 50, y: 50, size: 10, font, color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}
