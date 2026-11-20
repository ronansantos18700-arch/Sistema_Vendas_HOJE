// Testes da Fase 3: Dashboard UX, visualização de dados, séries temporais,
// estados vazios de gráficos, banner de Fiado e contextualização Vendas/Estoque.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const front = path.join(__dirname, '..', '..', 'SistemaVendas', 'frontend');
const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(front, 'style.css'), 'utf8');
const Dashboard = require(path.join(front, 'dashboard.js'));

let ok = 0;
async function testar(nome, fn) {
    try {
        await fn();
        ok++;
        console.log('OK   ', nome);
    } catch (e) {
        console.error('FALHA', nome);
        console.error('     ', e.stack || e.message);
        process.exit(1);
    }
}

function criarAmbienteDashboard() {
    const elementos = {};
    const chartsCriados = [];

    function criarEl(id) {
        if (!elementos[id]) {
            const classes = new Set();
            const children = [];
            const pai = {
                children,
                querySelector: (sel) => {
                    if (sel === '.chart-empty-state') return children.find(c => c.classList.contains('chart-empty-state')) || null;
                    return null;
                },
                appendChild: (c) => { children.push(c); return c; }
            };
            const el = {
                id,
                value: '',
                textContent: '',
                innerHTML: '',
                disabled: false,
                style: {},
                dataset: {},
                parentElement: pai,
                classList: {
                    add: (...cs) => cs.forEach(c => classes.add(c)),
                    remove: (...cs) => cs.forEach(c => classes.delete(c)),
                    contains: (c) => classes.has(c),
                    toggle: (c, f) => {
                        const ligar = f === undefined ? !classes.has(c) : !!f;
                        if (ligar) classes.add(c); else classes.delete(c);
                    }
                },
                addEventListener: () => {},
                setAttribute: () => {},
                getContext: () => ({}),
                querySelector: () => null,
                querySelectorAll: () => [],
                appendChild: (c) => { children.push(c); return c; }
            };
            elementos[id] = el;
        }
        return elementos[id];
    }

    function FakeChart(canvasOrCtx, cfg) {
        chartsCriados.push({ target: canvasOrCtx, cfg });
        return {
            data: cfg.data,
            options: cfg.options,
            destroy: () => {},
            update: () => {}
        };
    }
    FakeChart.defaults = { font: {}, plugins: { tooltip: {} } };

    const ctx = {
        console, setTimeout, clearTimeout, Date, Math, JSON, Intl, Array, Object, Number, String, Boolean, RegExp, Error, Promise, Map, Set,
        localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
        document: {
            getElementById: (id) => criarEl(id),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            body: { classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false }, appendChild: () => {} },
            createElement: (tag) => {
                const cs = new Set();
                return {
                    tagName: tag.toUpperCase(),
                    _className: '',
                    get className() { return Array.from(cs).join(' '); },
                    set className(v) { cs.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cs.add(x)); },
                    textContent: '',
                    style: {},
                    classList: {
                        add: (...a) => a.forEach(x => cs.add(x)),
                        remove: (...a) => a.forEach(x => cs.delete(x)),
                        contains: (x) => cs.has(x)
                    }
                };
            }
        },
        addEventListener: () => {},
        matchMedia: () => ({ matches: false }),
        chrome: null,
        lucide: { createIcons: () => {} },
        Chart: FakeChart,
        alert: () => {},
        confirm: () => true
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    vm.createContext(ctx);

    for (const arq of ['estoque.js', 'fiado.js', 'dashboard.js', 'edicao_venda.js', 'relatorios.js', 'historico_movimentos.js', 'app.js']) {
        vm.runInContext(fs.readFileSync(path.join(front, arq), 'utf8'), ctx, { filename: arq });
    }

    const app = vm.runInContext('app', ctx);
    app.initLucide = () => {};
    app.showNotification = () => {};
    app.state.products = [];
    app.state.customers = [];
    app.state.sales = [];
    app.state.dashboardFilter = '7d';
    app.state.settings = { storeName: 'Loja', notifications: { stockLowVal: 10, stockMediumVal: 25 } };
    return { app, elementos, chartsCriados };
}

