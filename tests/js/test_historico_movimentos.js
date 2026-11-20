// Histórico de movimentações (SistemaVendas/frontend/historico_movimentos.js): lógica pura.
// Uso: node tests/js/test_historico_movimentos.js
const assert = require('assert');
const path = require('path');
const H = require(path.join(__dirname, '../../SistemaVendas/frontend/historico_movimentos.js'));
const E = require(path.join(__dirname, '../../SistemaVendas/frontend/estoque.js'));

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

const dia = (d, h = 10) => new Date(2026, 10, d, h, 0).toISOString();
const mov = (dados) => E.criarMovimentacao(dados);

const produtos = [
  { id: 'P1', name: 'Arroz', stock: 0, cost: 5 },
  { id: 'P2', name: 'Feijão', stock: 0, cost: 3 }
];

// Arroz: 10 (saldo inicial) +5 (entrada) -3 (venda) -1 (ajuste) +3 (estorno da venda) = 14
// Feijão: +4 (entrada) e uma entrada excluída depois (ignorada, não conta).
const movimentos = () => [
  mov({ id: 'M1', date: dia(10), produtoId: 'P1', tipo: 'saldo_inicial', qtd: 10, custoUnit: 5 }),
  mov({ id: 'M2', date: dia(12), produtoId: 'P1', tipo: 'entrada', qtd: 5, custoUnit: 7, refId: 'E1' }),
  mov({ id: 'M3', date: dia(13), produtoId: 'P1', tipo: 'venda', qtd: -3, custoUnit: 6, refId: 'V1' }),
  mov({ id: 'M4', date: dia(14), produtoId: 'P1', tipo: 'ajuste', qtd: -1, obs: 'Quebra no transporte' }),
  mov({ id: 'M5', date: dia(15), produtoId: 'P1', tipo: 'estorno', qtd: 3, custoUnit: 6, refId: 'V1' }),
  mov({ id: 'M6', date: dia(14, 9), produtoId: 'P2', tipo: 'entrada', qtd: 4, custoUnit: 3, refId: 'E2' }),
  mov({ id: 'M7', date: dia(16), produtoId: 'P2', tipo: 'exclusao_entrada', qtd: -4, refId: 'E2', ignorada: true })
];

const todas = () => H.linhas(movimentos(), produtos, E.historico);
const porId = (lista, id) => lista.find((l) => l.id === id);

teste('linhas: mais recente primeiro', () => {
  const ids = todas().map((l) => l.id);
  assert.deepStrictEqual(ids, ['M7', 'M5', 'M4', 'M6', 'M3', 'M2', 'M1']);
});

teste('saldo após bate com a sequência do produto (e com Estoque.historico)', () => {
  const l = todas();
  assert.strictEqual(porId(l, 'M1').saldoApos, 10);
  assert.strictEqual(porId(l, 'M2').saldoApos, 15);
  assert.strictEqual(porId(l, 'M3').saldoApos, 12);
  assert.strictEqual(porId(l, 'M4').saldoApos, 11);
  assert.strictEqual(porId(l, 'M5').saldoApos, 14);
  // Mesmo número que o histórico do produto usa.
  const doProduto = E.historico(movimentos(), 'P1');
  assert.strictEqual(doProduto[doProduto.length - 1].saldoApos, porId(l, 'M5').saldoApos);
});

teste('movimentação ignorada aparece marcada e não muda o saldo', () => {
  const m7 = porId(todas(), 'M7');
  assert.strictEqual(m7.ignorada, true);
  assert.strictEqual(m7.saldoApos, 4, 'saldo do Feijão continua 4 (a entrada ignorada não entra)');
});

teste('origem: venda, estorno e entrada mostram o documento; ajuste não tem origem', () => {
  const l = todas();
  assert.strictEqual(porId(l, 'M3').origem, 'Venda V1');
  assert.strictEqual(porId(l, 'M5').origem, 'Estorno da venda V1');
  assert.strictEqual(porId(l, 'M2').origem, 'Entrada E1');
  assert.strictEqual(porId(l, 'M4').origem, '—');
});

