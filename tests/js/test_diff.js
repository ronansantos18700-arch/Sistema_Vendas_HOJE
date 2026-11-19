const fs = require('fs'); const path = require('path'); const vm = require('vm');
// Uso: node tests/js/test_diff.js [caminho/do/app.js]
const APP_JS = process.argv[2] || path.join(__dirname, '../../SistemaVendas/frontend/app.js');
const src = fs.readFileSync(APP_JS, 'utf8');
const noop = () => {};
const el = new Proxy({}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : noop), set: () => true });
const ctx = {
  window: {}, console: { log: noop, warn: noop, error: noop, info: noop },
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [], addEventListener: noop, createElement: () => el, body: el, documentElement: el, readyState: 'complete' },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
  Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
  crypto: {}, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
try {
  vm.runInContext(src + '\n;globalThis.__app = app;', ctx, { timeout: 5000 });
} catch (e) { console.log('AVISO ao carregar (ignorado se não for de lógica):', e.message); }
const app = ctx.__app;
if (!app) { console.log('FALHA: objeto app não exposto'); process.exit(1); }

let falhas = 0;
function check(nome, cond) { console.log((cond ? 'OK   ' : 'FALHA') + ' ' + nome); if (!cond) falhas++; }
const J = (x) => JSON.stringify(x);

// Lista e snapshot
const lista = () => [ { id: 'P1', name: 'A', stock: 5 }, { id: 'P2', name: 'B', stock: 2 } ];
let base = lista();
let snapBase = app.snapshotDaLista(base);
check('sem mudança -> null', app.montarMudancas(lista(), snapBase) === null);

let mod = lista(); mod[0].stock = 4;
let m1 = app.montarMudancas(mod, snapBase);
check('alteração -> upsert só do registro alterado', m1 && m1.upsert.length === 1 && m1.upsert[0].id === 'P1' && !m1.delete && !m1.order);

let nov = lista(); nov.push({ id: 'P3', name: 'C', stock: 1 });
let m2 = app.montarMudancas(nov, snapBase);
check('novo registro -> upsert + order', m2 && m2.upsert.length === 1 && m2.upsert[0].id === 'P3' && m2.order.join() === 'P1,P2,P3');

let sem = lista().slice(1);
let m3 = app.montarMudancas(sem, snapBase);
check('exclusão -> delete com o id removido', m3 && m3.delete.join() === 'P1' && m3.order.join() === 'P2');

let invertida = lista().reverse();
let m4 = app.montarMudancas(invertida, snapBase);
check('só reordenação -> order sem upsert', m4 && !m4.upsert && !m4.delete && m4.order.join() === 'P2,P1');

let dup = [{ id: 'P1' }, { id: 'P1' }];
check('ids repetidos -> full (regrava tudo)', J(app.montarMudancas(dup, snapBase)) === J({ full: dup }));
check('snapshot com ids repetidos -> null', app.snapshotDaLista(dup) === null);
check('sem snapshot -> full', J(app.montarMudancas(lista(), null)) === J({ full: lista() }));

// Criar snapshot de todas as coleções
const colecoes = { products: lista(), customers: [], sales: [] };
const snapAll = app.criarSnapshot(colecoes);
check('criarSnapshot cobre todas as coleções', snapAll && snapAll.colecoes.products && snapAll.colecoes.customers && snapAll.colecoes.sales);
check('criarSnapshot com duplicado -> null', app.criarSnapshot({ products: dup }) === null);

// Simula sequência: grava, muda, grava de novo (o snapshot deve acompanhar)
let estado = lista();
let snap = app.criarSnapshot({ products: estado });
estado[1].stock = 99;
let mA = app.montarMudancas(estado, snap.colecoes.products);
snap = app.criarSnapshot({ products: estado });
let mB = app.montarMudancas(estado, snap.colecoes.products);
check('após gravar, nova gravação sem mudança -> null', mA && mA.upsert && mB === null);

console.log(falhas === 0 ? '\nTodos os testes passaram.' : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
