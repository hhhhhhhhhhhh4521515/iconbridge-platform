import { BadgeCheck } from 'lucide-react';
import { DestinationMark } from '@/components/ui/destination-mark';
import { MediaImage } from '@/components/ui/media-image';
import type { SuccessStory } from '@/lib/api';
import { longDate, pick } from '@/lib/format';
import { card } from '@/lib/ui';

export interface StoryLabels {
  badge: string;
  /** Contains "{date}". */
  visaDate: string;
  /** Contains "{name}" and "{job}". */
  photoAlt: string;
}

/**
 * One success story: the picture, a "Visa approved" badge, who, which job, where, when, and
 * the quote when there is one (it is optional, ADR-024).
 */
export function StoryCard({
  story,
  locale,
  labels,
}: {
  story: SuccessStory;
  locale: string;
  labels: StoryLabels;
}) {
  const destination = pick(story.destination.name, locale);
  const quote = pick(story.quote, locale).trim();
  return (
    <figure className={`${card} flex h-full flex-col overflow-hidden`}>
      <div className="relative aspect-[4/5] bg-brand-navy">
        {story.photoUrl ? (
          <MediaImage
            src={story.photoUrl}
            alt={labels.photoAlt.replace('{name}', story.name).replace('{job}', story.jobTitle)}
            fill
            sizes="(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 80vw"
            className="object-cover object-top"
          />
        ) : null}
        <span className="absolute start-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-brand-gold px-3 py-1 text-xs font-semibold text-brand-navy shadow">
          <BadgeCheck className="size-4" aria-hidden />
          {labels.badge}
        </span>
      </div>
      <figcaption className="flex flex-1 flex-col p-4">
        <p className="text-base font-semibold">{story.name}</p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <DestinationMark code={story.destination.code} />
          {story.jobTitle} · {destination}
        </p>
        {story.visaApprovedAt ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {labels.visaDate.replace('{date}', longDate(story.visaApprovedAt, locale))}
          </p>
        ) : null}
        {quote ? (
          <blockquote className="mt-3 border-s-2 border-brand-gold ps-3 text-sm text-foreground">
            {quote}
          </blockquote>
        ) : null}
      </figcaption>
    </figure>
  );
}
