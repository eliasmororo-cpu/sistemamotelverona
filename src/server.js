process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { abrir, hashSenha, conferirSenha } = require('./db');
const calc = require('./calculo');

class Erro extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

const agoraISO = () => new Date().toISOString();
const ehGestor = (u) => u && (u.papel === 'admin' || u.papel === 'gerente');

function criarApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const um = (sql, ...p) => db.prepare(sql).get(...p);
  const todos = (sql, ...p) => db.prepare(sql).all(...p);
  const exec = (sql, ...p) => db.prepare(sql).run(...p);

  function transacao(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function auditar(usuarioId, acao, detalhe) {
    exec('INSERT INTO auditoria (usuario_id, acao, detalhe, criado_em) VALUES (?,?,?,?)',
      usuarioId ?? null, acao, detalhe == null ? null : JSON.stringify(detalhe), agoraISO());
  }

  // Desconto, cancelamento e estorno pedem login e senha de um gerente (pode ser no mesmo aparelho).
  function autorizacaoGerente(aut) {
    if (!aut || !aut.login || !aut.senha) throw new Error403('Precisa da senha de um gerente');
    const u = um('SELECT * FROM usuarios WHERE login = ? AND ativo = 1', String(aut.login));
    if (!u || !conferirSenha(aut.senha, u.senha_hash) || !ehGestor(u)) {
      throw new Error403('Autorização de gerente inválida');
    }
    return u;
  }
  function Error403(msg) { return new Erro(403, msg); }

  // ---------- Autenticação ----------
  const tentativas = new Map();
  app.post('/api/login', (req, res) => {
    const chave = req.ip;
    const t = tentativas.get(chave) || { n: 0, ate: 0 };
    if (t.ate > Date.now()) throw new Erro(429, 'Muitas tentativas. Aguarde 5 minutos.');
    const { login, senha } = req.body || {};
    const u = um('SELECT * FROM usuarios WHERE login = ? AND ativo = 1', String(login || ''));
    if (!u || !conferirSenha(senha || '', u.senha_hash)) {
      t.n += 1;
      if (t.n >= 5) { t.ate = Date.now() + 5 * 60 * 1000; t.n = 0; }
      tentativas.set(chave, t);
      throw new Erro(401, 'Login ou senha incorretos');
    }
    tentativas.delete(chave);
    const token = crypto.randomBytes(32).toString('hex');
    exec('INSERT INTO sessoes (token, usuario_id, criado_em) VALUES (?,?,?)', token, u.id, agoraISO());
    auditar(u.id, 'login');
    res.cookie('sessao', token, {
      httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 1000 * 60 * 60 * 16,
    });
    res.json({ id: u.id, nome: u.nome, papel: u.papel });
  });

  function autenticar(req, _res, next) {
    const token = (req.headers.cookie || '').split(';').map((c) => c.trim())
      .find((c) => c.startsWith('sessao='))?.slice(7);
    const s = token && um(`SELECT u.id, u.nome, u.papel, s.criado_em FROM sessoes s
      JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ? AND u.ativo = 1`, token);
    if (!s || Date.now() - Date.parse(s.criado_em) > 16 * 3600 * 1000) {
      return next(new Erro(401, 'Faça login novamente'));
    }
    req.token = token;
    req.usuario = { id: s.id, nome: s.nome, papel: s.papel };
    next();
  }
  const papeis = (...lista) => (req, _res, next) =>
    next(lista.includes(req.usuario.papel) ? undefined : new Erro(403, 'Sem permissão'));
  const RECEPCAO = ['admin', 'gerente', 'atendente'];
  const GESTAO = ['admin', 'gerente'];

  app.use('/api', autenticar);

  app.post('/api/logout', (req, res) => {
    exec('DELETE FROM sessoes WHERE token = ?', req.token);
    res.clearCookie('sessao');
    res.json({ ok: true });
  });
  // Cada pessoa usa o próprio celular: ela mesma troca a senha e pode sair de todos os aparelhos.
  app.post('/api/minha-senha', (req, res) => {
    const { atual, nova } = req.body || {};
    const u = um('SELECT * FROM usuarios WHERE id = ?', req.usuario.id);
    if (!conferirSenha(atual || '', u.senha_hash)) throw new Erro(400, 'Senha atual incorreta');
    if (String(nova || '').length < 6) throw new Erro(400, 'A nova senha precisa de ao menos 6 caracteres');
    exec('UPDATE usuarios SET senha_hash = ? WHERE id = ?', hashSenha(nova), u.id);
    exec('DELETE FROM sessoes WHERE usuario_id = ? AND token != ?', u.id, req.token);
    auditar(u.id, 'senha_alterada');
    res.json({ ok: true });
  });

  app.get('/api/eu', (req, res) => {
    res.json({ ...req.usuario, nome_motel: um("SELECT valor FROM configuracoes WHERE chave='nome_motel'")?.valor });
  });

  // ---------- Painel de quartos ----------
  function caixaAberto(usuarioId) {
    return um('SELECT * FROM caixas WHERE usuario_id = ? AND fechado_em IS NULL', usuarioId);
  }

  function contaLocacao(loc, saida = new Date()) {
    const horas = calc.horasAdicionais(new Date(loc.limite), saida, loc.tolerancia_min);
    const valorAdicional = calc.centavos(horas * loc.hora_adicional);
    const consumos = todos('SELECT * FROM consumos WHERE locacao_id = ? ORDER BY id', loc.id);
    const valorConsumo = calc.centavos(consumos.reduce((s, c) => s + c.quantidade * c.preco_unit, 0));
    const valorQuarto = calc.centavos(loc.preco_base + valorAdicional);
    return {
      locacao_id: loc.id,
      entrada: loc.entrada,
      limite: loc.limite,
      saida: saida.toISOString(),
      minutos: Math.max(0, Math.round((saida - new Date(loc.entrada)) / 60000)),
      preco_base: loc.preco_base,
      horas_adicionais: horas,
      valor_adicional: valorAdicional,
      valor_quarto: valorQuarto,
      consumos,
      valor_consumo: valorConsumo,
      total: calc.centavos(valorQuarto + valorConsumo),
    };
  }

  app.get('/api/painel', (req, res) => {
    const quartos = todos(`SELECT q.id, q.numero, q.status, c.nome AS categoria, c.id AS categoria_id
      FROM quartos q JOIN categorias c ON c.id = q.categoria_id WHERE q.ativo = 1 ORDER BY q.numero`);
    const abertas = todos("SELECT * FROM locacoes WHERE status = 'aberta'");
    const porQuarto = new Map(abertas.map((l) => [l.quarto_id, l]));
    const agora = new Date();
    res.json({
      agora: agora.toISOString(),
      caixa: caixaAberto(req.usuario.id) ? { aberto: true } : { aberto: false },
      quartos: quartos.map((q) => {
        const l = porQuarto.get(q.id);
        if (!l) return q;
        const conta = contaLocacao(l, agora);
        return {
          ...q,
          locacao: {
            id: l.id, placa: l.placa, sem_veiculo: !!l.sem_veiculo, veiculo: l.veiculo, tipo: l.tipo,
            periodo_nome: l.periodo_nome, entrada: l.entrada, limite: l.limite,
            vencido: agora > new Date(l.limite), total_parcial: conta.total,
          },
        };
      }),
    });
  });

  app.get('/api/tabela', (_req, res) => {
    const categorias = todos('SELECT * FROM categorias WHERE ativo = 1 ORDER BY id');
    const periodos = todos('SELECT * FROM periodos WHERE ativo = 1 ORDER BY minutos');
    res.json({
      categorias: categorias.map((c) => ({ ...c, periodos: periodos.filter((p) => p.categoria_id === c.id) })),
      produtos: todos('SELECT * FROM produtos WHERE ativo = 1 ORDER BY nome'),
    });
  });

  // ---------- Locações ----------
  app.post('/api/locacoes', papeis(...RECEPCAO), (req, res) => {
    const { quarto_id, placa, sem_veiculo, veiculo, tipo, periodo_id } = req.body || {};
    const loc = transacao(() => {
      const q = um('SELECT * FROM quartos WHERE id = ? AND ativo = 1', quarto_id);
      if (!q) throw new Erro(404, 'Quarto não encontrado');
      if (q.status !== 'livre') throw new Erro(409, `Quarto ${q.numero} não está livre`);
      const categoria = um('SELECT * FROM categorias WHERE id = ?', q.categoria_id);

      let placaOk = null;
      if (!sem_veiculo) {
        placaOk = calc.normalizarPlaca(placa);
        if (!placaOk) throw new Erro(400, 'Placa inválida. Use ABC1234 ou ABC1D23.');
        const dup = um("SELECT 1 FROM locacoes WHERE status = 'aberta' AND placa = ?", placaOk);
        if (dup) throw new Erro(409, 'Esta placa já está em um quarto ocupado');
      }

      const entrada = new Date();
      let base; let limite; let periodo = null;
      if (tipo === 'pernoite') {
        if (!calc.pernoitePermitido(entrada, categoria.pernoite_inicio, categoria.pernoite_fim_venda)) {
          throw new Erro(400, `Pernoite só pode ser vendido entre ${categoria.pernoite_inicio} e ${categoria.pernoite_fim_venda}`);
        }
        const r = calc.calcularValorQuarto({ tipo, categoria, entrada, saida: entrada });
        base = r.base; limite = r.limite;
      } else if (tipo === 'periodo') {
        periodo = um('SELECT * FROM periodos WHERE id = ? AND categoria_id = ? AND ativo = 1', periodo_id, q.categoria_id);
        if (!periodo) throw new Erro(400, 'Período inválido para este quarto');
        const r = calc.calcularValorQuarto({ tipo, periodo, categoria, entrada, saida: entrada });
        base = r.base; limite = r.limite;
      } else {
        throw new Erro(400, 'Tipo de locação inválido');
      }

      const id = exec(`INSERT INTO locacoes (quarto_id, placa, sem_veiculo, veiculo, tipo, periodo_id, periodo_nome,
          preco_base, hora_adicional, tolerancia_min, entrada, limite, usuario_entrada)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      q.id, placaOk, sem_veiculo ? 1 : 0, (veiculo || '').slice(0, 60) || null, tipo, periodo?.id ?? null,
      periodo ? periodo.nome : 'Pernoite', base, categoria.hora_adicional, categoria.tolerancia_min,
      entrada.toISOString(), limite.toISOString(), req.usuario.id).lastInsertRowid;
      exec("UPDATE quartos SET status = 'ocupado' WHERE id = ?", q.id);
      auditar(req.usuario.id, 'locacao_aberta', { locacao_id: Number(id), quarto: q.numero, placa: placaOk, tipo, base });
      return um('SELECT * FROM locacoes WHERE id = ?', id);
    });
    res.status(201).json(loc);
  });

  function locacaoAberta(id) {
    const l = um('SELECT * FROM locacoes WHERE id = ?', id);
    if (!l) throw new Erro(404, 'Locação não encontrada');
    if (l.status !== 'aberta') throw new Erro(409, 'Locação já encerrada');
    return l;
  }

  app.get('/api/locacoes/:id/conta', (req, res) => {
    const l = um('SELECT * FROM locacoes WHERE id = ?', req.params.id);
    if (!l) throw new Erro(404, 'Locação não encontrada');
    const q = um('SELECT numero FROM quartos WHERE id = ?', l.quarto_id);
    const conta = l.status === 'aberta' ? contaLocacao(l) : {
      ...contaLocacao(l, new Date(l.saida)), desconto: l.desconto, total: l.total,
    };
    res.json({ ...conta, quarto: q.numero, placa: l.placa, tipo: l.tipo, periodo_nome: l.periodo_nome, status: l.status });
  });

  app.post('/api/locacoes/:id/consumos', papeis(...RECEPCAO, 'camareira'), (req, res) => {
    const l = locacaoAberta(req.params.id);
    const p = um('SELECT * FROM produtos WHERE id = ? AND ativo = 1', req.body?.produto_id);
    const qtd = Number(req.body?.quantidade);
    if (!p) throw new Erro(400, 'Produto inválido');
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 50) throw new Erro(400, 'Quantidade inválida');
    exec(`INSERT INTO consumos (locacao_id, produto_id, nome, quantidade, preco_unit, usuario_id, criado_em)
      VALUES (?,?,?,?,?,?,?)`, l.id, p.id, p.nome, qtd, p.preco, req.usuario.id, agoraISO());
    auditar(req.usuario.id, 'consumo_lancado', { locacao_id: l.id, produto: p.nome, qtd, preco: p.preco });
    res.status(201).json(contaLocacao(l));
  });

  app.post('/api/consumos/:id/estornar', papeis(...RECEPCAO), (req, res) => {
    const c = um('SELECT * FROM consumos WHERE id = ?', req.params.id);
    if (!c) throw new Erro(404, 'Consumo não encontrado');
    const l = locacaoAberta(c.locacao_id);
    const gerente = autorizacaoGerente(req.body?.autorizacao);
    const motivo = String(req.body?.motivo || '').trim();
    if (!motivo) throw new Erro(400, 'Informe o motivo');
    exec('DELETE FROM consumos WHERE id = ?', c.id);
    auditar(req.usuario.id, 'consumo_estornado', { locacao_id: l.id, consumo: c, motivo, autorizado_por: gerente.id });
    res.json(contaLocacao(l));
  });

  app.post('/api/locacoes/:id/fechar', papeis(...RECEPCAO), (req, res) => {
    const { pagamentos, desconto, desconto_motivo, autorizacao } = req.body || {};
    const resultado = transacao(() => {
      const l = locacaoAberta(req.params.id);
      const caixa = caixaAberto(req.usuario.id);
      if (!caixa) throw new Erro(409, 'Abra o seu caixa antes de receber');
      const conta = contaLocacao(l);

      const valorDesc = calc.centavos(Number(desconto) || 0);
      let gerente = null;
      if (valorDesc < 0 || valorDesc > conta.total) throw new Erro(400, 'Desconto inválido');
      if (valorDesc > 0) {
        if (!String(desconto_motivo || '').trim()) throw new Erro(400, 'Informe o motivo do desconto');
        gerente = autorizacaoGerente(autorizacao);
      }
      const total = calc.centavos(conta.total - valorDesc);

      const pags = Array.isArray(pagamentos) ? pagamentos : [];
      const formas = ['dinheiro', 'pix', 'debito', 'credito'];
      for (const p of pags) {
        if (!formas.includes(p.forma) || !(Number(p.valor) > 0)) throw new Erro(400, 'Pagamento inválido');
      }
      const pago = calc.centavos(pags.reduce((s, p) => s + Number(p.valor), 0));
      if (Math.abs(pago - total) > 0.009) {
        throw new Erro(400, `Pagamentos (R$ ${pago.toFixed(2)}) não batem com o total (R$ ${total.toFixed(2)})`);
      }

      for (const p of pags) {
        exec('INSERT INTO pagamentos (locacao_id, caixa_id, forma, valor) VALUES (?,?,?,?)',
          l.id, caixa.id, p.forma, calc.centavos(p.valor));
      }
      exec(`UPDATE locacoes SET status = 'fechada', saida = ?, horas_adicionais = ?, valor_quarto = ?,
          valor_consumo = ?, desconto = ?, desconto_motivo = ?, desconto_autorizado_por = ?, total = ?,
          usuario_saida = ?, caixa_id = ? WHERE id = ?`,
      conta.saida, conta.horas_adicionais, conta.valor_quarto, conta.valor_consumo, valorDesc,
      valorDesc ? String(desconto_motivo).trim() : null, gerente?.id ?? null, total,
      req.usuario.id, caixa.id, l.id);
      exec("UPDATE quartos SET status = 'limpeza' WHERE id = ?", l.quarto_id);
      exec('INSERT INTO limpezas (quarto_id, locacao_id, inicio) VALUES (?,?,?)', l.quarto_id, l.id, conta.saida);
      auditar(req.usuario.id, 'locacao_fechada', {
        locacao_id: l.id, total, desconto: valorDesc, autorizado_por: gerente?.id, pagamentos: pags,
      });
      return { ...conta, desconto: valorDesc, total };
    });
    res.json(resultado);
  });

  app.post('/api/locacoes/:id/cancelar', papeis(...RECEPCAO), (req, res) => {
    transacao(() => {
      const l = locacaoAberta(req.params.id);
      const gerente = autorizacaoGerente(req.body?.autorizacao);
      const motivo = String(req.body?.motivo || '').trim();
      if (!motivo) throw new Erro(400, 'Informe o motivo');
      const agora = agoraISO();
      exec(`UPDATE locacoes SET status = 'cancelada', saida = ?, total = 0, cancel_motivo = ?,
        cancel_autorizado_por = ?, usuario_saida = ? WHERE id = ?`, agora, motivo, gerente.id, req.usuario.id, l.id);
      exec("UPDATE quartos SET status = 'limpeza' WHERE id = ?", l.quarto_id);
      exec('INSERT INTO limpezas (quarto_id, locacao_id, inicio) VALUES (?,?,?)', l.quarto_id, l.id, agora);
      auditar(req.usuario.id, 'locacao_cancelada', { locacao_id: l.id, motivo, autorizado_por: gerente.id });
    });
    res.json({ ok: true });
  });

  // ---------- Status de quarto (limpeza / manutenção) ----------
  app.post('/api/quartos/:id/status', (req, res) => {
    const q = um('SELECT * FROM quartos WHERE id = ?', req.params.id);
    if (!q) throw new Erro(404, 'Quarto não encontrado');
    const novo = req.body?.status;
    const u = req.usuario;
    const permitido =
      (q.status === 'limpeza' && novo === 'livre') ||
      (ehGestor(u) && q.status === 'livre' && novo === 'manutencao') ||
      (ehGestor(u) && q.status === 'manutencao' && novo === 'livre');
    if (!permitido) throw new Erro(400, 'Mudança de status não permitida');
    exec('UPDATE quartos SET status = ? WHERE id = ?', novo, q.id);
    if (q.status === 'limpeza') {
      exec('UPDATE limpezas SET fim = ?, usuario_id = ? WHERE quarto_id = ? AND fim IS NULL', agoraISO(), u.id, q.id);
    }
    auditar(u.id, 'quarto_status', { quarto: q.numero, de: q.status, para: novo });
    res.json({ ok: true });
  });

  // ---------- Caixa ----------
  function resumoCaixa(caixa) {
    const porForma = todos(`SELECT forma, SUM(valor) AS total, COUNT(*) AS n FROM pagamentos
      WHERE caixa_id = ? GROUP BY forma`, caixa.id);
    const mov = todos('SELECT * FROM movimentos_caixa WHERE caixa_id = ? ORDER BY id', caixa.id);
    const dinheiro = porForma.find((f) => f.forma === 'dinheiro')?.total || 0;
    const suprimentos = mov.filter((m) => m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);
    const sangrias = mov.filter((m) => m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
    return {
      porForma, movimentos: mov,
      esperadoDinheiro: calc.centavos(caixa.valor_inicial + dinheiro + suprimentos - sangrias),
      locacoes: um('SELECT COUNT(*) AS n FROM locacoes WHERE caixa_id = ?', caixa.id).n,
    };
  }

  app.get('/api/caixa', papeis(...RECEPCAO), (req, res) => {
    const c = caixaAberto(req.usuario.id);
    if (!c) return res.json({ aberto: false });
    const r = resumoCaixa(c);
    // Fechamento "cego": a atendente não vê quanto deveria ter em dinheiro.
    res.json({
      aberto: true, id: c.id, aberto_em: c.aberto_em, valor_inicial: c.valor_inicial,
      locacoes: r.locacoes, movimentos: r.movimentos,
      porForma: r.porForma.filter((f) => f.forma !== 'dinheiro' || ehGestor(req.usuario)),
      esperadoDinheiro: ehGestor(req.usuario) ? r.esperadoDinheiro : undefined,
    });
  });

  app.post('/api/caixa/abrir', papeis(...RECEPCAO), (req, res) => {
    if (caixaAberto(req.usuario.id)) throw new Erro(409, 'Você já tem um caixa aberto');
    const inicial = calc.centavos(Number(req.body?.valor_inicial) || 0);
    if (inicial < 0) throw new Erro(400, 'Valor inválido');
    const id = exec('INSERT INTO caixas (usuario_id, aberto_em, valor_inicial) VALUES (?,?,?)',
      req.usuario.id, agoraISO(), inicial).lastInsertRowid;
    auditar(req.usuario.id, 'caixa_aberto', { caixa_id: Number(id), valor_inicial: inicial });
    res.status(201).json({ ok: true });
  });

  app.post('/api/caixa/movimento', papeis(...RECEPCAO), (req, res) => {
    const c = caixaAberto(req.usuario.id);
    if (!c) throw new Erro(409, 'Nenhum caixa aberto');
    const { tipo, valor, motivo } = req.body || {};
    const v = calc.centavos(Number(valor));
    if (!['sangria', 'suprimento'].includes(tipo) || !(v > 0)) throw new Erro(400, 'Movimento inválido');
    if (!String(motivo || '').trim()) throw new Erro(400, 'Informe o motivo');
    exec('INSERT INTO movimentos_caixa (caixa_id, tipo, valor, motivo, usuario_id, criado_em) VALUES (?,?,?,?,?,?)',
      c.id, tipo, v, String(motivo).trim(), req.usuario.id, agoraISO());
    auditar(req.usuario.id, 'caixa_movimento', { caixa_id: c.id, tipo, valor: v, motivo });
    res.status(201).json({ ok: true });
  });

  app.post('/api/caixa/fechar', papeis(...RECEPCAO), (req, res) => {
    const c = caixaAberto(req.usuario.id);
    if (!c) throw new Erro(409, 'Nenhum caixa aberto');
    const contado = calc.centavos(Number(req.body?.valor_contado));
    if (!(contado >= 0)) throw new Erro(400, 'Informe quanto há em dinheiro na gaveta');
    const r = resumoCaixa(c);
    const diferenca = calc.centavos(contado - r.esperadoDinheiro);
    exec(`UPDATE caixas SET fechado_em = ?, valor_contado = ?, esperado_dinheiro = ?, diferenca = ?
      WHERE id = ?`, agoraISO(), contado, r.esperadoDinheiro, diferenca, c.id);
    auditar(req.usuario.id, 'caixa_fechado', { caixa_id: c.id, contado, esperado: r.esperadoDinheiro, diferenca });
    res.json(ehGestor(req.usuario) ? { ok: true, esperado: r.esperadoDinheiro, diferenca } : { ok: true });
  });

  // ---------- Relatórios (dono / gerente) ----------
  function intervalo(q) {
    const hoje = new Date();
    const de = q.de ? new Date(`${q.de}T00:00:00`) : new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const ate = q.ate ? new Date(`${q.ate}T00:00:00`) : new Date(de);
    ate.setDate(ate.getDate() + 1);
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) throw new Erro(400, 'Datas inválidas');
    return [de, ate];
  }

  app.get('/api/relatorios/resumo', papeis(...GESTAO), (req, res) => {
    const [de, ate] = intervalo(req.query);
    const D = de.toISOString(); const A = ate.toISOString();
    const fechadas = todos(`SELECT l.*, q.numero AS quarto, u.nome AS atendente FROM locacoes l
      JOIN quartos q ON q.id = l.quarto_id LEFT JOIN usuarios u ON u.id = l.usuario_saida
      WHERE l.status = 'fechada' AND l.saida >= ? AND l.saida < ?`, D, A);
    const soma = (arr, f) => calc.centavos(arr.reduce((s, x) => s + (f(x) || 0), 0));
    const agrupar = (arr, chave) => {
      const m = new Map();
      for (const l of arr) {
        const k = chave(l);
        const g = m.get(k) || { chave: k, locacoes: 0, total: 0 };
        g.locacoes += 1; g.total = calc.centavos(g.total + l.total);
        m.set(k, g);
      }
      return [...m.values()];
    };
    const dia = (iso) => new Date(iso).toLocaleDateString('sv-SE');
    const minutos = fechadas.map((l) => (new Date(l.saida) - new Date(l.entrada)) / 60000);
    const nQuartos = um('SELECT COUNT(*) AS n FROM quartos WHERE ativo = 1').n;
    const minutosPeriodo = Math.max(1, (Math.min(ate, new Date()) - de) / 60000);
    res.json({
      de: dia(D), ate: dia(new Date(ate - 1).toISOString()),
      locacoes: fechadas.length,
      faturamento: soma(fechadas, (l) => l.total),
      quartos: soma(fechadas, (l) => l.valor_quarto),
      consumo: soma(fechadas, (l) => l.valor_consumo),
      descontos: soma(fechadas, (l) => l.desconto),
      ticket_medio: fechadas.length ? calc.centavos(soma(fechadas, (l) => l.total) / fechadas.length) : 0,
      permanencia_media_min: minutos.length ? Math.round(minutos.reduce((a, b) => a + b, 0) / minutos.length) : 0,
      ocupacao_pct: Math.min(100, Math.round((minutos.reduce((a, b) => a + b, 0) / (nQuartos * minutosPeriodo)) * 1000) / 10),
      por_forma: todos(`SELECT p.forma AS chave, SUM(p.valor) AS total, COUNT(*) AS locacoes FROM pagamentos p
        JOIN locacoes l ON l.id = p.locacao_id WHERE l.saida >= ? AND l.saida < ? GROUP BY p.forma`, D, A),
      por_dia: agrupar(fechadas, (l) => dia(l.saida)).sort((a, b) => a.chave.localeCompare(b.chave)),
      por_hora_entrada: agrupar(fechadas, (l) => new Date(l.entrada).getHours()).sort((a, b) => a.chave - b.chave),
      por_quarto: agrupar(fechadas, (l) => l.quarto).sort((a, b) => b.total - a.total),
      por_atendente: agrupar(fechadas, (l) => l.atendente || '-').sort((a, b) => b.total - a.total),
      com_desconto: fechadas.filter((l) => l.desconto > 0).map((l) => ({
        id: l.id, quarto: l.quarto, desconto: l.desconto, motivo: l.desconto_motivo, atendente: l.atendente, saida: l.saida,
      })),
      canceladas: todos(`SELECT l.id, q.numero AS quarto, l.cancel_motivo AS motivo, l.entrada, l.saida, u.nome AS atendente
        FROM locacoes l JOIN quartos q ON q.id = l.quarto_id LEFT JOIN usuarios u ON u.id = l.usuario_saida
        WHERE l.status = 'cancelada' AND l.saida >= ? AND l.saida < ?`, D, A),
      em_aberto: um("SELECT COUNT(*) AS n FROM locacoes WHERE status = 'aberta'").n,
    });
  });

  app.get('/api/relatorios/caixas', papeis(...GESTAO), (req, res) => {
    const [de, ate] = intervalo(req.query);
    res.json(todos(`SELECT c.*, u.nome AS atendente FROM caixas c JOIN usuarios u ON u.id = c.usuario_id
      WHERE c.aberto_em >= ? AND c.aberto_em < ? ORDER BY c.aberto_em DESC`, de.toISOString(), ate.toISOString()));
  });

  app.get('/api/relatorios/locacoes', papeis(...GESTAO), (req, res) => {
    const [de, ate] = intervalo(req.query);
    const placa = req.query.placa ? String(req.query.placa).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
    const sql = `SELECT l.id, q.numero AS quarto, l.placa, l.veiculo, l.tipo, l.periodo_nome, l.entrada, l.saida,
        l.horas_adicionais, l.valor_quarto, l.valor_consumo, l.desconto, l.total, l.status,
        ue.nome AS atendente_entrada, us.nome AS atendente_saida
      FROM locacoes l JOIN quartos q ON q.id = l.quarto_id
      LEFT JOIN usuarios ue ON ue.id = l.usuario_entrada LEFT JOIN usuarios us ON us.id = l.usuario_saida
      WHERE l.entrada >= ? AND l.entrada < ? ${placa ? 'AND l.placa = ?' : ''} ORDER BY l.entrada DESC LIMIT 500`;
    const params = [de.toISOString(), ate.toISOString(), ...(placa ? [placa] : [])];
    if (placa) auditar(req.usuario.id, 'busca_placa', { placa });
    res.json(todos(sql, ...params));
  });

  app.get('/api/relatorios/auditoria', papeis(...GESTAO), (req, res) => {
    const [de, ate] = intervalo(req.query);
    res.json(todos(`SELECT a.*, u.nome AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.criado_em >= ? AND a.criado_em < ? ORDER BY a.id DESC LIMIT 1000`, de.toISOString(), ate.toISOString()));
  });

  // ---------- Configuração (somente admin) ----------
  const ENTIDADES = {
    categorias: ['nome', 'hora_adicional', 'tolerancia_min', 'pernoite_preco', 'pernoite_inicio', 'pernoite_fim_venda', 'pernoite_fim', 'ativo'],
    periodos: ['categoria_id', 'nome', 'minutos', 'preco', 'ativo'],
    quartos: ['numero', 'categoria_id', 'ativo'],
    produtos: ['nome', 'preco', 'ativo'],
    usuarios: ['nome', 'login', 'papel', 'ativo'],
  };
  const somenteAdmin = papeis('admin');

  app.get('/api/admin/:entidade', somenteAdmin, (req, res) => {
    const campos = ENTIDADES[req.params.entidade];
    if (!campos) throw new Erro(404, 'Entidade inválida');
    res.json(todos(`SELECT id, ${campos.join(', ')} FROM ${req.params.entidade} ORDER BY id`));
  });

  function salvar(req, res, id) {
    const ent = req.params.entidade;
    const campos = ENTIDADES[ent];
    if (!campos) throw new Erro(404, 'Entidade inválida');
    const dados = {};
    for (const c of campos) if (req.body?.[c] !== undefined) dados[c] = req.body[c];
    if (ent === 'usuarios' && req.body?.senha) {
      if (String(req.body.senha).length < 6) throw new Erro(400, 'Senha precisa de ao menos 6 caracteres');
      dados.senha_hash = hashSenha(req.body.senha);
    }
    if (ent === 'usuarios' && id && Number(id) === req.usuario.id && (dados.ativo === 0 || (dados.papel && dados.papel !== 'admin'))) {
      throw new Erro(400, 'Você não pode desativar ou rebaixar o próprio usuário');
    }
    const chaves = Object.keys(dados);
    if (!chaves.length) throw new Erro(400, 'Nada para salvar');
    try {
      if (id) {
        const r = exec(`UPDATE ${ent} SET ${chaves.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...chaves.map((c) => dados[c]), id);
        if (!r.changes) throw new Erro(404, 'Registro não encontrado');
      } else {
        if (ent === 'usuarios' && !dados.senha_hash) throw new Erro(400, 'Informe a senha');
        id = exec(`INSERT INTO ${ent} (${chaves.join(', ')}) VALUES (${chaves.map(() => '?').join(', ')})`,
          ...chaves.map((c) => dados[c])).lastInsertRowid;
      }
    } catch (e) {
      if (e instanceof Erro) throw e;
      throw new Erro(400, `Não foi possível salvar: ${e.message}`);
    }
    if (ent === 'usuarios' && id && (dados.senha_hash || dados.ativo === 0 || dados.papel)) {
      exec('DELETE FROM sessoes WHERE usuario_id = ? AND usuario_id != ?', id, req.usuario.id);
    }
    const { senha_hash, ...semSenha } = dados;
    auditar(req.usuario.id, `config_${ent}`, { id: Number(id), ...semSenha, senha_alterada: !!senha_hash || undefined });
    res.json({ ok: true, id: Number(id) });
  }
  app.post('/api/admin/:entidade', somenteAdmin, (req, res) => salvar(req, res, null));
  app.put('/api/admin/:entidade/:id', somenteAdmin, (req, res) => salvar(req, res, req.params.id));

  app.get('/api/admin-config', somenteAdmin, (_req, res) => {
    res.json(Object.fromEntries(todos('SELECT * FROM configuracoes').map((c) => [c.chave, c.valor])));
  });
  app.put('/api/admin-config', somenteAdmin, (req, res) => {
    const permitidas = ['nome_motel', 'dias_guardar_placa'];
    for (const k of permitidas) {
      if (req.body?.[k] !== undefined) {
        exec('INSERT INTO configuracoes (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', k, String(req.body[k]));
      }
    }
    auditar(req.usuario.id, 'config_geral', req.body);
    res.json({ ok: true });
  });

  // ---------- Erros ----------
  app.use('/api', (_req, _res, next) => next(new Erro(404, 'Rota não encontrada')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ erro: status === 500 ? 'Erro interno' : err.message });
  });

  return app;
}

// LGPD: depois do prazo, a placa é mascarada (ABC****). Valores continuam para a contabilidade.
function mascararPlacasAntigas(db) {
  const dias = Number(db.prepare("SELECT valor FROM configuracoes WHERE chave = 'dias_guardar_placa'").get()?.valor || 90);
  const limite = new Date(Date.now() - dias * 86400000).toISOString();
  const r = db.prepare(`UPDATE locacoes SET placa = substr(placa, 1, 3) || '****', veiculo = NULL
    WHERE status != 'aberta' AND entrada < ? AND placa IS NOT NULL AND placa NOT LIKE '%*%'`).run(limite);
  db.prepare('DELETE FROM sessoes WHERE criado_em < ?').run(new Date(Date.now() - 86400000).toISOString());
  return r.changes;
}

if (require.main === module) {
  const db = abrir();
  mascararPlacasAntigas(db);
  setInterval(() => mascararPlacasAntigas(db), 6 * 3600 * 1000).unref();
  const porta = Number(process.env.PORT) || 3000;
  criarApp(db).listen(porta, () => console.log(`Sistema do motel rodando em http://localhost:${porta}`));
}

module.exports = { criarApp, mascararPlacasAntigas };
