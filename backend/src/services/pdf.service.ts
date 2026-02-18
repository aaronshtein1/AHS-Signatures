import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';

export interface Placeholder {
  type: 'SIGNATURE' | 'DATE' | 'TEXT';
  role: string;
  fieldName?: string;
  originalTag: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TagLocation {
  tag: string;
  pageIndex: number;
  x: number;
  y: number;
  streamIndex: number;
}

/**
 * Extract text positions from PDF content stream using regex-based approach.
 * Finds tags and extracts their x,y coordinates from the text matrix.
 */
function extractTagPositionsFromStream(streamContent: string, tagPatterns: RegExp[]): Array<{text: string, x: number, y: number}> {
  const results: Array<{text: string, x: number, y: number}> = [];

  // Method 1: Find all (text)Tj patterns and look for preceding Tm
  const textShowRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g;
  let match;

  while ((match = textShowRegex.exec(streamContent)) !== null) {
    let text = match[1];

    // Decode escape sequences
    text = text.replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
    text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
    text = text.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');

    // Check if this text contains a tag
    let isTag = false;
    for (const pattern of tagPatterns) {
      if (pattern.test(text)) {
        isTag = true;
        break;
      }
    }

    if (!isTag) continue;

    // Look for the most recent Tm before this text
    const beforeText = streamContent.substring(0, match.index);

    // Find all Tm operators (text matrix: a b c d e f Tm)
    const tmRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+Tm/g;
    let lastTm: RegExpExecArray | null = null;
    let tmMatch;
    while ((tmMatch = tmRegex.exec(beforeText)) !== null) {
      lastTm = tmMatch;
    }

    // Also look for cm (current transformation matrix)
    const cmRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+cm/g;
    let lastCm: RegExpExecArray | null = null;
    let cmMatch;
    while ((cmMatch = cmRegex.exec(beforeText)) !== null) {
      lastCm = cmMatch;
    }

    // Extract position
    let x = 0;
    let y = 0;

    if (lastTm) {
      // Tm sets text matrix: a b c d e f where e=x, f=y
      x = parseFloat(lastTm[5]);
      y = parseFloat(lastTm[6]);

      // If there's a cm matrix, we might need to apply it
      // But for most cases, Tm gives us the direct position
    }

    // Also check for Td/TD operators that modify position after Tm
    if (lastTm) {
      const afterTm = beforeText.substring(lastTm.index + lastTm[0].length);
      const tdRegex = /([\d.+-]+)\s+([\d.+-]+)\s+T[dD]/g;
      let tdMatch;
      while ((tdMatch = tdRegex.exec(afterTm)) !== null) {
        x += parseFloat(tdMatch[1]);
        y += parseFloat(tdMatch[2]);
      }
    }

    // If x and y are still 0 or very small, the position might be in cm matrix
    if ((x === 0 || Math.abs(x) < 50) && lastCm) {
      const cmX = parseFloat(lastCm[5]);
      const cmY = parseFloat(lastCm[6]);
      if (cmX > 50 || cmY > 50) {
        x = cmX;
        y = cmY;
      }
    }

    results.push({ text, x, y });
  }

  // Method 2: Also try TJ array format: [(text1) kern (text2)] TJ
  const tjArrayRegex = /\[((?:\([^)]*\)|[\d.-]+\s*)+)\]\s*TJ/gi;
  while ((match = tjArrayRegex.exec(streamContent)) !== null) {
    const arrayContent = match[1];

    // Extract all text strings from the array
    const stringRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let fullText = '';
    let strMatch;
    while ((strMatch = stringRegex.exec(arrayContent)) !== null) {
      let text = strMatch[1];
      text = text.replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
      text = text.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
      text = text.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
      fullText += text;
    }

    // Check if combined text contains a tag
    let isTag = false;
    for (const pattern of tagPatterns) {
      if (pattern.test(fullText)) {
        isTag = true;
        break;
      }
    }

    if (!isTag) continue;

    // Already processed or get position
    const existing = results.find(r => r.text === fullText);
    if (existing) continue;

    // Look for Tm before this TJ
    const beforeText = streamContent.substring(0, match.index);
    const tmRegex = /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+Tm/g;
    let lastTm: RegExpExecArray | null = null;
    let tmMatch;
    while ((tmMatch = tmRegex.exec(beforeText)) !== null) {
      lastTm = tmMatch;
    }

    let x = 0, y = 0;
    if (lastTm) {
      x = parseFloat(lastTm[5]);
      y = parseFloat(lastTm[6]);
    }

    results.push({ text: fullText, x, y });
  }

