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
      className="block max-h-[120px] min-h-[36px] w-full resize-none border-none bg-transparent py-1.5 text-ui-body leading-5 text-fg outline-none placeholder:text-fg-tertiary"
      rows={1}
    />
  );
}
