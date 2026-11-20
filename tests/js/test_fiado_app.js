// Integração: Fiado no app.js com DOM simulado (PDV, clientes, recebimento, exclusão).
// Uso: node tests/js/test_fiado_app.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const F = require(path.join(base, 'fiado.js'));
const noop = () => {};
// Intl pt-BR usa espaço não separável entre "R$" e o valor.
const txt = (t) => String(t).replace(/\u00a0/g, ' ');

function criarAmbiente({ customers, sales, cart, pagamento = 'fiado', cliente = 'C1' }) {
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
// Vendas fiado de teste carregam o id do cliente (cliente_id), como o app grava hoje.
const IDS = { Ana: 'C1', Beto: 'C2' };
const venda = (id, nome, valor, data, extra = {}) => Object.assign({
  id, cliente: nome, cliente_id: IDS[nome], valor_final: valor, valor_total: valor, desconto: 0, cost: 0, lucro: valor,
  date: data, pagamento: 'fiado', items: [{ id: 'P1', name: 'Arroz', qty: 1, price: valor, cost: 0 }]
}, extra);
const carrinho = () => [{ id: 'P1', name: 'Arroz', price: 100, cost: 5, qty: 1 }];

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

teste('PDV: venda fiado sem cliente cadastrado é recusada', async () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [], cart: carrinho(), cliente: '' });
  await app.finishSale();
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error' && n.msg.includes('cliente cadastrado')));
  assert.strictEqual(app.state.pendingSale, undefined);
});

teste('PDV: venda fiado com cliente vira pagamento a prazo, com lista de recebimentos vazia', async () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [], cart: carrinho(), cliente: 'C1' });
  await app.finishSale();
  assert.ok(app.state.pendingSale, 'venda pendente criada');
  assert.strictEqual(app.state.pendingSale.pagamento, 'fiado');
  assert.ok(Array.isArray(app.state.pendingSale.recebimentos) && app.state.pendingSale.recebimentos.length === 0);
  assert.strictEqual(app.state.pendingSale.cliente, 'Ana');
  assert.strictEqual(app.state.pendingSale.cliente_id, 'C1', 'venda fiado grava o id do cliente');
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
  assert.ok(html.includes('em aberto') && txt(html).includes('Pago R$ 0,00 de R$ 100,00'), 'mostra o falta e o pago');
  assert.ok(html.includes('Quitado'), 'Beto aparece como quitado');
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
  assert.strictEqual(F.saldoCliente(app.state.sales, 'C1'), 90);
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
  assert.strictEqual(F.saldoCliente(app.state.sales, 'C1'), 40);
  app.abrirRecebimentoFiado('C1');
  assert.ok(elementos['fiado-recebidos'].innerHTML.includes('Estornar'), 'botão Estornar para admin');
  const op = F.operacoes(app.state.sales, 'C1')[0].operacao;
  app.estornarRecebimentoFiado(op);
  assert.strictEqual(app.confirmacoes, 1, 'pediu confirmação');
  await app.ultimaConfirmacao();
  assert.strictEqual(F.saldoCliente(app.state.sales, 'C1'), 100, 'saldo volta ao total');
  assert.ok(app.auditoria.some((a) => a.acao === 'FIADO_ESTORNO' && a.detalhes.valor === 60));
  assert.strictEqual(elementos['fiado-modal'].classList.contains('hidden'), false, 'modal reaberto após a confirmação');
  assert.ok(elementos['fiado-recebidos'].innerHTML.includes('Nenhum pagamento recebido ainda'));
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
  assert.strictEqual(F.saldoCliente(app.state.sales, 'C1'), 70, 'nada mudou');
});

teste('PDV: venda fiado de cliente escolhido pelo id grava nome e id', async () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [], cart: carrinho(), cliente: 'C2' });
  await app.finishSale();
  assert.strictEqual(app.state.pendingSale.cliente, 'Beto');
  assert.strictEqual(app.state.pendingSale.cliente_id, 'C2');
});

