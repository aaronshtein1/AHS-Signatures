/**
 * Debug script to analyze PDF content streams and find tag positions
 * Usage: npx ts-node scripts/debug-pdf.ts <pdf-path>
 */

import fs from 'fs/promises';
import zlib from 'zlib';

async function debugPdf(pdfPath: string) {
  console.log(`\n=== Analyzing PDF: ${pdfPath} ===\n`);

  const pdfBytes = await fs.readFile(pdfPath);
  const rawContent = pdfBytes.toString('latin1');

  // Find XObject mappings
  console.log('=== XObject Mappings ===');
  const xobjectMap = new Map<string, number>();
  const xobjRegex = /\/XObject\s*<<([^>]+)>>/g;
  let xMatch;
  while ((xMatch = xobjRegex.exec(rawContent)) !== null) {
    const dictContent = xMatch[1];
    const entryRegex = /\/(\w+)\s+(\d+)\s+0\s+R/g;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(dictContent)) !== null) {
      xobjectMap.set(entryMatch[1], parseInt(entryMatch[2]));
      console.log(`  /${entryMatch[1]} -> obj ${entryMatch[2]}`);
    }
  }

  // Find all Page objects
  console.log('\n=== Page Objects ===');
  const objRegex = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>/g;
  const pages: Array<{ objNum: number; contents: number[] }> = [];
  let match;

  while ((match = objRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const dictContent = match[2];

    if (dictContent.includes('/Type') && dictContent.includes('/Page') && !dictContent.includes('/Pages')) {
      const contentsMatch = dictContent.match(/\/Contents\s+(\d+)\s+0\s+R/);
      const arrayMatch = dictContent.match(/\/Contents\s*\[([\s\S]*?)\]/);

      const contents: number[] = [];
      if (contentsMatch) contents.push(parseInt(contentsMatch[1]));
      if (arrayMatch) {
        const refs = arrayMatch[1].match(/(\d+)\s+0\s+R/g);
        if (refs) refs.forEach(r => contents.push(parseInt(r)));
      }

      pages.push({ objNum, contents });
      console.log(`  Page obj ${objNum}: Contents = [${contents.join(', ')}]`);
    }
  }

  // Find XObject placements in page content streams
  console.log('\n=== XObject Placements (looking for cm ... Do) ===');
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    for (const contentObjNum of page.contents) {
      const objRegex2 = new RegExp(`${contentObjNum}\\s+0\\s+obj[\\s\\S]*?stream\\r?\\n([\\s\\S]*?)endstream`);
      const objMatch = rawContent.match(objRegex2);
      if (!objMatch) continue;

      let streamContent: string;
      try {
        const buf = Buffer.from(objMatch[1], 'latin1');
        streamContent = zlib.inflateSync(buf).toString('latin1');
      } catch {
        streamContent = objMatch[1];
      }

      // Look for cm ... Do patterns
      const doRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+cm\s*\/(\w+)\s+Do/g;
      let doMatch;
      while ((doMatch = doRegex.exec(streamContent)) !== null) {
        const x = parseFloat(doMatch[5]);
        const y = parseFloat(doMatch[6]);
        const xobjName = doMatch[7];
        const targetObj = xobjectMap.get(xobjName);
        console.log(`  Page ${pageIdx + 1}: /${xobjName} (obj ${targetObj}) at (${x.toFixed(1)}, ${y.toFixed(1)})`);
      }

      // Also look for simpler Do patterns (might be preceded by q cm pattern on separate lines)
      const simpleDoRegex = /\/(\w+)\s+Do/g;
      let simpleMatch;
      const doNames: string[] = [];
      while ((simpleMatch = simpleDoRegex.exec(streamContent)) !== null) {
        doNames.push(simpleMatch[1]);
      }
      if (doNames.length > 0) {
        console.log(`  Page ${pageIdx + 1}: Found Do operators for: ${doNames.join(', ')}`);
      }
    }
  }

  // Find streams with tags
  console.log('\n=== Streams with Tags ===');
  const tagPatterns = [
    /\{\{\*?[^}]+_es_:[^}]*\}\}/g,
    /\[\[(SIGNATURE|DATE|TEXT):[^\]]+\]\]/g,
  ];

  const streamRegex = /(\d+)\s+0\s+obj[\s\S]*?stream\r?\n([\s\S]*?)endstream/g;
  while ((match = streamRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const streamData = match[2];

    if (streamData.length > 500000) continue;

    let decompressed: string;
    try {
      const buf = Buffer.from(streamData, 'latin1');
      decompressed = zlib.inflateSync(buf).toString('latin1');
    } catch {
      decompressed = streamData;
    }

    // Check for tags
    let foundTags: string[] = [];
    for (const pattern of tagPatterns) {
      const matches = decompressed.match(pattern);
      if (matches) foundTags.push(...matches);
    }

    if (foundTags.length === 0) continue;

    console.log(`\n--- Stream obj ${objNum} ---`);
    console.log(`Found tags: ${foundTags.join(', ')}`);

    // Which page?
    const pageIdx = pages.findIndex(p => p.contents.includes(objNum));
    if (pageIdx >= 0) {
      console.log(`Belongs to page ${pageIdx + 1}`);
    } else {
      console.log(`Page unknown`);
    }

    // Find positioning for each tag
    for (const tag of foundTags) {
      console.log(`\n  Tag: ${tag}`);

      // Find where this tag appears
      const tagIndex = decompressed.indexOf(tag);
      if (tagIndex === -1) continue;

      // Print context around tag
      const contextStart = Math.max(0, tagIndex - 400);
      const contextEnd = Math.min(decompressed.length, tagIndex + tag.length + 50);
      const context = decompressed.substring(contextStart, contextEnd);

      console.log(`  Context (${contextStart}-${contextEnd}):`);
      // Print cleaner version
      const cleanContext = context.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
      console.log(`    ${cleanContext.substring(0, 300)}`);
      if (cleanContext.length > 300) console.log(`    ...${cleanContext.substring(cleanContext.length - 100)}`);

      // Find Tm operators
      const tmRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+Tm/g;
      const beforeTag = decompressed.substring(0, tagIndex);
      let lastTm: RegExpExecArray | null = null;
      let tmMatch;
      while ((tmMatch = tmRegex.exec(beforeTag)) !== null) {
        lastTm = tmMatch;
      }

      if (lastTm) {
        console.log(`  Last Tm before tag: ${lastTm[0]}`);
        console.log(`    a=${lastTm[1]}, b=${lastTm[2]}, c=${lastTm[3]}, d=${lastTm[4]}, e=${lastTm[5]}, f=${lastTm[6]}`);
        console.log(`    Position: x=${lastTm[5]}, y=${lastTm[6]}`);
      } else {
        console.log(`  No Tm found before tag!`);

        // Check if there's a cm (transformation matrix)
        const cmRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+cm/g;
        let lastCm: RegExpExecArray | null = null;
        let cmMatch;
        while ((cmMatch = cmRegex.exec(beforeTag)) !== null) {
          lastCm = cmMatch;
        }
        if (lastCm) {
          console.log(`  Last cm before tag: ${lastCm[0]}`);
          console.log(`    Position: x=${lastCm[5]}, y=${lastCm[6]}`);
        }
      }
    }
  }

  console.log('\n=== Analysis Complete ===\n');
}

// Run with the path argument
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: npx ts-node scripts/debug-pdf.ts <pdf-path>');
  process.exit(1);
}

debugPdf(pdfPath).catch(console.error);
