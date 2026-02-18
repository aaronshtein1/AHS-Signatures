/**
 * Debug script to analyze the FULL tag positions including internal XObject offsets.
 * This helps identify why values aren't appearing at the correct positions.
 */

import fs from 'fs/promises';
import zlib from 'zlib';

interface TagPosition {
  tag: string;
  pageIndex: number;
  xobjectName?: string;
  xobjectObjNum?: number;
  cmPosition: { x: number; y: number }; // Position from cm (XObject placement)
  tmPosition: { x: number; y: number }; // Position from Tm (internal to XObject)
  finalPosition: { x: number; y: number }; // Combined position
}

async function analyzeTagPositions(pdfPath: string) {
  console.log(`\n=== Analyzing PDF: ${pdfPath} ===\n`);

  const pdfBytes = await fs.readFile(pdfPath);
  const rawContent = pdfBytes.toString('latin1');

  // Step 1: Build page content stream mappings
  const pageObjects: Array<{ objNum: number; contents: number[] }> = [];
  const objRegex = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>/g;
  let match;

  while ((match = objRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const dictContent = match[2];

    const hasContents = dictContent.includes('/Contents');
    const hasMediaBox = dictContent.includes('/MediaBox') || dictContent.includes('/CropBox');
    const isTypePage = dictContent.includes('/Type') && dictContent.includes('/Page') && !dictContent.includes('/Pages');
    const hasParent = dictContent.includes('/Parent');

    if (hasContents && (hasMediaBox || isTypePage || hasParent)) {
      const contentsRefs: number[] = [];
      const singleRef = dictContent.match(/\/Contents\s+(\d+)\s+0\s+R/);
      if (singleRef) contentsRefs.push(parseInt(singleRef[1]));

      const arrayRef = dictContent.match(/\/Contents\s*\[([\s\S]*?)\]/);
      if (arrayRef) {
        const refs = arrayRef[1].match(/(\d+)\s+0\s+R/g);
        if (refs) {
          for (const ref of refs) {
            contentsRefs.push(parseInt(ref));
          }
        }
      }

      if (contentsRefs.length > 0) {
        pageObjects.push({ objNum, contents: contentsRefs });
      }
    }
  }

  pageObjects.sort((a, b) => a.objNum - b.objNum);
  console.log(`Found ${pageObjects.length} pages`);

  const streamToPage = new Map<number, number>();
  pageObjects.forEach((page, pageIndex) => {
    for (const contentRef of page.contents) {
      streamToPage.set(contentRef, pageIndex);
    }
  });

  // Step 2: Build XObject mappings
  const xobjectMap = new Map<string, number[]>();
  const xobjRegex = /\/XObject\s*<<([^>]+)>>/g;
  while ((match = xobjRegex.exec(rawContent)) !== null) {
    const dictContent = match[1];
    const entryRegex = /\/(\w+)\s+(\d+)\s+0\s+R/g;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(dictContent)) !== null) {
      const name = entryMatch[1];
      const objNum = parseInt(entryMatch[2]);
      const existing = xobjectMap.get(name) || [];
      if (!existing.includes(objNum)) {
        existing.push(objNum);
        xobjectMap.set(name, existing);
      }
    }
  }

  console.log(`Found ${xobjectMap.size} XObject name mappings`);

  // Step 3: Find XObject placements (where they're drawn on pages)
  const xobjectPlacements = new Map<number, { pageIndex: number; x: number; y: number; name: string }>();

  for (const [contentObjNum, pageIndex] of streamToPage.entries()) {
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

    // Find cm ... Do patterns
    const doPatterns = [
      /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+cm\s*\/(\w+)\s+Do/g,
      /q\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+cm\s*\/(\w+)\s+Do/g,
    ];

    for (const pattern of doPatterns) {
      let doMatch;
      while ((doMatch = pattern.exec(streamContent)) !== null) {
        const x = parseFloat(doMatch[5]);
        const y = parseFloat(doMatch[6]);
        const xobjName = doMatch[7];

        const objNums = xobjectMap.get(xobjName) || [];
        for (const objNum of objNums) {
          if (!xobjectPlacements.has(objNum)) {
            xobjectPlacements.set(objNum, { pageIndex, x, y, name: xobjName });
          }
        }
      }
    }
  }

  console.log(`Found ${xobjectPlacements.size} XObject placements\n`);

  // Step 4: Find all streams with tags and extract their positions
  const tagPatterns = [
    /\{\{\*?[^}]+_es_:[^}]*\}\}/,
    /\[\[(SIGNATURE|DATE|TEXT):[^\]]+\]\]/,
  ];

  const tagPositions: TagPosition[] = [];

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

    // Find tags
    const foundTags: string[] = [];
    for (const pattern of tagPatterns) {
      const globalPattern = new RegExp(pattern.source, 'g');
      const matches = decompressed.match(globalPattern);
      if (matches) foundTags.push(...matches);
    }

    if (foundTags.length === 0) continue;

    // Get placement info
    const placement = xobjectPlacements.get(objNum);
    const cmX = placement?.x || 0;
    const cmY = placement?.y || 0;
    const pageIndex = placement?.pageIndex ?? streamToPage.get(objNum) ?? 0;

    // Find internal Tm positions for each tag
    for (const tag of foundTags) {
      const tagIndex = decompressed.indexOf(tag);
      if (tagIndex === -1) continue;

      const beforeTag = decompressed.substring(0, tagIndex);

      // Find last Tm before this tag
      const tmRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+Tm/g;
      let lastTm: RegExpExecArray | null = null;
      let tmMatch;
      while ((tmMatch = tmRegex.exec(beforeTag)) !== null) {
        lastTm = tmMatch;
      }

      let tmX = 0, tmY = 0;
      if (lastTm) {
        tmX = parseFloat(lastTm[5]);
        tmY = parseFloat(lastTm[6]);
      }

      // Also check for Td offsets after Tm
      if (lastTm) {
        const afterTm = beforeTag.substring(lastTm.index + lastTm[0].length);
        const tdRegex = /([\d.+-]+)\s+([\d.+-]+)\s+T[dD]/g;
        let tdMatch;
        while ((tdMatch = tdRegex.exec(afterTm)) !== null) {
          tmX += parseFloat(tdMatch[1]);
          tmY += parseFloat(tdMatch[2]);
        }
      }

      // Calculate final position
      const finalX = cmX + tmX;
      const finalY = cmY + tmY;

      tagPositions.push({
        tag: tag.substring(0, 40),
        pageIndex,
        xobjectName: placement?.name,
        xobjectObjNum: objNum,
        cmPosition: { x: cmX, y: cmY },
        tmPosition: { x: tmX, y: tmY },
        finalPosition: { x: finalX, y: finalY },
      });
    }
  }

  // Display results
  console.log('=== Tag Position Analysis ===\n');

  // Group by tag type
  const sigTags = tagPositions.filter(t => t.tag.includes('Sig') || t.tag.includes('SIGNATURE'));
  const dateTags = tagPositions.filter(t => t.tag.includes('Dte') || t.tag.includes('Date') || t.tag.includes('DATE'));
  const initTags = tagPositions.filter(t => t.tag.includes('Int') && !t.tag.includes('DATE'));
  const licTags = tagPositions.filter(t => t.tag.includes('Lic'));

  console.log('--- SIGNATURE TAGS ---');
  for (const t of sigTags) {
    console.log(`  ${t.tag}`);
    console.log(`    Page: ${t.pageIndex + 1}, XObject: ${t.xobjectName || 'N/A'} (obj ${t.xobjectObjNum})`);
    console.log(`    cm position: (${t.cmPosition.x.toFixed(1)}, ${t.cmPosition.y.toFixed(1)})`);
    console.log(`    Tm position: (${t.tmPosition.x.toFixed(1)}, ${t.tmPosition.y.toFixed(1)})`);
    console.log(`    FINAL position: (${t.finalPosition.x.toFixed(1)}, ${t.finalPosition.y.toFixed(1)})`);
    console.log();
  }

  console.log('--- DATE TAGS ---');
  for (const t of dateTags) {
    console.log(`  ${t.tag}`);
    console.log(`    Page: ${t.pageIndex + 1}, XObject: ${t.xobjectName || 'N/A'} (obj ${t.xobjectObjNum})`);
    console.log(`    cm position: (${t.cmPosition.x.toFixed(1)}, ${t.cmPosition.y.toFixed(1)})`);
    console.log(`    Tm position: (${t.tmPosition.x.toFixed(1)}, ${t.tmPosition.y.toFixed(1)})`);
    console.log(`    FINAL position: (${t.finalPosition.x.toFixed(1)}, ${t.finalPosition.y.toFixed(1)})`);
    console.log();
  }

  console.log('--- INITIALS TAGS ---');
  for (const t of initTags) {
    console.log(`  ${t.tag}`);
    console.log(`    Page: ${t.pageIndex + 1}, XObject: ${t.xobjectName || 'N/A'} (obj ${t.xobjectObjNum})`);
    console.log(`    cm position: (${t.cmPosition.x.toFixed(1)}, ${t.cmPosition.y.toFixed(1)})`);
    console.log(`    Tm position: (${t.tmPosition.x.toFixed(1)}, ${t.tmPosition.y.toFixed(1)})`);
    console.log(`    FINAL position: (${t.finalPosition.x.toFixed(1)}, ${t.finalPosition.y.toFixed(1)})`);
    console.log();
  }

  console.log('--- LICENSE TAGS ---');
  for (const t of licTags) {
    console.log(`  ${t.tag}`);
    console.log(`    Page: ${t.pageIndex + 1}, XObject: ${t.xobjectName || 'N/A'} (obj ${t.xobjectObjNum})`);
    console.log(`    cm position: (${t.cmPosition.x.toFixed(1)}, ${t.cmPosition.y.toFixed(1)})`);
    console.log(`    Tm position: (${t.tmPosition.x.toFixed(1)}, ${t.tmPosition.y.toFixed(1)})`);
    console.log(`    FINAL position: (${t.finalPosition.x.toFixed(1)}, ${t.finalPosition.y.toFixed(1)})`);
    console.log();
  }

  // Special focus on positions at bottom of page (y < 200)
  console.log('\n=== BOTTOM OF PAGE TAGS (y < 200) ===\n');
  const bottomTags = tagPositions.filter(t => t.finalPosition.y < 200);
  for (const t of bottomTags) {
    console.log(`  ${t.tag}`);
    console.log(`    Page: ${t.pageIndex + 1}`);
    console.log(`    cm: (${t.cmPosition.x.toFixed(1)}, ${t.cmPosition.y.toFixed(1)}) + Tm: (${t.tmPosition.x.toFixed(1)}, ${t.tmPosition.y.toFixed(1)})`);
    console.log(`    => FINAL: (${t.finalPosition.x.toFixed(1)}, ${t.finalPosition.y.toFixed(1)})`);
    console.log();
  }

  console.log('\n=== Analysis Complete ===\n');
}

// Run
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: npx ts-node scripts/debug-tag-positions.ts <pdf-path>');
  process.exit(1);
}

analyzeTagPositions(pdfPath).catch(console.error);
