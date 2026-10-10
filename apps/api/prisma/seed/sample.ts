import { faker } from '@faker-js/faker';
import type { LocalizedText } from '@iconbridge/shared';
import { FieldCipher } from '../../src/common/crypto/field-cipher.js';
import { protectPassportNumber } from '../../src/common/crypto/passport.js';
import { hashPassword } from '../../src/common/crypto/password.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type {
  EducationLevel,
  JobStatus,
  LanguageLevel,
  SalaryPeriod,
} from '../../src/generated/prisma/enums.js';
import type { SeedEnv } from './env.js';

// Sample data for local development only. Everything here is invented: names come
// from faker, emails use the reserved example.test domain, passport numbers start
// with FAKE, and image / consent paths point to blobs that do not exist.
// Rows are created when missing and never overwritten.

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

/** Fixed ids for tables without a natural key, so the seed can be run again. */
const sampleId = (group: number, index: number) =>
  `00000000-0000-4000-8000-${String(group).padStart(4, '0')}${String(index).padStart(8, '0')}`;

interface SampleJob {
  slug: string;
  title: string;
  destination: 'MALTA' | 'POLAND' | 'CRUISE_SHIP';
  category: string;
  salary: [min: number, max: number, currency: string, period: SalaryPeriod];
  months: number;
  positions: number;
  languages: string[];
  status?: JobStatus;
  featured?: boolean;
  deadlineInDays?: number;
}

const sampleJobs: SampleJob[] = [
  {
    slug: 'sample-hotel-receptionist-malta',
    title: 'Hotel Receptionist',
    destination: 'MALTA',
    category: 'hospitality',
    salary: [1100, 1400, 'EUR', 'MONTH'],
    months: 12,
    positions: 4,
    languages: ['en'],
    featured: true,
  },
  {
    slug: 'sample-line-cook-malta',
    title: 'Line Cook',
    destination: 'MALTA',
    category: 'hospitality',
    salary: [1200, 1500, 'EUR', 'MONTH'],
    months: 12,
    positions: 6,
    languages: ['en'],
  },
  {
    slug: 'sample-construction-labourer-malta',
    title: 'Construction Labourer',
    destination: 'MALTA',
    category: 'construction',
    salary: [7, 9, 'EUR', 'HOUR'],
    months: 24,
    positions: 10,
    languages: ['en'],
  },
  {
    slug: 'sample-delivery-driver-malta',
    title: 'Delivery Driver',
    destination: 'MALTA',
    category: 'transport',
    salary: [1000, 1300, 'EUR', 'MONTH'],
    months: 12,
    positions: 5,
    languages: ['en'],
  },
  {
    slug: 'sample-warehouse-operative-poland',
    title: 'Warehouse Operative',
    destination: 'POLAND',
    category: 'factory',
    salary: [4800, 5600, 'PLN', 'MONTH'],
    months: 12,
    positions: 20,
    languages: ['en'],
    featured: true,
  },
  {
    slug: 'sample-welder-poland',
    title: 'MIG/MAG Welder',
    destination: 'POLAND',
    category: 'construction',
    salary: [32, 40, 'PLN', 'HOUR'],
    months: 18,
    positions: 8,
    languages: ['en', 'pl'],
  },
  {
    slug: 'sample-greenhouse-worker-poland',
    title: 'Greenhouse Worker',
    destination: 'POLAND',
    category: 'agriculture',
    salary: [4300, 4900, 'PLN', 'MONTH'],
    months: 9,
    positions: 15,
    languages: [],
  },
  {
    slug: 'sample-truck-driver-poland',
    title: 'International Truck Driver (C+E)',
    destination: 'POLAND',
    category: 'transport',
    salary: [9000, 11000, 'PLN', 'MONTH'],
    months: 24,
    positions: 6,
    languages: ['en'],
  },
  {
    slug: 'sample-cabin-steward-cruise',
    title: 'Cabin Steward',
    destination: 'CRUISE_SHIP',
    category: 'maritime-cruise',
    salary: [1300, 1700, 'USD', 'MONTH'],
    months: 8,
    positions: 12,
    languages: ['en'],
    featured: true,
  },
  {
    slug: 'sample-assistant-waiter-cruise',
    title: 'Assistant Waiter',
    destination: 'CRUISE_SHIP',
    category: 'maritime-cruise',
    salary: [1200, 1600, 'USD', 'MONTH'],
    months: 8,
    positions: 10,
    languages: ['en', 'fr'],
  },
  // Not visible on the public site: one draft, and one closed job whose deadline has passed.
  {
    slug: 'sample-social-media-assistant-malta',
    title: 'Social Media Assistant',
    destination: 'MALTA',
    category: 'marketing',
    salary: [1300, 1600, 'EUR', 'MONTH'],
    months: 12,
    positions: 1,
    languages: ['en', 'fr'],
    status: 'DRAFT',
  },
  {
    slug: 'sample-fruit-picker-poland',
    title: 'Seasonal Fruit Picker',
    destination: 'POLAND',
    category: 'agriculture',
    salary: [25, 30, 'PLN', 'HOUR'],
    months: 3,
    positions: 30,
    languages: [],
    status: 'CLOSED',
    deadlineInDays: -10,
  },
];

