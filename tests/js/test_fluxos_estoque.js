// Testa os fluxos de estoque/custo do app.js (entrada, venda, ajuste, edição, exclusões)
// com um DOM simulado. Uso: node tests/js/test_fluxos_estoque.js
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};
const el = new Proxy({}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : noop), set: () => true });
const ctx = {
  window: {}, console: { log: noop, warn: noop, error: noop, info: noop },
  document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [], addEventListener: noop, createElement: () => el, body: el, documentElement: el, readyState: 'complete' },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
  setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
  Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
  crypto: {}, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, 'estoque.js'), 'utf8'), ctx);
try { vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8') + '\n;globalThis.__app = app;', ctx, { timeout: 5000 }); }
catch (e) { console.log('AVISO ao carregar app.js:', e.message); }
const app = ctx.__app;
if (!app) { console.log('FALHA: app não exposto'); process.exit(1); }

// Evita efeitos de tela e de gravação
app.renderProducts = noop; app.renderEntradas = noop; app.renderHistory = noop; app.updateDashboardStats = noop;
app.showNotification = noop; app.logAudit = noop; app.updateNotifications = noop; app.setLoading = noop;
app.confirmAction = (t, m, cb) => { cb(); };
app.salvarDados = async () => {};

let falhas = 0;
function check(nome, cond) { console.log((cond ? 'OK   ' : 'FALHA') + ' ' + nome); if (!cond) falhas++; }
function reset() {
  app.state.dataLoaded = true;
  app.state.products = [{ id: 'P1', name: 'Café', stock: 0, cost: 0 }, { id: 'P2', name: 'Açúcar', stock: 0, cost: 0 }];
  app.state.movimentacoes = [];
  app.state.sales = []; app.state.entradas = []; app.state.reversals = [];
  app.state.cart = [];
}
const prod = (id) => app.state.products.find(p => p.id === id);

// Cadastro com estoque e custo
reset();
app.state.products = [];
app.state.products.push({ id: 'P1', name: 'Café', stock: 10, cost: 5 });
app.registrarMovimentacoes([ctx.Estoque.movimentoCadastro('P1', 10, 5)]);
check('cadastro gera saldo 10 e custo 5', prod('P1').stock === 10 && prod('P1').cost === 5);

// Entrada com custo diferente: média ponderada (10@5 + 10@15 = 10)
const ent = { id: 'EN1', nota: '123', items: [{ productId: 'P1', qty: 10, unitCost: 15 }] };
app.registrarMovimentacoes(ctx.Estoque.movimentosDaEntrada(ent));
check('entrada: estoque 20 e custo médio 10', prod('P1').stock === 20 && prod('P1').cost === 10);

// Venda: estoque cai, custo do produto não muda, custo fica registrado na venda
const venda = { id: 'V1', items: [{ id: 'P1', qty: 4, cost: prod('P1').cost }] };
app.registrarMovimentacoes(ctx.Estoque.movimentosDaVenda(venda));
check('venda: estoque 16 e custo continua 10', prod('P1').stock === 16 && prod('P1').cost === 10);

// Exclusão de venda: estorno devolve o estoque
app.registrarMovimentacoes(ctx.Estoque.movimentosDoEstorno(venda));
check('estorno de venda: estoque volta a 20', prod('P1').stock === 20);

// Ajuste rápido e ajuste que não muda nada (estoque não cai abaixo de zero)
app.registrarAjusteEstoque(prod('P1'), -1, 'teste');
check('ajuste -1: estoque 19', prod('P1').stock === 19);
app.state.products.push({ id: 'P3', name: 'Vazio', stock: 0, cost: 0 });
app.registrarMovimentacoes([ctx.Estoque.movimentoCadastro('P3', 0, 0)]);
const antes = app.state.movimentacoes.length;
const mudou = app.registrarAjusteEstoque(prod('P3'), -1, 'teste');
check('ajuste abaixo de zero não gera movimentação', mudou === false && app.state.movimentacoes.length === antes);

// Edição de produto: estoque e custo
const anterior = { ...prod('P1') };
const editado = { id: 'P1', name: 'Café', stock: 25, cost: 12, price: 1 };
app.state.products[app.state.products.indexOf(prod('P1'))] = editado;
app.registrarAlteracaoProduto(anterior, editado);
check('edição: estoque vira 25 e custo vira 12', editado.stock === 25 && editado.cost === 12);

// Exclusão de entrada: estoque e custo voltam ao que seriam sem a entrada
reset();
app.state.products = [{ id: 'P1', name: 'Café', stock: 0, cost: 0 }];
app.registrarMovimentacoes([ctx.Estoque.movimentoCadastro('P1', 10, 5)]);
const e1 = { id: 'EN1', items: [{ productId: 'P1', qty: 10, unitCost: 15 }] };
app.registrarMovimentacoes(ctx.Estoque.movimentosDaEntrada(e1));
app.state.entradas = [e1];
app.deleteEntrada('EN1');
check('exclusão de entrada: estoque 10 e custo 5 (como antes da entrada)', prod('P1').stock === 10 && prod('P1').cost === 5);
check('exclusão de entrada: entrada removida da lista', app.state.entradas.length === 0);

// Exclusão de entrada anterior ao histórico: só reduz quantidade
reset();
app.state.products = [{ id: 'P1', name: 'Café', stock: 8, cost: 4 }];
app.iniciarHistoricoEstoque();
const legado = { id: 'EN0', items: [{ productId: 'P1', qty: 3, unitCost: 9 }] };
app.state.entradas = [legado];
app.deleteEntrada('EN0');
check('exclusão de entrada legada: estoque 5 e custo 4', prod('P1').stock === 5 && prod('P1').cost === 4);

// Produtos antigos (sem histórico) ganham saldo inicial sem duplicar
reset();
app.state.products = [{ id: 'P1', name: 'Café', stock: 5, cost: 100 }];
app.iniciarHistoricoEstoque();
app.iniciarHistoricoEstoque();
check('iniciarHistoricoEstoque cria uma única base por produto', app.state.movimentacoes.length === 1);
check('base do produto antigo mantém estoque e custo', ctx.Estoque.calcular(app.state.movimentacoes, 'P1').stock === 5);

// Movimentações de venda com produto e custo, sem vazar NaN
reset();
app.state.products = [{ id: 'P1', name: 'Café', stock: 5, cost: 2 }];
app.iniciarHistoricoEstoque();
app.registrarMovimentacoes(ctx.Estoque.movimentosDaVenda({ id: 'V9', items: [{ id: 'P1', qty: 2, cost: 2 }] }));
check('venda sem NaN: estoque 3, custo 2', prod('P1').stock === 3 && prod('P1').cost === 2 && app.state.movimentacoes.every(m => !Number.isNaN(m.qtd)));

// Login desativado: sessão local de administrador, sem logout e sem passo de usuários no tutorial
app.state.currentUser = { ...app.config.usuarioLocal };
check('login desativado por padrão', app.config.loginAtivo === false);
check('usuário local é administrador', app.state.currentUser.role === 'admin');
check('requireAdmin passa com usuário local', app.requireAdmin('teste') === true);
app.logout();
check('logout não encerra a sessão local', app.state.currentUser !== null);
const passos = app.getTutorialDefinition().steps;
check('tutorial sem passo de usuários', passos.every(s => s.settingsSection !== 'usuarios'));

console.log(falhas ? '\n' + falhas + ' falha(s).' : '\nTodos os testes passaram.');
process.exit(falhas ? 1 : 0);
