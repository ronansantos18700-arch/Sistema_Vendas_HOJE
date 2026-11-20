// Fiado (venda a prazo): lógica pura em SistemaVendas/frontend/fiado.js.
// Uso: node tests/js/test_fiado.js
const assert = require('assert');
const path = require('path');
const F = require(path.join(__dirname, '../../SistemaVendas/frontend/fiado.js'));

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// Ids dos clientes de teste: as funções de fiado trabalham com o id (cliente_id), não com o nome.
const IDS = { Ana: 'C1', Beto: 'C2', Carla: 'C3' };
const venda = (id, cliente, valor, data, extra = {}) => Object.assign({
  id, cliente, cliente_id: IDS[cliente], valor_final: valor, date: data, pagamento: 'fiado', items: []
}, extra);

const ana = () => [
  venda('V1', 'Ana', 100, '2026-11-01T10:00:00Z'),
  venda('V2', 'Ana', 50, '2026-11-05T10:00:00Z'),
  venda('V3', 'Beto', 30, '2026-11-03T10:00:00Z'),
  venda('V4', 'Ana', 80, '2026-11-02T10:00:00Z', { pagamento: 'dinheiro' })
];

teste('venda fiado exige cliente cadastrado', () => {
  assert.strictEqual(F.validarVendaFiado('').ok, false);
  assert.strictEqual(F.validarVendaFiado('').ok, false);
  assert.strictEqual(F.validarVendaFiado(undefined).ok, false);
  assert.strictEqual(F.validarVendaFiado('C1').ok, true);
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
  assert.strictEqual(F.saldoCliente(ana(), 'C1'), 150);
  assert.strictEqual(F.saldoCliente(ana(), 'C2'), 30);
  assert.strictEqual(F.saldoCliente(ana(), 'C3'), 0);
});

teste('emAberto ordena da venda mais antiga para a mais recente', () => {
  assert.deepStrictEqual(F.emAberto(ana(), 'C1').map((v) => v.id), ['V1', 'V2']);
});

teste('saldosPorCliente lista só quem deve', () => {
  const m = F.saldosPorCliente(ana());
  assert.strictEqual(m.get('C1'), 150);
  assert.strictEqual(m.get('C2'), 30);
  assert.strictEqual(m.size, 2);
});

teste('recebimento parcial cai na venda mais antiga', () => {
  const vendas = ana();
  const r = F.registrarRecebimento(vendas, 'C1', 60, 'pix', '2026-11-10T12:00:00Z', 'R1');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.aplicacoes, [{ vendaId: 'V1', valor: 60 }]);
  assert.strictEqual(F.saldoAberto(vendas[0]), 40);
  assert.strictEqual(F.saldoAberto(vendas[1]), 50, 'venda mais nova intacta');
  assert.strictEqual(vendas[0].recebimentos[0].forma, 'pix');
});

teste('recebimento total quita a mais antiga e continua na seguinte', () => {
  const vendas = ana();
  const r = F.registrarRecebimento(vendas, 'C1', 120, 'dinheiro', '2026-11-10T12:00:00Z', 'R2');
  assert.deepStrictEqual(r.aplicacoes, [{ vendaId: 'V1', valor: 100 }, { vendaId: 'V2', valor: 20 }]);
  assert.strictEqual(F.saldoAberto(vendas[0]), 0);
  assert.strictEqual(F.saldoAberto(vendas[1]), 30);
  assert.strictEqual(F.saldoCliente(vendas, 'C1'), 30);
});

teste('recebimento total do cliente zera o saldo', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 150, 'cartao', '2026-11-10T12:00:00Z', 'R3');
  assert.strictEqual(F.saldoCliente(vendas, 'C1'), 0);
  assert.strictEqual(F.saldoCliente(vendas, 'C2'), 30, 'outro cliente não é afetado');
});

