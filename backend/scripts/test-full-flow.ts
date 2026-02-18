import { parseTemplatePlaceholders, stampSignature } from '../src/services/pdf.service';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

async function testFullFlow() {
  console.log('=== Full Signing Flow Test ===\n');

  const templatePath = './uploads/packets/5cdbe805-522e-476c-950a-fd101d19881b/9a89632d-0fef-450e-87b1-8807cd2556f0_b2c3cbdb-9ba1-48a1-9fa1-a168af0005ca_HHA-PCA-Evals-and-Post-Test-ADIL-JAA-117-23-5098.pdf';

  // Step 1: Parse placeholders
  console.log('Step 1: Parsing placeholders...');
  const placeholders = await parseTemplatePlaceholders(templatePath);
  console.log('Found', placeholders.length, 'placeholders\n');

  // Step 2: Stamp signature
  console.log('Step 2: Stamping signature...');
  const stamps = [{
    role: 'signer1',
    signatureData: {
      typedName: 'Jane Smith',
      signatureType: 'typed' as const,
      textFields: {
        'Int': 'JS',
        'Dte1': '02/17/2026',
        'Lic#': 'RN99999'
      }
    },
    timestamp: new Date()
  }];

  const signedPdfBytes = await stampSignature(templatePath, stamps, placeholders);
  console.log('Signed PDF size:', signedPdfBytes.length, 'bytes\n');

  // Step 3: Save
  const outputPath = '../test-output-fullflow.pdf';
  fs.writeFileSync(outputPath, signedPdfBytes);
  console.log('Saved to:', outputPath);

  // Step 4: Verify the PDF
  console.log('\n=== Verification ===');
  const pdfDoc = await PDFDocument.load(signedPdfBytes);
  console.log('✓ PDF can be loaded');
  console.log('Pages:', pdfDoc.getPageCount());

  // Check for expected values in decompressed streams
  const zlib = require('zlib');
  const rawContent = Buffer.from(signedPdfBytes).toString('latin1');
  const checks = [
    ['Jane Smith', 'Signature'],
    ['JS', 'Initials'],
    ['02/17/2026', 'Date'],
    ['RN99999', 'License']
  ];

  // Check in both raw content and decompressed streams
  for (const [value, label] of checks) {
    let found = false;

    // Check raw content
    if (rawContent.includes(value)) {
      found = true;
    }

    // Check decompressed streams
    const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
    let match;
    while ((match = streamRegex.exec(rawContent)) !== null) {
      try {
        const decompressed = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
        if (decompressed.includes(value)) {
          found = true;
          break;
        }
      } catch {
        // Not compressed
      }
    }

    if (found) {
      console.log(`✓ ${label} (${value}) found`);
    } else {
      console.log(`✗ ${label} (${value}) NOT found`);
    }
  }

  // Check for remaining tags
  let tagsFound = false;
  const tagPatterns = [/\{\{\*?[^}]+_es_:[^}]*\}\}/g];

  const streamRegex2 = /stream\r?\n([\s\S]*?)endstream/g;
  let match2;
  while ((match2 = streamRegex2.exec(rawContent)) !== null) {
    try {
      const decompressed = zlib.inflateSync(Buffer.from(match2[1], 'latin1')).toString('latin1');
      for (const pattern of tagPatterns) {
        if (pattern.test(decompressed)) {
          tagsFound = true;
          break;
        }
      }
    } catch {
      // Not compressed
    }
  }

  if (!tagsFound) {
    console.log('✓ No Adobe Sign tags remaining');
  } else {
    console.log('✗ Adobe Sign tags still present');
  }

  console.log('\n=== Test Complete ===');
  console.log('Please open test-output-fullflow.pdf to visually verify');
}

testFullFlow().catch(console.error);
