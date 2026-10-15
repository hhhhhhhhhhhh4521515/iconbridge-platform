'use client';

import {
  candidateProfileFields,
  candidateProfileSchema,
  CRUISE_DESTINATION,
  PROFILE_STEPS,
  type ProfileItem,
  type ProfileStep,
} from '@iconbridge/shared/candidate';
import { EDUCATION_LEVELS, GENDERS, LANGUAGE_LEVELS } from '@iconbridge/shared/enums';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type DefaultValues,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';
import { CheckGroup } from '@/components/forms/check-group';
import { CountryField } from '@/components/forms/country-select';
import { DateField } from '@/components/forms/date-field';
import {
  CheckField,
  FormError,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
  useApiErrorText,
  useErrorText,
} from '@/components/forms/fields';
import { PhoneInput } from '@/components/forms/phone-input';
import { Link, useRouter } from '@/i18n/navigation';
import { api, attempt, failure, type Profile } from '@/lib/client-api';
import { DRIVING_LICENCE_CATEGORIES, SPOKEN_LANGUAGES } from '@/lib/countries';
import { languageName, pick } from '@/lib/format';
import { refusedFields, zodResolver } from '@/lib/forms';
import { card, cta } from '@/lib/ui';
import { useAccount, useLoaded } from './account-context';
import { PageTitle } from './account-shell';
import { ITEM_LINKS } from './dashboard';
import { DocumentsManager, PassportWarning } from './documents-manager';

const WIZARD_STEPS = [
  'identity',
  'passport',
  'experience',
  'languages',
  'licence',
  'cruise',
  'documents',
] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

/** Years offered by the date lists start from this one. */
const THIS_YEAR = new Date().getFullYear();

const FIELD_NAMES = Object.keys(candidateProfileFields.shape);

/** The editable fields of a profile, without what the API adds (completeness, masked number...). */
function editable(profile: Profile): Record<string, unknown> {
  const source = profile as unknown as Record<string, unknown>;
  return Object.fromEntries(FIELD_NAMES.map((name) => [name, source[name]]));
}

/** An empty input means "not provided": the API expects null, not an empty text. */
function clean(values: FieldValues): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      value === '' || (typeof value === 'number' && Number.isNaN(value))
        ? null
        : typeof value === 'string'
          ? value.trim() || null
          : value,
    ]),
  );
}

/**
 * One step of the wizard. The step edits a few fields; what is validated and saved is
 * the whole profile (PUT /me/profile replaces it), with the other steps left as they are.
 */
function useStep<Values extends FieldValues>(
  step: ProfileStep,
  defaultValues: DefaultValues<Values>,
  onSaved: () => void,
) {
  const { profile, setProfile } = useAccount();
  const apiError = useApiErrorText();
  const t = useTranslations('account.profile');
  const [problem, setProblem] = useState<string | null>(null);
  const form = useForm<Values, unknown, typeof candidateProfileSchema._output>({
    resolver: zodResolver<typeof candidateProfileSchema, Values>(candidateProfileSchema, {
      prepare: (values) => ({ ...editable(profile), ...clean(values) }),
      only: PROFILE_STEPS[step],
    }),
    defaultValues,
    mode: 'onTouched',
  });
  const submit = form.handleSubmit(async (body) => {
    setProblem(null);
    const { data, error } = await attempt(api.PUT('/api/v1/me/profile', { body }));
    if (!data) {
      const { code, details } = failure(error);
      const fields = refusedFields(details);
      setProblem(
        code === 'VALIDATION_ERROR' && fields.length > 0
          ? t('refused', { fields: fields.join(', ') })
          : apiError(code),
      );
      return;
    }
    setProfile(data);
    onSaved();
  });
  // A rule broken in another step (an expired passport, for example) also stops this one.
  const elsewhere = (form.formState.errors.root as { other?: { message?: string } } | undefined)
    ?.other?.message;
  return {
    form,
    submit,
    problem: problem ?? (elsewhere ? t('otherStep', { field: elsewhere }) : null),
  };
}

