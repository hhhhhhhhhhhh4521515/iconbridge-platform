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
   - give the four apps `DATABASE_AUTH=entra` and a passwordless address in Key Vault, only after the identity can use the tables (below).
3. **Table ownership before the switch.** Every table, sequence and type was created by the migrations under the password administrator, which owns them. Being the Entra administrator gives the identity no right on objects another role owns, and only an owner can run the migrations' `ALTER TABLE`. The readiness probe (`SELECT 1`) needs no table right, so a revision signed in as the identity would pass it and then fail every query. Found while reviewing the first apply (8 November), which the owner rejected.
   - PostgreSQL 16 lets a role give objects only to a role it can `SET ROLE` to, and the password login has no right over the identity's role (Azure created it). So a migration, run by the password login, creates `iconbridge_owner` (no login), gives it every object of `public` and `CREATE` on the schema, and grants it, with inherited rights, to the identity and to `azure_pg_admin`.
   - Through `azure_pg_admin`, every server administrator keeps the objects once the password login is gone, so a person added as Entra administrator for a restore, or a replacement identity, is not locked out. Server administrators already manage the server; no other role gains anything.
   - The migration job runs as `iconbridge_owner` (`options=-c role=iconbridge_owner` in its address), so later objects belong to it, not to the identity.
   - The migration runs before `database_auth = "entra"` is set. Tested on PostgreSQL 16 in two set-ups (the database owned by the password login, or by `azure_pg_admin`), then on a point-in-time copy of production, before it is deployed.
4. **Then password authentication off**, in a last Terraform change, once production has run on tokens. Nothing else signs in with the password: local development uses its own database, and a person who needs the production database signs in with their own Entra account added as administrator for the occasion.
5. **What stays public for now**: public network access, and the rule "allow public access from any Azure service" (`0.0.0.0`). The apps run in a Consumption environment without a VNet, whose outgoing addresses are shared and change, so no narrower rule can name them. Without a password login, reaching the port is not enough: a connection needs a token issued by our tenant to our identity. Private access (VNet integration and a private endpoint) is part 2.

## Consequences

- No database password is used by the apps or stored in Key Vault once password authentication is off (decision 4).
- The identity is the server's Entra administrator, as the password user was its administrator; a role with fewer rights for the API is a possible later step.
- Local development, CI and `docker-compose.prod.yml` keep `DATABASE_AUTH=password`.
- Rollback before passwords are turned off: set `DATABASE_AUTH=password` and the old address back (Terraform). After: turn password authentication on again first.
