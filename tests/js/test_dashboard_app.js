// Integração do dashboard no app.js: KPIs, destaques, gráfico de evolução (sem recriar à toa)
// e escape de nomes de produto. Usa DOM simulado, igual ao test_pos.js.
// Uso: node tests/js/test_dashboard_app.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};

let falhas = 0;
async function teste(nome, fn) {
  try { await fn(); console.log('OK    ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

function criarDom() {
  const store = {};
  const elemento = (id) => ({
    id, value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, focus: noop, click: noop, dispatchEvent: noop, remove: noop,
    closest: () => null, querySelector: () => null, querySelectorAll: () => []
  });
  return {
    getElementById: (id) => (store[id] ||= elemento(id)),
    querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
    createElement: () => elemento('x'), body: elemento('body'), documentElement: elemento('html'), readyState: 'complete'
  };
}

// Gráficos: registra criações, atualizações e destruições.
function criarChart(registro) {
  function Chart(ctx, cfg) {
    registro.criados.push(cfg);
    const inst = {
      data: cfg.data, options: cfg.options,
      destroy() { registro.destruidos++; },
      update() { registro.atualizados++; }
    };
    return inst;
  }
  Chart.defaults = { font: {}, plugins: { tooltip: {} } };
  return Chart;
}

function criarApp(produtos, vendas) {
  const dom = criarDom();
  const registro = { criados: [], destruidos: 0, atualizados: 0 };
  const ctx = {
    window: {}, addEventListener: noop, console: { log: noop, warn: noop, info: noop, error: noop },
    document: dom,
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    Chart: criarChart(registro), lucide: { createIcons: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, RegExp,
    Event: function (t) { this.type = t; }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const arq of ['dashboard.js', 'estoque.js', 'backup.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop; app.updateNotifications = noop;
  app.salvarDados = async () => true;
  app.openModal = noop; app.initLucide = noop; app.closeModal = noop;
  app.showNotification = noop;
  app.state.dataLoaded = true;
  app.state.products = produtos;
  app.state.categories = [];
  app.state.customers = [];
  app.state.sales = vendas;
  app.state.movimentacoes = []; app.state.entradas = [];
  app.state.dashboardFilter = '7d';
  app.state.settings.notifications = { stockLowVal: 10, stockMediumVal: 25 };
  dom.getElementById('lineChart').getContext = () => ({});
  return { app, dom, registro };
}

// Vendas de ontem, às 22h30 local: em UTC já seria hoje. Ontem, e não hoje, porque o
// filtro do app (getFilteredSales) descarta vendas com data depois do relógio atual.
const hoje = new Date();
const as2230 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1, 22, 30).toISOString();
const produtos = () => [
  { id: '1', name: 'Coca <b>X</b>', stock: 0, cost: 6, price: 10, category: 'Bebidas', image: '' },
  { id: '2', name: 'Arroz', stock: 9, cost: 5, price: 10, category: 'Mercearia', image: '' }
];
const vendas = () => [
  { id: 'A', date: as2230, valor_total: 20, desconto: 0, cost: 12, cliente: 'Ana', items: [{ productId: '1', name: 'Coca <b>X</b>', qtySold: 2, price: 10, cost: 6 }] },
  { id: 'B', date: as2230, valor_total: 10, desconto: 0, cost: 5, cliente: 'Ana', items: [{ productId: '2', name: 'Arroz', qtySold: 1, price: 10, cost: 5 }] }
];

(async () => {
  await teste('renderDashboard preenche os KPIs de estoque e vendas', async () => {
    const { app, dom } = criarApp(produtos(), vendas());
    app.renderDashboard();
    const t = (id) => dom.getElementById(id).textContent;
    assert.strictEqual(t('dash-est-ruptura'), '50,0%');
    assert.strictEqual(t('dash-est-ruptura-sub'), '1 de 2 produtos sem saldo');
    assert.strictEqual(t('dash-ven-margem'), '43,3%', 'lucro 13 sobre faturamento 30');
    assert.strictEqual(t('dash-ven-hora'), '22h às 23h');
    assert.strictEqual(t('dash-ven-recorrencia'), '100,0%', 'Ana tem 2 compras');
  });

  await teste('reposição mostra os mais urgentes e escapa o nome do produto', async () => {
    const { app, dom } = criarApp(produtos(), vendas());
    app.renderDashboard();
    const html = dom.getElementById('dash-est-reposicao').innerHTML;
    assert.ok(html.includes('Coca &lt;b&gt;X'), 'nome escapado');
    assert.ok(!html.includes('<b>X</b>'), 'sem HTML cru');
  });

  await teste('alertas: produto sem estoque aparece com escape', async () => {
    const { app, dom } = criarApp(produtos(), vendas());
    app.renderDashboard();
    const html = dom.getElementById('dash-alertas').innerHTML;
    assert.ok(html.includes('Coca &lt;b&gt;X'), 'nome escapado');
    assert.ok(html.includes('sem estoque'));
    assert.ok(html.includes('Arroz: 9 un.'), 'saldo baixo (9 < 10)');
  });

  await teste('mais vendidos: ordenado por quantidade', async () => {
    const { app, dom } = criarApp(produtos(), vendas());
    app.renderDashboard();
    const html = dom.getElementById('dash-top-produtos').innerHTML;
    assert.ok(html.indexOf('Coca') < html.indexOf('Arroz'), 'Coca vendeu 2, Arroz 1');
    assert.ok(html.includes('2 un.'));
  });

  await teste('sem vendas no período: textos vazios, sem erro', async () => {
    const { app, dom } = criarApp(produtos(), []);
    app.renderDashboard();
    assert.strictEqual(dom.getElementById('dash-ven-margem').textContent, '—');
    assert.strictEqual(dom.getElementById('dash-ven-hora').textContent, '—');
    assert.ok(dom.getElementById('dash-top-produtos').innerHTML.includes('Sem vendas no período.'));
  });

  await teste('gráfico: a venda das 22h30 de ontem cai em ontem (não em hoje, como daria em UTC)', async () => {
    const { app, registro } = criarApp(produtos(), vendas());
    app.initCharts();
    const cfg = registro.criados[0];
    const faturamento = cfg.data.datasets.find(d => d.label === 'Faturamento');
    // Ontem é o penúltimo ponto da série de 7 dias; hoje (último) não tem venda.
    assert.strictEqual(faturamento.data[faturamento.data.length - 2], 30);
    assert.strictEqual(faturamento.data[faturamento.data.length - 1], 0);
  });

  await teste('gráfico: mesmo filtro e mesmas linhas só atualizam, sem recriar', async () => {
    const { app, registro } = criarApp(produtos(), vendas());
    app.initCharts();
    app.state.sales = vendas();
    app.initCharts();
    assert.strictEqual(registro.criados.length, 1);
    assert.strictEqual(registro.destruidos, 0);
    assert.strictEqual(registro.atualizados, 1);
  });

  await teste('gráfico: trocar o período recria o gráfico', async () => {
    const { app, registro } = criarApp(produtos(), vendas());
    app.initCharts();
    app.state.dashboardFilter = 'month';
    app.initCharts();
    assert.strictEqual(registro.criados.length, 2);
    assert.strictEqual(registro.destruidos, 1);
    assert.strictEqual(registro.criados[1].data.labels.length, new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate());
  });

  await teste('gráfico: ligar e desligar uma série recria com as linhas certas', async () => {
    const { app, registro } = criarApp(produtos(), vendas());
    app.initCharts();
    app.toggleChartDataset('lucro');
    assert.strictEqual(registro.criados.length, 2);
    // Arrays criados dentro do vm têm outro protótipo: compara como texto.
    assert.strictEqual(JSON.stringify(registro.criados[1].data.datasets.map(d => d.label)), '["Faturamento","Custo"]');
  });

  await teste('menu: existe botão do Dashboard e ele abre a tela', async () => {
    const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
    assert.ok(html.includes('data-view="dashboard"'), 'botão data-view="dashboard" no menu');
    const { app, dom } = criarApp(produtos(), vendas());
    app.switchView('dashboard');
    assert.strictEqual(app.state.currentView, 'dashboard');
    assert.notStrictEqual(dom.getElementById('dash-faturamento').textContent, '', 'renderDashboard rodou ao abrir a tela');
  });

  console.log(falhas === 0 ? '\nTodos os testes de integração do dashboard passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
