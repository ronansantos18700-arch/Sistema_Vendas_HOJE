// Fiado (venda a prazo): lógica pura em SistemaVendas/frontend/fiado.js.
// Uso: node tests/js/test_fiado.js
const assert = require('assert');
const path = require('path');
const F = require(path.join(__dirname, '../../SistemaVendas/frontend/fiado.js'));

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

const venda = (id, cliente, valor, data, extra = {}) => Object.assign({
  id, cliente, valor_final: valor, date: data, pagamento: 'fiado', items: []
}, extra);

const ana = () => [
  venda('V1', 'Ana', 100, '2026-11-01T10:00:00Z'),
  venda('V2', 'Ana', 50, '2026-11-05T10:00:00Z'),
  venda('V3', 'Beto', 30, '2026-11-03T10:00:00Z'),
  venda('V4', 'Ana', 80, '2026-11-02T10:00:00Z', { pagamento: 'dinheiro' })
];

teste('venda fiado exige cliente cadastrado', () => {
  assert.strictEqual(F.validarVendaFiado('Consumidor Final').ok, false);
  assert.strictEqual(F.validarVendaFiado('').ok, false);
  assert.strictEqual(F.validarVendaFiado(undefined).ok, false);
  assert.strictEqual(F.validarVendaFiado('Ana').ok, true);
});

teste('saldo em aberto: valor final menos recebimentos, só para fiado', () => {
  const v = venda('V1', 'Ana', 100, '2026-11-01', { recebimentos: [{ valor: 30 }, { valor: 20 }] });
  assert.strictEqual(F.saldoAberto(v), 50);
  assert.strictEqual(F.saldoAberto(venda('X', 'Ana', 80, '2026-11-01', { pagamento: 'pix' })), 0);
});

teste('saldo nunca fica negativo (recebimento a mais não cria crédito)', () => {
  const v = venda('V1', 'Ana', 100, '2026-11-01', { recebimentos: [{ valor: 120 }] });
  assert.strictEqual(F.saldoAberto(v), 0);
});

teste('saldo do cliente soma só vendas fiado em aberto', () => {
  assert.strictEqual(F.saldoCliente(ana(), 'Ana'), 150);
  assert.strictEqual(F.saldoCliente(ana(), 'Beto'), 30);
  assert.strictEqual(F.saldoCliente(ana(), 'Carla'), 0);
});

teste('emAberto ordena da venda mais antiga para a mais recente', () => {
  assert.deepStrictEqual(F.emAberto(ana(), 'Ana').map((v) => v.id), ['V1', 'V2']);
});

teste('saldosPorCliente lista só quem deve', () => {
  const m = F.saldosPorCliente(ana());
  assert.strictEqual(m.get('Ana'), 150);
  assert.strictEqual(m.get('Beto'), 30);
  assert.strictEqual(m.size, 2);
});

teste('recebimento parcial cai na venda mais antiga', () => {
  const vendas = ana();
  const r = F.registrarRecebimento(vendas, 'Ana', 60, 'pix', '2026-11-10T12:00:00Z', 'R1');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.aplicacoes, [{ vendaId: 'V1', valor: 60 }]);
  assert.strictEqual(F.saldoAberto(vendas[0]), 40);
  assert.strictEqual(F.saldoAberto(vendas[1]), 50, 'venda mais nova intacta');
  assert.strictEqual(vendas[0].recebimentos[0].forma, 'pix');
});

teste('recebimento total quita a mais antiga e continua na seguinte', () => {
  const vendas = ana();
  const r = F.registrarRecebimento(vendas, 'Ana', 120, 'dinheiro', '2026-11-10T12:00:00Z', 'R2');
  assert.deepStrictEqual(r.aplicacoes, [{ vendaId: 'V1', valor: 100 }, { vendaId: 'V2', valor: 20 }]);
  assert.strictEqual(F.saldoAberto(vendas[0]), 0);
  assert.strictEqual(F.saldoAberto(vendas[1]), 30);
  assert.strictEqual(F.saldoCliente(vendas, 'Ana'), 30);
});

teste('recebimento total do cliente zera o saldo', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'Ana', 150, 'cartao', '2026-11-10T12:00:00Z', 'R3');
  assert.strictEqual(F.saldoCliente(vendas, 'Ana'), 0);
  assert.strictEqual(F.saldoCliente(vendas, 'Beto'), 30, 'outro cliente não é afetado');
});

teste('não aceita valor acima do saldo, zero ou negativo, nem forma inválida', () => {
  const vendas = ana();
  assert.strictEqual(F.distribuir(vendas, 'Ana', 151, 'pix').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'Ana', 0, 'pix').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'Ana', -5, 'pix').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'Ana', 10, 'boleto').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'Carla', 10, 'pix').ok, false, 'sem saldo');
  assert.strictEqual(F.saldoCliente(vendas, 'Ana'), 150, 'nada foi alterado');
});

teste('recusa não grava recebimento', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'Ana', 999, 'pix', '2026-11-10', 'R4');
  assert.ok(vendas.every((v) => !v.recebimentos));
});

teste('valor com centavos é arredondado sem perder o saldo', () => {
  const vendas = [venda('V1', 'Ana', 10.1, '2026-11-01')];
  F.registrarRecebimento(vendas, 'Ana', 0.1, 'pix', '2026-11-10', 'R5');
  F.registrarRecebimento(vendas, 'Ana', 10, 'pix', '2026-11-10', 'R6');
  assert.strictEqual(F.saldoAberto(vendas[0]), 0);
});

teste('edição: venda com recebimento não pode deixar de ser fiado', () => {
  const v = venda('V1', 'Ana', 100, '2026-11-01', { recebimentos: [{ valor: 10 }] });
  assert.strictEqual(F.validarEdicao(v, 100, 'dinheiro', 'Ana').ok, false);
  assert.strictEqual(F.validarEdicao(v, 100, 'fiado', 'Ana').ok, true);
});

teste('edição: total novo não pode ficar abaixo do já recebido', () => {
  const v = venda('V1', 'Ana', 100, '2026-11-01', { recebimentos: [{ valor: 60 }] });
  assert.strictEqual(F.validarEdicao(v, 50, 'fiado', 'Ana').ok, false);
  assert.strictEqual(F.validarEdicao(v, 60, 'fiado', 'Ana').ok, true);
});

teste('edição: trocar para fiado exige cliente cadastrado', () => {
  const v = venda('V1', 'Consumidor Final', 100, '2026-11-01', { pagamento: 'pix' });
  assert.strictEqual(F.validarEdicao(v, 100, 'fiado', 'Consumidor Final').ok, false);
  assert.strictEqual(F.validarEdicao(v, 100, 'fiado', 'Ana').ok, true);
  assert.strictEqual(F.validarEdicao(v, 100, 'pix', 'Consumidor Final').ok, true, 'outra forma não depende de cliente');
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de fiado passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
