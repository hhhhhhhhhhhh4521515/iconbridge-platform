'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading3, Italic, List, ListOrdered, Redo2, Underline, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

const tool =
  'inline-flex size-9 items-center justify-center rounded-md hover:bg-muted aria-pressed:bg-secondary aria-pressed:text-secondary-foreground disabled:opacity-40';

/**
 * Rich-text field (Tiptap) for the long texts of a job. It produces simple HTML:
 * paragraphs, bold, italic, underline, one level of heading and lists. The API keeps
 * only those tags, whatever is sent.
 */
export function RichTextEditor({
  label,
  value,
  onChange,
  error,
  testId,
  required,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  error?: string | null;
  testId: string;
  required?: boolean;
}) {
  const t = useTranslations('admin.editor');
  const id = useId();
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [3] }, code: false, codeBlock: false })],
    content: value,
    // The page is rendered on the server first: the editor starts in the browser.
    immediatelyRender: false,
    // The toolbar shows what is active at the cursor and whether undo is possible:
    // it must be drawn again whenever the text or the selection changes.
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: 'rich-text min-h-32 px-3 py-2 focus:outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': `${id}-label`,
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.isEmpty ? '' : current.getHTML());
    },
  });
  const tools = editor
    ? [
        {
          key: 'bold',
          icon: Bold,
          active: editor.isActive('bold'),
          run: () => editor.chain().focus().toggleBold().run(),
        },
        {
          key: 'italic',
          icon: Italic,
          active: editor.isActive('italic'),
          run: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          key: 'underline',
          icon: Underline,
          active: editor.isActive('underline'),
          run: () => editor.chain().focus().toggleUnderline().run(),
        },
        {
          key: 'heading',
          icon: Heading3,
          active: editor.isActive('heading'),
          run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        },
        {
          key: 'bulletList',
          icon: List,
          active: editor.isActive('bulletList'),
          run: () => editor.chain().focus().toggleBulletList().run(),
        },
        {
          key: 'orderedList',
          icon: ListOrdered,
          active: editor.isActive('orderedList'),
          run: () => editor.chain().focus().toggleOrderedList().run(),
        },
      ]
    : [];
  return (
    <div>
      <p id={`${id}-label`} className="mb-1 text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </p>
      <div
        className={`rounded-lg border bg-background ${error ? 'border-destructive' : 'border-input'}`}
        data-testid={testId}
      >
        <div
          role="toolbar"
          aria-label={t('toolbar')}
          className="flex flex-wrap gap-0.5 border-b border-border p-1"
        >
          {tools.map(({ key, icon: Icon, active, run }) => (
            <button
              key={key}
              type="button"
              className={tool}
              aria-label={t(key)}
              title={t(key)}
              aria-pressed={active}
              onClick={run}
            >
              <Icon className="size-4" aria-hidden />
            </button>
          ))}
          <span className="mx-1 w-px bg-border" aria-hidden />
          <button
            type="button"
            className={tool}
            aria-label={t('undo')}
            title={t('undo')}
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className={tool}
            aria-label={t('redo')}
            title={t('redo')}
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 className="size-4" aria-hidden />
          </button>
        </div>
        <EditorContent editor={editor} />
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
