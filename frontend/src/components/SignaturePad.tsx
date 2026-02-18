import { useEffect, useRef, useState, useCallback } from 'react';
import SignaturePadLib from 'signature_pad';

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

  // Keep callback ref updated
  useEffect(() => {
    onSignatureChangeRef.current = onSignatureChange;
  }, [onSignatureChange]);

  // Initialize signature pad only once when in draw mode
  useEffect(() => {
    if (canvasRef.current && mode === 'draw' && !isInitialized) {
      const canvas = canvasRef.current;

      // Set canvas size based on its CSS dimensions
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);

      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(ratio, ratio);
      }

      // Create signature pad instance
      signaturePadRef.current = new SignaturePadLib(canvas, {
        backgroundColor: 'rgb(255, 255, 255)',
        penColor: 'rgb(0, 0, 100)',
        minWidth: 1,
        maxWidth: 3,
      });

      // Handle stroke end
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

        // Restore the signature data
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

  const handleTypedNameChange = (name: string) => {
    onTypedNameChange(name);
    if (mode === 'type' && name.trim()) {
      onSignatureChange(name, 'typed');
    } else if (mode === 'type') {
      onSignatureChange(null, 'typed');
    }
  };

  const switchMode = (newMode: 'draw' | 'type') => {
    if (newMode === 'draw' && mode !== 'draw') {
      // Reset initialization flag so pad will be recreated
      setIsInitialized(false);
    }
    setMode(newMode);
    onSignatureChange(null, newMode === 'draw' ? 'drawn' : 'typed');
    if (newMode === 'type' && typedName.trim()) {
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
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === 'draw'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Draw Signature
        </button>
        <button
          type="button"
          onClick={() => switchMode('type')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            mode === 'type'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Type Signature
        </button>
      </div>

      {/* Signature input */}
      {mode === 'draw' ? (
        <div className="space-y-2">
          <div className="border-2 border-gray-300 rounded-lg bg-white">
            <canvas
              ref={canvasRef}
              className="w-full h-40 rounded-lg cursor-crosshair"
              style={{ touchAction: 'none' }}
            />
          </div>
          <p className="text-xs text-gray-500 text-center">
            Sign above using your mouse or finger
          </p>
          <button
            type="button"
            onClick={clearSignature}
            className="text-sm text-blue-500 hover:text-blue-700 font-medium"
          >
            Clear and start over
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="text"
            value={typedName}
            onChange={(e) => handleTypedNameChange(e.target.value)}
            placeholder="Type your full name"
            className="input text-2xl font-serif italic text-center h-40"
          />
          {typedName && (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-white">
              <p className="text-center text-2xl font-serif italic text-blue-800">
                {typedName}
              </p>
            </div>
          )}
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
