/**
 * Dump all text operations from a PDF to see what was drawn
 */

import fs from 'fs/promises';
import zlib from 'zlib';

async function dumpPdfText(pdfPath: string) {
  console.log(`\n=== Dumping Text from PDF: ${pdfPath} ===\n`);

  const pdfBytes = await fs.readFile(pdfPath);
  const rawContent = pdfBytes.toString('latin1');

  // Find streams added by pdf-lib (usually at the end of the PDF)
  // These will contain our stamped values
  const streamRegex = /(\d+)\s+0\s+obj[\s\S]*?stream\r?\n([\s\S]*?)endstream/g;
  let match;

  console.log('Looking for text operations in all streams...\n');

  let foundAny = false;
  const largeObjNums: number[] = [];

  while ((match = streamRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const streamData = match[2];

    let content: string;
    let isCompressed = false;
    try {
      const buf = Buffer.from(streamData, 'latin1');
      content = zlib.inflateSync(buf).toString('latin1');
      isCompressed = true;
    } catch {
      content = streamData;
    }

    // Look for text operations (Tj, TJ, ', ")
    const hasTextOps = /\([^)]+\)\s*Tj|BT[\s\S]*?ET/.test(content);

    if (hasTextOps) {
      // For very new objects (high obj number), dump the content
      if (objNum > 240) { // New objects added by pdf-lib
        foundAny = true;
        console.log(`\n--- Stream obj ${objNum} (${isCompressed ? 'compressed' : 'uncompressed'}) ---`);

        // Extract just the text operations
        const btEtRegex = /BT([\s\S]*?)ET/g;
        let btMatch;
        while ((btMatch = btEtRegex.exec(content)) !== null) {
          const textBlock = btMatch[1];
          // Extract Tj and TJ operations
          const tjRegex = /\(([^)]*)\)\s*Tj/g;
          let tjMatch;
          while ((tjMatch = tjRegex.exec(textBlock)) !== null) {
            // Find preceding Tm
            const beforeTj = textBlock.substring(0, tjMatch.index);
            const tmMatch = beforeTj.match(/([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+Tm[^T]*$/);
            let position = '(unknown)';
            if (tmMatch) {
              position = `(${parseFloat(tmMatch[5]).toFixed(1)}, ${parseFloat(tmMatch[6]).toFixed(1)})`;
            }
            console.log(`  Text: "${tjMatch[1]}" at ${position}`);
          }
        }
      } else {
        largeObjNums.push(objNum);
      }
    }
  }

  if (!foundAny) {
    console.log('No new text streams found. Checking lower object numbers...\n');
    // Check a few of the streams with text
    for (const objNum of largeObjNums.slice(0, 5)) {
      const objRegex = new RegExp(`${objNum}\\s+0\\s+obj[\\s\\S]*?stream\\r?\\n([\\s\\S]*?)endstream`);
      const objMatch = rawContent.match(objRegex);
      if (!objMatch) continue;

      let content: string;
      try {
        content = zlib.inflateSync(Buffer.from(objMatch[1], 'latin1')).toString('latin1');
      } catch {
        content = objMatch[1];
      }

      console.log(`\n--- Stream obj ${objNum} (first 500 chars) ---`);
      console.log(content.substring(0, 500).replace(/\r?\n/g, ' '));
    }
  }

  // Also specifically look for known text we expect
  console.log('\n\n=== Searching for specific text ===\n');

  const searchTerms = ['Test', 'Signer', '02', '18', '2026', 'RN', '12345', 'TS'];

  for (const term of searchTerms) {
    const termRegex = new RegExp(`\\(${term}[^)]*\\)\\s*Tj`, 'g');
    const matches = rawContent.match(termRegex);
    if (matches) {
      console.log(`"${term}": found ${matches.length} times - ${matches.slice(0, 3).join(', ')}`);
    }

    // Also search in decompressed content
    const streamRegex2 = /stream\r?\n([\s\S]*?)endstream/g;
    let match2;
    let decompressedFound = 0;
    while ((match2 = streamRegex2.exec(rawContent)) !== null) {
      let content: string;
      try {
        content = zlib.inflateSync(Buffer.from(match2[1], 'latin1')).toString('latin1');
      } catch {
        content = match2[1];
      }

      const matches2 = content.match(termRegex);
      if (matches2) {
        decompressedFound += matches2.length;
      }
    }
    if (decompressedFound > 0) {
      console.log(`"${term}" (in decompressed streams): found ${decompressedFound} times`);
    }
  }

  console.log('\n=== Done ===\n');
}

const pdfPath = process.argv[2] || '../test-output-latest.pdf';
dumpPdfText(pdfPath).catch(console.error);
