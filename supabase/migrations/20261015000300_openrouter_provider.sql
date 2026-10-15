-- Replace the user-selectable Gemini gateway with OpenRouter and expand AI allowances.
-- Apply after 20261015000200_user_ai_preference_admin.sql.
alter table public.user_ai_prefs drop constraint if exists user_ai_prefs_provider_check;

update public.user_ai_prefs
set provider = 'openrouter', chat_model = 'z-ai/glm-5.3-flash', updated_at = now()
where provider = 'gemini';

alter table public.user_ai_prefs
  add constraint user_ai_prefs_provider_check check (provider in ('groq', 'openrouter'));

alter table public.app_config drop constraint if exists app_config_provider_check;
alter table public.app_config
  add constraint app_config_provider_check check (provider in ('groq', 'openrouter', 'nvidia'));

update public.app_config
set provider = case when provider = 'gemini' then 'openrouter' else provider end,
    chat_model = case
      when provider = 'gemini' then 'z-ai/glm-5.3-flash'
      when provider = 'groq' and chat_model = 'openai/gpt-oss-120b' then 'openai/gpt-oss-20b'
      else chat_model end,
    vision_model = case when provider = 'gemini' then 'z-ai/glm-5.3-flash' else vision_model end,
    allowed_providers = array['groq', 'openrouter']::text[],
    per_user_daily_limit = 25,
    global_daily_limit = 250,
    per_ip_daily_limit = 250,
    updated_at = now()
where id = 1;

alter table public.app_config
  alter column chat_model set default 'openai/gpt-oss-20b',
  alter column allowed_providers set default array['groq', 'openrouter']::text[],
  alter column per_user_daily_limit set default 25,
  alter column global_daily_limit set default 250,
  alter column per_ip_daily_limit set default 250;
