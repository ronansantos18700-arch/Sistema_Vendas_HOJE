/*
 * Fiado (venda a prazo): lógica pura, sem DOM.
 *
 * Regras:
 * - Venda fiado tem pagamento = 'fiado' e exige cliente cadastrado (não é Consumidor Final).
 * - Receita e lucro ficam na data da venda, como qualquer venda.
 * - O recebimento é guardado na própria venda, em `recebimentos` [{ id, date, valor, forma }].
 * - Saldo em aberto = valor_final - soma dos recebimentos (nunca negativo).
 * - Um recebimento do cliente é distribuído nas vendas em aberto, da mais antiga para a mais recente.
 *
 * Carregado no navegador (window.Fiado) e no Node (module.exports), para os testes.
 */
(function (raiz) {
    'use strict';

    const CONSUMIDOR_FINAL = 'Consumidor Final';
    const FORMAS_RECEBIMENTO = Object.freeze(['dinheiro', 'cartao', 'pix']);
    const NOMES_FORMA = Object.freeze({ dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX' });
    const TOLERANCIA = 0.005;

    const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

    function ehFiado(venda) {
        return !!venda && venda.pagamento === 'fiado';
    }

    function recebimentos(venda) {
        return venda && Array.isArray(venda.recebimentos) ? venda.recebimentos : [];
    }

    function recebido(venda) {
        return r2(recebimentos(venda).reduce((acc, r) => acc + (Number(r.valor) || 0), 0));
    }

    function saldoAberto(venda) {
        if (!ehFiado(venda)) return 0;
        return Math.max(0, r2((Number(venda.valor_final) || 0) - recebido(venda)));
    }

    /** Vendas a prazo do cliente com saldo, da mais antiga para a mais recente. */
    function emAberto(vendas, cliente) {
        return (vendas || [])
            .filter((v) => ehFiado(v) && v.cliente === cliente && saldoAberto(v) > 0)
            .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
    }

    function saldoCliente(vendas, cliente) {
        return r2(emAberto(vendas, cliente).reduce((acc, v) => acc + saldoAberto(v), 0));
    }

    /** Mapa nome do cliente → saldo em aberto (só clientes com saldo). */
    function saldosPorCliente(vendas) {
        const mapa = new Map();
        (vendas || []).forEach((v) => {
            const s = saldoAberto(v);
            if (s <= 0) return;
            mapa.set(v.cliente, r2((mapa.get(v.cliente) || 0) + s));
        });
        return mapa;
    }

    /** Venda a prazo só vale com cliente cadastrado. */
    function validarVendaFiado(cliente) {
        if (!cliente || cliente === CONSUMIDOR_FINAL) {
            return { ok: false, motivo: 'Venda fiado exige um cliente cadastrado. Selecione o cliente no PDV.' };
        }
        return { ok: true };
    }

    /**
     * Calcula como um recebimento se divide entre as vendas em aberto (mais antiga primeiro).
     * Não altera nada; devolve { ok, motivo, aplicacoes: [{ vendaId, valor }] }.
     */
    function distribuir(vendas, cliente, valor, forma) {
        if (!FORMAS_RECEBIMENTO.includes(forma)) return { ok: false, motivo: 'Forma de recebimento inválida.' };
        const v = r2(valor);
        if (!(v > 0)) return { ok: false, motivo: 'Informe um valor maior que zero.' };
        const saldo = saldoCliente(vendas, cliente);
        if (saldo <= 0) return { ok: false, motivo: 'Este cliente não tem saldo em aberto.' };
        if (v - saldo > TOLERANCIA) {
            return { ok: false, motivo: `O valor passa do saldo em aberto (${saldo.toFixed(2)}).` };
        }

        let restante = Math.min(v, saldo);
        const aplicacoes = [];
        for (const venda of emAberto(vendas, cliente)) {
            if (restante <= 0) break;
            const pago = r2(Math.min(restante, saldoAberto(venda)));
            if (pago > 0) aplicacoes.push({ vendaId: venda.id || venda.ID, valor: pago });
            restante = r2(restante - pago);
        }
        return { ok: true, aplicacoes };
    }

    /**
     * Registra o recebimento nas vendas (muda os objetos recebidos).
     * `idBase` e `dataIso` vêm de fora para o módulo continuar puro e testável.
     */
    function registrarRecebimento(vendas, cliente, valor, forma, dataIso, idBase) {
        const plano = distribuir(vendas, cliente, valor, forma);
        if (!plano.ok) return plano;
        plano.aplicacoes.forEach((ap, i) => {
            const venda = (vendas || []).find((x) => (x.id || x.ID) === ap.vendaId);
            if (!venda) return;
            if (!Array.isArray(venda.recebimentos)) venda.recebimentos = [];
            venda.recebimentos.push({ id: idBase + '-' + (i + 1), date: dataIso, valor: ap.valor, forma: forma });
        });
        return plano;
    }

    /**
     * Regras da edição de uma venda fiado:
     * - venda com recebimentos continua fiado;
     * - o novo total não pode ficar abaixo do que já foi recebido;
     * - trocar para fiado exige cliente cadastrado (cliente = nome atual da venda).
     */
    function validarEdicao(venda, novoTotal, escolha, cliente) {
        const jaRecebido = recebido(venda);
        if (jaRecebido > 0 && escolha !== 'fiado') {
            return { ok: false, motivo: `Esta venda já tem recebimentos (${jaRecebido.toFixed(2)}). Ela continua fiado.` };
        }
        if (escolha === 'fiado') {
            const validacao = validarVendaFiado(cliente);
            if (!validacao.ok) return validacao;
            if (r2(novoTotal) < jaRecebido) {
                return { ok: false, motivo: `O novo total fica abaixo do já recebido (${jaRecebido.toFixed(2)}).` };
            }
        }
        return { ok: true };
    }

    const API = {
        CONSUMIDOR_FINAL, FORMAS_RECEBIMENTO, NOMES_FORMA,
        ehFiado, recebimentos, recebido, saldoAberto, emAberto, saldoCliente, saldosPorCliente,
        validarVendaFiado, distribuir, registrarRecebimento, validarEdicao
    };

    raiz.Fiado = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
