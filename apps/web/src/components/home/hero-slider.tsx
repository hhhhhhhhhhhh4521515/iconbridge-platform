'use client';

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { MediaImage } from '@/components/ui/media-image';
import { Link } from '@/i18n/navigation';
import { cta } from '@/lib/ui';
import { HERO_CONTENT, HERO_HEIGHT, type HeroLabels, type HeroSlide } from './hero-types';

export type { HeroLabels, HeroSlide } from './hero-types';

interface HeroProps {
  slides: HeroSlide[];
  labels: HeroLabels;
  children: ReactNode;
}

/** Delay after the page has loaded before the carousel code is fetched. */
const CAROUSEL_DELAY_MS = 3000;

/**
 * The hero of the home page.
 *
 * The server sends the first slide as plain HTML (picture, title, buttons, search
 * form), so it is visible at once and works without JavaScript. The animated
 * carousel (Swiper and Motion) is downloaded a little later and takes its place,
 * starting on the same slide: nothing moves during the swap, and the first
 * change of slide still happens about 6 seconds after the page appeared.
 */
export function HeroSlider({ slides, labels, children }: HeroProps) {
  const [carousel, setCarousel] = useState<{
    Component: ComponentType<HeroProps & { firstDelayMs: number }>;
    firstDelayMs: number;
  } | null>(null);

  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    if (slides.length < 2) {
      return;
    }
    const shownAt = performance.now();
    let cancelled = false;
    let timer = 0;
    const load = () => {
      window.clearTimeout(timer);
      void import('./hero-carousel').then((module) => {
        if (!cancelled) {
          setCarousel({
            Component: module.HeroCarousel,
            // The first slide has already been on screen for a while.
            firstDelayMs: Math.max(1500, 6000 - (performance.now() - shownAt)),
          });
        }
      });
    };
    // The first slide stays 6 seconds anyway, so the carousel code is not needed
    // before: it is fetched a few seconds after the page has loaded, or at once if
    // the visitor touches, hovers or focuses the hero.
    const schedule = () => {
      timer = window.setTimeout(load, CAROUSEL_DELAY_MS);
    };
    if (document.readyState === 'complete') {
      schedule();
    } else {
      window.addEventListener('load', schedule, { once: true });
    }
    const node = section.current;
    const events = ['pointerenter', 'touchstart', 'focusin'] as const;
    for (const event of events) {
      node?.addEventListener(event, load, { once: true, passive: true });
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('load', schedule);
      for (const event of events) {
        node?.removeEventListener(event, load);
      }
    };
  }, [slides.length]);

  if (carousel) {
    return (
      <carousel.Component slides={slides} labels={labels} firstDelayMs={carousel.firstDelayMs}>
        {children}
      </carousel.Component>
    );
  }

  const first = slides[0];
  if (!first) {
    return null;
  }
  return (
    <section
      aria-label={labels.region}
      data-hero="static"
      className="relative isolate bg-brand-navy text-white"
    >
      <div className={`relative ${HERO_HEIGHT}`}>
        <div className="absolute inset-0 overflow-hidden">
          <MediaImage
            src={first.image}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-navy via-brand-navy/60 to-brand-navy/30" />
        </div>
        <div className={HERO_CONTENT}>
          <div className="max-w-2xl">
            <h2 className="text-3xl leading-tight font-bold text-balance sm:text-5xl">
              {first.title}
            </h2>
            <p className="mt-4 max-w-xl text-base text-white/90 sm:text-lg">{first.subtitle}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={first.ctaHref} className={cta.gold}>
                {first.ctaLabel}
              </Link>
              <Link href="/#how-it-works" className={cta.onDark}>
                {labels.secondaryCta}
              </Link>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div className="container-page pb-6">
          {children}
          {/* Keeps the place of the pause button and the progress bar of the carousel. */}
          <div className="mt-4 h-11" aria-hidden />
        </div>
      </div>
    </section>
  );
}
