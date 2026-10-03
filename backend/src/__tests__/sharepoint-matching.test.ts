import { describe, it, expect } from 'vitest';

import { normalizeName, sequenceMatchRatio, findBestFolderMatch } from '../services/name-matching.js';

interface SharePointFolder {
  id: string;
  name: string;
  webUrl: string;
  childCount: number;
  path: string;
  parentFolder: string;
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

    it('matches reversed name order ("John Smith" -> "Smith, John")', () => {
      const result = findBestFolderMatch('John Smith', folders);
      expect(result).not.toBeNull();
      expect(result!.folder.name).toBe('Smith, John');
      expect(result!.confidence).toBe(1.0);
    });

    it('fuzzy matches a typo in reversed order', () => {
      const result = findBestFolderMatch('Jon Smith', folders);
      expect(result!.folder.name).toBe('Smith, John');
    });

    it('ignores middle initials', () => {
      expect(findBestFolderMatch('John M. Smith', folders)!.folder.name).toBe('Smith, John');
    });

    it('does not merge different people who only look similar', () => {
      expect(findBestFolderMatch('John Smithson', [makeFolder('Smith, John')])).toBeNull();
      expect(findBestFolderMatch('Jane Doering', folders)).toBeNull();
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
