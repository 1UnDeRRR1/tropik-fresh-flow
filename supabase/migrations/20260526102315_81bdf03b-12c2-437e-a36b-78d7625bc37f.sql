DO $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = '44eddfe6-bd13-43ae-acaf-3afb5941179c';
  UPDATE auth.users
     SET encrypted_password = crypt('Malekhiv2026!', gen_salt('bf')),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at = now()
   WHERE id = '44eddfe6-bd13-43ae-acaf-3afb5941179c';
  RAISE NOTICE 'Malekhiv email: %', v_email;
END $$;