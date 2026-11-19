// Integração: app.js + relatorios.js com DOM simulado. Confere os arquivos baixados e o painel de alertas.
// Uso: node tests/js/test_relatorios_app.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};

function criarAmbiente(campos) {
  // campos: { 'rel-inicio': {value}, 'rel-vendas': {checked}, ... }
  const elementos = {};
  const fabricar = (id) => ({
    id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, appendChild: noop, removeChild: noop, click: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], focus: noop, select: noop
  });
  const downloads = [];
  const ctx = {
    console: { log: noop, warn: noop, info: noop, error: noop },
    setTimeout: (fn) => { fn(); return 0; }, setInterval: noop, clearInterval: noop, clearTimeout: noop,
    requestAnimationFrame: noop, alert: noop, confirm: () => false,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    fetch: async () => ({ ok: false }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, Blob: class {
      constructor(partes, opcoes) { this.partes = partes; this.type = opcoes && opcoes.type; }
    },
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    document: {
      getElementById: (id) => {
        if (!elementos[id]) {
          const el = fabricar(id);
          if (campos[id]) Object.assign(el, campos[id]);
          elementos[id] = el;
        }
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
  for (const arq of ['estoque.js', 'relatorios.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop; app.updateNotifications = noop;
  app.renderEstoque = noop; app.renderCart = noop; app.renderPosCatalog = noop; app.renderHistory = noop;
  app.notificacoes = [];
  app.showNotification = (tipo, msg) => app.notificacoes.push({ tipo, msg });
  app.logAudit = (acao, detalhes) => { app.auditoria = (app.auditoria || []).concat([{ acao, detalhes }]); };
  app.state.currentUser = { username: 'admin', role: 'admin' };
  app.state.settings = { companyName: 'Loja Teste', notifications: { stockLowVal: 10, stockMediumVal: 25 } };
  app.state.products = [
    { id: 'P1', name: 'Arroz', stock: 0, cost: 5, price: 8 },
    { id: 'P2', name: '<b>Feijão</b>', stock: 4, cost: 3, price: 6 },
    { id: 'P3', name: 'Sal', stock: 30, cost: 1, price: 2 }
  ];
  app.state.sales = [
    { id: 'V1', date: '2026-11-18T14:00:00', valor_total: 16, valor_final: 16, cost: 10, pagamento: 'dinheiro', items: [{ id: 'P1', name: 'Arroz', qty: 2, price: 8, cost: 5 }] },
    { id: 'V2', date: '2026-11-19T10:00:00', valor_total: 20, valor_final: 18, cost: 12, pagamento: 'misto', pagamentos: [{ forma: 'pix', valor: 10 }, { forma: 'dinheiro', valor: 8 }], items: [{ id: 'P2', name: '<b>Feijão</b>', qty: 2, price: 6, cost: 3 }, { id: 'P1', name: 'Arroz', qty: 1, price: 8, cost: 5 }] }
  ];
  return { app, downloads, ctx, elementos };
}

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste('exportar CSV: um arquivo por relatório marcado, com o período no nome', () => {
  const { app, downloads, ctx } = criarAmbiente({
    'rel-inicio': { value: '2026-11-18' }, 'rel-fim': { value: '2026-11-19' },
    'rel-vendas': { checked: true }, 'rel-lucro': { checked: true }, 'rel-estoque': { checked: false }, 'rel-pagamentos': { checked: true }
  });
  app.exportarRelatorios('csv');
  assert.deepStrictEqual(downloads.map(d => d.nome), [
    'relatorio_vendas_2026-11-18_a_2026-11-19.csv',
    'relatorio_lucro_2026-11-18_a_2026-11-19.csv',
    'relatorio_pagamentos_2026-11-18_a_2026-11-19.csv'
  ]);
  const conteudo = Buffer.from(ctx.__blobs[downloads[0].blob].partes[0]).toString('utf8');
  assert.ok(conteudo.includes('Dia;Vendas;Faturamento'), 'cabeçalho do CSV');
  assert.ok(conteudo.includes('19/11/2026;1;18,00'), 'linha com valor em pt-BR');
  assert.strictEqual(ctx.__blobs[downloads[0].blob].type, 'text/csv;charset=utf-8');
  assert.ok(app.auditoria.some(a => a.acao === 'RELATORIO_EXPORT' && a.detalhes.formato === 'csv'), 'registrado na auditoria');
});

teste('vendas agrupadas por mês quando o seletor pede', () => {
  const { app, downloads, ctx } = criarAmbiente({
    'rel-inicio': { value: '' }, 'rel-fim': { value: '' }, 'rel-agrupar': { value: 'mes' },
    'rel-vendas': { checked: true }
  });
  app.exportarRelatorios('csv');
  const conteudo = Buffer.from(ctx.__blobs[downloads[0].blob].partes[0]).toString('utf8');
  assert.ok(conteudo.includes('Mês;Vendas;Faturamento'), conteudo);
  assert.ok(conteudo.includes('11/2026;2;34,00'), conteudo);
});

teste('exportar PDF: um arquivo só, com as seções marcadas', () => {
  const { app, downloads, ctx } = criarAmbiente({
    'rel-vendas': { checked: true }, 'rel-lucro': { checked: false }, 'rel-estoque': { checked: true }, 'rel-pagamentos': { checked: false }
  });
  app.exportarRelatorios('pdf');
  assert.deepStrictEqual(downloads.map(d => d.nome), ['relatorios_inicio_a_hoje.pdf']);
  const bytes = ctx.__blobs[downloads[0].blob].partes[0];
  const texto = Buffer.from(bytes).toString('latin1');
  assert.ok(texto.startsWith('%PDF-1.4'));
  assert.ok(texto.includes('Vendas por dia') && texto.includes('Estoque atual'));
  assert.ok(!texto.includes('Recebimentos por forma'), 'seção não marcada fica de fora');
  assert.ok(texto.includes('Loja Teste'), 'nome da empresa no cabeçalho');
  assert.strictEqual(ctx.__blobs[downloads[0].blob].type, 'application/pdf');
});

teste('sem relatório marcado: avisa e não baixa nada', () => {
  const { app, downloads } = criarAmbiente({});
  app.exportarRelatorios('csv');
  assert.strictEqual(downloads.length, 0);
  assert.ok(app.notificacoes.some(n => n.tipo === 'error' && /Marque/.test(n.msg)));
});

teste('data inicial depois da final: avisa e não baixa nada', () => {
  const { app, downloads } = criarAmbiente({
    'rel-inicio': { value: '2026-11-20' }, 'rel-fim': { value: '2026-11-01' }, 'rel-vendas': { checked: true }
  });
  app.exportarRelatorios('pdf');
  assert.strictEqual(downloads.length, 0);
  assert.ok(app.notificacoes.some(n => n.tipo === 'error' && /inicial é depois/.test(n.msg)));
});

teste('painel de alertas: sem estoque e baixo, com nome escapado', () => {
  const { app, elementos } = criarAmbiente({});
  app.renderDashboardAlertas();
  const html = elementos['dash-alertas'].innerHTML;
  assert.ok(html.includes('Arroz</') || html.includes('Arroz:'), 'produto sem estoque na lista');
  assert.ok(html.includes('sem estoque'));
  assert.ok(html.includes('&lt;b&gt;Feijão&lt;/b&gt;'), 'nome escapado: ' + html);
  assert.ok(!html.includes('<b>'), 'sem HTML vindo do nome');
  assert.ok(!html.includes('Sal'), 'produto com estoque OK não aparece');
});

teste('mais vendidos: ordena por quantidade e mostra o período do dashboard', () => {
  const { app, elementos } = criarAmbiente({});
  app.getFilteredSales = () => app.state.sales;
  app.renderDashboardAlertas();
  const html = elementos['dash-top-produtos'].innerHTML;
  // Feijão: 2 un.; Arroz: 3 un. (2 na V1 + 1 na V2)
  assert.ok(html.indexOf('Arroz') < html.indexOf('Feijão'), html);
  assert.ok(html.includes('Arroz: 3 un.'));
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de relatórios no app passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
