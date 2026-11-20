// Integração: Fiado no app.js com DOM simulado (PDV, clientes, recebimento, exclusão).
// Uso: node tests/js/test_fiado_app.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const F = require(path.join(base, 'fiado.js'));
const noop = () => {};

function criarAmbiente({ customers, sales, cart, pagamento = 'fiado', cliente = 'Ana' }) {
  const elementos = {};
  const fabricar = (id) => {
    const classes = new Set();
    return {
      id, value: '', textContent: '', innerHTML: '', hidden: false, style: {}, dataset: {},
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; on ? classes.add(c) : classes.delete(c); return on; },
        contains: (c) => classes.has(c), _set: classes
      },
      addEventListener: noop, appendChild: noop, removeChild: noop, click: noop, setAttribute: noop,
      querySelector: () => null, querySelectorAll: () => [], focus: noop, select: noop
    };
  };
  const ctx = {
    console: { log: noop, warn: noop, info: noop, error: noop },
    setTimeout: (fn) => { fn(); return 0; }, setInterval: noop, clearInterval: noop, clearTimeout: noop,
    requestAnimationFrame: noop, alert: noop, confirm: () => false,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    fetch: async () => ({ ok: false }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, RegExp,
    Blob: class { constructor(partes, opcoes) { this.partes = partes; this.type = opcoes && opcoes.type; } },
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    document: {
      getElementById: (id) => {
        if (!elementos[id]) elementos[id] = fabricar(id);
        return elementos[id];
      },
      querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
      createElement: () => fabricar('a'),
      body: { appendChild: noop, removeChild: noop }, documentElement: fabricar('html'), readyState: 'complete'
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = noop; ctx.removeEventListener = noop;
  ctx.window.chrome = { webview: { hostObjects: { bridge: { GetData: async () => '[]', SaveChanges: async () => true, SaveAll: async () => true, SaveData: async () => true } } } };
  vm.createContext(ctx);
  for (const arq of ['estoque.js', 'edicao_venda.js', 'fiado.js', 'relatorios.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.requirePasswordChange = () => false;
  app.setLoading = noop; app.updateBrand = noop; app.updateNotifications = noop;
  app.renderHistory = noop; app.updateDashboardStats = noop; app.renderDashboard = noop;
  app.notificacoes = [];
  app.showNotification = (tipo, msg) => app.notificacoes.push({ tipo, msg });
  app.state.currentUser = { role: 'admin', username: 'teste' };
  app.state.products = [{ id: 'P1', name: 'Arroz', stock: 10, cost: 5 }];
  app.state.movimentacoes = [];
  app.state.customers = customers;
  app.state.sales = sales;
  app.state.cart = cart || [];
  app.state.settings = { companyName: 'Loja' };
  app.state.reversals = [];
  app.state.dataLoaded = true;
  app.logAudit = (acao, detalhes) => { app.auditoria = (app.auditoria || []).concat([{ acao, detalhes }]); };
  app.salvos = 0;
  app.salvarDados = async () => { app.salvos++; return true; };
  app.confirmacoes = 0;
  app.confirmAction = (titulo, msg, cb) => { app.confirmacoes++; app.ultimaConfirmacao = cb; };
  ctx.document.getElementById('pos-payment').value = pagamento;
  ctx.document.getElementById('pos-customer').value = cliente;
  return { app, ctx, elementos };
}

const clientes = () => [{ id: 'C1', name: 'Ana' }, { id: 'C2', name: 'Beto' }];
const venda = (id, nome, valor, data, extra = {}) => Object.assign({
  id, cliente: nome, valor_final: valor, valor_total: valor, desconto: 0, cost: 0, lucro: valor,
  date: data, pagamento: 'fiado', items: [{ id: 'P1', name: 'Arroz', qty: 1, price: valor, cost: 0 }]
}, extra);
const carrinho = () => [{ id: 'P1', name: 'Arroz', price: 100, cost: 5, qty: 1 }];

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste('PDV: venda fiado sem cliente cadastrado é recusada', async () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [], cart: carrinho(), cliente: 'Consumidor Final' });
  await app.finishSale();
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error' && n.msg.includes('cliente cadastrado')));
  assert.strictEqual(app.state.pendingSale, undefined);
});

teste('PDV: venda fiado com cliente vira pagamento a prazo, com lista de recebimentos vazia', async () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [], cart: carrinho(), cliente: 'Ana' });
  await app.finishSale();
  assert.ok(app.state.pendingSale, 'venda pendente criada');
  assert.strictEqual(app.state.pendingSale.pagamento, 'fiado');
  assert.ok(Array.isArray(app.state.pendingSale.recebimentos) && app.state.pendingSale.recebimentos.length === 0);
  assert.strictEqual(app.state.pendingSale.cliente, 'Ana');
  assert.strictEqual(app.state.pendingSale.valor_final, 100, 'receita cheia na data da venda');
});

teste('histórico: venda fiado mostra o saldo em aberto ou quitado', () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [] });
  assert.ok(app.rotuloPagamento(venda('V1', 'Ana', 100, '2026-11-10', { recebimentos: [{ valor: 60 }] })).includes('Fiado · em aberto'));
  assert.strictEqual(app.rotuloPagamento(venda('V2', 'Ana', 100, '2026-11-10', { recebimentos: [{ valor: 100 }] })), 'Fiado · quitado');
});

teste('clientes: mostra o saldo em aberto e o botão Receber só para quem deve', () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00'), venda('V2', 'Beto', 50, '2026-11-11T10:00:00', { recebimentos: [{ valor: 50 }] })];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.renderCustomers();
  const html = elementos['customers-items-container'].innerHTML;
  assert.ok(html.includes("app.abrirRecebimentoFiado('C1')"), 'Ana tem botão Receber');
  assert.ok(!html.includes("app.abrirRecebimentoFiado('C2')"), 'Beto quitou, sem botão');
  assert.ok(html.includes('Em aberto'));
});

