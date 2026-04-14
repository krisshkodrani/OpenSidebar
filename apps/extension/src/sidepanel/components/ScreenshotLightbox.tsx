import React from "react";

interface ScreenshotLightboxProps {
  src: string;
  onClose: () => void;
}

export function ScreenshotLightbox({ src, onClose }: ScreenshotLightboxProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <img
        src={src}
        alt="Screenshot"
        className="max-w-[90%] max-h-[90%] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