  return results;
}

/**
 * Find XObject name to object number mappings per page.
 * Returns a map: pageObjNum -> Map<xobjectName, objNum>
 * This ensures XObject names are scoped to their correct page context.
 */
function findXObjectMappingsPerPage(rawContent: string): Map<number, Map<string, number>> {
  const perPageMappings = new Map<number, Map<string, number>>();

  // Helper to extract XObject entries from a dictionary string
  const extractXObjects = (dictContent: string): Map<string, number> => {
    const mappings = new Map<string, number>();
    const xobjMatch = dictContent.match(/\/XObject\s*<<([\s\S]*?)>>/);
    if (xobjMatch) {
      const xobjDict = xobjMatch[1];
      const entryRegex = /\/(\w+)\s+(\d+)\s+0\s+R/g;
      let entryMatch;
      while ((entryMatch = entryRegex.exec(xobjDict)) !== null) {
        mappings.set(entryMatch[1], parseInt(entryMatch[2]));
      }
    }
    return mappings;
  };

  // Helper to find an object's dictionary content
  const findObjDict = (objNum: number): string | null => {
    // Handle various PDF object formats
    const patterns = [
      new RegExp(`${objNum}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>\\s*(?:stream|endobj)`, 's'),
      new RegExp(`${objNum}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>`, 's'),
    ];
    for (const pattern of patterns) {
      const match = rawContent.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  // Find all Page objects
  const pageObjRegex = /(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>/g;
  let match;

  while ((match = pageObjRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const dictContent = match[2];

    // Check if this is a Page object
    const hasMediaBox = dictContent.includes('/MediaBox') || dictContent.includes('/CropBox');
    const isTypePage = dictContent.includes('/Type') && dictContent.includes('/Page') && !dictContent.includes('/Pages');
    const hasParent = dictContent.includes('/Parent');
    const hasContents = dictContent.includes('/Contents');

    if ((hasMediaBox || isTypePage || hasParent) && hasContents) {
      const pageMappings = new Map<string, number>();

      // Try inline Resources with XObject
      let xobjects = extractXObjects(dictContent);
      for (const [name, num] of xobjects) {
        pageMappings.set(name, num);
      }

      // Check if Resources is a reference
      const resourcesRefMatch = dictContent.match(/\/Resources\s+(\d+)\s+0\s+R/);
      if (resourcesRefMatch) {
        const resourcesObjNum = parseInt(resourcesRefMatch[1]);
        const resourcesDict = findObjDict(resourcesObjNum);
        if (resourcesDict) {
          xobjects = extractXObjects(resourcesDict);
          for (const [name, num] of xobjects) {
            pageMappings.set(name, num);
          }

          // XObject might also be a reference inside Resources
          const xobjRefMatch = resourcesDict.match(/\/XObject\s+(\d+)\s+0\s+R/);
          if (xobjRefMatch) {
            const xobjObjNum = parseInt(xobjRefMatch[1]);
            const xobjDict = findObjDict(xobjObjNum);
            if (xobjDict) {
              const entryRegex = /\/(\w+)\s+(\d+)\s+0\s+R/g;
              let entryMatch;
              while ((entryMatch = entryRegex.exec(xobjDict)) !== null) {
                pageMappings.set(entryMatch[1], parseInt(entryMatch[2]));
              }
            }
          }
        }
      }

      if (pageMappings.size > 0) {
        perPageMappings.set(objNum, pageMappings);
        console.log(`[PDF] Page obj ${objNum}: Found ${pageMappings.size} XObject mappings`);
      }
    }
  }

  return perPageMappings;
}

/**
 * Find XObject name to object number mappings in all resource dictionaries.
 * Returns ALL mappings (same name can map to different objects in different dictionaries).
 */
function findXObjectMappings(rawContent: string): Map<string, number[]> {
  const mappings = new Map<string, number[]>();

  // Look for /XObject << /Name N 0 R ... >> patterns
  const xobjRegex = /\/XObject\s*<<([^>]+)>>/g;
  let match;

  while ((match = xobjRegex.exec(rawContent)) !== null) {
    const dictContent = match[1];
    const entryRegex = /\/(\w+)\s+(\d+)\s+0\s+R/g;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(dictContent)) !== null) {
      const name = entryMatch[1];
      const objNum = parseInt(entryMatch[2]);
      const existing = mappings.get(name) || [];
      if (!existing.includes(objNum)) {
        existing.push(objNum);
        mappings.set(name, existing);
      }
    }
  }

  return mappings;
}

/**
 * Find where Form XObjects are placed on pages by looking for transformation + Do patterns.
 * The cm operator provides the x,y position where the XObject is drawn.
 *
 * Strategy: Since XObject names can map to different objects in different dictionaries,
 * we need to figure out which dictionary is active for each page. We do this by:
 * 1. Finding all XObject dictionaries in the PDF
 * 2. For each page's content stream, checking which dictionary's objects are being used
 * 3. Using that dictionary's mappings for that page
 */
function findXObjectPlacements(
  rawContent: string,
  pageObjToIndex: Map<number, number>,
  streamToPageObj: Map<number, number>,
  perPageMappings: Map<number, Map<string, number>>,
  globalXobjectMap: Map<string, number[]>
): Map<number, { pageIndex: number; x: number; y: number }> {
  const placements = new Map<number, { pageIndex: number; x: number; y: number }>();

  // First, build a list of all XObject dictionaries (each mapping name->objNum)
  const allXobjectDicts: Map<string, number>[] = [];
  const xobjDictRegex = /\/XObject\s*<<([^>]+)>>/g;
  let dictMatch;
  while ((dictMatch = xobjDictRegex.exec(rawContent)) !== null) {
    const dictContent = dictMatch[1];
    const dictMap = new Map<string, number>();
    const entryRegex = /\/(\w+)\s+(\d+)\s+0\s+R/g;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(dictContent)) !== null) {
      dictMap.set(entryMatch[1], parseInt(entryMatch[2]));
    }
    if (dictMap.size > 0) {
      allXobjectDicts.push(dictMap);
    }
  }

  console.log(`[PDF] Found ${allXobjectDicts.length} XObject dictionaries`);

  // Process each page's content stream
  for (const [contentObjNum, pageObjNum] of streamToPageObj.entries()) {
    const pageIndex = pageObjToIndex.get(pageObjNum) ?? 0;

    // Find this content stream
    const objRegex = new RegExp(`${contentObjNum}\\s+0\\s+obj[\\s\\S]*?stream\\r?\\n([\\s\\S]*?)endstream`);
    const objMatch = rawContent.match(objRegex);
    if (!objMatch) continue;

    let streamContent: string;
    try {
      const buf = Buffer.from(objMatch[1], 'latin1');
      streamContent = zlib.inflateSync(buf).toString('latin1');
    } catch {
      streamContent = objMatch[1];
    }

    // Find all Do operators in this stream
    const doPatterns = [
      /([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+cm\s*\/(\w+)\s+Do/g,
      /q\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+cm\s*\/(\w+)\s+Do/g,
    ];

    // Collect all Do operators with their positions and names
    const doOperators: Array<{ x: number; y: number; name: string }> = [];
    for (const pattern of doPatterns) {
      let doMatch;
      while ((doMatch = pattern.exec(streamContent)) !== null) {
        doOperators.push({
          x: parseFloat(doMatch[5]),
          y: parseFloat(doMatch[6]),
          name: doMatch[7],
        });
      }
    }

    // For each Do operator, find which XObject dictionary has this name
    // and assign the position to that dictionary's object
    for (const op of doOperators) {
      // Try each XObject dictionary
      for (const dict of allXobjectDicts) {
        const objNum = dict.get(op.name);
        if (objNum !== undefined && !placements.has(objNum)) {
          placements.set(objNum, { pageIndex, x: op.x, y: op.y });
        }
      }
    }
  }

  return placements;
}

/**
 * Build a map from page object number to page index, and stream object to page object.
 */
function buildPageMaps(rawContent: string): {
  pageObjToIndex: Map<number, number>;
  streamToPageObj: Map<number, number>;
  streamToPageIndex: Map<number, number>;
} {
  const pageObjToIndex = new Map<number, number>();
  const streamToPageObj = new Map<number, number>();
  const streamToPageIndex = new Map<number, number>();

  const pageObjects: Array<{ objNum: number; contentsRefs: number[] }> = [];

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
        pageObjects.push({ objNum, contentsRefs });
      }
    }
  }

  pageObjects.sort((a, b) => a.objNum - b.objNum);

  pageObjects.forEach((page, pageIndex) => {
    pageObjToIndex.set(page.objNum, pageIndex);
    for (const contentRef of page.contentsRefs) {
      streamToPageObj.set(contentRef, page.objNum);
      streamToPageIndex.set(contentRef, pageIndex);
    }
  });

  return { pageObjToIndex, streamToPageObj, streamToPageIndex };
}

