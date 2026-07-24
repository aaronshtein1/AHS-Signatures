import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { Placeholder } from '@/lib/api';

// Use local worker copy (copied from node_modules/pdfjs-dist/build/ to public/)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Default US Letter dimensions in PDF points
const DEFAULT_DIMS = { width: 612, height: 792 };

interface PageDims {
  width: number;
  height: number;
}

interface PdfFieldViewerProps {
  pdfUrl: string | null;
  placeholders: Placeholder[];
  signatureData: string | null;
  textFields: Record<string, string>;
  onTextFieldChange: (key: string, value: string) => void;
  onSignatureClick: () => void;
}

export default function PdfFieldViewer({
  pdfUrl,
  placeholders,
  signatureData,
  textFields,
  onTextFieldChange,
  onSignatureClick,
}: PdfFieldViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageDims, setPageDims] = useState<Record<number, PageDims>>({});
  const [containerWidth, setContainerWidth] = useState(700);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Log placeholder info on mount/change
  useEffect(() => {
    if (placeholders.length > 0) {
      const pages = Array.from(new Set(placeholders.map(p => p.pageNumber))).sort((a, b) => a - b);
      console.log(`[PdfFieldViewer] ${placeholders.length} placeholders on pages: ${pages.join(', ')}`);
      placeholders.forEach(p =>
        console.log(`  ${p.type} "${p.fieldName || 'N/A'}" page=${p.pageNumber} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} w=${p.width} h=${p.height}`)
      );
    } else {
      console.log('[PdfFieldViewer] No placeholders provided');
    }
  }, [placeholders]);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.min(entry.contentRect.width, 900));
      }
    });
    observer.observe(el);
    setContainerWidth(Math.min(el.clientWidth, 900));
    return () => observer.disconnect();
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    console.log(`[PdfFieldViewer] Document loaded: ${n} pages`);
    setNumPages(n);
    setPdfError(null);
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('[PdfFieldViewer] Document load error:', error);
    setPdfError(error.message || 'Failed to load PDF');
  }, []);

  const onPageLoadSuccess = useCallback((page: any) => {
    try {
      // react-pdf v10 PageCallback has originalWidth/originalHeight via getViewport
      // Fallback to view array [x1, y1, x2, y2] which gives the MediaBox
      const w = page.originalWidth ?? page.width ?? (page.view ? page.view[2] - page.view[0] : DEFAULT_DIMS.width);
      const h = page.originalHeight ?? page.height ?? (page.view ? page.view[3] - page.view[1] : DEFAULT_DIMS.height);
      const pn = page.pageNumber ?? page._pageIndex + 1;
      console.log(`[PdfFieldViewer] Page ${pn} loaded: ${w}x${h}`);
      if (pn && w > 0 && h > 0) {
        setPageDims((prev) => ({
          ...prev,
          [pn]: { width: w, height: h },
        }));
      }
    } catch (err) {
      console.error('[PdfFieldViewer] Error in onPageLoadSuccess:', err);
    }
  }, []);

  // Get dims for a page with fallback to default letter size
  const getDims = (pageNum: number): PageDims => {
    return pageDims[pageNum] || DEFAULT_DIMS;
  };

  // Compute overlay position for a placeholder (PDF coords → screen coords)
  const getFieldStyle = (p: Placeholder, pageNum: number): React.CSSProperties => {
    const dims = getDims(pageNum);
    const scale = containerWidth / dims.width;
    const renderedH = dims.height * scale;

    // PDF y-coordinate is from bottom; convert to top-based screen coordinate
    // p.y is the text baseline (bottom of the field area in PDF coords)
    let top = (dims.height - p.y) * scale - p.height * scale;
    let left = p.x * scale;

    // Clamp to keep within page bounds
    if (top < 0) top = 0;
    if (left < 0) left = 0;
    if (top + p.height * scale > renderedH) top = renderedH - p.height * scale;
    if (left + p.width * scale > containerWidth) left = containerWidth - p.width * scale;

    return {
      position: 'absolute',
      zIndex: 10,
      left,
      top,
      width: p.width * scale,
      height: p.height * scale,
    };
  };

  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-3 text-sm text-gray-500">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (pdfError) {
    return (
      <div className="text-center py-20">
        <p className="text-red-600 font-medium">Failed to load PDF</p>
        <p className="text-sm text-gray-500 mt-1">{pdfError}</p>
        <button
          onClick={() => { setPdfError(null); }}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
              <p className="mt-3 text-sm text-gray-500">Rendering PDF...</p>
            </div>
          </div>
        }
        error={
          <div className="text-center py-20 text-red-600">
            Failed to render PDF. Please refresh the page.
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => {
          const pageNum = i + 1;
          const pagePlaceholders = (placeholders || []).filter((p) => p.pageNumber === pageNum);

          return (
            <div
              key={pageNum}
              className="relative mb-6 shadow-lg mx-auto bg-white"
              style={{ width: containerWidth }}
            >
              <Page
                pageNumber={pageNum}
                width={containerWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                onLoadSuccess={onPageLoadSuccess}
              />

              {/* Overlaid fields - render regardless of dims (use fallback) */}
              {pagePlaceholders.map((p, pIdx) => {
                const style = getFieldStyle(p, pageNum);

                // SIGNATURE placeholder
                if (p.type === 'SIGNATURE') {
                  return (
                    <div
                      key={`sig-${pageNum}-${pIdx}`}
                      style={style}
                      onClick={onSignatureClick}
                      className="border-2 border-dashed border-blue-400 bg-blue-50/80 rounded cursor-pointer hover:bg-blue-100 hover:border-blue-500 transition-colors flex items-center justify-center"
                    >
                      {signatureData ? (
                        <span className="text-xs text-green-700 font-medium">
                          ✓ Signed
                        </span>
                      ) : (
                        <span className="text-xs text-blue-600 font-medium">
                          Click to sign
                        </span>
                      )}
                    </div>
                  );
                }

                // DATE placeholder
                if (p.type === 'DATE') {
                  const fieldKey = p.fieldName || `date_${pIdx}`;
                  return (
                    <input
                      key={`date-${pageNum}-${pIdx}`}
                      type="text"
                      value={textFields[fieldKey] || ''}
                      onChange={(e) => onTextFieldChange(fieldKey, e.target.value)}
                      style={style}
                      className="border border-blue-300 bg-white/90 rounded text-xs px-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="MM/DD/YYYY"
                    />
                  );
                }

                // TEXT placeholder
                if (p.type === 'TEXT' && p.fieldName) {
                  return (
                    <input
                      key={`text-${pageNum}-${pIdx}`}
                      type="text"
                      value={textFields[p.fieldName] || ''}
                      onChange={(e) => onTextFieldChange(p.fieldName!, e.target.value)}
                      style={style}
                      className="border border-blue-300 bg-white/90 rounded text-xs px-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder={p.fieldName.replace(/_/g, ' ')}
                    />
                  );
                }

                return null;
              })}

              {/* Field count indicator for pages with fields */}
              {pagePlaceholders.length > 0 && (
                <div className="absolute top-2 left-3 text-xs text-blue-700 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded z-20">
                  {pagePlaceholders.length} field{pagePlaceholders.length > 1 ? 's' : ''} to fill
                </div>
              )}

              {/* Page number */}
              <div className="absolute bottom-2 right-3 text-xs text-gray-400 bg-white/80 px-1.5 py-0.5 rounded z-20">
                Page {pageNum} of {numPages}
              </div>
            </div>
          );
        })}
      </Document>
    </div>
  );
}
