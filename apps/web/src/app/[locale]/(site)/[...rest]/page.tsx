import { notFound } from 'next/navigation';

/** Any unknown path under a language shows that language's "page not found". */
export default function CatchAll() {
  notFound();
}