/**
 * Find ALL tag locations in the PDF by parsing content streams.
 * IMPORTANT: Returns ALL positions for each tag, not just one.
 * Tags can appear multiple times and need to be stamped at ALL positions.
 */
async function findTagLocations(pdfBytes: Buffer): Promise<TagLocation[]> {
  const rawContent = pdfBytes.toString('latin1');
  const locations: TagLocation[] = [];

  const tagPatterns = [
    /\{\{\*?[^}]+_es_:[^}]*\}\}/,
    /\[\[(SIGNATURE|DATE|TEXT):[^\]]+\]\]/,
  ];

  // Build page mappings
  const { pageObjToIndex, streamToPageObj, streamToPageIndex } = buildPageMaps(rawContent);
  console.log(`[PDF] Found ${pageObjToIndex.size} pages`);

  // Build per-page XObject mappings (properly scoped)
  const perPageMappings = findXObjectMappingsPerPage(rawContent);
  console.log(`[PDF] Found XObject mappings for ${perPageMappings.size} pages`);

  // Also get global mappings as fallback
  const globalXobjectMap = findXObjectMappings(rawContent);
  console.log(`[PDF] Found ${globalXobjectMap.size} global XObject mappings`);

  // Find where each XObject is placed on pages (using scoped mappings)
  const xobjectPlacements = findXObjectPlacements(
    rawContent,
    pageObjToIndex,
    streamToPageObj,
    perPageMappings,
    globalXobjectMap
  );
  console.log(`[PDF] Found ${xobjectPlacements.size} XObject placements`);

  // Find all streams containing tags
  const objStreamRegex = /(\d+)\s+0\s+obj[\s\S]*?stream\r?\n([\s\S]*?)endstream/g;
  let match;

  while ((match = objStreamRegex.exec(rawContent)) !== null) {
    const objNum = parseInt(match[1]);
    const streamData = match[2];

    try {
      if (streamData.length > 500000) continue;

      const streamBuffer = Buffer.from(streamData, 'latin1');
      let decompressedText: string;

      try {
        const decompressed = zlib.inflateSync(streamBuffer);
        decompressedText = decompressed.toString('latin1');
      } catch {
        decompressedText = streamData;
      }

      // Find all tags in this stream
      const foundTags: string[] = [];
      for (const pattern of tagPatterns) {
        const matches = decompressedText.match(pattern);
        if (matches) foundTags.push(...matches);
      }

      if (foundTags.length === 0) continue;

      // Determine position based on whether this is a page content or XObject
      let pageIndex = 0;
      let baseX = 0;
      let baseY = 0;
      let hasValidPosition = false;

      if (streamToPageIndex.has(objNum)) {
        // This is a page content stream - use positions from Tm/cm in the stream
        pageIndex = streamToPageIndex.get(objNum)!;
        const tagResults = extractTagPositionsFromStream(decompressedText, tagPatterns);
        for (const result of tagResults) {
          baseX = result.x;
          baseY = result.y;
          hasValidPosition = (baseX > 20 || baseY > 50);
          break;
        }
      } else {
        // This is likely a Form XObject - get placement from our map
        const placement = xobjectPlacements.get(objNum);
        if (placement) {
          pageIndex = placement.pageIndex;
          baseX = placement.x;
          baseY = placement.y;
          hasValidPosition = (baseX > 20 || baseY > 50);
          console.log(`[PDF] XObject ${objNum} at page ${pageIndex + 1}, (${baseX.toFixed(1)}, ${baseY.toFixed(1)})`);
        }
      }

      // Skip positions that are clearly invalid (0,0 or near origin)
      if (!hasValidPosition) {
        console.log(`[PDF] Skipping stream ${objNum} - invalid position (${baseX.toFixed(1)}, ${baseY.toFixed(1)})`);
        continue;
      }

      // Add ALL tags with their positions - NO deduplication!
      // Each tag instance at each position gets added
      for (const tag of foundTags) {
        locations.push({
          tag,
          pageIndex,
          x: baseX,
          y: baseY,
          streamIndex: objNum,
        });
      }
    } catch (err) {
      console.error(`[PDF] Error processing stream ${objNum}:`, err);
    }
  }

  console.log(`[PDF] Found ${locations.length} total tag positions`);

  // Group by tag for summary
  const tagCounts = new Map<string, number>();
  for (const loc of locations) {
    const shortTag = loc.tag.substring(0, 30);
    tagCounts.set(shortTag, (tagCounts.get(shortTag) || 0) + 1);
  }
  for (const [tag, count] of tagCounts.entries()) {
    console.log(`  - "${tag}...": ${count} positions`);
  }

  return locations;
}

