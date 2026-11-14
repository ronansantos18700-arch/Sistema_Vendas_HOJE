// Testa as regras do PDV (carrinho, leitor, categorias e venda sem cliente).
// Uso: node tests/js/test_pos.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};

let falhas = 0;
async function teste(nome, fn) {
  try { await fn(); console.log('OK    ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

// DOM simulado: cada id vira um objeto que guarda innerHTML/value/textContent.
function criarDom() {
  const store = {};
  const elemento = (id) => ({
    id, value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, focus: noop, click: noop, dispatchEvent: noop, remove: noop,
    closest: () => null
  });
  return {
    getElementById: (id) => (store[id] ||= elemento(id)),
    querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
    createElement: () => elemento('x'), body: elemento('body'), documentElement: elemento('html'), readyState: 'complete'
  };
}

function criarApp(produtos, categorias = []) {
  const notificacoes = [];
  const dom = criarDom();
  const ctx = {
    window: {}, console: { log: noop, warn: noop, info: noop, error: noop },
    document: dom,
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, RegExp,
    Event: function (t) { this.type = t; }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const arq of ['estoque.js', 'resumo.js', 'backup.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop; app.updateNotifications = noop;
  app.salvarDados = async () => true;
  app.openModal = noop; app.initLucide = noop; app.closeModal = noop;
  app.showNotification = (tipo, msg) => notificacoes.push({ tipo, msg });
  app.state.dataLoaded = true;
  app.state.products = produtos;
  app.state.categories = categorias;
  app.state.customers = []; app.state.sales = []; app.state.movimentacoes = []; app.state.entradas = [];
  app.state.cart = []; app.state.pendingSale = null; app.state.posCatalog = { categoria: '' };
  app.state.posState = { customer: '', payment: 'dinheiro', discount: '', paid: '', isDirectSale: false };
  return { app, notificacoes, dom };
}

const produtos = () => [
  { id: 'P1', name: 'Café Especial', code: '7891', price: 20, cost: 10, stock: 3, category: 'C1', image: '' },
  { id: 'P2', name: 'Chá Verde', code: '7892', price: 12, cost: 5, stock: 0, category: 'C2', image: '' },
  { id: 'P3', name: 'Café Gelado', code: '7893', price: 15, cost: 7, stock: 9, category: 'C2', image: '' }
];
const categorias = () => [{ id: 'C1', name: 'Bebidas quentes' }, { id: 'C2', name: 'Gelados' }];

(async () => {
  await teste('venda sem cliente vai como Consumidor Final (sem erro)', async () => {
    const { app, notificacoes } = criarApp(produtos(), categorias());
    app.addToCart('P1', 1);
    await app.finishSale();
    assert.ok(app.state.pendingSale, 'venda pendente criada');
    assert.strictEqual(app.state.pendingSale.cliente, 'Consumidor Final');
    assert.ok(!notificacoes.some(n => n.tipo === 'error'), 'sem erro: ' + JSON.stringify(notificacoes));
  });

  await teste('adicionar além do estoque é recusado', () => {
    const { app, notificacoes } = criarApp(produtos(), categorias());
    assert.strictEqual(app.addToCart('P1', 3), true);
    assert.strictEqual(app.addToCart('P1', 1), false);
    assert.ok(notificacoes.some(n => /Estoque insuficiente/.test(n.msg)));
  });

  await teste('ajuste de quantidade no carrinho respeita estoque e remove em zero', () => {
    const { app } = criarApp(produtos(), categorias());
    app.addToCart('P1', 1);
    app.changeCartQty('P1', 1); app.changeCartQty('P1', 1);
    assert.strictEqual(app.state.cart[0].qty, 3);
    app.changeCartQty('P1', 1);
    assert.strictEqual(app.state.cart[0].qty, 3, 'não passa do estoque');
    app.changeCartQty('P1', -3);
    assert.strictEqual(app.state.cart.length, 0, 'zerou e saiu do carrinho');
  });

  await teste('leitor: código exato adiciona; código desconhecido numérico não adiciona', () => {
    const { app, notificacoes } = criarApp(produtos(), categorias());
    app.handleBarcodeEntry('7892');
    assert.strictEqual(app.state.cart.length, 0, 'Chá está sem estoque');
    app.handleBarcodeEntry('7893');
    assert.strictEqual(app.state.cart[0].id, 'P3');
    app.handleBarcodeEntry('0000');
    assert.ok(notificacoes.some(n => /não encontrado/.test(n.msg)));
  });

  await teste('busca por nome: um resultado adiciona; vários pedem nome completo', () => {
    const { app, notificacoes } = criarApp(produtos(), categorias());
    app.handleBarcodeEntry('gelado');
    assert.strictEqual(app.state.cart[0].id, 'P3');
    app.handleBarcodeEntry('café');
    assert.strictEqual(app.state.cart.length, 1, 'ambíguo não adiciona');
    assert.ok(notificacoes.some(n => /2 produtos encontrados/.test(n.msg)));
  });

  await teste('catálogo filtra por categoria e pela busca', () => {
    const { app, dom } = criarApp(produtos(), categorias());
    app.state.posCatalog = { categoria: 'C2' };
    app.renderPosCatalog();
    const grade = dom.getElementById('pos-product-grid').innerHTML;
    assert.ok(grade.includes('Chá Verde') && grade.includes('Café Gelado'));
    assert.ok(!grade.includes('Café Especial'));
    assert.ok(grade.includes('disabled'), 'produto sem estoque fica desabilitado');
    app.state.posCatalog = { categoria: '' };
    dom.getElementById('pos-barcode').value = 'especial';
    app.renderPosCatalog();
    const busca = dom.getElementById('pos-product-grid').innerHTML;
    assert.ok(busca.includes('Café Especial') && !busca.includes('Chá Verde'));
  });

  await teste('categoria: criar, bloquear duplicada e exigir nome', async () => {
    const { app } = criarApp(produtos(), categorias());
    const nova = await app.criarCategoria('  Doces ');
    assert.ok(nova.cat && nova.cat.name === 'Doces');
    assert.strictEqual(app.state.categories.length, 3);
    const dup = await app.criarCategoria('doces');
    assert.ok(dup.erro && dup.existente && dup.existente.id === nova.cat.id);
    assert.strictEqual(app.state.categories.length, 3, 'não duplica');
    const vazia = await app.criarCategoria('   ');
    assert.ok(vazia.erro);
  });

  await teste('cadastro de produto: criar categoria seleciona a nova', async () => {
    const { app, dom } = criarApp(produtos(), categorias());
    dom.getElementById('prod-new-category-name').value = 'Salgados';
    await app.addCategoryFromProduct();
    const nova = app.state.categories.find(c => c.name === 'Salgados');
    assert.ok(nova, 'categoria criada');
    assert.strictEqual(dom.getElementById('prod-category').value, nova.id);
  });

  console.log(falhas === 0 ? '\nTodos os testes de PDV passaram.' : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})();
