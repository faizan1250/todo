"use client";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import {
  Bookmark,
  Trash2,
  Check,
  FolderInput,
  Tag,
  AlertTriangle,
  Loader2,
  X,
  Search,
  CornerDownRight,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getTemplates,
  deleteTemplate,
  instantiateTemplate,
  type BackendTemplate,
  type BackendList,
  type BackendTask,
} from "@/lib/api";

export interface TemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  lists: BackendList[];
  defaultListId?: string | null;
  onTemplateInstantiated?: (newTask: BackendTask) => void;
}

export interface TemplatePayloadNode {
  title: string;
  notes?: string | null;
  priority?: number;
  estimateMin?: number | null;
  tags?: string[];
  checklist?: string[];
  subtasks?: TemplatePayloadNode[];
}

function countTemplateTasks(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as TemplatePayloadNode;
  let count = 1;
  if (Array.isArray(p.subtasks)) {
    for (const sub of p.subtasks) {
      count += countTemplateTasks(sub);
    }
  }
  return count;
}

function formatDate(dateInput: string | number | null | undefined): string {
  if (!dateInput) return "";
  const date = typeof dateInput === "number" ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function TemplateNodeView({
  node,
  depth = 1,
}: {
  node: TemplatePayloadNode;
  depth?: number;
}) {
  const priorityInfo = {
    4: { label: "P1 Urgent", class: "text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-400" },
    3: { label: "P2 High", class: "text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-400" },
    2: { label: "P3 Med", class: "text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400" },
    1: { label: "P4 Low", class: "text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400" },
  }[node.priority ?? 0];

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-lg border border-[#E4E8F2] bg-white p-2.5 shadow-2xs dark:border-[#132E74] dark:bg-[#082363]/60">
        {depth > 1 && (
          <CornerDownRight className="h-4 w-4 shrink-0 text-[#5B6478] dark:text-[#9BB0D3] mt-0.5" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm font-semibold text-[#0B1220] dark:text-white truncate">
              {node.title || "Untitled task"}
            </span>

            {priorityInfo && (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider shrink-0",
                  priorityInfo.class
                )}
              >
                {priorityInfo.label}
              </span>
            )}
          </div>

          {/* Notes Preview */}
          {node.notes && (
            <p className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3] line-clamp-2 bg-[#F2F5FC]/80 dark:bg-[#051A4D]/80 rounded p-1.5 font-mono">
              {node.notes}
            </p>
          )}

          {/* Tags Pills */}
          {node.tags && node.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {node.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded bg-[#F2F5FC] px-1.5 py-0.5 text-[10px] font-medium text-[#5B6478] dark:bg-[#051A4D] dark:text-[#9BB0D3]"
                >
                  <Tag className="h-2.5 w-2.5" />
                  <span>{tag}</span>
                </span>
              ))}
            </div>
          )}

          {/* Checklist Preview */}
          {node.checklist && node.checklist.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="text-[10px] font-mono font-semibold text-[#5B6478] dark:text-[#9BB0D3] uppercase tracking-wider">
                Checklist ({node.checklist.length})
              </span>
              <ul className="space-y-0.5">
                {node.checklist.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-center gap-1.5 text-[11px] text-[#5B6478] dark:text-[#9BB0D3]"
                  >
                    <div className="h-1.5 w-1.5 rounded-full bg-[#09318D] dark:bg-[#FD91CC]" />
                    <span className="truncate">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Nested Subtasks */}
      {node.subtasks && node.subtasks.length > 0 && (
        <div className="border-l-2 border-[#CAD5E8] dark:border-[#132E74] pl-3 ml-3 space-y-2">
          {node.subtasks.map((sub, idx) => (
            <TemplateNodeView key={idx} node={sub} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplatesModal({
  isOpen,
  onClose,
  lists,
  defaultListId,
  onTemplateInstantiated,
}: TemplatesModalProps) {
  const [templates, setTemplates] = useState<BackendTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [targetListId, setTargetListId] = useState<string>(() => {
    if (defaultListId) return defaultListId;
    const inbox = lists.find((l) => l.isInbox) || lists[0];
    return inbox ? inbox.id : "";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInstantiating, setIsInstantiating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    getTemplates()
      .then((res) => {
        if (!isMounted) return;
        setTemplates(res);
        if (res.length > 0) {
          setSelectedTemplateId((prev) => (prev ? prev : res[0].id));
        }
        setIsLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load templates:", err);
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load templates"
        );
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Keep target list in sync if defaultListId changes and target not set
  const effectiveTargetListId = targetListId || defaultListId || lists[0]?.id || "";

  // Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Selected template object
  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || null;
  }, [templates, selectedTemplateId]);

  // Filtered templates list
  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templates;
    const q = searchQuery.toLowerCase().trim();
    return templates.filter((t) => t.name.toLowerCase().includes(q));
  }, [templates, searchQuery]);

  // Instantiate action
  const handleInstantiate = async () => {
    if (!selectedTemplate) return;
    const listIdToUse = targetListId || effectiveTargetListId;
    if (!listIdToUse) {
      setErrorMessage("Please select a target list.");
      return;
    }

    setIsInstantiating(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const task = await instantiateTemplate(selectedTemplate.id, {
        listId: listIdToUse,
      });

      setSuccessMessage(`Successfully created task tree from "${selectedTemplate.name}"!`);
      onTemplateInstantiated?.(task);

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error("Failed to instantiate template:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to instantiate template");
    } finally {
      setIsInstantiating(false);
    }
  };

  // Delete action
  const handleDelete = async () => {
    if (!selectedTemplate) return;

    if (
      !window.confirm(
        `Delete template "${selectedTemplate.name}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setIsDeleting(true);
    setErrorMessage(null);

    try {
      await deleteTemplate(selectedTemplate.id);
      setTemplates((prev) => prev.filter((t) => t.id !== selectedTemplate.id));

      const remaining = templates.filter((t) => t.id !== selectedTemplate.id);
      setSelectedTemplateId(remaining.length > 0 ? remaining[0].id : null);
    } catch (err) {
      console.error("Failed to delete template:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to delete template");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Task Templates"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-150"
    >
      <div className="relative w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-[#CAD5E8] dark:border-[#16367F] bg-white dark:bg-[#051A4D] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E4E8F2] dark:border-[#132E74] px-5 py-4 bg-white/95 dark:bg-[#051A4D]/95">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#09318D]/10 text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]">
              <Bookmark className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#0B1220] dark:text-white">
                  Task Templates
                </h2>
                <span className="rounded-full bg-[#F2F5FC] dark:bg-[#082363] px-2 py-0.5 text-xs font-mono font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
                  {templates.length}
                </span>
              </div>
              <p className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                Reusable blueprints with hierarchical subtasks, checklists, and tags.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white transition-colors cursor-pointer"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-5 py-2 text-xs text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Master-Detail Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden divide-x divide-[#E4E8F2] dark:divide-[#132E74]">
          {/* Master Panel: Templates List (Left) */}
          <div className="w-full sm:w-72 flex flex-col bg-[#F2F5FC]/50 dark:bg-[#082363]/30">
            {/* Search Input */}
            <div className="p-3 border-b border-[#E4E8F2] dark:border-[#132E74]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter templates..."
                  className="w-full rounded-lg border border-[#CAD5E8] bg-white pl-8 pr-2.5 py-1.5 text-xs text-[#0B1220] placeholder:text-[#5B6478]/60 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#09318D] dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white dark:focus:border-[#FD91CC] dark:focus:ring-[#FD91CC]"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-8 text-[#5B6478] dark:text-[#9BB0D3]">
                  <Loader2 className="h-5 w-5 animate-spin text-[#09318D] dark:text-[#FD91CC] mb-1" />
                  <p className="text-xs">Loading templates...</p>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                  {searchQuery ? "No templates match search" : "No templates saved yet"}
                </div>
              ) : (
                filteredTemplates.map((template) => {
                  const taskCount = countTemplateTasks(template.payload);
                  const isSelected = selectedTemplateId === template.id;

                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(template.id)}
                      className={cn(
                        "w-full text-left rounded-xl p-2.5 transition-all cursor-pointer flex flex-col gap-1 border",
                        isSelected
                          ? "border-[#09318D] bg-white shadow-xs dark:border-[#FD91CC] dark:bg-[#082363]"
                          : "border-transparent hover:border-[#CAD5E8] hover:bg-white/60 dark:hover:border-[#132E74] dark:hover:bg-[#051A4D]/50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs sm:text-sm font-bold text-[#0B1220] dark:text-white truncate">
                          {template.name}
                        </span>
                        <span className="rounded-full bg-[#F2F5FC] px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[#09318D] dark:bg-[#051A4D] dark:text-[#FFA8D7] shrink-0">
                          {taskCount} {taskCount === 1 ? "task" : "tasks"}
                        </span>
                      </div>

                      <span className="text-[10px] text-[#5B6478] dark:text-[#9BB0D3]">
                        Created {formatDate(template.createdAt)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Detail Panel: Template Tree Preview & Action (Right) */}
          <div className="flex-1 flex flex-col bg-white dark:bg-[#051A4D] overflow-hidden">
            {selectedTemplate ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Detail Header Toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E4E8F2] dark:border-[#132E74] p-4 bg-[#F2F5FC]/30 dark:bg-[#082363]/20">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-[#0B1220] dark:text-white truncate">
                      {selectedTemplate.name}
                    </h3>
                    <p className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                      Ready to instantiate into your workspace
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Delete Template */}
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="btn-tier2 inline-flex items-center gap-1.5 rounded-lg border border-transparent p-2 text-xs font-semibold text-rose-600 hover:border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition-all cursor-pointer disabled:opacity-50"
                      title="Delete template"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  </div>
                </div>

                {/* Target List Selector & Primary Instantiate Action Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E4E8F2] dark:border-[#132E74] px-4 py-3 bg-[#F2F5FC]/60 dark:bg-[#082363]/40">
                  <div className="flex items-center gap-2">
                    <FolderInput className="h-4 w-4 text-[#09318D] dark:text-[#FD91CC]" />
                    <label
                      htmlFor="target-list-select"
                      className="text-xs font-semibold text-[#0B1220] dark:text-white"
                    >
                      Target List:
                    </label>
                    <select
                      id="target-list-select"
                      value={effectiveTargetListId}
                      onChange={(e) => setTargetListId(e.target.value)}
                      className="rounded-lg border border-[#CAD5E8] bg-white px-2.5 py-1 text-xs font-medium text-[#0B1220] focus:border-[#09318D] focus:outline-none dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white cursor-pointer"
                    >
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} {l.isInbox ? "(Inbox)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleInstantiate}
                    disabled={isInstantiating || !effectiveTargetListId}
                    className="btn-primary-depth inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white shadow-lift-blue transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isInstantiating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-[#FD91CC]" />
                    )}
                    <span>Instantiate Template</span>
                  </button>
                </div>

                {/* Tree Preview Viewport */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  <div className="flex items-center justify-between pb-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Template Hierarchy Preview
                    </span>
                    <span className="text-xs font-mono text-[#5B6478] dark:text-[#9BB0D3]">
                      Total: {countTemplateTasks(selectedTemplate.payload)} tasks
                    </span>
                  </div>

                  {selectedTemplate.payload && typeof selectedTemplate.payload === "object" ? (
                    <TemplateNodeView
                      node={selectedTemplate.payload as TemplatePayloadNode}
                    />
                  ) : (
                    <div className="text-xs text-[#5B6478] dark:text-[#9BB0D3] italic">
                      No tree structure in this template.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[#5B6478] dark:text-[#9BB0D3]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F2F5FC] dark:bg-[#082363] text-[#5B6478] dark:text-[#9BB0D3] mb-3">
                  <Bookmark className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-bold text-[#0B1220] dark:text-white mb-1">
                  Select a template
                </h3>
                <p className="text-xs max-w-xs">
                  Choose a template from the left panel to preview its hierarchy and instantiate it into any list.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-[#E4E8F2] dark:border-[#132E74] bg-[#F2F5FC]/60 dark:bg-[#082363]/40 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="btn-tier2 rounded-lg border border-[#CAD5E8] bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-[#F2F5FC] dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white dark:hover:bg-[#082363] transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
