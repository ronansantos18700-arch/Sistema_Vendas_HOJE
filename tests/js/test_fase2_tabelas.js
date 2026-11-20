// Testes da Fase 2: tabela.js (ordenação, data-sort, paginação, teclado, reset),
// filtros rápidos (Clientes, Saídas, Movimentações), detalhes de venda/entrada e Estoque.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const front = path.join(__dirname, '..', '..', 'SistemaVendas', 'frontend');
const html = fs.readFileSync(path.join(front, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(front, 'style.css'), 'utf8');

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

// ============================================================================
// 1. Testes unitários e de interação de tabela.js (DOM mínimo com MutationObserver)
// ============================================================================
function criarMiniDomTabela() {
    const observadores = [];

    class FakeEl {
        constructor(tag, opts = {}) {
            this.nodeType = 1;
            this.tagName = tag.toUpperCase();
            this.id = opts.id || '';
            this.className = opts.className || '';
            this.children = [];
            this.parentNode = null;
            this.dataset = Object.assign({}, opts.dataset || {});
            this.attrs = Object.assign({}, opts.attrs || {});
            this.style = { display: '' };
            this._text = opts.text || '';
            this.hidden = false;
            this.disabled = false;
            this.listeners = {};
            this.classList = {
                add: (...cs) => cs.forEach(c => {
                    const arr = this.className.split(/\s+/).filter(Boolean);
                    if (!arr.includes(c)) arr.push(c);
                    this.className = arr.join(' ');
                }),
                remove: (...cs) => {
                    const arr = this.className.split(/\s+/).filter(Boolean).filter(c => !cs.includes(c));
                    this.className = arr.join(' ');
                },
                contains: (c) => this.className.split(/\s+/).includes(c),
                toggle: (c, f) => {
                    const tem = this.className.split(/\s+/).includes(c);
                    const ligar = f === undefined ? !tem : !!f;
                    if (ligar) this.classList.add(c); else this.classList.remove(c);
                }
            };
        }
        get textContent() {
            if (this._text) return this._text;
            return this.children.map(c => c.textContent).join(' ');
        }
        set textContent(v) { this._text = String(v); }
        set innerHTML(v) { this._html = String(v); }
        get innerHTML() { return this._html || ''; }
        setAttribute(k, v) {
            this.attrs[k] = String(v);
            if (k === 'data-sort') this.dataset.sort = String(v);
        }
        getAttribute(k) {
            if (k === 'data-sort' && this.dataset.sort !== undefined) return String(this.dataset.sort);
            return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
        }
        hasAttribute(k) { return this.getAttribute(k) !== null; }
        removeAttribute(k) { delete this.attrs[k]; if (k === 'data-sort') delete this.dataset.sort; }
        appendChild(ch) {
            if (ch.parentNode) {
                const idx = ch.parentNode.children.indexOf(ch);
                if (idx >= 0) ch.parentNode.children.splice(idx, 1);
            }
            ch.parentNode = this;
            this.children.push(ch);
            return ch;
        }
        insertBefore(ch, ref) {
            if (ch.parentNode) {
                const idx = ch.parentNode.children.indexOf(ch);
                if (idx >= 0) ch.parentNode.children.splice(idx, 1);
            }
            ch.parentNode = this;
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i >= 0) this.children.splice(i, 0, ch);
            else this.children.push(ch);
            return ch;
        }
        remove() {
            if (!this.parentNode) return;
            const idx = this.parentNode.children.indexOf(this);
            if (idx >= 0) this.parentNode.children.splice(idx, 1);
            this.parentNode = null;
        }
        matches(sel) {
            return sel.split(',').some(parte => {
                const s = parte.trim();
                if (s === '.nested-item-labs-row') return this.classList.contains('nested-item-labs-row');
                if (s === '.tabela-card') return this.classList.contains('tabela-card');
                if (s === '.list-header-labs') return this.classList.contains('list-header-labs');
                if (s === '.sortable') return this.classList.contains('sortable');
                if (s === '.sort-ico') return this.classList.contains('sort-ico');
                if (s.startsWith('.tabela-pager')) {
                    if (!this.classList.contains('tabela-pager')) return false;
                    const m = s.match(/\[data-tabela="([^"]+)"\]/);
                    return m ? this.dataset.tabela === m[1] : true;
                }
                if (s === '[data-pag]') return this.dataset.pag !== undefined;
                return false;
            });
        }
        closest(sel) {
            let cur = this;
            while (cur) {
                if (cur.matches(sel)) return cur;
                cur = cur.parentNode;
            }
            return null;
        }
        querySelectorAll(sel) {
            const out = [];
            const escopo = sel.startsWith(':scope > ');
            const alvo = escopo ? sel.slice(9) : sel;
            const walk = (el) => {
                for (const c of el.children) {
                    if (c.matches(alvo)) out.push(c);
                    if (!escopo) walk(c);
                }
            };
            walk(this);
            return out;
        }
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
        addEventListener(ev, fn) {
            this.listeners[ev] = this.listeners[ev] || [];
            this.listeners[ev].push(fn);
        }
        dispatch(ev, payload = {}) {
            const e = Object.assign({ target: this, preventDefault: () => {} }, payload);
            (this.listeners[ev] || []).forEach(fn => fn(e));
        }
    }

    const containers = {};
    const document = {
        readyState: 'complete',
        getElementById: (id) => containers[id] || null,
        createElement: (tag) => new FakeEl(tag),
        addEventListener: () => {}
    };

    class FakeMutationObserver {
        constructor(cb) { this.cb = cb; this.conectado = false; }
        observe(target) {
            this.conectado = true;
            if (!observadores.some(o => o.obs === this)) observadores.push({ obs: this, target, cb: this.cb });
        }
        disconnect() { this.conectado = false; }
    }

    const ctx = {
        document,
        window: {},
        MutationObserver: FakeMutationObserver,
        console,
        Intl
    };
    ctx.window = ctx;
    vm.createContext(ctx);

    function registrarLista(hostId, containerId, headers, linhas) {
        const host = new FakeEl('div', { id: hostId });
        const header = new FakeEl('div', { className: 'list-header-labs' });
        headers.forEach(h => header.appendChild(new FakeEl('span', { text: h })));
        host.appendChild(header);
        const cont = new FakeEl('div', { id: containerId });
        linhas.forEach(cols => {
            const row = new FakeEl('div', { className: 'nested-item-labs-row' });
            cols.forEach(c => {
                if (typeof c === 'string') row.appendChild(new FakeEl('span', { text: c }));
                else row.appendChild(new FakeEl('span', { text: c.text, dataset: c.sort !== undefined ? { sort: String(c.sort) } : {} }));
            });
            cont.appendChild(row);
        });
        host.appendChild(cont);
        containers[hostId] = host;
        containers[containerId] = cont;
        return { host, cont };
    }

    function trocarLinhas(cont, linhas) {
        cont.children = [];
        linhas.forEach(cols => {
            const row = new FakeEl('div', { className: 'nested-item-labs-row' });
            cols.forEach(c => {
                if (typeof c === 'string') row.appendChild(new FakeEl('span', { text: c }));
                else row.appendChild(new FakeEl('span', { text: c.text, dataset: c.sort !== undefined ? { sort: String(c.sort) } : {} }));
            });
            cont.appendChild(row);
        });
        observadores.filter(o => o.target === cont && o.obs.conectado).forEach(o => o.cb([]));
    }

    return { ctx, FakeEl, registrarLista, trocarLinhas };
}

