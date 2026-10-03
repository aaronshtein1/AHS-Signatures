/**
 * Pure helpers for matching an employee name to an existing SharePoint folder.
 * Kept free of DB / network imports so they can be unit tested directly.
 */

export interface NamedFolder {
  name: string;
}

export interface FolderMatch<T extends NamedFolder> {
  folder: T;
  confidence: number;
}

export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
}

/** Normalized name with its words sorted, so "Smith, John" and "John Smith" compare equal. */
export function nameKey(name: string): string {
  return normalizeName(name)
    .replace(/[-_]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function sequenceMatchRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const totalLength = a.length + b.length;

  function countMatches(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
    let bestLen = 0;
    let bestAStart = 0;
    let bestBStart = 0;

    for (let i = aStart; i < aEnd; i++) {
      for (let j = bStart; j < bEnd; j++) {
        let k = 0;
        while (i + k < aEnd && j + k < bEnd && a[i + k] === b[j + k]) k++;
        if (k > bestLen) {
          bestLen = k;
          bestAStart = i;
          bestBStart = j;
        }
      }
    }

    if (bestLen === 0) return 0;

    let matches = bestLen;
    if (bestAStart > aStart && bestBStart > bStart) {
      matches += countMatches(aStart, bestAStart, bStart, bestBStart);
    }
    const aRight = bestAStart + bestLen;
    const bRight = bestBStart + bestLen;
    if (aRight < aEnd && bRight < bEnd) {
      matches += countMatches(aRight, aEnd, bRight, bEnd);
    }
    return matches;
  }

  return (2.0 * countMatches(0, a.length, 0, b.length)) / totalLength;
}

function words(name: string): string[] {
  return nameKey(name).split(' ').filter(w => w.length >= 2);
}

/**
 * Word-by-word similarity: both names must have the same words (in any order),
 * each within `wordThreshold`, and at least one word identical. Returns 0 otherwise.
 */
function wordMatchScore(a: string[], b: string[], wordThreshold = 0.8): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const unused = [...b];
  let total = 0;
  let exact = 0;
  for (const w of a) {
    let bestIdx = -1;
    let best = 0;
    unused.forEach((u, i) => {
      const r = u === w ? 1 : sequenceMatchRatio(w, u);
      if (r > best) { best = r; bestIdx = i; }
    });
    if (bestIdx === -1 || best < wordThreshold) return 0;
    if (best === 1) exact++;
    total += best;
    unused.splice(bestIdx, 1);
  }
  return exact > 0 ? total / a.length : 0;
}

/**
 * Find the folder that best matches an employee name.
 * Word order, punctuation and middle initials are ignored ("Smith, John" ==
 * "John M. Smith"). A fuzzy match tolerates a typo in one word but requires the
 * other words to be identical, so different people are not merged.
 */
export function findBestFolderMatch<T extends NamedFolder>(
  employeeName: string,
  folders: T[],
  threshold: number = 0.85
): FolderMatch<T> | null {
  if (folders.length === 0) return null;

  const target = words(employeeName);
  if (target.length === 0) return null;
  const targetKey = target.join(' ');

  let bestMatch: FolderMatch<T> | null = null;

  for (const folder of folders) {
    const folderWords = words(folder.name);
    if (folderWords.length === 0) continue;
    if (folderWords.join(' ') === targetKey) return { folder, confidence: 1.0 };

    const score = wordMatchScore(target, folderWords);
    if (score >= threshold && (!bestMatch || score > bestMatch.confidence)) {
      bestMatch = { folder, confidence: score };
    }
  }

  return bestMatch;
}
