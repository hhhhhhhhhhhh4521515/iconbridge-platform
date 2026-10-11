'use client';

import { Pause, Play } from 'lucide-react';
import { domAnimation, LazyMotion, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { Swiper as SwiperInstance } from 'swiper';
import { A11y, Autoplay, EffectFade, Keyboard } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/effect-fade';
import { MediaImage } from '@/components/ui/media-image';
import { Link } from '@/i18n/navigation';
import { cta } from '@/lib/ui';
import { HERO_CONTENT, HERO_HEIGHT, type HeroLabels, type HeroSlide } from './hero-types';

const AUTOPLAY_MS = 6000;

/**
 * Full-width hero. One slide every 6 seconds with a cross-fade; the picture
 * zooms slowly, the texts come in one after the other, and a bar shows the time
 * left. It pauses while hovered, focused or stopped with the button, can be swiped,
 * and stands still (no autoplay, no zoom) when the visitor prefers reduced motion.
 */
export function HeroCarousel({
  slides,
  labels,
  firstDelayMs = AUTOPLAY_MS,
  children,
}: {
  slides: HeroSlide[];
  labels: HeroLabels;
  /** Time left for the first slide, which was already on screen before the carousel loaded. */
  firstDelayMs?: number;
  /** The search form, laid over the bottom of the hero. */
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const swiper = useRef<SwiperInstance | null>(null);
  const [active, setActive] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const paused = stopped || hovered || reduced;

  const toggle = useCallback(() => {
    setStopped((value) => {
      if (value) {
        swiper.current?.autoplay.start();
      } else {
        swiper.current?.autoplay.stop();
      }
      return !value;
    });
  }, []);

  // The carousel replaces a static copy of the first slide: that slide must not
  // fade in again. Texts animate from the first change of slide onwards.
  const [changed, setChanged] = useState(false);
  const enter = (delay: number) =>
    reduced || !changed
      ? {}
      : {
          initial: { opacity: 0, y: 28 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay, ease: 'easeOut' as const },
        };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={labels.region}
      data-hero="carousel"
      className={`relative isolate bg-brand-navy text-white ${paused ? 'hero-paused' : ''}`}
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
    >
      <Swiper
        modules={[Autoplay, EffectFade, A11y, Keyboard]}
        effect="fade"
        fadeEffect={{ crossFade: true }}
        speed={900}
        loop={slides.length > 1}
        keyboard={{ enabled: true }}
        autoplay={
          reduced
            ? false
            : { delay: AUTOPLAY_MS, pauseOnMouseEnter: true, disableOnInteraction: false }
        }
        onSwiper={(instance) => {
          swiper.current = instance;
        }}
        onSlideChange={(instance) => {
          setActive(instance.realIndex);
          setChanged(true);
        }}
        className={HERO_HEIGHT}
      >
        {slides.map((slide, index) => (
          <SwiperSlide
            key={slide.id}
            data-swiper-autoplay={index === 0 && !changed ? firstDelayMs : undefined}
            role="group"
            aria-roledescription="slide"
            aria-label={labels.slideOf
              .replace('{current}', String(index + 1))
              .replace('{total}', String(slides.length))}
          >
            <div className="absolute inset-0 overflow-hidden">
              <MediaImage
                // Restarting the zoom on each visit of the slide.
                key={index === active ? `on-${active}` : `off-${index}`}
                src={slide.image}
                alt=""
                fill
                priority={index === 0}
                loading={index === 0 ? undefined : 'lazy'}
                sizes="100vw"
                className={`object-cover ${index === active ? 'hero-zoom' : ''}`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-brand-navy via-brand-navy/60 to-brand-navy/30" />
            </div>
            <div className={HERO_CONTENT}>
              {index === active ? (
                // LazyMotion + "m" components: only the animation features used here are bundled.
                <LazyMotion features={domAnimation} strict>
                  <div className="max-w-2xl">
                    <m.h2
                      {...enter(0.1)}
                      className="text-3xl leading-tight font-bold text-balance sm:text-5xl"
                    >
                      {slide.title}
                    </m.h2>
                    <m.p
                      {...enter(0.25)}
                      className="mt-4 max-w-xl text-base text-white/90 sm:text-lg"
                    >
                      {slide.subtitle}
                    </m.p>
                    <m.div {...enter(0.4)} className="mt-6 flex flex-wrap gap-3">
                      <Link href={slide.ctaHref} className={cta.gold}>
                        {slide.ctaLabel}
                      </Link>
                      <Link href="/#how-it-works" className={cta.onDark}>
                        {labels.secondaryCta}
                      </Link>
                    </m.div>
                  </div>
                </LazyMotion>
              ) : null}
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      <div className="absolute inset-x-0 bottom-0 z-10">
        <div className="container-page pb-6">
          {children}
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              disabled={reduced}
              aria-label={stopped ? labels.play : labels.pause}
              className="inline-flex size-11 items-center justify-center rounded-full border border-white/50 bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
            >
              {stopped ? (
                <Play className="size-4" aria-hidden />
              ) : (
                <Pause className="size-4" aria-hidden />
              )}
            </button>
            <ol className="flex flex-1 gap-2" aria-hidden>
              {slides.map((slide, index) => (
                <li key={slide.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                  {index === active ? (
                    <span
                      key={`${active}-${stopped ? 'stopped' : 'running'}`}
                      className="hero-progress block h-full bg-brand-gold"
                      style={{ animationDuration: `${changed ? AUTOPLAY_MS : firstDelayMs}ms` }}
                    />
                  ) : index < active ? (
                    <span className="block h-full bg-white/70" />
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
