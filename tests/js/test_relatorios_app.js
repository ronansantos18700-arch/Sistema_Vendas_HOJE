// Integração: app.js + relatorios.js com DOM simulado. Sub-página Configurações > Relatórios.
// Uso: node tests/js/test_relatorios_app.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const base = path.join(__dirname, '../../SistemaVendas/frontend');
const noop = () => {};

function criarAmbiente(campos) {
  // campos: { 'rel-inicio': {value}, 'rel-vendas': {checked}, ... }
  const elementos = {};
  const fabricar = (id) => ({
    id, value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, appendChild: noop, removeChild: noop, click: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], focus: noop, select: noop
  });
  const downloads = [];
  const ctx = {
    console: { log: noop, warn: noop, info: noop, error: noop },
    setTimeout: (fn) => { fn(); return 0; }, setInterval: noop, clearInterval: noop, clearTimeout: noop,
    requestAnimationFrame: noop, alert: noop, confirm: () => false,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem: noop },
    fetch: async () => ({ ok: false }),
    crypto: require('crypto').webcrypto, TextEncoder, TextDecoder, Intl, JSON, Math, Date, Map, Set, Object, Array, String, Number, Promise, Error, Symbol, Blob: class {
      constructor(partes, opcoes) { this.partes = partes; this.type = opcoes && opcoes.type; }
    },
    Chart: function () { return { destroy: noop, update: noop }; }, lucide: { createIcons: noop },
    document: {
      getElementById: (id) => {
        if (!elementos[id]) {
          const el = fabricar(id);
          if (campos[id]) Object.assign(el, campos[id]);
          elementos[id] = el;
        }
        return elementos[id];
      },
      querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
      createElement: () => { const a = fabricar('a'); a.click = () => downloads.push({ nome: a.download, blob: a.href }); return a; },
      body: { appendChild: noop, removeChild: noop }, documentElement: fabricar('html'), readyState: 'complete'
    },
    URL: { createObjectURL: (blob) => { const id = 'blob:' + downloads.length; ctx.__blobs[id] = blob; return id; }, revokeObjectURL: noop },
    __blobs: {}
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = noop; ctx.removeEventListener = noop;
  ctx.window.chrome = { webview: { hostObjects: { bridge: { GetData: async () => '[]', SaveChanges: async () => true, SaveAll: async () => true, SaveData: async () => true } } } };
  vm.createContext(ctx);
  for (const arq of ['estoque.js', 'relatorios.js', 'app.js']) {
    const src = fs.readFileSync(path.join(base, arq), 'utf8');
    vm.runInContext(arq === 'app.js' ? src + '\n;globalThis.__app = app;' : src, ctx, { timeout: 5000 });
  }
  const app = ctx.__app;
  app.requirePasswordChange = () => false;
  app.setLoading = noop; app.updateBrand = noop; app.iniciarHistoricoEstoque = noop; app.updateNotifications = noop;
  app.renderEstoque = noop; app.renderCart = noop; app.renderPosCatalog = noop; app.renderHistory = noop;
  app.notificacoes = [];
  app.showNotification = (tipo, msg) => app.notificacoes.push({ tipo, msg });
  app.logAudit = (acao, detalhes) => { app.auditoria = (app.auditoria || []).concat([{ acao, detalhes }]); };
  app.state.currentUser = { username: 'admin', role: 'admin' };
  app.state.settings = { companyName: 'Loja Teste', notifications: { stockLowVal: 10, stockMediumVal: 25 } };
  app.state.products = [
    { id: 'P1', name: 'Arroz', stock: 0, cost: 5, price: 8 },
    { id: 'P2', name: '<b>Feijão</b>', stock: 4, cost: 3, price: 6 },
    { id: 'P3', name: 'Sal', stock: 30, cost: 1, price: 2 }
  ];
  app.state.sales = [
    { id: 'V1', date: '2026-11-18T14:00:00', valor_total: 16, valor_final: 16, cost: 10, pagamento: 'dinheiro', items: [{ id: 'P1', name: 'Arroz', qty: 2, price: 8, cost: 5 }] },
    { id: 'V2', date: '2026-11-19T10:00:00', valor_total: 20, valor_final: 18, cost: 12, pagamento: 'misto', pagamentos: [{ forma: 'pix', valor: 10 }, { forma: 'dinheiro', valor: 8 }], items: [{ id: 'P2', name: '<b>Feijão</b>', qty: 2, price: 6, cost: 3 }, { id: 'P1', name: 'Arroz', qty: 1, price: 8, cost: 5 }] }
  ];
  return { app, downloads, ctx, elementos };
}

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

