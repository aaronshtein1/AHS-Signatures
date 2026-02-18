/**
 * Test script for PDF parsing and signing
 * Run with: node scripts/test-pdf-signing.js [path-to-pdf]
 */
const path = require('path');

// Use dynamic import for ES modules
async function main() {
  const { parseTemplatePlaceholders, stampSignature, saveStampedPdf } = await import('../dist/services/pdf.service.js');

  const pdfPath = process.argv[2] || 'uploads/templates/f6c44627-726d-4b14-941e-2cc2c6462bbb_sign_document_0a87764e2b65bec9_withoutAudit_6968fc1ae500d5.51481649.pdf';

  console.log('===========================================');
  console.log('PDF Signing Test');
  console.log('===========================================');
  console.log('Input PDF:', pdfPath);
  console.log('');

  // Step 1: Parse placeholders
  console.log('Step 1: Parsing placeholders...');
  const placeholders = await parseTemplatePlaceholders(pdfPath);

  console.log('');
  console.log(`Found ${placeholders.length} placeholders:`);
  for (const p of placeholders) {
    console.log(`  [${p.type}] ${p.fieldName || p.role}`);
    console.log(`    Tag: ${p.originalTag}`);
    console.log(`    Position: page ${p.pageNumber}, (${p.x}, ${p.y})`);
  }

  if (placeholders.length === 0) {
    console.log('\nNo placeholders found! Check if the PDF has Adobe Sign tags.');
    return;
  }

  // Step 2: Create test stamp data
  console.log('\nStep 2: Creating test signature data...');
  const testStamps = [{
    role: 'signer1',
    signatureData: {
      typedName: 'Test Signer',
      signatureType: 'typed',
      textFields: {
        TitleA: 'Manager',
        AuthA: 'John Doe',
        NumA: '12345',
        ExpA: '2025-12-31',
        TitleB: 'Director',
        AuthB: 'Jane Smith',
        NumB: '67890',
        ExpB: '2025-06-30',
        TitleC: 'Supervisor',
        AuthC: 'Bob Wilson',
        NumC: '11111',
        ExpC: '2025-03-15',
      },
    },
    timestamp: new Date(),
  }];

  // Step 3: Stamp the PDF
  console.log('\nStep 3: Stamping PDF...');
  const stampedPdf = await stampSignature(pdfPath, testStamps, placeholders);
  console.log(`Stamped PDF size: ${stampedPdf.length} bytes`);

  // Step 4: Save the result
  console.log('\nStep 4: Saving signed PDF...');
  const outputPath = await saveStampedPdf(stampedPdf, 'test-' + Date.now());
  console.log(`Saved to: ${outputPath}`);

  console.log('\n===========================================');
  console.log('Test completed successfully!');
  console.log('===========================================');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
