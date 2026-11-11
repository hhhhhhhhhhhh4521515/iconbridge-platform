-- ADR-027: role of the partner companies' logins. In its own migration: PostgreSQL does not
-- let a new enum value be used in the transaction that adds it, and the next migration uses
-- it in the users_locale_check constraint.
ALTER TYPE "user_role" ADD VALUE 'PARTNER';