teste('linha traz o nome do produto, o rótulo do tipo e a observação', () => {
  const m4 = porId(todas(), 'M4');
  assert.strictEqual(m4.produto, 'Arroz');
  assert.strictEqual(m4.rotulo, 'Ajuste');
  assert.strictEqual(m4.obs, 'Quebra no transporte');
});

teste('produto sem cadastro usa o id como nome', () => {
  const l = H.linhas([mov({ id: 'X', date: dia(10), produtoId: 'ZZ', tipo: 'entrada', qtd: 1, custoUnit: 1 })], [], E.historico);
  assert.strictEqual(l[0].produto, 'ZZ');
});

teste('filtro de período é inclusivo, pelo dia local', () => {
  const r = H.filtrar(todas(), { inicio: '2026-11-12', fim: '2026-11-14' });
  assert.deepStrictEqual(r.map((l) => l.id).sort(), ['M2', 'M3', 'M4', 'M6'].sort());
  assert.strictEqual(H.filtrar(todas(), { inicio: '2026-11-16' }).length, 1, 'só o dia 16 e depois');
  assert.strictEqual(H.filtrar(todas(), {}).length, 7, 'sem período mostra tudo');
});

teste('filtro de produto e de tipos', () => {
  assert.strictEqual(H.filtrar(todas(), { produtoId: 'P2' }).length, 2);
  const vendas = H.filtrar(todas(), { tipos: ['venda', 'estorno'] });
  assert.deepStrictEqual(vendas.map((l) => l.id).sort(), ['M3', 'M5']);
  assert.strictEqual(H.filtrar(todas(), { tipos: [] }).length, 7, 'lista vazia de tipos = todos');
});

teste('busca em observação, origem e nome do produto (sem diferenciar maiúsculas)', () => {
  assert.deepStrictEqual(H.filtrar(todas(), { busca: 'QUEBRA' }).map((l) => l.id), ['M4']);
  assert.deepStrictEqual(H.filtrar(todas(), { busca: 'v1' }).map((l) => l.id).sort(), ['M3', 'M5']);
  assert.strictEqual(H.filtrar(todas(), { busca: 'feijão' }).length, 2);
});

teste('totais: entradas, saídas líquidas, ajustes e ignoradas à parte', () => {
  const t = H.totais(todas());
  assert.strictEqual(t.movimentos, 7);
  assert.strictEqual(t.entradas, 9, '5 do Arroz + 4 do Feijão');
  assert.strictEqual(t.saidas, 0, 'venda de 3 menos estorno de 3');
  assert.strictEqual(t.ajustes, -1);
  assert.strictEqual(t.exclusoes, 0, 'exclusão ignorada não conta');
  assert.strictEqual(t.ignoradas, 1);
});

teste('totais de lista vazia são zero', () => {
  assert.deepStrictEqual(H.totais([]), { movimentos: 0, entradas: 0, saidas: 0, exclusoes: 0, ajustes: 0, ignoradas: 0 });
});

teste('paginar: limite e lista menor que o limite', () => {
  assert.strictEqual(H.paginar(todas(), 3).length, 3);
  assert.strictEqual(H.paginar(todas(), 50).length, 7);
  assert.strictEqual(H.paginar(todas(), 0).length, 0);
});

teste('seção de exportação: colunas, uma linha por movimentação e traço para valor vazio', () => {
  const s = H.secao(todas());
  assert.strictEqual(s.colunas.length, 8);
  assert.strictEqual(s.linhas.length, 7);
  const m1 = s.linhas.find((r) => r[7] === '' && r[5] === 10);
  assert.ok(m1, 'saldo inicial com saldo 10');
  const ajuste = s.linhas.find((r) => r[2] === 'Ajuste');
  assert.strictEqual(ajuste[4], '—', 'ajuste sem custo unitário');
  assert.strictEqual(ajuste[7], 'Quebra no transporte');
  const ignorada = s.linhas.find((r) => r[2].includes('(ignorada)'));
  assert.ok(ignorada, 'linha ignorada marcada no tipo');
});

teste('data e hora em dd/mm/aaaa hh:mm (local)', () => {
  assert.strictEqual(H.dataHoraBr(new Date(2026, 10, 9, 7, 5).toISOString()), '09/11/2026 07:05');
  assert.strictEqual(H.dataHoraBr('não é data'), '—');
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes do histórico de movimentações passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
