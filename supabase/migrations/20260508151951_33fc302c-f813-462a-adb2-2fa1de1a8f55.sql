
DO $$
DECLARE
  v_users jsonb := jsonb_build_array(
    jsonb_build_object('email','manager@tropik.ua','name','Імпорт-менеджер (тест)','role','import_manager','branch',NULL),
    jsonb_build_object('email','kyiv@tropik.ua','name','Філія Київ (тест)','role','branch','branch','0748d5e3-eb24-449e-8e88-746570553eef'),
    jsonb_build_object('email','odessa@tropik.ua','name','Філія Одеса (тест)','role','branch','branch','61b64391-83da-45ec-b704-90977a0149b7'),
    jsonb_build_object('email','lviv@tropik.ua','name','Філія Львів (тест)','role','branch','branch','3b2b3c88-9e2c-4934-af70-b9cb86a3faa1')
  );
  v_user jsonb;
  v_uid uuid;
  v_pwd text := 'Tropik2026!';
BEGIN
  FOR v_user IN SELECT * FROM jsonb_array_elements(v_users) LOOP
    SELECT id INTO v_uid FROM auth.users WHERE email = v_user->>'email';
    IF v_uid IS NULL THEN
      v_uid := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        v_user->>'email', crypt(v_pwd, gen_salt('bf')),
        now(), now(), now(),
        jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
        jsonb_build_object('full_name', v_user->>'name'),
        false, '', '', '', ''
      );
      INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', v_user->>'email', 'email_verified', true),
        'email', v_uid::text, now(), now(), now());
    ELSE
      UPDATE auth.users SET encrypted_password = crypt(v_pwd, gen_salt('bf')), email_confirmed_at = COALESCE(email_confirmed_at, now()) WHERE id = v_uid;
    END IF;

    INSERT INTO public.profiles (id, full_name, branch_id)
    VALUES (v_uid, v_user->>'name', NULLIF(v_user->>'branch','')::uuid)
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, branch_id = EXCLUDED.branch_id;

    DELETE FROM public.user_roles WHERE user_id = v_uid;
    INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, (v_user->>'role')::app_role);
  END LOOP;
END $$;
