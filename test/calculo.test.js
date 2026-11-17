process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert');
const calc = require('../src/calculo');

const cat = { hora_adicional: 20, tolerancia_min: 15, pernoite_preco: 150, pernoite_fim: '12:00' };
const per2h = { minutos: 120, preco: 60 };
const d = (s) => new Date(s);

test('período sem passar do tempo cobra só o período', () => {
  const r = calc.calcularValorQuarto({ tipo: 'periodo', periodo: per2h, categoria: cat, entrada: d('2026-11-17T20:00:00'), saida: d('2026-11-17T21:50:00') });
  assert.equal(r.total, 60); assert.equal(r.horasAdicionais, 0);
});

test('dentro da tolerância não cobra adicional', () => {
  const r = calc.calcularValorQuarto({ tipo: 'periodo', periodo: per2h, categoria: cat, entrada: d('2026-11-17T20:00:00'), saida: d('2026-11-17T22:15:00') });
  assert.equal(r.total, 60);
});

test('passou da tolerância cobra cada hora iniciada', () => {
  const r1 = calc.calcularValorQuarto({ tipo: 'periodo', periodo: per2h, categoria: cat, entrada: d('2026-11-17T20:00:00'), saida: d('2026-11-17T22:16:00') });
  assert.equal(r1.horasAdicionais, 1); assert.equal(r1.total, 80);
  const r2 = calc.calcularValorQuarto({ tipo: 'periodo', periodo: per2h, categoria: cat, entrada: d('2026-11-17T20:00:00'), saida: d('2026-11-17T23:30:00') });
  assert.equal(r2.horasAdicionais, 2); assert.equal(r2.total, 100);
});

test('pernoite vai até o horário de fim do dia seguinte', () => {
  const r = calc.calcularValorQuarto({ tipo: 'pernoite', categoria: cat, entrada: d('2026-11-17T23:00:00'), saida: d('2026-11-18T11:30:00') });
  assert.equal(r.total, 150);
  assert.equal(r.limite.getHours(), 12); assert.equal(r.limite.getDate(), 18);
});

test('pernoite com entrada de madrugada termina no mesmo dia', () => {
  const r = calc.calcularValorQuarto({ tipo: 'pernoite', categoria: cat, entrada: d('2026-11-18T02:00:00'), saida: d('2026-11-18T13:30:00') });
  assert.equal(r.limite.getDate(), 18); assert.equal(r.horasAdicionais, 2); assert.equal(r.total, 190);
});

test('janela de venda do pernoite atravessa a meia-noite', () => {
  assert.ok(calc.pernoitePermitido(d('2026-11-17T22:00:00'), '20:00', '05:00'));
  assert.ok(calc.pernoitePermitido(d('2026-11-18T03:00:00'), '20:00', '05:00'));
  assert.ok(!calc.pernoitePermitido(d('2026-11-18T15:00:00'), '20:00', '05:00'));
});

test('placas antiga e Mercosul', () => {
  assert.equal(calc.normalizarPlaca('abc-1234'), 'ABC1234');
  assert.equal(calc.normalizarPlaca('BRA2E19'), 'BRA2E19');
  assert.equal(calc.normalizarPlaca('AB12345'), null);
  assert.equal(calc.normalizarPlaca(''), null);
});