teste('dois clientes com o mesmo nome: o recebimento vai só para o cliente escolhido', () => {
  const clientesMesmoNome = [{ id: 'C1', name: 'Ana' }, { id: 'C9', name: 'Ana' }];
  const sales = [
    venda('V1', 'Ana', 100, '2026-11-10T10:00:00'),
    Object.assign(venda('V2', 'Ana', 40, '2026-11-11T10:00:00'), { cliente_id: 'C9' })
  ];
  const { app, elementos } = criarAmbiente({ customers: clientesMesmoNome, sales });
  app.abrirRecebimentoFiado('C9');
  assert.strictEqual(elementos['fiado-valor'].value, '40.00', 'saldo do cliente C9');
  assert.ok(elementos['fiado-lista'].innerHTML.includes('venda #V2'), 'lista só as vendas do C9');
  app.abrirRecebimentoFiado('C1');
  assert.strictEqual(elementos['fiado-valor'].value, '100.00', 'C1 tem saldo próprio');
});

teste('carregar dados preserva recebimentos e cliente_id (antes eram descartados)', async () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [] });
  const dados = {
    products: '[]',
    users: JSON.stringify([{ id: 'U1', fullname: 'Admin', username: 'admin', password: 'x', role: 'admin' }]),
    customers: JSON.stringify(clientes()),
    sales: JSON.stringify([venda('V1', 'Ana', 100, '2026-11-10T10:00:00', { recebimentos: [{ id: 'R1-1', date: '2026-11-10T12:00:00Z', valor: 30, forma: 'pix' }] })])
  };
  app.salvos = 0;
  app.origemDeDados = () => ({ GetData: async (tipo) => dados[tipo] || '[]', SaveChanges: async () => true });
  await app.carregarDados();
  const v = app.state.sales[0];
  assert.strictEqual(v.recebimentos.length, 1, 'recebimento continua na venda após recarregar');
  assert.strictEqual(v.cliente_id, 'C1');
  assert.strictEqual(F.saldoCliente(app.state.sales, 'C1'), 70);
  assert.strictEqual(app.salvos, 0, 'sem vínculo pendente, nada é regravado no carregamento');
});

teste('carregar dados: venda fiado antiga liga pelo nome único e grava; nome repetido fica pendente', async () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [] });
  const clientesRepetidos = [{ id: 'C1', name: 'Ana' }, { id: 'C2', name: 'Beto' }, { id: 'C3', name: 'Beto' }];
  const dados = {
    users: JSON.stringify([{ id: 'U1', fullname: 'Admin', username: 'admin', password: 'x', role: 'admin' }]),
    customers: JSON.stringify(clientesRepetidos),
    sales: JSON.stringify([
      { id: 'V1', date: '2026-11-10T10:00:00', cliente: 'Ana', valor_final: 100, pagamento: 'fiado' },
      { id: 'V2', date: '2026-11-11T10:00:00', cliente: 'Beto', valor_final: 50, pagamento: 'fiado' }
    ])
  };
  app.salvos = 0;
  app.origemDeDados = () => ({ GetData: async (tipo) => dados[tipo] || '[]', SaveChanges: async () => true });
  await app.carregarDados();
  assert.strictEqual(app.state.sales[0].cliente_id, 'C1', 'Ana tem um só cadastro');
  assert.strictEqual(app.state.sales[1].cliente_id, undefined, 'Beto repetido: não liga sozinho');
  assert.strictEqual(app.salvos, 1, 'gravou o vínculo feito (uma vez)');
  assert.deepStrictEqual(F.pendentesSemCliente(app.state.sales).map((p) => p.vendaId), ['V2']);
});

