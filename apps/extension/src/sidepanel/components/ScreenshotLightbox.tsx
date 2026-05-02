import React, { useEffect, useCallback } from "react";
import { X } from "lucide-react";

interface ScreenshotLightboxProps {
  src: string;
  onClose: () => void;
}

export function ScreenshotLightbox({ src, onClose }: ScreenshotLightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot preview"
    >
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-colors"
        aria-label="Close screenshot"
      >
        <X size={18} />
      </button>
      <div className="absolute inset-0" onClick={onClose} />
      <img
        src={src}
        alt="Screenshot"
        className="max-w-[90%] max-h-[90%] rounded-lg shadow-2xl relative z-10"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