/**
 * Parse PDF and extract placeholder tags with their positions.
 * IMPORTANT: Creates a placeholder for EACH tag position found.
 * Tags that appear multiple times will have multiple placeholders.
 */
export async function parseTemplatePlaceholders(pdfPath: string): Promise<Placeholder[]> {
  const pdfBytes = await fs.readFile(pdfPath);
  const placeholders: Placeholder[] = [];

  // Find ALL tag locations with their positions
  const tagLocations = await findTagLocations(pdfBytes);

  console.log(`[PDF] Creating placeholders for ${tagLocations.length} tag positions`);

  // Helper to parse tag and determine type/role/fieldName
  const parseTag = (tag: string): { type: 'SIGNATURE' | 'DATE' | 'TEXT', role: string, fieldName?: string } | null => {
    // Custom format: [[TYPE:identifier]]
    const customMatch = tag.match(/\[\[(SIGNATURE|DATE|TEXT):([^\]]+)\]\]/);
    if (customMatch) {
      const type = customMatch[1] as 'SIGNATURE' | 'DATE' | 'TEXT';
      return {
        type,
        role: type === 'TEXT' ? 'signer' : customMatch[2],
        fieldName: type === 'TEXT' ? customMatch[2] : undefined,
      };
    }

    // Adobe Sign signature: {{Sig_es_:signer1:signature}}
    const sigMatch = tag.match(/\{\{\*?Sig\d*_es_:(\w+):signature\}\}/);
    if (sigMatch) {
      return { type: 'SIGNATURE', role: sigMatch[1] };
    }

    // Adobe Sign date: {{*Dte1_es_:date}} or {{*Date_es_:signer}}
    const dateMatch = tag.match(/\{\{\*?(?:Date\w*|Dte\d*)_es_:(\w+)?(?::date)?\}\}/);
    if (dateMatch && (tag.toLowerCase().includes('date') || tag.toLowerCase().includes('dte'))) {
      const role = dateMatch[1] && dateMatch[1] !== 'date' ? dateMatch[1] : 'signer';
      const fieldNameMatch = tag.match(/\{\{\*?(\w+)_es_/);
      return {
        type: 'DATE',
        role,
        fieldName: fieldNameMatch ? fieldNameMatch[1] : 'Date',
      };
    }

    // Adobe Sign initials: {{Int_es_:signer1:initials}}
    const initMatch = tag.match(/\{\{\*?Int\d*_es_:(\w+)(?::initials)?\}\}/i);
    if (initMatch) {
      return { type: 'TEXT', role: initMatch[1], fieldName: 'Int' };
    }

    // Adobe Sign text fields: {{*Lic#_es_:signer}}
    const textMatch = tag.match(/\{\{\*?([^_]+)_es_:(\w+)(?::[^}]*)?\}\}/);
    if (textMatch) {
      const fieldName = textMatch[1];
      const role = textMatch[2];
      // Skip if it's actually a signature or date
      if (tag.includes(':signature') || tag.includes(':date')) return null;
      if (fieldName.startsWith('Sig') || fieldName.startsWith('Date') || fieldName.startsWith('Dte')) return null;
      return { type: 'TEXT', role, fieldName };
    }

    return null;
  };

  // Create a placeholder for EACH tag location
  for (const loc of tagLocations) {
    const parsed = parseTag(loc.tag);
    if (!parsed) {
      console.log(`[PDF] Could not parse tag: ${loc.tag.substring(0, 50)}`);
      continue;
    }

    placeholders.push({
      type: parsed.type,
      role: parsed.role,
      fieldName: parsed.fieldName,
      originalTag: loc.tag,
      pageNumber: loc.pageIndex + 1,
      x: loc.x,
      y: loc.y,
      width: parsed.type === 'SIGNATURE' ? 200 : parsed.type === 'DATE' ? 100 : 150,
      height: parsed.type === 'SIGNATURE' ? 50 : 20,
    });
  }

  console.log(`[PDF] Created ${placeholders.length} placeholders from ${pdfPath}`);

  // Summary by type
  const typeCounts = new Map<string, number>();
  for (const p of placeholders) {
    const key = `${p.type}:${p.fieldName || p.role}`;
    typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
  }
  for (const [key, count] of typeCounts.entries()) {
    console.log(`  - ${key}: ${count} positions`);
  }

  return placeholders;
}

