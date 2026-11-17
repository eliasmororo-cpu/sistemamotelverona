process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert');
const { abrir } = require('../src/db');
const { criarApp, mascararPlacasAntigas } = require('../src/server');

let server; let base; let db;

function cliente() {
  let cookie = '';
  return async (metodo, url, corpo) => {
    const r = await fetch(base + url, {
      method: metodo, headers: { 'Content-Type': 'application/json', cookie }, body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
}

test.before(async () => {
  db = abrir(':memory:');
  server = criarApp(db).listen(0);
  await new Promise((ok) => server.once('listening', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('fluxo completo: entrada, consumo, fechamento, caixa e relatório', async () => {
  const admin = cliente();
  assert.equal((await admin('POST', '/api/login', { login: 'admin', senha: 'errada' })).status, 401);
  assert.equal((await admin('POST', '/api/login', { login: 'admin', senha: 'admin123' })).status, 200);
  assert.equal((await admin('POST', '/api/admin/usuarios', { nome: 'Ana', login: 'ana', papel: 'atendente', senha: 'ana123' })).status, 200);
  assert.equal((await admin('POST', '/api/admin/usuarios', { nome: 'Gerente', login: 'ger', papel: 'gerente', senha: 'ger123' })).status, 200);

  const ana = cliente();
  await ana('POST', '/api/login', { login: 'ana', senha: 'ana123' });
  assert.equal((await ana('GET', '/api/relatorios/resumo')).status, 403, 'atendente não vê relatórios');
  assert.equal((await ana('GET', '/api/admin/usuarios')).status, 403, 'atendente não configura');

  const painel = (await ana('GET', '/api/painel')).body;
  const quarto = painel.quartos[0];
  const tabela = (await ana('GET', '/api/tabela')).body;
  const periodo = tabela.categorias.find((c) => c.id === quarto.categoria_id).periodos[0];

  assert.equal((await ana('POST', '/api/locacoes', { quarto_id: quarto.id, placa: 'XX1', tipo: 'periodo', periodo_id: periodo.id })).status, 400);
  const loc = await ana('POST', '/api/locacoes', { quarto_id: quarto.id, placa: 'abc-1d23', tipo: 'periodo', periodo_id: periodo.id });
  assert.equal(loc.status, 201); assert.equal(loc.body.placa, 'ABC1D23');
  assert.equal((await ana('POST', '/api/locacoes', { quarto_id: quarto.id, placa: 'DEF1234', tipo: 'periodo', periodo_id: periodo.id })).status, 409, 'quarto ocupado');
  assert.equal((await ana('POST', '/api/locacoes', { quarto_id: painel.quartos[1].id, placa: 'ABC1D23', tipo: 'periodo', periodo_id: periodo.id })).status, 409, 'placa repetida');

  // Mudança de preço com o quarto ocupado não altera a conta
  await admin('PUT', `/api/admin/periodos/${periodo.id}`, { preco: 999 });

  const prod = tabela.produtos[0];
  const cons = await ana('POST', `/api/locacoes/${loc.body.id}/consumos`, { produto_id: prod.id, quantidade: 2 });
  assert.equal(cons.body.total, periodo.preco + 2 * prod.preco);

  const total = periodo.preco + 2 * prod.preco;
  assert.equal((await ana('POST', `/api/locacoes/${loc.body.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: total }] })).status, 409, 'sem caixa aberto');
  await ana('POST', '/api/caixa/abrir', { valor_inicial: 50 });
  assert.equal((await ana('POST', `/api/locacoes/${loc.body.id}/fechar`, { pagamentos: [{ forma: 'pix', valor: 1 }] })).status, 400, 'valor não bate');
  assert.equal((await ana('POST', `/api/locacoes/${loc.body.id}/fechar`, {
    pagamentos: [{ forma: 'dinheiro', valor: total - 5 }], desconto: 5, desconto_motivo: 'cliente fiel',
  })).status, 403, 'desconto sem gerente');
  const fechou = await ana('POST', `/api/locacoes/${loc.body.id}/fechar`, {
    pagamentos: [{ forma: 'dinheiro', valor: total - 5 }], desconto: 5, desconto_motivo: 'cliente fiel', autorizacao: { login: 'ger', senha: 'ger123' },
  });
  assert.equal(fechou.status, 200); assert.equal(fechou.body.total, total - 5);
  assert.equal((await ana('GET', '/api/painel')).body.quartos[0].status, 'limpeza');

  // Fechamento cego: atendente não vê o esperado
  const cx = (await ana('GET', '/api/caixa')).body;
  assert.equal(cx.esperadoDinheiro, undefined);
  const fechaCaixa = await ana('POST', '/api/caixa/fechar', { valor_contado: 50 + total - 5 - 10 });
  assert.equal(fechaCaixa.body.diferenca, undefined);

  assert.equal((await ana('POST', `/api/quartos/${quarto.id}/status`, { status: 'livre' })).status, 200);

  const rel = (await admin('GET', '/api/relatorios/resumo')).body;
  assert.equal(rel.locacoes, 1); assert.equal(rel.faturamento, total - 5); assert.equal(rel.descontos, 5);
  const caixas = (await admin('GET', '/api/relatorios/caixas')).body;
  assert.equal(caixas[0].diferenca, -10, 'faltou 10 reais no caixa');
  const busca = (await admin('GET', '/api/relatorios/locacoes?placa=ABC1D23')).body;
  assert.equal(busca.length, 1);
  const aud = (await admin('GET', '/api/relatorios/auditoria')).body;
  assert.ok(aud.some((a) => a.acao === 'locacao_fechada'));
});

test('placas antigas são mascaradas (LGPD)', () => {
  db.prepare("UPDATE locacoes SET entrada = '2020-01-01T00:00:00.000Z' WHERE status = 'fechada'").run();
  assert.ok(mascararPlacasAntigas(db) >= 1);
  const l = db.prepare("SELECT placa FROM locacoes WHERE status = 'fechada'").get();
  assert.equal(l.placa, 'ABC****');
});

test('cada usuário troca a própria senha e as outras sessões caem', async () => {
  const a1 = cliente(); const a2 = cliente();
  await a1('POST', '/api/login', { login: 'ana', senha: 'ana123' });
  await a2('POST', '/api/login', { login: 'ana', senha: 'ana123' });
  assert.equal((await a1('POST', '/api/minha-senha', { atual: 'errada', nova: 'nova123' })).status, 400);
  assert.equal((await a1('POST', '/api/minha-senha', { atual: 'ana123', nova: 'nova123' })).status, 200);
  assert.equal((await a1('GET', '/api/eu')).status, 200, 'aparelho atual continua logado');
  assert.equal((await a2('GET', '/api/eu')).status, 401, 'outro aparelho foi desconectado');
});