const slideTexts: {
  code: 'MALTA' | 'POLAND' | 'CRUISE_SHIP';
  image: string;
  title: LocalizedText;
  subtitle: LocalizedText;
}[] = [
  {
    code: 'MALTA',
    image: 'seed/slides/malta.jpg',
    title: { en: 'Work in Malta', fr: 'Travaillez à Malte', ar: 'اعمل في مالطا' },
    subtitle: {
      en: 'Hospitality, construction and transport jobs under the Mediterranean sun.',
      fr: "Des emplois dans l'hôtellerie, le bâtiment et le transport sous le soleil de la Méditerranée.",
      ar: 'وظائف في الضيافة والبناء والنقل تحت شمس البحر الأبيض المتوسط.',
    },
  },
  {
    code: 'POLAND',
    image: 'seed/slides/poland.jpg',
    title: {
      en: 'Build your career in Poland',
      fr: 'Construisez votre carrière en Pologne',
      ar: 'ابنِ مسيرتك المهنية في بولندا',
    },
    subtitle: {
      en: 'Factory, logistics and agriculture employers are hiring now.',
      fr: "Des employeurs de l'industrie, de la logistique et de l'agriculture recrutent maintenant.",
      ar: 'أصحاب عمل في المصانع والخدمات اللوجستية والزراعة يوظفون الآن.',
    },
  },
  {
    code: 'CRUISE_SHIP',
    image: 'seed/slides/cruise-ship.jpg',
    title: {
      en: 'See the world on a cruise ship',
      fr: 'Découvrez le monde à bord d’un navire de croisière',
      ar: 'اكتشف العالم على متن سفينة سياحية',
    },
    subtitle: {
      en: 'Join the crew: housekeeping, restaurant and galley positions.',
      fr: "Rejoignez l'équipage : postes en cabines, restaurant et cuisine.",
      ar: 'انضم إلى الطاقم: وظائف في التدبير الفندقي والمطعم والمطبخ.',
    },
  },
];

const ctaLabel: LocalizedText = { en: 'View jobs', fr: 'Voir les offres', ar: 'عرض الوظائف' };

