// Dashboard (SistemaVendas/frontend/dashboard.js): série do gráfico e indicadores estratégicos.
// Uso: node tests/js/test_dashboard.js            (fuso do sistema)
//      TZ=America/Sao_Paulo node tests/js/test_dashboard.js   (fuso do Brasil: onde o bug aparecia)
const assert = require('assert');
const path = require('path');
const D = require(path.join(__dirname, '../../SistemaVendas/frontend/dashboard.js'));

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

// Agora fixo: 19/11/2026 23h59, hora local (fim do dia das vendas de teste).
const agora = new Date(2026, 10, 19, 23, 59);
const iso = (ano, mes, dia, h, m) => new Date(ano, mes, dia, h, m).toISOString();

const vendasBase = () => [
  // Às 22h30 do dia 19: em UTC já é dia 20 (no fuso de São Paulo). Tem que cair no dia 19.
  { id: 'A', date: iso(2026, 10, 19, 22, 30), valor_total: 20, desconto: 0, cost: 12, cliente: 'Ana', items: [{ id: 'P1', name: 'Coca', qty: 2, price: 10, cost: 6 }] },
  { id: 'B', date: iso(2026, 10, 18, 10, 0), valor_total: 10, desconto: 0, cost: 5, cliente: 'Ana', items: [{ id: 'P2', name: 'Arroz', qty: 1, price: 10, cost: 5 }] }
];

teste('gráfico 7 dias: venda da noite cai no dia local (não no dia UTC)', () => {
  const s = D.serieLinha(vendasBase(), '7d', agora);
  assert.strictEqual(s.labels.length, 7);
  assert.strictEqual(s.labels[6], '19/11');
  assert.strictEqual(s.revenue[6], 20, 'venda das 22h30 do dia 19 no dia 19');
  assert.strictEqual(s.revenue[5], 10, 'venda do dia 18');
  assert.strictEqual(s.profit[6], 8);
  assert.strictEqual(s.cost[6], 12);
});

teste('gráfico do mês: um ponto por dia, mês atual', () => {
  const s = D.serieLinha(vendasBase(), 'month', agora);
  assert.strictEqual(s.labels.length, 30);
  assert.strictEqual(s.labels[0], '1');
  assert.strictEqual(s.revenue[17], 10, 'dia 18 (índice 17)');
  assert.strictEqual(s.revenue[18], 20, 'dia 19 (índice 18)');
});

teste('gráfico do ano: 12 meses, vendas no mês certo', () => {
  const s = D.serieLinha(vendasBase(), 'year', agora);
  assert.deepStrictEqual(s.labels.slice(0, 3), ['Jan', 'Fev', 'Mar']);
  assert.strictEqual(s.revenue[10], 30, 'novembro soma as duas vendas');
});

teste('vendas fora da janela do gráfico são ignoradas', () => {
  const vendas = [...vendasBase(), { id: 'C', date: iso(2025, 0, 5, 9, 0), valor_total: 99, cost: 1, items: [] }];
  const s = D.serieLinha(vendas, '7d', agora);
  assert.strictEqual(s.revenue.reduce((a, b) => a + b, 0), 30);
});

teste('filtro sem série (todas as vendas) devolve listas vazias, como antes', () => {
  const s = D.serieLinha(vendasBase(), 'all', agora);
  assert.deepStrictEqual(s.labels, []);
});

teste('valores da venda: desconto e lucro com os mesmos campos do app', () => {
  assert.deepStrictEqual(D.valoresVenda({ valor_total: 20, desconto: 2, cost: 12 }), { faturamento: 18, custo: 12, lucro: 6 });
  assert.deepStrictEqual(D.valoresVenda({ valor_total: 20, desconto: 0, cost: 12, lucro: 5 }), { faturamento: 20, custo: 12, lucro: 5 });
});

// ---- estoque ----

const produtos = () => [
  { id: 'P1', name: 'Coca', stock: 0, cost: 6 },   // vendeu 2 nos últimos dias; saldo zero
  { id: 'P2', name: 'Arroz', stock: 9, cost: 5 },  // vendeu 1; cobre 270 dias
  { id: 'P3', name: 'Sal', stock: 20, cost: 1 }    // sem venda: parado
];

