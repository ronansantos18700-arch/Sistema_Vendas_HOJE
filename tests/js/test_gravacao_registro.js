// Etapa 3: gravação por registro. Testa carregarDados + salvarDados do app.js com um "servidor"
// em memória que aplica full/upsert/delete/order como o Database.ApplyChanges (C#).
// Cenário principal: dois computadores; um não pode apagar o que o outro gravou.
// Uso: node tests/js/test_gravacao_registro.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};
const el = new Proxy({}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : noop), set: () => true });

// Servidor em memória (mesmas regras do Database.ApplyChanges: tudo ou nada, em uma transação)
function novoServidor(dados) {
  const tabelas = {};
  for (const [nome, lista] of Object.entries(dados)) tabelas[nome] = JSON.parse(JSON.stringify(lista));
  const srv = {
    tabelas, falhar: false, recusarCom: null, chamadas: [],
    ler(tipo) { return JSON.stringify(tabelas[tipo] || []); },
    aplicar(json) {
      const payload = JSON.parse(json);
      srv.chamadas.push(payload);
      if (srv.recusarCom) { const e = new Error(srv.recusarCom.erro); e.status = 400; throw e; }
      if (srv.falhar) return false;
      const novo = JSON.parse(JSON.stringify(tabelas));
      for (const [nome, mud] of Object.entries(payload)) {
        if (mud.full) { novo[nome] = mud.full; continue; }
        let lista = (novo[nome] || []).slice();
        if (mud.delete) lista = lista.filter(i => !mud.delete.includes(String(i.id)));
        if (mud.upsert) for (const item of mud.upsert) {
          const idx = lista.findIndex(i => String(i.id) === String(item.id));
          if (idx >= 0) lista[idx] = item; else lista.push(item);
        }
        if (mud.order) {
          const pos = new Map(mud.order.map((id, i) => [String(id), i]));
          const listados = lista.filter(i => pos.has(String(i.id))).sort((a, b) => pos.get(String(a.id)) - pos.get(String(b.id)));
          const resto = lista.filter(i => !pos.has(String(i.id)));
          lista = listados.concat(resto); // registros desconhecidos do cliente vão para o fim
        }
        novo[nome] = lista;
      }
      for (const k of Object.keys(novo)) tabelas[k] = novo[k];
      return true;
    }
  };
  return srv;
}

const produtos = [
  { id: 'P1', name: 'Arroz', code: '1', cost: 5, price: 8, stock: 10, image: '', obs: '', category: '' },
  { id: 'P2', name: 'Feijão', code: '2', cost: 4, price: 7, stock: 10, image: '', obs: '', category: '' }
];
const vendasIniciais = [
  { id: 'V1', date: '2026-11-18', cliente: '', valor_total: 8, desconto: 0, valor_final: 8, cost: 5, lucro: 3, pagamento: 'dinheiro', items: [] },
  { id: 'V2', date: '2026-11-18', cliente: '', valor_total: 7, desconto: 0, valor_final: 7, cost: 4, lucro: 3, pagamento: 'dinheiro', items: [] }
];

function criarApp(srv, { timers = false } = {}) {
  const ctx = {
    window: {}, console: { log: noop, warn: noop, info: noop, error: noop },
    document: { getElementById: () => el, querySelector: () => el, querySelectorAll: () => [], addEventListener: noop, createElement: () => el, body: el, documentElement: el, readyState: 'complete' },
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    setTimeout: timers ? (fn) => { Promise.resolve().then(fn); return 0; } : noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, fetch: async () => ({ ok: false }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.window.chrome = { webview: { hostObjects: { bridge: {
    GetData: async (tipo) => srv.ler(tipo),
    SaveChanges: async (json) => srv.aplicar(json),
    SaveAll: async () => true, SaveData: async () => true
  } } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'estoque.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'sha256.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8') + '\n;globalThis.__app = app;', ctx, { timeout: 5000 });
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop; app.updateNotifications = noop;
  app.renderEstoque = noop;
  app.notificacoes = [];
  app.showNotification = (tipo, msg) => app.notificacoes.push({ tipo, msg });
  app.state.currentUser = { username: 'admin', role: 'admin' };
  return app;
}

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

function servidorComDados(extra = {}) {
  return novoServidor({
    products: produtos, customers: [], sales: vendasIniciais, settings: [{ id: 'S', storeName: 'Loja' }],
    reversals: [], entradas: [], categories: [], movimentacoes: [], users: [{ id: 'U1', fullname: 'Admin', username: 'admin', password: 'x', role: 'admin', isDefaultCredential: false }],
    ...extra
  });
}

teste('PC A grava sem apagar a venda que o PC B fez depois da leitura', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv);
  await a.carregarDados();
  // PC B registra uma venda depois que A leu os dados
  srv.tabelas.sales.push({ id: 'V3', date: '2026-11-19', cliente: 'B', valor_total: 9, desconto: 0, valor_final: 9, cost: 6, lucro: 3, pagamento: 'pix', items: [] });
  // PC A altera o preço do arroz e grava
  a.state.products[0].price = 9;
  assert.strictEqual(await a.salvarDados(), true);
  const vendasNoServidor = srv.tabelas.sales.map(v => v.id);
  assert.deepStrictEqual(vendasNoServidor, ['V1', 'V2', 'V3'], 'venda do PC B deve continuar');
  assert.strictEqual(srv.tabelas.products.find(p => p.id === 'P1').price, 9);
  const envio = srv.chamadas[srv.chamadas.length - 1];
  assert.ok(!('sales' in envio), 'não deve mandar vendas (nada mudou nelas)');
  assert.deepStrictEqual(envio.products.upsert.map(p => p.id), ['P1']);
});

teste('sem mudanças, a gravação não envia produtos nem vendas', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv);
  await a.carregarDados();
  assert.strictEqual(await a.salvarDados(), true);
  const envio = srv.chamadas[srv.chamadas.length - 1];
  assert.deepStrictEqual(Object.keys(envio).sort(), ['settings'], 'só as configurações vão sempre');
});