/**
 * Get unique roles from placeholders
 */
export function getUniqueRoles(placeholders: Placeholder[]): string[] {
  const roles = new Set<string>();
  for (const p of placeholders) {
    if (p.type !== 'TEXT' || p.role !== 'any') {
      roles.add(p.role);
    }
  }
  return Array.from(roles);
}

interface SignatureData {
  signatureImage?: string;
  typedName: string;
  signatureType: 'drawn' | 'typed';
  textFields?: Record<string, string>;
}

interface StampConfig {
  role: string;
  signatureData: SignatureData;
  timestamp: Date;
}

/**
 * Helper to parse a tag and get its type, role, and field name.
 */
function parseTagInfo(tag: string): { type: 'SIGNATURE' | 'DATE' | 'TEXT', role: string, fieldName?: string } | null {
  // Adobe Sign signature: {{Sig_es_:signer1:signature}}
  const sigMatch = tag.match(/\{\{\*?Sig\d*_es_:(\w+):signature\}\}/);
  if (sigMatch) {
    return { type: 'SIGNATURE', role: sigMatch[1] };
  }

  // Adobe Sign date: {{*Dte1_es_:date}} or similar
  const dateMatch = tag.match(/\{\{\*?(?:Date\w*|Dte\d*)_es_:(\w+)?(?::date)?\}\}/);
  if (dateMatch && (tag.toLowerCase().includes('date') || tag.toLowerCase().includes('dte'))) {
    const role = dateMatch[1] && dateMatch[1] !== 'date' ? dateMatch[1] : 'signer';
    const fieldNameMatch = tag.match(/\{\{\*?(\w+)_es_/);
    return { type: 'DATE', role, fieldName: fieldNameMatch ? fieldNameMatch[1] : 'Date' };
  }

  // Adobe Sign initials: {{Int_es_:signer1:initials}}
  const initMatch = tag.match(/\{\{\*?Int\d*_es_:(\w+)(?::initials)?\}\}/i);
  if (initMatch) {
    return { type: 'TEXT', role: initMatch[1], fieldName: 'Int' };
  }

  // Adobe Sign text fields: {{*Lic#_es_:signer}}
  const textMatch = tag.match(/\{\{\*?([^_]+)_es_:(\w+)(?::[^}]*)?\}\}/);
  if (textMatch) {
    const fieldName = textMatch[1];
    const role = textMatch[2];
    if (tag.includes(':signature') || tag.includes(':date')) return null;
    if (fieldName.startsWith('Sig') || fieldName.startsWith('Date') || fieldName.startsWith('Dte')) return null;
    return { type: 'TEXT', role, fieldName };
  }

  // Custom format: [[TYPE:identifier]]
  const customMatch = tag.match(/\[\[(SIGNATURE|DATE|TEXT):([^\]]+)\]\]/);
  if (customMatch) {
    const type = customMatch[1] as 'SIGNATURE' | 'DATE' | 'TEXT';
    return { type, role: type === 'TEXT' ? 'signer' : customMatch[2], fieldName: type === 'TEXT' ? customMatch[2] : undefined };
  }

  return null;
}