teste('estoque: ruptura, valor parado e produtos parados', () => {
  const k = D.kpisEstoque(produtos(), vendasBase(), agora, {});
  assert.strictEqual(k.totalProdutos, 3);
  assert.strictEqual(k.zerados, 1);
  assert.ok(Math.abs(k.taxaRuptura - 33.333) < 0.01);
  assert.strictEqual(k.valorEstoque, 65);     // 0 + 9x5 + 20x1
  assert.strictEqual(k.paradosQuantidade, 1); // Sal
  assert.strictEqual(k.valorParado, 20);
});

teste('estoque: reposição ordenada pela menor cobertura e com sugestão de compra', () => {
  const k = D.kpisEstoque(produtos(), vendasBase(), agora, {});
  // Coca: média 2/30 por dia, cobertura 0. Arroz tem cobertura 270, fora da reposição.
  assert.deepStrictEqual(k.reposicao.map(i => i.produto), ['Coca']);
  assert.strictEqual(k.reposicao[0].cobertura, 0);
  assert.strictEqual(k.reposicao[0].sugestao, 2); // 2/30 x 30 dias - 0 = 2
  assert.strictEqual(k.criticos, 1);
});

teste('estoque: giro é o custo vendido na janela sobre o valor do estoque', () => {
  const k = D.kpisEstoque(produtos(), vendasBase(), agora, {});
  assert.strictEqual(k.custoVendido, 17);
  assert.ok(Math.abs(k.giro - 17 / 65) < 1e-9);
});

teste('estoque: janela de 30 dias deixa de fora vendas antigas', () => {
  const antiga = [{ id: 'X', date: iso(2026, 8, 1, 10, 0), valor_total: 50, cost: 30, items: [{ id: 'P3', qty: 5, price: 10, cost: 6 }] }];
  const k = D.kpisEstoque(produtos(), antiga, agora, {});
  assert.strictEqual(k.paradosQuantidade, 2, 'Arroz e Sal têm saldo e nenhuma venda na janela (Coca tem saldo zero)');
  assert.strictEqual(k.valorParado, 65);
  assert.strictEqual(k.giro, 0);
});

teste('estoque: sem produtos não quebra', () => {
  const k = D.kpisEstoque([], [], agora, {});
  assert.strictEqual(k.totalProdutos, 0);
  assert.strictEqual(k.taxaRuptura, 0);
  assert.strictEqual(k.coberturaMediaDias, null);
  assert.strictEqual(k.giro, null);
});

// ---- vendas ----

teste('vendas: margem bruta, ticket e pico de dia e horário', () => {
  const k = D.kpisVendas(vendasBase(), produtos(), (s) => new Date(s));
  assert.strictEqual(k.vendas, 2);
  assert.strictEqual(k.faturamento, 30);
  assert.strictEqual(k.lucro, 13);
  assert.ok(Math.abs(k.margemBruta - 43.333) < 0.01);
  assert.strictEqual(k.ticketMedio, 15);
  assert.strictEqual(k.diaPico, 'Qui', '19/11/2026 é quinta-feira e tem o maior faturamento');
  assert.strictEqual(k.horaPico, 22);
});

teste('vendas: lucro por categoria com participação', () => {
  const comCategoria = [
    { id: 'P1', name: 'Coca', category: 'Bebidas', stock: 0, cost: 6 },
    { id: 'P2', name: 'Arroz', category: 'Mercearia', stock: 9, cost: 5 },
  ];
  const k = D.kpisVendas(vendasBase(), comCategoria);
  assert.deepStrictEqual(k.categorias.map(c => c.categoria), ['Bebidas', 'Mercearia']);
  assert.strictEqual(k.categorias[0].lucro, 8);   // 2 x 10 - 2 x 6
  assert.strictEqual(k.categorias[1].lucro, 5);   // 1 x 10 - 1 x 5
  assert.ok(Math.abs(k.categorias[0].participacao - 61.538) < 0.01);
  const soma = k.categorias.reduce((a, c) => a + c.lucro, 0);
  assert.strictEqual(Math.round(soma * 100) / 100, k.lucro);
});

