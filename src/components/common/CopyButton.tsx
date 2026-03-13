import { useState, useCallback, useRef, useEffect } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  feedbackMs?: number;
}

export function CopyButton({ text, feedbackMs = 2000 }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), feedbackMs);
    } catch {
      console.warn("Clipboard write failed - permission denied or API unavailable");
    }
  }, [text, feedbackMs]);

  return (
    <button
      onClick={handleCopy}
      className="rounded-sm p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      data-testid="copy-button"
    >
      {copied ? (
        <Check size={14} className="text-[var(--color-success)]" />
      ) : (
        <Copy size={14} />
      )}
    </button>
  );
}
