/**
 * Test script to verify signing flow end-to-end
 * 1. Creates a new packet from the test PDF
 * 2. Signs it via the API
 * 3. Analyzes the output to verify positions
 */

import fs from 'fs/promises';
import path from 'path';

const API_BASE = 'http://localhost:3040/api';

async function main() {
  console.log('\n=== Testing End-to-End Signing Flow ===\n');

  // Step 1: Create a new packet
  console.log('Step 1: Creating new packet...');

  const sourcePdfPath = 'uploads/packets/4fca5943-e25b-47e7-b104-96717d548094/b2c3cbdb-9ba1-48a1-9fa1-a168af0005ca_HHA-PCA-Evals-and-Post-Test-ADIL-JAA-117-23-5098.pdf';

  // Read the PDF and create a form data like object
  const pdfBytes = await fs.readFile(sourcePdfPath);

  // Use form-data approach via fetch
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', pdfBytes, {
    filename: 'test-signing.pdf',
    contentType: 'application/pdf',
  });
  form.append('name', `Test Signing ${Date.now()}`);

  const createResponse = await fetch(`${API_BASE}/packets`, {
    method: 'POST',
    body: form as any,
    headers: form.getHeaders(),
  });

  if (!createResponse.ok) {
    console.error('Failed to create packet:', await createResponse.text());
    process.exit(1);
  }

  const packet = await createResponse.json() as any;
  console.log(`  Created packet: ${packet.id}`);
  console.log(`  Placeholders: ${packet.placeholders?.length || 0}`);

  // Show placeholder summary
  const sigCount = packet.placeholders?.filter((p: any) => p.type === 'SIGNATURE').length || 0;
  const dateCount = packet.placeholders?.filter((p: any) => p.type === 'DATE').length || 0;
  const textCount = packet.placeholders?.filter((p: any) => p.type === 'TEXT').length || 0;
  console.log(`  - SIGNATURE: ${sigCount} positions`);
  console.log(`  - DATE: ${dateCount} positions`);
  console.log(`  - TEXT: ${textCount} positions`);

  // Step 2: Get signing token
  console.log('\nStep 2: Getting signing token...');

  // Find the signer
  const signersResponse = await fetch(`${API_BASE}/packets/${packet.id}/signers`);
  const signers = await signersResponse.json() as any[];
  console.log(`  Found ${signers.length} signers`);

  if (signers.length === 0) {
    console.error('No signers found for packet');
    process.exit(1);
  }

  const signer = signers[0];
  console.log(`  Using signer: ${signer.email} (token: ${signer.token})`);

  // Step 3: Sign the document
  console.log('\nStep 3: Signing document...');

  const signatureData = {
    typedName: 'Test Signer',
    signatureType: 'typed',
    textFields: {
      'Int': 'TS',
      'Dte1': new Date().toLocaleDateString('en-US'),
      'Lic#': 'RN12345',
    },
  };

  const signResponse = await fetch(`${API_BASE}/signing/${signer.token}/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signatureData),
  });

  if (!signResponse.ok) {
    console.error('Failed to sign:', await signResponse.text());
    process.exit(1);
  }

  const signResult = await signResponse.json();
  console.log(`  Sign result:`, signResult);

  // Step 4: Get the signed PDF
  console.log('\nStep 4: Fetching signed PDF...');

  // Wait a moment for processing
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Get packet details to find signed file
  const packetDetailsResponse = await fetch(`${API_BASE}/packets/${packet.id}`);
  const packetDetails = await packetDetailsResponse.json() as any;

  if (packetDetails.signedFilePath) {
    console.log(`  Signed file: ${packetDetails.signedFilePath}`);

    // Copy the signed PDF to a location for inspection
    const signedPdfPath = path.join(process.cwd(), packetDetails.signedFilePath);
    const outputPath = path.join(process.cwd(), 'test-output-signed.pdf');

    try {
      await fs.copyFile(signedPdfPath, outputPath);
      console.log(`  Copied to: ${outputPath}`);
    } catch (err) {
      console.log(`  Could not copy signed PDF: ${err}`);
    }
  } else {
    console.log('  No signed file path found in packet');
  }

  console.log('\n=== Test Complete ===\n');
  console.log('Please open the signed PDF to verify:');
  console.log('1. Signature appears at the bottom "RN Signature:" line');
  console.log('2. Signature appears in the table cells');
  console.log('3. Date appears in all date fields');
  console.log('4. Initials appear in all initial fields');
  console.log('5. License number appears in the license field');
}

main().catch(console.error);
