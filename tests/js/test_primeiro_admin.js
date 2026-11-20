// Primeiro administrador e apagar todos os dados (app.js com DOM simulado e servidor falso).
// Uso: node tests/js/test_primeiro_admin.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};

function criarAmbiente({ papel = 'admin', servidor }) {
  const elementos = {};
  const fabricar = (id) => {
    const classes = new Set();
    return {
      id, value: '', textContent: '', innerHTML: '', hidden: false, style: {}, dataset: {},
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; on ? classes.add(c) : classes.delete(c); return on; },
        contains: (c) => classes.has(c)
      },
      addEventListener: noop, appendChild: noop, removeChild: noop, click: noop, setAttribute: noop,
      querySelector: () => null, querySelectorAll: () => [], focus: noop, select: noop, remove: noop
    };
  };
  const ctx = {
    console: { log: noop, warn: noop, info: noop, error: noop },
    setTimeout: (fn) => { fn(); return 0; }, setInterval: noop, clearInterval: noop, clearTimeout: noop,
    requestAnimationFrame: noop, alert: noop, confirm: () => false,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    fetch: async () => ({ ok: false }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, RegExp,
    Blob: class { constructor(partes, opcoes) { this.partes = partes; this.type = opcoes && opcoes.type; } },
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    document: {
      getElementById: (id) => { if (!elementos[id]) elementos[id] = fabricar(id); return elementos[id]; },
      querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
      createElement: () => fabricar('a'),
      body: { appendChild: noop, removeChild: noop }, documentElement: fabricar('html'), readyState: 'complete'
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = noop; ctx.removeEventListener = noop;
  vm.createContext(ctx);
  for (const arq of ['estoque.js', 'edicao_venda.js', 'fiado.js', 'relatorios.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.setLoading = noop; app.updateBrand = noop; app.renderAll = noop;
  app.notificacoes = [];
  app.showNotification = (tipo, msg) => app.notificacoes.push({ tipo, msg });
  app.logAudit = (acao, detalhes) => { app.auditoria = (app.auditoria || []).concat([{ acao, detalhes }]); };
  app.state.currentUser = papel === 'admin' ? { id: 'U1', username: 'ana', role: 'admin' } : { id: 'U2', username: 'op', role: 'operador' };
  app.state.products = [{ id: 'P1', name: 'Arroz' }];
  app.state.customers = [{ id: 'C1', name: 'Ana' }];
  app.state.sales = []; app.state.dataLoaded = true;
  app.confirmacoes = [];
  app.confirmAction = (titulo, msg, cb) => { app.confirmacoes.push({ titulo, cb }); };
  app.servidor = servidor;
  // Elementos da tela criados de antemão, como no index.html
  ['setup-form', 'login-form', 'setup-nome', 'setup-usuario', 'setup-senha', 'setup-senha2', 'setup-error',
   'login-username', 'login-password', 'zona-perigo'].forEach((id) => ctx.document.getElementById(id));
  return { app, ctx, elementos, ls: ctx.localStorage };
}

function servidorFalso(extra = {}) {
  const s = {
    logado: true, enviadas: [], salvos: 0,
    precisaPrimeiroAdministrador: async () => true,
    criarPrimeiroAdministrador: async (dados) => { s.enviadas.push(dados); },
    limparTudo: async () => { s.limpou = (s.limpou || 0) + 1; },
    sair: async () => {},
    salvarAlteracoes: async () => { s.salvos++; },
    ...extra
  };
  return s;
}

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste('banco sem usuários mostra o formulário do primeiro administrador (e esconde o login)', async () => {
  const { app, elementos } = criarAmbiente({ servidor: servidorFalso() });
  await app.verificarPrimeiroAdministrador();
  assert.strictEqual(elementos['setup-form'].classList.contains('hidden'), false);
  assert.strictEqual(elementos['login-form'].classList.contains('hidden'), true);
});

teste('banco com usuários mostra o login normal', async () => {
  const { app, elementos } = criarAmbiente({ servidor: servidorFalso({ precisaPrimeiroAdministrador: async () => false }) });
  await app.verificarPrimeiroAdministrador();
  assert.strictEqual(elementos['setup-form'].classList.contains('hidden'), true);
  assert.strictEqual(elementos['login-form'].classList.contains('hidden'), false);
});

teste('servidor fora do ar na verificação não muda a tela de login', async () => {
  const { app, elementos } = criarAmbiente({ servidor: servidorFalso({ precisaPrimeiroAdministrador: async () => { throw new Error('offline'); } }) });
  await app.verificarPrimeiroAdministrador();
  assert.strictEqual(elementos['login-form'].classList.contains('hidden'), false);
});

teste('primeiro administrador: senhas diferentes ou curtas não chegam ao servidor', async () => {
  const servidor = servidorFalso();
  const { app, elementos } = criarAmbiente({ servidor });
  elementos['setup-nome'].value = 'Ana Silva';
  elementos['setup-usuario'].value = 'ana';
  elementos['setup-senha'].value = '123456';
  elementos['setup-senha2'].value = '654321';
  await app.handleSetupSubmit({ preventDefault: noop });
  assert.strictEqual(servidor.enviadas.length, 0, 'não envia com senhas diferentes');
  assert.ok(elementos['setup-error'].textContent.includes('não conferem'));

  elementos['setup-senha'].value = '123'; elementos['setup-senha2'].value = '123';
  await app.handleSetupSubmit({ preventDefault: noop });
  assert.strictEqual(servidor.enviadas.length, 0, 'não envia com senha curta');
  assert.ok(elementos['setup-error'].textContent.includes('6 caracteres'));
});

teste('primeiro administrador: criado no servidor e entra logo em seguida', async () => {
  const servidor = servidorFalso();
  const { app, elementos } = criarAmbiente({ servidor });
  const entrou = [];
  app.login = async (u, p) => { entrou.push([u, p]); };
  elementos['setup-nome'].value = ' Ana Silva ';
  elementos['setup-usuario'].value = ' ana ';
  elementos['setup-senha'].value = 'senha-forte';
  elementos['setup-senha2'].value = 'senha-forte';
  await app.handleSetupSubmit({ preventDefault: noop });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(servidor.enviadas)), [{ fullname: 'Ana Silva', username: 'ana', senha: 'senha-forte' }]);
  assert.deepStrictEqual(entrou, [['ana', 'senha-forte']]);
  assert.strictEqual(elementos['login-password'].value, '', 'senha não fica no campo depois de entrar');
});

teste('primeiro administrador: erro do servidor aparece no formulário (ex.: já existe usuário)', async () => {
  const servidor = servidorFalso({ criarPrimeiroAdministrador: async () => { throw new Error('Já existe um usuário cadastrado.'); } });
  const { app, elementos } = criarAmbiente({ servidor });
  app.login = async () => { throw new Error('não deveria entrar'); };
  elementos['setup-nome'].value = 'Ana'; elementos['setup-usuario'].value = 'ana';
  elementos['setup-senha'].value = 'senha-forte'; elementos['setup-senha2'].value = 'senha-forte';
  await app.handleSetupSubmit({ preventDefault: noop });
  assert.ok(elementos['setup-error'].textContent.includes('Já existe'));
});

teste('apagar tudo: só administrador; operador é barrado antes de qualquer confirmação', () => {
  const servidor = servidorFalso();
  const { app } = criarAmbiente({ papel: 'operador', servidor });
  app.limparTodosDados();
  assert.strictEqual(app.confirmacoes.length, 0);
  assert.strictEqual(servidor.limpou, undefined);
});

teste('apagar tudo: duas confirmações, depois limpa servidor, memória e navegador, e desconecta', async () => {
  const servidor = servidorFalso();
  const { app, elementos, ls } = criarAmbiente({ servidor });
  app.state.movimentacoes = [{ id: 'M1' }];
  app.state.users = [{ id: 'U1' }];
  app.state.settings = { companyName: 'Loja' };
  ls.setItem('sv_products', '[1]');
  ls.setItem('sv_audit_log', '[1]');

  app.limparTodosDados();
  assert.strictEqual(app.confirmacoes.length, 1, 'primeira confirmação');
  app.confirmacoes[0].cb(); // clique em Confirmar: abre a segunda
  assert.strictEqual(app.confirmacoes.length, 2, 'segunda confirmação');
  assert.strictEqual(servidor.limpou, undefined, 'nada apagado antes da segunda');
  await app.confirmacoes[1].cb();

  assert.strictEqual(servidor.limpou, 1);
  assert.strictEqual(app.state.dataLoaded, false, 'dados em memória não podem mais ser gravados');
  assert.strictEqual(app.state.products.length, 0);
  assert.strictEqual(app.state.users.length, 0);
  assert.strictEqual(app.state.currentUser, null, 'desconectado');
  assert.strictEqual(ls.getItem('sv_products'), null, 'dados locais removidos');
  assert.ok(ls.getItem('sv_audit_log'), 'auditoria mantida');
  assert.strictEqual(elementos['setup-form'].classList.contains('hidden'), false, 'volta para criar o primeiro administrador');
  assert.ok(app.auditoria.some((a) => a.acao === 'DADOS_APAGADOS'));
});

teste('apagar tudo: depois de apagar, nada é enviado ao servidor mesmo com dados em memória', async () => {
  const servidor = servidorFalso();
  const { app } = criarAmbiente({ servidor });
  app.limparTodosDados();
  app.confirmacoes[0].cb();
  await app.confirmacoes[1].cb();
  app.state.products.push({ id: 'P9', name: 'Novo' });
  const gravou = await app.salvarDados();
  assert.strictEqual(gravou, false);
  assert.strictEqual(servidor.salvos, 0);
});

teste('apagar tudo: falha do servidor mantém os dados e avisa', async () => {
  const servidor = servidorFalso({ limparTudo: async () => { throw new Error('Sessão expirada.'); } });
  const { app } = criarAmbiente({ servidor });
  app.limparTodosDados();
  app.confirmacoes[0].cb();
  await app.confirmacoes[1].cb();
  assert.strictEqual(app.state.dataLoaded, true);
  assert.strictEqual(app.state.products.length, 1, 'nada foi apagado da memória');
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error' && n.msg.includes('Sessão expirada')));
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de primeiro administrador passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
