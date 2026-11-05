"use client";

import * as React from "react";

interface InboxExamplesProps {
  examples: readonly string[];
  onFill: (example: string) => void;
}

/** Empty-inbox shortcut: tapping an example fills the quick-add input. */
export function InboxExamples({ examples, onFill }: InboxExamplesProps) {
  if (examples.length === 0) return null;
  return (
    <div data-testid="inbox-examples" className="flex flex-wrap items-center gap-1.5 px-1">
      <span className="text-[11px] font-medium text-[#5B6478] dark:text-[#9BB0D3]">
        Try:
      </span>
      {examples.map((example) => (
        <button
          key={example}
          type="button"
          onClick={() => onFill(example)}
          className="max-w-full truncate rounded-full border border-[#E4E8F2] bg-white px-2.5 py-1 font-mono text-[11px] text-[#09318D] transition-colors hover:border-[#09318D]/40 hover:bg-[#09318D]/5 dark:border-[#132E74] dark:bg-[#082363] dark:text-[#FFA8D7] dark:hover:border-[#FD91CC]/50 cursor-pointer"
        >
          {example}
        </button>
      ))}
    </div>
  );
}
