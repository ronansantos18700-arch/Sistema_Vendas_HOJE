/*
 * Sistema Unificado de Data Tables (referência Setproduct UI Design).
 *
 * Recursos compartilhados por todas as tabelas:
 * - Marcação semântica <table> / <thead> / <th scope="col"> / <tbody>
 * - Ordenação por coluna com indicador claro de direção e aria-sort
 * - Paginação numerada (< 1 2 3 … N >) com contagem total e seletor de linhas/página
 * - Controle de densidade (Compacta / Confortável / Espaçosa) salvo em localStorage
 * - Seletor de colunas visíveis salvo por tabela em localStorage
 * - Chips de filtros ativos removíveis e anúncios aria-live="polite"
 */
(function (raiz) {
    'use strict';

    const PAGE_SIZE = 7;
    const PAGE_SIZES = [7, 10, 15, 25];
    const DENSIDADES = [
        { id: 'compacta', rotulo: 'Compacta' },
        { id: 'confortavel', rotulo: 'Confortável' },
        { id: 'espacosa', rotulo: 'Espaçosa' }
    ];
    const KEY_DENSIDADE = 'sv_tabela_densidade';
    const KEY_PAGESIZE = 'sv_tabela_pagesize';
    const KEY_COLS_PREFIX = 'sv_tabela_cols_';

    // Cada tabela gerenciada: container observado, host do cartão e opções de paginação.
    const TABELAS = [
        { id: 'products', container: 'products-items-container', host: 'products-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row, .tabela-card', pageSize: 7, pageSizeCards: 8 },
        { id: 'customers', container: 'customers-items-container', host: 'customers-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row', pageSize: 7 },
        { id: 'history', container: 'history-items-container', host: 'history-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row', pageSize: 7 },
        { id: 'entradas', container: 'entradas-items-container', host: 'entradas-list-labs', header: '.list-header-labs', rows: '.nested-item-labs-row, .tabela-card', pageSize: 7, pageSizeCards: 8 },
        { id: 'estoque', container: 'estoque-grid', host: 'estoque-grid', tabela: true, pageSize: 7 }
    ];

    const estados = new WeakMap();
    const observadores = new Map();
    const memStorage = new Map();

    function lerStorage(chave, fallback) {
        try {
            if (typeof localStorage !== 'undefined') {
                const v = localStorage.getItem(chave);
                if (v !== null) return v;
            }
        } catch (_) { /* modo privado */ }
        return memStorage.has(chave) ? memStorage.get(chave) : fallback;
    }

    function salvarStorage(chave, valor) {
        memStorage.set(chave, String(valor));
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(chave, String(valor));
        } catch (_) { /* modo privado ou ambiente de teste */ }
    }

    function getDensidade() {
        const salvo = lerStorage(KEY_DENSIDADE, 'confortavel');
        return DENSIDADES.some(d => d.id === salvo) ? salvo : 'confortavel';
    }

    function setDensidade(modo) {
        if (!DENSIDADES.some(d => d.id === modo)) return getDensidade();
        salvarStorage(KEY_DENSIDADE, modo);
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.dataset.dtDensity = modo;
        }
        sincronizarMenusDensidade(modo);
        anunciar('Densidade da tabela alterada para ' + (DENSIDADES.find(d => d.id === modo)?.rotulo || modo));
        return modo;
    }

    function getPageSize(cfg, container) {
        if (container && container.dataset && container.dataset.visao === 'cards' && cfg && cfg.pageSizeCards) {
            return cfg.pageSizeCards;
        }
        const salvo = Number(lerStorage(KEY_PAGESIZE, ''));
        if (PAGE_SIZES.includes(salvo)) return salvo;
        return (cfg && cfg.pageSize) || PAGE_SIZE;
    }

    function setPageSize(valor) {
        const n = Number(valor);
        if (!PAGE_SIZES.includes(n)) return getPageSize();
        salvarStorage(KEY_PAGESIZE, n);
        reajustarTodas(true);
        if (typeof window !== 'undefined' && window.app && typeof window.app.renderMovimentacoes === 'function') {
            const mov = document.getElementById('estoque-mov');
            if (mov && !mov.classList.contains('hidden')) {
                window.app._movEstado().page = 1;
                window.app.renderMovimentacoes();
            }
        }
        anunciar('Exibindo ' + n + ' linhas por página');
        return n;
    }

    /**
     * Gera a sequência de páginas para paginação numerada com reticências (ex: [1, '…', 4, 5, 6, '…', 12]).
     */
    function gerarPaginas(atual, total) {
        const t = Math.max(1, Number(total) || 1);
        const a = Math.min(t, Math.max(1, Number(atual) || 1));
        if (t <= 7) {
            const arr = [];
            for (let i = 1; i <= t; i++) arr.push(i);
            return arr;
        }
        const res = [1];
        let ini = Math.max(2, a - 1);
        let fim = Math.min(t - 1, a + 1);
        if (a <= 3) { ini = 2; fim = 4; }
        else if (a >= t - 2) { ini = t - 3; fim = t - 1; }
        if (ini > 2) res.push('…');
        for (let i = ini; i <= fim; i++) res.push(i);
        if (fim < t - 1) res.push('…');
        res.push(t);
        return res;
    }

    function anunciar(mensagem) {
        if (typeof document === 'undefined' || !mensagem) return;
        let reg = document.getElementById('sv-dt-live-region');
        if (!reg && document.body && typeof document.createElement === 'function') {
            reg = document.createElement('div');
            reg.id = 'sv-dt-live-region';
            reg.className = 'sr-only';
            reg.setAttribute('role', 'status');
            reg.setAttribute('aria-live', 'polite');
            reg.setAttribute('aria-atomic', 'true');
            document.body.appendChild(reg);
        }
        if (reg) reg.textContent = mensagem;
    }

    function estadoDe(el) {
        if (!estados.has(el)) estados.set(el, { page: 1, sort: -1, dir: 1, assinatura: null });
        return estados.get(el);
    }

    function ehTbody(el) {
        return !!(el && el.tagName && String(el.tagName).toUpperCase() === 'TBODY');
    }

    function tabelaNativaDe(cfg, container) {
        if (!container) return null;
        if (ehTbody(container)) {
            return container.parentElement && String(container.parentElement.tagName || '').toUpperCase() === 'TABLE'
                ? container.parentElement
                : null;
        }
        if (container.dataset && container.dataset.visao === 'cards') return null;
        if (typeof container.querySelector === 'function') {
            return container.querySelector('table.sv-dt, table.custom-table-labs');
        }
        return null;
    }

    function hostDe(cfg, container) {
        if (cfg.tabela) {
            return (container && typeof container.querySelector === 'function')
                ? container.querySelector('.sv-dt-card, .table-container-labs')
                : null;
        }
        return document.getElementById(cfg.host);
    }

    function cabecalhoDe(cfg, container) {
        const tbl = tabelaNativaDe(cfg, container);
        if (tbl && typeof tbl.querySelector === 'function') {
            return tbl.querySelector('thead');
        }
        const host = document.getElementById(cfg.host);
        return host && typeof host.querySelector === 'function' ? host.querySelector(cfg.header) : null;
    }

    function corpoDe(cfg, container) {
        const tbl = tabelaNativaDe(cfg, container);
        if (tbl && typeof tbl.querySelector === 'function') {
            return tbl.querySelector('tbody');
        }
        return container;
    }

    function linhasDe(cfg, container) {
        const tbl = tabelaNativaDe(cfg, container);
        if (tbl) {
            const corpo = corpoDe(cfg, container);
            if (!corpo) return [];
            const filhos = corpo.children ? Array.from(corpo.children) : [];
            return filhos.filter(el => el.nodeType === 1 && (!el.classList || !el.classList.contains('sv-dt-empty-row')));
        }
        const filhos = container && container.children ? Array.from(container.children) : [];
        return filhos.filter(el => el.nodeType === 1 && typeof el.matches === 'function' && el.matches(cfg.rows));
    }

    // Converte o conteúdo de uma célula em chave de ordenação (prioriza data-sort).
    function chaveDe(alvo) {
        if (alvo && typeof alvo === 'object' && alvo.dataset && alvo.dataset.sort !== undefined && alvo.dataset.sort !== '') {
            const raw = String(alvo.dataset.sort).trim();
            const num = Number(raw);
            if (!Number.isNaN(num)) return num;
            return raw.toLowerCase();
        }
        const texto = typeof alvo === 'string' ? alvo : (alvo && alvo.textContent ? alvo.textContent : '');
        const s = texto.trim();
        if (!s || s === '-' || s === '—' || s === 'N/A' || s === '---') return null;

        const d = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[\s,]+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (d) {
            const dt = new Date(+d[3], +d[2] - 1, +d[1], +(d[4] || 0), +(d[5] || 0), +(d[6] || 0));
            return dt.getTime();
        }

        const m = s.match(/^-?\s*R\$\s*([\d.]+,\d{2})/);
        if (m) {
            const neg = s.startsWith('-') ? -1 : 1;
            return neg * parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
        }

        const n = s.match(/^#?([+-]?\d+(?:[.,]\d+)?)\s*(?:itens?|item|un\.?|dias?|produtos?)?$/i);
        if (n) return parseFloat(n[1].replace(',', '.'));

        return s.toLowerCase();
    }

    function comparar(a, b) {
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
    }

    function assinaturaLinhas(linhas) {
        if (!linhas.length) return '0';
        const primeira = (linhas[0].textContent || '').trim().slice(0, 60);
        const ultima = (linhas[linhas.length - 1].textContent || '').trim().slice(0, 60);
        return linhas.length + '|' + primeira + '|' + ultima;
    }

    function ordenar(cfg, container, st) {
        if (st.sort < 0 || (container.dataset && container.dataset.visao === 'cards')) return;
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
        const tbl = tabelaNativaDe(cfg, container);
        const celulas = tbl && typeof cab.querySelectorAll === 'function'
            ? cab.querySelectorAll('th')
            : (cab.children || []);
        Array.from(celulas).forEach((c, i) => {
            if (tbl && !c.getAttribute('scope')) c.setAttribute('scope', 'col');
            const t = (c.textContent || '').trim().toUpperCase();
            if (!t || t.indexOf('AÇÕES') === 0 || t.indexOf('ACOES') === 0) return;
            c.classList.add('sortable');
            c.dataset.col = String(i);
            c.setAttribute('tabindex', '0');
            if (!tbl) c.setAttribute('role', 'button');
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

    /* -------- Seletor de Colunas Visíveis (persistido por tabela) -------- */
    function lerColunasOcultas(tableId, ths) {
        const salvo = lerStorage(KEY_COLS_PREFIX + tableId, null);
        if (salvo !== null) {
            try {
                const arr = JSON.parse(salvo);
                if (Array.isArray(arr)) return new Set(arr);
            } catch (_) { /* usa padrão */ }
        }
        const ocultas = new Set();
        ths.forEach(th => {
            if (th.dataset && th.dataset.colDefault === 'hidden' && th.dataset.colKey) {
                ocultas.add(th.dataset.colKey);
            }
        });
        return ocultas;
    }

    function salvarColunasOcultas(tableId, setOcultas) {
        salvarStorage(KEY_COLS_PREFIX + tableId, JSON.stringify([...setOcultas]));
    }

    function aplicarVisibilidadeColunas(tableId, tbl) {
        if (!tbl || typeof tbl.querySelectorAll !== 'function') return null;
        const ths = Array.from(tbl.querySelectorAll('thead th'));
        if (!ths.length) return null;
        const comChave = ths.filter(th => th.dataset && th.dataset.colKey);
        if (!comChave.length) return null;

        const ocultas = lerColunasOcultas(tableId, ths);
        const indicesOcultos = new Set();
        ths.forEach((th, idx) => {
            const chave = th.dataset ? th.dataset.colKey : '';
            const travada = th.dataset && th.dataset.colLocked === 'true';
            const ocultar = Boolean(chave && !travada && ocultas.has(chave));
            th.hidden = ocultar;
            if (ocultar) indicesOcultos.add(idx);
        });

        const linhas = Array.from(tbl.querySelectorAll('tbody tr'));
        linhas.forEach(tr => {
            if ((tr.classList && tr.classList.contains('sv-dt-empty-row')) || (tr.dataset && tr.dataset.empty === '1')) {
                const td = tr.querySelector('td');
                if (td) td.setAttribute('colspan', String(Math.max(1, ths.length - indicesOcultos.size)));
                return;
            }
            const tds = tr.children ? Array.from(tr.children) : [];
            tds.forEach((td, idx) => { td.hidden = indicesOcultos.has(idx); });
        });

        return { ths, ocultas, visiveis: ths.length - indicesOcultos.size, total: ths.length };
    }

    function fecharMenusAbertos(exceto) {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
        document.querySelectorAll('.sv-dt-popover.open').forEach(p => {
            if (p !== exceto) {
                p.classList.remove('open');
                const btn = p.previousElementSibling;
                if (btn && btn.setAttribute) btn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function sincronizarMenusDensidade(atual) {
        if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
        document.querySelectorAll('[data-dt-density-opt]').forEach(btn => {
            const ativo = btn.dataset.dtDensityOpt === atual;
            btn.classList.toggle('active', ativo);
            btn.setAttribute('aria-checked', ativo ? 'true' : 'false');
        });
    }

    function construirControlesSubbar(tableId, host, tbl, onReaplicar) {
        if (!host || typeof host.querySelector !== 'function') return;
        let subbar = host.querySelector(':scope > .sv-dt-subbar');
        if (!subbar) return;

        let dir = subbar.querySelector('.sv-dt-subbar-actions');
        if (!dir) {
            dir = document.createElement('div');
            dir.className = 'sv-dt-subbar-actions';
            subbar.appendChild(dir);
        }

        const estadoCols = aplicarVisibilidadeColunas(tableId, tbl);
        const densAtual = getDensidade();

        const btnColsHtml = (estadoCols && estadoCols.ths.some(th => th.dataset && th.dataset.colKey && th.dataset.colLocked !== 'true'))
            ? (() => {
                const itens = estadoCols.ths
                    .filter(th => th.dataset && th.dataset.colKey)
                    .map(th => {
                        const key = th.dataset.colKey;
                        const label = th.dataset.colLabel || (th.textContent || '').trim();
                        const locked = th.dataset.colLocked === 'true';
                        const checked = locked || !estadoCols.ocultas.has(key);
                        return '<label class="sv-dt-pop-item' + (locked ? ' is-locked' : '') + '">'
                            + '<input type="checkbox" data-col-toggle="' + key + '"' + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + '>'
                            + '<span>' + label + '</span>'
                            + '</label>';
                    }).join('');
                return '<div class="sv-dt-menu">'
                    + '<button type="button" class="sv-dt-ctrl-btn" data-dt-menu-trigger="cols" aria-haspopup="true" aria-expanded="false">'
                    + '<i class="bx bx-columns" aria-hidden="true"></i><span>Colunas</span>'
                    + '<span class="sv-dt-ctrl-count">' + estadoCols.visiveis + '/' + estadoCols.total + '</span>'
                    + '</button>'
                    + '<div class="sv-dt-popover" role="menu">'
                    + '<div class="sv-dt-pop-title">Colunas visíveis</div>'
                    + '<div class="sv-dt-pop-list">' + itens + '</div>'
                    + '<button type="button" class="sv-dt-pop-reset" data-col-reset="1">Restaurar padrão</button>'
                    + '</div></div>';
            })()
            : '';

        const densHtml = '<div class="sv-dt-menu">'
            + '<button type="button" class="sv-dt-ctrl-btn" data-dt-menu-trigger="density" aria-haspopup="true" aria-expanded="false" title="Densidade das linhas">'
            + '<i class="bx bx-slider-alt" aria-hidden="true"></i><span>Densidade</span>'
            + '</button>'
            + '<div class="sv-dt-popover sv-dt-popover-sm" role="menu">'
            + '<div class="sv-dt-pop-title">Densidade</div>'
            + DENSIDADES.map(d =>
                '<button type="button" class="sv-dt-pop-opt' + (d.id === densAtual ? ' active' : '') + '" role="menuitemradio" aria-checked="' + (d.id === densAtual ? 'true' : 'false') + '" data-dt-density-opt="' + d.id + '">'
                + '<span>' + d.rotulo + '</span><i class="bx bx-check" aria-hidden="true"></i></button>'
            ).join('')
            + '</div></div>';

        dir.innerHTML = btnColsHtml + densHtml;

        if (dir.dataset.bound !== '1') {
            dir.dataset.bound = '1';
            dir.addEventListener('click', e => {
                const trigger = e.target.closest('[data-dt-menu-trigger]');
                if (trigger) {
                    e.stopPropagation();
                    const pop = trigger.nextElementSibling;
                    if (!pop) return;
                    const abrir = !pop.classList.contains('open');
                    fecharMenusAbertos(abrir ? pop : null);
                    pop.classList.toggle('open', abrir);
                    trigger.setAttribute('aria-expanded', abrir ? 'true' : 'false');
                    return;
                }
                const opt = e.target.closest('[data-dt-density-opt]');
                if (opt) {
                    setDensidade(opt.dataset.dtDensityOpt);
                    fecharMenusAbertos();
                    return;
                }
                const reset = e.target.closest('[data-col-reset]');
                if (reset) {
                    memStorage.delete(KEY_COLS_PREFIX + tableId);
                    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY_COLS_PREFIX + tableId); } catch (_) {}
                    fecharMenusAbertos();
                    if (dir._onReaplicar) dir._onReaplicar();
                    return;
                }
                if (e.target.closest('.sv-dt-popover')) {
                    e.stopPropagation();
                }
            });
            dir.addEventListener('change', e => {
                const chk = e.target.closest('[data-col-toggle]');
                if (!chk) return;
                const tabelaAtual = dir._getTabela ? dir._getTabela() : null;
                if (!tabelaAtual) return;
                const ths = Array.from(tabelaAtual.querySelectorAll('thead th'));
                const ocultas = lerColunasOcultas(tableId, ths);
                const k = chk.dataset.colToggle;
                if (chk.checked) ocultas.delete(k); else ocultas.add(k);
                salvarColunasOcultas(tableId, ocultas);
                aplicarVisibilidadeColunas(tableId, tabelaAtual);
                const vis = ths.filter(t => !t.hidden).length;
                const badge = dir.querySelector('.sv-dt-ctrl-count');
                if (badge) badge.textContent = vis + '/' + ths.length;
            });
        }
        dir._getTabela = () => tbl;
        dir._onReaplicar = onReaplicar;
    }

    /**
     * Renderiza chips de filtros ativos removíveis em qualquer tabela (padrão Setproduct).
     * @param {string} hostId - id do container (.sv-dt-card) que possui .sv-dt-subbar
     * @param {Array<{label:string, valor:string, onRemove:Function}>} chips
     * @param {Function|null} onLimparTudo
     */
    function atualizarChips(hostId, chips, onLimparTudo) {
        if (typeof document === 'undefined') return;
        const host = document.getElementById(hostId);
        if (!host || typeof host.querySelector !== 'function') return;
        const area = host.querySelector('.sv-dt-chips');
        if (!area) return;

        const lista = Array.isArray(chips) ? chips.filter(Boolean) : [];
        if (lista.length === 0) {
            area.innerHTML = '';
            area.classList.add('is-empty');
            return;
        }
        area.classList.remove('is-empty');
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        area.innerHTML = lista.map((c, idx) =>
            '<span class="sv-dt-chip">'
            + '<span class="sv-dt-chip-k">' + esc(c.label) + ':</span> '
            + '<span class="sv-dt-chip-v">' + esc(c.valor) + '</span>'
            + '<button type="button" class="sv-dt-chip-x" data-chip-idx="' + idx + '" aria-label="Remover filtro ' + esc(c.label) + '">'
            + '<i class="bx bx-x" aria-hidden="true"></i></button></span>'
        ).join('') + (typeof onLimparTudo === 'function'
            ? '<button type="button" class="sv-dt-chips-clear" data-chips-clear="1">Limpar filtros</button>'
            : '');

        area._chips = lista;
        area._clearAll = onLimparTudo;
        if (area.dataset.bound !== '1') {
            area.dataset.bound = '1';
            area.addEventListener('click', e => {
                const btnX = e.target.closest('[data-chip-idx]');
                if (btnX) {
                    const item = area._chips && area._chips[Number(btnX.dataset.chipIdx)];
                    if (item && typeof item.onRemove === 'function') item.onRemove();
                    return;
                }
                if (e.target.closest('[data-chips-clear]') && typeof area._clearAll === 'function') {
                    area._clearAll();
                }
            });
        }
    }

    function montarHtmlPaginacao(atual, totalPags) {
        const paginas = gerarPaginas(atual, totalPags);
        const botoesPag = paginas.map(p => {
            if (p === '…') return '<span class="tabela-pager-ellipsis" aria-hidden="true">…</span>';
            const ativo = p === atual;
            return '<button type="button" class="tabela-pager-page' + (ativo ? ' active' : '') + '" data-pag-num="' + p + '"'
                + (ativo ? ' aria-current="page"' : '') + ' aria-label="Página ' + p + '">' + p + '</button>';
        }).join('');
        return '<button type="button" class="tabela-pager-btn" data-pag="-1" title="Página anterior" aria-label="Página anterior"' + (atual === 1 ? ' disabled' : '') + '><i class="bx bx-chevron-left" aria-hidden="true"></i></button>'
            + botoesPag
            + '<button type="button" class="tabela-pager-btn" data-pag="1" title="Próxima página" aria-label="Próxima página"' + (atual === totalPags ? ' disabled' : '') + '><i class="bx bx-chevron-right" aria-hidden="true"></i></button>';
    }

    function paginar(cfg, container, st) {
        const linhas = linhasDe(cfg, container);
        const total = linhas.length;
        const ehCards = container && container.dataset && container.dataset.visao === 'cards';
        const porPagina = getPageSize(cfg, container);
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
                const bNum = e.target.closest('[data-pag-num]');
                if (bNum) {
                    const estado = estadoDe(container);
                    estado.page = Number(bNum.dataset.pagNum);
                    aplicar(cfg, false);
                    anunciar('Página ' + estado.page + ' de ' + pags);
                    return;
                }
                const b = e.target.closest('[data-pag]');
                if (!b || b.disabled) return;
                const estado = estadoDe(container);
                estado.page += Number(b.dataset.pag);
                aplicar(cfg, false);
                anunciar('Página ' + estado.page + ' de ' + pags);
            });
            pg.addEventListener('change', e => {
                const sel = e.target.closest('[data-dt-pagesize]');
                if (sel) setPageSize(sel.value);
            });
            host.appendChild(pg);
        }

        const seletorTam = !ehCards
            ? '<label class="tabela-pager-size"><span>Por página</span>'
              + '<select data-dt-pagesize aria-label="Linhas por página">'
              + PAGE_SIZES.map(n => '<option value="' + n + '"' + (n === porPagina ? ' selected' : '') + '>' + n + '</option>').join('')
              + '</select></label>'
            : '';

        pg.innerHTML =
            '<div class="tabela-pager-esq">'
            + '<span class="tabela-pager-info">Mostrando <strong>' + (ini + 1) + '–' + Math.min(fim, total) + '</strong> de <strong>' + total + '</strong></span>'
            + seletorTam
            + '</div>'
            + '<nav class="tabela-pager-controles" aria-label="Paginação">'
            + montarHtmlPaginacao(st.page, pags)
            + '<span class="sr-only tabela-pager-num">' + st.page + ' / ' + pags + '</span>'
            + '</nav>';
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
        const cab = cabecalhoDe(cfg, container);
        if (cab) {
            const ativo = cab.querySelector('.sortable[data-col="' + col + '"]');
            const nome = ativo ? (ativo.textContent || '').trim() : 'coluna';
            const dirTxt = st.sort < 0 ? 'ordem padrão' : (st.dir === 1 ? 'crescente' : 'decrescente');
            anunciar('Ordenado por ' + nome + ', ' + dirTxt);
        }
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
            if (veioDeMutacao && st.assinatura !== null && sig !== st.assinatura) {
                st.page = 1;
            }
            garantirCliqueNoCabecalho(cfg, container);
            prepararCabecalho(cfg, container, st);
            ordenar(cfg, container, st);
            const tbl = tabelaNativaDe(cfg, container);
            const host = hostDe(cfg, container);
            if (tbl && host) {
                construirControlesSubbar(cfg.id, host, tbl, () => aplicar(cfg, false));
            }
            st.assinatura = assinaturaLinhas(linhasDe(cfg, container));
            paginar(cfg, container, st);
        } finally {
            if (info) info.obs.observe(container, info.opcoes);
        }
    }

    function reajustarTodas(resetarPagina) {
        if (typeof document === 'undefined') return;
        TABELAS.forEach(cfg => {
            const container = document.getElementById(cfg.container);
            if (container && resetarPagina) estadoDe(container).page = 1;
            aplicar(cfg, false);
        });
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

    /** Inicializa controles de densidade + colunas em tabelas gerenciadas fora do MutationObserver (ex.: Movimentações). */
    function sincronizarTabelaManual(tableId, hostId, tabelaSelector) {
        if (typeof document === 'undefined') return;
        const host = document.getElementById(hostId);
        if (!host || typeof host.querySelector !== 'function') return;
        const tbl = host.querySelector(tabelaSelector || 'table.sv-dt');
        if (!tbl) return;
        construirControlesSubbar(tableId, host, tbl, () => sincronizarTabelaManual(tableId, hostId, tabelaSelector));
    }

    function iniciar() {
        if (typeof document === 'undefined') return;
        if (document.documentElement) {
            document.documentElement.dataset.dtDensity = getDensidade();
        }
        document.addEventListener('click', () => fecharMenusAbertos());
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') fecharMenusAbertos();
        });
        TABELAS.forEach(cfg => {
            const container = document.getElementById(cfg.container);
            if (!container) return;
            const opcoes = (cfg.tabela || !ehTbody(container)) ? { childList: true, subtree: true } : { childList: true };
            const obs = new MutationObserver(() => aplicar(cfg, true));
            observadores.set(cfg.container, { obs: obs, opcoes: opcoes });
            obs.observe(container, opcoes);
            aplicar(cfg, false);
        });
    }

    const API = {
        chaveDe,
        comparar,
        gerarPaginas,
        montarHtmlPaginacao,
        resetarOrdenacao,
        reajustarTodas,
        getDensidade,
        setDensidade,
        getPageSize,
        setPageSize,
        atualizarChips,
        sincronizarTabelaManual,
        anunciar,
        PAGE_SIZE,
        PAGE_SIZES
    };
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