const marcados = (vendas, lucro, estoque, pagamentos) => ({
  'rel-vendas': { checked: vendas }, 'rel-lucro': { checked: lucro },
  'rel-estoque': { checked: estoque }, 'rel-pagamentos': { checked: pagamentos }
});
const conteudo = (ctx, d) => Buffer.from(ctx.__blobs[d.blob].partes[0]);
// Objetos criados dentro do vm têm outro protótipo: compara pelo JSON.
const puro = (v) => JSON.parse(JSON.stringify(v));

// Lê um ZIP sem compressão pelo diretório central: { nome: Uint8Array }.
function lerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const arquivos = {};
  for (let k = 0; k < total; k++) {
    const tamanho = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const nome = Buffer.from(bytes.subarray(p + 46, p + 46 + nl)).toString('utf8');
    const ln = dv.getUint16(off + 26, true), lx = dv.getUint16(off + 28, true);
    const inicio = off + 30 + ln + lx;
    arquivos[nome] = bytes.subarray(inicio, inicio + tamanho);
    p += 46 + nl + xl + cl;
  }
  return arquivos;
}
const abaXlsx = (bytes, nome) => Buffer.from(lerZip(bytes)[nome]).toString('utf8');

teste('XLSX: um arquivo com o período no nome e as abas marcadas', () => {
  const { app, downloads, ctx } = criarAmbiente({
    'rel-inicio': { value: '2026-11-18' }, 'rel-fim': { value: '2026-11-19' },
    ...marcados(true, true, false, true)
  });
  app.state.relatorioFormato = 'xlsx';
  app.exportarRelatorios();
  assert.deepStrictEqual(downloads.map(d => d.nome), ['relatorios_2026-11-18_a_2026-11-19.xlsx']);
  const bytes = conteudo(ctx, downloads[0]);
  assert.strictEqual(bytes.slice(0, 2).toString('latin1'), 'PK', 'arquivo ZIP (xlsx)');
  assert.strictEqual(ctx.__blobs[downloads[0].blob].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.ok(app.auditoria.some(a => a.acao === 'RELATORIO_EXPORT' && a.detalhes.formato === 'xlsx' && a.detalhes.inicio === '2026-11-18'), 'registrado na auditoria');
});

teste('PDF: um arquivo só, com as seções marcadas', () => {
  const { app, downloads, ctx } = criarAmbiente({
    'rel-inicio': { value: '2026-11-18' }, 'rel-fim': { value: '2026-11-19' },
    ...marcados(true, false, true, false)
  });
  app.state.relatorioFormato = 'pdf';
  app.exportarRelatorios();
  assert.deepStrictEqual(downloads.map(d => d.nome), ['relatorios_2026-11-18_a_2026-11-19.pdf']);
  assert.strictEqual(conteudo(ctx, downloads[0]).slice(0, 5).toString('latin1'), '%PDF-');
  assert.strictEqual(ctx.__blobs[downloads[0].blob].type, 'application/pdf');
});

teste('vendas agrupadas por mês quando o seletor pede (aba do Excel)', () => {
  const { app, downloads, ctx } = criarAmbiente({
    'rel-inicio': { value: '' }, 'rel-fim': { value: '' }, 'rel-agrupar': { value: 'mes' },
    ...marcados(true, false, false, false)
  });
  app.state.relatorioFormato = 'xlsx';
  app.exportarRelatorios();
  assert.strictEqual(downloads[0].nome, 'relatorios_inicio_a_hoje.xlsx', 'sem datas: nome com inicio e hoje');
  const aba = abaXlsx(conteudo(ctx, downloads[0]), 'xl/worksheets/sheet2.xml');
  assert.ok(aba.includes('Mês'), 'cabeçalho com Mês: ' + aba.slice(0, 300));
  assert.ok(aba.includes('11/2026'), 'linha do mês de novembro');
});

teste('sem relatório marcado: avisa e não baixa nada', () => {
  const { app, downloads } = criarAmbiente({
    'rel-inicio': { value: '' }, 'rel-fim': { value: '' }, ...marcados(false, false, false, false)
  });
  app.exportarRelatorios();
  assert.strictEqual(downloads.length, 0);
  assert.ok(app.notificacoes.some(n => n.tipo === 'error' && n.msg.includes('Marque pelo menos um')));
});

teste('data inicial depois da final: avisa e não baixa nada', () => {
  const { app, downloads } = criarAmbiente({
    'rel-inicio': { value: '2026-11-20' }, 'rel-fim': { value: '2026-11-01' }, ...marcados(true, false, false, false)
  });
  app.exportarRelatorios();
  assert.strictEqual(downloads.length, 0);
  assert.ok(app.notificacoes.some(n => n.msg.includes('data inicial é depois')));
});

teste('operador: não exporta (relatório tem dados de venda, como o backup)', () => {
  const { app, downloads } = criarAmbiente({
    'rel-inicio': { value: '' }, 'rel-fim': { value: '' }, ...marcados(true, false, false, false)
  });
  app.state.currentUser = { username: 'op', role: 'operador' };
  app.exportarRelatorios();
  assert.strictEqual(downloads.length, 0);
  assert.ok(app.notificacoes.some(n => n.tipo === 'error' && n.msg.includes('Apenas administradores')));
});

teste('atalhos de período: mês atual, mês anterior e ano, em datas locais', () => {
  const { app } = criarAmbiente({});
  const hoje = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  assert.deepStrictEqual(puro(app.intervaloRelatorio('mes')), { inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: iso(hoje) });
  const ant = app.intervaloRelatorio('mes_anterior');
  assert.strictEqual(ant.fim, iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)), 'último dia do mês anterior');
  assert.strictEqual(ant.inicio.slice(-2), '01');
  assert.strictEqual(app.intervaloRelatorio('ano').inicio, hoje.getFullYear() + '-01-01');
  assert.strictEqual(app.intervaloRelatorio('personalizado'), null, 'personalizado usa as datas digitadas');
});

