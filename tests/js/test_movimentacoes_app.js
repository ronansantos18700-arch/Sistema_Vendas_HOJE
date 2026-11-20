// Integração: Estoque > Movimentações no app.js com DOM simulado.
// Uso: node tests/js/test_movimentacoes_app.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};

function criarAmbiente({ role = 'admin', movimentacoes, produtos }) {
  const elementos = {};
  const fabricar = (id) => {
    const classes = new Set();
    return {
      id, value: '', textContent: '', innerHTML: '', hidden: false, style: {}, dataset: {},
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; on ? classes.add(c) : classes.delete(c); return on; },
        contains: (c) => classes.has(c), _set: classes
      },
      addEventListener: noop, appendChild: noop, removeChild: noop, click: noop, setAttribute: noop,
      querySelector: () => null, querySelectorAll: () => [], focus: noop, select: noop
    };
  };
  const downloads = [];
  const ctx = {
    console: { log: noop, warn: noop, info: noop, error: noop },
    setTimeout: (fn) => { fn(); return 0; }, setInterval: noop, clearInterval: noop, clearTimeout: noop,
    requestAnimationFrame: noop, alert: noop, confirm: () => false,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    fetch: async () => ({ ok: false }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, RegExp,
    Blob: class { constructor(partes, opcoes) { this.partes = partes; this.type = opcoes && opcoes.type; } },
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    document: {
      getElementById: (id) => {
        if (!elementos[id]) elementos[id] = fabricar(id);
        return elementos[id];
      },
      querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
      createElement: () => { const a = fabricar('a'); a.click = () => downloads.push({ nome: a.download, blob: a.href }); return a; },
      body: { appendChild: noop, removeChild: noop }, documentElement: fabricar('html'), readyState: 'complete'
    },
    URL: { createObjectURL: (blob) => { const id = 'blob:' + downloads.length; ctx.__blobs[id] = blob; return id; }, revokeObjectURL: noop },
    __blobs: {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = noop; ctx.removeEventListener = noop;
  ctx.window.chrome = { webview: { hostObjects: { bridge: { GetData: async () => '[]', SaveChanges: async () => true, SaveAll: async () => true, SaveData: async () => true } } } };
  vm.createContext(ctx);
  for (const arq of ['estoque.js', 'historico_movimentos.js', 'relatorios.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.requirePasswordChange = () => false;
  app.setLoading = noop; app.updateBrand = noop; app.updateNotifications = noop;
  app.notificacoes = [];
  app.showNotification = (tipo, msg) => app.notificacoes.push({ tipo, msg });
  app.state.currentUser = { role, username: 'teste' };
  app.state.products = produtos;
  app.state.movimentacoes = movimentacoes;
  app.state.settings = { companyName: 'Loja Teste' };
  app.state.sales = [];
  app.logAudit = (acao, detalhes) => { app.auditoria = (app.auditoria || []).concat([{ acao, detalhes }]); };
  return { app, ctx, elementos, downloads };
}

// Dados: um produto com saldo inicial, entrada, venda, ajuste e uma entrada apagada (ignorada).
const hoje = new Date();
const diaAtras = (n, h = 10) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n, h, 0).toISOString();
const produtos = [{ id: 'P1', name: 'Arroz', stock: 0, cost: 5 }, { id: 'P2', name: 'Feijão', stock: 0, cost: 3 }];
const movimentacoesBase = () => [
  { id: 'M1', date: diaAtras(10), produtoId: 'P1', tipo: 'saldo_inicial', qtd: 10, custoUnit: 5, refId: null, obs: '', ignorada: false },
  { id: 'M2', date: diaAtras(3), produtoId: 'P1', tipo: 'entrada', qtd: 5, custoUnit: 7, refId: 'E1', obs: '', ignorada: false },
  { id: 'M3', date: diaAtras(0, 8), produtoId: 'P1', tipo: 'venda', qtd: -3, custoUnit: 6, refId: 'V1', obs: '', ignorada: false },
  { id: 'M4', date: diaAtras(0, 9), produtoId: 'P1', tipo: 'ajuste', qtd: -1, custoUnit: null, refId: null, obs: '<b>quebra</b>', ignorada: false },
  { id: 'M5', date: diaAtras(1), produtoId: 'P2', tipo: 'entrada', qtd: 4, custoUnit: 3, refId: 'E2', obs: '', ignorada: true }
];

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
const linhasTabela = (el) => (el.innerHTML.match(/<tr class=/g) || []).length;

teste('não-admin: aba Movimentações some e Estoque volta a Produtos', () => {
  const { app, elementos } = criarAmbiente({ role: 'operador', movimentacoes: movimentacoesBase(), produtos });
  app._abaEstoque = 'movimentos';
  assert.strictEqual(app.sincronizarAbaEstoque(), 'produtos');
  assert.strictEqual(elementos['estoque-abas'].classList.contains('hidden'), true);
  assert.strictEqual(elementos['estoque-mov'].classList.contains('hidden'), true);
  assert.strictEqual(elementos['estoque-produtos'].classList.contains('hidden'), false);
});

teste('admin: aba Movimentações mostra o painel e esconde Produtos', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._abaEstoque = 'movimentos';
  assert.strictEqual(app.sincronizarAbaEstoque(), 'movimentos');
  assert.strictEqual(elementos['estoque-abas'].classList.contains('hidden'), false);
  assert.strictEqual(elementos['estoque-mov'].classList.contains('hidden'), false);
  assert.strictEqual(elementos['estoque-produtos'].classList.contains('hidden'), true);
});

teste('renderEstoque na aba Movimentações preenche a tabela e não toca nos produtos', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._abaEstoque = 'movimentos';
  app.renderEstoque();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 5, '5 movimentações, incluindo a ignorada');
  assert.ok(!elementos['estoque-grid'] || elementos['estoque-grid'].innerHTML === '', 'grade de produtos não foi renderizada');
});