teste('clientes: painel de pendências liga a venda ao cliente escolhido', async () => {
  const sales = [venda('V1', 'Beto', 50, '2026-11-11T10:00:00', { cliente_id: undefined })];
  const { app, ctx, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.renderCustomers();
  assert.ok(!elementos['fiado-pendentes'].classList.contains('hidden'), 'painel visível');
  assert.ok(elementos['fiado-pendentes'].innerHTML.includes('Vincular'));
  ctx.document.getElementById('fiado-pend-0').value = 'C2';
  await app.vincularFiadoPendente(0);
  assert.strictEqual(app.state.sales[0].cliente_id, 'C2');
  assert.strictEqual(app.salvos, 1);
  assert.ok(app.auditoria.some((a) => a.acao === 'FIADO_VINCULO'));
  assert.strictEqual(F.saldoCliente(app.state.sales, 'C2'), 50, 'saldo aparece no cliente');
});

teste('clientes: renomear o cliente mantém o saldo e atualiza o nome nas vendas fiado', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00')];
  const { app, ctx } = criarAmbiente({ customers: clientes(), sales });
  app.state.editingId = 'C1';
  ctx.document.getElementById('cust-name').value = 'Ana Paula';
  ctx.document.getElementById('cust-whatsapp').value = '21999999999';
  await app.handleCustomerSubmit({ preventDefault: noop });
  assert.strictEqual(app.state.sales[0].cliente, 'Ana Paula');
  assert.strictEqual(F.saldoCliente(app.state.sales, 'C1'), 100);
});

teste('clientes: não exclui cliente com saldo em aberto', async () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00')];
  const { app } = criarAmbiente({ customers: clientes(), sales });
  await app.deleteCustomer('C1');
  assert.strictEqual(app.confirmacoes, 0, 'não abriu a confirmação');
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error' && n.msg.includes('Receba')));
});

