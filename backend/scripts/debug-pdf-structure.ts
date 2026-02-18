/**
 * Debug script to understand PDF structure - specifically how Resources/XObject are organized
 */

import fs from 'fs/promises';

async function debugPdfStructure(pdfPath: string) {
  console.log(`\n=== Analyzing PDF Structure: ${pdfPath} ===\n`);

  const pdfBytes = await fs.readFile(pdfPath);
  const rawContent = pdfBytes.toString('latin1');

  // Find Page objects
  console.log('=== Page Objects ===\n');
  const pageRegex = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>/g;
  let match;
  let pageCount = 0;

  while ((match = pageRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const dictContent = match[2];

    // Check if this is a Page object - more relaxed detection
    const isTypePage = dictContent.includes('/Type') && dictContent.includes('/Page') && !dictContent.includes('/Pages');
    const hasContents = dictContent.includes('/Contents');
    const hasParent = dictContent.includes('/Parent');
    const hasMediaBox = dictContent.includes('/MediaBox');

    // Try multiple detection strategies
    if (hasContents && (isTypePage || hasParent || hasMediaBox)) {
      pageCount++;
      console.log(`--- Page Object ${objNum} ---`);

      // Show /Contents
      const contentsMatch = dictContent.match(/\/Contents\s+(\d+)\s+0\s+R/);
      const contentsArrayMatch = dictContent.match(/\/Contents\s*\[([\s\S]*?)\]/);
      if (contentsMatch) {
        console.log(`  /Contents: ${contentsMatch[1]} 0 R`);
      } else if (contentsArrayMatch) {
        console.log(`  /Contents: [${contentsArrayMatch[1].trim()}]`);
      }

      // Show /Resources
      const resourcesRefMatch = dictContent.match(/\/Resources\s+(\d+)\s+0\s+R/);
      const resourcesInlineMatch = dictContent.match(/\/Resources\s*<<([\s\S]*?)>>/);

      if (resourcesRefMatch) {
        const resourcesObjNum = parseInt(resourcesRefMatch[1]);
        console.log(`  /Resources: ${resourcesObjNum} 0 R (external reference)`);

        // Find the Resources object
        const resourcesObjRegex = new RegExp(`${resourcesObjNum}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>`);
        const resourcesMatch = rawContent.match(resourcesObjRegex);
        if (resourcesMatch) {
          const resourcesDict = resourcesMatch[1];

          // Check for /XObject
          const xobjInlineMatch = resourcesDict.match(/\/XObject\s*<<([\s\S]*?)>>/);
          const xobjRefMatch = resourcesDict.match(/\/XObject\s+(\d+)\s+0\s+R/);

          if (xobjInlineMatch) {
            console.log(`    /XObject (inline): << ${xobjInlineMatch[1].substring(0, 200).replace(/\s+/g, ' ')} ... >>`);
          } else if (xobjRefMatch) {
            console.log(`    /XObject: ${xobjRefMatch[1]} 0 R (external reference)`);

            // Find the XObject dictionary
            const xobjObjNum = parseInt(xobjRefMatch[1]);
            const xobjObjRegex = new RegExp(`${xobjObjNum}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>`);
            const xobjMatch = rawContent.match(xobjObjRegex);
            if (xobjMatch) {
              console.log(`      XObject dict: << ${xobjMatch[1].substring(0, 300).replace(/\s+/g, ' ')} ... >>`);
            }
          } else {
            console.log(`    No /XObject found in Resources`);
          }
        }
      } else if (resourcesInlineMatch) {
        console.log(`  /Resources: << (inline) >>`);
        const resourcesDict = resourcesInlineMatch[1];
        const xobjMatch = resourcesDict.match(/\/XObject\s*<<([\s\S]*?)>>/);
        if (xobjMatch) {
          console.log(`    /XObject: << ${xobjMatch[1].substring(0, 200).replace(/\s+/g, ' ')} ... >>`);
        }
      } else {
        console.log(`  No /Resources found directly - might inherit from parent`);
      }

      console.log();

      if (pageCount >= 3) {
        console.log('(Showing first 3 pages only...)\n');
        break;
      }
    }
  }

  // Also check for any /XObject dictionaries in the document
  console.log('\n=== All XObject Dictionaries Found ===\n');
  const xobjDictRegex = /\/XObject\s*<<([^>]+)>>/g;
  let xobjCount = 0;
  while ((match = xobjDictRegex.exec(rawContent)) !== null) {
    xobjCount++;
    if (xobjCount <= 5) {
      console.log(`XObject dict ${xobjCount}: << ${match[1].substring(0, 200).replace(/\s+/g, ' ')} >>`);
    }
  }
  console.log(`Total XObject dictionaries: ${xobjCount}`);

  console.log('\n=== Done ===\n');
}

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: npx ts-node scripts/debug-pdf-structure.ts <pdf-path>');
  process.exit(1);
}

debugPdfStructure(pdfPath).catch(console.error);