teste('linhas: ordem mais recente primeiro, saldo após, rótulo e marca de ignorada', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app.renderMovimentacoes();
  const html = elementos['mov-tbody'].innerHTML;
  // Hoje: venda (08h), ajuste (09h). Ontem: feijão ignorado. Há 3 dias: entrada. Há 10 dias: saldo inicial.
  assert.ok(html.indexOf('Ajuste') < html.indexOf('Venda'), 'ajuste (09h) antes da venda (08h)');
  assert.ok(html.indexOf('Venda') < html.indexOf('Feijão'), 'hoje antes de ontem');
  assert.ok(html.indexOf('Feijão') < html.indexOf('Saldo inicial'), 'ontem antes de 10 dias atrás');
  assert.ok(html.includes('mov-apagada'), 'linha ignorada marcada como apagada');
  assert.ok(html.includes('<span class="mov-tag-ignorada">ignorada</span>'), 'etiqueta ignorada');
  // Saldos: 10 (saldo inicial), 15 (entrada), 12 (venda), 11 (ajuste)
  assert.ok(html.includes('<td class="num">11</td>'), 'saldo após o ajuste');
  assert.ok(html.includes('<td class="num">12</td>'), 'saldo após a venda');
  assert.ok(html.includes('<td class="num">15</td>'), 'saldo após a entrada');
});

teste('texto de observação é escapado (sem HTML injetado)', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app.renderMovimentacoes();
  const html = elementos['mov-tbody'].innerHTML;
  assert.ok(!html.includes('<b>quebra</b>'));
  assert.ok(html.includes('&lt;b&gt;quebra&lt;&#x2F;b&gt;'), 'barra também escapada pelo esc()');
});

teste('totais: entradas +5 (ignorada não conta), saídas -3, ajustes -1, ignoradas 1', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app.renderMovimentacoes();
  const t = elementos['mov-totais'].innerHTML;
  assert.ok(t.includes('<strong>+5 un.</strong>'), 'entradas de Arroz (a ignorada do Feijão não conta)');
  assert.ok(t.includes('<strong>-3 un.</strong>'), 'saídas');
  assert.ok(t.includes('<strong>-1 un.</strong>'), 'ajustes');
  assert.ok(t.includes('<strong>1</strong>'), 'ignoradas');
});

teste('filtro por tipo (seleção múltipla) e por produto', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._movEstado().tipos = ['venda', 'ajuste'];
  app.renderMovimentacoes();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 2);
  app._movEstado().tipos = [];
  app._movEstado().produto = 'P2';
  app.renderMovimentacoes();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 1);
});

