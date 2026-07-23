import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { Placeholder } from '@/lib/api';

// Use local worker copy (copied from node_modules/pdfjs-dist/build/ to public/)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

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
    setNumPages(n);
    setPdfError(null);
  }, []);

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('PDF load error:', error);
    setPdfError(error.message || 'Failed to load PDF');
  }, []);

  const onPageLoadSuccess = useCallback((page: any) => {
    setPageDims((prev) => ({
      ...prev,
      [page.pageNumber]: { width: page.originalWidth, height: page.originalHeight },
    }));
  }, []);

  // Compute overlay position for a placeholder
  const getFieldStyle = (p: Placeholder, pageNum: number): React.CSSProperties => {
    const dims = pageDims[pageNum];
    if (!dims) return { display: 'none' };
    const scale = containerWidth / dims.width;
    return {
      position: 'absolute',
      left: p.x * scale,
      top: (dims.height - p.y) * scale - p.height * scale,
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
          const dims = pageDims[pageNum];
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

              {/* Overlaid fields */}
              {dims &&
                pagePlaceholders.map((p, pIdx) => {
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

              {/* Page number */}
              <div className="absolute bottom-2 right-3 text-xs text-gray-400 bg-white/80 px-1.5 py-0.5 rounded">
                Page {pageNum} of {numPages}
              </div>
            </div>
          );
        })}
      </Document>
    </div>
  );
}
