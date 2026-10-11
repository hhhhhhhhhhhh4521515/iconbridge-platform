import { brandImage, OG_SIZE } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'IconBridge Jobs';

const TITLES: Record<string, string> = {
  fr: 'Emplois à Malte, en Pologne et sur les navires de croisière',
  en: 'Jobs in Malta, Poland and on cruise ships',
  // Latin text: the image font has no Arabic glyphs.
  ar: 'Jobs in Malta, Poland and on cruise ships',
};

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return brandImage({
    eyebrow: 'IconBridge Recruitment Ltd',
    title: TITLES[locale] ?? TITLES['en'] ?? '',
    footer: 'Malta · Poland · Cruise ships',
  });
}
