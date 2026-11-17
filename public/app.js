'use strict';

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-');
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');
const duracao = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const FORMAS = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' };
const STATUS = { livre: 'Livre', ocupado: 'Ocupado', limpeza: 'Limpeza', manutencao: 'Manutenção' };

async function api(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin',
  });
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/login') { estado.usuario = null; render(); }
  if (!r.ok) throw new Error(dados.erro || 'Falha de comunicação');
  return dados;
}

function aviso(msg, erro = false) {
  const el = $('#aviso');
  el.textContent = msg;
  el.className = `aviso${erro ? ' erro' : ''}`;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.add('escondido'), erro ? 5000 : 2500);
}

async function tentar(fn) {
  try { return await fn(); } catch (e) { aviso(e.message, true); return undefined; }
}

function abrirModal(html) { $('#modal-conteudo').innerHTML = html; $('#modal').classList.remove('escondido'); }
function fecharModal() { $('#modal').classList.add('escondido'); $('#modal-conteudo').innerHTML = ''; }

// ---------- Estado ----------
const estado = { usuario: null, aba: 'quartos', painel: null, tabela: null, sub: 'categorias', rel: { de: hojeISO(), ate: hojeISO() } };
const ehGestor = () => ['admin', 'gerente'].includes(estado.usuario?.papel);
const ehRecepcao = () => ['admin', 'gerente', 'atendente'].includes(estado.usuario?.papel);

// ---------- Render principal ----------
function render() {
  const app = $('#app');
  if (!estado.usuario) {
    app.innerHTML = `<div class="login cartao">
      <h2>Entrar</h2>
      <form data-form="login">
        <label>Usuário</label><input name="login" autocomplete="username" autocapitalize="none" required>
        <label>Senha</label><input name="senha" type="password" autocomplete="current-password" required>
        <div class="acoes"><button>Entrar</button></div>
      </form></div>`;
    return;
  }
  const abas = [['quartos', 'Quartos']];
  if (ehRecepcao()) abas.push(['caixa', 'Caixa']);
  if (ehGestor()) abas.push(['relatorios', 'Relatórios']);
  if (estado.usuario.papel === 'admin') abas.push(['config', 'Configurar']);
  app.innerHTML = `
    <header class="topo"><div><b>${esc(estado.usuario.nome_motel || 'Motel')}</b>
      <small>${esc(estado.usuario.nome)} · ${esc(estado.usuario.papel)}</small></div>
      <div style="display:flex;gap:6px"><button data-acao="minha-senha">Senha</button><button data-acao="sair">Sair</button></div></header>
    <main id="conteudo"></main>
    <nav class="abas">${abas.map(([k, n]) => `<button data-aba="${k}" class="${estado.aba === k ? 'ativa' : ''}">${n}</button>`).join('')}</nav>`;
  ({ quartos: telaQuartos, caixa: telaCaixa, relatorios: telaRelatorios, config: telaConfig })[estado.aba]()
    .catch((e) => aviso(e.message, true));
}

// ---------- Quartos ----------
async function telaQuartos() {
  const [painel, tabela] = await Promise.all([api('GET', '/api/painel'), estado.tabela || api('GET', '/api/tabela')]);
  estado.painel = painel; estado.tabela = tabela;
  if (estado.aba !== 'quartos') return;
  const c = $('#conteudo');
  const cont = (s) => painel.quartos.filter((q) => q.status === s).length;
  c.innerHTML = `
    ${ehRecepcao() && !painel.caixa.aberto ? '<div class="alerta">Seu caixa está fechado. Abra o caixa na aba <b>Caixa</b> para poder receber pagamentos.</div>' : ''}
    <div class="legenda">${Object.entries(STATUS).map(([k, n]) => `<span class="${k}">${n}: ${cont(k)}</span>`).join('')}</div>
    <div class="grade">${ordenarQuartos(painel.quartos).map(cartaoQuarto).join('')}</div>`;
}

// A camareira vê primeiro os quartos que precisam de limpeza.
function ordenarQuartos(lista) {
  if (estado.usuario.papel !== 'camareira') return lista;
  return [...lista].sort((a, b) => (b.status === 'limpeza') - (a.status === 'limpeza'));
}