function StepForm<Values extends FieldValues>({
  title,
  intro,
  form,
  submit,
  problem,
  back,
  children,
}: {
  title: string;
  intro?: string;
  form: UseFormReturn<Values, unknown, typeof candidateProfileSchema._output>;
  submit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  problem: string | null;
  back: string | null;
  children: ReactNode;
}) {
  const t = useTranslations('account.profile');
  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className={`${card} p-5`}
      aria-labelledby="step-title"
    >
      <h2 id="step-title" className="text-lg font-semibold">
        {title}
      </h2>
      {intro ? <p className="mt-1 text-sm text-muted-foreground">{intro}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
      <div className="mt-5 space-y-3">
        <FormError>{problem}</FormError>
        <div className="flex flex-wrap items-center gap-3">
          {back ? (
            <Link href={`/account/profile?step=${back}`} className={cta.outline}>
              {t('back')}
            </Link>
          ) : null}
          <SubmitButton busy={form.formState.isSubmitting}>{t('saveAndContinue')}</SubmitButton>
        </div>
      </div>
    </form>
  );
}

interface StepProps {
  back: string | null;
  onSaved: () => void;
}

interface IdentityValues {
  firstName: string;
  lastName: string;
  gender: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
  countryOfResidence: string | null;
  city: string | null;
  phone: string | null;
  whatsapp: string | null;
  preferredDestinations: string[];
}

function IdentityStep({ back, onSaved }: StepProps) {
  const t = useTranslations('account.profile');
  const forms = useTranslations('forms');
  const locale = useLocale();
  const { profile } = useAccount();
  const step = useStep<IdentityValues>(
    'identity',
    {
      firstName: profile.firstName,
      lastName: profile.lastName,
      gender: profile.gender,
      dateOfBirth: profile.dateOfBirth,
      nationality: profile.nationality,
      countryOfResidence: profile.countryOfResidence,
      city: profile.city,
      phone: profile.phone,
      whatsapp: profile.whatsapp,
      preferredDestinations: profile.preferredDestinations,
    },
    onSaved,
  );
  const { register, control, formState } = step.form;
  const { errors } = formState;
  const fetcher = useCallback(async () => (await api.GET('/api/v1/destinations')).data, []);
  const destinations = useLoaded(fetcher).data ?? [];
  return (
    <StepForm title={t('steps.identity')} intro={t('identityIntro')} {...step} back={back}>
      <TextField
        label={t('firstName')}
        autoComplete="given-name"
        required
        error={errors.firstName}
        {...register('firstName')}
      />
      <TextField
        label={t('lastName')}
        autoComplete="family-name"
        required
        error={errors.lastName}
        {...register('lastName')}
      />
      <SelectField label={t('gender')} error={errors.gender} {...register('gender')}>
        <option value="">{forms('choose')}</option>
        {GENDERS.map((gender) => (
          <option key={gender} value={gender}>
            {t(`genders.${gender}`)}
          </option>
        ))}
      </SelectField>
      <DateField
        control={control}
        name="dateOfBirth"
        label={t('dateOfBirth')}
        hint={t('dateOfBirthHint')}
        error={errors.dateOfBirth}
        fromYear={THIS_YEAR}
        toYear={THIS_YEAR - 90}
      />
      <CountryField
        control={control}
        name="nationality"
        label={t('nationality')}
        error={errors.nationality}
      />
      <CountryField
        control={control}
        name="countryOfResidence"
        label={t('countryOfResidence')}
        error={errors.countryOfResidence}
      />
      <TextField
        label={t('city')}
        autoComplete="address-level2"
        error={errors.city}
        {...register('city')}
      />
      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <PhoneInput
            name="phone"
            label={t('phone')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error}
            defaultCountry={profile.countryOfResidence ?? undefined}
          />
        )}
      />
      <Controller
        control={control}
        name="whatsapp"
        render={({ field, fieldState }) => (
          <PhoneInput
            name="whatsapp"
            label={t('whatsapp')}
            hint={t('whatsappHint')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error}
            defaultCountry={profile.countryOfResidence ?? undefined}
          />
        )}
      />
      <div className="sm:col-span-2">
        <Controller
          control={control}
          name="preferredDestinations"
          render={({ field }) => (
            <CheckGroup
              legend={t('preferredDestinations')}
              hint={t('preferredDestinationsHint')}
              columns="sm:grid-cols-3"
              value={field.value}
              onChange={field.onChange}
              options={destinations.map((destination) => ({
                value: destination.code,
                label: pick(destination.name, locale),
              }))}
            />
          )}
        />
      </div>
    </StepForm>
  );
}

