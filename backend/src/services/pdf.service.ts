import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

export interface Placeholder {
  type: 'SIGNATURE' | 'DATE' | 'TEXT';
  role: string;
  fieldName?: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  pageIndex: number;
}

/**
 * Parse PDF and extract placeholder tags from text content.
 * Tags format: [[SIGNATURE:roleName]], [[DATE:roleName]], [[TEXT:fieldName]]
 */
export async function parseTemplatePlaceholders(pdfPath: string): Promise<Placeholder[]> {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const placeholders: Placeholder[] = [];

  // Pattern to match our custom tags
  const tagPattern = /\[\[(SIGNATURE|DATE|TEXT):([^\]]+)\]\]/g;

  const pages = pdfDoc.getPages();

  // Since pdf-lib doesn't provide text extraction with positions,
  // we'll do a simple text search. For a real implementation,
  // you'd use pdf-parse or pdfjs-dist for better text extraction.
  // Here we'll simulate by checking the raw PDF content.

  const pdfContent = pdfBytes.toString('latin1');
  let match;

  while ((match = tagPattern.exec(pdfContent)) !== null) {
    const [fullMatch, type, identifier] = match;
    const placeholder: Placeholder = {
      type: type as 'SIGNATURE' | 'DATE' | 'TEXT',
      role: type === 'TEXT' ? 'any' : identifier,
      fieldName: type === 'TEXT' ? identifier : undefined,
      pageNumber: 1, // Default to page 1 - in production would calculate actual position
      x: 100, // Default positions - in production would extract from PDF
      y: 500,
      width: type === 'SIGNATURE' ? 200 : type === 'DATE' ? 100 : 150,
      height: type === 'SIGNATURE' ? 50 : 25,
    };
    placeholders.push(placeholder);
  }

  // If no placeholders found via regex, try a more basic search
  if (placeholders.length === 0) {
    // Look for common patterns in binary content
    const textContent = pdfBytes.toString('utf8');
    const simplePattern = /\[\[(SIGNATURE|DATE|TEXT):(\w+)\]\]/g;

    while ((match = simplePattern.exec(textContent)) !== null) {
      const [, type, identifier] = match;
      placeholders.push({
        type: type as 'SIGNATURE' | 'DATE' | 'TEXT',
        role: type === 'TEXT' ? 'any' : identifier,
        fieldName: type === 'TEXT' ? identifier : undefined,
        pageNumber: 1,
        x: 100,
        y: 500 - (placeholders.length * 60),
        width: type === 'SIGNATURE' ? 200 : type === 'DATE' ? 100 : 150,
        height: type === 'SIGNATURE' ? 50 : 25,
      });
    }
  }

  return placeholders;
}

/**
 * Get unique roles from placeholders
 */
export function getUniqueRoles(placeholders: Placeholder[]): string[] {
  const roles = new Set<string>();
  for (const p of placeholders) {
    if (p.type !== 'TEXT') {
      roles.add(p.role);
    }
  }
  return Array.from(roles);
}

interface SignatureData {
  signatureImage?: string; // Base64 PNG
  typedName: string;
  signatureType: 'drawn' | 'typed';
  textFields?: Record<string, string>;
}

interface StampConfig {
  role: string;
  signatureData: SignatureData;
  timestamp: Date;
}

/**
 * Stamp signature onto PDF at placeholder locations
 */
