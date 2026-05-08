
DO $$
DECLARE
  new_user_id uuid;
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM auth.users WHERE email = 'admin@tropik.ua';

  IF existing_id IS NULL THEN
    new_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
      'admin@tropik.ua',
      crypt('Tropik2026!', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Super Admin TROPIK"}'::jsonb,
      now(), now(), '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), new_user_id,
      jsonb_build_object('sub', new_user_id::text, 'email', 'admin@tropik.ua', 'email_verified', true),
      'email', new_user_id::text, now(), now(), now()
    );
  ELSE
    new_user_id := existing_id;
    UPDATE auth.users
       SET encrypted_password = crypt('Tropik2026!', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = new_user_id;
  END IF;

  -- Ensure profile exists
  INSERT INTO public.profiles (id, full_name)
  VALUES (new_user_id, 'Super Admin TROPIK')
  ON CONFLICT (id) DO NOTHING;

  -- Grant super_admin role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new_user_id, 'super_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;
