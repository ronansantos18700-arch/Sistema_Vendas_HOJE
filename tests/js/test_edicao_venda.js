// Testa a edição de venda registrada (estoque, totais e forma de pagamento).
// Uso: node tests/js/test_edicao_venda.js
const path = require('path');
const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const Estoque = require(path.join(base, 'estoque.js'));
const EV = require(path.join(base, 'edicao_venda.js'));

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log('OK    ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

// Cenário base: produto P1 com 10 un. (custo 4) e P2 com 5 un. (custo 7).
// Venda V1: 2 un. de P1 (preço 9) e 1 un. de P2 (preço 12), desconto 0.
function cenario() {
  const movs = [
    Estoque.movimentoCadastro('P1', 10, 4),
    Estoque.movimentoCadastro('P2', 5, 7),
  ];
  const venda = {
    id: 'V1', date: new Date().toISOString(), cliente: 'Consumidor Final',
    valor_total: 30, desconto: 0, valor_final: 30, cost: 15, lucro: 15,
    pagamento: 'dinheiro',
    items: [
      { id: 'P1', name: 'Produto 1', qty: 2, price: 9, cost: 4 },
      { id: 'P2', name: 'Produto 2', qty: 1, price: 12, cost: 7 },
    ],
  };
  movs.push(...Estoque.movimentosDaVenda(venda));
  return { movs, venda };
}

// Aplica as movimentações planejadas e devolve o saldo final por produto.
function saldos(movs, novas) {
  const todas = movs.concat(novas);
  return { P1: Estoque.calcular(todas, 'P1').stock, P2: Estoque.calcular(todas, 'P2').stock };
}

teste('sem mudança de quantidade não gera movimentação', () => {
  const { movs, venda } = cenario();
  const p = EV.planejarEdicao(movs, venda, [2, 1]);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.novas.length, 0);
});

teste('aumentar quantidade reduz o estoque e usa o custo do item na venda', () => {
  const { movs, venda } = cenario();
  const p = EV.planejarEdicao(movs, venda, [3, 1]); // P1: 2 -> 3
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.novas.length, 1);
  assert.strictEqual(p.novas[0].tipo, Estoque.TIPOS.VENDA);
  assert.strictEqual(p.novas[0].qtd, -1);
  assert.strictEqual(p.novas[0].custoUnit, 4);
  const s = saldos(movs, p.novas);
  assert.strictEqual(s.P1, 10 - 3);
  assert.strictEqual(s.P2, 5 - 1);
});

teste('reduzir quantidade devolve ao estoque com estorno', () => {
  const { movs, venda } = cenario();
  const p = EV.planejarEdicao(movs, venda, [1, 1]); // P1: 2 -> 1
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.novas[0].tipo, Estoque.TIPOS.ESTORNO);
  assert.strictEqual(p.novas[0].qtd, 1);
  assert.strictEqual(saldos(movs, p.novas).P1, 10 - 1);
});

teste('aumentar além do estoque disponível é recusado e nada é planejado', () => {
  const { movs, venda } = cenario();
  const p = EV.planejarEdicao(movs, venda, [2, 9]); // P2: tem 4 disponíveis, pede +8
  assert.strictEqual(p.ok, false);
  assert.strictEqual(p.novas.length, 0);
  assert.strictEqual(p.problemas[0].produtoId, 'P2');
  assert.strictEqual(p.problemas[0].falta, 8 - 4);
});

teste('zerar um item remove a linha e o estoque volta ao saldo', () => {
  const { movs, venda } = cenario();
  const p = EV.planejarEdicao(movs, venda, [2, 0]);
  assert.strictEqual(p.ok, true);
  const t = EV.recalcularVenda(venda, [2, 0], 0);
  assert.strictEqual(t.items.length, 1);
  assert.strictEqual(t.valor_total, 18);
  assert.strictEqual(saldos(movs, p.novas).P2, 5);
});

teste('recalcula totais, custo e lucro com as novas quantidades', () => {
  const { venda } = cenario();
  const t = EV.recalcularVenda(venda, [1, 3], 2); // P1: 1 x 9, P2: 3 x 12
  assert.strictEqual(t.valor_total, 9 + 36);
  assert.strictEqual(t.desconto, 2);
  assert.strictEqual(t.valor_final, 43);
  assert.strictEqual(t.cost, 4 + 21);
  assert.strictEqual(t.lucro, 43 - 25);
});

teste('desconto nunca passa do subtotal', () => {
  const { venda } = cenario();
  const t = EV.recalcularVenda(venda, [1, 1], 500);
  assert.strictEqual(t.desconto, 21);
  assert.strictEqual(t.valor_final, 0);
});

teste('venda sem nenhum item é recusada (para isso existe Excluir venda)', () => {
  const { venda } = cenario();
  assert.throws(() => EV.recalcularVenda(venda, [0, 0], 0), /pelo menos um item/);
});

teste('quantidade negativa ou fracionada é recusada', () => {
  const { movs, venda } = cenario();
  assert.throws(() => EV.planejarEdicao(movs, venda, [-1, 1]), /inválida/);
  assert.throws(() => EV.planejarEdicao(movs, venda, [1.5, 1]), /inválida/);
});

teste('venda mista só mantém os pagamentos se a soma bater com o novo total', () => {
  const venda = { pagamento: 'misto', troco: 0, pagamentos: [{ forma: 'dinheiro', valor: 20 }, { forma: 'pix', valor: 10 }] };
  assert.strictEqual(EV.pagamentoAposEdicao(venda, 30, 'manter').pagamento, 'misto');
  assert.throws(() => EV.pagamentoAposEdicao(venda, 25, 'manter'), /não batem/);
});

teste('trocar para forma única descarta os pagamentos divididos', () => {
  const venda = { pagamento: 'misto', pagamentos: [{ forma: 'dinheiro', valor: 20 }, { forma: 'pix', valor: 10 }] };
  const r = EV.pagamentoAposEdicao(venda, 25, 'cartao');
  assert.strictEqual(r.pagamento, 'cartao');
  assert.strictEqual(r.pagamentos, undefined);
});

teste('forma de pagamento inválida é recusada', () => {
  assert.throws(() => EV.pagamentoAposEdicao({ pagamento: 'dinheiro' }, 10, 'boleto'), /inválida/);
});

console.log(falhas === 0 ? '\nTodos os testes de edição de venda passaram.' : `\n${falhas} teste(s) falharam.`);
process.exitCode = falhas === 0 ? 0 : 1;
