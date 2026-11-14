// Testes do módulo de estoque e custo médio ponderado.
// Uso: node tests/js/test_estoque.js
const assert = require('assert');
const path = require('path');
const E = require(path.join(__dirname, '../../SistemaVendas/frontend/estoque.js'));
const T = E.TIPOS;

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log('OK    ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}
const mov = (dados) => E.criarMovimentacao(dados);
const entrada = (produtoId, qtd, custoUnit, refId) => mov({ produtoId, tipo: T.ENTRADA, qtd, custoUnit, refId });
const venda = (produtoId, qtd, custo, refId) => mov({ produtoId, tipo: T.VENDA, qtd: -qtd, custoUnit: custo, refId });

teste('custo médio: entrada sobre saldo existente', () => {
  const m = [entrada('P1', 10, 5), entrada('P1', 10, 15)];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 20, cost: 10 });
});

teste('custo médio: exemplo com centavos (3 @ 10 + 7 @ 12 = 11,40)', () => {
  const m = [entrada('P1', 3, 10), entrada('P1', 7, 12)];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 10, cost: 11.4 });
});

teste('custo médio: primeira entrada define o custo', () => {
  assert.deepStrictEqual(E.calcular([entrada('P1', 4, 7.5)], 'P1'), { stock: 4, cost: 7.5 });
});

teste('venda reduz estoque e não muda o custo médio', () => {
  const m = [entrada('P1', 10, 5), venda('P1', 4, 5, 'V1'), entrada('P1', 6, 9)];
  // 6 @ 5 + 6 @ 9 => (30 + 54) / 12 = 7
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 12, cost: 7 });
});

teste('venda não altera o custo, mesmo se o custo da venda for diferente', () => {
  const m = [entrada('P1', 10, 5), venda('P1', 2, 999, 'V1')];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 8, cost: 5 });
});

teste('ajuste positivo mantém o custo médio', () => {
  const m = [entrada('P1', 10, 5), mov({ produtoId: 'P1', tipo: T.AJUSTE, qtd: 3 })];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 13, cost: 5 });
});

teste('ajuste negativo reduz quantidade e mantém o custo', () => {
  const m = [entrada('P1', 10, 5), mov({ produtoId: 'P1', tipo: T.AJUSTE, qtd: -4 })];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 6, cost: 5 });
});

teste('ajuste de custo troca o custo médio sem mudar o estoque', () => {
  const m = [entrada('P1', 10, 5), mov({ produtoId: 'P1', tipo: T.AJUSTE_CUSTO, qtd: 0, custoUnit: 8 })];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 10, cost: 8 });
});

teste('estorno de venda devolve a quantidade e não muda o custo', () => {
  const m = [entrada('P1', 10, 5), venda('P1', 4, 5, 'V1'),
    mov({ produtoId: 'P1', tipo: T.ESTORNO, qtd: 4, refId: 'V1' })];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 10, cost: 5 });
});

teste('saldo nunca fica negativo', () => {
  const m = [entrada('P1', 2, 5), venda('P1', 1, 5, 'V1'), mov({ produtoId: 'P1', tipo: T.AJUSTE, qtd: -10 })];
  assert.strictEqual(E.calcular(m, 'P1').stock, 0);
});

teste('produtos são calculados separadamente', () => {
  const m = [entrada('P1', 5, 2), entrada('P2', 5, 20), venda('P1', 1, 2, 'V1')];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 4, cost: 2 });
  assert.deepStrictEqual(E.calcular(m, 'P2'), { stock: 5, cost: 20 });
});

teste('exclusão de entrada: saldo e custo voltam ao que seriam sem ela', () => {
  const ent1 = { id: 'EN1', items: [{ productId: 'P1', qty: 10, unitCost: 5 }] };
  const ent2 = { id: 'EN2', items: [{ productId: 'P1', qty: 10, unitCost: 15 }] };
  let m = [...E.movimentosDaEntrada(ent1), ...E.movimentosDaEntrada(ent2)];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 20, cost: 10 });

  const plano = E.planejarExclusaoEntrada(m, ent2);
  m.forEach(x => { if (plano.ignorar.includes(x.id)) x.ignorada = true; });
  m = m.concat(plano.novas);
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 10, cost: 5 });
});