teste('não aceita valor acima do saldo, zero ou negativo, nem forma inválida', () => {
  const vendas = ana();
  assert.strictEqual(F.distribuir(vendas, 'C1', 151, 'pix').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'C1', 0, 'pix').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'C1', -5, 'pix').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'C1', 10, 'boleto').ok, false);
  assert.strictEqual(F.distribuir(vendas, 'C3', 10, 'pix').ok, false, 'sem saldo');
  assert.strictEqual(F.saldoCliente(vendas, 'C1'), 150, 'nada foi alterado');
});

teste('recusa não grava recebimento', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 999, 'pix', '2026-11-10', 'R4');
  assert.ok(vendas.every((v) => !v.recebimentos));
});

teste('valor com centavos é arredondado sem perder o saldo', () => {
  const vendas = [venda('V1', 'Ana', 10.1, '2026-11-01')];
  F.registrarRecebimento(vendas, 'C1', 0.1, 'pix', '2026-11-10', 'R5');
  F.registrarRecebimento(vendas, 'C1', 10, 'pix', '2026-11-10', 'R6');
  assert.strictEqual(F.saldoAberto(vendas[0]), 0);
});

teste('edição: venda com recebimento não pode deixar de ser fiado', () => {
  const v = venda('V1', 'Ana', 100, '2026-11-01', { recebimentos: [{ valor: 10 }] });
  assert.strictEqual(F.validarEdicao(v, 100, 'dinheiro', 'C1').ok, false);
  assert.strictEqual(F.validarEdicao(v, 100, 'fiado', 'C1').ok, true);
});

teste('edição: total novo não pode ficar abaixo do já recebido', () => {
  const v = venda('V1', 'Ana', 100, '2026-11-01', { recebimentos: [{ valor: 60 }] });
  assert.strictEqual(F.validarEdicao(v, 50, 'fiado', 'C1').ok, false);
  assert.strictEqual(F.validarEdicao(v, 60, 'fiado', 'C1').ok, true);
});

teste('edição: trocar para fiado exige cliente cadastrado', () => {
  const v = venda('V1', 'Consumidor Final', 100, '2026-11-01', { pagamento: 'pix' });
  assert.strictEqual(F.validarEdicao(v, 100, 'fiado', '').ok, false);
  assert.strictEqual(F.validarEdicao(v, 100, 'fiado', 'C1').ok, true);
  assert.strictEqual(F.validarEdicao(v, 100, 'pix', '').ok, true, 'outra forma não depende de cliente');
});

teste('operações: recebimentos do mesmo clique são agrupados (mais recente primeiro)', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 120, 'dinheiro', '2026-11-10T12:00:00Z', 'R100');
  F.registrarRecebimento(vendas, 'C1', 10, 'pix', '2026-11-11T12:00:00Z', 'R200');
  const ops = F.operacoes(vendas, 'C1');
  assert.deepStrictEqual(ops.map((o) => o.operacao), ['R200', 'R100']);
  assert.strictEqual(ops[1].valor, 120);
  assert.deepStrictEqual(ops[1].vendas, ['V1', 'V2']);
  assert.strictEqual(ops[0].forma, 'pix');
});

teste('estorno: desfaz a operação inteira, em todas as vendas em que foi distribuída', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 120, 'dinheiro', '2026-11-10T12:00:00Z', 'R100');
  F.registrarRecebimento(vendas, 'C1', 10, 'pix', '2026-11-11T12:00:00Z', 'R200');
  const r = F.estornarRecebimento(vendas, 'R100');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valor, 120);
  assert.strictEqual(F.saldoCliente(vendas, 'C1'), 140, 'saldo volta (150 - 10 do R200)');
  // R200 tinha ido para V2 (V1 já estava quitada pelo R100). Depois do estorno, V1 volta a 100 e V2 fica com 40.
  assert.strictEqual(F.saldoAberto(vendas[0]), 100, 'V1 volta ao saldo cheio');
  assert.strictEqual(F.saldoAberto(vendas[1]), 40, 'V2 mantém só o R200 de 10');
  assert.ok(vendas[1].recebimentos.every((x) => x.id.startsWith('R200')));
});

