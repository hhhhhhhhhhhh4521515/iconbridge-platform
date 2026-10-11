export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface HeroLabels {
  region: string;
  slideOf: string;
  pause: string;
  play: string;
  secondaryCta: string;
}

/** Shared by the static first slide and the carousel, so swapping one for the other moves nothing. */
export const HERO_HEIGHT = 'h-[42rem] sm:h-[38rem] lg:h-[42rem]';
export const HERO_CONTENT =
  'container-page relative flex h-full flex-col justify-center pb-72 sm:pb-36';