function cartaoQuarto(q) {
  const l = q.locacao;
  let det = '';
  if (l) {
    det = `<div class="det">${l.sem_veiculo ? 'Sem veículo' : `<span class="placa">${esc(l.placa)}</span>`}</div>
      <div class="det">${hora(l.entrada)} → ${hora(l.limite)} · ${esc(l.periodo_nome)}</div>
      <div class="det"><b>${brl(l.total_parcial)}</b></div>`;
  }
  return `<button class="quarto ${q.status} ${l?.vencido ? 'vencido' : ''}" data-acao="quarto" data-id="${q.id}">
    <div class="num">${esc(q.numero)}</div><div class="cat">${esc(q.categoria)}</div>
    <div class="st">${STATUS[q.status]}${l?.vencido ? ' · tempo esgotado' : ''}</div>${det}</button>`;
}

function abrirQuarto(id) {
  const q = estado.painel.quartos.find((x) => x.id === id);
  if (!q) return;
  if (q.status === 'livre') return ehRecepcao() ? modalEntrada(q) : null;
  if (q.status === 'ocupado') return modalOcupado(q);
  if (q.status === 'limpeza') {
    return abrirModal(`<h2>Quarto ${esc(q.numero)}</h2><p>Aguardando limpeza.</p>
      <div class="acoes"><button class="ok" data-acao="status" data-id="${q.id}" data-status="livre">Limpeza concluída: liberar quarto</button></div>`);
  }
  if (q.status === 'manutencao' && ehGestor()) {
    return abrirModal(`<h2>Quarto ${esc(q.numero)}</h2><p>Em manutenção.</p>
      <div class="acoes"><button class="ok" data-acao="status" data-id="${q.id}" data-status="livre">Liberar quarto</button></div>`);
  }
  return undefined;
}

function modalEntrada(q) {
  const cat = estado.tabela.categorias.find((c) => c.id === q.categoria_id);
  const opcoes = (cat?.periodos || []).map((p) => `<button type="button" class="opcao" data-acao="opcao" data-tipo="periodo" data-periodo="${p.id}">
      <b>${esc(p.nome)}</b>${brl(p.preco)}</button>`).join('')
    + (cat?.pernoite_preco > 0 ? `<button type="button" class="opcao" data-acao="opcao" data-tipo="pernoite">
      <b>Pernoite</b>${brl(cat.pernoite_preco)} · até ${esc(cat.pernoite_fim)}</button>` : '');
  abrirModal(`<h2>Entrada · Quarto ${esc(q.numero)}</h2>
    <form data-form="entrada" data-quarto="${q.id}">
      <label>Placa do carro</label>
      <input name="placa" class="placa-input" maxlength="8" placeholder="ABC1D23" autocomplete="off" autocapitalize="characters">
      <label style="display:flex;gap:8px;align-items:center;color:inherit"><input type="checkbox" name="sem_veiculo" style="width:auto;min-height:auto"> Cliente sem veículo (a pé / aplicativo)</label>
      <label>Modelo / cor (opcional)</label><input name="veiculo" maxlength="60" placeholder="Ex.: Onix prata">
      <label>Período</label><div class="opcoes">${opcoes}</div>
      <input type="hidden" name="tipo"><input type="hidden" name="periodo_id">
      <p style="font-size:13px;color:#6b7280">Tolerância de ${cat?.tolerancia_min ?? 0} min. Hora adicional: ${brl(cat?.hora_adicional)}.</p>
      <div class="acoes"><button>Confirmar entrada</button></div>
    </form>`);
}

async function modalOcupado(q) {
  const conta = await tentar(() => api('GET', `/api/locacoes/${q.locacao.id}/conta`));
  if (!conta) return;
  const l = q.locacao;
  abrirModal(`<h2>Quarto ${esc(q.numero)} · ${esc(l.periodo_nome)}</h2>
    <p>${l.sem_veiculo ? 'Sem veículo' : `<span class="placa">${esc(l.placa)}</span>`} ${esc(l.veiculo || '')}<br>
      Entrada ${hora(conta.entrada)} · Limite ${hora(conta.limite)} · Permanência ${duracao(conta.minutos)}</p>
    ${tabelaConta(conta, true)}
    <div class="acoes">
      <button class="sec" data-acao="consumo" data-loc="${l.id}">+ Consumo</button>
      ${ehRecepcao() ? `<button class="ok" data-acao="fechar-conta" data-loc="${l.id}">Fechar conta</button>` : ''}
    </div>
    ${ehRecepcao() ? `<div class="acoes"><button class="sec" data-acao="cancelar" data-loc="${l.id}">Cancelar locação (gerente)</button></div>` : ''}`);
}