const storyTexts: {
  jobTitle: string;
  code: 'MALTA' | 'POLAND' | 'CRUISE_SHIP';
  quote: LocalizedText;
}[] = [
  {
    jobTitle: 'Hotel Receptionist',
    code: 'MALTA',
    quote: {
      en: 'Sample quote: the team guided me at every step, from the interview to my arrival.',
      fr: "Citation d'exemple : l'équipe m'a accompagné à chaque étape, de l'entretien à mon arrivée.",
      ar: 'اقتباس تجريبي: رافقني الفريق في كل خطوة، من المقابلة حتى وصولي.',
    },
  },
  {
    jobTitle: 'Warehouse Operative',
    code: 'POLAND',
    quote: {
      en: 'Sample quote: I always knew where my application stood.',
      fr: "Citation d'exemple : j'ai toujours su où en était ma candidature.",
      ar: 'اقتباس تجريبي: كنت أعرف دائمًا إلى أين وصل طلبي.',
    },
  },
  {
    jobTitle: 'Cabin Steward',
    code: 'CRUISE_SHIP',
    quote: {
      en: 'Sample quote: my visa was approved and I joined the ship two weeks later.',
      fr: "Citation d'exemple : mon visa a été approuvé et j'ai embarqué deux semaines plus tard.",
      ar: 'اقتباس تجريبي: تمت الموافقة على تأشيرتي والتحقت بالسفينة بعد أسبوعين.',
    },
  },
  {
    jobTitle: 'Line Cook',
    code: 'MALTA',
    quote: {
      en: 'Sample quote: nobody ever asked me for money to apply.',
      fr: "Citation d'exemple : personne ne m'a jamais demandé d'argent pour postuler.",
      ar: 'اقتباس تجريبي: لم يطلب مني أحد مالًا للتقديم.',
    },
  },
];

const educationLevels: EducationLevel[] = ['SECONDARY', 'VOCATIONAL', 'BACHELOR'];
const languageLevels: LanguageLevel[] = ['A2', 'B1', 'B2', 'C1'];

export interface SampleCounts {
  jobs: number;
  homeSlides: number;
  successStories: number;
  candidates: number;
}

