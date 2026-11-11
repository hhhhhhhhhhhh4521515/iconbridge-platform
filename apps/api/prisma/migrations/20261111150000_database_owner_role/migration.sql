-- ADR-026: the objects of the application belong to a role without login, iconbridge_owner,
-- instead of the login that ran the migrations. The managed identity of the apps becomes a
-- member, so it can use and migrate every table once the apps sign in with Entra tokens.
-- PostgreSQL 16: a role created by a non-superuser is granted to its creator with ADMIN only;
-- SET is needed to give objects to it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'iconbridge_owner') THEN
    CREATE ROLE iconbridge_owner NOLOGIN;
  END IF;
END
$$;

GRANT iconbridge_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;

-- A new owner needs CREATE on the schema; later migrations create their tables there too.
GRANT USAGE, CREATE ON SCHEMA public TO iconbridge_owner;

-- Tables (with their indexes and owned sequences), standalone sequences, views.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.oid::regclass AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND pg_get_userbyid(c.relowner) = CURRENT_USER
      AND NOT EXISTS (
        SELECT FROM pg_depend d
        WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
          AND d.deptype IN ('a', 'i', 'e')
      )
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO iconbridge_owner', item.name);
  END LOOP;

  -- Enums, domains and standalone composite types (not array or table row types).
  FOR item IN
    SELECT t.oid::regtype AS name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e', 'd')
      AND pg_get_userbyid(t.typowner) = CURRENT_USER
      AND NOT EXISTS (
        SELECT FROM pg_depend d
        WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO iconbridge_owner', item.name);
  END LOOP;

  -- Functions that are not part of an extension (pg_trgm stays with its owner).
  FOR item IN
    SELECT p.oid::regprocedure AS name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = CURRENT_USER
      AND NOT EXISTS (
        SELECT FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO iconbridge_owner', item.name);
  END LOOP;
END
$$;

-- Azure: every server administrator (the password login, the managed identity, a person
-- added as Entra administrator for a restore) is a member of azure_pg_admin, so ownership
-- stays with whoever administers the server once the password login is gone. The identity of
-- the apps (infra/terraform, module identity) is also granted directly. Other databases have
-- neither role.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'azure_pg_admin') THEN
    GRANT iconbridge_owner TO azure_pg_admin WITH INHERIT TRUE, SET TRUE;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'id-iconbridge-prod-itn') THEN
    GRANT iconbridge_owner TO "id-iconbridge-prod-itn" WITH INHERIT TRUE, SET TRUE;
  END IF;
END
$$;
