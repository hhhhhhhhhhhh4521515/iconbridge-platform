import { Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  acknowledgementSchema,
  currentUserSchema,
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type Acknowledgement,
  type CurrentUser as CurrentUserDto,
  type EmailOnlyInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
} from '@iconbridge/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodBody } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { RATE_LIMITS, REFRESH_COOKIE } from './auth.constants.js';
import { clearAuthCookies, setAuthCookies } from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import { requestMeta, type AuthUser, type RequestWithUser } from './auth.types.js';
import { CurrentUser, OptionalAuth, Public } from './decorators/index.js';

const SENSITIVE = { default: RATE_LIMITS.authSensitive };
const sessionSchema = z.object({ user: currentUserSchema.nullable() });

function refreshCookie(request: Request): string | undefined {
  const value = (request.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' && value ? value : undefined;
}

@ApiTags('auth')
@Throttle({ default: RATE_LIMITS.auth })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(SENSITIVE)
  @Post('register')
  @ApiOperation({
    summary: 'Create a candidate account',
    description:
      'Sends a verification email. The answer is the same whether or not the address already has an account.',
  })
  @ApiZodBody(registerSchema)
  @ApiZodResponse(201, acknowledgementSchema)
  @ApiErrors(400, 429)
  register(
    @ZodBody(registerSchema) body: RegisterInput,
    @Req() request: Request,
  ): Promise<Acknowledgement> {
    return this.auth.register(body, requestMeta(request));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm an email address with the token of the verification link' })
  @ApiZodBody(verifyEmailSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 429)
  async verifyEmail(@ZodBody(verifyEmailSchema) body: VerifyEmailInput): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  @Public()
  @Throttle(SENSITIVE)
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send the verification email again' })
  @ApiZodBody(emailOnlySchema)
  @ApiZodResponse(202, acknowledgementSchema)
  @ApiErrors(400, 429)
  resendVerification(@ZodBody(emailOnlySchema) body: EmailOnlyInput): Promise<Acknowledgement> {
    return this.auth.resendVerification(body);
  }

  @Public()
  @Throttle(SENSITIVE)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Sets two httpOnly cookies: a 15-minute access token and a 7-day rotating refresh token. ' +
      'After 5 wrong passwords the account is locked for 15 minutes.',
  })
  @ApiZodBody(loginSchema)
  @ApiZodResponse(200, currentUserSchema)
  @ApiErrors(400, 401, 429)
  async login(
    @ZodBody(loginSchema) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CurrentUserDto> {
    const session = await this.auth.login(body, requestMeta(request));
    setAuthCookies(response, session.accessToken, session.refreshToken);
    return session.user;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a new access token',
    description:
      'Uses the refresh cookie and replaces it. A refresh token that is presented twice revokes the whole session.',
  })
  @ApiZodResponse(200, currentUserSchema)
  @ApiErrors(401, 429)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CurrentUserDto> {
    try {
      const session = await this.auth.refresh(refreshCookie(request), requestMeta(request));
      setAuthCookies(response, session.accessToken, session.refreshToken);
      return session.user;
    } catch (error) {
      clearAuthCookies(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out: revokes the session and clears the cookies' })
  @ApiResponse({ status: 204 })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(refreshCookie(request));
    clearAuthCookies(response);
  }

  @Public()
  @Throttle(SENSITIVE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a password-reset link (valid 1 hour, usable once)' })
  @ApiZodBody(emailOnlySchema)
  @ApiZodResponse(202, acknowledgementSchema)
  @ApiErrors(400, 429)
  forgotPassword(@ZodBody(emailOnlySchema) body: EmailOnlyInput): Promise<Acknowledgement> {
    return this.auth.forgotPassword(body);
  }

  @Public()
  @Throttle(SENSITIVE)
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Set a new password',
    description:
      'Accepts the token of a reset link or of an admin invitation. Signs the user out everywhere.',
  })
  @ApiZodBody(resetPasswordSchema)
  @ApiResponse({ status: 204 })
  @ApiErrors(400, 429)
  async resetPassword(@ZodBody(resetPasswordSchema) body: ResetPasswordInput): Promise<void> {
    await this.auth.resetPassword(body);
  }

  // Read on every page that shows "Apply" or the account menu: it only reads, so it gets the
  // general limit, not the strict one of the endpoints that take a password or a token.
  @OptionalAuth()
  @Throttle({ default: RATE_LIMITS.default })
  @Get('session')
  @ApiOperation({
    summary: 'Who is signed in, if anyone',
    description:
      'Always answers 200: `{ user }` for a valid session, `{ user: null }` for a visitor. ' +
      'Pages open to everybody use it instead of `GET /auth/me`, which answers 401 to visitors.',
  })
  @ApiZodResponse(200, sessionSchema)
  async session(@Req() request: RequestWithUser): Promise<{ user: CurrentUserDto | null }> {
    return { user: request.user ? await this.auth.currentUser(request.user.id) : null };
  }

  @Throttle({ default: RATE_LIMITS.default })
  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiZodResponse(200, currentUserSchema)
  @ApiErrors(401)
  me(@CurrentUser() user: AuthUser): Promise<CurrentUserDto> {
    return this.auth.currentUser(user.id);
  }
}