const PASSPORT_FIELDS = [
  'passportNumber',
  'passportIssuingCountry',
  'passportIssueDate',
  'passportExpiryDate',
] as const;

interface PassportValues {
  passportNumber: string | null;
  passportIssuingCountry: string | null;
  passportIssueDate: string | null;
  passportExpiryDate: string | null;
}

function PassportStep({ back, onSaved }: StepProps) {
  const t = useTranslations('account.profile');
  const { profile } = useAccount();
  const step = useStep<PassportValues>(
    'passport',
    {
      passportNumber: profile.passportNumber,
      passportIssuingCountry: profile.passportIssuingCountry,
      passportIssueDate: profile.passportIssueDate,
      passportExpiryDate: profile.passportExpiryDate,
    },
    onSaved,
  );
  const { register, control, formState, trigger } = step.form;
  const { errors } = formState;
  // "Fill in every passport field, or none" spans the four fields but is shown on the
  // number. Each field only checks itself when it changes, so the message stayed after
  // the last field was filled in, as if the form refused it, and could go at the very
  // moment "Save" was pressed, moving the button. All four are checked again as soon as
  // one of them changes, while a problem is shown.
  const passport = useWatch({ control, name: PASSPORT_FIELDS });
  const shown = PASSPORT_FIELDS.some((name) => errors[name]);
  useEffect(() => {
    if (shown) void trigger(PASSPORT_FIELDS);
    // Only a change of a value runs this again, not the errors it updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(passport)]);
  return (
    <StepForm title={t('steps.passport')} intro={t('passportIntro')} {...step} back={back}>
      <TextField
        label={t('passportNumber')}
        hint={t('passportNumberHint')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        dir="ltr"
        error={errors.passportNumber}
        {...register('passportNumber')}
      />
      <CountryField
        control={control}
        name="passportIssuingCountry"
        label={t('passportIssuingCountry')}
        error={errors.passportIssuingCountry}
      />
      <DateField
        control={control}
        name="passportIssueDate"
        label={t('passportIssueDate')}
        error={errors.passportIssueDate}
        fromYear={THIS_YEAR}
        toYear={THIS_YEAR - 15}
      />
      <DateField
        control={control}
        name="passportExpiryDate"
        label={t('passportExpiryDate')}
        error={errors.passportExpiryDate}
        fromYear={THIS_YEAR - 2}
        toYear={THIS_YEAR + 15}
      />
    </StepForm>
  );
}

interface ExperienceValues {
  currentProfession: string | null;
  yearsOfExperience: number | null;
  educationLevel: string | null;
}

function ExperienceStep({ back, onSaved }: StepProps) {
  const t = useTranslations('account.profile');
  const forms = useTranslations('forms');
  const { profile } = useAccount();
  const step = useStep<ExperienceValues>(
    'experience',
    {
      currentProfession: profile.currentProfession,
      yearsOfExperience: profile.yearsOfExperience,
      educationLevel: profile.educationLevel,
    },
    onSaved,
  );
  const { register, formState } = step.form;
  const { errors } = formState;
  return (
    <StepForm title={t('steps.experience')} {...step} back={back}>
      <TextField
        className="sm:col-span-2"
        label={t('currentProfession')}
        hint={t('currentProfessionHint')}
        autoComplete="organization-title"
        error={errors.currentProfession}
        {...register('currentProfession')}
      />
      <TextField
        label={t('yearsOfExperience')}
        type="number"
        inputMode="numeric"
        min={0}
        max={70}
        error={errors.yearsOfExperience}
        {...register('yearsOfExperience', { valueAsNumber: true })}
      />
      <SelectField
        label={t('educationLevel')}
        error={errors.educationLevel}
        {...register('educationLevel')}
      >
        <option value="">{forms('choose')}</option>
        {EDUCATION_LEVELS.map((level) => (
          <option key={level} value={level}>
            {t(`education.${level}`)}
          </option>
        ))}
      </SelectField>
    </StepForm>
  );
}

interface LanguagesValues {
  languages: { language: string; level: string }[];
}

function LanguagesStep({ back, onSaved }: StepProps) {
  const t = useTranslations('account.profile');
  const forms = useTranslations('forms');
  const locale = useLocale();
  const errorText = useErrorText();
  const { profile } = useAccount();
  const step = useStep<LanguagesValues>('languages', { languages: profile.languages }, onSaved);
  const { register, control, formState } = step.form;
  const rows = useFieldArray({ control, name: 'languages' });
  const listError = errorText(formState.errors.languages?.root);
  const options = [...SPOKEN_LANGUAGES]
    .map((code) => ({ code, name: languageName(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  return (
    <StepForm title={t('steps.languages')} intro={t('languagesIntro')} {...step} back={back}>
      <div className="space-y-3 sm:col-span-2">
        {rows.fields.length === 0 ? (
          <p className="rounded-lg bg-muted p-4 text-sm">{t('noLanguages')}</p>
        ) : null}
        {rows.fields.map((row, index) => (
          <div
            key={row.id}
            className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
            data-testid="language-row"
          >
            <SelectField
              label={t('language')}
              required
              error={formState.errors.languages?.[index]?.language}
              {...register(`languages.${index}.language`)}
            >
              <option value="">{forms('choose')}</option>
              {options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t('level')}
              required
              error={formState.errors.languages?.[index]?.level}
              {...register(`languages.${index}.level`)}
            >
              <option value="">{forms('choose')}</option>
              {LANGUAGE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(`levels.${level}`)}
                </option>
              ))}
            </SelectField>
            <button
              type="button"
              className={`${cta.ghost} text-destructive`}
              onClick={() => {
                rows.remove(index);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {t('removeLanguage')}
            </button>
          </div>
        ))}
        {listError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {listError}
          </p>
        ) : null}
        <button
          type="button"
          className={cta.outline}
          disabled={rows.fields.length >= 15}
          onClick={() => {
            rows.append({ language: '', level: '' });
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t('addLanguage')}
        </button>
      </div>
    </StepForm>
  );
}

function LicenceStep({ back, onSaved }: StepProps) {
  const t = useTranslations('account.profile');
  const { profile } = useAccount();
  const step = useStep<{ drivingLicenceCategories: string[] }>(
    'licence',
    { drivingLicenceCategories: profile.drivingLicenceCategories },
    onSaved,
  );
  return (
    <StepForm title={t('steps.licence')} {...step} back={back}>
      <div className="sm:col-span-2">
        <Controller
          control={step.form.control}
          name="drivingLicenceCategories"
          render={({ field }) => (
            <CheckGroup
              legend={t('licenceCategories')}
              hint={t('licenceHint')}
              columns="grid-cols-3 sm:grid-cols-5"
              value={field.value}
              onChange={field.onChange}
              options={DRIVING_LICENCE_CATEGORIES.map((category) => ({
                value: category,
                label: category,
              }))}
            />
          )}
        />
      </div>
    </StepForm>
  );
}

interface CruiseValues {
  hasStcwTraining: boolean;
  hasSeamanBook: boolean;
  hasMedicalCertificate: boolean;
  seaExperience: string | null;
}

function CruiseStep({ back, onSaved }: StepProps) {
  const t = useTranslations('account.profile');
  const { profile } = useAccount();
  const step = useStep<CruiseValues>(
    'cruise',
    {
      hasStcwTraining: profile.hasStcwTraining,
      hasSeamanBook: profile.hasSeamanBook,
      hasMedicalCertificate: profile.hasMedicalCertificate,
      seaExperience: profile.seaExperience,
    },
    onSaved,
  );
  const { register, formState } = step.form;
  return (
    <StepForm title={t('steps.cruise')} intro={t('cruiseIntro')} {...step} back={back}>
      <div className="sm:col-span-2">
        <CheckField {...register('hasStcwTraining')}>{t('hasStcwTraining')}</CheckField>
        <CheckField {...register('hasSeamanBook')}>{t('hasSeamanBook')}</CheckField>
        <CheckField {...register('hasMedicalCertificate')}>{t('hasMedicalCertificate')}</CheckField>
      </div>
      <TextAreaField
        className="sm:col-span-2"
        label={t('seaExperience')}
        hint={t('seaExperienceHint')}
        error={formState.errors.seaExperience}
        {...register('seaExperience')}
      />
    </StepForm>
  );
}

function DocumentsStep({ back }: { back: string | null }) {
  const t = useTranslations('account.profile');
  return (
    <div className="space-y-6">
      <PassportWarning />
      <DocumentsManager />
      <div className="flex flex-wrap gap-3">
        {back ? (
          <Link href={`/account/profile?step=${back}`} className={cta.outline}>
            {t('back')}
          </Link>
        ) : null}
        <Link href="/account" className={cta.primary}>
          {t('finish')}
        </Link>
      </div>
    </div>
  );
}

/** Missing items of each step, to tick the steps that are complete. */
function missingIn(step: WizardStep, missing: readonly ProfileItem[]): number {
  const target = step === 'documents' ? '/account/documents' : `/account/profile?step=${step}`;
  return missing.filter((item) => ITEM_LINKS[item] === target).length;
}

export function ProfileWizard() {
  const t = useTranslations('account.profile');
  const router = useRouter();
  const { profile } = useAccount();
  const requested = useSearchParams().get('step');
  const steps = WIZARD_STEPS.filter(
    (step) => step !== 'cruise' || profile.preferredDestinations.includes(CRUISE_DESTINATION),
  );
  const current = steps.find((step) => step === requested) ?? 'identity';
  const index = steps.indexOf(current);
  const back = steps[index - 1] ?? null;
  const next = steps[index + 1] ?? 'documents';
  const onSaved = () => {
    router.push(`/account/profile?step=${next}`);
  };
  const props = { back, onSaved };
  return (
    <>
      <PageTitle title={t('title')} intro={t('intro')} />
      <nav aria-label={t('stepsLabel')} className="mb-6">
        {/* "relative": the hidden texts of the steps stay inside the scrolling list. */}
        <ol className="relative flex gap-2 overflow-x-auto pb-2">
          {steps.map((step, position) => {
            const done = missingIn(step, profile.profileCompleteness.missing) === 0;
            return (
              <li key={step}>
                <Link
                  href={`/account/profile?step=${step}`}
                  aria-current={step === current ? 'step' : undefined}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium whitespace-nowrap hover:bg-muted aria-[current=step]:border-primary aria-[current=step]:bg-primary aria-[current=step]:text-primary-foreground"
                >
                  <span
                    className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs text-foreground"
                    aria-hidden
                  >
                    {done ? <Check className="size-4" /> : position + 1}
                  </span>
                  {t(`steps.${step}`)}
                  {done ? <span className="sr-only"> ({t('stepDone')})</span> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      {/* A new form for each step: its fields start from the profile as it is now. */}
      <div key={current}>
        {current === 'identity' ? <IdentityStep {...props} /> : null}
        {current === 'passport' ? <PassportStep {...props} /> : null}
        {current === 'experience' ? <ExperienceStep {...props} /> : null}
        {current === 'languages' ? <LanguagesStep {...props} /> : null}
        {current === 'licence' ? <LicenceStep {...props} /> : null}
        {current === 'cruise' ? <CruiseStep {...props} /> : null}
        {current === 'documents' ? <DocumentsStep back={back} /> : null}
      </div>
    </>
  );
}
