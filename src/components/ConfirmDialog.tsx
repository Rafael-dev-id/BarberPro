"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  tone: "success" | "danger" | "warning";
  title: string;
  details: { label: string; value: string }[];
  children?: ReactNode;
  warnings?: string[];
  note?: string;
  confirmLabel: string;
  confirmDisabled?: boolean;
  hideConfirm?: boolean;
  leadingLabel?: string;
  onLeading?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  cancelLabel?: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  tone,
  title,
  details,
  children,
  warnings,
  note,
  confirmLabel,
  confirmDisabled = false,
  hideConfirm = false,
  leadingLabel,
  onLeading,
  secondaryLabel,
  onSecondary,
  cancelLabel = "Batal",
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const warningsId = `${id}-warnings`;
  const noteId = `${id}-note`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();

    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => cancelRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  const confirmClass =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700"
      : tone === "warning"
        ? "bg-amber-600 hover:bg-amber-700"
        : "bg-emerald-600 hover:bg-emerald-700";
  const describedBy = [
    warnings?.length ? warningsId : null,
    note ? noteId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-2xl bg-transparent p-0 text-ink"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      aria-labelledby={titleId}
      aria-describedby={describedBy || undefined}
    >
      <div className="rounded-2xl bg-white p-6 shadow-2xl">
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
            tone === "success"
              ? "bg-emerald-50 text-emerald-700"
              : tone === "warning"
                ? "bg-amber-100 text-amber-600"
                : "bg-red-50 text-red-700"
          }`}
        >
          <Icon size={26} aria-hidden="true" />
        </div>
        <h2
          id={titleId}
          className="mt-4 text-center font-display text-xl font-semibold"
        >
          {title}
        </h2>
        <dl className="mt-4 space-y-2 rounded-xl bg-cream p-4 text-sm">
          {details.map((detail, index) => (
            <div key={`${detail.label}-${index}`} className="flex justify-between gap-4">
              <dt className="text-ink/70">{detail.label}</dt>
              <dd className="text-right font-semibold">{detail.value}</dd>
            </div>
          ))}
        </dl>
        {children}
        {warnings && warnings.length > 0 && (
          <ul
            id={warningsId}
            className="mt-4 space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950"
          >
            {warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2">
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}
        {note && (
          <p id={noteId} className="mt-4 text-sm text-ink/70">
            {note}
          </p>
        )}
        <div
          className={
            secondaryLabel || leadingLabel
              ? "mt-6 flex flex-col gap-2"
              : "mt-6 flex flex-col gap-2 sm:flex-row-reverse"
          }
        >
          {leadingLabel && (
            <button
              type="button"
              disabled={busy}
              onClick={onLeading}
              className="min-h-11 w-full rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? "Memproses…" : leadingLabel}
            </button>
          )}
          {!hideConfirm && (
            <button
              type="button"
              disabled={busy || confirmDisabled}
              onClick={onConfirm}
              className={`min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60 ${confirmClass} ${
                secondaryLabel || leadingLabel ? "w-full" : "flex-1"
              }`}
            >
              {busy ? "Memproses…" : confirmLabel}
            </button>
          )}
          {secondaryLabel ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onSecondary}
                className="min-h-11 flex-1 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-cream disabled:opacity-60"
              >
                {secondaryLabel}
              </button>
              <button
                ref={cancelRef}
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="min-h-11 flex-1 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-cream disabled:opacity-60"
              >
                {cancelLabel}
              </button>
            </div>
          ) : (
            <button
              ref={cancelRef}
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-cream disabled:opacity-60"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
