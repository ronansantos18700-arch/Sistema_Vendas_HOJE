/*
 * Estoque e custo médio ponderado (lógica pura, sem DOM).
 *
 * Toda mudança de quantidade ou de custo vira uma movimentação gravada em `movimentacoes`.
 * Saldo e custo de um produto são sempre recalculados a partir das movimentações ativas
 * (as não ignoradas), na ordem em que foram registradas.
 *
 * Regras:
 * - entrada: recalcula o custo médio ponderado (saldo * custo + qtd * custoUnit) / (saldo + qtd)
 * - venda, estorno, ajuste e exclusão de entrada: mudam a quantidade, o custo médio não muda
 * - ajuste_custo: troca o custo médio manualmente
 * - saldo estoque nunca fica negativo (mesmo comportamento anterior do sistema)
 *
 * Carregado no navegador (window.Estoque) e no Node (module.exports), para os testes.
 */
(function (raiz) {
    'use strict';

    const TIPOS = Object.freeze({
        SALDO_INICIAL: 'saldo_inicial',       // base de um produto (cadastro ou migração)
        ENTRADA: 'entrada',                   // compra: soma quantidade e recalcula o custo médio
        VENDA: 'venda',                       // saída pelo PDV
        ESTORNO: 'estorno',                   // devolução ao estoque por exclusão de venda
        AJUSTE: 'ajuste',                     // ajuste manual de quantidade
        AJUSTE_CUSTO: 'ajuste_custo',         // troca manual do custo médio
        EXCLUSAO_ENTRADA: 'exclusao_entrada'  // registro da exclusão de uma entrada
    });

    const CASAS_CUSTO = 4;

    function arredondarCusto(valor) {
        const fator = Math.pow(10, CASAS_CUSTO);
        return Math.round((valor + Number.EPSILON) * fator) / fator;
    }

    function gerarId() {
        return 'M' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function paraInteiro(valor) {
        const n = Math.trunc(Number(valor));
        return Number.isFinite(n) ? n : 0;
    }

    /** Valida e monta uma movimentação. Lança Error se os dados forem inconsistentes. */
    function criarMovimentacao(dados) {
        if (!dados || !dados.produtoId) throw new Error('Movimentação sem produto.');
        const tipo = dados.tipo;
        if (!Object.values(TIPOS).includes(tipo)) throw new Error('Tipo de movimentação inválido: ' + tipo);

        const qtd = Number(dados.qtd);
        if (!Number.isInteger(qtd)) throw new Error('Quantidade inválida.');

        const custoUnit = dados.custoUnit == null ? null : Number(dados.custoUnit);
        if (custoUnit !== null && (!Number.isFinite(custoUnit) || custoUnit < 0)) {
            throw new Error('Custo unitário inválido.');
        }

        switch (tipo) {
            case TIPOS.ENTRADA:
                if (qtd <= 0 || custoUnit === null) throw new Error('Entrada exige quantidade positiva e custo.');
                break;
            case TIPOS.SALDO_INICIAL:
                if (qtd < 0 || custoUnit === null) throw new Error('Saldo inicial exige quantidade e custo.');
                break;
            case TIPOS.VENDA:
                if (qtd >= 0) throw new Error('Venda deve reduzir o estoque.');
                break;
            case TIPOS.ESTORNO:
                if (qtd <= 0) throw new Error('Estorno deve aumentar o estoque.');
                break;
            case TIPOS.AJUSTE:
                if (qtd === 0) throw new Error('Ajuste sem quantidade.');
                break;
            case TIPOS.AJUSTE_CUSTO:
                if (qtd !== 0 || custoUnit === null) throw new Error('Ajuste de custo exige só o novo custo.');
                break;
            case TIPOS.EXCLUSAO_ENTRADA:
                if (qtd === 0) throw new Error('Exclusão de entrada sem quantidade.');
                break;
        }

        return {
            id: dados.id || gerarId(),
            date: dados.date || new Date().toISOString(),
            produtoId: String(dados.produtoId),
            tipo: tipo,
            qtd: qtd,
            custoUnit: custoUnit,
            refId: dados.refId != null && dados.refId !== '' ? String(dados.refId) : null,
            obs: dados.obs || '',
            ignorada: dados.ignorada === true
        };
    }

    /** Aplica uma movimentação sobre o estado { saldo, custo } e devolve o novo estado. */
    function aplicar(estado, mov) {
        if (mov.ignorada) return estado;
        const saldo = Math.max(0, estado.saldo);

        switch (mov.tipo) {
            case TIPOS.SALDO_INICIAL:
                return { saldo: Math.max(0, mov.qtd), custo: arredondarCusto(mov.custoUnit) };

            case TIPOS.AJUSTE_CUSTO:
                return { saldo: saldo, custo: arredondarCusto(mov.custoUnit) };

            case TIPOS.ENTRADA: {
                const novoSaldo = saldo + mov.qtd;
                const custo = novoSaldo > 0
                    ? (saldo * estado.custo + mov.qtd * mov.custoUnit) / novoSaldo
                    : mov.custoUnit;
                return { saldo: novoSaldo, custo: arredondarCusto(custo) };
            }

            default:
                // venda, estorno, ajuste e exclusão: mudam a quantidade, não o custo médio
                return { saldo: Math.max(0, saldo + mov.qtd), custo: estado.custo };
        }
    }

    /** Saldo e custo médio de um produto a partir das movimentações ativas. */
    function calcular(movimentacoes, produtoId) {
        const id = String(produtoId);
        let estado = { saldo: 0, custo: 0 };
        for (const mov of movimentacoes) {
            if (mov.produtoId === id) estado = aplicar(estado, mov);
        }
        return { stock: estado.saldo, cost: estado.custo };
    }

    /** Atualiza stock e cost do produto com base nas movimentações. Produto sem histórico não é alterado. */
    function sincronizar(produto, movimentacoes) {
        const id = String(produto.id);
        if (!movimentacoes.some(m => m.produtoId === id)) return produto;
        const resultado = calcular(movimentacoes, id);
        produto.stock = resultado.stock;
        produto.cost = resultado.cost;
        return produto;
    }

    /**
     * Para produtos sem nenhuma movimentação (dados anteriores a este histórico),
     * cria o saldo inicial a partir do estoque e custo atuais. Devolve só as novas movimentações.
     */
    function garantirSaldoInicial(produtos, movimentacoes) {
        const comHistorico = new Set(movimentacoes.map(m => m.produtoId));
        return produtos
            .filter(p => p && p.id != null && !comHistorico.has(String(p.id)))
            .map(p => criarMovimentacao({
                produtoId: p.id,
                tipo: TIPOS.SALDO_INICIAL,
                qtd: Math.max(0, paraInteiro(p.stock)),
                custoUnit: Math.max(0, Number(p.cost) || 0),
                obs: 'Saldo inicial'
            }));
    }

    /** Movimentações de uma entrada (uma por item). */
    function movimentosDaEntrada(entrada) {
        return (entrada.items || []).map(item => criarMovimentacao({
            produtoId: item.productId,
            tipo: TIPOS.ENTRADA,
            qtd: paraInteiro(item.qty),
            custoUnit: Number(item.unitCost) || 0,
            refId: entrada.id,
            obs: entrada.nota ? 'NF ' + entrada.nota : ''
        }));
    }

    /** Movimentações de uma venda (saída de cada item, com o custo do momento da venda). */
    function movimentosDaVenda(venda) {
        return (venda.items || []).map(item => criarMovimentacao({
            produtoId: item.id,
            tipo: TIPOS.VENDA,
            qtd: -paraInteiro(item.qty),
            custoUnit: item.cost == null ? null : Number(item.cost) || 0,
            refId: venda.id
        }));
    }

    /** Devolução ao estoque quando uma venda é excluída. */
    function movimentosDoEstorno(venda) {
        return (venda.items || []).map(item => criarMovimentacao({
            produtoId: item.id,
            tipo: TIPOS.ESTORNO,
            qtd: paraInteiro(item.qty),
            refId: venda.id,
            obs: 'Estorno de venda'
        }));
    }

    /**
     * Planeja a exclusão de uma entrada.
     * - Entrada com movimentações: essas movimentações são marcadas como ignoradas (saldo e custo
     *   voltam ao que seriam sem a entrada) e é gravado um registro de auditoria ignorado.
     * - Entrada anterior ao histórico: só reverte a quantidade; o custo não é recalculado.
     * Devolve { ignorar: [ids], novas: [movimentações] }.
     */
    function planejarExclusaoEntrada(movimentacoes, entrada) {
        const refId = String(entrada.id);
        const ligadas = movimentacoes.filter(m =>
            m.tipo === TIPOS.ENTRADA && !m.ignorada && m.refId === refId);

        if (ligadas.length > 0) {
            return {
                ignorar: ligadas.map(m => m.id),
                novas: ligadas.map(m => criarMovimentacao({
                    produtoId: m.produtoId,
                    tipo: TIPOS.EXCLUSAO_ENTRADA,
                    qtd: -m.qtd,
                    refId: refId,
                    obs: 'Entrada excluída',
                    ignorada: true
                }))
            };
        }

        return {
            ignorar: [],
            novas: (entrada.items || [])
                .filter(item => item.productId && paraInteiro(item.qty) > 0)
                .map(item => criarMovimentacao({
                    produtoId: item.productId,
                    tipo: TIPOS.EXCLUSAO_ENTRADA,
                    qtd: -paraInteiro(item.qty),
                    refId: refId,
                    obs: 'Entrada excluída (anterior ao histórico)'
                }))
        };
    }

    /** Menor saldo acumulado (sem limite de zero) ao aplicar a sequência; nunca maior que 0. */
    function menorSaldoBruto(lista) {
        let bruto = 0;
        let menor = 0;
        for (const mov of lista) {
            if (mov.ignorada) continue;
            if (mov.tipo === TIPOS.SALDO_INICIAL) bruto = mov.qtd;
            else bruto += mov.qtd;
            if (bruto < menor) menor = bruto;
        }
        return menor;
    }

    /**
     * Verifica se a exclusão de uma entrada pode ser feita sem deixar saldo negativo,
     * ou seja, sem que vendas posteriores fiquem sem estoque para sair.
     * Só bloqueia o que a exclusão causa: falta que já existia antes não conta.
     * Devolve { ok, problemas: [{ produtoId, falta }] }, falta = unidades que não poderiam ser revertidas.
     */
    function verificarExclusaoEntrada(movimentacoes, entrada) {
        const plano = planejarExclusaoEntrada(movimentacoes, entrada);
        const ignorar = new Set(plano.ignorar);
        const produtos = [...new Set(plano.novas.map(m => m.produtoId))];
        const problemas = [];

        for (const pid of produtos) {
            const antes = movimentacoes.filter(m => m.produtoId === pid);
            const depois = [
                ...antes.filter(m => !ignorar.has(m.id)),
                ...plano.novas.filter(m => m.produtoId === pid)
            ];
            const menorAntes = menorSaldoBruto(antes);
            const menorDepois = menorSaldoBruto(depois);
            if (menorDepois < menorAntes) {
                problemas.push({ produtoId: pid, falta: menorAntes - menorDepois });
            }
        }

        return { ok: problemas.length === 0, problemas: problemas };
    }

    const ROTULOS = Object.freeze({
        saldo_inicial: 'Saldo inicial',
        entrada: 'Entrada',
        venda: 'Venda',
        estorno: 'Estorno',
        ajuste: 'Ajuste',
        ajuste_custo: 'Ajuste de custo',
        exclusao_entrada: 'Exclusão de entrada'
    });

    function rotulo(tipo) {
        return ROTULOS[tipo] || tipo;
    }

    /**
     * Movimentações de um produto, na ordem em que foram registradas, com o saldo após cada uma.
     * Movimentações ignoradas aparecem, mas não alteram saldo nem custo.
     */
    function historico(movimentacoes, produtoId) {
        const id = String(produtoId);
        let estado = { saldo: 0, custo: 0 };
        return movimentacoes
            .filter(m => m.produtoId === id)
            .map(m => {
                estado = aplicar(estado, m);
                return { mov: m, saldoApos: estado.saldo, custoApos: estado.custo };
            });
    }

    /** Ajuste manual de quantidade (delta positivo ou negativo). */
    function movimentoAjuste(produtoId, delta, obs) {
        return criarMovimentacao({ produtoId: produtoId, tipo: TIPOS.AJUSTE, qtd: delta, obs: obs || 'Ajuste manual' });
    }

    /** Troca manual do custo médio. */
    function movimentoAjusteCusto(produtoId, custo) {
        return criarMovimentacao({ produtoId: produtoId, tipo: TIPOS.AJUSTE_CUSTO, qtd: 0, custoUnit: custo, obs: 'Ajuste de custo' });
    }

    /** Saldo inicial de um produto cadastrado. */
    function movimentoCadastro(produtoId, estoque, custo) {
        return criarMovimentacao({
            produtoId: produtoId,
            tipo: TIPOS.SALDO_INICIAL,
            qtd: Math.max(0, paraInteiro(estoque)),
            custoUnit: Math.max(0, Number(custo) || 0),
            obs: 'Cadastro'
        });
    }

    const api = {
        TIPOS: TIPOS,
        criarMovimentacao: criarMovimentacao,
        aplicar: aplicar,
        calcular: calcular,
        sincronizar: sincronizar,
        garantirSaldoInicial: garantirSaldoInicial,
        movimentosDaEntrada: movimentosDaEntrada,
        movimentosDaVenda: movimentosDaVenda,
        movimentosDoEstorno: movimentosDoEstorno,
        planejarExclusaoEntrada: planejarExclusaoEntrada,
        verificarExclusaoEntrada: verificarExclusaoEntrada,
        movimentoAjuste: movimentoAjuste,
        movimentoAjusteCusto: movimentoAjusteCusto,
        movimentoCadastro: movimentoCadastro,
        rotulo: rotulo,
        historico: historico
    };

    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.Estoque = api;
})(typeof window !== 'undefined' ? window : globalThis);