(async () => {
    await testar('Dashboard.serieMargemPeriodo: plota dias/meses do período com null nos dias sem venda', () => {
        const agora = new Date(2026, 10, 20, 15, 0); // 20/11/2026 local
        const vendas = [
            { date: new Date(2026, 10, 19, 10, 0).toISOString(), valor_total: 100, desconto: 0, cost: 60 },
            { date: new Date(2026, 10, 20, 14, 0).toISOString(), valor_total: 200, desconto: 0, cost: 150 }
        ];
        const s7 = Dashboard.serieMargemPeriodo(vendas, '7d', agora);
        assert.strictEqual(s7.labels.length, 7);
        assert.strictEqual(s7.hasData, true);
        assert.strictEqual(s7.margins[0], null, 'dia sem venda retorna null (não 0%)');
        assert.strictEqual(s7.margins[5], 40, '19/11: lucro 40 / fat 100 = 40%');
        assert.strictEqual(s7.margins[6], 25, '20/11: lucro 50 / fat 200 = 25%');

        const sAno = Dashboard.serieMargemPeriodo(vendas, 'year', agora);
        assert.strictEqual(sAno.labels.length, 12);
        assert.strictEqual(sAno.margins[10], 30, 'Novembro: lucro 90 / fat 300 = 30%');
        assert.strictEqual(sAno.margins[0], null);

        const vazio = Dashboard.serieMargemPeriodo([], '7d', agora);
        assert.strictEqual(vazio.hasData, false);
    });

    await testar('Dashboard.vendasPorHorario: agrega faturamento líquido e contagem alinhados ao horaPico', () => {
        const vendas = [
            { date: new Date(2026, 10, 20, 9, 15).toISOString(), valor_total: 50, desconto: 0, cost: 20 },
            { date: new Date(2026, 10, 20, 9, 40).toISOString(), valor_total: 40, desconto: 0, cost: 15 },
            { date: new Date(2026, 10, 20, 18, 10).toISOString(), valor_total: 350, desconto: 50, cost: 100 }
        ];
        const h = Dashboard.vendasPorHorario(vendas);
        const ven = Dashboard.kpisVendas(vendas, []);
        assert.strictEqual(h.hasData, true);
        assert.strictEqual(h.revenue[9], 90);
        assert.strictEqual(h.counts[9], 2);
        assert.strictEqual(h.revenue[18], 300);
        assert.strictEqual(h.counts[18], 1);
        // Hora de maior faturamento bate exatamente com ven.horaPico (18h, mesmo tendo menos vendas que 9h)
        const maxHora = h.revenue.indexOf(Math.max(...h.revenue));
        assert.strictEqual(maxHora, ven.horaPico);
    });

    await testar('app.formatCurrencyCompact formata valores curtos, milhares, milhões e negativos em pt-BR', () => {
        const { app } = criarAmbienteDashboard();
        assert.strictEqual(app.formatCurrencyCompact(0), 'R$ 0');
        assert.strictEqual(app.formatCurrencyCompact(450), 'R$ 450');
        assert.strictEqual(app.formatCurrencyCompact(1500), 'R$ 1,5 mil');
        assert.strictEqual(app.formatCurrencyCompact(2000), 'R$ 2 mil');
        assert.strictEqual(app.formatCurrencyCompact(1250000), 'R$ 1,3 mi');
        assert.strictEqual(app.formatCurrencyCompact(-1500), '-R$ 1,5 mil');
    });

    await testar('Gráficos exibem estado vazio limpo quando não há vendas no período e formatam eixos em R$ / % com dados', () => {
        const { app, elementos, chartsCriados } = criarAmbienteDashboard();

        // Sem vendas: todos os gráficos marcam estado vazio
        app.state.sales = [];
        app.initCharts();
        app.renderSalesByHourChart();
        app.renderProfitMarginPercentChart();
        app.renderTopProductsChart();
        app.renderTopProfitableProductsChart();
        app.renderPaymentMethodsChart();

        for (const id of ['lineChart', 'salesByHourChart', 'profitMarginPercentChart', 'topProductsChart', 'topProfitableProductsChart', 'paymentMethodsChart']) {
            const aviso = elementos[id].parentElement.querySelector('.chart-empty-state');
            assert.ok(aviso && !aviso.classList.contains('hidden'), `${id} deve mostrar estado vazio`);
        }

        // Com vendas: oculta estado vazio e cria gráficos com eixos R$ e %
        chartsCriados.length = 0;
        const hoje = new Date();
        const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1, 16, 20).toISOString();
        app.state.products = [{ id: 'p1', name: 'Notebook', stock: 5, cost: 2000, price: 3500 }];
        app.state.sales = [{
            id: 'v1', date: ontem, cliente: 'João', pagamento: 'pix',
            valor_total: 3500, desconto: 0, cost: 2000,
            items: [{ productId: 'p1', name: 'Notebook', qtySold: 1, price: 3500, cost: 2000 }]
        }];

        app.initCharts();
        app.renderSalesByHourChart();
        app.renderProfitMarginPercentChart();
        app.renderTopProductsChart();
        app.renderTopProfitableProductsChart();
        app.renderPaymentMethodsChart();

        for (const id of ['lineChart', 'salesByHourChart', 'profitMarginPercentChart', 'topProductsChart', 'topProfitableProductsChart', 'paymentMethodsChart']) {
            const aviso = elementos[id].parentElement.querySelector('.chart-empty-state');
            assert.ok(!aviso || aviso.classList.contains('hidden'), `${id} deve ocultar estado vazio quando há vendas`);
        }

        // Evolução de Vendas: eixo Y em R$
        const cfgLine = app.state.charts.line.options;
        assert.strictEqual(cfgLine.scales.y.ticks.callback(3500), 'R$ 3,5 mil');

        // Faturamento por Horário: barras em R$ (3500 às 16h)
        const horaData = app.state.charts.salesByHour.data.datasets[0].data;
        assert.strictEqual(horaData[16], 3500);
        assert.strictEqual(app.state.charts.salesByHour.options.scales.y.ticks.callback(3500), 'R$ 3,5 mil');

        // Margem de Lucro (%): eixo temporal (7 dias) em vez de 0h..23h
        assert.strictEqual(app.state.charts.profitMarginPercent.data.labels.length, 7);
        assert.strictEqual(app.state.charts.profitMarginPercent.options.scales.y.ticks.callback(42.8), '43%');

        // Top 5 Lucrativos: eixo X em R$
        assert.strictEqual(app.state.charts.topProfitable.options.scales.x.ticks.callback(1500), 'R$ 1,5 mil');
    });

    await testar('Banner de Fiado no Dashboard aparece só com saldo em aberto e navega para Clientes filtrado', () => {
        const { app, elementos } = criarAmbienteDashboard();
        let viewAberta = null;
        app.switchView = (v) => { viewAberta = v; };

        // Sem fiado: oculto
        app.state.sales = [];
        app.renderDashboardFiadoBanner();
        assert.ok(elementos['dash-fiado-banner'].classList.contains('hidden'));

        // Com fiado em aberto e atrasado
        const pad2 = (n) => String(n).padStart(2, '0');
        const ontem = new Date(Date.now() - 2 * 86400000);
        const ymdOntem = `${ontem.getFullYear()}-${pad2(ontem.getMonth() + 1)}-${pad2(ontem.getDate())}`;
        app.state.sales = [{
            id: 'vf1', cliente_id: 'c1', cliente: 'Ana', pagamento: 'fiado',
            valor_final: 250, date: ontem.toISOString(), vencimento: ymdOntem, recebimentos: []
        }];
        app.renderDashboardFiadoBanner();
        assert.ok(!elementos['dash-fiado-banner'].classList.contains('hidden'));
        assert.ok(elementos['dash-fiado-total'].textContent.includes('250,00'));
        assert.ok(elementos['dash-fiado-sub'].textContent.includes('1 cliente(s)'));
        assert.ok(elementos['dash-fiado-sub'].textContent.includes('1 venda(s) em atraso'));

        // Atalho navega para Clientes com filtro 'aberto'
        app.abrirClientesFiadoAberto();
        assert.strictEqual(app.state.customersFiadoFilter, 'aberto');
        assert.strictEqual(viewAberta, 'customers');
    });

    await testar('setDashCardModo alterna Gráfico ↔ Lista/Tabela nos cards combinados de Top 5', () => {
        const { app, elementos } = criarAmbienteDashboard();
        app.setDashCardModo('card-top-vendidos', 'lista');
        assert.strictEqual(elementos['card-top-vendidos'].dataset.modo, 'lista');
        app.setDashCardModo('card-top-lucrativos', 'tabela');
        assert.strictEqual(elementos['card-top-lucrativos'].dataset.modo, 'tabela');
    });

    await testar('index.html e style.css: contextualização Estoque/Vendas, sem espaços vazios de 50% e tabelas alinhadas', () => {
        assert.ok(html.includes('<label class="dash-periodo" data-visao-bloco="vendas">'), 'seletor de período deve pertencer apenas à visão Vendas');
        assert.ok(html.includes('<div class="stats-grid-labs" data-visao-bloco="vendas">'), 'KPIs de vendas não devem aparecer na visão Estoque');
        assert.ok(html.includes('class="chart-card-labs glass-inner full-width" data-visao-bloco="estoque"'), 'Alertas de Estoque Crítico deve ocupar 100% da largura');
        assert.ok(html.includes('id="card-top-vendidos"') && html.includes('id="card-top-lucrativos"'), 'cards Top 5 deduplicados com alternância');
        assert.ok(html.includes('dash-table-aligned'), 'tabelas do Dashboard devem usar .dash-table-aligned');
        assert.ok(css.includes('.chart-empty-state') && css.includes('.dash-destaques-estoque') && css.includes('.dash-fiado-banner'));
    });

    console.log(`\nTodos os ${ok} testes da Fase 3 passaram.`);
})();
