import { Controller, Delete, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { deleteAccountSchema, PERMISSIONS, type DeleteAccountInput } from '@iconbridge/shared';
import type { Response } from 'express';
import { RATE_LIMITS } from '../auth/auth.constants.js';
import { clearAuthCookies } from '../auth/auth.cookies.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { ZodBody } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody } from '../common/swagger/zod-openapi.js';
import { AccountService } from './account.service.js';

@ApiTags('candidate: my data (GDPR)')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_OWN_DATA)
@Throttle({ default: RATE_LIMITS.authSensitive })
@Controller('me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

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
