// Fase 3: entradas e vendas sobre as movimentações.
// Uso: node tests/js/test_fase3.js
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};

function criarApp() {
  const campos = {};
  const elemento = (id) => (campos[id] = campos[id] || { value: '', textContent: '', innerHTML: '', classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, focus: noop, style: {}, addEventListener: noop });
  const ctx = {
    window: {}, console: { log: noop, warn: noop, info: noop, error: noop },
    document: { getElementById: elemento, querySelector: () => elemento('x'), querySelectorAll: () => [], addEventListener: noop, createElement: () => elemento('x'), body: elemento('body'), documentElement: elemento('html'), readyState: 'complete' },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'estoque.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'resumo.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8') + '\n;globalThis.__app = app;', ctx, { timeout: 5000 });
  const app = ctx.__app;
  Object.assign(app, {
    renderProducts: noop, renderEntradas: noop, renderHistory: noop, renderCart: noop, updateDashboardStats: noop,
    showNotification: noop, logAudit: noop, updateNotifications: noop, setLoading: noop, closeModal: noop, openModal: noop,
    salvarDados: async () => {}, initLucide: noop, renderEntradaItemsTemp: noop, calculateTotals: noop
  });
  app.state.dataLoaded = true;
  app.state.products = [{ id: 'P1', name: 'Café', stock: 0, cost: 0, price: 30 }];
  app.state.movimentacoes = []; app.state.sales = []; app.state.entradas = []; app.state.reversals = []; app.state.cart = [];
  app.state.posState = { isDirectSale: true };
  return { app, campos, Estoque: ctx.Estoque };
}

let falhas = 0;
function check(nome, cond) { console.log((cond ? 'OK   ' : 'FALHA') + ' ' + nome); if (!cond) falhas++; }

function lancarItem(app, campos, qty, custo) {
  campos['entrada-produto'] = { value: 'P1' };
  campos['entrada-qty'] = { value: String(qty) };
  campos['entrada-custo-unit'] = { value: String(custo) };
  app.adicionarItemEntrada();
}

(async () => {
  // --- Entrada com o mesmo produto em duas linhas ---
  {
    const { app, campos } = criarApp();
    lancarItem(app, campos, 10, 20);
    lancarItem(app, campos, 10, 30);
    check('entrada: mesmo produto vira duas linhas', app.entradaItemsTemp.length === 2);
    check('entrada: cada linha mantém o próprio custo', app.entradaItemsTemp[0].unitCost === 20 && app.entradaItemsTemp[1].unitCost === 30);

    campos['entrada-fornecedor'] = { value: 'Fornecedor X' };
    campos['entrada-nota'] = { value: '123' };
    campos['entrada-obs'] = { value: '' };
    await app.handleEntradaSubmit();

    const p = app.state.products[0];
    check('entrada registrada: estoque 20', p.stock === 20);
    check('entrada registrada: custo médio 25 ((10×20 + 10×30) / 20)', p.cost === 25);
    check('entrada registrada: total de custo 500', app.state.entradas.length === 1 && app.state.entradas[0].totalCusto === 500);
  }

  // --- Venda usa o custo atual do produto, não o do momento em que entrou no carrinho ---
  {
    const { app, Estoque } = criarApp();
    const p = app.state.products[0];
    p.stock = 10; p.cost = 5;
    app.state.movimentacoes.push(Estoque.movimentoCadastro('P1', 10, 5));

    app.addToCart('P1', 2);      // entra no carrinho com custo 5
    p.cost = 8;                  // uma entrada muda o custo médio com o carrinho aberto
    app.finishSale();

    check('venda: custo total usa o custo atual (8 × 2 = 16)', app.state.pendingSale.cost === 16);
    check('venda: item carrega o custo atual', app.state.pendingSale.items[0].cost === 8);
    check('venda: lucro com custo atual (60 − 16 = 44)', app.state.pendingSale.lucro === 44);
    check('venda: carrinho original não foi alterado', app.state.cart[0].cost === 5);
  }

  console.log(falhas === 0 ? 'Todos os testes passaram.' : `${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.log('FALHA inesperada:', e.stack || e.message); process.exit(1); });
