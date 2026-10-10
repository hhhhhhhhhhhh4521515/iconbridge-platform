import { Controller, Get, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  candidateProfileResponseSchema,
  candidateProfileSchema,
  makeCandidateProfileSchema,
  PERMISSIONS,
  type CandidateProfileInput,
  type CandidateProfileResponse,
} from '@iconbridge/shared';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators/index.js';
import { Clock } from '../common/clock/clock.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ApiErrors, ApiZodBody, ApiZodResponse } from '../common/swagger/zod-openapi.js';
import { ProfileService } from './profile.service.js';
import { Body } from '@nestjs/common';

@ApiTags('candidate: profile')
@ApiCookieAuth()
@Roles(...PERMISSIONS.MANAGE_OWN_PROFILE)
@Controller('me/profile')
export class ProfileController {
  private readonly pipe: ZodValidationPipe<ReturnType<typeof makeCandidateProfileSchema>>;

  constructor(
    private readonly profiles: ProfileService,
    clock: Clock,
  ) {
    // Age and passport rules depend on today's date: the schema reads it from the clock.
    this.pipe = new ZodValidationPipe(makeCandidateProfileSchema(() => clock.now()));
  }

  @Get()
  @ApiOperation({
    summary: 'My profile',
    description:
      'Includes the clear passport number (owner only), the completeness percentage and the missing items.',
  })
  @ApiZodResponse(200, candidateProfileResponseSchema)
  @ApiErrors(401, 403)
  get(@CurrentUser() user: AuthUser): Promise<CandidateProfileResponse> {
    return this.profiles.getOwn(user.id);
  }

  @Put()
  @ApiOperation({
    summary: 'Replace my profile',
    description:
      'Send every field; null means "not provided". Rules: 18 or older, ISO 3166 country codes, ' +
      'E.164 phone numbers, passport not expired. The passport number is stored encrypted.',
  })
  @ApiZodBody(candidateProfileSchema)
  @ApiZodResponse(200, candidateProfileResponseSchema)
  @ApiErrors(400, 401, 403)
  update(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<CandidateProfileResponse> {
    const input: CandidateProfileInput = this.pipe.transform(body);
    return this.profiles.updateOwn(user.id, input);
  }
}
