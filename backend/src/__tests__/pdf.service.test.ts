import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  parseTag,
  parseTemplatePlaceholdersFromBuffer,
  placeholdersForRecipient,
  resolveRecipientIndex,
  stampSignatureFromBuffer,
  formatSigningDate,
  StampConfig,
} from '../services/pdf.service.js';

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function makePdf(lines: Array<{ text: string; x: number; y: number; size?: number }>, pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    for (const l of lines) page.drawText(l.text, { x: l.x, y: l.y, size: l.size || 11, font });
  }
  return Buffer.from(await doc.save());
}

/** Same document, but every page's content wrapped in a Form XObject (as JotForm / merged PDFs do). */
async function wrapInXObjects(bytes: Buffer, dx = 20, dy = -10, scale = 0.9) {
  const src = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  for (const e of await out.embedPages(src.getPages())) {
    out.addPage([612, 792]).drawPage(e, { x: dx, y: dy, xScale: scale, yScale: scale });
  }
  return Buffer.from(await out.save());
}

function stamp(role: string, order: number, extra: Partial<StampConfig['signatureData']> = {}): StampConfig {
  return {
    role, order, name: `Person ${order}`, email: `p${order}@example.com`,
    timestamp: new Date('2026-03-01T15:00:00Z'),
    signatureData: { signatureImage: PNG, typedName: `Person ${order}`, signatureType: 'drawn', ...extra },
  };
}

describe('parseTag', () => {
  it('parses Adobe signature, date, initials and text tags', () => {
    expect(parseTag('{{Sig_es_:signer1:signature}}')).toMatchObject({ type: 'SIGNATURE', role: 'signer1' });
    expect(parseTag('{{Dte1_es_:signer2:date}}')).toMatchObject({ type: 'DATE', role: 'signer2', fieldName: 'Dte1', autoFill: 'date' });
    expect(parseTag('{{Int_es_:signer1:initials}}')).toMatchObject({ type: 'TEXT', autoFill: 'initials' });
    expect(parseTag('{{*Lic#_es_:signer1}}')).toMatchObject({ type: 'TEXT', fieldName: 'Lic#', required: true });
    expect(parseTag('{{N_es_:signer1:fullname}}')).toMatchObject({ type: 'TEXT', autoFill: 'name' });
  });

  it('handles modifiers, missing names and missing roles', () => {
    expect(parseTag('{{Sig_es_:signer1:signature:dimension(width=60mm)}}')).toMatchObject({ type: 'SIGNATURE', role: 'signer1' });
    expect(parseTag('{{_es_:signer2:signature}}')).toMatchObject({ type: 'SIGNATURE', role: 'signer2' });
    expect(parseTag('{{*Dte1_es_:date}}')).toMatchObject({ type: 'DATE', role: 'signer1' });
    expect(parseTag('{{Sig _es_ :signer1: signature}}')).toMatchObject({ type: 'SIGNATURE' });
  });

  it('parses custom [[...]] tags', () => {
    expect(parseTag('[[SIGNATURE:manager]]')).toMatchObject({ type: 'SIGNATURE', role: 'manager' });
    expect(parseTag('[[DATE:manager]]')).toMatchObject({ type: 'DATE', role: 'manager', autoFill: 'date' });
    expect(parseTag('[[TEXT:comment]]')).toMatchObject({ type: 'TEXT', fieldName: 'comment' });
  });
});

describe('resolveRecipientIndex', () => {
  const two = [{ roleName: 'employee', order: 1 }, { roleName: 'manager', order: 2 }];

  it('matches role names exactly, then Adobe positional roles', () => {
    expect(resolveRecipientIndex('manager', two)).toBe(1);
    expect(resolveRecipientIndex('signer1', two)).toBe(0);
    expect(resolveRecipientIndex('signer2', two)).toBe(1);
    expect(resolveRecipientIndex('signer', two)).toBe(0);
    expect(resolveRecipientIndex('signer3', two)).toBe(-1);
  });

  it('gives every tag to a single recipient regardless of role name', () => {
    expect(resolveRecipientIndex('signer2', [{ roleName: 'countersigner', order: 1 }])).toBe(0);
  });

  it('does not let one signer see another signer\'s fields', async () => {
    const pdf = await makePdf([
      { text: '{{Sig_es_:signer1:signature}}', x: 50, y: 700 },
      { text: '{{Dte_es_:signer1:date}}', x: 300, y: 700 },
      { text: '{{Sig2_es_:signer2:signature}}', x: 50, y: 600 },
    ]);
    const all = await parseTemplatePlaceholdersFromBuffer(pdf);
    const recips = [{ roleName: 'employee', order: 1 }, { roleName: 'supervisor', order: 2 }];
    expect(placeholdersForRecipient(all, recips[0], recips).map(p => p.fieldName)).toEqual(['Sig', 'Dte']);
    expect(placeholdersForRecipient(all, recips[1], recips).map(p => p.fieldName)).toEqual(['Sig2']);
  });
});