function tabelaConta(conta, comEstorno) {
  const linhas = conta.consumos.map((c) => `<tr><td>${c.quantidade}× ${esc(c.nome)}
      ${comEstorno && ehRecepcao() ? `<button class="sec" style="min-height:28px;padding:2px 8px;font-size:12px" data-acao="estornar" data-id="${c.id}">estornar</button>` : ''}</td>
    <td class="n">${brl(c.quantidade * c.preco_unit)}</td></tr>`).join('');
  return `<table class="conta">
    <tr><td>Período</td><td class="n">${brl(conta.preco_base)}</td></tr>
    ${conta.horas_adicionais ? `<tr><td>${conta.horas_adicionais} hora(s) adicional(is)</td><td class="n">${brl(conta.valor_adicional)}</td></tr>` : ''}
    ${linhas}
    ${conta.desconto ? `<tr><td>Desconto</td><td class="n neg">-${brl(conta.desconto)}</td></tr>` : ''}
    <tr class="total"><td>Total${conta.status === 'aberta' || !conta.status ? ' até agora' : ''}</td><td class="n">${brl(conta.total)}</td></tr>
  </table>`;
}

function modalConsumo(locId) {
  abrirModal(`<h2>Lançar consumo</h2>
    <form data-form="consumo" data-loc="${locId}">
      <label>Quantidade</label><input name="quantidade" type="number" min="1" max="50" value="1" inputmode="numeric">
      <label>Item</label>
      <div class="opcoes">${estado.tabela.produtos.map((p) => `<button type="submit" class="opcao" name="produto_id" value="${p.id}">
        <b>${esc(p.nome)}</b>${brl(p.preco)}</button>`).join('')}</div>
    </form>`);
}

async function modalFecharConta(locId) {
  const conta = await tentar(() => api('GET', `/api/locacoes/${locId}/conta`));
  if (!conta) return;
  abrirModal(`<h2>Fechar conta · Quarto ${esc(conta.quarto)}</h2>
    <p>Saída ${hora(conta.saida)} · Permanência ${duracao(conta.minutos)}</p>
    ${tabelaConta(conta, false)}
    <form data-form="fechar" data-loc="${locId}" data-total="${conta.total}">
      <details><summary style="margin-top:12px;color:#2563eb">Dar desconto (precisa de gerente)</summary>
        <label>Valor do desconto (R$)</label><input name="desconto" type="number" step="0.01" min="0" inputmode="decimal">
        <label>Motivo</label><input name="desconto_motivo">
        <div class="linha"><div><label>Login do gerente</label><input name="ger_login" autocapitalize="none"></div>
        <div><label>Senha do gerente</label><input name="ger_senha" type="password"></div></div>
      </details>
      <h3>Pagamento · <span id="a-pagar">${brl(conta.total)}</span></h3>
      ${Object.entries(FORMAS).map(([k, n]) => `<div class="linha" style="align-items:center"><span>${n}</span>
        <input name="pg_${k}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00"></div>`).join('')}
      <p style="font-size:13px;color:#6b7280">Dica: toque numa forma para preencher o valor todo nela.</p>
      <div class="opcoes">${Object.entries(FORMAS).map(([k, n]) => `<button type="button" class="opcao" data-acao="pagar-tudo" data-forma="${k}"><b>Tudo em ${n}</b></button>`).join('')}</div>
      <div class="acoes"><button class="ok">Confirmar pagamento e liberar para limpeza</button></div>
    </form>`);
}

function totalComDesconto(form) {
  return Math.round((Number(form.dataset.total) - (Number(form.desconto.value) || 0)) * 100) / 100;
}

function modalCancelar(locId) {
  abrirModal(`<h2>Cancelar locação</h2><div class="alerta">O cancelamento fica registrado e aparece no relatório do dono.</div>
    <form data-form="cancelar" data-loc="${locId}">
      <label>Motivo</label><input name="motivo" required>
      <div class="linha"><div><label>Login do gerente</label><input name="ger_login" autocapitalize="none" required></div>
      <div><label>Senha do gerente</label><input name="ger_senha" type="password" required></div></div>
      <div class="acoes"><button class="perigo">Confirmar cancelamento</button></div></form>`);
}

function modalEstornar(consumoId) {
  abrirModal(`<h2>Estornar consumo</h2>
    <form data-form="estornar" data-id="${consumoId}">
      <label>Motivo</label><input name="motivo" required>
      <div class="linha"><div><label>Login do gerente</label><input name="ger_login" autocapitalize="none" required></div>
      <div><label>Senha do gerente</label><input name="ger_senha" type="password" required></div></div>
      <div class="acoes"><button class="perigo">Estornar</button></div></form>`);
}

