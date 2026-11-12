import { chooseCredential } from './azure-credential.js';

describe('chooseCredential', () => {
  it('uses the managed identity directly in Azure (Container Apps sets IDENTITY_ENDPOINT)', () => {
    expect(
      chooseCredential({
        IDENTITY_ENDPOINT: 'http://localhost:42356/msi/token',
        AZURE_CLIENT_ID: '00000000-0000-0000-0000-000000000001',
      }),
    ).toEqual({ kind: 'managed-identity', clientId: '00000000-0000-0000-0000-000000000001' });
  });

  it('uses DefaultAzureCredential elsewhere (az login on a developer machine)', () => {
    expect(chooseCredential({})).toEqual({ kind: 'default' });
    expect(chooseCredential({ AZURE_CLIENT_ID: 'x', IDENTITY_ENDPOINT: '' })).toEqual({
      kind: 'default',
    });
  });

  it('names the missing variable rather than picking another identity', () => {
    expect(() => chooseCredential({ IDENTITY_ENDPOINT: 'http://localhost/msi/token' })).toThrow(
      'AZURE_CLIENT_ID',
    );
  });
});