teste('exclusão de entrada gera registro de auditoria ignorado (não conta)', () => {
  const ent = { id: 'EN1', items: [{ productId: 'P1', qty: 4, unitCost: 5 }] };
  const m = E.movimentosDaEntrada(ent);
  const plano = E.planejarExclusaoEntrada(m, ent);
  assert.strictEqual(plano.novas.length, 1);
  assert.strictEqual(plano.novas[0].qtd, -4);
  assert.strictEqual(plano.novas[0].ignorada, true);
  assert.strictEqual(plano.novas[0].tipo, T.EXCLUSAO_ENTRADA);
});

teste('exclusão de entrada anterior ao histórico só reverte a quantidade', () => {
  const legado = { id: 'EN0', items: [{ productId: 'P1', qty: 3, unitCost: 9 }] };
  const plano = E.planejarExclusaoEntrada([], legado);
  assert.deepStrictEqual(plano.ignorar, []);
  assert.strictEqual(plano.novas.length, 1);
  assert.strictEqual(plano.novas[0].qtd, -3);
  assert.strictEqual(plano.novas[0].ignorada, false);
});

teste('exclusão de venda: venda + estorno se anulam no estoque', () => {
  const v = { id: 'V1', items: [{ id: 'P1', qty: 3, cost: 5 }] };
  const m = [entrada('P1', 10, 5), ...E.movimentosDaVenda(v), ...E.movimentosDoEstorno(v)];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 10, cost: 5 });
});

teste('garantirSaldoInicial cria base para produto legado e não duplica', () => {
  const produtos = [{ id: 'P1', stock: 5, cost: 100 }, { id: 'P2', stock: 0, cost: 40 }];
  const novas = E.garantirSaldoInicial(produtos, []);
  assert.strictEqual(novas.length, 2);
  const m = novas.slice();
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 5, cost: 100 });
  assert.deepStrictEqual(E.calcular(m, 'P2'), { stock: 0, cost: 40 });
  assert.deepStrictEqual(E.garantirSaldoInicial(produtos, m), []);
});

teste('legado: venda depois do saldo inicial mantém custo e reduz estoque', () => {
  const produtos = [{ id: 'P1', stock: 5, cost: 100 }];
  const m = E.garantirSaldoInicial(produtos, []);
  m.push(venda('P1', 2, 100, 'V1'));
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 3, cost: 100 });
});

teste('sincronizar atualiza stock e cost do produto', () => {
  const p = { id: 'P1', stock: 0, cost: 0 };
  E.sincronizar(p, [entrada('P1', 2, 3), entrada('P1', 2, 5)]);
  assert.strictEqual(p.stock, 4);
  assert.strictEqual(p.cost, 4);
});

teste('sincronizar não mexe em produto sem histórico', () => {
  const p = { id: 'P9', stock: 7, cost: 3 };
  E.sincronizar(p, [entrada('P1', 2, 3)]);
  assert.deepStrictEqual(p, { id: 'P9', stock: 7, cost: 3 });
});

teste('movimentoCadastro com estoque zero define o custo inicial', () => {
  const m = [E.movimentoCadastro('P1', 0, 12)];
  assert.deepStrictEqual(E.calcular(m, 'P1'), { stock: 0, cost: 12 });
  const m2 = [...m, entrada('P1', 5, 20)];
  assert.deepStrictEqual(E.calcular(m2, 'P1'), { stock: 5, cost: 20 });
});

teste('validação recusa dados inconsistentes', () => {
  const casos = [
    () => mov({ produtoId: 'P1', tipo: 'inexistente', qtd: 1 }),
    () => mov({ produtoId: '', tipo: T.AJUSTE, qtd: 1 }),
    () => mov({ produtoId: 'P1', tipo: T.AJUSTE, qtd: 1.5 }),
    () => mov({ produtoId: 'P1', tipo: T.AJUSTE, qtd: 0 }),
    () => mov({ produtoId: 'P1', tipo: T.VENDA, qtd: 2 }),
    () => mov({ produtoId: 'P1', tipo: T.ESTORNO, qtd: -2 }),
    () => mov({ produtoId: 'P1', tipo: T.ENTRADA, qtd: 0, custoUnit: 1 }),
    () => mov({ produtoId: 'P1', tipo: T.ENTRADA, qtd: 2 }),
    () => mov({ produtoId: 'P1', tipo: T.ENTRADA, qtd: 2, custoUnit: -1 }),
    () => mov({ produtoId: 'P1', tipo: T.AJUSTE_CUSTO, qtd: 1, custoUnit: 3 }),
  ];
  casos.forEach((fn, i) => assert.throws(fn, Error, 'caso ' + i + ' deveria falhar'));
});

