// Cria e altera logins de funcionárias. Só o admin pode chamar.
// O login vira o e-mail interno "<login>@motel.local" (ninguém precisa ter e-mail de verdade).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const chamador = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: eu, error: erroEu } = await chamador.rpc('eu_perfil');
    if (erroEu || eu?.papel !== 'admin') return resposta({ erro: 'Sem permissão' }, 403);

    const { id, nome, login, papel, ativo = true, senha, pin } = await req.json();
    const loginOk = String(login ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(loginOk)) {
      return resposta({ erro: 'Login deve ter de 3 a 30 letras ou números, sem espaço nem acento' }, 400);
    }
    if (!String(nome ?? '').trim()) return resposta({ erro: 'Informe o nome' }, 400);
    if (senha && String(senha).length < 6) return resposta({ erro: 'Senha precisa de ao menos 6 caracteres' }, 400);
    if (id && id === eu.id && (!ativo || papel !== 'admin')) {
      return resposta({ erro: 'Você não pode desativar ou rebaixar o próprio usuário' }, 400);
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const email = `${loginOk}@motel.local`;
    let usuarioId = id as string | undefined;
    if (!usuarioId) {
      if (!senha) return resposta({ erro: 'Informe a senha' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true });
      if (error) return resposta({ erro: error.message.includes('already') ? 'Este login já existe' : error.message }, 400);
      usuarioId = data.user.id;
    } else {
      const { error } = await admin.auth.admin.updateUserById(usuarioId, {
        email, ...(senha ? { password: senha } : {}), ban_duration: ativo ? 'none' : '876000h',
      });
      if (error) return resposta({ erro: error.message }, 400);
    }

    // Grava o perfil com o token do admin, para a auditoria registrar quem fez.
    const { error: erroPerfil } = await chamador.rpc('admin_salvar_perfil', {
      p_id: usuarioId, p_nome: String(nome).trim(), p_login: loginOk, p_papel: papel, p_ativo: !!ativo, p_pin: pin || null,
    });
    if (erroPerfil) {
      if (!id) await admin.auth.admin.deleteUser(usuarioId);
      return resposta({ erro: erroPerfil.message }, 400);
    }
    return resposta({ ok: true, id: usuarioId });
  } catch (e) {
    return resposta({ erro: e instanceof Error ? e.message : 'Erro interno' }, 500);
  }
});