// ---------- Caixa ----------
async function telaCaixa() {
  const cx = await api('GET', '/api/caixa');
  if (estado.aba !== 'caixa') return;
  const c = $('#conteudo');
  if (!cx.aberto) {
    c.innerHTML = `<div class="cartao"><h2>Abrir caixa</h2>
      <p>Conte o dinheiro de troco que está na gaveta.</p>
      <form data-form="abrir-caixa"><label>Troco inicial (R$)</label>
        <input name="valor_inicial" type="number" step="0.01" min="0" inputmode="decimal" required>
        <div class="acoes"><button>Abrir caixa</button></div></form></div>`;
    return;
  }
  c.innerHTML = `<div class="cartao"><h2>Caixa aberto às ${hora(cx.aberto_em)}</h2>
      <p>Troco inicial ${brl(cx.valor_inicial)} · ${cx.locacoes} locação(ões) recebida(s)</p>
      ${cx.porForma.length ? `<table>${cx.porForma.map((f) => `<tr><td>${FORMAS[f.forma]}</td><td class="n">${brl(f.total)}</td></tr>`).join('')}</table>` : ''}
      ${cx.esperadoDinheiro !== undefined ? `<p>Dinheiro esperado na gaveta: <b>${brl(cx.esperadoDinheiro)}</b></p>` : ''}
    </div>
    <div class="cartao"><h3 style="margin-top:0">Sangria / suprimento</h3>
      <form data-form="movimento"><div class="linha">
        <div><label>Tipo</label><select name="tipo"><option value="sangria">Sangria (retirada)</option><option value="suprimento">Suprimento (entrada)</option></select></div>
        <div><label>Valor (R$)</label><input name="valor" type="number" step="0.01" min="0.01" inputmode="decimal" required></div></div>
        <label>Motivo</label><input name="motivo" required>
        <div class="acoes"><button class="sec">Registrar</button></div></form>
      ${cx.movimentos.length ? `<table>${cx.movimentos.map((m) => `<tr><td>${hora(m.criado_em)}</td><td>${m.tipo}</td><td>${esc(m.motivo)}</td><td class="n">${brl(m.valor)}</td></tr>`).join('')}</table>` : ''}
    </div>
    <div class="cartao"><h3 style="margin-top:0">Fechar caixa (fim do turno)</h3>
      <p>Conte todo o dinheiro da gaveta e informe o valor. Pix e cartão são conferidos pelo sistema.</p>
      <form data-form="fechar-caixa"><label>Dinheiro contado (R$)</label>
        <input name="valor_contado" type="number" step="0.01" min="0" inputmode="decimal" required>
        <div class="acoes"><button class="perigo">Fechar caixa</button></div></form></div>`;
}

// ---------- Relatórios ----------
function barras(lista, rotulo = (x) => x.chave) {
  const max = Math.max(1, ...lista.map((x) => x.total));
  return `<table>${lista.map((x) => `<tr><td style="width:30%">${esc(rotulo(x))}</td>
    <td><div class="barra" style="width:${(x.total / max) * 100}%"></div></td>
    <td class="n" style="width:28%">${brl(x.total)}<br><small>${x.locacoes} loc.</small></td></tr>`).join('') || '<tr><td>Sem dados</td></tr>'}</table>`;
}

