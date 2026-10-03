import { useEffect, useRef, useState, useCallback } from 'react';
import SignaturePadLib from 'signature_pad';

const SIGNATURE_FONTS = [
  { name: 'Dancing Script', label: 'Elegant' },
  { name: 'Great Vibes', label: 'Formal' },
  { name: 'Caveat', label: 'Casual' },
  { name: 'Sacramento', label: 'Classic' },
  { name: 'Homemade Apple', label: 'Handwritten' },
];

/** Crop a canvas to the bounding box of its non-transparent pixels. */
function trimCanvasToDataUrl(source: HTMLCanvasElement, padding = 8): string | null {
  const ctx = source.getContext('2d');
  if (!ctx) return null;
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(source, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Render a typed name in a signature font to a transparent, trimmed PNG. */
async function renderTypedSignature(name: string, fontName: string): Promise<string | null> {
  const fontSpec = `96px "${fontName}"`;
  try {
    await document.fonts.load(fontSpec, name);
  } catch {
    // Fall back to whatever font is available
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `${fontSpec}, cursive`;
  canvas.width = Math.ceil(ctx.measureText(name).width) + 80;
  canvas.height = 180;
  ctx.font = `${fontSpec}, cursive`; // resizing resets context state
  ctx.fillStyle = 'rgb(10, 10, 80)';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 40, canvas.height / 2);
  return trimCanvasToDataUrl(canvas);
}

interface SignaturePadProps {
  onSignatureChange: (data: string | null, type: 'drawn' | 'typed') => void;
  typedName: string;
  onTypedNameChange: (name: string) => void;
}

export default function SignaturePad({
  onSignatureChange,
  typedName,
  onTypedNameChange,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadRef = useRef<SignaturePadLib | null>(null);
  const onSignatureChangeRef = useRef(onSignatureChange);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [selectedFont, setSelectedFont] = useState(SIGNATURE_FONTS[0].name);
  const typedRequest = useRef(0);

  // Typed signatures are sent as an image so the signed PDF matches the chosen style
  const emitTyped = useCallback(async (name: string, fontName: string) => {
    const request = ++typedRequest.current;
    if (!name.trim()) {
      onSignatureChangeRef.current(null, 'typed');
      return;
    }
    const dataUrl = await renderTypedSignature(name.trim(), fontName);
    if (request === typedRequest.current) {
      onSignatureChangeRef.current(dataUrl, 'typed');
    }
  }, []);

  // Keep callback ref updated
  useEffect(() => {
    onSignatureChangeRef.current = onSignatureChange;
  }, [onSignatureChange]);

  // Create the signature pad while in draw mode; tear it down when leaving draw mode.
  // (Depending only on `mode` matters: re-running on other state would destroy the pad
  // mid-signature and lose the strokes.)
  useEffect(() => {
    if (canvasRef.current && mode === 'draw') {
      const canvas = canvasRef.current;

      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);

      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(ratio, ratio);
      }

      signaturePadRef.current = new SignaturePadLib(canvas, {
        // Transparent so the signature does not paint a white box over the document's lines
        backgroundColor: 'rgba(0, 0, 0, 0)',
        penColor: 'rgb(10, 10, 80)',
        minWidth: 0.8,
        maxWidth: 3.2,
        velocityFilterWeight: 0.7,
        throttle: 16,
      });

      signaturePadRef.current.addEventListener('endStroke', () => {
        if (signaturePadRef.current && !signaturePadRef.current.isEmpty()) {
          const dataUrl = canvasRef.current ? trimCanvasToDataUrl(canvasRef.current) : null;
          onSignatureChangeRef.current(dataUrl, 'drawn');
        }
      });

      return () => {
        if (signaturePadRef.current) {
          signaturePadRef.current.off();
          signaturePadRef.current = null;
        }
      };
    }
  }, [mode]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && signaturePadRef.current && mode === 'draw') {
        const canvas = canvasRef.current;
        const data = signaturePadRef.current.toData();

        const rect = canvas.getBoundingClientRect();
        const ratio = Math.max(window.devicePixelRatio || 1, 1);

        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(ratio, ratio);
        }

        signaturePadRef.current.fromData(data);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mode]);

  const clearSignature = () => {
    if (signaturePadRef.current) {
      signaturePadRef.current.clear();
      onSignatureChange(null, 'drawn');
    }
  };

  const handleTypedNameChange = useCallback(
    (name: string) => {
      onTypedNameChange(name);
      if (mode === 'type') emitTyped(name, selectedFont);
    },
    [mode, selectedFont, emitTyped, onTypedNameChange]
  );

  const switchMode = (newMode: 'draw' | 'type') => {
    setMode(newMode);
    typedRequest.current++;
    onSignatureChange(null, newMode === 'draw' ? 'drawn' : 'typed');
    if (newMode === 'type') emitTyped(typedName, selectedFont);
  };

  const handleFontChange = (fontName: string) => {
    setSelectedFont(fontName);
    if (mode === 'type') emitTyped(typedName, fontName);
  };

  return (
    <div className="space-y-4">
      {/* Mode tabs */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => switchMode('draw')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            mode === 'draw'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
          Draw
        </button>
        <button
          type="button"
          onClick={() => switchMode('type')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            mode === 'type'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
          Type
        </button>
      </div>

      {/* Draw mode */}
      {mode === 'draw' ? (
        <div className="space-y-2">
          <div className="signature-pad-wrapper">
            <canvas
              ref={canvasRef}
              className="block w-full h-48 cursor-crosshair relative z-10"
              style={{ touchAction: 'none' }}
            />
            {/* Signature line indicator */}
            <div className="signature-line">
              <span className="signature-x">&times;</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 italic">
              Sign above using your mouse, trackpad, or finger
            </p>
            <button
              type="button"
              onClick={clearSignature}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>
          </div>
        </div>
      ) : (
        /* Type mode */
        <div className="space-y-3">
          {/* Font style selector */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Choose a signature style:</p>
            <div className="flex gap-2 flex-wrap">
              {SIGNATURE_FONTS.map((font) => (
                <button
                  key={font.name}
                  type="button"
                  onClick={() => handleFontChange(font.name)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                    selectedFont === font.name
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span style={{ fontFamily: `"${font.name}", cursive` }}>
                    {font.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Name input */}
          <input
            type="text"
            value={typedName}
            onChange={(e) => handleTypedNameChange(e.target.value)}
            placeholder="Type your full name"
            className="input text-lg"
          />

          {/* Signature preview */}
          <div className="signature-type-preview">
            {typedName ? (
              <div className="signature-type-inner">
                <p
                  className="signature-type-text"
                  style={{ fontFamily: `"${selectedFont}", cursive` }}
                >
                  {typedName}
                </p>
                <div className="signature-type-line" />
              </div>
            ) : (
              <p className="text-gray-300 text-sm italic text-center">
                Your signature will appear here
              </p>
            )}
          </div>
        </div>
      )}

      {/* Legal name */}
      <div>
        <label className="label">Your Full Legal Name</label>
        <input
          type="text"
          value={typedName}
          onChange={(e) => handleTypedNameChange(e.target.value)}
          placeholder="Enter your full legal name"
          className="input"
          required
        />
        <p className="mt-1 text-xs text-gray-500">
          This name will appear on the signed document
        </p>
      </div>
    </div>
  );
}
