# ADR-026: The apps sign in to PostgreSQL with their managed identity

Date: 2026-11-07. Status: accepted (code); the Terraform change waits for the owner's approval.

## Context

The November 2026 audit (finding H1) found the PostgreSQL Flexible Server reachable from the internet with a password login: public network access on, an "allow Azure services" rule, and a firewall rule for an administrator's address that was no longer needed. The API, the migration job, the tasks job and the backup job all read one connection string with the administrator's password from Key Vault.

The owner asked for part 1 now: remove the stale address rule, sign in with Microsoft Entra ID instead of a password, and turn password authentication off if nothing else needs it. The Container Apps environment is not recreated and no private networking is added yet (part 2, with the VNet integration of M8).

## Decision

1. **`DATABASE_AUTH`** (`password` by default, `entra`). With `entra`, `DATABASE_URL` names the user-assigned managed identity as the user and carries no password (refused at start otherwise).
   - API and tasks job (`PrismaService`): the `pg` pool behind Prisma gets the fields of the address one by one and a password function that returns a token of the identity (`DefaultAzureCredential`, scope `https://ossrdbms-aad.database.windows.net/.default`). `pg` calls it for each new connection, and the credential caches and renews the token. A connection string cannot be used there: `pg` would replace the function with the string's empty password.
   - Migration job: `scripts/database-url.mjs` asks the Container Apps identity endpoint for a token and puts it in the address it gives the Prisma CLI and the seed. The CLI only takes an address, and a token lasts long enough for a migration.
   - Backup job: `backup.sh` gets the token the same way it already gets the Blob Storage one and gives it to `pg_dump` as `PGPASSWORD`.
2. **Terraform** (separate pull request, approved by the owner):
   - turn on Entra authentication on the server, keeping passwords for now;
   - make the managed identity the Entra administrator;
   - remove the administrator address rule (`admin_ip_addresses = []`);
   - give the four apps `DATABASE_AUTH=entra` and a passwordless address in Key Vault.
3. **Then password authentication off**, in a last Terraform change, once production has run on tokens. Nothing else signs in with the password: local development uses its own database, and a person who needs the production database signs in with their own Entra account added as administrator for the occasion.
4. **What stays public for now**: public network access, and the rule "allow public access from any Azure service" (`0.0.0.0`). The apps run in a Consumption environment without a VNet, whose outgoing addresses are shared and change, so no narrower rule can name them. Without a password login, reaching the port is not enough: a connection needs a token issued by our tenant to our identity. Private access (VNet integration and a private endpoint) is part 2.

## Consequences

- No database password is used by the apps or stored in Key Vault once password authentication is off (decision 3).
- The identity is the server's Entra administrator, as the password user was its administrator; a role with fewer rights for the API is a possible later step.
- Local development, CI and `docker-compose.prod.yml` keep `DATABASE_AUTH=password`.
- Rollback before passwords are turned off: set `DATABASE_AUTH=password` and the old address back (Terraform). After: turn password authentication on again first.
