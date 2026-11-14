/*
 * Resumo de vendas por forma de pagamento (lógica pura, sem DOM).
 * Substitui o controle de caixa (abertura, sangria, suprimento e fechamento) na v1.
 *
 * Carregado no navegador (window.Resumo) e no Node (module.exports), para os testes.
 */
(function (raiz) {
    'use strict';

    const FORMAS = Object.freeze([
        { id: 'dinheiro', rotulo: 'Dinheiro' },
        { id: 'cartao', rotulo: 'Cartão' },
        { id: 'pix', rotulo: 'Pix' },
        { id: 'outros', rotulo: 'Outros' }
    ]);

    function semAcento(texto) {
        return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    /** Converte o texto gravado na venda (ex.: "Cartão", "cartao", "PIX") para uma forma conhecida. */
    function formaDePagamento(texto) {
        const t = semAcento(texto).trim().toLowerCase();
        if (t === 'dinheiro') return 'dinheiro';
        if (t.startsWith('cartao')) return 'cartao';
        if (t === 'pix') return 'pix';
        return 'outros';
    }

    /** Período de datas no formato AAAA-MM-DD (inclusive) em horário local. */
    function periodo(deStr, ateStr) {
        const [ay, am, ad] = String(deStr).split('-').map(Number);
        const [by, bm, bd] = String(ateStr).split('-').map(Number);
        return {
            inicio: new Date(ay, am - 1, ad, 0, 0, 0, 0),
            fim: new Date(by, bm - 1, bd, 23, 59, 59, 999)
        };
    }

    function arredondar(valor) {
        return Math.round((valor + Number.EPSILON) * 100) / 100;
    }

    /** Totais por forma de pagamento para as vendas dentro do período. */
    function resumoPorPagamento(vendas, inicio, fim) {
        const linhas = FORMAS.map(f => ({ forma: f.id, rotulo: f.rotulo, quantidade: 0, total: 0 }));

        for (const venda of vendas || []) {
            const data = new Date(venda.date);
            if (isNaN(data) || data < inicio || data > fim) continue;

            const forma = formaDePagamento(venda.pagamento);
            const linha = linhas.find(l => l.forma === forma);
            linha.quantidade += 1;
            linha.total = arredondar(linha.total + (Number(venda.valor_final) || 0));
        }

        return {
            linhas: linhas,
            quantidade: linhas.reduce((s, l) => s + l.quantidade, 0),
            total: arredondar(linhas.reduce((s, l) => s + l.total, 0))
        };
    }

    const api = { FORMAS: FORMAS, formaDePagamento: formaDePagamento, periodo: periodo, resumoPorPagamento: resumoPorPagamento };

    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.Resumo = api;
})(typeof window !== 'undefined' ? window : globalThis);
