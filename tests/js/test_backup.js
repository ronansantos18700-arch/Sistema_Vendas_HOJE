// Testa a validação de backup e a restauração (aplicarBackup) com a bridge simulada.
// Garante que um arquivo ruim não altera dados e que uma falha de gravação reverte o estado.
// Uso: node tests/js/test_backup.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const B = require(path.join(base, 'backup.js'));
const noop = () => {};
const el = new Proxy({}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : noop), set: () => true });

let falhas = 0;
function teste(nome, fn) {
  return Promise.resolve().then(fn).then(() => console.log('OK    ' + nome), (e) => { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); });
}

function backupValido(extra = {}) {
  return Object.assign({
    version: 'SV_ULTRA_V4_IMG', date: '2026-11-14T10:00:00.000Z', exportedAt: '2026-11-14T10:00:00.000Z',
    state: {
      products: [{ id: 'P9', name: 'Chá', cost: 5, price: 9, stock: 3 }],
      customers: [{ id: 'C9', name: 'Bia' }],
      sales: [],
      reversals: [], entradas: [], movimentacoes: [], categories: [],
      settings: { companyName: 'Loja do Backup' }
    },
    media: {}
  }, extra);
}

function criarApp(opcoes = {}) {
  const erros = []; const notificacoes = []; const timers = [];
  const ctx = {
    window: {}, console: { log: noop, warn: noop, info: noop, error: (...a) => erros.push(a.join(' ')) },
    document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [], addEventListener: noop, createElement: () => el, body: el, documentElement: el, readyState: 'complete' },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    setTimeout: (fn) => timers.push(fn), setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.window.chrome = { webview: { hostObjects: { bridge: {
    GetData: async () => '[]', SaveAll: async () => true, RestoreImage: async () => true,
    SaveChanges: async () => opcoes.gravacaoOk !== false
  } } } };
  vm.createContext(ctx);
  for (const arq of ['estoque.js', 'backup.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop; app.updateNotifications = noop;
  app.showNotification = (tipo, msg) => notificacoes.push({ tipo, msg });
  app.state.dataLoaded = true;
  app.state.currentUser = { username: 'admin', role: 'admin' };
  app.state.products = [{ id: 'P1', name: 'Café', cost: 20, price: 30, stock: 80 }];
  app.state.customers = []; app.state.sales = []; app.state.reversals = []; app.state.entradas = [];
  app.state.movimentacoes = []; app.state.categories = []; app.state.settings = { companyName: 'Loja Atual' };
  return { app, notificacoes, timers, erros };
}

(async () => {
  await teste('backup válido passa e informa contagens', () => {
    const r = B.validarBackup(backupValido());
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.contagem.products, 1);
    assert.strictEqual(r.contagem.customers, 1);
    assert.strictEqual(r.contagem.entradas, 0);
  });

  await teste('recusa arquivo que não é backup', () => {
    assert.strictEqual(B.validarBackup(null).ok, false);
    assert.strictEqual(B.validarBackup([1, 2]).ok, false);
    assert.strictEqual(B.validarBackup({ foo: 1 }).ok, false);
  });

  await teste('recusa versão incompatível', () => {
    assert.match(B.validarBackup(backupValido({ version: 'OUTRA' })).erro, /incompatível/);
  });

  await teste('recusa backup sem products, customers ou sales (não apaga dados)', () => {
    for (const nome of ['products', 'customers', 'sales']) {
      const b = backupValido();
      delete b.state[nome];
      assert.strictEqual(B.validarBackup(b).ok, false, nome);
    }
  });

  await teste('recusa coleção com formato errado', () => {
    const b = backupValido(); b.state.sales = { id: 1 };
    assert.strictEqual(B.validarBackup(b).ok, false);
    const c = backupValido(); c.state.products = ['texto'];
    assert.strictEqual(B.validarBackup(c).ok, false);
  });

  await teste('aceita backup antigo sem coleções opcionais', () => {
    const b = backupValido(); delete b.state.movimentacoes; delete b.state.entradas; delete b.state.categories; delete b.state.reversals;
    assert.strictEqual(B.validarBackup(b).ok, true);
  });

  await teste('recusa checksum que não confere', () => {
    const b = backupValido({ checksum: 'abc' });
    assert.strictEqual(B.validarBackup(b, 'xyz').ok, false);
    assert.strictEqual(B.validarBackup(b, 'abc').ok, true);
  });

  await teste('restauração com gravação bem-sucedida troca dados e agenda recarga', async () => {
    const { app, notificacoes, timers } = criarApp();
    await app.aplicarBackup(backupValido(), 'b.json');
    assert.strictEqual(app.state.products[0].name, 'Chá');
    assert.strictEqual(app.state.settings.companyName, 'Loja do Backup');
    assert.strictEqual(timers.length, 1, 'recarga agendada');
    assert.ok(notificacoes.some(n => n.tipo === 'success'));
  });

  await teste('falha na gravação reverte o estado e não recarrega', async () => {
    const { app, notificacoes, timers } = criarApp({ gravacaoOk: false });
    const antes = app.state.products;
    await app.aplicarBackup(backupValido(), 'b.json');
    assert.strictEqual(app.state.products, antes, 'mesma referência de antes');
    assert.strictEqual(app.state.products[0].name, 'Café');
    assert.strictEqual(app.state.settings.companyName, 'Loja Atual');
    assert.strictEqual(timers.length, 0, 'sem recarga');
    assert.ok(notificacoes.some(n => n.tipo === 'error' && /Nada foi alterado/.test(n.msg)));
    assert.ok(!notificacoes.some(n => n.tipo === 'success'));
  });

  await teste('salvarDados devolve false quando o banco recusa', async () => {
    const { app } = criarApp({ gravacaoOk: false });
    assert.strictEqual(await app.salvarDados(), false);
  });

  await teste('salvarDados devolve true quando o banco grava', async () => {
    const { app } = criarApp();
    assert.strictEqual(await app.salvarDados(), true);
  });

  console.log(falhas === 0 ? '\nTodos os testes de backup passaram.' : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})();
