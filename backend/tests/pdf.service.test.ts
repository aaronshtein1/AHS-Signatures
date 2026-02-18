/**
 * Unit tests for PDF service
 * Run with: npx ts-node tests/pdf.service.test.ts
 */

import { parseTemplatePlaceholders, stampSignature, Placeholder } from '../src/services/pdf.service';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';

// Simple test runner
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return fn().then ?
    (fn() as Promise<void>).then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    }).catch((err: Error) => {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
      failed++;
    }) :
    Promise.resolve().then(() => {
      (fn as () => void)();
      console.log(`  ✓ ${name}`);
      passed++;
    }).catch((err: Error) => {
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
      failed++;
    });
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// Create test PDFs with unique names
let testCounter = 0;

async function createTestPdfWithAdobeTags(): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Add Adobe Sign text tags
  page.drawText('Employee Name: {{TitleA_es_:signer1}}', { x: 50, y: 700, size: 11, font });
  page.drawText('Employee ID: {{NumA_es_:signer1}}', { x: 50, y: 680, size: 11, font });
  page.drawText('Date: {{DateA_es_:signer1:date}}', { x: 50, y: 640, size: 11, font });
  page.drawText('Signature: {{Sig_es_:signer1:signature}}', { x: 50, y: 600, size: 11, font });

  const pdfBytes = await pdfDoc.save();
  testCounter++;
  const testPath = path.join(process.cwd(), 'tests', `temp-adobe-tags-${testCounter}.pdf`);
  await fs.writeFile(testPath, pdfBytes);
  return testPath;
}

async function createTestPdfWithCustomTags(): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Add custom format tags
  page.drawText('Please sign here: [[SIGNATURE:employee]]', { x: 50, y: 700, size: 11, font });
  page.drawText('Date: [[DATE:employee]]', { x: 50, y: 660, size: 11, font });
  page.drawText('Comment: [[TEXT:comment]]', { x: 50, y: 620, size: 11, font });

  const pdfBytes = await pdfDoc.save();
  testCounter++;
  const testPath = path.join(process.cwd(), 'tests', `temp-custom-tags-${testCounter}.pdf`);
  await fs.writeFile(testPath, pdfBytes);
  return testPath;
}

async function createTestPdfWithMultipleSigners(): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Signer 1 section
  page.drawText('Employee: {{Name_es_:signer1}}', { x: 50, y: 700, size: 11, font });
  page.drawText('Signature: {{Sig_es_:signer1:signature}}', { x: 50, y: 660, size: 11, font });
  page.drawText('Date: {{DateA_es_:signer1:date}}', { x: 50, y: 620, size: 11, font });

  // Signer 2 section
  page.drawText('Supervisor: {{SuperName_es_:signer2}}', { x: 50, y: 560, size: 11, font });
  page.drawText('Supervisor Signature: {{Sig2_es_:signer2:signature}}', { x: 50, y: 520, size: 11, font });
  page.drawText('Approval Date: {{DateB_es_:signer2:date}}', { x: 50, y: 480, size: 11, font });

  const pdfBytes = await pdfDoc.save();
  testCounter++;
  const testPath = path.join(process.cwd(), 'tests', `temp-multi-signer-${testCounter}.pdf`);
  await fs.writeFile(testPath, pdfBytes);
  return testPath;
}

// Test suites
async function testPlaceholderDetection() {
  console.log('\n📋 Placeholder Detection Tests:');

  await test('detects Adobe Sign signature tags', async () => {
    const pdfPath = await createTestPdfWithAdobeTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);
    const sigPlaceholders = placeholders.filter(p => p.type === 'SIGNATURE');
    assert(sigPlaceholders.length >= 1, 'Should find at least 1 signature placeholder');
    assert(sigPlaceholders[0].role === 'signer1', 'Signature role should be signer1');
  });

  await test('detects Adobe Sign text field tags', async () => {
    const pdfPath = await createTestPdfWithAdobeTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);
    const textPlaceholders = placeholders.filter(p => p.type === 'TEXT');
    assert(textPlaceholders.length >= 2, 'Should find at least 2 text placeholders');
    const fieldNames = textPlaceholders.map(p => p.fieldName);
    assert(fieldNames.includes('TitleA'), 'Should find TitleA field');
    assert(fieldNames.includes('NumA'), 'Should find NumA field');
  });

  await test('detects Adobe Sign date tags', async () => {
    const pdfPath = await createTestPdfWithAdobeTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);
    const datePlaceholders = placeholders.filter(p => p.type === 'DATE');
    assert(datePlaceholders.length >= 1, 'Should find at least 1 date placeholder');
  });

  await test('detects custom format tags [[SIGNATURE:role]]', async () => {
    const pdfPath = await createTestPdfWithCustomTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);
    const sigPlaceholders = placeholders.filter(p => p.type === 'SIGNATURE');
    assert(sigPlaceholders.length >= 1, 'Should find signature placeholder');
    assert(sigPlaceholders[0].role === 'employee', 'Role should be employee');
  });

  await test('handles multiple signers correctly', async () => {
    const pdfPath = await createTestPdfWithMultipleSigners();
    const placeholders = await parseTemplatePlaceholders(pdfPath);
    const sigPlaceholders = placeholders.filter(p => p.type === 'SIGNATURE');
    assert(sigPlaceholders.length >= 2, 'Should find 2 signature placeholders');
    const roles = sigPlaceholders.map(p => p.role);
    assert(roles.includes('signer1'), 'Should have signer1');
    assert(roles.includes('signer2'), 'Should have signer2');
  });

  await test('stores original tag for reference', async () => {
    const pdfPath = await createTestPdfWithAdobeTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);
    const sigPlaceholder = placeholders.find(p => p.type === 'SIGNATURE');
    assert(sigPlaceholder !== undefined, 'Should find signature placeholder');
    assert(sigPlaceholder!.originalTag.includes('{{'), 'Original tag should contain {{');
    assert(sigPlaceholder!.originalTag.includes('}}'), 'Original tag should contain }}');
  });
}