export async function stampSignature(
  pdfPath: string,
  stamps: StampConfig[],
  placeholders: Placeholder[]
): Promise<Uint8Array> {
  const pdfBytes = await fs.readFile(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const stamp of stamps) {
    // Find placeholders for this role
    const rolePlaceholders = placeholders.filter(
      p => p.role === stamp.role || (p.type === 'TEXT' && stamp.signatureData.textFields?.[p.fieldName!])
    );

    for (const placeholder of rolePlaceholders) {
      const pageIndex = placeholder.pageNumber - 1;
      if (pageIndex >= pages.length) continue;

      const page = pages[pageIndex];
      const pageHeight = page.getHeight();

      if (placeholder.type === 'SIGNATURE') {
        // Draw signature
        if (stamp.signatureData.signatureType === 'drawn' && stamp.signatureData.signatureImage) {
          try {
            // Remove data URL prefix if present
            const base64Data = stamp.signatureData.signatureImage.replace(/^data:image\/\w+;base64,/, '');
            const signatureBytes = Buffer.from(base64Data, 'base64');
            const signatureImage = await pdfDoc.embedPng(signatureBytes);

            const { width, height } = signatureImage.scale(0.5);
            const scaledWidth = Math.min(width, placeholder.width);
            const scaledHeight = (scaledWidth / width) * height;

            page.drawImage(signatureImage, {
              x: placeholder.x,
              y: pageHeight - placeholder.y - scaledHeight,
              width: scaledWidth,
              height: scaledHeight,
            });
          } catch (err) {
            console.error('Failed to embed signature image:', err);
            // Fallback to typed name
            page.drawText(stamp.signatureData.typedName, {
              x: placeholder.x,
              y: pageHeight - placeholder.y,
              size: 14,
              font: boldFont,
              color: rgb(0, 0, 0.5),
            });
          }
        } else {
          // Typed signature - use stylized text
          page.drawText(stamp.signatureData.typedName, {
            x: placeholder.x,
            y: pageHeight - placeholder.y,
            size: 16,
            font: boldFont,
            color: rgb(0, 0, 0.5),
          });
        }

        // Add typed name below signature
        page.drawText(`Signed by: ${stamp.signatureData.typedName}`, {
          x: placeholder.x,
          y: pageHeight - placeholder.y - placeholder.height - 15,
          size: 10,
          font: font,
          color: rgb(0.3, 0.3, 0.3),
        });
      } else if (placeholder.type === 'DATE') {
        // Draw date
        const dateStr = stamp.timestamp.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        page.drawText(dateStr, {
          x: placeholder.x,
          y: pageHeight - placeholder.y,
          size: 11,
          font: font,
          color: rgb(0, 0, 0),
        });
      } else if (placeholder.type === 'TEXT' && placeholder.fieldName) {
        // Draw text field value
        const value = stamp.signatureData.textFields?.[placeholder.fieldName] || '';
        page.drawText(value, {
          x: placeholder.x,
          y: pageHeight - placeholder.y,
          size: 11,
          font: font,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  // Add timestamp footer on last page
  const lastPage = pages[pages.length - 1];
  const timestamp = new Date().toISOString();
  lastPage.drawText(`Document completed: ${timestamp}`, {
    x: 50,
    y: 30,
    size: 8,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}

/**
 * Save stamped PDF to disk
 */
export async function saveStampedPdf(
  pdfBytes: Uint8Array,
  packetId: string
): Promise<string> {
  const fileName = `signed_${packetId}_${Date.now()}.pdf`;
  const filePath = path.join(process.cwd(), 'signed', fileName);
  await fs.writeFile(filePath, pdfBytes);
  return filePath;
}

/**
 * Create a PDF with sample placeholders for demo purposes
 */
export async function createSampleTemplate(name: string, roles: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Title
  page.drawText(name, {
    x: 50,
    y: 720,
    size: 24,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  // Document content
  page.drawText('This document requires signatures from the following parties:', {
    x: 50,
    y: 680,
    size: 12,
    font: font,
    color: rgb(0, 0, 0),
  });

  let yPos = 620;

  for (const role of roles) {
    // Role section
    page.drawText(`${role.charAt(0).toUpperCase() + role.slice(1)} Signature:`, {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    // Signature placeholder
    page.drawText(`[[SIGNATURE:${role}]]`, {
      x: 50,
      y: yPos - 25,
      size: 10,
      font: font,
      color: rgb(0.6, 0.6, 0.6),
    });

    // Draw signature line
    page.drawLine({
      start: { x: 50, y: yPos - 40 },
      end: { x: 250, y: yPos - 40 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });

    // Date placeholder
    page.drawText('Date:', {
      x: 300,
      y: yPos - 25,
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });

    page.drawText(`[[DATE:${role}]]`, {
      x: 340,
      y: yPos - 25,
      size: 10,
      font: font,
      color: rgb(0.6, 0.6, 0.6),
    });

    yPos -= 100;
  }

  // Footer
  page.drawText('This is a sample document for demonstration purposes.', {
    x: 50,
    y: 50,
    size: 10,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}
