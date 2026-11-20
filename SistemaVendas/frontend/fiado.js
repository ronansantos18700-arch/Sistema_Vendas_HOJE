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

    /**
     * Extrato do cliente: compras a prazo e pagamentos em ordem de data, com o saldo depois de cada movimento.
     * Pagamento = uma operação de recebimento (um clique em Receber), mesmo que tenha caído em mais de uma venda.
     * O saldo final é igual ao que falta pagar.
     */
    function extratoCliente(vendas, clienteId) {
        const resumo = resumoCliente(vendas, clienteId);
        const porId = new Map((vendas || []).map((v) => [String(v.id || v.ID), v]));
        const movimentos = [];
        resumo.vendas.forEach((x) => {
            const venda = porId.get(String(x.vendaId));
            movimentos.push({
                tipo: 'venda', date: x.date, vendaId: x.vendaId, valor: x.total,
                itens: venda && Array.isArray(venda.items) ? venda.items.length : 0, ordem: 0
            });
        });
        operacoes(vendas, clienteId).forEach((o) => {
            movimentos.push({ tipo: 'pagamento', date: o.date, operacao: o.operacao, valor: o.valor, forma: o.forma, ordem: 1 });
        });
        movimentos.sort((a, b) => ((Date.parse(a.date) || 0) - (Date.parse(b.date) || 0)) || (a.ordem - b.ordem));
        let saldo = 0;
        movimentos.forEach((m) => {
            saldo = r2(saldo + (m.tipo === 'venda' ? m.valor : -m.valor));
            m.saldoApos = saldo;
        });
        return { totalPrazo: resumo.totalPrazo, pago: resumo.pago, falta: resumo.falta, movimentos: movimentos };
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

    /**
     * Prazo e limite (versão enxuta, sem cobrança automática).
     * - Cliente: `limite_credito` (R$; vazio ou 0 = sem limite) e `prazo_dias` (vazio = sem prazo).
     * - Venda fiado: `vencimento` (YYYY-MM-DD, dia local) = dia da venda + prazo do cliente, quando há prazo.
     * - Atrasada = fiado com saldo em aberto e vencimento anterior a hoje.
     */

    const pad2 = (n) => String(n).padStart(2, '0');

    /** Data local YYYY-MM-DD (padrão: agora). Vazio se a data não for válida. */
    function dataLocal(d) {
        const x = d instanceof Date ? d : new Date(d === undefined ? Date.now() : d);
        if (isNaN(x.getTime())) return '';
        return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
    }

    /** Dia de vencimento = dia local da venda + prazo em dias. Null quando o cliente não tem prazo. */
    function vencimentoPara(dataVenda, prazoDias) {
        if (prazoDias === '' || prazoDias === null || prazoDias === undefined) return null;
        const dias = Number(prazoDias);
        if (!Number.isInteger(dias) || dias < 0) return null;
        const base = new Date(dataVenda);
        if (isNaN(base.getTime())) return null;
        base.setDate(base.getDate() + dias);
        return dataLocal(base);
    }

    /** Dias corridos entre um vencimento (YYYY-MM-DD) e hoje. Zero quando não está atrasado ou não tem vencimento. */
    function diasAtraso(vencimento, hoje) {
        if (!vencimento || typeof vencimento !== 'string') return 0;
        const ref = hoje || dataLocal();
        const [a, m, d] = vencimento.split('-').map(Number);
        const [ha, hm, hd] = ref.split('-').map(Number);
        if (![a, m, d, ha, hm, hd].every(Number.isFinite)) return 0;
        const dif = Math.round((Date.UTC(ha, hm - 1, hd) - Date.UTC(a, m - 1, d)) / 86400000);
        return Math.max(0, dif);
    }

    /** Venda fiado com saldo em aberto e vencimento já passado. */
    function atrasada(venda, hoje) {
        return ehFiado(venda) && saldoAberto(venda) > 0 && diasAtraso(venda.vencimento, hoje) > 0;
    }

    function resumoAtraso(lista, hoje) {
        const atrasadas = lista.filter((v) => atrasada(v, hoje));
        return {
            quantidade: atrasadas.length,
            valor: r2(atrasadas.reduce((acc, v) => acc + saldoAberto(v), 0)),
            diasMax: atrasadas.reduce((m, v) => Math.max(m, diasAtraso(v.vencimento, hoje)), 0)
        };
    }

    /** Situação de atraso de um cliente: { quantidade, valor, diasMax }. */
    function situacaoAtraso(vendas, clienteId, hoje) {
        return resumoAtraso(emAberto(vendas, clienteId), hoje);
    }

    /** Mapa id do cliente → situação de atraso, só para quem tem venda atrasada. */
    function atrasosPorCliente(vendas, hoje) {
        const mapa = new Map();
        (vendas || []).forEach((v) => {
            const id = clienteIdDe(v);
            if (!id || !atrasada(v, hoje)) return;
            const r = mapa.get(id) || { quantidade: 0, valor: 0, diasMax: 0 };
            r.quantidade += 1;
            r.valor = r2(r.valor + saldoAberto(v));
            r.diasMax = Math.max(r.diasMax, diasAtraso(v.vencimento, hoje));
            mapa.set(id, r);
        });
        return mapa;
    }

    /**
     * Confere o limite de crédito antes de uma venda fiado. Sem limite (vazio ou 0) não bloqueia.
     * Devolve { ok, motivo, disponivel }. Não grava nada.
     */
    function validarLimite(vendas, clienteId, limite, valorNovo) {
        if (limite === '' || limite === null || limite === undefined) return { ok: true };
        const lim = Number(limite);
        if (!(lim > 0)) return { ok: true };
        const disponivel = r2(Math.max(0, lim - saldoCliente(vendas, clienteId)));
        if (r2(valorNovo) > disponivel + TOLERANCIA) {
            return { ok: false, motivo: 'Limite de crédito excedido para este cliente.', disponivel: disponivel };
        }
        return { ok: true, disponivel: disponivel };
    }

    /**
     * Confere o limite ao editar uma venda fiado. Só bloqueia quando a edição aumenta a dívida
     * do cliente (ou passa a venda para outro cliente): editar sem aumentar o saldo nunca é travado.
     * Devolve { ok, motivo, disponivel }. Não grava nada.
     */
    function validarLimiteEdicao(vendas, venda, clienteId, limite, novoTotal) {
        if (!venda) return { ok: true };
        const novoAberto = r2(Math.max(0, (Number(novoTotal) || 0) - recebido(venda)));
        const abertoAntes = doCliente(venda, clienteId) ? saldoAberto(venda) : 0;
        if (novoAberto <= abertoAntes) return { ok: true };
        // As outras vendas somam o saldo do cliente; a venda editada entra com o saldo novo inteiro.
        const outras = (vendas || []).filter((v) => !v || String(v.id) !== String(venda.id));
        return validarLimite(outras, clienteId, limite, novoAberto);
    }

    /** Valida o cadastro: limite e prazo, quando preenchidos, precisam ser números válidos. */
    function validarCadastroCredito(limite, prazoDias) {
        if (limite !== '' && limite !== null && limite !== undefined) {
            const n = Number(limite);
            if (!Number.isFinite(n) || n < 0) return { ok: false, motivo: 'O limite de crédito não pode ser negativo.' };
        }
        if (prazoDias !== '' && prazoDias !== null && prazoDias !== undefined) {
            const n = Number(prazoDias);
            if (!Number.isInteger(n) || n < 0 || n > 3650) return { ok: false, motivo: 'O prazo deve ser um número inteiro de dias (0 a 3650).' };
        }
        return { ok: true };
    }

    const API = {
        dataLocal, vencimentoPara, diasAtraso, atrasada, situacaoAtraso, atrasosPorCliente,
        validarLimite, validarLimiteEdicao, validarCadastroCredito,
        CONSUMIDOR_FINAL, FORMAS_RECEBIMENTO, NOMES_FORMA,
        ehFiado, recebimentos, recebido, saldoAberto, emAberto, saldoCliente, saldosPorCliente,
        validarVendaFiado, distribuir, registrarRecebimento, validarEdicao,
        operacaoDe, operacoes, estornarRecebimento,
        clienteIdDe, camposFiado, vincularLegado, pendentesSemCliente, vincular, renomearCliente,
        resumoCliente, resumosPorCliente, restanteAposRecebimento, extratoCliente
    };

    raiz.Fiado = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
