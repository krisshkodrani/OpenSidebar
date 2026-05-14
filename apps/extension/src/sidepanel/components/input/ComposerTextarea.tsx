import React from "react";

export function ComposerTextarea({
  inputRef,
  onBlur,
  onChange,
  onFocus,
  onKeyDown,
  placeholder,
  value,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  onBlur: () => void;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <textarea
      ref={inputRef}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      className="block max-h-[120px] min-h-[36px] w-full resize-none border-none bg-transparent py-1.5 text-sm leading-5 text-warm-800 outline-none placeholder:text-warm-400 dark:text-warm-100 dark:placeholder:text-warm-500"
      rows={1}
    />
  );
}
