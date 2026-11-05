"use client";

import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { PenLine, Eye, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Markdown link href allowlist.
 *
 * The preview renderer below builds React elements from parsed markdown, so
 * all text lands in escaped text nodes (there is no HTML string to run
 * through DOMPurify — it stays available for any future HTML-string sink).
 * The link `href` is the single raw-markdown value that reaches the DOM, and
 * a `javascript:` URL there would execute on click. Only http(s) and mailto
 * targets render as anchors; anything else falls back to plain label text.
 * Returns the safe href, or null when the target must not become a link.
 */
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function sanitizeMarkdownHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  try {
    const url = new URL(href, "https://notes.local");
    // No explicit scheme: URL resolved against the base. Only same-doc
    // fragments and root-relative paths are meaningful inside notes.
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      return href.startsWith("/") || href.startsWith("#") ? href : null;
    }
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

interface MarkdownNotesEditorProps {
  initialNotes?: string | null;
  onSave: (notes: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Format inline markdown tokens (bold, italic, code, links)
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  // Pattern matching links, code, bold, italic
  const tokens: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    // Check for inline code `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      tokens.push(
        <code
          key={keyIndex++}
          className="rounded bg-[#E4E8F2] px-1 py-0.5 font-mono text-[11px] font-semibold text-[#09318D] dark:bg-[#132E74] dark:text-[#FFA8D7]"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Check for bold **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/);
    if (boldMatch) {
      tokens.push(
        <strong key={keyIndex++} className="font-bold text-[#0B1220] dark:text-white">
          {renderInlineMarkdown(boldMatch[2])}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Check for italic *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)(.*?)\1/);
    if (italicMatch && italicMatch[2].length > 0) {
      tokens.push(
        <em key={keyIndex++} className="italic text-[#0B1220] dark:text-[#E4E8F2]">
          {renderInlineMarkdown(italicMatch[2])}
        </em>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Check for links [label](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const safeHref = sanitizeMarkdownHref(linkMatch[2]);
      if (safeHref) {
        tokens.push(
          <a
            key={keyIndex++}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#09318D] underline hover:text-[#0D41B4] dark:text-[#FFA8D7] dark:hover:text-white"
          >
            {linkMatch[1]}
          </a>
        );
      } else {
        // Unsafe scheme (e.g. javascript:) — render the label as inert text.
        tokens.push(linkMatch[1]);
      }
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Regular character
    tokens.push(remaining[0]);
    remaining = remaining.slice(1);
  }

  return <>{tokens}</>;
}

/**
 * Zero-dependency block parser and renderer for markdown notes
 */
function MarkdownPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="py-4 text-center text-xs italic text-[#5B6478]/70 dark:text-[#9BB0D3]/60">
        No notes yet. Switch to &quot;Write&quot; tab to add notes.
      </div>
    );
  }

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = (key: number) => {
    if (listItems.length > 0 && listType) {
      if (listType === "ul") {
        elements.push(
          <ul key={`ul-${key}`} className="space-y-1 my-1.5 list-disc pl-5 text-xs text-[#0B1220] dark:text-[#E4E8F2]">
            {listItems}
          </ul>
        );
      } else {
        elements.push(
          <ol key={`ol-${key}`} className="space-y-1 my-1.5 list-decimal pl-5 text-xs text-[#0B1220] dark:text-[#E4E8F2]">
            {listItems}
          </ol>
        );
      }
      listItems = [];
      listType = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Fenced Code Block ```
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`codeblock-${i}`}
            className="my-2 overflow-x-auto rounded-lg border border-[#E4E8F2] bg-[#051A4D] p-2.5 font-mono text-xs text-[#FFA8D7] dark:border-[#132E74]"
          >
            <code>{codeBlockLines.join("\n")}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        flushList(i);
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    // Checkbox items (- [ ] text or - [x] text)
    const taskMatch = rawLine.match(/^(\s*)[-*]\s*\[([ xX])\]\s*(.*)$/);
    if (taskMatch) {
      flushList(i);
      const isChecked = taskMatch[2].toLowerCase() === "x";
      const itemText = taskMatch[3];
      elements.push(
        <div key={`check-${i}`} className="my-1 flex items-center gap-2 text-xs text-[#0B1220] dark:text-[#E4E8F2]">
          <input
            type="checkbox"
            checked={isChecked}
            readOnly
            className="h-3.5 w-3.5 rounded border-[#CAD5E8] text-[#FD91CC] focus:ring-0 dark:border-[#1F459E] dark:bg-[#051A4D]"
          />
          <span className={cn(isChecked && "line-through text-[#5B6478]/70 dark:text-[#9BB0D3]/60")}>
            {renderInlineMarkdown(itemText)}
          </span>
        </div>
      );
      continue;
    }

    // Unordered List (- item or * item)
    const ulMatch = rawLine.match(/^(\s*)[-*]\s+(.*)$/);
    if (ulMatch) {
      if (listType !== "ul") {
        flushList(i);
        listType = "ul";
      }
      listItems.push(<li key={`li-${i}`}>{renderInlineMarkdown(ulMatch[2])}</li>);
      continue;
    }

    // Ordered List (1. item)
    const olMatch = rawLine.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      if (listType !== "ol") {
        flushList(i);
        listType = "ol";
      }
      listItems.push(<li key={`oli-${i}`}>{renderInlineMarkdown(olMatch[2])}</li>);
      continue;
    }

    flushList(i);

    // Headings
    if (trimmed.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="mt-2.5 mb-1 text-xs font-bold uppercase tracking-wider text-[#09318D] dark:text-[#FFA8D7]">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${i}`} className="mt-3 mb-1 text-sm font-bold text-[#0B1220] dark:text-white">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      elements.push(
        <h1 key={`h1-${i}`} className="mt-3 mb-1.5 text-base font-extrabold text-[#0B1220] dark:text-white">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>
      );
      continue;
    }

    // Blockquote (> quote)
    if (trimmed.startsWith("> ")) {
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="my-1.5 border-l-2 border-[#FD91CC] pl-3 italic text-xs text-[#5B6478] dark:text-[#9BB0D3]"
        >
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Horizontal Rule
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-[#E4E8F2] dark:border-[#132E74]" />);
      continue;
    }

    // Blank line
    if (!trimmed) {
      elements.push(<div key={`blank-${i}`} className="h-2" />);
      continue;
    }

    // Paragraph
    elements.push(
      <p key={`p-${i}`} className="my-1 text-xs leading-relaxed text-[#0B1220] dark:text-[#E4E8F2]">
        {renderInlineMarkdown(rawLine)}
      </p>
    );
  }

  flushList(lines.length);

  return <div className="space-y-0.5">{elements}</div>;
}

