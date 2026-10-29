import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  accountSettingsSchema,
  changePasswordSchema,
  deleteAccountSchema,
  myJobAlertResponseSchema,
  myJobAlertSchema,
  PERMISSIONS,
  USER_ROLES,
  uuidParamSchema,
  type AccountSettingsInput,
  type ChangePasswordInput,
  type DeleteAccountInput,
  type MyJobAlert,
  type MyJobAlertInput,
} from '@iconbridge/shared';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { RATE_LIMITS } from '../auth/auth.constants.js';
import { clearAuthCookies, setAuthCookies } from '../auth/auth.cookies.js';
import { requestMeta, type AuthUser } from '../auth/auth.types.js';
import {
  AllowPasswordChange,
  CurrentUser,
  RequireVerifiedEmail,
  Roles,
  SelfService,
} from '../auth/decorators/index.js';
import { SessionService } from '../auth/session.service.js';
import { TokenService } from '../auth/token.service.js';
import { ZodBody, ZodParams } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { AccountService } from './account.service.js';

@ApiTags('candidate: my data (GDPR)')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_OWN_DATA)
@Throttle({ default: RATE_LIMITS.authSensitive })
@Controller('me')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
  ) {}

  @Patch('settings')
  @Throttle({ default: RATE_LIMITS.default })
  @Roles(...USER_ROLES)
  @SelfService()
  @ApiOperation({ summary: 'Change my language (used for the emails)' })
  @ApiZodBody(accountSettingsSchema)
  @ApiZodResponse(200, accountSettingsSchema)
  @ApiErrors(400, 401)
  updateSettings(
    @CurrentUser() user: AuthUser,
    @ZodBody(accountSettingsSchema) body: AccountSettingsInput,
  ): Promise<AccountSettingsInput> {
    return this.account.updateSettings(user.id, body);
  }

  @Post('password')
  @Roles(...USER_ROLES)
  @SelfService()
  @AllowPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change my password',
    description:
      'Needs the current password. Every other session is signed out; this one receives new cookies.',
  })
  @ApiZodBody(changePasswordSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 401, 403, 429)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @ZodBody(changePasswordSchema) body: ChangePasswordInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { tokenVersion } = await this.account.changePassword(user.id, body);
    setAuthCookies(
      response,
      await this.tokens.signAccessToken(user.id, tokenVersion),
      await this.sessions.start(user.id, requestMeta(request)),
    );
  }

  @Get('job-alerts')
  @Throttle({ default: RATE_LIMITS.default })
  @ApiOperation({ summary: 'My job alerts' })
  @ApiZodResponse(200, z.array(myJobAlertResponseSchema))
  @ApiErrors(401, 403)
  jobAlerts(@CurrentUser() user: AuthUser): Promise<MyJobAlert[]> {
    return this.account.listJobAlerts(user.email);
  }

  @Post('job-alerts')
  @Throttle({ default: RATE_LIMITS.default })
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Create a job alert for my address',
    description: 'Active at once, without a confirmation email: the address is already verified.',
  })
  @ApiZodBody(myJobAlertSchema)
  @ApiZodResponse(201, z.array(myJobAlertResponseSchema))
  @ApiErrors(400, 401, 403, 409)
  createJobAlert(
    @CurrentUser() user: AuthUser,
    @ZodBody(myJobAlertSchema) body: MyJobAlertInput,
  ): Promise<MyJobAlert[]> {
    return this.account.createJobAlert(user, body);
  }

  @Delete('job-alerts/:id')
  @Throttle({ default: RATE_LIMITS.default })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my job alerts' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiErrors(401, 403, 404)
  async removeJobAlert(
    @CurrentUser() user: AuthUser,
    @ZodParams(uuidParamSchema) params: { id: string },
  ): Promise<void> {
    await this.account.removeJobAlert(user.email, params.id);
  }

  @Get('export')
  @ApiOperation({
    summary: 'Download a copy of my data',
    description: 'A zip with `data.json` and every uploaded document.',
  })
  @ApiProduces('application/zip')
  @ApiResponse({ status: 200, description: 'Zip archive' })
  @ApiErrors(401, 403, 429)
  async export(@CurrentUser() user: AuthUser, @Res() response: Response): Promise<void> {
    const archive = await this.account.export(user.id);
    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', 'attachment; filename="iconbridge-my-data.zip"');
    response.setHeader('Cache-Control', 'no-store');
    archive.on('error', () => {
      response.destroy();
    });
    archive.pipe(response);
  }

  @Delete('account')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my account',
    description:
      'Irreversible; the password confirms it. Documents are deleted, the profile and the applications are ' +
      'anonymised (applications in progress are withdrawn), and the email address becomes free again.',
  })
  @ApiZodBody(deleteAccountSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 401, 403, 429)
  async remove(
    @CurrentUser() user: AuthUser,
    @ZodBody(deleteAccountSchema) body: DeleteAccountInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.account.deleteAccount(user.id, body.password);
    clearAuthCookies(response);
  }
}
