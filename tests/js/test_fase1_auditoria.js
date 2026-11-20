// Testes da Fase 1 (correções críticas da auditoria de UI/UX e integridade de dados).
// Uso: node tests/js/test_fase1_auditoria.js
//      TZ=America/Sao_Paulo node tests/js/test_fase1_auditoria.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const base = path.join(__dirname, '../../SistemaVendas/frontend');
const D = require(path.join(base, 'dashboard.js'));
const noop = () => {};

let falhas = 0;
async function teste(nome, fn) {
  try { await fn(); console.log('OK    ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

function criarDom() {
  const store = {};
  const listeners = {};
  const elemento = (id) => {
    let html = '';
    const attrs = {};
    const classes = new Set();
    const el = {
      id, value: '', type: 'password', textContent: '', disabled: false, dataset: {}, style: {}, filhos: [],
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (c, force) => { if (force === undefined ? !classes.has(c) : force) classes.add(c); else classes.delete(c); },
        contains: (c) => classes.has(c)
      },
      addEventListener: (ev, fn) => { (listeners[id + ':' + ev] ||= []).push(fn); },
      trigger: (ev, eObj = {}) => { (listeners[id + ':' + ev] || []).forEach(fn => fn({ target: el, preventDefault: noop, stopPropagation: noop, ...eObj })); },
      focus: noop, click: noop, dispatchEvent: noop, remove: noop,
      closest: () => null,
      querySelector: (sel) => (sel === '.var-value' ? (el._varValue ||= elemento(id + '-var-value')) : null),
      querySelectorAll: () => [],
      appendChild(filho) { this.filhos.push(filho); return filho; },
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => attrs[k] ?? null,
      removeAttribute: (k) => { delete attrs[k]; }
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set: (v) => { html = String(v); el.filhos = []; },
      enumerable: true
    });
    return el;
  };
  return {
    getElementById: (id) => (store[id] ||= elemento(id)),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    createElement: () => elemento('x'),
    body: elemento('body'),
    documentElement: elemento('html'),
    readyState: 'complete'
  };
}

function criarApp(registro = { criados: [] }) {
  const dom = criarDom();
  function Chart(ctx, cfg) {
    registro.criados.push(cfg);
    return { data: cfg.data, options: cfg.options, destroy: noop, update: noop };
  }
  Chart.defaults = { font: {}, plugins: { tooltip: {} } };
  const lucideCalls = [];
  const ctx = {
    window: {}, addEventListener: noop,
    console: { log: noop, warn: noop, info: noop, error: noop },
    document: dom,
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    Chart,
    lucide: { createIcons: (opts) => lucideCalls.push(opts || {}) },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, RegExp,
    Event: function (t) { this.type = t; }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const arq of ['dashboard.js', 'estoque.js', 'historico_movimentos.js', 'fiado.js', 'backup.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop;
  app.salvarDados = async () => true;
  app.openModal = noop; app.showNotification = noop;
  app.state.dataLoaded = true;
  app.state.currentUser = { id: '1', username: 'admin', fullname: 'Admin', role: 'admin' };
  dom.getElementById('lineChart').getContext = () => ({});
  return { app, dom, registro, lucideCalls };
}

(async () => {
  await teste('intervalosPeriodo 7d: 7 dias civis sem lacuna entre atual e anterior', async () => {
    const ref = new Date(2026, 10, 20, 14, 30, 0, 0);
    const iv = D.intervalosPeriodo('7d', ref);
    assert.strictEqual(D.chaveDia(iv.atualInicio), '2026-11-14');
    assert.strictEqual(iv.atualInicio.getHours(), 0);
    assert.strictEqual(D.chaveDia(iv.anteriorInicio), '2026-11-07');
    assert.strictEqual(D.chaveDia(iv.anteriorFim), '2026-11-13');
    assert.strictEqual(iv.atualInicio.getTime() - iv.anteriorFim.getTime(), 1, 'sem lacuna de 1 dia');
  });

  await teste('intervalosPeriodo month: compara MTD equivalente e ajusta fim de mês (31/03 -> 28/02)', async () => {
    const ref = new Date(2026, 2, 31, 15, 0, 0, 0);
    const iv = D.intervalosPeriodo('month', ref);
    assert.strictEqual(D.chaveDia(iv.atualInicio), '2026-03-01');
    assert.strictEqual(D.chaveDia(iv.anteriorInicio), '2026-02-01');
    assert.strictEqual(D.chaveDia(iv.anteriorFim), '2026-02-28');
    assert.strictEqual(iv.anteriorFim.getHours(), 15);
  });

  await teste('intervalosPeriodo year: compara YTD equivalente (29/02 bissexto -> 28/02)', async () => {
    const ref = new Date(2024, 1, 29, 10, 0, 0, 0);
    const iv = D.intervalosPeriodo('year', ref);
    assert.strictEqual(D.chaveDia(iv.atualInicio), '2024-01-01');
    assert.strictEqual(D.chaveDia(iv.anteriorInicio), '2023-01-01');
    assert.strictEqual(D.chaveDia(iv.anteriorFim), '2023-02-28');
  });

  await teste('resumoPagamentos: usa valor líquido (após desconto), divide misto e acentua rótulos', async () => {
    const vendas = [
      { id: '1', valor_total: 100, desconto: 20, pagamento: 'cartao' },
      { id: '2', valor_total: 50, desconto: 0, pagamento: 'misto', pagamentos: [{ forma: 'pix', valor: 30 }, { forma: 'dinheiro', valor: 20 }] },
      { id: '3', valor_total: 40, desconto: 0, pagamento: 'fiado' }
    ];
    const r = D.resumoPagamentos(vendas);
    const porForma = Object.fromEntries(r.map(x => [x.rotulo, x]));
    assert.strictEqual(porForma['Cartão'].faturamento, 80, 'desconto de 20 aplicado');
    assert.strictEqual(porForma['Fiado'].faturamento, 40);
    assert.strictEqual(porForma['PIX'].faturamento, 30);
    assert.strictEqual(porForma['Dinheiro'].faturamento, 20);
    assert.strictEqual(porForma['PIX'].vendas, 1);
    assert.strictEqual(porForma['Dinheiro'].vendas, 1);
  });

  await teste('gráfico Top 5 Lucrativos usa rateio de desconto igual à tabela de lucro', async () => {
    const registro = { criados: [] };
    const { app } = criarApp(registro);
    const ontem = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    app.state.products = [{ id: 'P1', name: 'Tênis', stock: 5, cost: 50, price: 100 }];
    app.state.sales = [{
      id: 'V1', date: ontem, valor_total: 100, desconto: 20, valor_final: 80, cost: 50, lucro: 30,
      items: [{ productId: 'P1', name: 'Tênis', qtySold: 1, price: 100, cost: 50 }]
    }];
    app.renderTopProfitableProductsChart();
    const cfg = registro.criados[registro.criados.length - 1];
    assert.strictEqual(cfg.data.datasets[0].data[0], 30, 'lucro líquido com desconto rateado = 30, não 50');
  });

  await teste('gráfico Evolução de Vendas: linha de Lucro usa verde (#2e9e6a) igual à legenda', async () => {
    const registro = { criados: [] };
    const { app } = criarApp(registro);
    app.initCharts();
    const lucroDs = registro.criados[0].data.datasets.find(d => d.label === 'Lucro');
    assert.strictEqual(lucroDs.borderColor, '#2e9e6a');
  });

  await teste('updateVariation formata em pt-BR e não fabrica 100.0% quando base anterior é 0', async () => {
    const { app, dom } = criarApp();
    app.updateVariation('dash-faturamento-var', 150, 100);
    assert.strictEqual(dom.getElementById('dash-faturamento-var').querySelector('.var-value').textContent, '▲ 50,0%');
    app.updateVariation('dash-faturamento-var', 80, 0);
    assert.strictEqual(dom.getElementById('dash-faturamento-var').querySelector('.var-value').textContent, 'Novo');
    app.updateVariation('dash-faturamento-var', 0, 0);
    assert.strictEqual(dom.getElementById('dash-faturamento-var').querySelector('.var-value').textContent, '0,0%');
  });

  await teste('Produtos: busca por código e filtro de texto preserva categoria selecionada', async () => {
    const { app, dom } = criarApp();
    app.setupEventListeners();
    app.state.categories = [{ id: 'C1', name: 'Bebidas' }, { id: 'C2', name: 'Doces' }];
    app.state.products = [
      { id: 'P1', name: 'Refrigerante', code: '789100', cost: 3, price: 6, stock: 10, category: 'C1' },
      { id: 'P2', name: 'Bala Refrescante', code: '789200', cost: 1, price: 2, stock: 10, category: 'C2' }
    ];
    dom.getElementById('filter-category').value = 'C1';
    dom.getElementById('filter-products').value = 'Refr';
    dom.getElementById('filter-products').trigger('input');
    const htmlCat = dom.getElementById('products-items-container').innerHTML;
    assert.ok(htmlCat.includes('Refrigerante'), 'mantém produto da categoria C1');
    assert.ok(!htmlCat.includes('Bala Refrescante'), 'não vaza produto da categoria C2');

    dom.getElementById('filter-category').value = '';
    app.renderProducts('789200', '');
    const htmlCod = dom.getElementById('products-items-container').innerHTML;
    assert.ok(htmlCod.includes('Bala Refrescante'), 'encontra pelo código de barras');
  });

  await teste('Saídas e Entradas: filtro de data usa dia local (venda/entrada às 22h30 BRT)', async () => {
    const { app, dom } = criarApp();
    const d2230 = new Date(2026, 10, 19, 22, 30, 0, 0).toISOString();
    app.state.sales = [{ id: 'S1', date: d2230, cliente: 'João', valor_total: 50, desconto: 0, valor_final: 50, cost: 20, lucro: 30, pagamento: 'pix', items: [] }];
    app.state.entradas = [{ id: 'E1', date: d2230, fornecedor: 'Fornecedor X', nota: '999', items: [], totalCusto: 100 }];

    dom.getElementById('filter-date-history').value = '2026-11-19';
    app.renderHistory();
    assert.ok(dom.getElementById('history-items-container').innerHTML.includes('João'), 'venda das 22h30 aparece no dia local 19/11');

    dom.getElementById('filter-date-entradas').value = '2026-11-19';
    app.renderEntradas();
    assert.ok(dom.getElementById('entradas-items-container').innerHTML.includes('Fornecedor X'), 'entrada das 22h30 aparece no dia local 19/11');
  });

  await teste('Clientes: busca por WhatsApp e preserva filtro ao re-renderizar sem argumentos', async () => {
    const { app, dom } = criarApp();
    app.state.customers = [
      { id: 'C1', name: 'Maria', whatsapp: '21999887766', date: new Date().toISOString() },
      { id: 'C2', name: 'Pedro', whatsapp: '21911223344', date: new Date().toISOString() }
    ];
    dom.getElementById('filter-customers').value = '99988';
    app.renderCustomers();
    const html = dom.getElementById('customers-items-container').innerHTML;
    assert.ok(html.includes('Maria'));
    assert.ok(!html.includes('Pedro'));
  });

  await teste('Estoque: contabiliza vendas usando productId e qtySold', async () => {
    const { app, dom } = criarApp();
    const ontem = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    app.state.products = [{ id: 'P1', name: 'Café', code: '123', stock: 10, cost: 5, price: 10 }];
    app.state.sales = [{ id: 'V1', date: ontem, items: [{ productId: 'P1', qtySold: 4 }] }];
    app.renderEstoque();
    assert.ok(dom.getElementById('estoque-grid').innerHTML.includes('Vendeu 4 un. em 30 dias'));
  });

  await teste('Permissões: operador não recebe notificações administrativas nem pode ajustar estoque', async () => {
    const { app } = criarApp();
    app.state.currentUser = { id: '2', username: 'op', fullname: 'Operador', role: 'operador' };
    app.state.products = [{ id: 'P1', name: 'Item Crítico', stock: 1, cost: 5, price: 10 }];
    app.updateNotifications();
    assert.strictEqual(app._notifLista.length, 0, 'notificações administrativas não são geradas para operador');
    let abriuModal = false;
    app.openModal = () => { abriuModal = true; };
    await app.adjustStock('P1', 2);
    assert.strictEqual(abriuModal, false, 'adjustStock bloqueado para operador');
  });

  await teste('exitConfirm com loginAtivo=false não deixa #confirm-modal-ok oculto em modais seguintes', async () => {
    const { app, dom } = criarApp();
    app.config.loginAtivo = false;
    app.exitConfirm();
    assert.strictEqual(dom.getElementById('confirm-modal-ok').style.display, 'none');
    app.confirmAction('Excluir', 'Tem certeza?', noop);
    assert.strictEqual(dom.getElementById('confirm-modal-ok').style.display, '');
  });

  await teste('toggle-password alterna data-lucide sem injetar <i> aninhado', async () => {
    const { app, dom } = criarApp();
    app.setupEventListeners();
    const btn = dom.getElementById('toggle-password');
    const input = dom.getElementById('login-password');
    const icon = dom.getElementById('toggle-password-icon');
    input.type = 'password';
    btn.trigger('click');
    assert.strictEqual(input.type, 'text');
    assert.strictEqual(icon.getAttribute('data-lucide'), 'eye-off');
    assert.strictEqual(icon.innerHTML, '', 'nenhum <i> aninhado injetado');
    assert.strictEqual(btn.getAttribute('aria-label'), 'Ocultar senha');
  });

  await teste('index.html: #start-tutorial não possui onclick duplicado', async () => {
    const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
    const m = html.match(/<button[^>]*id="start-tutorial"[^>]*>/);
    assert.ok(m, 'botão #start-tutorial existe');
    assert.ok(!m[0].includes('onclick='), 'sem onclick duplicado em #start-tutorial');
  });

  console.log(falhas === 0 ? '\nTodos os testes da Fase 1 passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