export function MarkdownNotesEditor({
  initialNotes = "",
  onSave,
  placeholder = "Add notes (Markdown supported: # h1, **bold**, - [ ] task, `code`)...",
  disabled = false,
}: MarkdownNotesEditorProps) {
  const [activeTab, setActiveTab] = useState<"write" | "preview">("write");
  const [value, setValue] = useState(initialNotes || "");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isDirtyRef = useRef(false);

  // Sync external changes if not currently typing
  useEffect(() => {
    if (!isDirtyRef.current) {
      setValue(initialNotes || "");
    }
  }, [initialNotes]);

  const executeSave = useCallback(
    (notesToSave: string) => {
      setSaveStatus("saving");
      onSave(notesToSave);
      isDirtyRef.current = false;
      setTimeout(() => {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      }, 250);
    },
    [onSave]
  );

  // Debounced auto-save (600ms)
  useEffect(() => {
    if (!isDirtyRef.current) return;

    const timer = setTimeout(() => {
      executeSave(value);
    }, 600);

    return () => clearTimeout(timer);
  }, [value, executeSave]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    isDirtyRef.current = true;
    setValue(e.target.value);
  };

  const handleBlur = () => {
    if (isDirtyRef.current) {
      executeSave(value);
    }
  };

  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const charCount = value.length;

  return (
    <div className="space-y-2">
      {/* Header with Title, Tabs, and Status */}
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          Notes (Markdown)
        </label>

        <div className="flex items-center gap-2">
          {/* Status Indicator */}
          {saveStatus === "saving" && (
            <span className="text-[10px] text-[#5B6478] dark:text-[#9BB0D3]">Saving...</span>
          )}
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              <span>Saved</span>
            </span>
          )}

          {/* Dual Tabs Segmented Control */}
          <div className="flex items-center rounded-lg border border-[#E4E8F2] bg-[#F2F5FC] p-0.5 dark:border-[#132E74] dark:bg-[#082363]">
            <button
              type="button"
              onClick={() => setActiveTab("write")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all cursor-pointer",
                activeTab === "write"
                  ? "bg-white text-[#09318D] shadow-xs dark:bg-[#051A4D] dark:text-[#FFA8D7]"
                  : "text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
              )}
            >
              <PenLine className="h-3 w-3" />
              <span>Write</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("preview")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-all cursor-pointer",
                activeTab === "preview"
                  ? "bg-white text-[#09318D] shadow-xs dark:bg-[#051A4D] dark:text-[#FFA8D7]"
                  : "text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
              )}
            >
              <Eye className="h-3 w-3" />
              <span>Preview</span>
            </button>
          </div>
        </div>
      </div>

      {/* Editor / Preview Body */}
      {activeTab === "write" ? (
        <div className="space-y-1">
          <textarea
            ref={textareaRef}
            rows={5}
            disabled={disabled}
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            className="w-full resize-y rounded-lg border border-[#E4E8F2] bg-white p-2.5 text-xs font-mono text-[#0B1220] leading-relaxed placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white dark:placeholder:text-[#9BB0D3]/50"
          />
          <div className="flex items-center justify-between text-[10px] text-[#5B6478] dark:text-[#9BB0D3]">
            <span>Markdown supported</span>
            <span>
              {wordCount} {wordCount === 1 ? "word" : "words"} • {charCount} chars
            </span>
          </div>
        </div>
      ) : (
        <div className="min-h-[110px] max-h-64 overflow-y-auto rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/40 p-3 text-xs dark:border-[#132E74] dark:bg-[#082363]/30">
          <MarkdownPreview content={value} />
        </div>
      )}
    </div>
  );
}