teste('período "Hoje" mostra só movimentações de hoje', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._movEstado().periodo = 'hoje';
  app.renderMovimentacoes();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 2);
});

teste('busca por texto na observação', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._movEstado().busca = 'QUEBRA';
  app.renderMovimentacoes();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 1);
});

teste('período personalizado mostra as datas e filtra pelo intervalo', () => {
  const { app, elementos, ctx } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._movEstado().periodo = 'personalizado';
  ctx.document.getElementById('mov-inicio').value = '1900-01-01';
  ctx.document.getElementById('mov-fim').value = '1900-01-02';
  app.renderMovimentacoes();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 0);
  assert.ok(elementos['mov-tbody'].innerHTML.includes('Nenhuma movimentação com esses filtros'));
  assert.strictEqual(elementos['mov-datas'].classList.contains('hidden'), false);
});

teste('paginação: 50 por vez, "Mostrar mais" soma 50 e some ao acabar', () => {
  const muitas = [];
  for (let i = 0; i < 120; i++) {
    muitas.push({ id: 'X' + i, date: diaAtras(0, 0) + '', produtoId: 'P1', tipo: 'ajuste', qtd: 1, custoUnit: null, refId: null, obs: 'n' + i, ignorada: false });
  }
  const { app, elementos } = criarAmbiente({ movimentacoes: muitas, produtos });
  app.renderMovimentacoes();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 50);
  assert.strictEqual(elementos['mov-mais'].classList.contains('hidden'), false);
  assert.ok(elementos['mov-contagem'].textContent.includes('50 de 120'));
  app._movEstado().limite += 50;
  app.renderMovimentacoes();
  assert.strictEqual(linhasTabela(elementos['mov-tbody']), 100);
  app._movEstado().limite = 150;
  app.renderMovimentacoes();
  assert.strictEqual(elementos['mov-mais'].classList.contains('hidden'), true);
});

teste('sem movimentações: mensagem de lista vazia', () => {
  const { app, elementos } = criarAmbiente({ movimentacoes: [], produtos });
  app.renderMovimentacoes();
  assert.ok(elementos['mov-tbody'].innerHTML.includes('Nenhuma movimentação registrada.'));
});

teste('exportação xlsx (admin): arquivo ZIP com nome do período, auditoria registrada', () => {
  const { app, downloads } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._movEstado().periodo = 'tudo';
  app.exportarMovimentacoes('xlsx');
  assert.strictEqual(downloads.length, 1);
  assert.strictEqual(downloads[0].nome, 'movimentacoes_todas.xlsx');
  assert.strictEqual(app.auditoria[0].acao, 'MOVIMENTACOES_EXPORT');
  assert.strictEqual(app.auditoria[0].detalhes.linhas, 5);
});

teste('exportação PDF (admin): nome e cabeçalho PDF', () => {
  const { app, downloads, ctx } = criarAmbiente({ movimentacoes: movimentacoesBase(), produtos });
  app._movEstado().periodo = '7';
  app.exportarMovimentacoes('pdf');
  assert.strictEqual(downloads.length, 1);
  const nome = downloads[0].nome;
  assert.ok(/^movimentacoes_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2}\.pdf$/.test(nome), nome);
  const blob = ctx.__blobs[downloads[0].blob];
  const bytes = Buffer.from(blob.partes[0]);
  assert.strictEqual(bytes.slice(0, 5).toString(), '%PDF-');
});

teste('exportação bloqueada para não-admin (nenhum download, aviso)', () => {
  const { app, downloads } = criarAmbiente({ role: 'operador', movimentacoes: movimentacoesBase(), produtos });
  app.exportarMovimentacoes('xlsx');
  assert.strictEqual(downloads.length, 0);
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error'));
});

teste('exportação sem linhas: aviso, sem download', () => {
  const { app, downloads } = criarAmbiente({ movimentacoes: [], produtos });
  app.exportarMovimentacoes('xlsx');
  assert.strictEqual(downloads.length, 0);
  assert.ok(app.notificacoes.some((n) => n.msg.includes('Nenhuma movimentação para exportar')));
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de integração de movimentações passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
