import { DEFAULT_SETTINGS, SETTING_KEYS, type LocalizedText } from '@iconbridge/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

// Reference data needed in every environment. Rows are created when missing and
// never overwritten, so values edited by an admin survive a new seed.

const destinations: { code: string; name: LocalizedText; icon: string; sortOrder: number }[] = [
  { code: 'MALTA', name: { en: 'Malta', fr: 'Malte', ar: 'مالطا' }, icon: '🇲🇹', sortOrder: 1 },
  { code: 'POLAND', name: { en: 'Poland', fr: 'Pologne', ar: 'بولندا' }, icon: '🇵🇱', sortOrder: 2 },
  {
    code: 'CRUISE_SHIP',
    name: { en: 'Cruise ship', fr: 'Navire de croisière', ar: 'سفينة سياحية' },
    icon: '🚢',
    sortOrder: 3,
  },
];

const categories: { slug: string; name: LocalizedText; icon: string }[] = [
  {
    slug: 'hospitality',
    name: { en: 'Hospitality', fr: 'Hôtellerie et restauration', ar: 'الضيافة' },
    icon: 'concierge-bell',
  },
  {
    slug: 'construction',
    name: { en: 'Construction', fr: 'Bâtiment', ar: 'البناء' },
    icon: 'hard-hat',
  },
  {
    slug: 'agriculture',
    name: { en: 'Agriculture', fr: 'Agriculture', ar: 'الزراعة' },
    icon: 'wheat',
  },
  { slug: 'transport', name: { en: 'Transport', fr: 'Transport', ar: 'النقل' }, icon: 'truck' },
  { slug: 'factory', name: { en: 'Factory', fr: 'Industrie', ar: 'المصانع' }, icon: 'factory' },
  {
    slug: 'marketing',
    name: { en: 'Marketing', fr: 'Marketing', ar: 'التسويق' },
    icon: 'megaphone',
  },
  {
    slug: 'maritime-cruise',
    name: { en: 'Maritime / Cruise', fr: 'Maritime / Croisière', ar: 'الملاحة / الرحلات البحرية' },
    icon: 'ship',
  },
];

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const destination of destinations) {
    await prisma.destination.upsert({
      where: { code: destination.code },
      update: {},
      create: destination,
    });
  }
  for (const category of categories) {
    await prisma.jobCategory.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }
  for (const key of SETTING_KEYS) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: DEFAULT_SETTINGS[key] },
    });
  }
}
