/*
 * Histórico de movimentações de estoque (lógica pura, sem DOM).
 *
 * Lista todas as movimentações (mais recentes primeiro), com o saldo após cada uma,
 * aplica filtros (período, produto, tipo e texto), calcula totais e monta a seção
 * de exportação (xlsx e PDF, pelo módulo Relatorios).
 *
 * Saldo após cada movimentação vem de Estoque.historico (passado como função),
 * então a tela e o histórico do produto mostram sempre o mesmo número.
 *
 * Carregado no navegador (window.HistoricoMov) e no Node (module.exports), para os testes.
 */
(function (raiz) {
    'use strict';

    const ROTULOS = Object.freeze({
        saldo_inicial: 'Saldo inicial',
        entrada: 'Entrada',
        venda: 'Venda',
        estorno: 'Estorno',
        ajuste: 'Ajuste',
        ajuste_custo: 'Ajuste de custo',
        exclusao_entrada: 'Exclusão de entrada'
    });

    /** Todos os tipos, na ordem em que aparecem nos filtros. */
    const TIPOS = Object.freeze(['entrada', 'venda', 'estorno', 'ajuste', 'ajuste_custo', 'exclusao_entrada', 'saldo_inicial']);

    function numero(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    /** Dia local YYYY-MM-DD, ou null se a data é inválida. */
    function diaLocal(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    /** Data e hora locais no formato dd/mm/aaaa hh:mm. */
    function dataHoraBr(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    /** Texto de origem: a venda ou a entrada que gerou a movimentação. */
    function origemTexto(m) {
        if (!m.refId) return '—';
        switch (m.tipo) {
            case 'venda': return 'Venda ' + m.refId;
            case 'estorno': return 'Estorno da venda ' + m.refId;
            case 'entrada':
            case 'exclusao_entrada': return 'Entrada ' + m.refId;
            default: return String(m.refId);
        }
    }

    /**
     * Uma linha por movimentação, mais recente primeiro (empate: a registrada por último).
     * historicoFn = Estoque.historico(movimentacoes, produtoId) → [{ mov, saldoApos }].
     */
    function linhas(movimentacoes, produtos, historicoFn) {
        const todas = movimentacoes || [];
        const nomes = new Map((produtos || []).map((p) => [String(p.id), p.name || String(p.id)]));

        // Saldo após cada movimentação: uma passagem por produto, guardando por referência do objeto.
        const saldos = new Map();
        const ids = [...new Set(todas.map((m) => String(m.produtoId)))];
        ids.forEach((id) => {
            historicoFn(todas, id).forEach((h) => saldos.set(h.mov, h.saldoApos));
        });

        return todas
            .map((m, ordem) => ({
                ordem: ordem,
                id: m.id,
                data: m.date || null,
                dataMs: Date.parse(m.date) || 0,
                dia: m.date ? diaLocal(m.date) : null,
                produtoId: String(m.produtoId),
                produto: nomes.get(String(m.produtoId)) || String(m.produtoId),
                tipo: m.tipo,
                rotulo: ROTULOS[m.tipo] || m.tipo,
                qtd: numero(m.qtd),
                custoUnit: m.custoUnit == null ? null : numero(m.custoUnit),
                saldoApos: saldos.has(m) ? saldos.get(m) : null,
                origem: origemTexto(m),
                obs: m.obs || '',
                ignorada: m.ignorada === true
            }))
            .sort((a, b) => (b.dataMs - a.dataMs) || (b.ordem - a.ordem));
    }

    /**
     * Filtros (todos opcionais):
     * - inicio / fim: YYYY-MM-DD, dia local, inclusivo. Vazio = sem limite.
     * - produtoId: só esse produto.
     * - tipos: lista de tipos. Vazio ou ausente = todos.
     * - busca: texto procurado em observação, origem e nome do produto.
     */
    function filtrar(lista, filtro) {
        const f = filtro || {};
        const busca = String(f.busca || '').trim().toLowerCase();
        const tipos = Array.isArray(f.tipos) && f.tipos.length ? new Set(f.tipos) : null;
        const produto = f.produtoId ? String(f.produtoId) : '';
        return lista.filter((l) => {
            if (f.inicio && (!l.dia || l.dia < f.inicio)) return false;
            if (f.fim && (!l.dia || l.dia > f.fim)) return false;
            if (produto && l.produtoId !== produto) return false;
            if (tipos && !tipos.has(l.tipo)) return false;
            if (busca && !(`${l.obs} ${l.origem} ${l.produto}`).toLowerCase().includes(busca)) return false;
            return true;
        });
    }

    /**
     * Totais da lista filtrada, em unidades.
     * entradas: soma das entradas. saídas: vendas menos estornos (venda tem qtd negativa).
     * exclusões: quantidade tirada por exclusão de entrada. ajustes: soma com sinal.
     * Movimentações ignoradas não entram nos totais; são contadas à parte.
     */
    function totais(lista) {
        const t = { movimentos: lista.length, entradas: 0, saidas: 0, exclusoes: 0, ajustes: 0, ignoradas: 0 };
        lista.forEach((l) => {
            if (l.ignorada) { t.ignoradas++; return; }
            switch (l.tipo) {
                case 'entrada': t.entradas += l.qtd; break;
                case 'venda': t.saidas += -l.qtd; break;
                case 'estorno': t.saidas -= l.qtd; break;
                case 'exclusao_entrada': t.exclusoes += l.qtd; break;
                case 'ajuste': t.ajustes += l.qtd; break;
                default: break;
            }
        });
        return t;
    }

    /** Primeiras `limite` linhas (botão "Mostrar mais" aumenta o limite). */
    function paginar(lista, limite) {
        return lista.slice(0, Math.max(0, Number(limite) || 0));
    }

    /** Seção para exportação (mesmo formato dos relatórios: colunas, linhas, totais). */
    function secao(lista) {
        return {
            id: 'movimentacoes',
            titulo: 'Movimentações de estoque',
            colunas: [
                { titulo: 'Data e hora', tipo: 'texto', largura: 2.8 },
                { titulo: 'Produto', tipo: 'texto', largura: 2.4 },
                { titulo: 'Tipo', tipo: 'texto', largura: 2.2 },
                { titulo: 'Qtd', tipo: 'inteiro', largura: 1.1, alinhar: 'direita' },
                { titulo: 'Custo unit.', tipo: 'moeda', largura: 1.8, alinhar: 'direita' },
                { titulo: 'Saldo após', tipo: 'inteiro', largura: 1.8, alinhar: 'direita' },
                { titulo: 'Origem', tipo: 'texto', largura: 2.5 },
                { titulo: 'Observação', tipo: 'texto', largura: 2.9 }
            ],
            linhas: lista.map((l) => [
                dataHoraBr(l.data),
                l.produto,
                l.rotulo + (l.ignorada ? ' (ignorada)' : ''),
                l.qtd,
                l.custoUnit == null ? '—' : l.custoUnit,
                l.saldoApos == null ? '—' : l.saldoApos,
                l.origem,
                l.obs
            ])
        };
    }

    const API = { ROTULOS, TIPOS, diaLocal, dataHoraBr, linhas, filtrar, totais, paginar, secao };

    raiz.HistoricoMov = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