teste('exclusão de uma venda envia só o id excluído', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv);
  await a.carregarDados();
  srv.tabelas.sales.push({ id: 'V3', date: '2026-11-19', cliente: 'B', valor_total: 9, desconto: 0, valor_final: 9, cost: 6, lucro: 3, pagamento: 'pix', items: [] });
  a.state.sales = a.state.sales.filter(v => v.id !== 'V2');
  assert.strictEqual(await a.salvarDados(), true);
  assert.deepStrictEqual(srv.tabelas.sales.map(v => v.id), ['V1', 'V3']);
  const envio = srv.chamadas[srv.chamadas.length - 1];
  assert.deepStrictEqual(envio.sales.delete, ['V2']);
  assert.ok(!envio.sales.upsert, 'nenhuma venda regravada');
});

teste('falha na gravação mantém as mudanças pendentes para a próxima tentativa', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv);
  await a.carregarDados();
  a.state.products[1].stock = 3;
  srv.falhar = true;
  assert.strictEqual(await a.salvarDados(), false);
  srv.falhar = false;
  assert.strictEqual(await a.salvarDados(), true);
  assert.strictEqual(srv.tabelas.products.find(p => p.id === 'P2').stock, 3);
});

teste('mudança feita durante a gravação não se perde', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv);
  await a.carregarDados();
  a.state.products[0].price = 9;
  const aplicarOriginal = srv.aplicar;
  srv.aplicar = (json) => {
    const resultado = aplicarOriginal(json);
    // enquanto a gravação "está no ar", o usuário cadastra outro produto
    a.state.products.push({ id: 'P5', name: 'Sal', code: '5', cost: 1, price: 2, stock: 4, image: '', obs: '', category: '' });
    return resultado;
  };
  assert.strictEqual(await a.salvarDados(), true);
  assert.ok(!srv.tabelas.products.find(p => p.id === 'P5'), 'P5 ainda não foi enviado nesta rodada');
  srv.aplicar = aplicarOriginal;
  assert.strictEqual(await a.salvarDados(), true);
  assert.ok(srv.tabelas.products.find(p => p.id === 'P5'), 'P5 foi enviado na gravação seguinte');
});

teste('gravações em sequência não repetem a mesma mudança', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv);
  await a.carregarDados();
  a.state.products[0].price = 9;
  const [r1, r2] = await Promise.all([a.salvarDados(), a.salvarDados()]);
  assert.deepStrictEqual([r1, r2], [true, true]);
  const envios = srv.chamadas.filter(c => c.products);
  assert.strictEqual(envios.length, 1, 'a segunda gravação não tem nada novo para products');
});

teste('sem carregar os dados, gravar é recusado (não manda a tabela inteira)', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv);
  a.state.dataLoaded = true;
  a.state.products = [{ id: 'X', name: 'Local', code: '', cost: 0, price: 1, stock: 1, image: '', obs: '', category: '' }];
  assert.strictEqual(await a.salvarDados(), false);
  assert.strictEqual(srv.chamadas.length, 0, 'nenhuma chamada ao servidor');
  assert.ok(a.notificacoes.some(n => n.tipo === 'error' && /carregad/.test(n.msg)));
});

teste('usuário padrão criado no primeiro uso é gravado no banco', async () => {
  const srv = servidorComDados({ users: [] });
  const a = criarApp(srv);
  await a.carregarDados();
  assert.ok(srv.tabelas.users.find(u => u.username === 'admin' && u.isDefaultCredential === true), 'admin padrão no banco');
});

teste('servidor recusa (estoque insuficiente): mostra o motivo, recarrega e não reenvia a venda', async () => {
  const srv = servidorComDados();
  const a = criarApp(srv, { timers: true });
  await a.carregarDados();
  a.state.sales.push({ id: 'V9', date: '2026-11-19', cliente: '', valor_total: 8, desconto: 0, valor_final: 8, cost: 5, lucro: 3, pagamento: 'dinheiro', items: [] });
  srv.recusarCom = { erro: 'Estoque insuficiente para "Arroz". Nada foi gravado.' };
  assert.strictEqual(await a.salvarDados(), false);
  await new Promise(r => setImmediate(r));
  assert.ok(a.notificacoes.some(n => n.tipo === 'error' && /Estoque insuficiente para "Arroz"/.test(n.msg)), 'motivo mostrado');
  assert.ok(!a.state.sales.some(v => v.id === 'V9'), 'venda recusada sai da tela após recarregar');
  srv.recusarCom = null;
  const enviosAntes = srv.chamadas.length;
  assert.strictEqual(await a.salvarDados(), true);
  const envio = srv.chamadas[srv.chamadas.length - 1];
  assert.ok(srv.chamadas.length === enviosAntes + 1 && !('sales' in envio), 'próxima gravação não reenvia a venda recusada');
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de gravação por registro passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
