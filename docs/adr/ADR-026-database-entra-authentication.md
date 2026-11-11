# ADR-026: The apps sign in to PostgreSQL with their managed identity

Date: 2026-11-07. Status: accepted. Tokens in production since 11 November 2026; password sign-in turned off by the next Terraform change (decision 4).

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
3. **Table ownership: no change needed (tested on a copy of production, 11 November).** Every table, sequence and enum belongs to the password login `iconbridge_admin`.
   - On standard PostgreSQL 16, another role could neither use these objects nor alter them. The first apply of the switch (8 November) was rejected over that, and the readiness probe (`SELECT 1`) would not have caught it.
   - Azure differs. Its `azure_pg_admin`, of which every server administrator is a member (the password login, the identity, a person added as Entra administrator), is granted `pg_read_all_data` and `pg_write_all_data`, and its members have the rights of the other non-superuser roles.
   - On a point-in-time copy of the production server, an Entra user that is a member of `azure_pg_admin` only, as the identity is, did all of these:
     - read and write;
     - alter a table owned by `iconbridge_admin`, add a value to one of its enums, create an index and a table with a foreign key to it;
     - run `prisma migrate deploy` and the production seed;
     - take a `pg_dump`.
   - `iconbridge_admin` could alter the table that user created. The copy was deleted after the test.
   - A migration giving the objects to a role without login was written and tested locally, then dropped. It was not needed, and Azure refuses grants to `azure_pg_admin` ("permission denied to alter restricted role"), so it would have failed.
   - Objects of later migrations belong to the identity. Any server administrator can still manage them.
4. **Then password authentication off**, in a last Terraform change, once production has run on tokens. Nothing else signs in with the password: local development uses its own database, and a person who needs the production database signs in with their own Entra account added as administrator for the occasion.
   - Production ran on tokens on 11 November 2026: the API, one execution of each job (tasks, backup, migration with the seed), with no password in the Key Vault address.
   - Then `database_password_auth = false`. A variable validation refuses it with `database_auth = "password"`, so Terraform cannot turn the password off under apps that still need it.
   - The `iconbridge_admin` login and its random password stay. Without password sign-in they cannot be used, and the server needs an administrator login. Turning password sign-in back on is the rollback.
5. **What stays public for now**: public network access, and the rule "allow public access from any Azure service" (`0.0.0.0`). The apps run in a Consumption environment without a VNet, whose outgoing addresses are shared and change, so no narrower rule can name them. Without a password login, reaching the port is not enough: a connection needs a token issued by our tenant to our identity. Private access (VNet integration and a private endpoint) is part 2.

## Consequences

- No database password is used by the apps or stored in Key Vault once password authentication is off (decision 4).
- The identity is the server's Entra administrator, as the password user was its administrator; a role with fewer rights for the API is a possible later step.
- Local development, CI and `docker-compose.prod.yml` keep `DATABASE_AUTH=password`.
- Rollback before passwords are turned off: set `DATABASE_AUTH=password` and the old address back (Terraform). After: turn password authentication on again first.
