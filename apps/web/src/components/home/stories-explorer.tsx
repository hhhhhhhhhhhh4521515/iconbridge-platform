'use client';

import { useState } from 'react';
import type { SuccessStory } from '@/lib/api';
import { StoryCard, type StoryLabels } from './story-card';

/** All published stories, with buttons to keep one destination. */
export function StoriesExplorer({
  stories,
  destinations,
  locale,
  labels,
}: {
  stories: SuccessStory[];
  destinations: { code: string; name: string }[];
  locale: string;
  labels: StoryLabels & { filter: string; all: string; empty: string };
}) {
  const [code, setCode] = useState<string | null>(null);
  const shown = code ? stories.filter((story) => story.destination.code === code) : stories;
  const chip =
    'inline-flex min-h-11 items-center rounded-full border border-input px-4 text-sm font-medium hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground';
  return (
    <div>
      <div role="group" aria-label={labels.filter} className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          className={chip}
          aria-pressed={code === null}
          onClick={() => setCode(null)}
        >
          {labels.all}
        </button>
        {destinations.map((destination) => (
          <button
            key={destination.code}
            type="button"
            className={chip}
            aria-pressed={code === destination.code}
            onClick={() => setCode(destination.code)}
          >
            {destination.name}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground" role="status">
          {labels.empty}
        </p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((story) => (
            <li key={story.id} data-testid="story-card">
              <StoryCard story={story} locale={locale} labels={labels} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
