/*
 * Paginação e ordenação das tabelas do sistema.
 *
 * Não depende de cada renderizador: observa os contêineres das listas e,
 * sempre que o conteúdo muda, aplica a ordenação escolhida e mostra
 * apenas a página atual, com controles de paginação embaixo.
 */
(function (raiz) {
    'use strict';

    const PAGE_SIZE = 7;

    // Cada tabela: contêiner que recebe as linhas, host onde fica a paginação
    // e o cabeçalho com as colunas (na mesma ordem das células).
    const TABELAS = [
        { container: 'products-items-container', host: 'products-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row, .tabela-card', pageSize: 7, pageSizeCards: 8, rowHeight: 52 },
        { container: 'customers-items-container', host: 'customers-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row', pageSize: 7, rowHeight: 56 },
        { container: 'history-items-container', host: 'history-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row', pageSize: 7, rowHeight: 52 },
        { container: 'entradas-items-container', host: 'entradas-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row, .tabela-card', pageSize: 7, pageSizeCards: 8, rowHeight: 48 },
        { container: 'estoque-grid', host: 'estoque-grid', tabela: true, pageSize: 7, rowHeight: 48 },
    ];

    function calcularLinhasQueCabem(cfg, container, linhas) {
        if (typeof window === 'undefined' || !window.innerHeight) return null;
        if (window.innerWidth && window.innerWidth <= 900) return null;
        if (container && container.dataset && container.dataset.visao === 'cards') return null;
        const host = hostDe(cfg, container);
        if (!host || typeof host.getBoundingClientRect !== 'function') return null;
        const rect = host.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.top <= 0) return null;

        const cab = cabecalhoDe(cfg, container);
        const cabH = cab && typeof cab.getBoundingClientRect === 'function'
            ? Math.max(36, cab.getBoundingClientRect().height || 38)
            : 38;
        const pagerH = 46;
        const margemInferior = 18;
        const disponivel = window.innerHeight - rect.top - cabH - pagerH - margemInferior;
        if (disponivel < 160) return 4;

        let linhaH = cfg.rowHeight || 52;
        if (Array.isArray(linhas)) {
            let maxMedido = 0;
            let amostras = 0;
            for (let i = 0; i < linhas.length && amostras < 5; i++) {
                const l = linhas[i];
                if (!l || l.hidden || typeof l.getBoundingClientRect !== 'function') continue;
                const h = l.getBoundingClientRect().height;
                if (h >= 36 && h <= 84) {
                    if (h > maxMedido) maxMedido = h;
                    amostras++;
                }
            }
            if (maxMedido > 0) linhaH = Math.max(linhaH, Math.ceil(maxMedido));
        }
        return Math.max(4, Math.min(15, Math.floor(disponivel / linhaH)));
    }

    function pageSizeDe(cfg, container, linhas) {
        if (container && container.dataset && container.dataset.visao === 'cards' && cfg.pageSizeCards) {
            return cfg.pageSizeCards;
        }
        const ajustado = calcularLinhasQueCabem(cfg, container, linhas);
        if (ajustado !== null) return ajustado;
        return cfg.pageSize || PAGE_SIZE;
    }

    const estados = new WeakMap();
    const observadores = new Map();

    function estadoDe(el) {
        if (!estados.has(el)) estados.set(el, { page: 1, sort: -1, dir: 1, assinatura: null });
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

    // Converte o texto de uma célula (ou seu atributo data-sort) em valor comparável
    function chaveDe(celulaOuTexto) {
        if (celulaOuTexto && typeof celulaOuTexto === 'object') {
            const ds = celulaOuTexto.dataset ? celulaOuTexto.dataset.sort : (celulaOuTexto.getAttribute ? celulaOuTexto.getAttribute('data-sort') : null);
            if (ds !== undefined && ds !== null && ds !== '') {
                const n = Number(ds);
                if (!Number.isNaN(n)) return n;
                return String(ds).toLowerCase();
            }
            celulaOuTexto = celulaOuTexto.textContent;
        }
        const t = String(celulaOuTexto || '').replace(/\s+/g, ' ').trim();
        const data = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
        if (data) {
            return Date.UTC(
                Number(data[3]),
                Number(data[2]) - 1,
                Number(data[1]),
                data[4] ? Number(data[4]) : 0,
                data[5] ? Number(data[5]) : 0
            );
        }
        if (/R\$|un\.|itens|produtos?|^-?[\d.,]+$/.test(t)) {
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

    function assinaturaLinhas(linhas) {
        if (!linhas.length) return '0';
        const primeira = (linhas[0].textContent || '').trim().slice(0, 60);
        const ultima = (linhas[linhas.length - 1].textContent || '').trim().slice(0, 60);
        return linhas.length + '|' + primeira + '|' + ultima;
    }

    function ordenar(cfg, container, st) {
        if (st.sort < 0 || container.dataset.visao === 'cards') return;
        const corpo = corpoDe(cfg, container);
        const linhas = linhasDe(cfg, container);
        if (!corpo || linhas.length < 2) return;
        const itens = linhas.map(l => {
            const celula = l.children[st.sort];
            return { l: l, k: chaveDe(celula || '') };
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
            c.setAttribute('tabindex', '0');
            if (!cfg.tabela) c.setAttribute('role', 'button');
            if (!c.querySelector('.sort-ico')) {
                const ic = document.createElement('i');
                ic.className = 'bx bx-sort-alt-2 sort-ico';
                ic.setAttribute('aria-hidden', 'true');
                c.appendChild(ic);
            }
        });
        Array.from(cab.querySelectorAll('.sortable')).forEach(c => {
            const ico = c.querySelector('.sort-ico');
            const ativo = Number(c.dataset.col) === st.sort;
            c.classList.toggle('sorted', ativo);
            c.setAttribute('aria-sort', ativo ? (st.dir === 1 ? 'ascending' : 'descending') : 'none');
            if (ico) ico.className = 'bx sort-ico ' + (ativo ? (st.dir === 1 ? 'bx-sort-up' : 'bx-sort-down') : 'bx-sort-alt-2');
        });
    }

    function paginar(cfg, container, st) {
        const linhas = linhasDe(cfg, container);
        const total = linhas.length;
        const porPagina = pageSizeDe(cfg, container, linhas);
        const pags = Math.max(1, Math.ceil(total / porPagina));
        if (st.page > pags) st.page = pags;
        if (st.page < 1) st.page = 1;
        const ini = (st.page - 1) * porPagina;
        const fim = ini + porPagina;

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
                aplicar(cfg, false);
            });
            host.appendChild(pg);
        }
        pg.innerHTML =
            '<span class="tabela-pager-info">Mostrando ' + (ini + 1) + '–' + Math.min(fim, total) + ' de ' + total + '</span>' +
            '<div class="tabela-pager-controles">' +
            '<button type="button" class="tabela-pager-btn" data-pag="-1" title="Página anterior" aria-label="Página anterior"' + (st.page === 1 ? ' disabled' : '') + '><i class="bx bx-chevron-left" aria-hidden="true"></i></button>' +
            '<span class="tabela-pager-num">' + st.page + ' / ' + pags + '</span>' +
            '<button type="button" class="tabela-pager-btn" data-pag="1" title="Próxima página" aria-label="Próxima página"' + (st.page === pags ? ' disabled' : '') + '><i class="bx bx-chevron-right" aria-hidden="true"></i></button>' +
            '</div>';
    }

    function alternarOrdenacao(cfg, container, col) {
        const st = estadoDe(container);
        if (st.sort === col) {
            if (st.dir === 1) st.dir = -1;
            else { st.sort = -1; st.dir = 1; }
        } else {
            st.sort = col;
            st.dir = 1;
        }
        st.page = 1;
        aplicar(cfg, false);
    }

    function garantirCliqueNoCabecalho(cfg, container) {
        const alvo = cfg.tabela ? container : document.getElementById(cfg.host);
        if (!alvo || alvo.dataset.sortDelegado === '1') return;
        alvo.dataset.sortDelegado = '1';
        alvo.addEventListener('click', e => {
            const c = e.target.closest('.sortable');
            if (!c) return;
            alternarOrdenacao(cfg, container, Number(c.dataset.col));
        });
        alvo.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const c = e.target.closest('.sortable');
            if (!c) return;
            e.preventDefault();
            alternarOrdenacao(cfg, container, Number(c.dataset.col));
        });
    }

    function aplicar(cfg, veioDeMutacao) {
        const container = document.getElementById(cfg.container);
        if (!container) return;
        const info = observadores.get(cfg.container);
        if (info) info.obs.disconnect();
        try {
            const st = estadoDe(container);
            const linhasAtuais = linhasDe(cfg, container);
            const sig = assinaturaLinhas(linhasAtuais);
            // Quando uma nova renderização/filtro altera o conjunto de registros, volta para a página 1
            if (veioDeMutacao && st.assinatura !== null && sig !== st.assinatura) {
                st.page = 1;
            }
            garantirCliqueNoCabecalho(cfg, container);
            prepararCabecalho(cfg, container, st);
            ordenar(cfg, container, st);
            st.assinatura = assinaturaLinhas(linhasDe(cfg, container));
            paginar(cfg, container, st);
        } finally {
            if (info) info.obs.observe(container, info.opcoes);
        }
    }

    /** Limpa a ordenação manual da coluna (ex.: quando o usuário troca um select externo de ordenação). */
    function resetarOrdenacao(containerId) {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;
        const st = estadoDe(container);
        st.sort = -1;
        st.dir = 1;
        st.page = 1;
        const cfg = TABELAS.find(t => t.container === containerId || t.host === containerId);
        if (cfg) prepararCabecalho(cfg, container, st);
    }

    function reajustarTodas() {
        if (typeof document === 'undefined') return;
        TABELAS.forEach(cfg => aplicar(cfg, false));
    }

    function iniciar() {
        if (typeof document === 'undefined') return;
        TABELAS.forEach(cfg => {
            const container = document.getElementById(cfg.container);
            if (!container) return;
            const opcoes = cfg.tabela ? { childList: true, subtree: true } : { childList: true };
            const obs = new MutationObserver(() => aplicar(cfg, true));
            observadores.set(cfg.container, { obs: obs, opcoes: opcoes });
            obs.observe(container, opcoes);
            aplicar(cfg, false);
        });
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            let timer = null;
            window.addEventListener('resize', () => {
                clearTimeout(timer);
                timer = setTimeout(reajustarTodas, 120);
            });
        }
    }

    const API = { chaveDe, comparar, resetarOrdenacao, reajustarTodas, PAGE_SIZE };
    raiz.Tabela = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', iniciar);
        } else {
            iniciar();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
