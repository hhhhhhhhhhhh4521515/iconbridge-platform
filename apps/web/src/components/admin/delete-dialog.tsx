'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { cta } from '@/lib/ui';
import { input } from './ui';

/** The word to type; the same in English and in French, like in the candidate area. */
const CONFIRM_WORD = 'DELETE';
const MIN_REASON = 5;

function Form({
  removed,
  notes,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  removed: string[];
  notes: string[];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const t = useTranslations('admin.deletion');
  const [word, setWord] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = word === CONFIRM_WORD && reason.trim().length >= MIN_REASON;
  return (
    <form
      className="space-y-4"
      data-testid="delete-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) {
          return;
        }
        setBusy(true);
        void onConfirm(reason.trim()).finally(() => {
          setBusy(false);
        });
      }}
    >
      <div>
        <p className="text-sm font-medium">{t('willRemove')}</p>
        <ul className="mt-1 list-disc ps-6 text-sm" data-testid="delete-removed">
          {removed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {notes.length > 0 ? (
        <ul
          className="space-y-1 rounded-lg border border-brand-gold bg-brand-gold-soft p-3 text-sm"
          data-testid="delete-notes"
        >
          {notes.map((line) => (
            <li key={line} className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t('reason')}</span>
        <textarea
          rows={2}
          required
          className={input}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <span className="mt-1 block text-xs text-muted-foreground">{t('reasonHint')}</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t('type', { word: CONFIRM_WORD })}</span>
        <input
          className={input}
          dir="ltr"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={word}
          onChange={(event) => {
            setWord(event.target.value);
          }}
        />
      </label>
      <p className="text-sm text-muted-foreground">{t('irreversible')}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={cta.outline} onClick={onCancel}>
          {t('cancel')}
        </button>
        <button
          type="submit"
          className={`${cta.primary} bg-destructive text-white hover:bg-destructive/90`}
          disabled={!ready || busy}
          aria-busy={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * Asked before a candidate or an application is deleted: it lists what will be
 * removed, says what will not change, and needs a reason and the word DELETE.
 * The reason goes to the audit log.
 */
export function DeleteDialog({
  open,
  title,
  removed,
  notes = [],
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  removed: string[];
  notes?: string[];
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const t = useTranslations('admin.deletion');
  return (
    <Modal open={open} onClose={onClose} title={title} closeLabel={t('cancel')}>
      {open ? (
        <Form
          removed={removed}
          notes={notes}
          confirmLabel={confirmLabel}
          onCancel={onClose}
          onConfirm={onConfirm}
        />
      ) : null}
    </Modal>
  );
}
