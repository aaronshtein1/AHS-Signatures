import { useEffect, useRef, useState, useCallback } from 'react';
import SignaturePadLib from 'signature_pad';

const SIGNATURE_FONTS = [
  { name: 'Dancing Script', label: 'Elegant' },
  { name: 'Great Vibes', label: 'Formal' },
  { name: 'Caveat', label: 'Casual' },
  { name: 'Sacramento', label: 'Classic' },
  { name: 'Homemade Apple', label: 'Handwritten' },
];

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
  const [isInitialized, setIsInitialized] = useState(false);
  const [selectedFont, setSelectedFont] = useState(SIGNATURE_FONTS[0].name);

  // Keep callback ref updated
  useEffect(() => {
    onSignatureChangeRef.current = onSignatureChange;
  }, [onSignatureChange]);

  // Initialize signature pad only once when in draw mode
  useEffect(() => {
    if (canvasRef.current && mode === 'draw' && !isInitialized) {
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
        backgroundColor: 'rgb(255, 255, 255)',
        penColor: 'rgb(10, 10, 80)',
        minWidth: 0.8,
        maxWidth: 3.2,
        velocityFilterWeight: 0.7,
        throttle: 16,
      });

      signaturePadRef.current.addEventListener('endStroke', () => {
        if (signaturePadRef.current && !signaturePadRef.current.isEmpty()) {
          const dataUrl = signaturePadRef.current.toDataURL('image/png');
          onSignatureChangeRef.current(dataUrl, 'drawn');
        }
      });

      setIsInitialized(true);

      return () => {
        if (signaturePadRef.current) {
          signaturePadRef.current.off();
          signaturePadRef.current = null;
        }
        setIsInitialized(false);
      };
    }
  }, [mode, isInitialized]);

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
      if (mode === 'type' && name.trim()) {
        onSignatureChange(name, 'typed');
      } else if (mode === 'type') {
        onSignatureChange(null, 'typed');
      }
    },
    [mode, onSignatureChange, onTypedNameChange]
  );

  const switchMode = (newMode: 'draw' | 'type') => {
    if (newMode === 'draw' && mode !== 'draw') {
      setIsInitialized(false);
    }
    setMode(newMode);
    onSignatureChange(null, newMode === 'draw' ? 'drawn' : 'typed');
    if (newMode === 'type' && typedName.trim()) {
      onSignatureChange(typedName, 'typed');
    }
  };

  const handleFontChange = (fontName: string) => {
    setSelectedFont(fontName);
    if (mode === 'type' && typedName.trim()) {
      onSignatureChange(typedName, 'typed');
    }
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
          onChange={(e) => onTypedNameChange(e.target.value)}
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