// ============================================================================
// 2. Ambiente integrado do app.js (reaproveitando o mesmo padrão da Fase 1)
// ============================================================================
function criarAmbienteApp() {
    const elementos = {};
    function criarEl(id) {
        if (!elementos[id]) {
            const classes = new Set();
            const listeners = {};
            const el = {
                id,
                value: '',
                textContent: '',
                innerHTML: '',
                type: 'text',
                disabled: false,
                checked: false,
                style: {},
                dataset: {},
                attrs: {},
                _children: [],
                classList: {
                    add: (...cs) => cs.forEach(c => classes.add(c)),
                    remove: (...cs) => cs.forEach(c => classes.delete(c)),
                    contains: (c) => classes.has(c),
                    toggle: (c, f) => {
                        const ligar = f === undefined ? !classes.has(c) : !!f;
                        if (ligar) classes.add(c); else classes.delete(c);
                    }
                },
                addEventListener: (ev, fn) => {
                    listeners[ev] = listeners[ev] || [];
                    listeners[ev].push(fn);
                },
                trigger: (ev, e = {}) => (listeners[ev] || []).forEach(fn => fn(Object.assign({ target: el, currentTarget: el }, e))),
                focus: () => {},
                select: () => {},
                click: () => el.trigger('click'),
                setAttribute: (k, v) => { el.attrs[k] = String(v); },
                getAttribute: (k) => (Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null),
                querySelector: () => null,
                querySelectorAll: () => []
            };
            elementos[id] = el;
        }
        return elementos[id];
    }

    let tabelaResetCalls = [];
    const ctx = {
        console, setTimeout, clearTimeout, Date, Math, JSON, Intl, Array, Object, Number, String, Boolean, RegExp, Error, Promise, Map, Set,
        localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
        document: {
            getElementById: (id) => criarEl(id),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            body: { classList: { toggle: () => {}, add: () => {}, remove: () => {} }, appendChild: () => {} },
            createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, click: () => {}, remove: () => {} })
        },
        addEventListener: () => {},
        matchMedia: () => ({ matches: false }),
        chrome: null,
        Tabela: {
            resetarOrdenacao: (id) => tabelaResetCalls.push(id)
        },
        navigator: { clipboard: { writeText: () => Promise.resolve() } },
        lucide: { createIcons: () => {} },
        Chart: function () { return { destroy: () => {}, update: () => {}, data: { labels: [], datasets: [] } }; },
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
    app.openModal = () => {};
    app.showNotification = () => {};
    app.saveData = async () => true;
    app.state.currentUser = { id: 'admin', name: 'Admin', role: 'admin', username: 'admin' };
    app.state.products = [];
    app.state.customers = [];
    app.state.sales = [];
    app.state.entradas = [];
    app.state.movimentacoes = [];
    app.state.categories = ['Geral'];
    app.state.settings = { storeName: 'Loja', lowStockThreshold: 5 };

    return { app, elementos, tabelaResetCalls, ctx };
}

