// Regras de cobrança do motel. Funções puras (sem banco) para poder testar.

const MIN = 60 * 1000;

function hhmmParaMinutos(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

// Próximo horário "HH:MM" (hora local) a partir de uma data.
// Ex.: entrada 22:00 e fim do pernoite 12:00 -> 12:00 do dia seguinte.
function proximoHorario(aPartirDe, hhmm) {
  const alvo = new Date(aPartirDe);
  const min = hhmmParaMinutos(hhmm);
  alvo.setHours(Math.floor(min / 60), min % 60, 0, 0);
  if (alvo <= aPartirDe) alvo.setDate(alvo.getDate() + 1);
  return alvo;
}

// Horas adicionais: só cobra se passar da tolerância; depois conta cada hora iniciada
// a partir do fim do período.
function horasAdicionais(limite, saida, toleranciaMin) {
  const excedenteMin = (saida - limite) / MIN;
  if (excedenteMin <= toleranciaMin) return 0;
  return Math.ceil(excedenteMin / 60);
}

/**
 * Calcula o valor do quarto.
 * @param {object} p
 * @param {'periodo'|'pernoite'} p.tipo
 * @param {{minutos:number, preco:number}} [p.periodo]
 * @param {{hora_adicional:number, tolerancia_min:number, pernoite_preco:number, pernoite_fim:string}} p.categoria
 * @param {Date} p.entrada
 * @param {Date} p.saida
 * @returns {{base:number, horasAdicionais:number, valorAdicional:number, total:number, limite:Date, minutosPermanencia:number}}
 */
function calcularValorQuarto({ tipo, periodo, categoria, entrada, saida }) {
  entrada = new Date(entrada);
  saida = new Date(saida);
  let base;
  let limite;
  if (tipo === 'pernoite') {
    base = Number(categoria.pernoite_preco);
    limite = proximoHorario(entrada, categoria.pernoite_fim);
  } else {
    if (!periodo) throw new Error('Período não informado');
    base = Number(periodo.preco);
    limite = new Date(entrada.getTime() + periodo.minutos * MIN);
  }
  const horas = horasAdicionais(limite, saida, Number(categoria.tolerancia_min) || 0);
  const valorAdicional = horas * Number(categoria.hora_adicional);
  return {
    base: centavos(base),
    horasAdicionais: horas,
    valorAdicional: centavos(valorAdicional),
    total: centavos(base + valorAdicional),
    limite,
    minutosPermanencia: Math.max(0, Math.round((saida - entrada) / MIN)),
  };
}

// Pernoite só pode ser vendido dentro da janela configurada (ex.: 20:00 até 06:00).
function pernoitePermitido(agora, inicio, fimVenda) {
  const m = agora.getHours() * 60 + agora.getMinutes();
  const i = hhmmParaMinutos(inicio);
  const f = hhmmParaMinutos(fimVenda);
  return i <= f ? m >= i && m <= f : m >= i || m <= f;
}

function centavos(v) {
  return Math.round(Number(v) * 100) / 100;
}

// Aceita placa antiga (ABC1234) e Mercosul (ABC1D23). Retorna normalizada ou null.
function normalizarPlaca(placa) {
  const p = String(placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p) ? p : null;
}

module.exports = {
  calcularValorQuarto,
  horasAdicionais,
  pernoitePermitido,
  proximoHorario,
  normalizarPlaca,
  centavos,
};