async function telaRelatorios() {
  const { de, ate, placa } = estado.rel;
  const qs = `de=${de}&ate=${ate}`;
  const [r, caixas, locs] = await Promise.all([
    api('GET', `/api/relatorios/resumo?${qs}`),
    api('GET', `/api/relatorios/caixas?${qs}`),
    api('GET', `/api/relatorios/locacoes?${qs}${placa ? `&placa=${encodeURIComponent(placa)}` : ''}`),
  ]);
  if (estado.aba !== 'relatorios') return;
  $('#conteudo').innerHTML = `
    <form data-form="periodo-rel" class="cartao"><div class="linha">
      <div><label>De</label><input type="date" name="de" value="${de}"></div>
      <div><label>Até</label><input type="date" name="ate" value="${ate}"></div>
      <button>Atualizar</button></div></form>
    <div class="kpis">
      <div class="kpi"><small>Faturamento</small><b>${brl(r.faturamento)}</b></div>
      <div class="kpi"><small>Locações</small><b>${r.locacoes}</b></div>
      <div class="kpi"><small>Ticket médio</small><b>${brl(r.ticket_medio)}</b></div>
      <div class="kpi"><small>Consumo</small><b>${brl(r.consumo)}</b></div>
      <div class="kpi"><small>Permanência média</small><b>${duracao(r.permanencia_media_min)}</b></div>
      <div class="kpi"><small>Ocupação</small><b>${r.ocupacao_pct}%</b></div>
      <div class="kpi"><small>Descontos</small><b>${brl(r.descontos)}</b></div>
      <div class="kpi"><small>Quartos ocupados agora</small><b>${r.em_aberto}</b></div>
    </div>
    <div class="cartao"><h3 style="margin-top:0">Por dia</h3>${barras(r.por_dia, (x) => x.chave.split('-').reverse().join('/'))}</div>
    <div class="cartao"><h3 style="margin-top:0">Por forma de pagamento</h3>${barras(r.por_forma, (x) => FORMAS[x.chave])}</div>
    <div class="cartao"><h3 style="margin-top:0">Por atendente (quem recebeu)</h3>${barras(r.por_atendente)}</div>
    <div class="cartao"><h3 style="margin-top:0">Por quarto</h3>${barras(r.por_quarto, (x) => `Quarto ${x.chave}`)}</div>
    <div class="cartao"><h3 style="margin-top:0">Horário de entrada (pico)</h3>${barras(r.por_hora_entrada, (x) => `${x.chave}h`)}</div>
    <div class="cartao"><h3 style="margin-top:0">Fechamentos de caixa</h3><div class="rolagem"><table>
      <tr><th>Atendente</th><th>Abertura</th><th>Fechamento</th><th class="n">Esperado</th><th class="n">Contado</th><th class="n">Diferença</th></tr>
      ${caixas.map((c) => `<tr><td>${esc(c.atendente)}</td><td>${dataHora(c.aberto_em)}</td><td>${c.fechado_em ? dataHora(c.fechado_em) : '<b>aberto</b>'}</td>
        <td class="n">${c.fechado_em ? brl(c.esperado_dinheiro) : '-'}</td><td class="n">${c.fechado_em ? brl(c.valor_contado) : '-'}</td>
        <td class="n ${c.diferenca < 0 ? 'neg' : c.diferenca > 0 ? 'pos' : ''}">${c.fechado_em ? brl(c.diferenca) : '-'}</td></tr>`).join('')}
    </table></div></div>
    <div class="cartao"><h3 style="margin-top:0">Descontos e cancelamentos</h3><div class="rolagem"><table>
      ${r.com_desconto.map((d) => `<tr><td>Desconto</td><td>Quarto ${esc(d.quarto)}</td><td>${esc(d.motivo)}</td><td>${esc(d.atendente)}</td><td class="n">${brl(d.desconto)}</td></tr>`).join('')}
      ${r.canceladas.map((d) => `<tr><td>Cancelada</td><td>Quarto ${esc(d.quarto)}</td><td>${esc(d.motivo)}</td><td>${esc(d.atendente)}</td><td class="n">${dataHora(d.entrada)}</td></tr>`).join('')}
      ${!r.com_desconto.length && !r.canceladas.length ? '<tr><td>Nenhum no período</td></tr>' : ''}
    </table></div></div>
    <div class="cartao"><h3 style="margin-top:0">Locações</h3>
      <form data-form="busca-placa" class="linha"><div><input name="placa" placeholder="Buscar por placa" value="${esc(placa || '')}" class="placa-input" style="font-size:16px"></div><button class="sec">Buscar</button></form>
      <div class="rolagem"><table>
      <tr><th>Quarto</th><th>Placa</th><th>Entrada</th><th>Saída</th><th>Tipo</th><th class="n">Total</th><th>Status</th></tr>
      ${locs.map((l) => `<tr><td>${esc(l.quarto)}</td><td>${l.placa ? `<span class="placa">${esc(l.placa)}</span>` : '-'}</td>
        <td>${dataHora(l.entrada)}</td><td>${dataHora(l.saida)}</td><td>${esc(l.periodo_nome)}${l.horas_adicionais ? ` +${l.horas_adicionais}h` : ''}</td>
        <td class="n">${l.total != null ? brl(l.total) : '-'}</td><td>${l.status}</td></tr>`).join('')}
    </table></div></div>
    <div class="acoes"><button class="sec" data-acao="auditoria">Ver registro de ações (auditoria)</button></div>`;
}

async function modalAuditoria() {
  const lista = await tentar(() => api('GET', `/api/relatorios/auditoria?de=${estado.rel.de}&ate=${estado.rel.ate}`));
  if (!lista) return;
  abrirModal(`<h2>Registro de ações</h2><div class="rolagem"><table>
    ${lista.map((a) => `<tr><td>${dataHora(a.criado_em)}</td><td>${esc(a.usuario || '-')}</td><td>${esc(a.acao)}</td>
      <td style="font-size:12px;word-break:break-word">${esc(a.detalhe || '')}</td></tr>`).join('')}</table></div>`);
}