teste('estorno: operação inexistente não altera nada', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 10, 'pix', '2026-11-10', 'R300');
  const antes = JSON.stringify(vendas);
  const r = F.estornarRecebimento(vendas, 'R999');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(JSON.stringify(vendas), antes);
});

teste('estorno: depois de estornar, a venda pode ser excluída (sem recebimentos)', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 10, 'pix', '2026-11-10', 'R400');
  F.estornarRecebimento(vendas, 'R400');
  assert.strictEqual(F.recebido(vendas[0]), 0);
});

teste('dois clientes com o mesmo nome não se misturam (vínculo pelo id)', () => {
  const vendas = [
    venda('V1', 'Ana', 100, '2026-11-01'),
    Object.assign(venda('V2', 'Ana', 40, '2026-11-02'), { cliente_id: 'C9' })
  ];
  assert.strictEqual(F.saldoCliente(vendas, 'C1'), 100);
  assert.strictEqual(F.saldoCliente(vendas, 'C9'), 40);
  F.registrarRecebimento(vendas, 'C9', 40, 'pix', '2026-11-10', 'R900');
  assert.strictEqual(F.saldoCliente(vendas, 'C1'), 100, 'receber de um não baixa o outro');
  assert.strictEqual(F.saldoAberto(vendas[0]), 100);
});

teste('renomear o cliente não muda o saldo: o vínculo é pelo id', () => {
  const vendas = ana();
  F.renomearCliente(vendas, 'C1', 'Ana Paula');
  assert.strictEqual(F.saldoCliente(vendas, 'C1'), 150);
  assert.strictEqual(vendas[0].cliente, 'Ana Paula');
  assert.strictEqual(vendas[2].cliente, 'Beto', 'outro cliente não muda');
});

teste('saldosPorCliente usa o id e deixa de fora vendas sem cliente vinculado', () => {
  const vendas = ana();
  vendas.push(venda('V5', 'Sem Cadastro', 25, '2026-11-04', { cliente_id: undefined }));
  const m = F.saldosPorCliente(vendas);
  assert.strictEqual(m.get('C1'), 150);
  assert.strictEqual(m.get('C2'), 30);
  assert.strictEqual(m.size, 2);
});

teste('camposFiado: só devolve recebimentos e cliente_id quando existem', () => {
  const com = F.camposFiado({ id: 'V1', recebimentos: [{ id: 'R1-1', valor: 10 }], cliente_id: 'C1' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(com)), { recebimentos: [{ id: 'R1-1', valor: 10 }], cliente_id: 'C1' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(F.camposFiado({ id: 'V2' }))), {});
  assert.strictEqual(F.camposFiado({ cliente_id: 123 }).cliente_id, '123', 'id vira texto');
});

teste('vincularLegado: liga pelo nome só quando é único', () => {
  const clientes = [{ id: 'C1', name: 'Ana' }, { id: 'C2', name: 'Beto' }, { id: 'C3', name: 'Beto ' }];
  const vendas = [
    venda('V1', 'Ana', 100, '2026-11-01', { cliente_id: undefined }),
    venda('V2', 'Beto', 30, '2026-11-02', { cliente_id: undefined }),
    venda('V3', 'Ana', 50, '2026-11-03', { cliente_id: undefined, pagamento: 'pix' })
  ];
  const r = F.vincularLegado(vendas, clientes);
  assert.strictEqual(r.vinculadas, 1, 'só Ana tem nome único');
  assert.strictEqual(vendas[0].cliente_id, 'C1');
  assert.strictEqual(vendas[1].cliente_id, undefined, 'Beto aparece duas vezes: fica para revisão');
  assert.strictEqual(vendas[2].cliente_id, undefined, 'venda que não é fiado não entra');
});

