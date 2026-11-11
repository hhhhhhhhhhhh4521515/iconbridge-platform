// Prints the address the migration job gives the Prisma CLI and the seed.
//
// DATABASE_AUTH=entra: DATABASE_URL names the managed identity and carries no password; the
// CLI only takes an address, so a Microsoft Entra token of the identity is put in it as the
// password (valid long enough for a migration), and the session runs as iconbridge_owner. Container Apps provides IDENTITY_ENDPOINT
// and IDENTITY_HEADER; AZURE_CLIENT_ID selects the user-assigned identity.
// Otherwise: DATABASE_URL unchanged.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (process.env.DATABASE_AUTH !== 'entra') {
  process.stdout.write(url);
  process.exit(0);
}
const endpoint = process.env.IDENTITY_ENDPOINT;
const header = process.env.IDENTITY_HEADER;
if (!endpoint || !header) {
  console.error(
    'DATABASE_AUTH=entra needs IDENTITY_ENDPOINT and IDENTITY_HEADER (managed identity)',
  );
  process.exit(1);
}
const request = new URL(endpoint);
request.searchParams.set('api-version', '2019-08-01');
request.searchParams.set('resource', 'https://ossrdbms-aad.database.windows.net');
if (process.env.AZURE_CLIENT_ID) {
  request.searchParams.set('client_id', process.env.AZURE_CLIENT_ID);
}
const response = await fetch(request, { headers: { 'X-IDENTITY-HEADER': header } });
if (!response.ok) {
  console.error(`No database token from the managed identity (HTTP ${response.status})`);
  process.exit(1);
}
const { access_token: token } = await response.json();
const address = new URL(url);
address.password = token;
// Objects created by the migrations belong to iconbridge_owner, like the earlier ones, not to
// the identity itself (migration 20261111150000_database_owner_role, ADR-026).
address.searchParams.set('options', '-c role=iconbridge_owner');
process.stdout.write(address.toString());
