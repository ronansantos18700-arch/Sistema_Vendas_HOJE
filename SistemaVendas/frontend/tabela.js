/*
 * Paginação e ordenação das tabelas do sistema.
 *
 * Não depende de cada renderizador: observa os contêineres das listas e,
 * sempre que o conteúdo muda, aplica a ordenação escolhida e mostra
 * apenas a página atual, com controles de paginação embaixo.
 */
(function () {
    'use strict';

    const PAGE_SIZE = 15;

    // Cada tabela: contêiner que recebe as linhas, host onde fica a paginação
    // e o cabeçalho com as colunas (na mesma ordem das células).
    const TABELAS = [
        { container: 'products-items-container', host: 'products-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row, .tabela-card' },
        { container: 'customers-items-container', host: 'customers-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row' },
        { container: 'history-items-container', host: 'history-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row' },
        { container: 'entradas-items-container', host: 'entradas-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row, .tabela-card' },
        { container: 'estoque-grid', host: 'estoque-grid', tabela: true },
    ];

    const estados = new WeakMap();
    const observadores = new Map();

    function estadoDe(el) {
        if (!estados.has(el)) estados.set(el, { page: 1, sort: -1, dir: 1 });
        return estados.get(el);
    }

    function hostDe(cfg, container) {
        if (cfg.tabela) return container.querySelector('.table-container-labs');
        return document.getElementById(cfg.host);
    }

    function cabecalhoDe(cfg, container) {
        if (cfg.tabela) return container.querySelector('table.custom-table-labs thead');
        const host = document.getElementById(cfg.host);
        return host ? host.querySelector(cfg.header) : null;
    }

    function corpoDe(cfg, container) {
        if (cfg.tabela) return container.querySelector('table.custom-table-labs tbody');
        return container;
    }

    function linhasDe(cfg, container) {
        if (cfg.tabela) {
            const corpo = corpoDe(cfg, container);
            return corpo ? Array.from(corpo.querySelectorAll(':scope > tr')) : [];
        }
        return Array.from(container.children).filter(el => el.nodeType === 1 && el.matches(cfg.rows));
    }

    // Converte o texto de uma célula em valor comparável (data, número ou texto)
    function chaveDe(txt) {
        const t = (txt || '').replace(/\s+/g, ' ').trim();
        const data = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (data) return Date.UTC(Number(data[3]), Number(data[2]) - 1, Number(data[1]));
        if (/R\$|un\.|itens|produtos|^-?[\d.,]+$/.test(t)) {
            const num = t.match(/-?\d[\d.]*(,\d+)?/);
            if (num) {
                let s = num[0];
                if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
                const n = parseFloat(s);
                if (!isNaN(n)) return n;
            }
        }
        return t.toLowerCase();
    }

    function comparar(a, b) {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
    }

    function ordenar(cfg, container, st) {
        if (st.sort < 0 || container.dataset.visao === 'cards') return;
        const corpo = corpoDe(cfg, container);
        const linhas = linhasDe(cfg, container);
        if (!corpo || linhas.length < 2) return;
        const itens = linhas.map(l => {
            const celula = l.children[st.sort];
            return { l: l, k: chaveDe(celula ? celula.textContent : '') };
        });
        itens.sort((a, b) => comparar(a.k, b.k) * st.dir);
        const mudou = itens.some((it, i) => linhas[i] !== it.l);
        if (mudou) itens.forEach(it => corpo.appendChild(it.l));
    }

    function prepararCabecalho(cfg, container, st) {
        const cab = cabecalhoDe(cfg, container);
        if (!cab) return;
        const celulas = cfg.tabela ? cab.querySelectorAll('th') : cab.children;
        Array.from(celulas).forEach((c, i) => {
            const t = c.textContent.trim().toUpperCase();
            if (!t || t.indexOf('AÇÕES') === 0 || t.indexOf('ACOES') === 0) return;
            c.classList.add('sortable');
            c.dataset.col = String(i);
            if (!c.querySelector('.sort-ico')) {
                const ic = document.createElement('i');
                ic.className = 'bx bx-sort-alt-2 sort-ico';
                c.appendChild(ic);
            }
        });
        Array.from(cab.querySelectorAll('.sortable')).forEach(c => {
            const ico = c.querySelector('.sort-ico');
            const ativo = Number(c.dataset.col) === st.sort;
            c.classList.toggle('sorted', ativo);
            if (ico) ico.className = 'bx sort-ico ' + (ativo ? (st.dir === 1 ? 'bx-sort-up' : 'bx-sort-down') : 'bx-sort-alt-2');
        });
    }

    function paginar(cfg, container, st) {
        const linhas = linhasDe(cfg, container);
        const total = linhas.length;
        const pags = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (st.page > pags) st.page = pags;
        if (st.page < 1) st.page = 1;
        const ini = (st.page - 1) * PAGE_SIZE;
        const fim = ini + PAGE_SIZE;

        linhas.forEach((l, i) => {
            l.classList.add('tabela-item');
            l.hidden = !(i >= ini && i < fim);
        });

        const host = hostDe(cfg, container);
        if (!host) return;
        let pg = host.querySelector(':scope > .tabela-pager[data-tabela="' + cfg.container + '"]');
        if (total === 0) {
            if (pg) pg.remove();
            return;
        }
        if (!pg) {
            pg = document.createElement('div');
            pg.className = 'tabela-pager';
            pg.dataset.tabela = cfg.container;
            pg.addEventListener('click', e => {
                const b = e.target.closest('[data-pag]');
                if (!b || b.disabled) return;
                const estado = estadoDe(container);
                estado.page += Number(b.dataset.pag);
                aplicar(cfg);
            });
            host.appendChild(pg);
        }
        pg.innerHTML =
            '<span class="tabela-pager-info">Mostrando ' + (ini + 1) + '–' + Math.min(fim, total) + ' de ' + total + '</span>' +
            '<div class="tabela-pager-controles">' +
            '<button type="button" class="tabela-pager-btn" data-pag="-1" title="Página anterior"' + (st.page === 1 ? ' disabled' : '') + '><i class="bx bx-chevron-left"></i></button>' +
            '<span class="tabela-pager-num">' + st.page + ' / ' + pags + '</span>' +
            '<button type="button" class="tabela-pager-btn" data-pag="1" title="Próxima página"' + (st.page === pags ? ' disabled' : '') + '><i class="bx bx-chevron-right"></i></button>' +
            '</div>';
    }

    function garantirCliqueNoCabecalho(cfg, container) {
        const alvo = cfg.tabela ? container : document.getElementById(cfg.host);
        if (!alvo || alvo.dataset.sortDelegado === '1') return;
        alvo.dataset.sortDelegado = '1';
        alvo.addEventListener('click', e => {
            const c = e.target.closest('.sortable');
            if (!c) return;
            const st = estadoDe(container);
            const col = Number(c.dataset.col);
            if (st.sort === col) {
                if (st.dir === 1) st.dir = -1;
                else { st.sort = -1; st.dir = 1; }
            } else {
                st.sort = col;
                st.dir = 1;
            }
            st.page = 1;
            aplicar(cfg);
        });
    }

    function aplicar(cfg) {
        const container = document.getElementById(cfg.container);
        if (!container) return;
        const info = observadores.get(cfg.container);
        if (info) info.obs.disconnect();
        try {
            const st = estadoDe(container);
            garantirCliqueNoCabecalho(cfg, container);
            prepararCabecalho(cfg, container, st);
            ordenar(cfg, container, st);
            paginar(cfg, container, st);
        } finally {
            if (info) info.obs.observe(container, info.opcoes);
        }
    }

    function iniciar() {
        TABELAS.forEach(cfg => {
            const container = document.getElementById(cfg.container);
            if (!container) return;
            const opcoes = cfg.tabela ? { childList: true, subtree: true } : { childList: true };
            const obs = new MutationObserver(() => aplicar(cfg));
            observadores.set(cfg.container, { obs: obs, opcoes: opcoes });
            obs.observe(container, opcoes);
            aplicar(cfg);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
