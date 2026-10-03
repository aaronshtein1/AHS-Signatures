import { useState, useEffect, useRef, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { Placeholder } from '@/lib/api';

// Use local worker copy (copied from node_modules/pdfjs-dist/build/ to public/)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// Default US Letter MediaBox in PDF points
const DEFAULT_VIEW: [number, number, number, number] = [0, 0, 612, 792];

type View = [number, number, number, number];

interface PdfFieldViewerProps {
  pdfUrl: string | null;
  placeholders: Placeholder[];
  signatureData: string | null;
  textFields: Record<string, string>;
  onTextFieldChange: (key: string, value: string) => void;
  onSignatureClick: () => void;
  /** Values shown in auto-filled fields (name / email / initials / date) */
  autoFillValues: Record<'name' | 'email' | 'initials' | 'date', string>;
}

export default function PdfFieldViewer({
  pdfUrl,
  placeholders,
  signatureData,
  textFields,
  onTextFieldChange,
  onSignatureClick,
  autoFillValues,
}: PdfFieldViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageViews, setPageViews] = useState<Record<number, View>>({});
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
    console.error('[PdfFieldViewer] Document load error:', error);
    setPdfError(error.message || 'Failed to load PDF');
  }, []);

  const onPageLoadSuccess = useCallback((page: any) => {
    const pn = page.pageNumber ?? (page._pageIndex ?? 0) + 1;
    const view = page.view as View | undefined;
    if (pn && view && view[2] > view[0] && view[3] > view[1]) {
      setPageViews((prev) => ({ ...prev, [pn]: view }));
    }
  }, []);

  // Field placement: PDF user space (origin bottom-left of MediaBox) → CSS pixels
  const getFieldStyle = (p: Placeholder, pageNum: number): React.CSSProperties => {
    const view = pageViews[pageNum] || p.pageView || DEFAULT_VIEW;
    const pageW = view[2] - view[0];
    const scale = containerWidth / pageW;
    return {
      position: 'absolute',
      zIndex: 10,
      left: (p.x - view[0]) * scale,
      top: (view[3] - (p.y + p.height)) * scale,
      width: p.width * scale,
      height: p.height * scale,
      fontSize: Math.max(9, Math.min((p.fontSize || 10) * scale, 16)),
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

  const isImage = !!signatureData && signatureData.startsWith('data:image');

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
              className="relative mb-6 shadow-lg mx-auto bg-white overflow-hidden"
              style={{ width: containerWidth }}
            >
              <Page
                pageNumber={pageNum}
                width={containerWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                onLoadSuccess={onPageLoadSuccess}
              />

              {pagePlaceholders.map((p, pIdx) => {
                const style = getFieldStyle(p, pageNum);
                const key = `${p.type}-${pageNum}-${pIdx}`;

                if (p.type === 'SIGNATURE') {
                  return (
                    <div
                      key={key}
                      style={style}
                      onClick={onSignatureClick}
                      title="Click to sign"
                      className={`border-2 border-dashed rounded cursor-pointer transition-colors flex items-center justify-center ${
                        signatureData
                          ? 'border-green-400 bg-white hover:bg-green-50'
                          : 'border-blue-400 bg-blue-50 hover:bg-blue-100 hover:border-blue-500'
                      }`}
                    >
                      {isImage ? (
                        <img src={signatureData!} alt="Your signature" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-xs text-blue-600 font-medium whitespace-nowrap">Click to sign</span>
                      )}
                    </div>
                  );
                }

                // Auto-filled fields (dates, name, email, initials) are shown read-only
                const auto = p.autoFill || (p.type === 'DATE' ? 'date' : undefined);
                if (auto) {
                  return (
                    <div
                      key={key}
                      style={style}
                      title="Filled in automatically when you sign"
                      className="border border-gray-300 bg-gray-50 rounded px-1 flex items-center text-gray-700 whitespace-nowrap overflow-hidden"
                    >
                      {autoFillValues[auto]}
                    </div>
                  );
                }

                if (p.type === 'TEXT' && p.fieldName) {
                  return (
                    <input
                      key={key}
                      type="text"
                      value={textFields[p.fieldName] || ''}
                      onChange={(e) => onTextFieldChange(p.fieldName!, e.target.value)}
                      style={style}
                      className={`border bg-white rounded px-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none ${
                        p.required && !textFields[p.fieldName] ? 'border-red-400' : 'border-blue-300'
                      }`}
                      placeholder={p.fieldName.replace(/[_#]/g, ' ').trim()}
                    />
                  );
                }

                return null;
              })}

              {pagePlaceholders.length > 0 && (
                <div className="absolute top-2 left-3 text-xs text-blue-700 bg-blue-100 border border-blue-300 px-2 py-0.5 rounded z-20">
                  {pagePlaceholders.length} field{pagePlaceholders.length > 1 ? 's' : ''} on this page
                </div>
              )}

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
