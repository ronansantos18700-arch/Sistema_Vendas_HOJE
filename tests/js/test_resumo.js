// Testes do resumo de vendas por forma de pagamento. Uso: node tests/js/test_resumo.js
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '../../SistemaVendas/frontend/resumo.js'));

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log('OK    ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

// Período de um dia (horário local)
const dia = R.periodo('2026-11-14', '2026-11-14');
const dentro = (h) => new Date(2026, 10, 14, h, 30).toISOString();
const ontem = new Date(2026, 10, 13, 23, 59).toISOString();
const amanha = new Date(2026, 10, 15, 0, 1).toISOString();

teste('formas de pagamento: acentos e variações', () => {
  assert.strictEqual(R.formaDePagamento('Dinheiro'), 'dinheiro');
  assert.strictEqual(R.formaDePagamento('Cartão'), 'cartao');
  assert.strictEqual(R.formaDePagamento('cartao'), 'cartao');
  assert.strictEqual(R.formaDePagamento('cartão de crédito'), 'cartao');
  assert.strictEqual(R.formaDePagamento('PIX'), 'pix');
  assert.strictEqual(R.formaDePagamento('Boleto'), 'outros');
  assert.strictEqual(R.formaDePagamento(undefined), 'outros');
});

teste('totais por forma de pagamento no dia', () => {
  const vendas = [
    { date: dentro(9), pagamento: 'dinheiro', valor_final: 10 },
    { date: dentro(10), pagamento: 'Cartão', valor_final: 25.5 },
    { date: dentro(11), pagamento: 'pix', valor_final: 4.5 },
    { date: dentro(12), pagamento: 'dinheiro', valor_final: 0.1 },
    { date: dentro(13), pagamento: 'dinheiro', valor_final: 0.2 },
  ];
  const r = R.resumoPorPagamento(vendas, dia.inicio, dia.fim);
  assert.deepStrictEqual(r.linhas.map(l => [l.forma, l.quantidade, l.total]), [
    ['dinheiro', 3, 10.3], ['cartao', 1, 25.5], ['pix', 1, 4.5], ['outros', 0, 0]
  ]);
  assert.strictEqual(r.quantidade, 5);
  assert.strictEqual(r.total, 40.3);
});

teste('vendas fora do período são ignoradas', () => {
  const vendas = [
    { date: ontem, pagamento: 'dinheiro', valor_final: 100 },
    { date: amanha, pagamento: 'dinheiro', valor_final: 100 },
    { date: dentro(10), pagamento: 'pix', valor_final: 7 },
  ];
  const r = R.resumoPorPagamento(vendas, dia.inicio, dia.fim);
  assert.strictEqual(r.total, 7);
  assert.strictEqual(r.quantidade, 1);
});

teste('data inválida e lista vazia não quebram', () => {
  assert.deepStrictEqual(R.resumoPorPagamento([{ date: 'x', pagamento: 'pix', valor_final: 5 }], dia.inicio, dia.fim).total, 0);
  const r = R.resumoPorPagamento([], dia.inicio, dia.fim);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.quantidade, 0);
});

teste('período com intervalo de dias inclui o último dia inteiro', () => {
  const p = R.periodo('2026-11-01', '2026-11-14');
  const r = R.resumoPorPagamento([{ date: new Date(2026, 10, 14, 23, 0).toISOString(), pagamento: 'pix', valor_final: 3 }], p.inicio, p.fim);
  assert.strictEqual(r.total, 3);
});

teste('venda dividida entra em cada forma, sem contar duas vezes a venda', () => {
  const vendas = [
    { date: dentro(10), pagamento: 'misto', valor_final: 50, pagamentos: [{ forma: 'cartao', valor: 30 }, { forma: 'dinheiro', valor: 20 }] },
    { date: dentro(11), pagamento: 'pix', valor_final: 10 }
  ];
  const r = R.resumoPorPagamento(vendas, dia.inicio, dia.fim);
  assert.deepStrictEqual(r.linhas.map(l => [l.forma, l.quantidade, l.total]), [
    ['dinheiro', 1, 20], ['cartao', 1, 30], ['pix', 1, 10], ['outros', 0, 0]
  ]);
  assert.strictEqual(r.quantidade, 2);
  assert.strictEqual(r.total, 60);
});

if (falhas > 0) { console.log('\n' + falhas + ' falha(s).'); process.exit(1); }
console.log('\nTodos os testes passaram.');