teste('todos os períodos: sem datas, exporta o histórico inteiro e não mostra datas', () => {
  const { app, elementos, downloads, ctx } = criarAmbiente({
    'rel-vendas': { checked: true }, 'rel-lucro': { checked: false }, 'rel-estoque': { checked: false }, 'rel-pagamentos': { checked: false }
  });
  assert.deepStrictEqual(puro(app.intervaloRelatorio('todos')), { inicio: '', fim: '' });
  app.selecionarPeriodoRelatorio('todos');
  assert.strictEqual(elementos['rel-inicio'].value, '');
  assert.strictEqual(elementos['rel-datas'].hidden, true);
  assert.strictEqual(elementos['rel-periodo-texto'].hidden, false, 'texto do período visível');
  assert.ok(elementos['rel-periodo-texto'].textContent.includes('todo o histórico'));
  app.exportarRelatorios();
  assert.strictEqual(downloads[0].nome, 'relatorios_inicio_a_hoje.xlsx');
  assert.ok(conteudo(ctx, downloads[0]).length > 0);
});

teste('personalizado: mostra as datas e esconde o texto (mesma linha, sem mudar a altura)', () => {
  const { app, elementos } = criarAmbiente({});
  app.selecionarPeriodoRelatorio('personalizado');
  assert.strictEqual(elementos['rel-datas'].hidden, false);
  assert.strictEqual(elementos['rel-periodo-texto'].hidden, true);
  app.selecionarPeriodoRelatorio('mes');
  assert.strictEqual(elementos['rel-datas'].hidden, true);
  assert.strictEqual(elementos['rel-periodo-texto'].hidden, false);
});

