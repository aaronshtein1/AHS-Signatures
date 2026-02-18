const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// Get PDF path from command line or use default
const pdfPath = process.argv[2] || 'uploads/templates/f6c44627-726d-4b14-941e-2cc2c6462bbb_sign_document_0a87764e2b65bec9_withoutAudit_6968fc1ae500d5.51481649.pdf';

console.log('Analyzing PDF:', pdfPath);
console.log('');

const pdfBytes = fs.readFileSync(pdfPath);
const pdfContent = pdfBytes.toString('latin1');

// Find stream objects and try to decompress them
const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
let match;
let streamIndex = 0;
const foundTags = new Set();

while ((match = streamRegex.exec(pdfContent)) !== null) {
  streamIndex++;
  try {
    // Try to decompress if it's FlateDecode compressed
    const streamData = Buffer.from(match[1], 'latin1');
    const decompressed = zlib.inflateSync(streamData);
    const text = decompressed.toString('latin1');

    // Look for Adobe Sign tag patterns in the decompressed content
    // Adobe Sign tags look like: {{fieldName_es_:signer:type}}
    const tagPatterns = [
      /\{\{[^}]*_es_[^}]*\}\}/g,
      /\{\{[^}]+\}\}/g,
    ];

    for (const pattern of tagPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const m of matches) {
          foundTags.add(m);
        }
      }
    }

    // Also check for partial tags in text operations
    // PDF text can be split across multiple (string) Tj operations
    if (text.includes('_es_') || text.includes('signer')) {
      // Extract all parenthesized strings (PDF text content)
      const textStrings = text.match(/\(([^)]*)\)/g);
      if (textStrings) {
        const joinedText = textStrings.map(s => s.slice(1, -1)).join('');
        // Look for tags in joined text
        const joinedMatches = joinedText.match(/\{\{[^}]+\}\}/g);
        if (joinedMatches) {
          for (const m of joinedMatches) {
            foundTags.add(m);
          }
        }
      }
    }
  } catch (e) {
    // Not FlateDecode compressed, check raw content
    const text = match[1];
    const tagPatterns = [
      /\{\{[^}]*_es_[^}]*\}\}/g,
      /\{\{[^}]+\}\}/g,
    ];

    for (const pattern of tagPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const m of matches) {
          foundTags.add(m);
        }
      }
    }
  }
}

console.log('Total streams processed:', streamIndex);
console.log('');
console.log('=== Found Adobe Sign Tags ===');
if (foundTags.size === 0) {
  console.log('No tags found in decompressed streams');

  // Try a different approach - search the entire raw PDF
  console.log('');
  console.log('=== Searching raw PDF bytes ===');

  // Search for common Adobe Sign tag parts
  const searchTerms = ['_es_', 'signer', 'Sig_es_', 'Dte_es_', 'Title', '{{', '}}'];
  for (const term of searchTerms) {
    const count = (pdfContent.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    console.log(`"${term}": ${count} occurrences`);
  }
} else {
  for (const tag of foundTags) {
    console.log(' ', tag);
  }
}

// Also check for form fields / AcroForm
console.log('');
console.log('=== Checking for PDF Form Fields ===');
if (pdfContent.includes('/AcroForm')) {
  console.log('PDF contains AcroForm (interactive form fields)');

  // Find field names
  const fieldNameMatch = pdfContent.match(/\/T\s*\(([^)]+)\)/g);
  if (fieldNameMatch) {
    console.log('Form field names found:');
    for (const fn of fieldNameMatch.slice(0, 20)) {
      console.log('  ', fn);
    }
  }
} else {
  console.log('No AcroForm found');
}

// Check for annotations
console.log('');
console.log('=== Checking for Annotations ===');
const annotCount = (pdfContent.match(/\/Annot/g) || []).length;
console.log('Annotation references:', annotCount);
