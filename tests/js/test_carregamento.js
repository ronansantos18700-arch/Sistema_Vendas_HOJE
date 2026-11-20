// Testa o carregamento inicial (carregarDados) com uma bridge simulada.
// Garante que o app abre com os dados do banco e não cai em "Erro fatal ao carregar dados".
// Uso: node tests/js/test_carregamento.js
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};
const el = new Proxy({}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : noop), set: () => true });

const erros = [];
const notificacoes = [];

function criarContexto(bridgeDados, gravados) {
  const ctx = {
    window: {}, console: { log: noop, warn: noop, info: noop, error: (...a) => erros.push(a.join(' ')) },
    document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [], addEventListener: noop, createElement: () => el, body: el, documentElement: el, readyState: 'complete' },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, fetch: async () => ({ ok: false, json: async () => ({}) }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.window.chrome = { webview: { hostObjects: { bridge: {
    GetData: async (tipo) => {
      if (bridgeDados.__falha) throw new Error('banco indisponível');
      return tipo in bridgeDados ? bridgeDados[tipo] : '[]';
    },
    SaveChanges: async (json) => { if (gravados) gravados.push(json); return true; }, SaveAll: async () => true
  } } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'estoque.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'fiado.js'), 'utf8'), ctx); // carregado antes do app, como no index.html
  vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8') + '\n;globalThis.__app = app;', ctx, { timeout: 5000 });
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop;
  app.showNotification = (tipo, msg) => notificacoes.push({ tipo, msg });
  if (!gravados) app.salvarDados = async () => {}; // com `gravados`, o salvarDados real roda e a bridge registra o que foi enviado
  return app;
}

let falhas = 0;
function check(nome, cond) { console.log((cond ? 'OK   ' : 'FALHA') + ' ' + nome); if (!cond) falhas++; }

(async () => {
  const dados = {
    products: JSON.stringify([{ id: 'P1', name: 'Café', code: '1', cost: 20, price: 30, stock: 80 }]),
    customers: JSON.stringify([{ id: 'C1', name: 'Ana' }]),
    sales: JSON.stringify([{ id: 'V1', date: new Date().toISOString(), pagamento: 'pix', valor_final: 30, items: [] }]),
    settings: JSON.stringify([{ companyName: 'Loja Teste' }]),
    reversals: '[]',
    users: JSON.stringify([{ id: 'U1', username: 'admin', password: 'x', role: 'admin', fullname: 'Admin' }]),
    entradas: '[]',
    categories: '[]',
    movimentacoes: '[]'
  };
  const app = criarContexto(dados);
  await app.carregarDados();

  check('nenhum erro no console ao carregar', erros.length === 0);
  check('nenhuma notificação de erro fatal', !notificacoes.some(n => n.tipo === 'error'));
  check('produtos carregados do banco', app.state.products.length === 1 && app.state.products[0].name === 'Café');
  check('clientes carregados do banco', app.state.customers.length === 1);
  check('vendas carregadas do banco', app.state.sales.length === 1 && app.state.sales[0].valor_final === 30);
  check('configurações carregadas do banco', app.state.settings.companyName === 'Loja Teste');
  check('usuários carregados do banco', app.state.users.length === 1 && app.state.users[0].username === 'admin');
  check('estado marcado como carregado', app.state.dataLoaded === true);

  // Banco vazio: deve iniciar sem erro (cria admin padrão)
  erros.length = 0; notificacoes.length = 0;
  const vazio = criarContexto({});
  await vazio.carregarDados();
  check('banco vazio carrega sem erro', erros.length === 0 && !notificacoes.some(n => n.tipo === 'error'));
  check('banco vazio não cria admin padrão (o primeiro administrador é criado pelo formulário)', vazio.state.users.length === 0);

  // Primeira gravação depois de carregar: manda só a venda alterada, não as tabelas inteiras
  // (senão regravaria por cima de um recebimento lançado em outro terminal).
  const gravados = [];
  const real = criarContexto(dados, gravados);
  await real.carregarDados();
  real.state.sales[0].valor_final = 35;
  await real.salvarDados();
  const enviado = gravados.length ? JSON.parse(gravados[gravados.length - 1]) : {};
  check('gravação após carregar: vendas só com a alteração (upsert, sem full)', !!enviado.sales && Array.isArray(enviado.sales.upsert) && enviado.sales.upsert.length === 1 && !enviado.sales.full);
  check('gravação após carregar: produtos sem mudança não são enviados', !('products' in enviado));

  // Leitura que falha: a memória não é o banco, então nada pode ser gravado (nem com dados em memória).
  const gravadosFalha = [];
  const falha = criarContexto({ ...dados, __falha: true }, gravadosFalha);
  notificacoes.length = 0;
  await falha.carregarDados();
  check('leitura falhou: dados não marcados como carregados', falha.state.dataLoaded === false);
  falha.state.products.push({ id: 'P9', name: 'Novo', code: '9', cost: 1, price: 2, stock: 1 });
  const gravouFalha = await falha.salvarDados();
  check('leitura falhou: salvar recusa e não envia nada ao banco', gravouFalha === false && gravadosFalha.length === 0);
  check('leitura falhou: usuário é avisado quando há dados em memória', notificacoes.some(n => n.tipo === 'error' && n.msg.includes('Nenhuma alteração foi gravada')));

  console.log(falhas === 0 ? 'Todos os testes passaram.' : `${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch(e => { console.log('FALHA inesperada:', e.stack || e.message); process.exit(1); });
