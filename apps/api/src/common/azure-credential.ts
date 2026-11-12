import type { TokenCredential } from '@azure/identity';
import { z } from 'zod';
import { lazy } from './lazy.js';

/**
 * What decides the credential. Container Apps sets IDENTITY_ENDPOINT (and IDENTITY_HEADER)
 * in every container that has a managed identity; AZURE_CLIENT_ID picks the user-assigned
 * identity of the apps (Terraform, envs/prod).
 */
const credentialEnvSchema = z.object({
  IDENTITY_ENDPOINT: z.string().default(''),
  AZURE_CLIENT_ID: z.string().default(''),
});

export type CredentialChoice = { kind: 'managed-identity'; clientId: string } | { kind: 'default' };

/**
 * In Azure: the managed identity, directly. DefaultAzureCredential would first try the
 * environment, workload identity and other credentials; each refusal is recorded as an
 * exception in Application Insights and delays the first token of a new revision.
 * Elsewhere (a developer's machine signed in with `az login`): DefaultAzureCredential.
 */
export function chooseCredential(env: NodeJS.ProcessEnv = process.env): CredentialChoice {
  const parsed = credentialEnvSchema.parse(env);
  if (parsed.IDENTITY_ENDPOINT === '') {
    return { kind: 'default' };
  }
  if (parsed.AZURE_CLIENT_ID === '') {
    throw new Error('AZURE_CLIENT_ID is required with a managed identity (IDENTITY_ENDPOINT set)');
  }
  return { kind: 'managed-identity', clientId: parsed.AZURE_CLIENT_ID };
}

/**
 * One credential for the database, storage and email clients, so they share its token
 * cache. The SDK is loaded on first use (ADR-017).
 */
export const azureCredential: () => Promise<TokenCredential> = lazy(async () => {
  const choice = chooseCredential();
  const identity = await import('@azure/identity');
  return choice.kind === 'managed-identity'
    ? new identity.ManagedIdentityCredential({ clientId: choice.clientId })
    : new identity.DefaultAzureCredential();
});
