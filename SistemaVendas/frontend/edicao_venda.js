/*
 * Edição de venda já registrada (lógica pura, sem DOM).
 *
 * Escopo: altera as quantidades dos itens (zerar um item = remover), o desconto em R$,
 * o cliente e a forma de pagamento. Data e número da venda não mudam.
 *
 * Estoque: a diferença de quantidade vira movimentação, sem apagar o histórico.
 * - mais unidades vendidas: movimentação de venda (reduz o estoque), com o custo do item na venda;
 * - menos unidades: movimentação de estorno (devolve ao estoque).
 * Se faltar estoque para aumentar a venda, a edição é recusada (nada é alterado).
 *
 * Carregado no navegador (window.EdicaoVenda) e no Node (module.exports), para os testes.
 */
(function (raiz) {
    'use strict';

    const Estoque = (typeof module === 'object' && module.exports)
        ? require('./estoque.js')
        : raiz.Estoque;

    const FORMAS = Object.freeze(['dinheiro', 'cartao', 'pix']);

    function arredondar(valor) {
        return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
    }

    function quantidadeValida(valor) {
        const n = Number(valor);
        if (!Number.isInteger(n) || n < 0) throw new Error('Quantidade inválida: use um número inteiro igual ou maior que zero.');
        return n;
    }

    /**
     * Confere quais itens mudam e se o estoque comporta a mudança.
     * qtdsNovas: array com a nova quantidade de cada item, na mesma ordem de venda.items.
     * Devolve { ok, problemas: [{ produtoId, nome, falta }], novas: [movimentações] }.
     */
    function planejarEdicao(movimentacoes, venda, qtdsNovas) {
        const itens = venda.items || [];
        if (!Array.isArray(qtdsNovas) || qtdsNovas.length !== itens.length) {
            throw new Error('Quantidades não correspondem aos itens da venda.');
        }

        const novas = [];
        const aumento = new Map(); // produtoId -> unidades a mais vendidas
        const nomes = new Map();

        itens.forEach((item, i) => {
            const antiga = Number(item.qty) || 0;
            const nova = quantidadeValida(qtdsNovas[i]);
            const delta = nova - antiga;
            if (delta === 0) return;

            const pid = String(item.id);
            nomes.set(pid, item.name || pid);

            if (delta > 0) {
                aumento.set(pid, (aumento.get(pid) || 0) + delta);
                novas.push(Estoque.criarMovimentacao({
                    produtoId: pid,
                    tipo: Estoque.TIPOS.VENDA,
                    qtd: -delta,
                    custoUnit: item.cost == null ? null : Number(item.cost) || 0,
                    refId: venda.id,
                    obs: 'Edição de venda'
                }));
            } else {
                novas.push(Estoque.criarMovimentacao({
                    produtoId: pid,
                    tipo: Estoque.TIPOS.ESTORNO,
                    qtd: -delta,
                    refId: venda.id,
                    obs: 'Edição de venda'
                }));
            }
        });

        const problemas = [];
        for (const [pid, unidades] of aumento) {
            const disponivel = Estoque.calcular(movimentacoes, pid).stock;
            if (disponivel < unidades) {
                problemas.push({ produtoId: pid, nome: nomes.get(pid), falta: unidades - disponivel });
            }
        }

        return { ok: problemas.length === 0, problemas: problemas, novas: problemas.length ? [] : novas };
    }

    /**
     * Recalcula os totais da venda com as novas quantidades e o desconto em R$.
     * Itens com quantidade zero saem da venda. O desconto nunca passa do subtotal.
     */
    function recalcularVenda(venda, qtdsNovas, desconto) {
        const itens = venda.items || [];
        if (!Array.isArray(qtdsNovas) || qtdsNovas.length !== itens.length) {
            throw new Error('Quantidades não correspondem aos itens da venda.');
        }
        const descontoNum = Number(desconto);
        if (!Number.isFinite(descontoNum) || descontoNum < 0) throw new Error('Desconto inválido.');

        const mantidos = [];
        itens.forEach((item, i) => {
            const qty = quantidadeValida(qtdsNovas[i]);
            if (qty > 0) mantidos.push({ ...item, qty: qty });
        });
        if (mantidos.length === 0) throw new Error('A venda precisa ter pelo menos um item. Para cancelar tudo, use Excluir venda.');

        const subtotal = arredondar(mantidos.reduce((acc, it) => acc + it.price * it.qty, 0));
        const custo = arredondar(mantidos.reduce((acc, it) => acc + (Number(it.cost) || 0) * it.qty, 0));
        const desc = arredondar(Math.min(descontoNum, subtotal));
        const final = arredondar(Math.max(0, subtotal - desc));

        return {
            items: mantidos,
            valor_total: subtotal,
            desconto: desc,
            valor_final: final,
            cost: custo,
            lucro: arredondar(final - custo)
        };
    }

    /**
     * Forma de pagamento depois da edição.
     * escolha: 'manter' (só para venda paga em mais de uma forma) ou uma forma única.
     * Venda mista só pode ser mantida se a soma dos pagamentos bater com o novo total.
     */
    function pagamentoAposEdicao(venda, novoTotal, escolha) {
        const total = arredondar(novoTotal);

        if (escolha === 'manter') {
            if (Array.isArray(venda.pagamentos) && venda.pagamentos.length) {
                const soma = arredondar(venda.pagamentos.reduce((acc, p) => acc + (Number(p.valor) || 0), 0));
                if (Math.abs(soma - total) >= 0.005) {
                    throw new Error('O total mudou e os pagamentos divididos não batem mais. Escolha uma forma de pagamento única.');
                }
                return { pagamento: 'misto', pagamentos: venda.pagamentos, troco: venda.troco };
            }
            return { pagamento: venda.pagamento || 'N/A' };
        }

        if (!FORMAS.includes(escolha)) throw new Error('Forma de pagamento inválida.');
        return { pagamento: escolha };
    }

    const api = {
        planejarEdicao: planejarEdicao,
        recalcularVenda: recalcularVenda,
        pagamentoAposEdicao: pagamentoAposEdicao,
        FORMAS: FORMAS
    };

    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.EdicaoVenda = api;
})(typeof window !== 'undefined' ? window : globalThis);