/**
 * Replace tags in PDF content streams with actual values.
 * This replaces tags IN-PLACE, preserving the original position and transformation.
 * Values are rendered in blue color.
 */
async function replaceTagsWithValues(
  pdfBytes: Buffer,
  valueMap: Map<string, string>
): Promise<Buffer> {
  let content = pdfBytes.toString('latin1');
  let replacementsCount = 0;

  // Tag patterns to find
  const tagPatternSources = [
    '\\{\\{\\*?[^}]+_es_:[^}]*\\}\\}',
    '\\[\\[(SIGNATURE|DATE|TEXT):[^\\]]+\\]\\]',
  ];

  // Helper to get replacement value and type for a tag
  const getReplacementInfo = (tag: string): { value: string; type: 'SIGNATURE' | 'DATE' | 'TEXT' } | null => {
    const info = parseTagInfo(tag);
    if (!info) return null;

    // Build lookup key
    let key = '';
    if (info.type === 'SIGNATURE') {
      key = `SIGNATURE:${info.role}`;
    } else if (info.type === 'DATE') {
      key = `DATE:${info.fieldName || 'Date'}`;
    } else if (info.type === 'TEXT') {
      key = `TEXT:${info.fieldName || info.role}`;
    }

    const value = valueMap.get(key);
    if (value) {
      return { value, type: info.type };
    }
    return null;
  };

  // Helper to escape special chars for PDF string
  const escapePdfString = (s: string): string => {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  };

  // Replace in compressed streams - find (tag)Tj patterns and style appropriately
  const streamRegex = /stream(\r?\n)([\s\S]*?)(\r?\n)endstream/g;
  const streamReplacements: { start: number; end: number; newContent: string }[] = [];

  let match;
  while ((match = streamRegex.exec(content)) !== null) {
    try {
      const streamData = Buffer.from(match[2], 'latin1');
      if (streamData.length > 500000) continue;

      let decompressed: Buffer;
      try {
        decompressed = zlib.inflateSync(streamData);
      } catch {
        continue;
      }

      let text = decompressed.toString('latin1');
      let modified = false;

      // Find and replace (tag)Tj patterns with styled text
      for (const patternSource of tagPatternSources) {
        // Match the tag inside parentheses followed by Tj
        const tjPattern = new RegExp(`\\((${patternSource})\\)\\s*Tj`, 'g');
        text = text.replace(tjPattern, (fullMatch, tag) => {
          const info = getReplacementInfo(tag);
          if (info) {
            modified = true;
            replacementsCount++;

            if (info.type === 'SIGNATURE') {
              // Signature: blue color with italic slant for handwritten look
              // q = save state, cm applies transformation matrix (1 0 0.2 1 0 0 = italic shear)
              // The matrix [1 0 0.2 1 0 0] creates a 12-degree italic slant
              return `q 1 0 0.2 1 0 0 cm 0 0 0.8 rg (${escapePdfString(info.value)}) Tj Q 0 0 0 rg`;
            } else {
              // Other fields: just blue color
              return `0 0 1 rg (${escapePdfString(info.value)}) Tj 0 0 0 rg`;
            }
          }
          return fullMatch;
        });

        // Also handle tags that might just be in the stream without Tj (less common)
        const standalonePattern = new RegExp(patternSource, 'g');
        text = text.replace(standalonePattern, (tag) => {
          // Only replace if not already handled
          const info = getReplacementInfo(tag);
          if (info) {
            modified = true;
            replacementsCount++;
            return info.value;
          }
          return tag;
        });
      }

      if (modified) {
        const recompressed = zlib.deflateSync(Buffer.from(text, 'latin1'));
        streamReplacements.push({
          start: match.index,
          end: match.index + match[0].length,
          newContent: `stream${match[1]}${recompressed.toString('latin1')}${match[3]}endstream`,
        });
      }
    } catch {
      // Skip
    }
  }

  // Apply stream replacements in reverse order
  let result = content;
  for (let i = streamReplacements.length - 1; i >= 0; i--) {
    const r = streamReplacements[i];
    result = result.substring(0, r.start) + r.newContent + result.substring(r.end);
  }

  // Also replace in uncompressed content (raw PDF)
  for (const patternSource of tagPatternSources) {
    const pattern = new RegExp(patternSource, 'g');
    result = result.replace(pattern, (tag) => {
      const info = getReplacementInfo(tag);
      if (info) {
        replacementsCount++;
        return info.value;
      }
      return tag;
    });
  }

  console.log(`[PDF] Replaced ${replacementsCount} tags with values (styled)`);
  return Buffer.from(result, 'latin1');
}

