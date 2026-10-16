import { HttpStatus, Injectable } from '@nestjs/common';
import {
  answerText,
  parseJobQuestions,
  EXPORT_MAX_ROWS,
  RESTRICTED_EXPORT_COLUMN,
  type ExportApplicationsInput,
  type ExportColumn,
} from '@iconbridge/shared';
import { z } from 'zod';
import type { AuthUser } from '../../auth/auth.types.js';
import { FieldCipher } from '../../common/crypto/field-cipher.js';
import { revealPassportNumber } from '../../common/crypto/passport.js';
import { AppException, forbidden } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { applicationWhere } from './admin-applications.service.js';

export const EXPORT_HEADERS: Record<ExportColumn, string> = {
  applicationId: 'Application ID',
  status: 'Status',
  appliedAt: 'Applied at',
  jobTitle: 'Job',
  destination: 'Destination',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  nationality: 'Nationality',
  countryOfResidence: 'Country of residence',
  dateOfBirth: 'Date of birth',
  passportNumberMasked: 'Passport (masked)',
  passportExpiryDate: 'Passport expiry',
  currentProfession: 'Profession',
  yearsOfExperience: 'Years of experience',
  languages: 'Languages',
  answers: 'Answers',
  passportNumber: 'Passport number',
};

export interface ExportFile {
  content: Buffer;
  contentType: string;
  fileName: string;
  rows: number;
}

type Cell = string | number | null;

const date = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

/** A phone number or a plain signed number: starts with + or - but cannot be a formula. */
const SIGNED_NUMBER = /^[+-]\d[\d\s.]*$/;

/**
 * A cell that starts with = + - @ (or a tab / carriage return) would be run as a
 * formula by Excel. Names and free text come from candidates, so such cells get
 * a leading apostrophe, which marks them as plain text. International phone
 * numbers ("+216...") are left as they are.
 */
export function neutraliseFormula(value: Cell): Cell {
  if (typeof value !== 'string' || !/^[=+\-@\t\r]/.test(value) || SIGNED_NUMBER.test(value)) {
    return value;
  }
  return `'${value}`;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const cell = (value: Cell) => {
    const text = value === null ? '' : String(neutraliseFormula(value));
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  // Byte-order mark so Excel reads UTF-8 (Arabic and accented names).
  const bom = String.fromCharCode(0xfeff);
  return `${bom}${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/**
 * "Question: answer" for each answer, on one line each. Questions are named by their
 * English label; answers given before a job had questions keep the key they were sent with.
 */
export function answersCell(questions: unknown, answers: unknown): string | null {
  const given = z.record(z.string(), z.string()).safeParse(answers ?? {});
  if (!given.success || Object.keys(given.data).length === 0) {
    return null;
  }
  const asked = new Map(parseJobQuestions(questions).map((question) => [question.id, question]));
  return Object.entries(given.data)
    .map(([key, answer]) => {
      const question = asked.get(key);
      return question
        ? `${question.label.en}: ${answerText(question, answer, 'en')}`
        : `${key}: ${answer}`;
    })
    .join('\n');
}

@Injectable()
export class ApplicationExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipher,
    private readonly audit: AuditService,
  ) {}

  /**
   * Builds the file and writes the audit entry. The full passport number is
   * included only for a SUPER_ADMIN who asked for it explicitly; every export is
   * logged with its columns and row count, and that flag.
   */
  async export(
    input: ExportApplicationsInput,
    user: AuthUser,
    ip: string | null,
  ): Promise<ExportFile> {
    const withPassport = input.columns.includes(RESTRICTED_EXPORT_COLUMN);
    if (withPassport && user.role !== 'SUPER_ADMIN') {
      throw forbidden('Only a super admin can export full passport numbers');
    }

    const where = input.ids ? { id: { in: input.ids } } : applicationWhere(input.filters ?? {});
    const total = await this.prisma.application.count({ where });
    if (total > EXPORT_MAX_ROWS) {
      throw new AppException(
        'VALIDATION_ERROR',
        HttpStatus.BAD_REQUEST,
        `An export is limited to ${EXPORT_MAX_ROWS} applications; narrow the filters`,
        { matching: total },
      );
    }
    const applications = await this.prisma.application.findMany({
      where,
      orderBy: [{ appliedAt: 'desc' }, { id: 'asc' }],
      include: {
        job: { select: { title: true, destination: { select: { code: true } } } },
        candidate: { include: { user: { select: { email: true } }, languages: true } },
      },
    });

    const rows = applications.map((application) => {
      const { candidate } = application;
      const values: Record<ExportColumn, Cell> = {
        applicationId: application.id,
        status: application.status,
        appliedAt: application.appliedAt.toISOString(),
        jobTitle: application.job.title,
        destination: application.job.destination.code,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.user.email,
        phone: candidate.phone,
        nationality: candidate.nationality,
        countryOfResidence: candidate.countryOfResidence,
        dateOfBirth: date(candidate.dateOfBirth),
        passportNumberMasked: candidate.passportNumberMasked,
        passportExpiryDate: date(candidate.passportExpiryDate),
        currentProfession: candidate.currentProfession,
        yearsOfExperience: candidate.yearsOfExperience,
        languages: candidate.languages.map((l) => `${l.language}:${l.level}`).join(' '),
        answers: answersCell(application.questions, application.answers),
        // Decrypted only when the column was requested and allowed above.
        passportNumber:
          withPassport && candidate.passportNumberEncrypted
            ? revealPassportNumber(this.cipher, candidate.passportNumberEncrypted)
            : null,
      };
      return input.columns.map((column) => values[column]);
    });
    const headers = input.columns.map((column) => EXPORT_HEADERS[column]);

    await this.audit.record({
      actorId: user.id,
      action: withPassport ? 'application.export_with_passport_numbers' : 'application.export',
      entityType: 'application',
      entityId: null,
      after: {
        format: input.format,
        rows: rows.length,
        columns: input.columns,
        includeFullPassportNumber: withPassport,
        selection: input.ids ? 'ids' : 'filters',
        filters: input.ids ? null : (input.filters ?? {}),
      },
      ip,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    if (input.format === 'csv') {
      return {
        content: Buffer.from(toCsv(headers, rows), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        fileName: `applications-${stamp}.csv`,
        rows: rows.length,
      };
    }
    // Loaded with the first export, not when the API starts.
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Applications');
    sheet.addRow(headers).font = { bold: true };
    for (const row of rows) {
      sheet.addRow(row.map(neutraliseFormula));
    }
    sheet.columns.forEach((column) => {
      column.width = 22;
    });
    return {
      content: Buffer.from(await workbook.xlsx.writeBuffer()),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `applications-${stamp}.xlsx`,
      rows: rows.length,
    };
  }
}
