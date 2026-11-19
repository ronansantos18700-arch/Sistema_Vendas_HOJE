// Testa o monitor do servidor (app.js): aviso de queda, recuperação, sessão perdida e origem dos dados.
// Usa o mesmo ambiente simulado de test_fluxos_estoque.js. Uso: node tests/js/test_monitor_servidor.js
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};
const el = new Proxy({}, { get: (t, k) => (k === 'value' ? '' : k === 'classList' ? { add: noop, remove: noop, toggle: noop, contains: () => false } : noop), set: () => true });

const avisos = {};
const corpo = { filhos: [], appendChild(x) { this.filhos.push(x); if (x.id) avisos[x.id] = x; return x; } };
const ctx = {
  window: {}, console: { log: noop, warn: noop, error: noop, info: noop },
  document: {
    getElementById: (id) => avisos[id] || null,
    querySelector: () => el, querySelectorAll: () => [], addEventListener: noop,
    createElement: () => ({ style: {}, children: [], append(...a) { this.children.push(...a); }, appendChild(c) { this.children.push(c); }, setAttribute: noop,
      remove() { if (this.id) delete avisos[this.id]; } }),
    body: corpo, documentElement: el, readyState: 'complete'
  },
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
  setTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
  Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  alert: noop, confirm: () => false, fetch: async () => ({ ok: false }),
  crypto: {}, TextEncoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(base, 'estoque.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(base, 'sha256.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(base, 'app.js'), 'utf8') + '\n;globalThis.__app = app;', ctx, { timeout: 5000 });
const app = ctx.__app;

let chamadas, erros, notas, fake;
function preparar({ logado = false, sessaoOk = true, salvarOk = true } = {}) {
  chamadas = []; erros = []; notas = [];
  for (const k of Object.keys(avisos)) delete avisos[k];
  corpo.filhos.length = 0;
  fake = {
    caido: false, url: 'http://srv:5080', logado, sessaoOk,
    verificarConexao: async () => !fake.caido,
    sessaoValida: async () => fake.sessaoOk,
    sair: async () => {},
    lerDados: async (tipo) => '[]'
  };
  app.servidor = fake;
  app.config.loginAtivo = true;
  app.state.currentUser = logado ? { username: 'op', role: 'operador' } : null;
  app.state.dataLoaded = true;
  app.servidorCaido = false;
  app.verificandoServidor = false;
  app.setLoading = noop;
  app.showNotification = (tipo, msg) => notas.push(tipo + ':' + msg);
  app.showLoginError = (msg) => erros.push(msg);
  app.logout = () => { chamadas.push('logout'); app.state.currentUser = null; };
  app.salvarDados = async () => { chamadas.push('salvar'); return salvarOk; };
  app.carregarDados = async () => { chamadas.push('carregar'); };
}

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste('origemDeDados usa o servidor quando configurado, mesmo sem sessão', async () => {
  preparar({ logado: false });
  ctx.SvServidor = { origemDeDados: (s) => ({ noServidor: s === fake }) };
  assert.deepStrictEqual(app.origemDeDados(), { noServidor: true });
});

teste('origemDeDados sem servidor e sem ponte devolve null (nada de banco local)', async () => {
  preparar();
  app.servidor = null;
  assert.strictEqual(app.origemDeDados(), null);
});

teste('queda: mostra aviso uma única vez e marca o servidor como caído', async () => {
  preparar({ logado: true });
  fake.caido = true;
  await app.verificarServidor();
  await app.verificarServidor();
  assert.ok(avisos['servidor-indisponivel'], 'aviso deveria existir');
  assert.strictEqual(corpo.filhos.length, 1, 'aviso só pode ser criado uma vez');
  assert.strictEqual(app.servidorCaido, true);
  assert.deepStrictEqual(chamadas, [], 'não grava nem recarrega enquanto cai');
});

teste('recuperação com sessão válida: grava pendências, recarrega e tira o aviso', async () => {
  preparar({ logado: true, sessaoOk: true });
  fake.caido = true;
  await app.verificarServidor();
  fake.caido = false;
  await app.verificarServidor();
  assert.strictEqual(avisos['servidor-indisponivel'], undefined, 'aviso deveria sair');
  assert.deepStrictEqual(chamadas, ['salvar', 'carregar'], 'grava antes de recarregar');
  assert.strictEqual(app.servidorCaido, false);
});

teste('recuperação com sessão perdida (servidor reiniciou): volta ao login com aviso', async () => {
  preparar({ logado: true, sessaoOk: false });
  fake.caido = true;
  await app.verificarServidor();
  fake.caido = false;
  await app.verificarServidor();
  assert.deepStrictEqual(chamadas, ['logout']);
  assert.ok(erros.some(m => /reiniciado/.test(m)), 'mensagem de sessão perdida');
});

teste('se a gravação falhar na volta, não recarrega (não perde o que está na tela)', async () => {
  preparar({ logado: true, sessaoOk: true, salvarOk: false });
  fake.caido = true;
  await app.verificarServidor();
  fake.caido = false;
  await app.verificarServidor();
  assert.deepStrictEqual(chamadas, ['salvar'], 'carregar não pode rodar');
});

teste('recuperação sem ninguém logado: só tira o aviso', async () => {
  preparar({ logado: false });
  fake.caido = true;
  await app.verificarServidor();
  fake.caido = false;
  await app.verificarServidor();
  assert.strictEqual(avisos['servidor-indisponivel'], undefined);
  assert.deepStrictEqual(chamadas, []);
});

teste('checksum do backup sem crypto.subtle usa o SHA-256 em JS (mesmo valor)', async () => {
  preparar();
  const dados = { state: { produtos: [{ id: 'P1', nome: 'Ração' }] } };
  const esperado = require('crypto').createHash('sha256').update(JSON.stringify(dados), 'utf8').digest('hex');
  assert.strictEqual(await app.generateChecksum(dados), esperado);
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes do monitor passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