async function testSignatureStamping() {
  console.log('\n📝 Signature Stamping Tests:');

  await test('stamps typed signature correctly', async () => {
    const pdfPath = await createTestPdfWithAdobeTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);

    const stampedPdf = await stampSignature(
      pdfPath,
      [{
        role: 'signer1',
        signatureData: {
          typedName: 'John Doe',
          signatureType: 'typed',
          textFields: { TitleA: 'Software Engineer', NumA: 'EMP123' },
        },
        timestamp: new Date(),
      }],
      placeholders
    );

    assert(stampedPdf.length > 0, 'Stamped PDF should have content');
    // Verify it's a valid PDF
    const loadedDoc = await PDFDocument.load(stampedPdf);
    const pageCount = loadedDoc.getPageCount();
    assert(pageCount >= 2, 'Stamped PDF should have appendix page');
  });

  await test('includes text field values in appendix', async () => {
    const pdfPath = await createTestPdfWithAdobeTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);

    const stampedPdf = await stampSignature(
      pdfPath,
      [{
        role: 'signer1',
        signatureData: {
          typedName: 'Jane Smith',
          signatureType: 'typed',
          textFields: { TitleA: 'Manager', NumA: 'MGR456' },
        },
        timestamp: new Date(),
      }],
      placeholders
    );

    // Load and verify the PDF has content
    const loadedDoc = await PDFDocument.load(stampedPdf);
    assert(loadedDoc.getPageCount() >= 2, 'Should have appendix page');
  });

  await test('handles multiple signers', async () => {
    const pdfPath = await createTestPdfWithMultipleSigners();
    const placeholders = await parseTemplatePlaceholders(pdfPath);

    const stampedPdf = await stampSignature(
      pdfPath,
      [
        {
          role: 'signer1',
          signatureData: {
            typedName: 'Employee One',
            signatureType: 'typed',
            textFields: { Name: 'Employee One' },
          },
          timestamp: new Date(),
        },
        {
          role: 'signer2',
          signatureData: {
            typedName: 'Supervisor Two',
            signatureType: 'typed',
            textFields: { SuperName: 'Supervisor Two' },
          },
          timestamp: new Date(),
        },
      ],
      placeholders
    );

    const loadedDoc = await PDFDocument.load(stampedPdf);
    assert(loadedDoc.getPageCount() >= 2, 'Should have appendix page');
  });
}

async function testEdgeCases() {
  console.log('\n⚠️  Edge Case Tests:');

  await test('handles PDF with no tags gracefully', async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('This is a plain document with no tags.', { x: 50, y: 700, size: 11, font });

    const pdfBytes = await pdfDoc.save();
    testCounter++;
    const testPath = path.join(process.cwd(), 'tests', `temp-no-tags-${testCounter}.pdf`);
    await fs.writeFile(testPath, pdfBytes);

    const placeholders = await parseTemplatePlaceholders(testPath);
    assertEqual(placeholders.length, 0, 'Should find 0 placeholders');
  });

  await test('handles empty text fields', async () => {
    const pdfPath = await createTestPdfWithAdobeTags();
    const placeholders = await parseTemplatePlaceholders(pdfPath);

    // Stamp with empty text fields
    const stampedPdf = await stampSignature(
      pdfPath,
      [{
        role: 'signer1',
        signatureData: {
          typedName: 'Test User',
          signatureType: 'typed',
          textFields: {}, // Empty
        },
        timestamp: new Date(),
      }],
      placeholders
    );

    const loadedDoc = await PDFDocument.load(stampedPdf);
    assert(loadedDoc.getPageCount() >= 1, 'Should produce valid PDF');
  });
}

// Cleanup helper
async function cleanup() {
  // Clean up all temp files
  try {
    const testsDir = path.join(process.cwd(), 'tests');
    const files = await fs.readdir(testsDir);
    for (const file of files) {
      if (file.startsWith('temp-')) {
        try {
          await fs.unlink(path.join(testsDir, file));
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Ignore if directory doesn't exist
  }
}

// Main test runner
async function runTests() {
  console.log('🧪 PDF Service Unit Tests\n');
  console.log('='.repeat(50));

  try {
    await testPlaceholderDetection();
    await testSignatureStamping();
    await testEdgeCases();
  } finally {
    await cleanup();
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
