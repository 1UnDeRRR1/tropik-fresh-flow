DELETE FROM public.user_roles WHERE user_id='85e47ac9-57f3-4223-88f7-2463b49b6cb5';
INSERT INTO public.user_roles (user_id, role) VALUES ('85e47ac9-57f3-4223-88f7-2463b49b6cb5','admin');
UPDATE public.profiles SET full_name='Admin', branch_id=NULL WHERE id='85e47ac9-57f3-4223-88f7-2463b49b6cb5';