// ---------- Configuração (admin) ----------
const CONFIG = {
  categorias: { titulo: 'Categorias e preços', campos: [
    ['nome', 'Nome', 'text'], ['hora_adicional', 'Hora adicional R$', 'number'], ['tolerancia_min', 'Tolerância (min)', 'number'],
    ['pernoite_preco', 'Pernoite R$ (0 = não vende)', 'number'], ['pernoite_inicio', 'Pernoite vende a partir de', 'time'],
    ['pernoite_fim_venda', 'Pernoite vende até', 'time'], ['pernoite_fim', 'Pernoite termina às', 'time'], ['ativo', 'Ativo', 'bool']] },
  periodos: { titulo: 'Períodos', campos: [['categoria_id', 'Categoria', 'categoria'], ['nome', 'Nome', 'text'],
    ['minutos', 'Duração (min)', 'number'], ['preco', 'Preço R$', 'number'], ['ativo', 'Ativo', 'bool']] },
  quartos: { titulo: 'Quartos', campos: [['numero', 'Número', 'text'], ['categoria_id', 'Categoria', 'categoria'], ['ativo', 'Ativo', 'bool']] },
  produtos: { titulo: 'Cardápio / frigobar', campos: [['nome', 'Nome', 'text'], ['preco', 'Preço R$', 'number'], ['ativo', 'Ativo', 'bool']] },
  usuarios: { titulo: 'Usuários', campos: [['nome', 'Nome', 'text'], ['login', 'Login', 'text'], ['papel', 'Função', 'papel'],
    ['senha', 'Nova senha', 'password'], ['ativo', 'Ativo', 'bool']] },
};

