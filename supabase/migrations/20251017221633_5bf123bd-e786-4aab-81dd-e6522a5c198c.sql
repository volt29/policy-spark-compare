-- Dodaj brakujący profil dla istniejącego użytkownika
INSERT INTO public.profiles (id, full_name, company_name, created_at, updated_at)
VALUES (
  '61412615-c02d-4a30-8f53-7faa18f1544b',
  'Maciej Samoraj',
  'Moonsteps',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Usuń trigger jeśli istnieje i dodaj nowy
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();