teste('vendas: produto sem categoria cai em "Sem categoria"', () => {
  const k = D.kpisVendas(vendasBase(), produtos());
  assert.deepStrictEqual(k.categorias.map(c => c.categoria), ['Sem categoria']);
});

teste('vendas: recorrência considera só clientes identificados', () => {
  const vendas = [...vendasBase(), { id: 'C', date: iso(2026, 10, 19, 9, 0), valor_total: 5, cost: 1, cliente: 'Consumidor Final', items: [] }];
  const k = D.kpisVendas(vendas, produtos());
  assert.strictEqual(k.clientesDistintos, 1, 'Consumidor Final não conta como cliente');
  assert.strictEqual(k.clientesRecorrentes, 1);
  assert.strictEqual(k.taxaRecorrencia, 100);
});

teste('vendas: sem vendas, indicadores ficam vazios e não quebram', () => {
  const k = D.kpisVendas([], produtos());
  assert.strictEqual(k.margemBruta, null);
  assert.strictEqual(k.ticketMedio, null);
  assert.strictEqual(k.diaPico, null);
  assert.strictEqual(k.taxaRecorrencia, null);
});

teste('escape de HTML', () => {
  assert.strictEqual(D.escaparHtml('<i>"x" & y</i>'), '&lt;i&gt;&quot;x&quot; &amp; y&lt;/i&gt;');
});

// ---- ranking de produtos e alertas ----

teste('itens: usa productId e qtySold como o app (formato real da venda)', () => {
  const vendas = [{ id: 'R', date: iso(2026, 10, 19, 9, 0), valor_total: 30, desconto: 0, cost: 9,
    items: [{ productId: 'P9', name: 'Pão', qtySold: 3, price: 10, cost: 3 }] }];
  const r = D.rankingProdutos(vendas, [{ id: 'P9', name: 'Pão de Queijo' }]);
  assert.deepStrictEqual(r.map(x => [x.id, x.nome, x.qtd]), [['P9', 'Pão de Queijo', 3]]);
  assert.strictEqual(r[0].lucro, 21);
  assert.strictEqual(r[0].margem, 70);
});

teste('ranking: lucro e margem por produto, com desconto repartido', () => {
  const vendas = [{ id: 'D', date: iso(2026, 10, 19, 9, 0), valor_total: 20, desconto: 10, cost: 6,
    items: [{ id: 'P1', qty: 2, price: 10, cost: 3 }] }];
  const [r] = D.rankingProdutos(vendas, produtos());
  assert.strictEqual(r.faturamento, 10, 'metade do desconto sai do item');
  assert.strictEqual(r.lucro, 4);
  assert.strictEqual(r.margem, 40);
});

teste('ranking: produtos sem nome usam o nome do item ou o id', () => {
  const vendas = [{ id: 'N', date: iso(2026, 10, 19, 9, 0), valor_total: 5, cost: 1, items: [{ id: 'X1', name: 'Suco', qty: 1, price: 5, cost: 1 }, { id: 'X2', qty: 1, price: 1, cost: 0 }] }];
  const nomes = D.rankingProdutos(vendas, []).map(x => x.nome);
  assert.deepStrictEqual(nomes, ['Suco', 'X2']);
});

teste('kpisVendas: produtosLucro vem ordenado do maior lucro e com no máximo 5', () => {
  const k = D.kpisVendas(vendasBase(), produtos());
  assert.deepStrictEqual(k.produtosLucro.map(x => x.id), ['P1', 'P2']);
  assert.strictEqual(k.produtosLucro[0].lucro, 8);
});

teste('alertas: sem estoque primeiro, depois baixo (sem repetir zerados)', () => {
  const lista = [{ id: 'A', name: 'Água', stock: 3 }, { id: 'B', name: 'Pó', stock: 0 }, { id: 'C', name: 'Sal', stock: 10 }, { id: 'D', name: 'Mel', stock: -1 }];
  const a = D.alertasEstoque(lista, 10);
  assert.deepStrictEqual(a.semEstoque.map(x => x.produto), ['Mel', 'Pó']);
  assert.deepStrictEqual(a.estoqueBaixo.map(x => x.produto), ['Água']);
});