teste('edição: o seletor de cliente mostra o cliente pelo id', () => {
  const sales = [venda('V1', 'Beto', 100, '2026-11-10T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.openSaleEdit('V1');
  assert.strictEqual(elementos['sale-edit-cliente'].value, 'C2');
});

teste('modal: mostra total a prazo, já pago, falta e o andamento de cada venda', () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00'), venda('V2', 'Ana', 50, '2026-11-11T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  F.registrarRecebimento(app.state.sales, 'C1', 120, 'pix', '2026-11-12T10:00:00Z', 'R800');
  app.abrirRecebimentoFiado('C1');
  assert.strictEqual(txt(elementos['fiado-total'].textContent), 'R$ 150,00');
  assert.strictEqual(txt(elementos['fiado-pago'].textContent), 'R$ 120,00');
  assert.strictEqual(txt(elementos['fiado-saldo'].textContent), 'R$ 30,00');
  assert.ok(elementos['fiado-lista'].innerHTML.includes('Quitada'), 'V1 quitada aparece');
  assert.ok(txt(elementos['fiado-lista'].innerHTML).includes('Falta R$ 30,00'), 'V2 mostra o que falta');
});

teste('prévia: mostra o que fica em aberto enquanto digita, e recusa valor acima do saldo', () => {
  const sales = [venda('V1', 'Ana', 150, '2026-11-10T10:00:00')];
  const { app, ctx, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.abrirRecebimentoFiado('C1');
  const campo = ctx.document.getElementById('fiado-valor');
  campo.value = '60';
  app.atualizarPreviaFiado();
  assert.ok(txt(elementos['fiado-previa'].textContent).includes('ficam R$ 90,00 em aberto'));
  assert.strictEqual(elementos['fiado-previa'].className, 'fiado-previa');
  campo.value = '150';
  app.atualizarPreviaFiado();
  assert.ok(elementos['fiado-previa'].textContent.includes('quitada'));
  campo.value = '200';
  app.atualizarPreviaFiado();
  assert.ok(elementos['fiado-previa'].className.includes('erro'));
  assert.strictEqual(app.salvos, 0, 'a prévia não grava nada');
});

teste('clientes: cliente quitado continua com botão Extrato (sem Receber)', () => {
  const sales = [venda('V1', 'Beto', 50, '2026-11-11T10:00:00', { recebimentos: [{ id: 'R1-1', date: '2026-11-12T10:00:00Z', valor: 50, forma: 'pix' }] })];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  app.renderCustomers();
  const html = elementos['customers-items-container'].innerHTML;
  assert.ok(html.includes("app.abrirExtratoFiado('C2')"), 'botão Extrato para quitado');
  assert.ok(!html.includes("app.abrirRecebimentoFiado('C2')"), 'sem Receber quando não deve');
});

teste('extrato: mostra compras, pagamentos e saldo corrente', () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00'), venda('V2', 'Ana', 50, '2026-11-11T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  F.registrarRecebimento(app.state.sales, 'C1', 30, 'pix', '2026-11-10T12:00:00Z', 'R810');
  app.abrirExtratoFiado('C1');
  const lista = txt(elementos['extrato-lista'].innerHTML);
  assert.ok(lista.includes('Compra a prazo · venda #V1'));
  assert.ok(lista.includes('Pagamento · PIX'));
  assert.ok(lista.includes('Saldo R$ 70,00'), 'saldo depois do pagamento');
  assert.ok(lista.includes('Saldo R$ 120,00'), 'saldo depois da segunda compra');
  assert.strictEqual(txt(elementos['extrato-falta'].textContent), 'R$ 120,00');
  assert.strictEqual(elementos['extrato-modal'].classList.contains('hidden'), false, 'modal aberto');
  assert.strictEqual(elementos['extrato-receber'].classList.contains('hidden'), false, 'Receber visível com saldo');
});

teste('extrato: cliente quitado esconde Receber e mostra o histórico', () => {
  const sales = [venda('V1', 'Ana', 100, '2026-11-10T10:00:00')];
  const { app, elementos } = criarAmbiente({ customers: clientes(), sales });
  F.registrarRecebimento(app.state.sales, 'C1', 100, 'dinheiro', '2026-11-10T12:00:00Z', 'R820');
  app.abrirExtratoFiado('C1');
  assert.strictEqual(elementos['extrato-receber'].classList.contains('hidden'), true);
  assert.ok(txt(elementos['extrato-lista'].innerHTML).includes('Pagamento · Dinheiro'));
});

teste('histórico de vendas: fiado mostra falta ou quitado abaixo do valor final', () => {
  const { app } = criarAmbiente({ customers: clientes(), sales: [] });
  const aberto = venda('V1', 'Ana', 100, '2026-11-10', { recebimentos: [{ valor: 30 }] });
  assert.ok(txt(app.statusFiadoVendaHtml(aberto)).includes('Falta R$ 70,00'));
  const quitado = venda('V2', 'Ana', 100, '2026-11-10', { recebimentos: [{ valor: 100 }] });
  assert.ok(app.statusFiadoVendaHtml(quitado).includes('Quitado'));
  assert.strictEqual(app.statusFiadoVendaHtml({ id: 'V3', pagamento: 'pix', valor_final: 10 }), '', 'venda à vista não mostra nada');
});

teste('PDV: venda fiado de cliente com prazo grava o vencimento (dia da venda + prazo)', async () => {
  const { app } = criarAmbiente({ customers: [{ id: 'C1', name: 'Ana', prazo_dias: 30 }], sales: [], cart: carrinho(), cliente: 'C1' });
  await app.finishSale();
  assert.ok(app.state.pendingSale, 'venda pendente criada');
  assert.strictEqual(app.state.pendingSale.vencimento, F.vencimentoPara(new Date(), 30));
});

teste('PDV: venda fiado sem prazo não grava vencimento', async () => {
  const { app } = criarAmbiente({ customers: [{ id: 'C1', name: 'Ana', prazo_dias: null }], sales: [], cart: carrinho(), cliente: 'C1' });
  await app.finishSale();
  assert.ok(app.state.pendingSale, 'venda pendente criada');
  assert.strictEqual('vencimento' in app.state.pendingSale, false);
});

teste('PDV: limite de crédito recusa a venda que passa do disponível, com o valor disponível', async () => {
  const { app } = criarAmbiente({
    customers: [{ id: 'C1', name: 'Ana', limite_credito: 150 }],
    sales: [venda('V1', 'Ana', 100, '2026-11-01T10:00:00Z')], cart: carrinho(), cliente: 'C1'
  });
  await app.finishSale();
  const erro = app.notificacoes.find((n) => n.tipo === 'error' && n.msg.includes('Limite de crédito'));
  assert.ok(erro, 'mostra o erro de limite');
  assert.ok(txt(erro.msg).includes(txt(app.formatCurrency(50))), 'informa o disponível (R$ 50,00)');
  assert.strictEqual(app.state.pendingSale, undefined, 'nada é pendente');
});

teste('clientes: salvar cadastro grava limite e prazo; prazo inválido é recusado', async () => {
  const { app, ctx } = criarAmbiente({ customers: [], sales: [], cart: [] });
  const campos = { 'cust-name': 'Carla', 'cust-whatsapp': '21999990000', 'cust-email': '', 'cust-obs': '', 'cust-image-url': '', 'cust-limite': '500', 'cust-prazo': '30' };
  Object.entries(campos).forEach(([id, v]) => { ctx.document.getElementById(id).value = v; });
  await app.handleCustomerSubmit({ preventDefault: noop });
  const c = app.state.customers.find((x) => x.name === 'Carla');
  assert.ok(c, 'cliente cadastrado');
  assert.strictEqual(c.limite_credito, 500);
  assert.strictEqual(c.prazo_dias, 30);

  ctx.document.getElementById('cust-name').value = 'Dani';
  ctx.document.getElementById('cust-prazo').value = '1.5';
  await app.handleCustomerSubmit({ preventDefault: noop });
  assert.strictEqual(app.state.customers.some((x) => x.name === 'Dani'), false, 'prazo fracionado não entra');
  assert.ok(app.notificacoes.some((n) => n.tipo === 'error' && n.msg.includes('prazo')));
});

teste('clientes: cliente com venda atrasada mostra o aviso na lista; venda no prazo não', () => {
  const { app, elementos } = criarAmbiente({
    customers: [{ id: 'C1', name: 'Ana' }, { id: 'C2', name: 'Beto' }],
    sales: [
      venda('V1', 'Ana', 100, '2000-01-01T10:00:00Z', { vencimento: '2000-01-31' }),
      venda('V2', 'Beto', 50, '2000-01-01T10:00:00Z', { vencimento: '2999-01-01' })
    ],
    cart: []
  });
  app.renderCustomers();
  const html = elementos['customers-items-container'].innerHTML;
  assert.ok(html.includes('1 venda(s) em atraso'), 'Ana aparece com atraso');
  const linhaBeto = html.split('nested-item-labs-row').find((l) => l.includes('Beto'));
  assert.ok(linhaBeto && !linhaBeto.includes('em atraso'), 'Beto (no prazo) não aparece com atraso');
});

teste('modal: venda atrasada aparece como atrasada, venda no prazo mostra o vencimento', () => {
  const { app, elementos } = criarAmbiente({
    customers: [{ id: 'C1', name: 'Ana' }],
    sales: [
      venda('V1', 'Ana', 100, '2000-01-01T10:00:00Z', { vencimento: '2000-01-31' }),
      venda('V2', 'Ana', 40, '2000-02-01T10:00:00Z', { vencimento: '2999-03-10' })
    ],
    cart: []
  });
  app.state.fiadoCliente = 'C1';
  app.atualizarModalFiado();
  const lista = elementos['fiado-lista'].innerHTML;
  assert.ok(lista.includes('Atrasada há'), 'venda vencida marcada');
  assert.ok(lista.includes('Vence 10/03/2999'), 'venda no prazo mostra a data no formato dd/mm/aaaa');
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
