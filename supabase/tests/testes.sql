-- Testes das regras do motel. Rodam como os usuários reais (role authenticated + JWT simulado).
\o /dev/null
\set QUIET on
set client_min_messages = warning;

create schema teste;
create function teste.como(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false) $$;
create function teste.igual(a anyelement, b anyelement, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'FALHOU: % (esperado %, veio %)', msg, b, a; end if; end $$;
create function teste.erro(p_sql text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALHOU: deveria dar erro "%": %', p_trecho, p_sql;
exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if;
  if position(p_trecho in sqlerrm) = 0 then raise exception 'FALHOU: erro errado em %: %', p_sql, sqlerrm; end if;
end $$;
grant usage on schema teste to authenticated;
grant execute on all functions in schema teste to authenticated;

-- ---------------------------------------------------------------- regras de cálculo (unidade)
do $$ declare e timestamptz := '2026-11-17 20:00-03'; begin
  perform teste.igual(_horas_adicionais(e, e + interval '1 hour 50 min' - interval '2 hours', 15), 0, 'antes do fim');
  perform teste.igual(_horas_adicionais(e, e + interval '15 min', 15), 0, 'dentro da tolerância');
  perform teste.igual(_horas_adicionais(e, e + interval '16 min', 15), 1, 'passou da tolerância');
  perform teste.igual(_horas_adicionais(e, e + interval '90 min', 15), 2, 'cada hora iniciada');
  perform teste.igual(_proximo_horario('2026-11-17 23:00-03', '12:00'), '2026-11-18 12:00-03'::timestamptz, 'pernoite vai ao dia seguinte');
  perform teste.igual(_proximo_horario('2026-11-18 02:00-03', '12:00'), '2026-11-18 12:00-03'::timestamptz, 'pernoite de madrugada');
  perform teste.igual(_pernoite_permitido('2026-11-17 22:00-03', '20:00', '05:00'), true, 'janela 22h');
  perform teste.igual(_pernoite_permitido('2026-11-18 03:00-03', '20:00', '05:00'), true, 'janela 3h');
  perform teste.igual(_pernoite_permitido('2026-11-18 15:00-03', '20:00', '05:00'), false, 'fora da janela');
  perform teste.igual(_normalizar_placa('abc-1234'), 'ABC1234', 'placa antiga');
  perform teste.igual(_normalizar_placa('bra2e19'), 'BRA2E19', 'placa mercosul');
  perform teste.igual(_normalizar_placa('AB12345'), null::text, 'placa inválida');
end $$;

-- ---------------------------------------------------------------- usuários
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'admin@motel.local'),
  ('00000000-0000-0000-0000-00000000000b', 'ana@motel.local'),
  ('00000000-0000-0000-0000-00000000000c', 'ger@motel.local'),
  ('00000000-0000-0000-0000-00000000000d', 'bia@motel.local');
-- Primeiro admin, criado pelo editor SQL do Supabase
select admin_salvar_perfil('00000000-0000-0000-0000-00000000000a', 'Zé', 'admin', 'admin', true, '1234');
-- Um usuário comum não consegue se promover
set role authenticated;
select teste.como('00000000-0000-0000-0000-00000000000d');
select teste.erro($$select admin_salvar_perfil('00000000-0000-0000-0000-00000000000d', 'Bia', 'bia', 'admin', true)$$, 'Faça login');
reset role;

-- ---------------------------------------------------------------- fluxo completo, como usuários reais
set role authenticated;
select teste.como('00000000-0000-0000-0000-00000000000a');
select admin_salvar_perfil('00000000-0000-0000-0000-00000000000b', 'Ana', 'ana', 'atendente', true);
select admin_salvar_perfil('00000000-0000-0000-0000-00000000000c', 'Gerente', 'ger', 'gerente', true, '4321');
select admin_salvar_perfil('00000000-0000-0000-0000-00000000000d', 'Bia', 'bia', 'camareira', true);
select teste.erro($$select admin_salvar_perfil('00000000-0000-0000-0000-00000000000a', 'Zé', 'admin', 'atendente', true)$$, 'próprio usuário');
select teste.erro($$select admin_salvar_perfil('00000000-0000-0000-0000-00000000000d', '', 'bia', 'camareira', true)$$, 'Informe o nome');
select teste.erro($$select admin_salvar_perfil('00000000-0000-0000-0000-00000000000d', 'Bia', 'bia maria', 'camareira', true)$$, 'Login deve');
select teste.erro($$select admin_salvar_perfil('00000000-0000-0000-0000-00000000000c', 'Gerente', 'ger', 'gerente', true, '12')$$, 'PIN');

-- O celular não lê nem grava tabelas diretamente
select teste.erro('select * from locacoes', 'permission denied');
select teste.erro($$update quartos set status = 'livre'$$, 'permission denied');

select teste.como('00000000-0000-0000-0000-00000000000b'); -- Ana, atendente
select teste.erro('select relatorio_resumo()', 'Sem permissão');
select teste.erro($$select admin_listar('usuarios')$$, 'Sem permissão');
select teste.erro($$select admin_salvar('produtos', null, '{"nome":"x","preco":1}')$$, 'Sem permissão');

do $$
declare
  q bigint := (select (x->>'id')::bigint from jsonb_array_elements(painel()->'quartos') x where x->>'numero' = '01');
  q2 bigint := (select (x->>'id')::bigint from jsonb_array_elements(painel()->'quartos') x where x->>'numero' = '02');
  per jsonb := tabela()->'categorias'->0->'periodos'->0;
  prod jsonb := tabela()->'produtos'->0;
  loc jsonb; total numeric; r jsonb; cx jsonb;
begin
  perform teste.erro(format($s$select abrir_locacao(%s, 'XX1', false, null, 'periodo', %s)$s$, q, per->>'id'), 'Placa inválida');
  loc := abrir_locacao(q, 'abc-1d23', false, 'Onix prata', 'periodo', (per->>'id')::bigint);
  perform teste.igual(loc->>'placa', 'ABC1D23', 'placa normalizada');
  perform teste.erro(format($s$select abrir_locacao(%s, 'DEF1234', false, null, 'periodo', %s)$s$, q, per->>'id'), 'não está livre');
  perform teste.erro(format($s$select abrir_locacao(%s, 'ABC1D23', false, null, 'periodo', %s)$s$, q2, per->>'id'), 'placa já está');

  -- consumo
  r := lancar_consumo((loc->>'id')::bigint, (prod->>'id')::bigint, 2);
  total := (per->>'preco')::numeric + 2 * (prod->>'preco')::numeric;
  perform teste.igual((r->>'total')::numeric, total, 'total com consumo');

  -- fechar sem caixa / valor errado / desconto sem gerente
  perform teste.erro(format($s$select fechar_locacao(%s, '[{"forma":"pix","valor":%s}]')$s$, loc->>'id', total), 'Abra o seu caixa');
  perform abrir_caixa(50);
  perform teste.erro(format($s$select fechar_locacao(%s, '[{"forma":"pix","valor":1}]')$s$, loc->>'id'), 'não batem');
  perform teste.erro(format($s$select fechar_locacao(%s, '[{"forma":"dinheiro","valor":%s}]', 5, 'cliente fiel')$s$, loc->>'id', total - 5), 'gerente');
  perform teste.erro(format($s$select fechar_locacao(%s, '[{"forma":"dinheiro","valor":%s}]', 5, 'cliente fiel', 'ger', '0000')$s$, loc->>'id', total - 5), 'inválida');
  r := fechar_locacao((loc->>'id')::bigint, jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', total - 5)), 5, 'cliente fiel', 'ger', '4321');
  perform teste.igual((r->>'total')::numeric, total - 5, 'total com desconto');
  perform teste.igual((select x->>'status' from jsonb_array_elements(painel()->'quartos') x where (x->>'id')::bigint = q), 'limpeza', 'quarto vai para limpeza');

  -- fechamento cego
  cx := meu_caixa();
  perform teste.igual(cx ? 'esperado_dinheiro', false, 'atendente não vê o esperado');
  r := fechar_caixa(50 + total - 5 - 10);
  perform teste.igual(r ? 'diferenca', false, 'atendente não vê a diferença');

  -- cancelamento pede gerente
  loc := abrir_locacao(q2, 'XYZ9876', false, null, 'periodo', (per->>'id')::bigint);
  perform teste.erro(format($s$select cancelar_locacao(%s, 'desistiu', 'ana', '1234')$s$, loc->>'id'), 'inválida');
  perform cancelar_locacao((loc->>'id')::bigint, 'desistiu', 'ger', '4321');

  -- atendente não põe quarto em manutenção, mas libera após limpeza
  perform teste.erro(format($s$select mudar_status_quarto(%s, 'manutencao')$s$, (select (x->>'id') from jsonb_array_elements(painel()->'quartos') x where x->>'numero' = '05')), 'não permitida');
end $$;

select teste.como('00000000-0000-0000-0000-00000000000d'); -- Bia, camareira
do $$ declare q bigint := (select (x->>'id')::bigint from jsonb_array_elements(painel()->'quartos') x where x->>'numero' = '01');
begin
  perform mudar_status_quarto(q, 'livre');
  perform teste.erro('select abrir_caixa(0)', 'Sem permissão');
end $$;

-- Mudança de preço com quarto ocupado não muda a conta
select teste.como('00000000-0000-0000-0000-00000000000b');
do $$ declare q bigint := (select (x->>'id')::bigint from jsonb_array_elements(painel()->'quartos') x where x->>'numero' = '03');
  per jsonb := tabela()->'categorias'->0->'periodos'->0; loc jsonb;
begin
  loc := abrir_locacao(q, null, true, null, 'periodo', (per->>'id')::bigint);
  perform teste.como('00000000-0000-0000-0000-00000000000a');
  perform admin_salvar('periodos', (per->>'id')::bigint, '{"preco": 999}');
  perform teste.igual((conta_locacao((loc->>'id')::bigint)->>'total')::numeric, (per->>'preco')::numeric, 'preço congelado na entrada');
end $$;

-- Relatórios do dono
select teste.como('00000000-0000-0000-0000-00000000000a');
do $$ declare r jsonb := relatorio_resumo(); c jsonb := relatorio_caixas(); l jsonb;
begin
  perform teste.igual((r->>'locacoes')::int, 1, 'uma locação fechada');
  perform teste.igual((r->>'descontos')::numeric, 5::numeric, 'descontos no relatório');
  perform teste.igual(jsonb_array_length(r->'canceladas'), 1, 'cancelamento no relatório');
  perform teste.igual((c->0->>'diferenca')::numeric, -10::numeric, 'faltou 10 reais no caixa');
  l := relatorio_locacoes(null, null, 'abc1d23');
  perform teste.igual(jsonb_array_length(l), 1, 'busca por placa');
  perform teste.igual(exists(select 1 from jsonb_array_elements(relatorio_auditoria()) a where a->>'acao' = 'busca_placa'), true, 'busca fica registrada');
  perform admin_salvar_config('{"nome_motel":"Motel Verona"}');
  perform teste.igual(eu_perfil()->>'nome_motel', 'Motel Verona', 'nome do motel');
end $$;

-- Usuário desativado perde o acesso na hora
select admin_salvar_perfil('00000000-0000-0000-0000-00000000000b', 'Ana', 'ana', 'atendente', false);
select teste.como('00000000-0000-0000-0000-00000000000b');
select teste.erro('select painel()', 'Faça login');

-- LGPD
reset role;
update locacoes set entrada = '2020-01-01' where status = 'fechada';
select teste.igual(mascarar_placas_antigas() >= 1, true, 'mascarou placas');
select teste.igual((select placa from locacoes where status = 'fechada' limit 1), 'ABC****', 'placa mascarada');
