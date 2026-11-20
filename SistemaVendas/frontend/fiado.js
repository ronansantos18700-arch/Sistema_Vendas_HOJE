/*
 * Fiado (venda a prazo): lógica pura, sem DOM.
 *
 * Regras:
 * - Venda fiado tem pagamento = 'fiado' e exige cliente cadastrado (não é Consumidor Final).
 * - A venda fiado guarda o id do cliente (`cliente_id`). O nome (`cliente`) é só o texto da venda:
 *   saldo, recebimentos e estorno usam o id, então clientes com o mesmo nome não se misturam.
 *   Vendas fiado antigas (sem id) são vinculadas pelo nome só quando ele é único.
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

    /** Id do cliente da venda (texto). Vazio quando a venda ainda não tem cliente vinculado. */
    function clienteIdDe(venda) {
        return venda && venda.cliente_id != null && venda.cliente_id !== '' ? String(venda.cliente_id) : '';
    }

    function doCliente(venda, clienteId) {
        const id = clienteIdDe(venda);
        return !!id && id === String(clienteId || '');
    }

    function saldoAberto(venda) {
        if (!ehFiado(venda)) return 0;
        return Math.max(0, r2((Number(venda.valor_final) || 0) - recebido(venda)));
    }

    /** Vendas a prazo do cliente (pelo id) com saldo, da mais antiga para a mais recente. */
    function emAberto(vendas, clienteId) {
        return (vendas || [])
            .filter((v) => ehFiado(v) && doCliente(v, clienteId) && saldoAberto(v) > 0)
            .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
    }

    function saldoCliente(vendas, clienteId) {
        return r2(emAberto(vendas, clienteId).reduce((acc, v) => acc + saldoAberto(v), 0));
    }

    /** Mapa id do cliente → saldo em aberto (só clientes com saldo). Vendas sem cliente vinculado ficam de fora. */
    function saldosPorCliente(vendas) {
        const mapa = new Map();
        (vendas || []).forEach((v) => {
            const s = saldoAberto(v);
            const id = clienteIdDe(v);
            if (s <= 0 || !id) return;
            mapa.set(id, r2((mapa.get(id) || 0) + s));
        });
        return mapa;
    }

    /** Venda a prazo só vale com cliente cadastrado (recebe o id do cliente). */
    function validarVendaFiado(clienteId) {
        if (!clienteId) {
            return { ok: false, motivo: 'Venda fiado exige um cliente cadastrado. Selecione o cliente no PDV.' };
        }
        return { ok: true };
    }

    /**
     * Calcula como um recebimento se divide entre as vendas em aberto (mais antiga primeiro).
     * Não altera nada; devolve { ok, motivo, aplicacoes: [{ vendaId, valor }] }.
     */
    function distribuir(vendas, clienteId, valor, forma) {
        if (!FORMAS_RECEBIMENTO.includes(forma)) return { ok: false, motivo: 'Forma de recebimento inválida.' };
        const v = r2(valor);
        if (!(v > 0)) return { ok: false, motivo: 'Informe um valor maior que zero.' };
        const saldo = saldoCliente(vendas, clienteId);
        if (saldo <= 0) return { ok: false, motivo: 'Este cliente não tem saldo em aberto.' };
        if (v - saldo > TOLERANCIA) {
            return { ok: false, motivo: `O valor passa do saldo em aberto (${saldo.toFixed(2)}).` };
        }

        let restante = Math.min(v, saldo);
        const aplicacoes = [];
        for (const venda of emAberto(vendas, clienteId)) {
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
    function registrarRecebimento(vendas, clienteId, valor, forma, dataIso, idBase) {
        const plano = distribuir(vendas, clienteId, valor, forma);
        if (!plano.ok) return plano;
        plano.aplicacoes.forEach((ap, i) => {
            const venda = (vendas || []).find((x) => (x.id || x.ID) === ap.vendaId);
            if (!venda) return;
            if (!Array.isArray(venda.recebimentos)) venda.recebimentos = [];
            venda.recebimentos.push({ id: idBase + '-' + (i + 1), date: dataIso, valor: ap.valor, forma: forma });
        });
        return plano;
    }

    /** Identificador da operação de recebimento: a parte antes do último hífen (cada parcela é "operação-n"). */
    function operacaoDe(idRecebimento) {
        const id = String(idRecebimento || '');
        const i = id.lastIndexOf('-');
        return i > 0 ? id.slice(0, i) : id;
    }

    /**
     * Recebimentos do cliente agrupados por operação (um clique em Receber = uma operação),
     * mais recente primeiro. Cada item: { operacao, date, forma, valor, vendas: [id] }.
     */
    function operacoes(vendas, clienteId) {
        const mapa = new Map();
        (vendas || []).filter((v) => ehFiado(v) && doCliente(v, clienteId)).forEach((v) => {
            const idVenda = v.id || v.ID;
            recebimentos(v).forEach((r) => {
                const op = operacaoDe(r.id);
                if (!mapa.has(op)) mapa.set(op, { operacao: op, date: r.date, forma: r.forma, valor: 0, vendas: [] });
                const o = mapa.get(op);
                o.valor = r2(o.valor + (Number(r.valor) || 0));
                if (!o.vendas.includes(idVenda)) o.vendas.push(idVenda);
            });
        });
        return [...mapa.values()].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    }

    /**
     * Estorna uma operação de recebimento inteira, em todas as vendas em que ela foi distribuída.
     * Altera as vendas só quando encontra a operação. Devolve { ok, motivo, vendas: [{vendaId, valor}], valor }.
     */
    function estornarRecebimento(vendas, operacao) {
        const alteradas = [];
        (vendas || []).forEach((v) => {
            if (!ehFiado(v)) return;
            const lista = recebimentos(v);
            const daOperacao = lista.filter((r) => operacaoDe(r.id) === operacao);
            if (daOperacao.length === 0) return;
            alteradas.push({ vendaId: v.id || v.ID, valor: recebido({ recebimentos: daOperacao }) });
            v.recebimentos = lista.filter((r) => operacaoDe(r.id) !== operacao);
        });
        if (alteradas.length === 0) return { ok: false, motivo: 'Recebimento não encontrado.' };
        return { ok: true, vendas: alteradas, valor: r2(alteradas.reduce((acc, a) => acc + a.valor, 0)) };
    }

    /**
     * Regras da edição de uma venda fiado:
     * - venda com recebimentos continua fiado;
     * - o novo total não pode ficar abaixo do que já foi recebido;
     * - trocar para fiado exige cliente cadastrado (clienteId = cliente escolhido).
     */
    function validarEdicao(venda, novoTotal, escolha, clienteId) {
        const jaRecebido = recebido(venda);
        if (jaRecebido > 0 && escolha !== 'fiado') {
            return { ok: false, motivo: `Esta venda já tem recebimentos (${jaRecebido.toFixed(2)}). Ela continua fiado.` };
        }
        if (escolha === 'fiado') {
            const validacao = validarVendaFiado(clienteId);
            if (!validacao.ok) return validacao;
            if (r2(novoTotal) < jaRecebido) {
                return { ok: false, motivo: `O novo total fica abaixo do já recebido (${jaRecebido.toFixed(2)}).` };
            }
        }
        return { ok: true };
    }

    /**
     * Quanto um cliente deve a prazo: total das vendas fiado, o que já foi pago e o que falta.
     * Cada venda traz o próprio andamento (mais antiga primeiro).
     */
    function resumoCliente(vendas, clienteId) {
        const lista = (vendas || [])
            .filter((v) => ehFiado(v) && doCliente(v, clienteId))
            .map((v) => ({
                vendaId: v.id || v.ID,
                date: v.date,
                total: r2(Number(v.valor_final) || 0),
                pago: recebido(v),
                falta: saldoAberto(v)
            }))
            .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
        const soma = (campo) => r2(lista.reduce((acc, x) => acc + x[campo], 0));
        return { totalPrazo: soma('total'), pago: soma('pago'), falta: soma('falta'), vendas: lista };
    }

    /** Mapa id do cliente → { totalPrazo, pago, falta } para todos os clientes com venda fiado. */
    function resumosPorCliente(vendas) {
        const mapa = new Map();
        (vendas || []).forEach((v) => {
            const id = clienteIdDe(v);
            if (!ehFiado(v) || !id) return;
            const r = mapa.get(id) || { totalPrazo: 0, pago: 0, falta: 0 };
            r.totalPrazo = r2(r.totalPrazo + (Number(v.valor_final) || 0));
            r.pago = r2(r.pago + recebido(v));
            r.falta = r2(r.falta + saldoAberto(v));
            mapa.set(id, r);
        });
        return mapa;
    }

    /** Prévia do recebimento: quanto fica em aberto depois do valor digitado. Não grava nada. */
    function restanteAposRecebimento(saldo, valor) {
        const v = r2(valor);
        if (!(v > 0)) return { ok: false, motivo: 'Informe um valor maior que zero.' };
        if (v - saldo > TOLERANCIA) return { ok: false, motivo: `O valor passa do saldo em aberto (${r2(saldo).toFixed(2)}).` };
        return { ok: true, restante: r2(saldo - v) };
    }

    /** Campos de fiado lidos do banco (normalização ao carregar): só entram os que existem. */
    function camposFiado(s) {
        const campos = {};
        if (Array.isArray(s.recebimentos)) campos.recebimentos = s.recebimentos;
        const id = clienteIdDe(s);
        if (id) campos.cliente_id = id;
        return campos;
    }

    /** Nomes iguais, sem diferença de maiúsculas e espaços nas pontas. */
    function mesmoNome(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    /**
     * Vincula vendas fiado antigas (sem id) ao cliente de mesmo nome, quando só existe um.
     * Não mexe nas que têm nome repetido ou sem cadastro: essas ficam em pendentesSemCliente.
     * Devolve { vinculadas }.
     */
    function vincularLegado(vendas, clientes) {
        let vinculadas = 0;
        (vendas || []).forEach((v) => {
            if (!ehFiado(v) || clienteIdDe(v)) return;
            const iguais = (clientes || []).filter((c) => mesmoNome(c.name, v.cliente));
            if (iguais.length === 1) {
                v.cliente_id = String(iguais[0].id);
                vinculadas += 1;
            }
        });
        return { vinculadas: vinculadas };
    }

    /** Vendas fiado com saldo que ainda não têm cliente vinculado (para a tela de Clientes revisar). */
    function pendentesSemCliente(vendas) {
        return (vendas || [])
            .filter((v) => ehFiado(v) && !clienteIdDe(v) && saldoAberto(v) > 0)
            .map((v) => ({ vendaId: v.id || v.ID, cliente: v.cliente, date: v.date, saldo: saldoAberto(v) }))
            .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
    }

    /** Vincula uma venda fiado sem cliente ao cliente escolhido ({id, name}). */
    function vincular(vendas, vendaId, cliente) {
        if (!cliente || !cliente.id) return { ok: false, motivo: 'Escolha um cliente cadastrado.' };
        const venda = (vendas || []).find((x) => (x.id || x.ID) === vendaId);
        if (!venda) return { ok: false, motivo: 'Venda não encontrada.' };
        if (!ehFiado(venda)) return { ok: false, motivo: 'Só vendas fiado precisam de cliente vinculado.' };
        if (clienteIdDe(venda)) return { ok: false, motivo: 'Esta venda já tem cliente vinculado.' };
        venda.cliente_id = String(cliente.id);
        venda.cliente = cliente.name;
        return { ok: true };
    }

    /** Ao renomear o cliente, as vendas fiado dele passam a mostrar o nome novo (o vínculo é pelo id). */
    function renomearCliente(vendas, clienteId, nome) {
        (vendas || []).forEach((v) => {
            if (ehFiado(v) && doCliente(v, clienteId)) v.cliente = nome;
        });
    }

    const API = {
        CONSUMIDOR_FINAL, FORMAS_RECEBIMENTO, NOMES_FORMA,
        ehFiado, recebimentos, recebido, saldoAberto, emAberto, saldoCliente, saldosPorCliente,
        validarVendaFiado, distribuir, registrarRecebimento, validarEdicao,
        operacaoDe, operacoes, estornarRecebimento,
        clienteIdDe, camposFiado, vincularLegado, pendentesSemCliente, vincular, renomearCliente,
        resumoCliente, resumosPorCliente, restanteAposRecebimento
    };

    raiz.Fiado = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
