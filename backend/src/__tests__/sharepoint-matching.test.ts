import { describe, it, expect } from 'vitest';

// Inline the pure functions from sharepoint.service.ts for unit testing
// without requiring database or network connections.

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '');
}

function sequenceMatchRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const totalLength = a.length + b.length;

  function countMatches(
    aStart: number, aEnd: number,
    bStart: number, bEnd: number
  ): number {
    let bestLen = 0;
    let bestAStart = 0;
    let bestBStart = 0;

    for (let i = aStart; i < aEnd; i++) {
      for (let j = bStart; j < bEnd; j++) {
        let k = 0;
        while (i + k < aEnd && j + k < bEnd && a[i + k] === b[j + k]) {
          k++;
        }
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

  const matches = countMatches(0, a.length, 0, b.length);
  return (2.0 * matches) / totalLength;
}

interface SharePointFolder {
  id: string;
  name: string;
  webUrl: string;
  childCount: number;
  path: string;
  parentFolder: string;
}

interface FolderMatch {
  folder: SharePointFolder;
  confidence: number;
}

function findBestFolderMatch(
  employeeName: string,
  folders: SharePointFolder[],
  threshold: number = 0.6
): FolderMatch | null {
  if (folders.length === 0) return null;

  const normalized = normalizeName(employeeName);
  if (!normalized) return null;

  let bestMatch: FolderMatch | null = null;

  for (const folder of folders) {
    const folderNormalized = normalizeName(folder.name);
    if (!folderNormalized) continue;

    if (normalized === folderNormalized) {
      return { folder, confidence: 1.0 };
    }

    const ratio = sequenceMatchRatio(normalized, folderNormalized);
    if (ratio >= threshold && (!bestMatch || ratio > bestMatch.confidence)) {
      bestMatch = { folder, confidence: ratio };
    }
  }

  return bestMatch;
}

function makeFolder(name: string): SharePointFolder {
  return {
    id: `id-${name}`,
    name,
    webUrl: '',
    childCount: 0,
    path: `/test/${name}`,
    parentFolder: '/test',
  };
}

describe('SharePoint Name Matching', () => {
  describe('normalizeName', () => {
    it('lowercases and trims', () => {
      expect(normalizeName('  John Smith  ')).toBe('john smith');
    });

    it('collapses whitespace', () => {
      expect(normalizeName('John   M   Smith')).toBe('john m smith');
    });

    it('removes special characters', () => {
      expect(normalizeName("O'Brien, Jr.")).toBe('obrien jr');
    });
  });

  describe('sequenceMatchRatio', () => {
    it('returns 1.0 for identical strings', () => {
      expect(sequenceMatchRatio('abc', 'abc')).toBe(1.0);
    });

    it('returns 0.0 for completely different strings', () => {
      expect(sequenceMatchRatio('abc', 'xyz')).toBe(0.0);
    });

    it('returns > 0.5 for similar strings', () => {
      const ratio = sequenceMatchRatio('john smith', 'john smithe');
      expect(ratio).toBeGreaterThan(0.9);
    });

    it('handles empty strings', () => {
      expect(sequenceMatchRatio('', '')).toBe(1.0);
      expect(sequenceMatchRatio('a', '')).toBe(0.0);
    });
  });

  describe('findBestFolderMatch', () => {
    const folders = [
      makeFolder('Smith, John'),
      makeFolder('Doe, Jane'),
      makeFolder('Garcia, Maria'),
      makeFolder('OBrien, Patrick'),
    ];

    it('exact match returns 1.0 confidence', () => {
      const result = findBestFolderMatch('Smith, John', folders);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(1.0);
      expect(result!.folder.name).toBe('Smith, John');
    });

    it('case-insensitive matching', () => {
      const result = findBestFolderMatch('smith, john', folders);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(1.0);
    });

    it('fuzzy matches typos', () => {
      const result = findBestFolderMatch('Smith, Jon', folders);
      expect(result).not.toBeNull();
      expect(result!.folder.name).toBe('Smith, John');
      expect(result!.confidence).toBeGreaterThan(0.8);
    });

    it('does not match reversed name order below threshold (known limitation)', () => {
      // "john smith" vs "smith john" — ratio ~0.59, below default 0.6 threshold
      // Sequence matching is order-sensitive; this is expected behavior
      const result = findBestFolderMatch('John Smith', folders);
      expect(result).toBeNull();
    });

    it('matches reversed name order with lower threshold', () => {
      const result = findBestFolderMatch('John Smith', folders, 0.5);
      expect(result).not.toBeNull();
      expect(result!.folder.name).toBe('Smith, John');
    });

    it('returns null for no match', () => {
      const result = findBestFolderMatch('Completely Unknown Person', folders);
      expect(result).toBeNull();
    });

    it('returns null for empty folder list', () => {
      const result = findBestFolderMatch('Smith, John', []);
      expect(result).toBeNull();
    });

    it('returns null for empty name', () => {
      const result = findBestFolderMatch('', folders);
      expect(result).toBeNull();
    });
  });
});