async function telaConfig() {
  const sub = estado.sub;
  const abas = `<div class="sub-abas">${[...Object.entries(CONFIG).map(([k, v]) => [k, v.titulo]), ['geral', 'Geral']]
    .map(([k, n]) => `<button data-sub="${k}" class="${sub === k ? 'ativa' : ''}">${n}</button>`).join('')}</div>`;
  if (sub === 'geral') {
    const cfg = await api('GET', '/api/admin-config');
    $('#conteudo').innerHTML = `${abas}<div class="cartao"><form data-form="config-geral">
      <label>Nome do motel</label><input name="nome_motel" value="${esc(cfg.nome_motel)}">
      <label>Dias para guardar a placa (depois disso ela é mascarada, LGPD)</label>
      <input name="dias_guardar_placa" type="number" min="1" value="${esc(cfg.dias_guardar_placa)}">
      <div class="acoes"><button>Salvar</button></div></form></div>`;
    return;
  }
  const def = CONFIG[sub];
  const [linhas, categorias] = await Promise.all([api('GET', `/api/admin/${sub}`), api('GET', '/api/admin/categorias')]);
  if (estado.aba !== 'config' || estado.sub !== sub) return;
  const campo = (c, v) => {
    const [nome, , tipo] = c;
    if (tipo === 'bool') return `<select name="${nome}"><option value="1" ${v ? 'selected' : ''}>Sim</option><option value="0" ${v === 0 ? 'selected' : ''}>Não</option></select>`;
    if (tipo === 'categoria') return `<select name="${nome}">${categorias.map((k) => `<option value="${k.id}" ${k.id === v ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select>`;
    if (tipo === 'papel') return `<select name="${nome}">${['atendente', 'camareira', 'gerente', 'admin'].map((p) => `<option ${p === v ? 'selected' : ''}>${p}</option>`).join('')}</select>`;
    if (tipo === 'password') return `<input name="${nome}" type="password" placeholder="${v === undefined ? 'obrigatória' : 'manter'}" autocomplete="new-password">`;
    return `<input name="${nome}" type="${tipo}" ${tipo === 'number' ? 'step="0.01"' : ''} value="${esc(v ?? '')}">`;
  };
  const linha = (r) => `<tr data-linha="${r.id ?? 'novo'}">${def.campos.map((c) => `<td>${campo(c, r[c[0]])}</td>`).join('')}
      <td><button data-acao="salvar-linha" data-id="${r.id ?? ''}">${r.id ? 'Salvar' : 'Adicionar'}</button></td></tr>`;
  $('#conteudo').innerHTML = `${abas}<div class="cartao"><h2>${def.titulo}</h2>
    ${sub === 'periodos' || sub === 'categorias' ? '<p style="font-size:13px;color:#6b7280">Mudança de preço vale para as próximas entradas. Quartos já ocupados mantêm o preço da entrada.</p>' : ''}
    <div class="rolagem"><table><tr>${def.campos.map((c) => `<th>${c[1]}</th>`).join('')}<th></th></tr>
    ${linhas.map(linha).join('')}${linha({ ativo: 1 })}</table></div></div>`;
}

async function salvarLinha(id) {
  const tr = document.querySelector(`tr[data-linha="${id || 'novo'}"]`);
  const def = CONFIG[estado.sub];
  const corpo = {};
  for (const [nome, , tipo] of def.campos) {
    const el = tr.querySelector(`[name="${nome}"]`);
    if (tipo === 'password') { if (el.value) corpo.senha = el.value; continue; }
    corpo[nome] = ['number', 'bool', 'categoria'].includes(tipo) ? Number(el.value) : el.value;
  }
  if (estado.sub === 'periodos' || estado.sub === 'quartos') corpo.categoria_id = Number(corpo.categoria_id);
  const ok = await tentar(() => api(id ? 'PUT' : 'POST', `/api/admin/${estado.sub}${id ? `/${id}` : ''}`, corpo));
  if (ok) { aviso('Salvo'); estado.tabela = null; telaConfig(); }
}

// ---------- Eventos ----------
document.addEventListener('click', async (ev) => {
  const alvo = ev.target.closest('[data-acao],[data-aba],[data-sub]');
  if (!alvo) { if (ev.target.id === 'modal') fecharModal(); return; }
  if (alvo.dataset.aba) { estado.aba = alvo.dataset.aba; render(); return; }
  if (alvo.dataset.sub) { estado.sub = alvo.dataset.sub; telaConfig().catch((e) => aviso(e.message, true)); return; }
  const d = alvo.dataset;
  switch (d.acao) {
    case 'fechar-modal': fecharModal(); break;
    case 'sair': await tentar(() => api('POST', '/api/logout')); estado.usuario = null; render(); break;
    case 'quarto': abrirQuarto(Number(d.id)); break;
    case 'opcao': {
      const form = alvo.closest('form');
      form.querySelectorAll('.opcao').forEach((b) => b.classList.remove('sel'));
      alvo.classList.add('sel');
      form.tipo.value = d.tipo; form.periodo_id.value = d.periodo || '';
      break;
    }
    case 'consumo': modalConsumo(Number(d.loc)); break;
    case 'fechar-conta': modalFecharConta(Number(d.loc)); break;
    case 'cancelar': modalCancelar(Number(d.loc)); break;
    case 'estornar': modalEstornar(Number(d.id)); break;
    case 'pagar-tudo': {
      const form = alvo.closest('form');
      Object.keys(FORMAS).forEach((k) => { form[`pg_${k}`].value = ''; });
      form[`pg_${d.forma}`].value = totalComDesconto(form).toFixed(2);
      break;
    }
    case 'status':
      if (await tentar(() => api('POST', `/api/quartos/${d.id}/status`, { status: d.status }))) { fecharModal(); telaQuartos(); }
      break;
    case 'auditoria': modalAuditoria(); break;
    case 'minha-senha':
      abrirModal(`<h2>Trocar minha senha</h2><form data-form="minha-senha">
        <label>Senha atual</label><input name="atual" type="password" autocomplete="current-password" required>
        <label>Nova senha (mínimo 6)</label><input name="nova" type="password" minlength="6" autocomplete="new-password" required>
        <div class="acoes"><button>Salvar</button></div></form>`);
      break;
    case 'salvar-linha': salvarLinha(d.id ? Number(d.id) : null); break;
    default:
  }
});

document.addEventListener('input', (ev) => {
  const form = ev.target.closest('form[data-form="fechar"]');
  if (form && ev.target.name === 'desconto') $('#a-pagar').textContent = brl(totalComDesconto(form));
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const f = form.elements;
  const botao = ev.submitter;
  if (botao) botao.disabled = true;
  try {
    switch (form.dataset.form) {
      case 'login': {
        await tentar(async () => {
          await api('POST', '/api/login', { login: f.login.value.trim(), senha: f.senha.value });
          estado.usuario = await api('GET', '/api/eu');
          estado.aba = 'quartos'; render();
        });
        break;
      }
      case 'entrada': {
        if (!f.tipo.value) { aviso('Escolha o período', true); break; }
        const ok = await tentar(() => api('POST', '/api/locacoes', {
          quarto_id: Number(form.dataset.quarto), placa: f.placa.value, sem_veiculo: f.sem_veiculo.checked,
          veiculo: f.veiculo.value, tipo: f.tipo.value, periodo_id: Number(f.periodo_id.value) || null,
        }));
        if (ok) { fecharModal(); aviso('Entrada registrada'); telaQuartos(); }
        break;
      }
      case 'consumo': {
        const ok = await tentar(() => api('POST', `/api/locacoes/${form.dataset.loc}/consumos`, {
          produto_id: Number(botao.value), quantidade: Number(f.quantidade.value),
        }));
        if (ok) { fecharModal(); aviso('Consumo lançado'); await telaQuartos(); }
        break;
      }
      case 'fechar': {
        const pagamentos = Object.keys(FORMAS).map((k) => ({ forma: k, valor: Number(f[`pg_${k}`].value) || 0 })).filter((p) => p.valor > 0);
        const desconto = Number(f.desconto.value) || 0;
        const ok = await tentar(() => api('POST', `/api/locacoes/${form.dataset.loc}/fechar`, {
          pagamentos, desconto, desconto_motivo: f.desconto_motivo.value,
          autorizacao: desconto ? { login: f.ger_login.value, senha: f.ger_senha.value } : undefined,
        }));
        if (ok) { fecharModal(); aviso(`Conta fechada: ${brl(ok.total)}`); telaQuartos(); }
        break;
      }
      case 'cancelar': {
        const ok = await tentar(() => api('POST', `/api/locacoes/${form.dataset.loc}/cancelar`, {
          motivo: f.motivo.value, autorizacao: { login: f.ger_login.value, senha: f.ger_senha.value },
        }));
        if (ok) { fecharModal(); aviso('Locação cancelada'); telaQuartos(); }
        break;
      }
      case 'estornar': {
        const ok = await tentar(() => api('POST', `/api/consumos/${form.dataset.id}/estornar`, {
          motivo: f.motivo.value, autorizacao: { login: f.ger_login.value, senha: f.ger_senha.value },
        }));
        if (ok) { fecharModal(); aviso('Consumo estornado'); telaQuartos(); }
        break;
      }
      case 'abrir-caixa':
        if (await tentar(() => api('POST', '/api/caixa/abrir', { valor_inicial: Number(f.valor_inicial.value) }))) { aviso('Caixa aberto'); telaCaixa(); }
        break;
      case 'movimento':
        if (await tentar(() => api('POST', '/api/caixa/movimento', { tipo: f.tipo.value, valor: Number(f.valor.value), motivo: f.motivo.value }))) { aviso('Registrado'); telaCaixa(); }
        break;
      case 'fechar-caixa': {
        if (!confirm('Fechar o caixa agora?')) break;
        const ok = await tentar(() => api('POST', '/api/caixa/fechar', { valor_contado: Number(f.valor_contado.value) }));
        if (ok) { aviso(ok.diferenca !== undefined ? `Caixa fechado. Diferença: ${brl(ok.diferenca)}` : 'Caixa fechado'); telaCaixa(); }
        break;
      }
      case 'minha-senha':
        if (await tentar(() => api('POST', '/api/minha-senha', { atual: f.atual.value, nova: f.nova.value }))) { fecharModal(); aviso('Senha alterada'); }
        break;
      case 'periodo-rel':
        estado.rel.de = f.de.value; estado.rel.ate = f.ate.value || f.de.value; telaRelatorios();
        break;
      case 'busca-placa':
        estado.rel.placa = f.placa.value.trim(); telaRelatorios();
        break;
      case 'config-geral':
        if (await tentar(() => api('PUT', '/api/admin-config', { nome_motel: f.nome_motel.value, dias_guardar_placa: f.dias_guardar_placa.value }))) {
          aviso('Salvo'); estado.usuario = await api('GET', '/api/eu');
        }
        break;
      default:
    }
  } finally {
    if (botao && document.body.contains(botao)) botao.disabled = false;
  }
});

// Atualiza o mapa de quartos sozinho a cada 20 segundos (sem atrapalhar se houver janela aberta).
setInterval(() => {
  if (estado.usuario && estado.aba === 'quartos' && $('#modal').classList.contains('escondido') && !document.hidden) {
    telaQuartos().catch(() => {});
  }
}, 20000);

(async () => {
  try { estado.usuario = await api('GET', '/api/eu'); } catch { estado.usuario = null; }
  render();
})();
