-- Hand-written, data only. The seed used to insert the placeholder address
-- contact@iconbridge.local as CONTACT_EMAIL, and the site showed it in its header.
-- The default is now empty (nothing shown until the super admin sets an address).
-- An address someone set is left as it is.
UPDATE "settings"
SET "value" = '""'::jsonb
WHERE "key" = 'CONTACT_EMAIL'
  AND "value" = '"contact@iconbridge.local"'::jsonb;