teste('alertas: nível baixo ausente usa 10', () => {
  const a = D.alertasEstoque([{ id: 'A', name: 'Água', stock: 9 }, { id: 'B', name: 'Pó', stock: 10 }], undefined);
  assert.deepStrictEqual(a.estoqueBaixo.map(x => x.produto), ['Água']);
});

teste('insight vendas: pico do ano com queda no mês seguinte, em texto', () => {
  const serie = { labels: ['Out', 'Nov', 'Dez'], revenue: [1000, 2000, 1500], profit: [], cost: [] };
  const t = D.insightsVendas(serie, 2, { faturamento: 4500, vendas: 10 }, { faturamento: 3000 }, { margemBruta: 30, lucro: 1350 });
  assert.strictEqual(t[0], 'Novembro concentrou o maior faturamento do período (R$ 2.000,00), seguido por uma queda de 25,0% em dezembro.');
  assert.strictEqual(t[1], 'Faturamento de R$ 4.500,00, 50,0% acima do período anterior.');
  assert.strictEqual(t[2], 'Margem bruta de 30,0%, com lucro de R$ 1.350,00.');
});

teste('insight vendas: não compara com mês futuro (sem dados ainda)', () => {
  const serie = { labels: ['Out', 'Nov', 'Dez'], revenue: [1000, 2000, 0], profit: [], cost: [] };
  const t = D.insightsVendas(serie, 1, { faturamento: 3000, vendas: 5 }, { faturamento: 0 }, null);
  assert.ok(!t[0].includes('queda'), t[0]);
  assert.ok(t[0].startsWith('Novembro concentrou'));
  assert.strictEqual(t[1], 'Faturamento de R$ 3.000,00 no período.');
});

teste('insight vendas: sem vendas no período', () => {
  assert.deepStrictEqual(D.insightsVendas({ labels: [], revenue: [] }, 0, { faturamento: 0, vendas: 0 }, null, null), ['Sem vendas no período selecionado.']);
});

teste('insight vendas: pico no último período não cita queda inexistente', () => {
  const serie = { labels: ['Out', 'Nov'], revenue: [100, 150], profit: [], cost: [] };
  const t = D.insightsVendas(serie, 1, { faturamento: 250, vendas: 2 }, null, null);
  assert.strictEqual(t[0], 'Novembro concentrou o maior faturamento do período (R$ 150,00).');
});

teste('insight vendas: valor em reais com milhar', () => {
  const t = D.insightsVendas({ labels: ['7'], revenue: [12345.6] }, 0, { faturamento: 12345.6, vendas: 3 }, null, null);
  assert.ok(t[0].includes('R$ 12.345,60'), t[0]);
});

teste('insight estoque: ruptura, cobertura crítica e dinheiro parado', () => {
  const t = D.insightsEstoque({ totalProdutos: 20, zerados: 2, taxaRuptura: 10, criticos: 3, valorParado: 150, paradosQuantidade: 2, janelaDias: 30 });
  assert.strictEqual(t[0], '2 produto(s) sem saldo, ruptura de 10,0% do catálogo.');
  assert.strictEqual(t[1], '3 produto(s) com cobertura abaixo de 7 dias.');
  assert.strictEqual(t[2], 'R$ 150,00 parados em 2 produto(s) sem venda nos últimos 30 dias.');
});

teste('insight estoque: tudo sob controle e catálogo vazio', () => {
  assert.deepStrictEqual(D.insightsEstoque({ totalProdutos: 5, zerados: 0, criticos: 0, valorParado: 0 }), ['Nenhum produto em ruptura ou com cobertura crítica.']);
  assert.deepStrictEqual(D.insightsEstoque({ totalProdutos: 0 }), ['Nenhum produto cadastrado.']);
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes do dashboard passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
