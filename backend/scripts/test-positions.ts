/**
 * Test script to verify PDF position extraction
 */
import { parseTemplatePlaceholders } from '../src/services/pdf.service';

async function main() {
  const pdfPath = process.argv[2] || 'uploads/packets/4fca5943-e25b-47e7-b104-96717d548094/b2c3cbdb-9ba1-48a1-9fa1-a168af0005ca_HHA-PCA-Evals-and-Post-Test-ADIL-JAA-117-23-5098.pdf';

  console.log('\n=== Testing Position Extraction ===\n');
  console.log(`PDF: ${pdfPath}\n`);

  try {
    const placeholders = await parseTemplatePlaceholders(pdfPath);

    console.log('\n=== Extracted Placeholders ===\n');
    for (const p of placeholders) {
      console.log(`${p.type}: ${p.fieldName || p.role}`);
      console.log(`  Page: ${p.pageNumber}`);
      console.log(`  Position: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
      console.log(`  Tag: ${p.originalTag}`);
      console.log();
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
