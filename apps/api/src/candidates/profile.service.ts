import { Injectable, Logger } from '@nestjs/common';
import {
  isPassportExpiringSoon,
  profileCompleteness,
  type CandidateProfileInput,
  type CandidateProfileResponse,
  type DocumentType,
} from '@iconbridge/shared';
import { Clock } from '../common/clock/clock.js';
import { FieldCipher } from '../common/crypto/field-cipher.js';
import { protectPassportNumber, revealPassportNumber } from '../common/crypto/passport.js';
import { notFound } from '../common/errors/app.exception.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const PROFILE_INCLUDE = {
  languages: { orderBy: { language: 'asc' } },
  documents: { where: { deletedAt: null }, select: { type: true } },
} satisfies Prisma.CandidateProfileInclude;

export type ProfileRow = Prisma.CandidateProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

/** A DATE column as YYYY-MM-DD. */
export const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const toDate = (value: string | null) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly clock: Clock,
  ) {}

  async getOwn(userId: string): Promise<CandidateProfileResponse> {
    return this.toResponse(await this.findByUser(userId), { revealPassport: true });
  }

  /** Replaces the whole profile. The passport number is encrypted before it reaches the database. */
  async updateOwn(userId: string, input: CandidateProfileInput): Promise<CandidateProfileResponse> {
    const current = await this.findByUser(userId);
    const {
      languages,
      passportNumber,
      dateOfBirth,
      passportIssueDate,
      passportExpiryDate,
      ...fields
    } = input;
    const passport = passportNumber
      ? protectPassportNumber(this.cipher, passportNumber)
      : { passportNumberEncrypted: null, passportNumberMasked: null };

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.candidateLanguage.deleteMany({ where: { candidateId: current.id } });
      return tx.candidateProfile.update({
        where: { id: current.id },
        data: {
          ...fields,
          ...passport,
          dateOfBirth: toDate(dateOfBirth),
          passportIssueDate: toDate(passportIssueDate),
          passportExpiryDate: toDate(passportExpiryDate),
          languages: { create: languages },
        },
        include: PROFILE_INCLUDE,
      });
    });
    return this.toResponse(updated, { revealPassport: true });
  }

  async findByUser(
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<ProfileRow> {
    const profile = await client.candidateProfile.findUnique({
      where: { userId },
      include: PROFILE_INCLUDE,
    });
    if (!profile) {
      throw notFound('Candidate profile not found');
    }
    return profile;
  }

  /**
   * `revealPassport` is true for the owner and for back-office users only.
   * Everybody else gets the masked number and null for the clear one.
   */
  toResponse(profile: ProfileRow, options: { revealPassport: boolean }): CandidateProfileResponse {
    const documentTypes: DocumentType[] = profile.documents.map((document) => document.type);
    const passportExpiryDate = dateOnly(profile.passportExpiryDate);
    return {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      gender: profile.gender,
      dateOfBirth: dateOnly(profile.dateOfBirth),
      nationality: profile.nationality as CandidateProfileResponse['nationality'],
      countryOfResidence:
        profile.countryOfResidence as CandidateProfileResponse['countryOfResidence'],
      city: profile.city,
      phone: profile.phone,
      whatsapp: profile.whatsapp,
      passportNumber: options.revealPassport ? this.reveal(profile) : null,
      passportNumberMasked: profile.passportNumberMasked,
      passportIssuingCountry:
        profile.passportIssuingCountry as CandidateProfileResponse['passportIssuingCountry'],
      passportIssueDate: dateOnly(profile.passportIssueDate),
      passportExpiryDate,
      passportExpiringSoon: passportExpiryDate
        ? isPassportExpiringSoon(passportExpiryDate, this.clock.now())
        : false,
      currentProfession: profile.currentProfession,
      yearsOfExperience: profile.yearsOfExperience,
      educationLevel: profile.educationLevel,
      languages: profile.languages.map(({ language, level }) => ({ language, level })),
      drivingLicenceCategories: profile.drivingLicenceCategories,
      preferredDestinations: profile.preferredDestinations,
      hasStcwTraining: profile.hasStcwTraining,
      hasSeamanBook: profile.hasSeamanBook,
      hasMedicalCertificate: profile.hasMedicalCertificate,
      seaExperience: profile.seaExperience,
      gdprConsentAt: profile.gdprConsentAt?.toISOString() ?? null,
      profileCompleteness: profileCompleteness({
        ...profile,
        passportNumber: profile.passportNumberEncrypted,
        documentTypes,
      }),
    };
  }

  /** The clear passport number of a profile, for the audited "reveal" action of the back office. */
  async revealPassportNumber(profileId: string): Promise<string | null> {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id: profileId, user: { role: 'CANDIDATE', deletedAt: null } },
      select: { id: true, passportNumberEncrypted: true },
    });
    if (!profile) {
      throw notFound('Candidate not found');
    }
    return this.reveal(profile);
  }

  /** Clear passport number, or null when there is none or it cannot be decrypted (logged). */
  private reveal(profile: Pick<ProfileRow, 'id' | 'passportNumberEncrypted'>): string | null {
    if (!profile.passportNumberEncrypted) {
      return null;
    }
    try {
      return revealPassportNumber(this.cipher, profile.passportNumberEncrypted);
    } catch {
      this.logger.error(`Passport number of profile ${profile.id} cannot be decrypted`);
      return null;
    }
  }
}