export async function seedSampleData(
  prisma: PrismaClient,
  env: SeedEnv,
  adminId: string,
): Promise<SampleCounts> {
  faker.seed(20261010);

  const destinationIds = new Map(
    (await prisma.destination.findMany({ select: { id: true, code: true } })).map((d) => [
      d.code,
      d.id,
    ]),
  );
  const categoryIds = new Map(
    (await prisma.jobCategory.findMany({ select: { id: true, slug: true } })).map((c) => [
      c.slug,
      c.id,
    ]),
  );
  const destinationId = (code: string) => {
    const id = destinationIds.get(code);
    if (!id) throw new Error(`Destination ${code} is missing: run the reference seed first`);
    return id;
  };
  const categoryId = (slug: string) => {
    const id = categoryIds.get(slug);
    if (!id) throw new Error(`Category ${slug} is missing: run the reference seed first`);
    return id;
  };

  for (const job of sampleJobs) {
    const status = job.status ?? 'PUBLISHED';
    const [salaryMin, salaryMax, salaryCurrency, salaryPeriod] = job.salary;
    const onShip = job.destination === 'CRUISE_SHIP';
    await prisma.job.upsert({
      where: { slug: job.slug },
      update: {},
      create: {
        slug: job.slug,
        title: job.title,
        destinationId: destinationId(job.destination),
        categoryId: categoryId(job.category),
        employerName: `Sample Employer ${faker.string.alpha({ length: 3, casing: 'upper' })}`,
        showEmployerName: false,
        description: `[Sample offer] ${faker.lorem.paragraphs(2)}`,
        requirements: faker.lorem.sentences(3),
        benefits: faker.lorem.sentence(),
        accommodationProvided: true,
        transportProvided: !onShip,
        mealsProvided: onShip || job.category === 'hospitality',
        salaryMin,
        salaryMax,
        salaryCurrency,
        salaryPeriod,
        contractDurationMonths: job.months,
        workingHours: onShip
          ? '10 hours a day, 7 days a week, during the contract'
          : '40 hours a week',
        positions: job.positions,
        requiredLanguages: job.languages,
        deadline: daysFromNow(job.deadlineInDays ?? faker.number.int({ min: 30, max: 120 })),
        status,
        featured: job.featured ?? false,
        createdById: adminId,
        publishedAt: status === 'DRAFT' ? null : daysFromNow(-20),
        closedAt: status === 'CLOSED' ? daysFromNow(-10) : null,
      },
    });
  }

  for (const [index, slide] of slideTexts.entries()) {
    const id = sampleId(1, index + 1);
    await prisma.homeSlide.upsert({
      where: { id },
      update: {},
      create: {
        id,
        title: slide.title,
        subtitle: slide.subtitle,
        imagePath: slide.image,
        ctaLabel,
        ctaUrl: `/jobs?destination=${slide.code}`,
        destinationId: destinationId(slide.code),
        sortOrder: index + 1,
      },
    });
  }

  for (const [index, story] of storyTexts.entries()) {
    const id = sampleId(2, index + 1);
    await prisma.successStory.upsert({
      where: { id },
      update: {},
      create: {
        id,
        firstName: faker.person.firstName(),
        lastName: 'Sample',
        jobTitle: story.jobTitle,
        destinationId: destinationId(story.code),
        visaApprovedAt: daysFromNow(-30 * (index + 2)),
        quote: story.quote,
        consentDocumentPath: `seed/consents/sample-${index + 1}.pdf`,
        isPublished: true,
        sortOrder: index + 1,
      },
    });
  }

  const cipher = new FieldCipher(env.PASSPORT_ENCRYPTION_KEY);
  // Hashed once: argon2 is slow on purpose.
  const candidatePasswordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
  const candidateCount = 5;

  for (let n = 1; n <= candidateCount; n++) {
    // Drawn before the existence check so every run consumes the same random sequence.
    const profile = {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      gender: faker.helpers.arrayElement(['MALE', 'FEMALE'] as const),
      dateOfBirth: faker.date.birthdate({ mode: 'age', min: 21, max: 45 }),
      nationality: faker.helpers.arrayElement(['TN', 'MA', 'DZ', 'EG']),
      city: faker.location.city(),
      currentProfession: faker.person.jobTitle(),
      yearsOfExperience: faker.number.int({ min: 1, max: 15 }),
      educationLevel: faker.helpers.arrayElement(educationLevels),
      englishLevel: faker.helpers.arrayElement(languageLevels),
      frenchLevel: faker.helpers.arrayElement(languageLevels),
    };
    const email = `candidate${n}@example.test`;
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      continue;
    }
    const seaReady = n === 1;
    await prisma.user.create({
      data: {
        email,
        passwordHash: candidatePasswordHash,
        role: 'CANDIDATE',
        emailVerifiedAt: new Date(),
        candidateProfile: {
          create: {
            firstName: profile.firstName,
            lastName: profile.lastName,
            gender: profile.gender,
            dateOfBirth: profile.dateOfBirth,
            nationality: profile.nationality,
            countryOfResidence: profile.nationality,
            city: profile.city,
            // +999 is not an assigned country code.
            phone: `+99955500${String(n).padStart(4, '0')}`,
            whatsapp: `+99955500${String(n).padStart(4, '0')}`,
            ...protectPassportNumber(cipher, `FAKE${String(n).padStart(6, '0')}`),
            passportIssuingCountry: profile.nationality,
            passportIssueDate: daysFromNow(-365 * 2),
            // Candidate 5 has a passport that expires in under 6 months (warning case).
            passportExpiryDate: daysFromNow(n === 5 ? 90 : 365 * 5),
            currentProfession: profile.currentProfession,
            yearsOfExperience: profile.yearsOfExperience,
            educationLevel: profile.educationLevel,
            drivingLicenceCategories: n % 2 === 0 ? ['B'] : [],
            hasStcwTraining: seaReady,
            hasSeamanBook: seaReady,
            hasMedicalCertificate: seaReady,
            seaExperience: seaReady ? 'Sample: two contracts as cabin steward.' : null,
            gdprConsentAt: new Date(),
            languages: {
              create: [
                { language: 'ar', level: 'NATIVE' },
                { language: 'en', level: profile.englishLevel },
                { language: 'fr', level: profile.frenchLevel },
              ],
            },
          },
        },
      },
    });
  }

  return {
    jobs: sampleJobs.length,
    homeSlides: slideTexts.length,
    successStories: storyTexts.length,
    candidates: candidateCount,
  };
}
