import { METHOD_METADATA } from '@nestjs/common/constants.js';
import type { INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  IS_PUBLIC_KEY,
  OPTIONAL_AUTH_KEY,
  REQUIRE_VERIFIED_EMAIL_KEY,
  ROLES_KEY,
} from '../../auth/decorators/index.js';

/** Who may call an operation, as read from the guards' metadata. */
export interface OperationAccess {
  /** "public": no session; "session": any signed-in user; "roles": only `roles`. */
  access: 'public' | 'session' | 'roles';
  roles: readonly string[];
  verifiedEmail: boolean;
}

/**
 * Adds `x-access`, `x-roles` and `x-verified-email` to every operation of the OpenAPI
 * document, from the same metadata the guards read (@Public, @OptionalAuth, @Roles on the
 * method or the controller, @RequireVerifiedEmail). Swagger UI shows them, and
 * docs/API.md is generated from them (`pnpm api:types`), so the access rules in the
 * documentation cannot drift from the code.
 */
export function addAccessExtensions(app: INestApplication, document: OpenAPIObject): OpenAPIObject {
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const byOperationId = new Map<string, OperationAccess>();

  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    const controller = wrapper.metatype as (new () => unknown) | undefined;
    if (!controller || !wrapper.instance) {
      continue;
    }
    const prototype = Object.getPrototypeOf(wrapper.instance) as Record<string, () => unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name];
      if (!handler || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
        continue;
      }
      const targets = [handler, controller];
      const open =
        reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets) === true ||
        reflector.getAllAndOverride<boolean | undefined>(OPTIONAL_AUTH_KEY, targets) === true;
      const roles = reflector.getAllAndOverride<readonly string[] | undefined>(ROLES_KEY, targets);
      byOperationId.set(`${controller.name}_${name}`, {
        access: open ? 'public' : roles ? 'roles' : 'session',
        roles: open ? [] : (roles ?? []),
        verifiedEmail:
          reflector.getAllAndOverride<boolean | undefined>(REQUIRE_VERIFIED_EMAIL_KEY, targets) ===
          true,
      });
    }
  }

  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item as Record<string, unknown>)) {
      if (typeof operation !== 'object' || operation === null || !('operationId' in operation)) {
        continue;
      }
      const found = byOperationId.get(String(operation.operationId));
      if (found) {
        Object.assign(operation, {
          'x-access': found.access,
          'x-roles': found.roles,
          'x-verified-email': found.verifiedEmail,
        });
      }
    }
  }
  return document;
}
