/**
 * Dump the actual content of specific streams
 */

import fs from 'fs/promises';
import zlib from 'zlib';

async function dumpStreamContent(pdfPath: string) {
  console.log(`\n=== Dumping Stream Content: ${pdfPath} ===\n`);

  const pdfBytes = await fs.readFile(pdfPath);
  const rawContent = pdfBytes.toString('latin1');

  // Find streams added by pdf-lib (high object numbers)
  const streamRegex = /(\d+)\s+0\s+obj[\s\S]*?stream\r?\n([\s\S]*?)endstream/g;
  let match;

  const targetObjs = [244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262];

  while ((match = streamRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const streamData = match[2];

    if (!targetObjs.includes(objNum)) continue;

    let content: string;
    let isCompressed = false;
    try {
      const buf = Buffer.from(streamData, 'latin1');
      content = zlib.inflateSync(buf).toString('latin1');
      isCompressed = true;
    } catch {
      content = streamData;
    }

    console.log(`\n=== Stream obj ${objNum} (${isCompressed ? 'compressed' : 'uncompressed'}, ${content.length} chars) ===\n`);
    // Print content with visible control characters
    const printable = content
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    console.log(printable.substring(0, 2000));
    if (printable.length > 2000) {
      console.log(`... (${printable.length - 2000} more chars)`);
    }
  }

  console.log('\n=== Done ===\n');
}

const pdfPath = process.argv[2] || '../test-output-latest.pdf';
dumpStreamContent(pdfPath).catch(console.error);
