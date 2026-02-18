import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function testPdfOpen(pdfPath: string) {
  console.log(`\n=== Testing PDF: ${pdfPath} ===\n`);

  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    console.log('File size:', pdfBytes.length, 'bytes');

    const pdfDoc = await PDFDocument.load(pdfBytes);
    console.log('✓ PDF loaded successfully');
    console.log('Number of pages:', pdfDoc.getPageCount());

    const pages = pdfDoc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const { width, height } = pages[i].getSize();
      console.log(`  Page ${i + 1}: ${width.toFixed(0)} x ${height.toFixed(0)}`);
    }

    // Try to save it again to verify it's valid
    const savedBytes = await pdfDoc.save();
    console.log('✓ PDF can be saved again');
    console.log('Saved size:', savedBytes.length, 'bytes');

  } catch (err: any) {
    console.error('✗ Failed:', err.message);
    console.error(err.stack);
  }
}

const pdfPath = process.argv[2] || '../test-output-inplace.pdf';
testPdfOpen(pdfPath);