/**
 * Stamp signatures and form data onto PDF by replacing tags IN-PLACE.
 * This approach replaces the tag text directly in the content streams,
 * preserving the original position, rotation, and transformation.
 */
export async function stampSignature(
  pdfPath: string,
  stamps: StampConfig[],
  placeholders: Placeholder[]
): Promise<Uint8Array> {
  const originalPdfBytes = await fs.readFile(pdfPath);

  // Build a map of tag types to values
  const valueMap = new Map<string, string>();

  for (const stamp of stamps) {
    console.log(`[PDF] Building value map for role: ${stamp.role}`);

    // Signature value
    valueMap.set(`SIGNATURE:${stamp.role}`, stamp.signatureData.typedName);
    valueMap.set('SIGNATURE:signer', stamp.signatureData.typedName);
    valueMap.set('SIGNATURE:signer1', stamp.signatureData.typedName);

    // Date value
    const dateValue = stamp.signatureData.textFields?.['Dte1']
      || stamp.signatureData.textFields?.['Date']
      || stamp.timestamp.toLocaleDateString('en-US');
    valueMap.set('DATE:Dte1', dateValue);
    valueMap.set('DATE:Date', dateValue);
    valueMap.set('DATE:date', dateValue);

    // Text fields (initials, license, etc.)
    if (stamp.signatureData.textFields) {
      for (const [fieldName, value] of Object.entries(stamp.signatureData.textFields)) {
        valueMap.set(`TEXT:${fieldName}`, value);
      }
    }
  }

  console.log('[PDF] Value map:', Object.fromEntries(valueMap));

  // Step 1: Replace tags with values IN-PLACE
  console.log('[PDF] Replacing tags with values in-place...');
  const modifiedPdfBytes = await replaceTagsWithValues(originalPdfBytes, valueMap);

  // Step 2: Load the modified PDF (no footer added - just save it)
  const pdfDoc = await PDFDocument.load(modifiedPdfBytes);

  console.log('[PDF] Stamping complete');

  return pdfDoc.save();
}