describe('parseTemplatePlaceholdersFromBuffer', () => {
  it('finds every tag with the position of the tag itself (not the line start)', async () => {
    const pdf = await makePdf([
      { text: 'Employee Name: {{TitleA_es_:signer1}}', x: 50, y: 700 },
      { text: 'Date: {{DateA_es_:signer1:date}}', x: 50, y: 640 },
      { text: 'Signature: {{Sig_es_:signer1:signature}}', x: 50, y: 600 },
    ]);
    const ph = await parseTemplatePlaceholdersFromBuffer(pdf);
    expect(ph.map(p => p.type)).toEqual(['TEXT', 'DATE', 'SIGNATURE']);

    const [text, date, sig] = ph;
    expect(text.fieldName).toBe('TitleA');
    // "Employee Name: " in 11pt Helvetica is ~81pt wide
    expect(text.tagBox!.x).toBeGreaterThan(120);
    expect(text.tagBox!.x).toBeLessThan(140);
    expect(text.tagBox!.y).toBeCloseTo(700 - 11 * 0.25, 0);
    expect(date.tagBox!.y).toBeCloseTo(640 - 11 * 0.25, 0);
    expect(sig.tagBox!.y).toBeCloseTo(600 - 11 * 0.25, 0);
    expect(sig.height).toBeGreaterThan(20);
  });

  it('finds repeated tags on every page', async () => {
    const pdf = await makePdf([{ text: 'Initials: {{Int_es_:signer1:initials}}', x: 50, y: 100 }], 3);
    const ph = await parseTemplatePlaceholdersFromBuffer(pdf);
    expect(ph.map(p => p.pageNumber)).toEqual([1, 2, 3]);
  });

  it('applies Form XObject placement and scaling', async () => {
    const plain = await makePdf([{ text: '{{Sig_es_:signer1:signature}}', x: 100, y: 500 }]);
    const [p] = await parseTemplatePlaceholdersFromBuffer(await wrapInXObjects(plain, 20, -10, 0.9));
    expect(p.tagBox!.x).toBeCloseTo(20 + 100 * 0.9, 0);
    expect(p.tagBox!.y + 0.25 * p.fontSize!).toBeCloseTo(-10 + 500 * 0.9, 0);
    expect(p.fontSize).toBeCloseTo(11 * 0.9, 1);
  });

  it('returns no placeholders for a PDF without tags', async () => {
    expect(await parseTemplatePlaceholdersFromBuffer(await makePdf([{ text: 'Hello', x: 50, y: 50 }]))).toEqual([]);
  });
});

describe('stampSignatureFromBuffer', () => {
  it('produces a valid PDF and adds no extra page when every signature has a field', async () => {
    const pdf = await makePdf([
      { text: 'Signature: {{Sig_es_:signer1:signature}}', x: 50, y: 600 },
      { text: 'Date: {{Dte_es_:signer1:date}}  Lic: {{Lic_es_:signer1}}', x: 50, y: 560 },
    ]);
    const out = await stampSignatureFromBuffer(pdf, [stamp('countersigner', 1, { textFields: { Lic: 'RN-1' } })]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
  });

  it('appends a signature page for signers that had no signature field', async () => {
    const pdf = await makePdf([{ text: 'No tags here', x: 50, y: 600 }]);
    const out = await stampSignatureFromBuffer(pdf, [stamp('employee', 1), stamp('manager', 2, { signatureImage: 'Typed Name', signatureType: 'typed' })]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('survives names the standard fonts cannot encode', async () => {
    const pdf = await makePdf([{ text: '{{Sig_es_:signer1:signature}} {{N_es_:signer1:fullname}}', x: 50, y: 600 }]);
    const out = await stampSignatureFromBuffer(pdf, [
      stamp('signer1', 1, { signatureImage: undefined, signatureType: 'typed', typedName: 'Nguyễn Văn 李' }),
    ]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe('formatSigningDate', () => {
  it('uses the configured business timezone, not UTC', () => {
    // 01:30 UTC on Mar 2 is still Mar 1 in New York
    expect(formatSigningDate(new Date('2026-03-02T01:30:00Z'))).toBe('03/01/2026');
  });
});
