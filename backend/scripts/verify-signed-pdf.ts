/**
 * Verify that a signed PDF has values at the expected positions
 */

import fs from 'fs/promises';
import zlib from 'zlib';

async function verifySignedPdf(pdfPath: string) {
  console.log(`\n=== Verifying Signed PDF: ${pdfPath} ===\n`);

  const pdfBytes = await fs.readFile(pdfPath);
  const rawContent = pdfBytes.toString('latin1');

  // Expected values from signing
  const expectedValues = [
    'Test Signer',
    'TS',
    '02/18/2026',
    'RN12345',
  ];

  console.log('Looking for expected values in PDF content streams...\n');

  // Find all streams and check for our values
  const streamRegex = /(\d+)\s+0\s+obj[\s\S]*?stream\r?\n([\s\S]*?)endstream/g;
  let match;

  const findings: Array<{ objNum: number; text: string; positions: string[] }> = [];

  while ((match = streamRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const streamData = match[2];

    let content: string;
    try {
      const buf = Buffer.from(streamData, 'latin1');
      content = zlib.inflateSync(buf).toString('latin1');
    } catch {
      content = streamData;
    }

    // Check for each expected value
    for (const value of expectedValues) {
      if (content.includes(value)) {
        // Find positions (Tm operators) near this text
        const positions: string[] = [];

        // Look for text drawing with this value
        const textRegex = new RegExp(`\\(${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*Tj`, 'g');
        let textMatch;
        while ((textMatch = textRegex.exec(content)) !== null) {
          // Find preceding Tm
          const beforeText = content.substring(0, textMatch.index);
          const tmRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+Tm/g;
          let lastTm: RegExpExecArray | null = null;
          let tm;
          while ((tm = tmRegex.exec(beforeText)) !== null) {
            lastTm = tm;
          }
          if (lastTm) {
            positions.push(`(${parseFloat(lastTm[5]).toFixed(1)}, ${parseFloat(lastTm[6]).toFixed(1)})`);
          }
        }

        findings.push({ objNum, text: value, positions });
      }
    }
  }

  // Print findings
  console.log('=== Findings ===\n');

  for (const value of expectedValues) {
    const found = findings.filter(f => f.text === value);
    if (found.length > 0) {
      console.log(`✓ "${value}" found in ${found.length} stream(s):`);
      for (const f of found) {
        if (f.positions.length > 0) {
          console.log(`    obj ${f.objNum}: positions ${f.positions.join(', ')}`);
        } else {
          console.log(`    obj ${f.objNum}: (position not determined)`);
        }
      }
    } else {
      console.log(`✗ "${value}" NOT found in PDF`);
    }
    console.log();
  }

  // Also check if tags were removed
  console.log('=== Tag Removal Check ===\n');

  const tagPatterns = [
    /\{\{\*?[^}]+_es_:[^}]*\}\}/g,
    /\[\[(SIGNATURE|DATE|TEXT):[^\]]+\]\]/g,
  ];

  let tagsFound = 0;
  for (const pattern of tagPatterns) {
    const matches = rawContent.match(pattern);
    if (matches) {
      tagsFound += matches.length;
      console.log(`Found ${matches.length} tags matching ${pattern.source.substring(0, 30)}...`);
    }
  }

  // Also check in decompressed streams
  let streamTagCount = 0;
  const streamRegex2 = /stream\r?\n([\s\S]*?)endstream/g;
  while ((match = streamRegex2.exec(rawContent)) !== null) {
    let content: string;
    try {
      content = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      content = match[1];
    }

    for (const pattern of tagPatterns) {
      const newPattern = new RegExp(pattern.source, 'g');
      const matches = content.match(newPattern);
      if (matches) {
        streamTagCount += matches.length;
      }
    }
  }

  if (tagsFound === 0 && streamTagCount === 0) {
    console.log('✓ No Adobe Sign tags found in PDF - tags were successfully removed');
  } else {
    console.log(`✗ Found ${tagsFound + streamTagCount} tags still in PDF`);
  }

  console.log('\n=== Verification Complete ===\n');
  console.log('Please also visually inspect the PDF to verify:');
  console.log('1. Signature "Test Signer" appears at bottom "RN Signature:" line (y~132)');
  console.log('2. Signature "Test Signer" appears in table cells (y~388 area)');
  console.log('3. Date "02/18/2026" appears in all date fields');
  console.log('4. Initials "TS" appear in all initials fields');
  console.log('5. License "RN12345" appears in license field');
}

const pdfPath = process.argv[2] || '../test-output-latest.pdf';
verifySignedPdf(pdfPath).catch(console.error);