/**
 * Save stamped PDF to disk
 */
export async function saveStampedPdf(
  pdfBytes: Uint8Array,
  packetId: string
): Promise<string> {
  const signedDir = path.join(process.cwd(), 'signed');

  try {
    await fs.mkdir(signedDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  const fileName = `signed_${packetId}_${Date.now()}.pdf`;
  const filePath = path.join(signedDir, fileName);
  await fs.writeFile(filePath, pdfBytes);
  return filePath;
}

/**
 * Create a PDF with sample placeholders for demo purposes
 */
export async function createSampleTemplate(name: string, roles: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawText(name, {
    x: 50,
    y: 720,
    size: 24,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  page.drawText('This document requires signatures from the following parties:', {
    x: 50,
    y: 680,
    size: 12,
    font: font,
    color: rgb(0, 0, 0),
  });

  let yPos = 620;

  for (const role of roles) {
    page.drawText(`${role.charAt(0).toUpperCase() + role.slice(1)} Signature:`, {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    page.drawText(`[[SIGNATURE:${role}]]`, {
      x: 50,
      y: yPos - 25,
      size: 10,
      font: font,
      color: rgb(0.6, 0.6, 0.6),
    });

    page.drawLine({
      start: { x: 50, y: yPos - 40 },
      end: { x: 250, y: yPos - 40 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });

    page.drawText('Date:', {
      x: 300,
      y: yPos - 25,
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });

    page.drawText(`[[DATE:${role}]]`, {
      x: 340,
      y: yPos - 25,
      size: 10,
      font: font,
      color: rgb(0.6, 0.6, 0.6),
    });

    yPos -= 100;
  }

  page.drawText('This is a sample document for demonstration purposes.', {
    x: 50,
    y: 50,
    size: 10,
    font: font,
    color: rgb(0.5, 0.5, 0.5),
  });

  return pdfDoc.save();
}