teste('invariantes em 2000 sequências aleatórias (seed fixa)', () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let rodada = 0; rodada < 2000; rodada++) {
    const m = [];
    const custos = [];
    for (let i = 0; i < 1 + Math.floor(rnd() * 15); i++) {
      const op = rnd();
      const estado = E.calcular(m, 'P1');
      if (op < 0.35) {
        const q = 1 + Math.floor(rnd() * 10);
        const c = Math.round(rnd() * 10000) / 100;
        custos.push(c);
        m.push(entrada('P1', q, c));
      } else if (op < 0.7) {
        if (estado.stock > 0) m.push(venda('P1', 1 + Math.floor(rnd() * estado.stock), estado.cost, 'V' + i));
      } else if (op < 0.85) {
        m.push(mov({ produtoId: 'P1', tipo: T.AJUSTE, qtd: Math.floor(rnd() * 11) - 5 || 1 }));
      } else {
        m.push(mov({ produtoId: 'P1', tipo: T.AJUSTE_CUSTO, qtd: 0, custoUnit: Math.round(rnd() * 10000) / 100 }));
      }
      const r = E.calcular(m, 'P1');
      assert.ok(r.stock >= 0, 'estoque negativo');
      assert.ok(r.cost >= 0, 'custo negativo');
      if (r.stock === 0) assert.strictEqual(r.cost >= 0, true);
    }
  }
});

teste('invariante: exclusão de entrada equivale a nunca ter registrado a entrada', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let rodada = 0; rodada < 500; rodada++) {
    const entradas = [];
    const m = [];
    for (let i = 0; i < 1 + Math.floor(rnd() * 5); i++) {
      const ent = { id: 'EN' + i, items: [{ productId: 'P1', qty: 1 + Math.floor(rnd() * 10), unitCost: 1 + Math.floor(rnd() * 50) }] };
      entradas.push(ent);
      m.push(...E.movimentosDaEntrada(ent));
      if (rnd() < 0.5) {
        const e = E.calcular(m, 'P1');
        if (e.stock > 0) m.push(venda('P1', 1 + Math.floor(rnd() * e.stock), e.cost, 'V' + i));
      }
    }
    const alvo = entradas[Math.floor(rnd() * entradas.length)];
    const plano = E.planejarExclusaoEntrada(m, alvo);
    const comExclusao = m.map(x => (plano.ignorar.includes(x.id) ? Object.assign({}, x, { ignorada: true }) : x)).concat(plano.novas);

    // Referência: refaz o histórico sem a entrada alvo (mesmas vendas, na mesma ordem)
    const semAlvo = m.filter(x => !(x.tipo === T.ENTRADA && x.refId === alvo.id));
    assert.deepStrictEqual(E.calcular(comExclusao, 'P1'), E.calcular(semAlvo, 'P1'), 'rodada ' + rodada);
  }
});

teste('historico: saldo após cada movimentação, ignoradas não contam', () => {
  const ent = { id: 'EN1', items: [{ productId: 'P1', qty: 5, unitCost: 10 }] };
  const m = [...E.movimentosDaEntrada(ent), venda('P1', 2, 10, 'V1')];
  const h = E.historico(m, 'P1');
  assert.deepStrictEqual(h.map(x => x.saldoApos), [5, 3]);
  m[1].ignorada = true;
  assert.deepStrictEqual(E.historico(m, 'P1').map(x => x.saldoApos), [5, 5]);
  assert.deepStrictEqual(E.historico(m, 'P9'), []);
});

teste('rótulos das movimentações', () => {
  assert.strictEqual(E.rotulo('entrada'), 'Entrada');
  assert.strictEqual(E.rotulo('exclusao_entrada'), 'Exclusão de entrada');
  assert.strictEqual(E.rotulo('desconhecido'), 'desconhecido');
});

if (falhas > 0) {
  console.log('\n' + falhas + ' falha(s).');
  process.exit(1);
}
console.log('\nTodos os testes passaram.');
