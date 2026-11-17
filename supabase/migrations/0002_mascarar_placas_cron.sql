-- Todo dia às 04:00 (horário de Brasília = 07:00 UTC) mascara as placas antigas (LGPD).
-- No Supabase: Database > Extensions > habilite "pg_cron" antes de rodar este arquivo.
create extension if not exists pg_cron;
select cron.schedule('mascarar-placas', '0 7 * * *', $$select public.mascarar_placas_antigas()$$);