teste('7 dias: inclui hoje e mais seis dias para trás', () => {
  const { app } = criarAmbiente({});
  const r = app.intervaloRelatorio('7dias');
  const dias = (Date.parse(r.fim) - Date.parse(r.inicio)) / 86400000;
  assert.strictEqual(dias, 6);
});

teste('escolher um período preenche as datas; digitar data vira personalizado', () => {
  const { app, elementos } = criarAmbiente({});
  app.selecionarPeriodoRelatorio('ano');
  assert.strictEqual(elementos['rel-inicio'].value.slice(5), '01-01');
  assert.strictEqual(elementos['rel-datas'].hidden, true, 'datas ocultas em atalhos');
  app.selecionarPeriodoRelatorio('personalizado');
  assert.strictEqual(elementos['rel-datas'].hidden, false, 'datas visíveis no personalizado');
  elementos['rel-inicio'].value = '2026-11-01';
  app.dataRelatorioAlterada();
  assert.strictEqual(app.state.relatorioPeriodo, 'personalizado');
});

teste('resumo: sem relatório marcado, o botão de exportar fica desabilitado', () => {
  const { app, elementos } = criarAmbiente({
    'rel-inicio': { value: '' }, 'rel-fim': { value: '' }, ...marcados(false, false, false, false)
  });
  app.atualizarResumoRelatorio();
  assert.strictEqual(elementos['rel-exportar'].disabled, true);
  assert.ok(elementos['rel-resumo'].textContent.includes('Escolha pelo menos um'));
  elementos['rel-vendas'].checked = true;
  app.atualizarResumoRelatorio();
  assert.strictEqual(elementos['rel-exportar'].disabled, false);
  assert.ok(elementos['rel-resumo'].textContent.includes('1 relatório(s) em Excel'));
});

teste('formato: escolher PDF troca o resumo e o formato guardado', () => {
  const { app, elementos } = criarAmbiente({ ...marcados(true, false, false, false) });
  app.selecionarFormatoRelatorio('pdf');
  assert.strictEqual(app.state.relatorioFormato, 'pdf');
  assert.ok(elementos['rel-resumo'].textContent.includes('PDF'));
  app.selecionarFormatoRelatorio('qualquer coisa');
  assert.strictEqual(app.state.relatorioFormato, 'xlsx', 'valor inválido cai em Excel');
});

teste('marcar e desmarcar todos', () => {
  const { app, elementos } = criarAmbiente({ ...marcados(true, false, false, false) });
  app.marcarTodosRelatorios(true);
  assert.deepStrictEqual(puro(app.relatoriosSelecionados()), ['vendas', 'lucro', 'estoque', 'pagamentos']);
  app.marcarTodosRelatorios(false);
  assert.deepStrictEqual(puro(app.relatoriosSelecionados()), []);
  assert.strictEqual(elementos['rel-exportar'].disabled, true);
});

teste('pagamentos do período: fiado recebido no período entra, mesmo com venda de outro mês', () => {
  const { app } = criarAmbiente({});
  const base = app.montarSecoesRelatorio(['pagamentos'], '2026-11-18', '2026-11-19')[0].totais[2];
  assert.strictEqual(base, 34, 'V1 (16 dinheiro) + V2 (10 pix + 8 dinheiro)');
  app.state.sales.push({ id: 'F1', date: '2026-10-05T10:00:00', valor_total: 100, valor_final: 100, cost: 60, pagamento: 'fiado',
    recebimentos: [{ id: 'R1-1', date: '2026-11-18T12:00:00', valor: 40, forma: 'pix' }], items: [] });
  const secao = app.montarSecoesRelatorio(['pagamentos'], '2026-11-18', '2026-11-19')[0];
  assert.strictEqual(secao.totais[2], 74, 'inclui os 40 recebidos no período');
  const fora = app.montarSecoesRelatorio(['pagamentos'], '2026-10-01', '2026-10-31')[0];
  assert.strictEqual(fora.totais[2], 0, 'em outubro não há pagamento (a venda é de outubro, mas o dinheiro entrou em novembro)');
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de relatórios no app passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