teste('recebimento: parcial pelo modal grava na venda mais antiga e salva', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00'), venda('V2', 'Ana', 50, '2026-11-11T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.abrirRecebimentoFiado('C1');
  assert.strictEqual(elementos['fiado-saldo'].textContent.includes('150'), true);
  assert.strictEqual(elementos['fiado-valor'].value, '150.00', 'valor sugerido é o saldo total');
  elementos['fiado-valor'].value = '60';
  elementos['fiado-forma'].value = 'pix';
  await app.confirmarRecebimentoFiado();
  assert.strictEqual(app.salvos, 1, 'salvou');
  assert.strictEqual(app.state.sales[0].recebimentos.length, 1);
  assert.strictEqual(app.state.sales[0].recebimentos[0].forma, 'pix');
  assert.strictEqual(F.saldoCliente(app.state.sales, 'Ana'), 90);
  assert.ok(app.auditoria.some((a) => a.acao === 'FIADO_RECEBIMENTO' && a.detalhes.valor === 60));
  assert.ok(app.notificacoes.some((n) => n.tipo === 'success'));
});

teste('recebimento: valor acima do saldo é recusado e não salva', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.abrirRecebimentoFiado('C1');
  elementos['fiado-valor'].value = '500';
  await app.confirmarRecebimentoFiado();
  assert.strictEqual(app.salvos, 0);
  assert.strictEqual(app.state.sales[0].recebimentos, undefined);
  assert.strictEqual(elementos['fiado-erro'].classList.contains('hidden'), false, 'erro visível no modal');
});

teste('cliente sem saldo: não abre o recebimento', () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00', { recebimentos: [{ valor: 100 }] })];
  const { app } = criarAmbiente({ customers: clientes(), sales });
  app.abrirRecebimentoFiado('C1');
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error' && n.msg.includes('saldo em aberto')));
  assert.strictEqual(app.state.fiadoCliente, undefined);
});

teste('exclusão: venda com recebimento não pode ser excluída', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00', { recebimentos: [{ valor: 10 }] })];
  const { app } = criarAmbiente({ customers: clientes(), sales });
  await app.deleteSale('V1');
  assert.strictEqual(app.confirmacoes, 0, 'não abriu a confirmação');
  assert.ok(app.notificacoes.some((n) => n.msg.includes('recebimentos')));
});

teste('exclusão: venda fiado sem recebimento segue o fluxo normal', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00')];
  const { app } = criarAmbiente({ customers: clientes(), sales });
  await app.deleteSale('V1');
  assert.strictEqual(app.confirmacoes, 1);
});

teste('edição: venda com recebimento só aceita Fiado no seletor', () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00', { recebimentos: [{ valor: 10 }] })];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.openSaleEdit('V1');
  const pag = elementos['sale-edit-pagamento'].innerHTML;
  assert.ok(pag.includes('value="fiado"'));
  assert.ok(!pag.includes('value="dinheiro"'), 'não oferece trocar a forma');
  assert.strictEqual(elementos['sale-edit-pagamento'].value, 'fiado');
});

teste('edição: venda fiado sem recebimento oferece as formas e Fiado', () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.openSaleEdit('V1');
  const pag = elementos['sale-edit-pagamento'].innerHTML;
  assert.ok(pag.includes('value="dinheiro"') && pag.includes('value="fiado"'));
  assert.strictEqual(elementos['sale-edit-pagamento'].value, 'fiado');
});

teste('estorno (admin): desfaz o recebimento, grava auditoria e reabre o modal', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.abrirRecebimentoFiado('C1');
  elementos['fiado-valor'].value = '60';
  await app.confirmarRecebimentoFiado();
  assert.strictEqual(F.saldoCliente(app.state.sales, 'Ana'), 40);
  app.abrirRecebimentoFiado('C1');
  assert.ok(elementos['fiado-recebidos'].innerHTML.includes('Estornar'), 'botão Estornar para admin');
  const op = F.operacoes(app.state.sales, 'Ana')[0].operacao;
  app.estornarRecebimentoFiado(op);
  assert.strictEqual(app.confirmacoes, 1, 'pediu confirmação');
  await app.ultimaConfirmacao();
  assert.strictEqual(F.saldoCliente(app.state.sales, 'Ana'), 100, 'saldo volta ao total');
  assert.ok(app.auditoria.some((a) => a.acao === 'FIADO_ESTORNO' && a.detalhes.valor === 60));
  assert.strictEqual(elementos['fiado-modal'].classList.contains('hidden'), false, 'modal reaberto após a confirmação');
  assert.ok(elementos['fiado-recebidos'].innerHTML.includes('Nenhum recebimento ainda'));
});

teste('estorno (operador): não mostra o botão e não pede confirmação', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00', { recebimentos: [{ id: 'R500-1', date: '2026-11-10T11:00:00Z', valor: 30, forma: 'pix' }] })];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.state.currentUser = { role: 'operador', username: 'caixa' };
  app.abrirRecebimentoFiado('C1');
  assert.ok(!elementos['fiado-recebidos'].innerHTML.includes('Estornar'), 'sem botão Estornar');
  app.estornarRecebimentoFiado('R500');
  assert.strictEqual(app.confirmacoes, 0);
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error'));
  assert.strictEqual(F.saldoCliente(app.state.sales, 'Ana'), 70, 'nada mudou');
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { await fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de integração do fiado passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