teste('pendentesSemCliente: lista fiado com saldo sem cliente, para revisão', () => {
  const vendas = [
    venda('V1', 'Ana', 100, '2026-11-02', { cliente_id: undefined }),
    venda('V2', 'Beto', 30, '2026-11-01', { cliente_id: undefined, recebimentos: [{ valor: 30 }] }),
    venda('V3', 'Carla', 70, '2026-11-03')
  ];
  const p = F.pendentesSemCliente(vendas);
  assert.deepStrictEqual(p.map((x) => x.vendaId), ['V1']);
  assert.strictEqual(p[0].saldo, 100);
});

teste('vincular: só fiado sem cliente, e cliente escolhido grava id e nome', () => {
  const vendas = [
    venda('V1', 'Ana', 100, '2026-11-01', { cliente_id: undefined }),
    venda('V2', 'Ana', 40, '2026-11-02', { pagamento: 'pix', cliente_id: undefined })
  ];
  assert.strictEqual(F.vincular(vendas, 'V1', { id: 'C9', name: 'Ana Paula' }).ok, true);
  assert.strictEqual(vendas[0].cliente_id, 'C9');
  assert.strictEqual(vendas[0].cliente, 'Ana Paula');
  assert.strictEqual(F.vincular(vendas, 'V1', { id: 'C1', name: 'Ana' }).ok, false, 'já tem cliente');
  assert.strictEqual(F.vincular(vendas, 'V2', { id: 'C1', name: 'Ana' }).ok, false, 'não é fiado');
  assert.strictEqual(F.vincular(vendas, 'V9', { id: 'C1', name: 'Ana' }).ok, false, 'venda inexistente');
  assert.strictEqual(F.vincular(vendas, 'V1', null).ok, false, 'sem cliente');
});

teste('resumo do cliente: total a prazo, pago e falta, sem vendas de outros', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 30, 'pix', '2026-11-10T12:00:00Z', 'R700');
  const r = F.resumoCliente(vendas, 'C1');
  assert.strictEqual(r.totalPrazo, 150, 'só as vendas fiado da Ana (100 + 50)');
  assert.strictEqual(r.pago, 30);
  assert.strictEqual(r.falta, 120);
  assert.deepStrictEqual(r.vendas.map((x) => x.vendaId), ['V1', 'V2'], 'mais antiga primeiro');
  assert.strictEqual(r.vendas[0].falta, 70);
  assert.strictEqual(r.vendas[1].pago, 0);
});

teste('resumo: venda quitada continua no total a prazo, com falta zero', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C1', 100, 'pix', '2026-11-10T12:00:00Z', 'R710');
  const r = F.resumoCliente(vendas, 'C1');
  assert.strictEqual(r.vendas[0].falta, 0);
  assert.strictEqual(r.totalPrazo, 150);
  assert.strictEqual(r.falta, 50);
});

teste('resumosPorCliente bate com resumoCliente para cada cliente', () => {
  const vendas = ana();
  F.registrarRecebimento(vendas, 'C2', 10, 'dinheiro', '2026-11-10T12:00:00Z', 'R720');
  const m = F.resumosPorCliente(vendas);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m.get('C1'))), { totalPrazo: 150, pago: 0, falta: 150 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(m.get('C2'))), { totalPrazo: 30, pago: 10, falta: 20 });
  assert.strictEqual(m.has('C3'), false, 'sem venda fiado, não aparece');
});

teste('prévia do recebimento: quanto fica em aberto e recusa de valor inválido', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(F.restanteAposRecebimento(150, 60))), { ok: true, restante: 90 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(F.restanteAposRecebimento(150, 150))), { ok: true, restante: 0 });
  assert.strictEqual(F.restanteAposRecebimento(150, 151).ok, false);
  assert.strictEqual(F.restanteAposRecebimento(150, 0).ok, false);
  assert.strictEqual(F.restanteAposRecebimento(150, -1).ok, false);
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
