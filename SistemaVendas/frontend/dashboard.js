/*
 * Dashboard (lógica pura, sem DOM): série do gráfico de evolução e indicadores estratégicos
 * de estoque e de vendas.
 *
 * Regras de dia: sempre o dia LOCAL. (Antes, o agrupamento usava toISOString, que é UTC:
 * no Brasil uma venda depois das 21h caía no dia seguinte.)
 *
 * Carregado no navegador (window.Dashboard) e no Node (module.exports), para os testes.
 */
(function (raiz) {
    'use strict';

    const COBERTURA_ALVO_DIAS = 30;   // quantos dias de venda a reposição deve cobrir
    const COBERTURA_CRITICA_DIAS = 7; // abaixo disso, o produto é crítico
    const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const SEM_CLIENTE = ['', 'consumidor final'];

    function num(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
    }

    function arred2(valor) {
        return Math.round((num(valor) + Number.EPSILON) * 100) / 100;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    /** Chave do dia local: YYYY-MM-DD. */
    function chaveDia(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function escaparHtml(valor) {
        return String(valor == null ? '' : valor)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** Id do produto num item de venda (mesma regra do app: productId, depois id). */
    function idItem(item) {
        const id = item.productId != null ? item.productId : (item.id != null ? item.id : item.name);
        return String(id);
    }

    /** Quantidade vendida num item (mesma regra do app: qtySold, depois qty). */
    function qtdItem(item) {
        return num(item.qtySold) || num(item.qty);
    }

    /** Data da venda (usa o parser do app quando recebe um). Devolve null se inválida. */
    function dataVenda(venda, parseDate) {
        const bruto = venda.date || venda.Data;
        const d = parseDate ? parseDate(bruto) : new Date(bruto);
        return d && !isNaN(d.getTime()) ? d : null;
    }

    /** Faturamento, custo e lucro de uma venda, com os mesmos campos alternativos do app. */
    function valoresVenda(venda) {
        const subtotal = venda.valor_total ?? venda['Valor Total'] ?? venda.total ?? 0;
        const desconto = venda.desconto ?? venda.Desconto ?? 0;
        const faturamento = num(subtotal) - num(desconto);
        const custo = num(venda.cost ?? venda.custo ?? venda.Custo ?? venda.custoTotal ?? 0);
        const lucro = venda.lucro ?? venda.Lucro;
        return {
            faturamento: faturamento,
            custo: custo,
            lucro: lucro == null ? faturamento - custo : num(lucro)
        };
    }

    // ---------------------------------------------------------------
    // Gráfico de evolução: uma passagem pelas vendas, qualquer que seja o período.
    // ---------------------------------------------------------------

    /**
     * Série do gráfico. filtro: '7d' (últimos 7 dias), 'month' (dias do mês atual) ou 'year' (meses do ano).
     * Devolve { labels, revenue, profit, cost }. Outros filtros devolvem série vazia (como antes).
     */
    function serieLinha(vendas, filtro, agora, parseDate) {
        const labels = [];
        const indice = new Map();
        const ano = agora.getFullYear();
        const mes = agora.getMonth();

        if (filtro === '7d') {
            for (let i = 6; i >= 0; i--) {
                const dia = new Date(ano, mes, agora.getDate() - i);
                indice.set(chaveDia(dia), labels.length);
                labels.push(pad(dia.getDate()) + '/' + pad(dia.getMonth() + 1));
            }
        } else if (filtro === 'month') {
            const dias = new Date(ano, mes + 1, 0).getDate();
            for (let i = 1; i <= dias; i++) {
                indice.set(chaveDia(new Date(ano, mes, i)), labels.length);
                labels.push(String(i));
            }
        } else if (filtro === 'year') {
            const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            for (let m = 0; m < 12; m++) {
                indice.set(ano + '-' + m, labels.length);
                labels.push(nomes[m]);
            }
        }

        const revenue = labels.map(() => 0);
        const profit = labels.map(() => 0);
        const cost = labels.map(() => 0);

        for (const venda of vendas || []) {
            const d = dataVenda(venda, parseDate);
            if (!d) continue;
            const chave = filtro === 'year' ? d.getFullYear() + '-' + d.getMonth() : chaveDia(d);
            const idx = indice.get(chave);
            if (idx === undefined) continue;
            const v = valoresVenda(venda);
            revenue[idx] += v.faturamento;
            profit[idx] += v.lucro;
            cost[idx] += v.custo;
        }

        return {
            labels: labels,
            revenue: revenue.map(arred2),
            profit: profit.map(arred2),
            cost: cost.map(arred2)
        };
    }

    // ---------------------------------------------------------------
    // Indicadores de estoque
    // ---------------------------------------------------------------

    function vendasDaJanela(vendas, agora, dias, parseDate) {
        const inicio = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);
        return (vendas || []).filter((v) => {
            const d = dataVenda(v, parseDate);
            // Sem limite superior: venda com relógio levemente adiantado não pode sumir dos indicadores.
            return d && d >= inicio;
        });
    }

    /**
     * Indicadores de estoque, sempre sobre a janela de `janelaDias` (independe do filtro da tela).
     * - ruptura: % de produtos sem saldo
     * - cobertura média: dias que o estoque atual dura, pelo ritmo de venda da janela
     * - reposição: produtos que vendem e têm menos de COBERTURA_ALVO_DIAS de estoque, do mais urgente
     * - parados: produtos com saldo e sem nenhuma venda na janela (e o dinheiro preso neles)
     * - giro: custo vendido na janela dividido pelo valor do estoque atual
     */
    function kpisEstoque(produtos, vendas, agora, opcoes) {
        const dias = (opcoes && opcoes.janelaDias) || 30;
        const parseDate = opcoes && opcoes.parseDate;
        const recentes = vendasDaJanela(vendas, agora, dias, parseDate);

        const unidades = new Map();
        let custoVendido = 0;
        for (const venda of recentes) {
            custoVendido += valoresVenda(venda).custo;
            for (const item of (venda.items || [])) {
                const id = idItem(item);
                unidades.set(id, (unidades.get(id) || 0) + qtdItem(item));
            }
        }

        const itens = (produtos || []).map((p) => {
            const id = String(p.id);
            const saldo = num(p.stock);
            const custo = num(p.cost);
            const vendidas = unidades.get(id) || 0;
            const media = vendidas / dias;
            return {
                id: id,
                produto: p.name || id,
                saldo: saldo,
                custo: custo,
                vendidas: vendidas,
                mediaDiaria: media,
                cobertura: media > 0 ? saldo / media : null,
                valorParado: arred2(saldo * custo),
                sugestao: media > 0 ? Math.max(0, Math.ceil(media * COBERTURA_ALVO_DIAS - saldo)) : 0
            };
        });

        const total = itens.length;
        const zerados = itens.filter((i) => i.saldo <= 0).length;
        const comVenda = itens.filter((i) => i.cobertura !== null);
        const somaSaldo = comVenda.reduce((acc, i) => acc + Math.max(0, i.saldo), 0);
        const somaMedia = comVenda.reduce((acc, i) => acc + i.mediaDiaria, 0);
        const parados = itens.filter((i) => i.saldo > 0 && i.vendidas === 0);
        const valorEstoque = arred2(itens.reduce((acc, i) => acc + i.valorParado, 0));
        const reposicao = itens
            .filter((i) => i.cobertura !== null && i.cobertura < COBERTURA_ALVO_DIAS)
            .sort((a, b) => a.cobertura - b.cobertura);

        return {
            janelaDias: dias,
            totalProdutos: total,
            zerados: zerados,
            taxaRuptura: total > 0 ? (zerados / total) * 100 : 0,
            coberturaMediaDias: somaMedia > 0 ? somaSaldo / somaMedia : null,
            criticos: reposicao.filter((i) => i.cobertura < COBERTURA_CRITICA_DIAS).length,
            reposicao: reposicao.slice(0, 10),
            paradosQuantidade: parados.length,
            valorParado: arred2(parados.reduce((acc, i) => acc + i.valorParado, 0)),
            valorEstoque: valorEstoque,
            giro: valorEstoque > 0 ? custoVendido / valorEstoque : null,
            custoVendido: arred2(custoVendido)
        };
    }

    // ---------------------------------------------------------------
    // Indicadores de vendas (sobre as vendas do período escolhido na tela)
    // ---------------------------------------------------------------

    /** Margem, lucro por categoria, dia e horário de pico, ticket médio e recorrência de clientes. */
    function kpisVendas(vendas, produtos, parseDate) {
        const categoriaDoProduto = new Map();
        for (const p of (produtos || [])) categoriaDoProduto.set(String(p.id), p.category || 'Sem categoria');

        let faturamento = 0;
        let custo = 0;
        let lucro = 0;
        const dias = DIAS_SEMANA.map((nome) => ({ dia: nome, vendas: 0, faturamento: 0 }));
        const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, vendas: 0, faturamento: 0 }));
        const categorias = new Map();
        const clientes = new Map();
        const faturamentoPorCliente = new Map();

        for (const venda of (vendas || [])) {
            const v = valoresVenda(venda);
            faturamento += v.faturamento;
            custo += v.custo;
            lucro += v.lucro;

            const d = dataVenda(venda, parseDate);
            if (d) {
                dias[d.getDay()].vendas += 1;
                dias[d.getDay()].faturamento += v.faturamento;
                horas[d.getHours()].vendas += 1;
                horas[d.getHours()].faturamento += v.faturamento;
            }

            // Lucro por categoria: receita dos itens com a parte do desconto da venda, menos o custo.
            const total = num(venda.valor_total);
            const fator = total > 0 ? v.faturamento / total : 1;
            for (const item of (venda.items || [])) {
                const categoria = categoriaDoProduto.get(idItem(item)) || item.category || 'Sem categoria';
                const qtd = qtdItem(item);
                const lucroItem = qtd * num(item.price) * fator - qtd * num(item.cost);
                categorias.set(categoria, (categorias.get(categoria) || 0) + lucroItem);
            }

            const nome = String(venda.cliente || '').trim();
            if (!SEM_CLIENTE.includes(nome.toLowerCase())) {
                clientes.set(nome, (clientes.get(nome) || 0) + 1);
                faturamentoPorCliente.set(nome, (faturamentoPorCliente.get(nome) || 0) + v.faturamento);
            }
        }

        const n = (vendas || []).length;
        const listaCategorias = [...categorias.entries()]
            .map(([categoria, lucroCat]) => ({
                categoria: categoria,
                lucro: arred2(lucroCat),
                participacao: lucro !== 0 ? (lucroCat / lucro) * 100 : 0
            }))
            .sort((a, b) => b.lucro - a.lucro);

        const pico = (lista, chave) => {
            const com = lista.filter((x) => x.vendas > 0);
            if (com.length === 0) return null;
            return com.reduce((melhor, x) => (x.faturamento > melhor.faturamento ? x : melhor))[chave];
        };

        const distintos = clientes.size;
        const recorrentes = [...clientes.values()].filter((q) => q >= 2).length;
        const fatRecorrentes = [...clientes.entries()]
            .filter(([, q]) => q >= 2)
            .reduce((acc, [nome]) => acc + (faturamentoPorCliente.get(nome) || 0), 0);

        return {
            vendas: n,
            faturamento: arred2(faturamento),
            custo: arred2(custo),
            lucro: arred2(lucro),
            margemBruta: faturamento > 0 ? (lucro / faturamento) * 100 : null,
            ticketMedio: n > 0 ? arred2(faturamento / n) : null,
            categorias: listaCategorias,
            diaPico: pico(dias, 'dia'),
            horaPico: pico(horas, 'hora'),
            clientesDistintos: distintos,
            clientesRecorrentes: recorrentes,
            taxaRecorrencia: distintos > 0 ? (recorrentes / distintos) * 100 : null,
            participacaoRecorrentes: faturamento > 0 ? (fatRecorrentes / faturamento) * 100 : null,
            produtosLucro: rankingProdutos(vendas, produtos).sort((a, b) => b.lucro - a.lucro).slice(0, 5)
        };
    }

    // ---------------------------------------------------------------
    // Produtos: ranking por lucro e por quantidade; alertas do estoque atual
    // ---------------------------------------------------------------

    /**
     * Um registro por produto vendido no conjunto de vendas: quantidade, faturamento, lucro e margem.
     * O desconto da venda é repartido entre os itens (mesma regra de kpisVendas).
     */
    function rankingProdutos(vendas, produtos) {
        const nomes = new Map();
        for (const p of (produtos || [])) nomes.set(String(p.id), p.name);

        const mapa = new Map();
        for (const venda of (vendas || [])) {
            const total = num(venda.valor_total);
            const fator = total > 0 ? valoresVenda(venda).faturamento / total : 1;
            for (const item of (venda.items || [])) {
                const id = idItem(item);
                const qtd = qtdItem(item);
                const receita = qtd * num(item.price) * fator;
                const custo = qtd * num(item.cost);
                let r = mapa.get(id);
                if (!r) {
                    r = { id: id, nome: nomes.get(id) || item.name || id, qtd: 0, faturamento: 0, lucro: 0 };
                    mapa.set(id, r);
                }
                r.qtd += qtd;
                r.faturamento += receita;
                r.lucro += receita - custo;
            }
        }

        return [...mapa.values()].map((r) => ({
            id: r.id,
            nome: r.nome,
            qtd: r.qtd,
            faturamento: arred2(r.faturamento),
            lucro: arred2(r.lucro),
            margem: r.faturamento > 0 ? (r.lucro / r.faturamento) * 100 : null
        }));
    }

    /** Produtos sem saldo e produtos com saldo abaixo do nível baixo (os de menor saldo primeiro). */
    function alertasEstoque(produtos, nivelBaixo) {
        const baixo = Number(nivelBaixo) || 10;
        const lista = (produtos || []).map((p) => ({
            id: String(p.id),
            produto: p.name || String(p.id),
            saldo: num(p.stock)
        }));
        const porSaldo = (a, b) => a.saldo - b.saldo;
        return {
            semEstoque: lista.filter((x) => x.saldo <= 0).sort(porSaldo),
            estoqueBaixo: lista.filter((x) => x.saldo > 0 && x.saldo < baixo).sort(porSaldo)
        };
    }

    const MESES_LONGOS = {
        Jan: 'janeiro', Fev: 'fevereiro', Mar: 'março', Abr: 'abril', Mai: 'maio', Jun: 'junho',
        Jul: 'julho', Ago: 'agosto', Set: 'setembro', Out: 'outubro', Nov: 'novembro', Dez: 'dezembro'
    };

    const ROTULOS_PAGAMENTO = Object.freeze({
        dinheiro: 'Dinheiro',
        cartao: 'Cartão',
        'cartão': 'Cartão',
        pix: 'PIX',
        fiado: 'Fiado',
        outros: 'Outros'
    });

    /**
     * Intervalos locais para o período selecionado e seu período anterior equivalente.
     * - 7d: 7 dias civis (hoje - 6 dias 00:00 até agora) vs os 7 dias civis imediatamente anteriores.
     * - month: início do mês atual até agora vs início do mês anterior até o ponto equivalente (MTD).
     * - year: início do ano atual até agora vs início do ano anterior até o ponto equivalente (YTD).
     */
    function intervalosPeriodo(filtro, agora) {
        const ref = agora instanceof Date ? agora : new Date();
        const ano = ref.getFullYear();
        const mes = ref.getMonth();
        const dia = ref.getDate();
        const h = ref.getHours(), m = ref.getMinutes(), s = ref.getSeconds(), ms = ref.getMilliseconds();

        if (filtro === '7d') {
            const atualInicio = new Date(ano, mes, dia - 6, 0, 0, 0, 0);
            const anteriorInicio = new Date(ano, mes, dia - 13, 0, 0, 0, 0);
            const anteriorFim = new Date(atualInicio.getTime() - 1);
            return { atualInicio, atualFim: ref, anteriorInicio, anteriorFim };
        }
        if (filtro === 'month') {
            const atualInicio = new Date(ano, mes, 1, 0, 0, 0, 0);
            const anteriorInicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
            const ultimoDiaAnt = new Date(ano, mes, 0).getDate();
            const diaEq = Math.min(dia, ultimoDiaAnt);
            const anteriorFim = new Date(ano, mes - 1, diaEq, h, m, s, ms);
            return { atualInicio, atualFim: ref, anteriorInicio, anteriorFim };
        }
        if (filtro === 'year') {
            const atualInicio = new Date(ano, 0, 1, 0, 0, 0, 0);
            const anteriorInicio = new Date(ano - 1, 0, 1, 0, 0, 0, 0);
            const ultimoDiaAnt = new Date(ano - 1, mes + 1, 0).getDate();
            const diaEq = Math.min(dia, ultimoDiaAnt);
            const anteriorFim = new Date(ano - 1, mes, diaEq, h, m, s, ms);
            return { atualInicio, atualFim: ref, anteriorInicio, anteriorFim };
        }
        return null;
    }

    /**
     * Vendas agrupadas por forma de pagamento (sobre valor líquido após desconto).
     * Vendas divididas (sale.pagamentos) rateiam cada parcela na sua forma real.
     * Devolve [{ forma, rotulo, vendas, faturamento, percentual }] ordenado do maior faturamento.
     */
    function resumoPagamentos(vendas) {
        const grupos = new Map();
        const normalizar = (raw) => {
            const s = String(raw || '').trim();
            if (!s) return 'outros';
            const k = s.toLowerCase();
            if (k === 'cartão') return 'cartao';
            return k;
        };
        const rotuloDe = (chave) => {
            if (ROTULOS_PAGAMENTO[chave]) return ROTULOS_PAGAMENTO[chave];
            return chave.charAt(0).toUpperCase() + chave.slice(1);
        };
        const somar = (chave, valor, contarVenda) => {
            if (!grupos.has(chave)) grupos.set(chave, { forma: chave, rotulo: rotuloDe(chave), vendas: 0, faturamento: 0 });
            const g = grupos.get(chave);
            g.faturamento += valor;
            if (contarVenda) g.vendas += 1;
        };

        let total = 0;
        for (const venda of (vendas || [])) {
            if (Array.isArray(venda.pagamentos) && venda.pagamentos.length > 0) {
                const vistas = new Set();
                for (const p of venda.pagamentos) {
                    const chave = normalizar(p.forma);
                    const val = num(p.valor);
                    somar(chave, val, !vistas.has(chave));
                    vistas.add(chave);
                    total += val;
                }
            } else {
                const chave = normalizar(venda.pagamento || venda.PaymentMethod || venda.formaPagamento);
                const val = valoresVenda(venda).faturamento;
                somar(chave, val, true);
                total += val;
            }
        }

        return [...grupos.values()]
            .map((g) => ({
                forma: g.forma,
                rotulo: g.rotulo,
                vendas: g.vendas,
                faturamento: arred2(g.faturamento),
                percentual: total > 0 ? (g.faturamento / total) * 100 : 0
            }))
            .sort((a, b) => b.faturamento - a.faturamento);
    }

    function percentual(valor) {
        return (Math.round(Math.abs(valor) * 10) / 10).toFixed(1).replace('.', ',') + '%';
    }

    function moeda(valor) {
        return 'R$ ' + arred2(valor).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    /**
     * Textos de insight para a visão de vendas. Cada texto diz o que aconteceu, não só o número.
     * serie: saída de serieLinha. indiceAtual: posição do período corrente na série (sem dados futuros).
     * atual/anterior: { faturamento, vendas }. ven: saída de kpisVendas.
     */
    function insightsVendas(serie, indiceAtual, atual, anterior, ven) {
        if (!atual || !atual.vendas) return ['Sem vendas no período selecionado.'];
        const textos = [];
        const receita = (serie && serie.revenue) || [];
        const rotulos = (serie && serie.labels) || [];

        let pico = -1;
        receita.forEach((v, i) => { if (v > 0 && (pico < 0 || v > receita[pico])) pico = i; });

        if (pico >= 0) {
            const nomePico = MESES_LONGOS[rotulos[pico]] || rotulos[pico];
            let frase = `${nomePico.charAt(0).toUpperCase() + nomePico.slice(1)} concentrou o maior faturamento do período (${moeda(receita[pico])})`;
            const prox = pico + 1;
            if (prox < receita.length && prox <= indiceAtual && receita[pico] > 0) {
                const queda = (receita[pico] - receita[prox]) / receita[pico] * 100;
                const nomeProx = MESES_LONGOS[rotulos[prox]] || rotulos[prox];
                if (queda > 0) frase += `, seguido por uma queda de ${percentual(queda)} em ${nomeProx}`;
            }
            textos.push(frase + '.');
        }

        if (anterior && anterior.faturamento > 0) {
            const variacao = (atual.faturamento - anterior.faturamento) / anterior.faturamento * 100;
            const verbo = variacao >= 0 ? 'acima' : 'abaixo';
            textos.push(`Faturamento de ${moeda(atual.faturamento)}, ${percentual(variacao)} ${verbo} do período anterior.`);
        } else {
            textos.push(`Faturamento de ${moeda(atual.faturamento)} no período.`);
        }

        if (ven && ven.margemBruta != null) {
            textos.push(`Margem bruta de ${percentual(ven.margemBruta)}, com lucro de ${moeda(ven.lucro)}.`);
        }
        return textos;
    }

    /** Textos de insight para a visão de estoque: o que precisa de ação, em ordem de urgência. */
    function insightsEstoque(est) {
        if (!est || !est.totalProdutos) return ['Nenhum produto cadastrado.'];
        const textos = [];
        if (est.zerados > 0) {
            textos.push(`${est.zerados} produto(s) sem saldo, ruptura de ${percentual(est.taxaRuptura)} do catálogo.`);
        }
        if (est.criticos > 0) {
            textos.push(`${est.criticos} produto(s) com cobertura abaixo de ${COBERTURA_CRITICA_DIAS} dias.`);
        }
        if (est.valorParado > 0) {
            textos.push(`${moeda(est.valorParado)} parados em ${est.paradosQuantidade} produto(s) sem venda nos últimos ${est.janelaDias} dias.`);
        }
        if (!textos.length) textos.push('Nenhum produto em ruptura ou com cobertura crítica.');
        return textos;
    }

    /**
     * Série de margem de lucro (%) ao longo do período selecionado (dia em 7d/month, mês em year).
     * Pontos sem faturamento retornam null para não distorcer a linha com 0% artificial.
     */
    function serieMargemPeriodo(vendas, filtro, agora, parseDate) {
        const base = serieLinha(vendas, filtro, agora, parseDate);
        let hasData = false;
        const margins = base.revenue.map((fat, i) => {
            if (fat > 0) {
                hasData = true;
                return arred2((base.profit[i] / fat) * 100);
            }
            return null;
        });
        return {
            labels: base.labels,
            margins: margins,
            revenue: base.revenue,
            profit: base.profit,
            hasData: hasData
        };
    }

    /**
     * Faturamento e quantidade de vendas por hora local (0h..23h), alinhado ao KPI de horário de pico.
     */
    function vendasPorHorario(vendas, parseDate) {
        const labels = Array.from({ length: 24 }, (_, h) => `${h}h`);
        const revenue = Array(24).fill(0);
        const counts = Array(24).fill(0);
        let hasData = false;
        (vendas || []).forEach((v) => {
            const d = dataVenda(v, parseDate);
            if (!d) return;
            const h = d.getHours();
            if (h >= 0 && h < 24) {
                revenue[h] = arred2(revenue[h] + valoresVenda(v).faturamento);
                counts[h] += 1;
                hasData = true;
            }
        });
        return { labels, revenue, counts, hasData };
    }

    const API = {
        COBERTURA_ALVO_DIAS, COBERTURA_CRITICA_DIAS,
        chaveDia, valoresVenda, serieLinha, serieMargemPeriodo, vendasPorHorario,
        intervalosPeriodo, resumoPagamentos,
        kpisEstoque, kpisVendas, escaparHtml, dataVenda,
        rankingProdutos, alertasEstoque, insightsVendas, insightsEstoque
    };

    raiz.Dashboard = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
