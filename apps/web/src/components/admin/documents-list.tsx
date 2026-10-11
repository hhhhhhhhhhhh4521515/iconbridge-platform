'use client';

import { Download, Eye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { api, attempt } from '@/lib/client-api';
import { Badge, smallButton } from './ui';

interface DocumentRow {
  id: string;
  type: string;
  originalName: string;
  mimeType: string;
  deleted?: boolean;
}

const downloadUrl = (id: string, inline = false) =>
  `/api/v1/documents/${id}/download${inline ? '?inline=true' : ''}`;
const canPreview = (mimeType: string) =>
  mimeType === 'application/pdf' || mimeType.startsWith('image/');

/**
 * Documents of a candidate, with a preview in the page. The file is never served by
 * the site: the API answers with a link to the private storage that works 5 minutes,
 * and writes the access of a back-office user to the audit log.
 */
export function DocumentsList({ documents }: { documents: DocumentRow[] }) {
  const t = useTranslations('admin');
  const common = useTranslations('common');
  const [preview, setPreview] = useState<DocumentRow | null>(null);

  /** The links are followed by the browser itself: the access token is renewed first if it has expired. */
  const withSession = async (then: () => void) => {
    const { response } = await attempt(api.GET('/api/v1/admin/stats'));
    if (response?.ok) {
      then();
    }
  };
  if (documents.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('documents.none')}</p>;
  }
  return (
    <>
      <ul className="divide-y divide-border" data-testid="admin-documents">
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">{t(`documentTypes.${document.type as 'CV'}`)}</span>
              <span className="text-muted-foreground" dir="auto">
                {' '}
                · {document.originalName}{' '}
              </span>
              {document.deleted ? <Badge tone="muted">{t('documents.deleted')}</Badge> : null}
            </span>
            {document.deleted ? null : (
              <span className="flex gap-1">
                {canPreview(document.mimeType) ? (
                  <button
                    type="button"
                    className={smallButton}
                    aria-label={`${t('documents.preview')}: ${document.originalName}`}
                    onClick={() =>
                      void withSession(() => {
                        setPreview(document);
                      })
                    }
                  >
                    <Eye className="size-4" aria-hidden />
                    {t('documents.preview')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={smallButton}
                  aria-label={`${t('documents.download')}: ${document.originalName}`}
                  onClick={() =>
                    void withSession(() => {
                      window.open(downloadUrl(document.id), '_self');
                    })
                  }
                >
                  <Download className="size-4" aria-hidden />
                  {t('documents.download')}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <Modal
        open={preview !== null}
        onClose={() => {
          setPreview(null);
        }}
        title={preview?.originalName ?? ''}
        closeLabel={common('close')}
        wide
      >
        {preview ? (
          <div data-testid="document-preview">
            {preview.mimeType.startsWith('image/') ? (
              // A private file behind a short-lived signed link: shown as it is.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={downloadUrl(preview.id, true)}
                alt={preview.originalName}
                className="mx-auto max-h-[70vh] rounded-lg"
              />
            ) : (
              <iframe
                src={downloadUrl(preview.id, true)}
                title={preview.originalName}
                className="h-[70vh] w-full rounded-lg border border-border"
              />
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
