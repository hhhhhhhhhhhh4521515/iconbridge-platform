import { ChevronDown } from 'lucide-react';

/**
 * Questions that open one at a time. Native <details> elements sharing a name:
 * the browser handles the keyboard, the screen readers and the "only one open"
 * rule, without any JavaScript.
 */
export function Faq({ items }: { items: { id: string; question: string; answer: string }[] }) {
  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-card">
      {items.map((item) => (
        <details key={item.id} name="faq" className="group">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-base font-medium hover:bg-muted [&::-webkit-details-marker]:hidden">
            <h3 className="text-base font-medium">{item.question}</h3>
            <ChevronDown
              className="size-5 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <p className="px-5 pb-4 text-sm text-muted-foreground">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
