import { AlertTriangle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

interface Props {
  eyebrow: string;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmActionDialog({
  eyebrow,
  title,
  description,
  confirmLabel,
  busyLabel = "Working…",
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return <div className="modal-scrim" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}>
    <section className="modal confirm-action-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <button type="button" className="modal-close" aria-label="Close confirmation" disabled={busy} onClick={onCancel}><X /></button>
      <span className="confirm-action-icon" aria-hidden><AlertTriangle /></span>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>
      <p className="modal-description" id={descriptionId}>{description}</p>
      <div className="confirm-action-buttons">
        <button ref={cancelRef} type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button>
      </div>
    </section>
  </div>;
}