(async () => {
    await testar('tabela.js: chaveDe prioriza data-sort numérico e interpreta datas com hora e "1 produto"', () => {
        const { ctx, FakeEl } = criarMiniDomTabela();
        vm.runInContext(fs.readFileSync(path.join(front, 'tabela.js'), 'utf8'), ctx, { filename: 'tabela.js' });
        const { chaveDe, comparar } = ctx.Tabela;

        // data-sort vence texto complexo de Fiado
        const c1 = new FakeEl('span', { text: 'Falta R$ 250,00 · 5d atraso', dataset: { sort: '250' } });
        const c2 = new FakeEl('span', { text: 'Falta R$ 40,00', dataset: { sort: '40' } });
        const c3 = new FakeEl('span', { text: 'Quitado', dataset: { sort: '0' } });
        assert.strictEqual(chaveDe(c1), 250);
        assert.strictEqual(chaveDe(c2), 40);
        assert.strictEqual(chaveDe(c3), 0);
        assert.ok(comparar(chaveDe(c2), chaveDe(c1)) < 0);

        // data com hora dd/mm/yyyy HH:mm ordena cronologicamente
        const d1 = new FakeEl('span', { text: '05/03/2026 09:15' });
        const d2 = new FakeEl('span', { text: '05/03/2026 18:45' });
        assert.strictEqual(typeof chaveDe(d1), 'number');
        assert.ok(chaveDe(d2) > chaveDe(d1), 'horário 18:45 deve ordenar depois de 09:15');

        // singular "1 produto" vs plural "10 produtos"
        const p1 = new FakeEl('span', { text: '1 produto' });
        const p10 = new FakeEl('span', { text: '10 produtos' });
        assert.strictEqual(chaveDe(p1), 1);
        assert.strictEqual(chaveDe(p10), 10);
        assert.ok(comparar(chaveDe(p1), chaveDe(p10)) < 0);

        // moeda brasileira formatada
        const m1 = new FakeEl('span', { text: 'R$ 1.250,50' });
        const m2 = new FakeEl('span', { text: 'R$ 95,00' });
        assert.strictEqual(chaveDe(m1), 1250.5);
        assert.ok(comparar(chaveDe(m2), chaveDe(m1)) < 0);
    });

    await testar('tabela.js: paginação volta para página 1 quando filtro altera linhas e cabeçalhos suportam teclado/aria', () => {
        const { ctx, FakeEl, registrarLista, trocarLinhas } = criarMiniDomTabela();
        const linhas20 = Array.from({ length: 20 }, (_, i) => [
            `#${i + 1}`,
            `Cliente ${String(i + 1).padStart(2, '0')}`,
            { text: `Falta R$ ${(i + 1) * 10},00`, sort: (i + 1) * 10 },
            'Ações'
        ]);
        const { host, cont } = registrarLista('customers-list-labs', 'customers-items-container', ['CÓD', 'NOME', 'FIADO', 'AÇÕES'], linhas20);

        vm.runInContext(fs.readFileSync(path.join(front, 'tabela.js'), 'utf8'), ctx, { filename: 'tabela.js' });

        // Deve ter criado paginação com 3 páginas (7 + 7 + 6) e aria-label nos botões
        const pager = host.querySelector('.tabela-pager');
        assert.ok(pager, 'paginação criada');
        assert.ok(pager.innerHTML.includes('aria-label="Página anterior"'));
        assert.ok(pager.innerHTML.includes('aria-label="Próxima página"'));
        assert.ok(pager.innerHTML.includes('1 / 3'));

        // Avança para página 2 via evento delegado no pager
        const btnProxFake = new FakeEl('button', { dataset: { pag: '1' } });
        pager.dispatch('click', { target: btnProxFake });
        const visiveisPg2 = cont.children.filter(r => !r.hidden);
        assert.strictEqual(visiveisPg2.length, 7, 'página 2 exibe 7 itens');
        assert.ok(pager.innerHTML.includes('2 / 3'));

        // Simula filtro externo reduzindo para 10 itens -> deve resetar para página 1!
        trocarLinhas(cont, linhas20.slice(0, 10));
        const visiveisAposFiltro = cont.children.filter(r => !r.hidden);
        assert.strictEqual(visiveisAposFiltro.length, 7, 'após filtro deve resetar para página 1 com 7 itens visíveis');
        assert.ok(pager.innerHTML.includes('1 / 2'), 'indicador de página volta para 1 / 2');

        // Cabeçalhos ordenáveis têm tabindex, role="button", aria-sort e ordenam com Enter
        const thFiado = host.querySelector('.list-header-labs').children[2];
        assert.strictEqual(thFiado.getAttribute('tabindex'), '0');
        assert.strictEqual(thFiado.getAttribute('role'), 'button');
        assert.strictEqual(thFiado.getAttribute('aria-sort'), 'none');

        let prevented = false;
        host.dispatch('keydown', { key: 'Enter', target: thFiado, preventDefault: () => { prevented = true; } });
        assert.ok(prevented, 'Enter previne ação padrão');
        assert.strictEqual(thFiado.getAttribute('aria-sort'), 'ascending');

        // Reset de ordenação via API pública limpa aria-sort e classe sorted
        ctx.Tabela.resetarOrdenacao('customers-items-container');
        assert.strictEqual(thFiado.getAttribute('aria-sort'), 'none');
        assert.ok(!thFiado.classList.contains('sorted'));
    });

    await testar('Clientes: chips de fiado filtram aberto/atraso, emitem data-sort e preservam busca', () => {
        const { app, elementos } = criarAmbienteApp();
        const pad2 = (n) => String(n).padStart(2, '0');
        const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        const ontem = new Date(Date.now() - 3 * 86400000);
        const amanha = new Date(Date.now() + 5 * 86400000);
        app.state.customers = [
            { id: 'c1', name: 'Ana Atrasada', whatsapp: '21999990001' },
            { id: 'c2', name: 'Bruno Em Dia', whatsapp: '21999990002' },
            { id: 'c3', name: 'Carla Quitado', whatsapp: '21999990003' }
        ];
        app.state.sales = [
            { id: 'v1', cliente_id: 'c1', cliente: 'Ana Atrasada', pagamento: 'fiado', valor_final: 120, date: ontem.toISOString(), vencimento: ymd(ontem), recebimentos: [] },
            { id: 'v2', cliente_id: 'c2', cliente: 'Bruno Em Dia', pagamento: 'fiado', valor_final: 80, date: new Date().toISOString(), vencimento: ymd(amanha), recebimentos: [] },
            { id: 'v3', cliente_id: 'c3', cliente: 'Carla Quitado', pagamento: 'fiado', valor_final: 50, date: ontem.toISOString(), recebimentos: [{ id: 'r1', valor: 50, forma: 'pix', date: new Date().toISOString() }] }
        ];

        // Todos
        app.state.customersFiadoFilter = 'todos';
        app.renderCustomers();
        const htmlTodos = elementos['customers-items-container'].innerHTML;
        assert.ok(htmlTodos.includes('Ana Atrasada') && htmlTodos.includes('Bruno Em Dia') && htmlTodos.includes('Carla Quitado'));
        assert.ok(htmlTodos.includes('data-sort="120.00"') || htmlTodos.includes('data-sort="120"'), 'deve emitir data-sort numérico no saldo fiado');
        assert.ok(htmlTodos.includes('data-sort="0.00"') || htmlTodos.includes('data-sort="0"'), 'cliente quitado emite data-sort="0"');

        // Somente com fiado em aberto
        app.state.customersFiadoFilter = 'aberto';
        app.renderCustomers();
        const htmlAberto = elementos['customers-items-container'].innerHTML;
        assert.ok(htmlAberto.includes('Ana Atrasada') && htmlAberto.includes('Bruno Em Dia'));
        assert.ok(!htmlAberto.includes('Carla Quitado'));

        // Somente em atraso
        app.state.customersFiadoFilter = 'atraso';
        app.renderCustomers();
        const htmlAtraso = elementos['customers-items-container'].innerHTML;
        assert.ok(htmlAtraso.includes('Ana Atrasada'));
        assert.ok(!htmlAtraso.includes('Bruno Em Dia') && !htmlAtraso.includes('Carla Quitado'));
    });

    await testar('Saídas: filtra por forma de pagamento (incl. Misto), mostra HH:mm, usa btn-action-view e mostra limpar filtros', () => {
        const { app, elementos } = criarAmbienteApp();
        app.state.sales = [
            {
                id: 'v-pix',
                date: '2026-03-10T17:35:00.000Z',
                cliente: 'Maria',
                pagamento: 'pix',
                items: [{ id: 'p1', name: 'Café', qty: 2, price: 15 }],
                valor_total: 30, desconto: 0, valor_final: 30, cost: 12, lucro: 18
            },
            {
                id: 'v-misto',
                date: '2026-03-10T18:10:00.000Z',
                cliente: 'João',
                pagamento: 'misto',
                pagamentos: [{ forma: 'dinheiro', valor: 20 }, { forma: 'cartao', valor: 30 }],
                items: [{ id: 'p1', name: 'Café', qty: 3, price: 20 }],
                valor_total: 60, desconto: 10, valor_final: 50, cost: 18, lucro: 32
            }
        ];

        // Sem filtros: botão limpar oculto, exibe ambas, hora formatada, PIX capitalizado e ITENS só com botão Ver
        app.renderHistory();
        assert.ok(elementos['btn-clear-history-filters'].classList.contains('hidden'));
        const htmlAll = elementos['history-items-container'].innerHTML;
        assert.ok(htmlAll.includes('col-date-hora'), 'deve exibir hora discreta na coluna de data');
        assert.ok(htmlAll.includes('btn-action-view'), 'botão de recibo deve usar classe btn-action-view');
        assert.ok(htmlAll.includes('data-sort="30"') && htmlAll.includes('data-sort="50"'));
        assert.ok(htmlAll.includes('btn-itens-ver') && !htmlAll.includes('itens-resumo'), 'coluna ITENS deve exibir somente o botão Ver');
        assert.ok(htmlAll.includes('>PIX<'), 'forma de pagamento pix deve aparecer capitalizada como PIX');

        // Filtro por pix
        elementos['filter-payment-history'].value = 'pix';
        app.renderHistory();
        assert.ok(!elementos['btn-clear-history-filters'].classList.contains('hidden'), 'limpar filtros visível com filtro ativo');
        const htmlPix = elementos['history-items-container'].innerHTML;
        assert.ok(htmlPix.includes('Maria') && !htmlPix.includes('João'));

        // Filtro por cartao também encontra venda Misto que inclui cartao
        elementos['filter-payment-history'].value = 'cartao';
        app.renderHistory();
        const htmlCartao = elementos['history-items-container'].innerHTML;
        assert.ok(htmlCartao.includes('João') && !htmlCartao.includes('Maria'));
    });

    await testar('showSaleDetails: exibe preço unitário, subtotal por item e rodapé com totais', () => {
        const { app, elementos } = criarAmbienteApp();
        app.state.sales = [{
            id: 'v-det',
            date: '2026-03-10T15:00:00.000Z',
            cliente: 'Paula',
            pagamento: 'pix',
            items: [{ id: 'p1', name: 'Chá', qty: 3, price: 12.5 }],
            valor_total: 37.5,
            desconto: 2.5,
            valor_final: 35
        }];

        app.showSaleDetails('v-det');
        const itemsHtml = elementos['sale-details-items'].innerHTML;
        const summaryHtml = elementos['sale-details-summary'].innerHTML;
        assert.ok(itemsHtml.includes('12,50'), 'exibe preço unitário formatado em pt-BR');
        assert.ok(itemsHtml.includes('37,50'), 'exibe subtotal do item formatado em pt-BR');
        assert.ok(summaryHtml.includes('Paula') && summaryHtml.toLowerCase().includes('pix') && summaryHtml.includes('35,00') && summaryHtml.includes('2,50'));
    });

    await testar('Entradas: renderEntradas, renderEntradaItemsTemp e showEntradaDetails usam formatCurrency pt-BR', () => {
        const { app, elementos } = criarAmbienteApp();
        app.state.entradas = [{
            id: 'ent-1',
            date: '2026-03-11T12:00:00.000Z',
            fornecedor: 'Distribuidora Sul',
            nota: 'NF-100',
            totalCusto: 1250.5,
            items: [{ productId: 'p1', productName: 'Arroz', qty: 10, unitCost: 125.05, totalCost: 1250.5 }]
        }];
        app.entradaItemsTemp = [{ productId: 'p1', productName: 'Arroz', qty: 2, unitCost: 12.5, totalCost: 25 }];

        app.renderEntradas();
        assert.ok(elementos['entradas-items-container'].innerHTML.includes('1.250,50'));
        assert.ok(elementos['entradas-items-container'].innerHTML.includes('data-sort="1250.50"') || elementos['entradas-items-container'].innerHTML.includes('data-sort="1250.5"'));

        app.renderEntradaItemsTemp();
        assert.ok(elementos['entrada-items-temp-container'].innerHTML.includes('12,50'));
        assert.ok(!elementos['entrada-items-temp-container'].innerHTML.includes('12.50'), 'não deve usar ponto decimal');

        app.showEntradaDetails('ent-1');
        assert.ok(elementos['details-entrada-total'].textContent.includes('1.250,50'));
        assert.ok(elementos['details-entrada-items-container'].innerHTML.includes('125,05'));
    });

    await testar('Estoque: usa "Valor em estoque", data-sort na tabela e ações rápidas respeitando permissão', () => {
        const { app, elementos, ctx } = criarAmbienteApp();
        app.state.products = [{ id: 'p1', name: 'Feijão', code: 'F01', category: 'Grãos', stock: 10, cost: 8, price: 14 }];
        ctx.localStorage.setItem('sv_estoque_visao', 'tabela');

        // Admin vê Histórico e Ajustar
        app.state.currentUser = { id: 'admin', name: 'Admin', role: 'admin' };
        app.renderEstoque();
        const htmlTabAdmin = elementos['estoque-grid'].innerHTML;
        assert.ok(htmlTabAdmin.includes('Valor em estoque'), 'coluna renomeada para Valor em estoque');
        assert.ok(!htmlTabAdmin.includes('Capital parado'), 'não usa mais rótulo "Capital parado"');
        assert.ok(htmlTabAdmin.includes('data-sort="10"') && htmlTabAdmin.includes('data-sort="80"'));
        assert.ok(htmlTabAdmin.includes("showProductHistory('p1')"));
        assert.ok(htmlTabAdmin.includes("adjustStock('p1', 2)"));
        assert.ok(htmlTabAdmin.includes('class="actions-inline"'), 'botões de ação da tabela de Estoque devem usar .actions-inline dentro da <td>');
        assert.ok(elementos['estoque-resumo'].innerHTML.includes('estoque-pill-valor'), 'resumo do Estoque deve exibir pílulas evidentes');

        // Operador vê Histórico mas NÃO vê Ajustar
        app.state.currentUser = { id: 'op', name: 'Operador', role: 'operator' };
        app.renderEstoque();
        const htmlTabOp = elementos['estoque-grid'].innerHTML;
        assert.ok(htmlTabOp.includes("showProductHistory('p1')"));
        assert.ok(!htmlTabOp.includes("adjustStock('p1'"));

        // Visão cards também usa "Valor em estoque"
        ctx.localStorage.setItem('sv_estoque_visao', 'cards');
        app.renderEstoque();
        assert.ok(elementos['estoque-grid'].innerHTML.includes('Valor em estoque'));
        assert.ok(!elementos['estoque-grid'].innerHTML.includes('Capital parado'));
    });

    await testar('Movimentações: botão #mov-limpar alterna visibilidade e limpa filtros', () => {
        const { app, elementos } = criarAmbienteApp();
        app.state.movimentacoes = [
            { id: 'm1', produtoId: 'p1', tipo: 'entrada', qtd: 5, custoUnit: 10, data: new Date().toISOString(), obs: 'NF 1' }
        ];
        app.state.products = [{ id: 'p1', name: 'Item A', stock: 5, cost: 10, price: 20 }];

        app.bindMovimentacoes();
        app.renderMovimentacoes();
        assert.ok(elementos['mov-limpar'].classList.contains('hidden'), 'oculto sem filtros');

        // Ativa filtro de busca
        app._movEstado().busca = 'NF';
        app.renderMovimentacoes();
        assert.ok(!elementos['mov-limpar'].classList.contains('hidden'), 'visível com busca ativa');

        // Clica em limpar
        elementos['mov-limpar'].click();
        assert.strictEqual(app._movEstado().busca, '');
        assert.strictEqual(app._movEstado().periodo, 'tudo');
        assert.ok(elementos['mov-limpar'].classList.contains('hidden'), 'volta a ficar oculto após limpar');
    });

    await testar('index.html e style.css: sem cabeçalhos escuros #11111e, paginação real em Movimentações, Clientes 7 colunas e alinhamento consistente', () => {
        assert.ok(!html.includes('#11111e'), 'index.html não deve conter cabeçalhos escuros hardcoded #11111e');
        const modalHeaders = html.match(/modal-list-header/g) || [];
        assert.ok(modalHeaders.length >= 3, 'os 3 cabeçalhos de tabela em modal devem usar .modal-list-header');
        assert.ok(html.includes('id="mov-paginacao"') && html.includes('id="mov-prev"') && html.includes('id="mov-next"'), 'Movimentações deve ter paginação real');
        assert.ok(!html.includes('id="mov-mais"'), 'botão legado Mostrar mais removido em favor da paginação');
        assert.ok(css.includes('overflow-x: auto;'), 'style.css deve habilitar rolagem horizontal segura nas listas');
        assert.ok(css.includes('overflow-y: visible !important;'), 'tabelas paginadas não devem ter rolagem vertical interna');
        assert.ok(css.includes('flex-direction: row !important;'), 'cabeçalhos e células numéricas devem alinhar em linha única');
        assert.ok(css.includes('/* Clientes: 7 colunas equilibradas'), 'style.css deve corrigir grade 7 colunas de Clientes');
        assert.ok(css.includes('.estoque-abas button {\n    width: auto;'), 'botões Produtos/Movimentações devem ter largura automática sem sobreposição');
        assert.ok(css.includes('display: table-cell;'), 'td.col-actions-tab deve preservar display: table-cell');
        assert.ok(css.includes('flex-wrap: nowrap;'), 'col-actions deve manter botões na horizontal');
    });

    console.log(`\nTodos os ${ok} testes da Fase 2 passaram.`);
})();
