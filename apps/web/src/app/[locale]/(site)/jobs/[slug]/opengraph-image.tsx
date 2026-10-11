import { api } from '@/lib/api';
import { pick } from '@/lib/format';
import { brandImage, OG_SIZE } from '@/lib/og';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Job offer on IconBridge Jobs';

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { slug } = await params;
  const job = await api.job(slug);
  return brandImage({
    eyebrow: job ? pick(job.destination.name, 'en') : 'IconBridge Jobs',
    title: job?.title ?? 'Jobs in Malta, Poland and on cruise ships',
    footer: 'Apply online, free for candidates',
  });
}
