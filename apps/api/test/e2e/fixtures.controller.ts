import { Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { PERMISSIONS } from '@iconbridge/shared';
import { Audit } from '../../src/admin/audit/audit.decorator.js';
import { Owned, RequireVerifiedEmail, Roles } from '../../src/auth/decorators/index.js';
import { OwnershipGuard } from '../../src/auth/guards/ownership.guard.js';

const OK = { ok: true };

/**
 * Routes that exist only in the e2e tests. They stand for features that are not
 * built yet (candidates, jobs, applications) so the guards can be exercised over
 * HTTP with the same decorators the real controllers will use.
 */
@Controller('admin/fixtures')
export class AdminFixturesController {
  @Get('candidates')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  readCandidates() {
    return OK;
  }

  // Deliberately lists the viewer's permission on writes: the read-only rule must still refuse them.
  @Post('candidates')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  post() {
    return OK;
  }

  @Put('candidates/:id')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  put() {
    return OK;
  }

  @Patch('candidates/:id')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  patch() {
    return OK;
  }

  @Delete('candidates/:id')
  @Roles(...PERMISSIONS.VIEW_CANDIDATES)
  remove() {
    return OK;
  }

  @Post('jobs')
  @Roles(...PERMISSIONS.MANAGE_JOBS)
  createJob() {
    return { id: 'not-a-uuid', ...OK };
  }

  @Post('users/:id/touch')
  @Roles(...PERMISSIONS.MANAGE_JOBS)
  @Audit({ action: 'fixture.touch_user', entityType: 'user', idParam: 'id' })
  touchUser() {
    return OK;
  }

  @Get('settings')
  @Roles(...PERMISSIONS.MANAGE_SETTINGS)
  readSettings() {
    return OK;
  }

  /** A back-office route whose author forgot @Roles(). */
  @Get('forgotten')
  forgotten() {
    return OK;
  }
}

@Controller('fixtures')
export class CandidateFixturesController {
  @Get('any-user')
  anyUser() {
    return OK;
  }

  @Post('apply')
  @Roles(...PERMISSIONS.APPLY_TO_JOBS)
  @RequireVerifiedEmail()
  apply() {
    return OK;
  }

  @Get('profiles/:id')
  @UseGuards(OwnershipGuard)
  @Owned('candidateProfile')
  profile(@Param('id') id: string) {
    return { id };
  }

  @Patch('profiles/:id')
  @UseGuards(OwnershipGuard)
  @Owned('candidateProfile')
  updateProfile(@Param('id') id: string) {
    return { id };
  }

  @Get('documents/:documentId')
  @UseGuards(OwnershipGuard)
  @Owned('document', 'documentId')
  document(@Param('documentId') id: string) {
    return { id };
  }

  @Get('applications/:id')
  @UseGuards(OwnershipGuard)
  @Owned('application')
  application(@Param('id') id: string) {
    return { id };
  }
}
