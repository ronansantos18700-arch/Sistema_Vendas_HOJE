/*
 * Relatórios (lógica pura, sem DOM): agregação, XLSX e PDF.
 *
 * Cada relatório vira uma "seção" { id, titulo, colunas, linhas, totais }.
 * Colunas: { titulo, tipo: 'texto' | 'inteiro' | 'moeda' | 'percentual', largura, alinhar }.
 * Valores de linha seguem a ordem das colunas. totais é opcional (mesma ordem).
 *
 * Carregado no navegador (window.Relatorios) e no Node (module.exports), para os testes.
 */
(function (raiz) {
    'use strict';

    const ROTULOS_PAGAMENTO = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX' };

    function numero(valor) {
        const n = Number(valor);
        return Number.isFinite(n) ? n : 0;
    }

    function arredondar2(valor) {
        return Math.round((numero(valor) + Number.EPSILON) * 100) / 100;
    }

    function escaparHtml(valor) {
        return String(valor == null ? '' : valor)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---------------------------------------------------------------
    // Datas e filtro (dia local, inclusivo)
    // ---------------------------------------------------------------

    /** Dia local no formato YYYY-MM-DD, ou null se a data é inválida. */
    function diaLocal(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    /** Vendas com dia entre inicio e fim (YYYY-MM-DD). Vazio = sem limite. */
    function filtrarVendas(vendas, inicio, fim) {
        return (vendas || []).filter((v) => {
            const dia = diaLocal(v.date);
            if (!dia) return false;
            if (inicio && dia < inicio) return false;
            if (fim && dia > fim) return false;
            return true;
        });
    }

    /** Valor de uma venda: o valor final (com desconto). */
    function valorVenda(v) { return numero(v.valor_final); }
    /** Custo de uma venda. */
    function custoVenda(v) { return numero(v.cost); }

    // ---------------------------------------------------------------
    // Agregações
    // ---------------------------------------------------------------

    /** Vendas agrupadas por dia ou por mês, em ordem crescente de período. */
    function vendasPorPeriodo(vendas, agrupar) {
        const grupos = new Map();
        for (const v of vendas) {
            const dia = diaLocal(v.date);
            if (!dia) continue;
            const chave = agrupar === 'mes' ? dia.slice(0, 7) : dia;
            if (!grupos.has(chave)) grupos.set(chave, { periodo: chave, quantidade: 0, faturamento: 0, custo: 0 });
            const g = grupos.get(chave);
            g.quantidade += 1;
            g.faturamento += valorVenda(v);
            g.custo += custoVenda(v);
        }
        return [...grupos.values()]
            .sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0))
            .map((g) => ({
                periodo: g.periodo,
                quantidade: g.quantidade,
                faturamento: arredondar2(g.faturamento),
                custo: arredondar2(g.custo),
                lucro: arredondar2(g.faturamento - g.custo),
                ticketMedio: arredondar2(g.quantidade > 0 ? g.faturamento / g.quantidade : 0)
            }));
    }

    /**
     * Receita, custo e lucro de cada produto. A receita de cada item recebe a parte do desconto da venda,
     * então a soma bate com o valor final das vendas.
     */
    function lucroPorProduto(vendas) {
        const grupos = new Map();
        for (const v of vendas) {
            const total = numero(v.valor_total);
            const fator = total > 0 ? valorVenda(v) / total : 1;
            for (const item of (v.items || [])) {
                const chave = String(item.id != null ? item.id : item.name);
                if (!grupos.has(chave)) grupos.set(chave, { produto: item.name || chave, quantidade: 0, receita: 0, custo: 0 });
                const g = grupos.get(chave);
                const qtd = numero(item.qty);
                g.quantidade += qtd;
                g.receita += qtd * numero(item.price) * fator;
                g.custo += qtd * numero(item.cost);
            }
        }
        return [...grupos.values()]
            .map((g) => {
                const receita = arredondar2(g.receita);
                const custo = arredondar2(g.custo);
                const lucro = arredondar2(receita - custo);
                return {
                    produto: g.produto,
                    quantidade: g.quantidade,
                    receita: receita,
                    custo: custo,
                    lucro: lucro,
                    margem: receita > 0 ? arredondar2((lucro / receita) * 100) : 0
                };
            })
            .sort((a, b) => b.lucro - a.lucro);
    }

    /** Valor recebido por forma de pagamento. Misto soma cada parcela; troco não entra. */
    function recebimentosPorForma(vendas) {
        const grupos = new Map();
        const somar = (forma, valor, vendaContada) => {
            if (!grupos.has(forma)) grupos.set(forma, { forma: forma, vendas: 0, valor: 0 });
            const g = grupos.get(forma);
            g.valor += valor;
            if (vendaContada) g.vendas += 1;
        };
        for (const v of vendas) {
            if (v.pagamento === 'fiado') {
                // Fiado: conta só o que foi recebido (baixas), na forma em que entrou.
                const formas = new Set();
                for (const r of (Array.isArray(v.recebimentos) ? v.recebimentos : [])) {
                    const forma = String(r.forma || 'N/A');
                    somar(forma, numero(r.valor), !formas.has(forma));
                    formas.add(forma);
                }
            } else if (Array.isArray(v.pagamentos) && v.pagamentos.length) {
                const formas = new Set();
                for (const p of v.pagamentos) {
                    const forma = String(p.forma || 'N/A');
                    somar(forma, numero(p.valor), !formas.has(forma));
                    formas.add(forma);
                }
            } else {
                somar(String(v.pagamento || 'N/A'), valorVenda(v), true);
            }
        }
        const rotulo = (forma) => ROTULOS_PAGAMENTO[forma] || forma;
        return [...grupos.values()]
            .map((g) => ({ forma: rotulo(g.forma), vendas: g.vendas, valor: arredondar2(g.valor) }))
            .sort((a, b) => b.valor - a.valor);
    }

    /** Fiado ainda não recebido nas vendas dadas: quantidade de vendas com saldo e valor em aberto. */
    function fiadoEmAberto(vendas) {
        let vendasAbertas = 0;
        let valor = 0;
        for (const v of vendas) {
            if (v.pagamento !== 'fiado') continue;
            const recebidoVenda = (Array.isArray(v.recebimentos) ? v.recebimentos : []).reduce((acc, r) => acc + numero(r.valor), 0);
            const saldo = arredondar2(Math.max(0, valorVenda(v) - recebidoVenda));
            if (saldo > 0) {
                vendasAbertas += 1;
                valor += saldo;
            }
        }
        return { vendas: vendasAbertas, valor: arredondar2(valor) };
    }

    /** Situação de estoque: sem estoque (<= 0), baixo (< nível baixo), médio (< nível médio) ou OK. */
    function situacaoEstoque(saldo, nivelBaixo, nivelMedio) {
        if (saldo <= 0) return 'Sem estoque';
        if (saldo < nivelBaixo) return 'Baixo';
        if (saldo < nivelMedio) return 'Médio';
        return 'OK';
    }

    /** Saldo e valor parado de cada produto. Ordena do menor saldo para o maior. */
    function estoqueAtual(produtos, nivelBaixo, nivelMedio) {
        return (produtos || [])
            .map((p) => {
                const saldo = numero(p.stock);
                const custo = numero(p.cost);
                return {
                    produto: p.name || String(p.id),
                    saldo: saldo,
                    custo: arredondar2(custo),
                    valorParado: arredondar2(saldo * custo),
                    situacao: situacaoEstoque(saldo, nivelBaixo, nivelMedio)
                };
            })
            .sort((a, b) => a.saldo - b.saldo || (a.produto < b.produto ? -1 : 1));
    }

    /** Produtos mais vendidos por quantidade. */
    function topProdutos(vendas, n) {
        return lucroPorProduto(vendas)
            .sort((a, b) => b.quantidade - a.quantidade || b.receita - a.receita)
            .slice(0, n);
    }

    /** Nomes de produtos sem estoque e com estoque baixo (para o painel de alertas). */
    function alertasEstoque(produtos, nivelBaixo, nivelMedio) {
        const sem = [];
        const baixo = [];
        for (const p of (produtos || [])) {
            const saldo = numero(p.stock);
            const nome = p.name || String(p.id);
            if (saldo <= 0) sem.push({ produto: nome, saldo: saldo });
            else if (saldo < nivelBaixo) baixo.push({ produto: nome, saldo: saldo });
        }
        sem.sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR'));
        baixo.sort((a, b) => a.saldo - b.saldo);
        return { semEstoque: sem, estoqueBaixo: baixo };
    }

    // ---------------------------------------------------------------
    // Seções (o que cada relatório mostra)
    // ---------------------------------------------------------------

    function secaoVendasPorPeriodo(vendas, agrupar) {
        const linhas = vendasPorPeriodo(vendas, agrupar);
        const total = linhas.reduce((acc, l) => ({
            quantidade: acc.quantidade + l.quantidade,
            faturamento: acc.faturamento + l.faturamento,
            custo: acc.custo + l.custo
        }), { quantidade: 0, faturamento: 0, custo: 0 });
        const faturamento = arredondar2(total.faturamento);
        const custo = arredondar2(total.custo);
        return {
            id: 'vendas',
            titulo: 'Vendas por ' + (agrupar === 'mes' ? 'mês' : 'dia'),
            colunas: [
                { titulo: agrupar === 'mes' ? 'Mês' : 'Dia', tipo: 'texto', largura: 2 },
                { titulo: 'Vendas', tipo: 'inteiro', largura: 1, alinhar: 'direita' },
                { titulo: 'Faturamento', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Custo', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Lucro', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Ticket médio', tipo: 'moeda', largura: 2, alinhar: 'direita' }
            ],
            linhas: linhas.map((l) => [formatarPeriodo(l.periodo, agrupar), l.quantidade, l.faturamento, l.custo, l.lucro, l.ticketMedio]),
            totais: ['TOTAL', total.quantidade, faturamento, custo, arredondar2(faturamento - custo),
                total.quantidade > 0 ? arredondar2(faturamento / total.quantidade) : 0]
        };
    }

    function formatarPeriodo(periodo, agrupar) {
        const [a, m, d] = periodo.split('-');
        return agrupar === 'mes' ? m + '/' + a : d + '/' + m + '/' + a;
    }

    function secaoLucroPorProduto(vendas) {
        const linhas = lucroPorProduto(vendas);
        const receita = arredondar2(linhas.reduce((acc, l) => acc + l.receita, 0));
        const custo = arredondar2(linhas.reduce((acc, l) => acc + l.custo, 0));
        const quantidade = linhas.reduce((acc, l) => acc + l.quantidade, 0);
        return {
            id: 'lucro',
            titulo: 'Lucro por produto',
            colunas: [
                { titulo: 'Produto', tipo: 'texto', largura: 4 },
                { titulo: 'Qtd', tipo: 'inteiro', largura: 1, alinhar: 'direita' },
                { titulo: 'Receita', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Custo', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Lucro', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Margem %', tipo: 'percentual', largura: 1.2, alinhar: 'direita' }
            ],
            linhas: linhas.map((l) => [l.produto, l.quantidade, l.receita, l.custo, l.lucro, l.margem]),
            totais: ['TOTAL', quantidade, receita, custo, arredondar2(receita - custo),
                receita > 0 ? arredondar2(((receita - custo) / receita) * 100) : 0]
        };
    }

    function secaoEstoqueAtual(produtos, nivelBaixo, nivelMedio) {
        const linhas = estoqueAtual(produtos, nivelBaixo, nivelMedio);
        const valorTotal = arredondar2(linhas.reduce((acc, l) => acc + l.valorParado, 0));
        const unidades = linhas.reduce((acc, l) => acc + l.saldo, 0);
        return {
            id: 'estoque',
            titulo: 'Estoque atual',
            colunas: [
                { titulo: 'Produto', tipo: 'texto', largura: 4 },
                { titulo: 'Saldo', tipo: 'inteiro', largura: 1, alinhar: 'direita' },
                { titulo: 'Custo', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Valor parado', tipo: 'moeda', largura: 2, alinhar: 'direita' },
                { titulo: 'Situação', tipo: 'texto', largura: 2 }
            ],
            linhas: linhas.map((l) => [l.produto, l.saldo, l.custo, l.valorParado, l.situacao]),
            totais: ['TOTAL', unidades, '', valorTotal, linhas.length + ' produtos']
        };
    }

    function secaoRecebimentos(vendas) {
        const linhas = recebimentosPorForma(vendas);
        const valor = arredondar2(linhas.reduce((acc, l) => acc + l.valor, 0));
        const aberto = fiadoEmAberto(vendas);
        const linhasSecao = linhas.map((l) => [l.forma, l.vendas, l.valor]);
        if (aberto.valor > 0) {
            linhasSecao.push(['Fiado em aberto (ainda não recebido, fora do total)', aberto.vendas, aberto.valor]);
        }
        return {
            id: 'pagamentos',
            titulo: 'Recebimentos por forma de pagamento',
            colunas: [
                { titulo: 'Forma', tipo: 'texto', largura: 3 },
                { titulo: 'Vendas', tipo: 'inteiro', largura: 1, alinhar: 'direita' },
                { titulo: 'Valor recebido', tipo: 'moeda', largura: 2, alinhar: 'direita' }
            ],
            linhas: linhasSecao,
            totais: ['TOTAL', linhas.reduce((acc, l) => acc + l.vendas, 0), valor]
        };
    }

    // ---------------------------------------------------------------
    // Formatação
    // ---------------------------------------------------------------

    /** Texto de um valor para exibição (PDF): R$ e separador de milhar do pt-BR. */
    function formatarTela(valor, tipo) {
        if (tipo === 'texto' || typeof valor === 'string') return String(valor == null ? '' : valor);
        const n = numero(valor);
        if (tipo === 'inteiro') return String(Math.round(n));
        const numeroPt = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (tipo === 'percentual') return numeroPt + '%';
        return 'R$ ' + numeroPt;
    }

    // ---------------------------------------------------------------
    // XLSX (Excel): um arquivo com uma aba por relatório, gerado aqui sem bibliotecas.
    // Um .xlsx é um ZIP de arquivos XML. O ZIP vai sem compressão (método 0), o que é válido.
    // ---------------------------------------------------------------

    const TABELA_CRC = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function utf8(s) { return new TextEncoder().encode(s); }

    function concatenar(partes) {
        const total = partes.reduce((a, p) => a + p.length, 0);
        const out = new Uint8Array(total);
        let pos = 0;
        for (const p of partes) { out.set(p, pos); pos += p.length; }
        return out;
    }

    const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
    const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

    /** Monta um ZIP (sem compressão). arquivos: [{ nome, dados: Uint8Array }]. */
    function zip(arquivos) {
        const locais = [];
        const centrais = [];
        let offset = 0;
        for (const a of arquivos) {
            const nome = utf8(a.nome);
            const dados = a.dados;
            const crc = crc32(dados);
            const cabecalho = new Uint8Array([
                ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
                ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(nome.length), ...u16(0)
            ]);
            locais.push(cabecalho, nome, dados);
            centrais.push(new Uint8Array([
                ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
                ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(nome.length), ...u16(0), ...u16(0),
                ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
            ]), nome);
            offset += cabecalho.length + nome.length + dados.length;
        }
        const cd = concatenar(centrais);
        const fim = new Uint8Array([
            ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.length), ...u16(arquivos.length),
            ...u32(cd.length), ...u32(offset), ...u16(0)
        ]);
        return concatenar([...locais, cd, fim]);
    }

    function escaparXml(valor) {
        return String(valor == null ? '' : valor)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
            // Caracteres de controle não são aceitos em XML 1.0.
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    }

    /** Letra da coluna: 0 = A, 25 = Z, 26 = AA. */
    function letraColuna(i) {
        let s = '';
        let n = i + 1;
        while (n > 0) {
            const r = (n - 1) % 26;
            s = String.fromCharCode(65 + r) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    // Estilos (índices usados nas células): 0 normal, 1 cabeçalho, 2 moeda, 3 inteiro, 4 percentual,
    // 5 texto em negrito, 6 moeda em negrito, 7 inteiro em negrito, 8 percentual em negrito, 9 título.
    const ESTILOS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="2">' +
        '<numFmt numFmtId="164" formatCode="&quot;R$ &quot;#,##0.00"/>' +
        '<numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/>' +
        '</numFmts>' +
        '<fonts count="3">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
        '</fonts>' +
        '<fills count="3">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF4070F4"/><bgColor indexed="64"/></patternFill></fill>' +
        '</fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="10">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
        '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
        '<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>';

    /** Estilo de uma coluna, conforme o tipo. Em negrito (totais) soma 5. */
    function estiloTipo(tipo, negrito) {
        const base = { moeda: 2, inteiro: 3, percentual: 4 }[tipo];
        if (base === undefined) return negrito ? 5 : 0;
        return negrito ? base + 4 : base;
    }

    function celulaXml(ref, valor, tipo, estilo) {
        if (tipo === 'texto' || typeof valor === 'string' || valor == null) {
            return '<c r="' + ref + '" t="inlineStr" s="' + estilo + '"><is><t xml:space="preserve">' +
                escaparXml(valor == null ? '' : valor) + '</t></is></c>';
        }
        return '<c r="' + ref + '" s="' + estilo + '"><v>' + numero(valor) + '</v></c>';
    }

    /** Nome de aba válido: sem []:*?/\ , até 31 caracteres, sem repetir. */
    function nomeAba(titulo, usados) {
        const base = String(titulo || 'Planilha').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Planilha';
        let nome = base;
        let n = 2;
        while (usados.has(nome.toLowerCase())) {
            const sufixo = ' (' + n++ + ')';
            nome = base.slice(0, 31 - sufixo.length) + sufixo;
        }
        usados.add(nome.toLowerCase());
        return nome;
    }

    /** Aba de resumo: empresa, período e data de geração (vem de cabecalho, se houver). */
    function abaResumo(cabecalho) {
        const linhas = [];
        if (!cabecalho) return linhas;
        const c = cabecalho;
        const textos = [
            { t: c.empresa || '', e: 9 }, { t: c.titulo || 'Relatórios', e: 9 },
            { t: c.periodo || '', e: 0 }, { t: c.geradoEm || '', e: 0 }
        ];
        textos.forEach((x, i) => {
            if (x.t) linhas.push('<row r="' + (i + 1) + '">' + celulaXml('A' + (i + 1), x.t, 'texto', x.e) + '</row>');
        });
        return linhas;
    }

    /** Aba de um relatório: cabeçalho em destaque, linhas, totais em negrito. */
    function xmlAba(secao) {
        const colunas = secao.colunas || [];
        const larguras = colunas.map((c) => Math.max(12, Math.round((c.largura || 1) * 9)));
        const linhas = [];
        const linhaXml = (r, cells) => '<row r="' + r + '">' + cells.join('') + '</row>';
        const ref = (c, r) => letraColuna(c) + r;

        linhas.push(linhaXml(1, colunas.map((c, i) => celulaXml(ref(i, 1), c.titulo, 'texto', 1))));
        let r = 2;
        if (!secao.linhas || secao.linhas.length === 0) {
            linhas.push(linhaXml(r, [celulaXml('A' + r, 'Nenhum registro no período.', 'texto', 0)]));
            r++;
        }
        for (const registro of (secao.linhas || [])) {
            linhas.push(linhaXml(r, registro.map((v, i) => celulaXml(ref(i, r), v, colunas[i].tipo, estiloTipo(colunas[i].tipo, false)))));
            r++;
        }
        if (secao.totais) {
            linhas.push(linhaXml(r, secao.totais.map((v, i) => celulaXml(ref(i, r), v, colunas[i].tipo, estiloTipo(colunas[i].tipo, true)))));
        }
        const colsXml = '<cols>' + larguras.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
            colsXml + '<sheetData>' + linhas.join('') + '</sheetData></worksheet>';
    }

    /**
     * Planilha .xlsx com uma aba por seção (e uma aba de resumo, se houver cabecalho).
     * Devolve os bytes do arquivo.
     */
    function xlsx(secoes, cabecalho) {
        const abas = [];
        const usados = new Set();
        const resumo = abaResumo(cabecalho);
        if (resumo.length) {
            abas.push({ nome: nomeAba('Resumo', usados), xml: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="60" customWidth="1"/></cols>' +
                '<sheetData>' + resumo.join('') + '</sheetData></worksheet>' });
        }
        for (const secao of (secoes || [])) {
            abas.push({ nome: nomeAba(secao.titulo, usados), xml: xmlAba(secao) });
        }
        if (abas.length === 0) abas.push({ nome: 'Planilha', xml: xmlAba({ colunas: [], linhas: [] }) });

        const ns = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
        const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' + ns + '><sheets>' +
            abas.map((a, i) => '<sheet name="' + escaparXml(a.nome) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
            '</sheets></workbook>';
        const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            abas.map((a, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
            '<Relationship Id="rId' + (abas.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
            '</Relationships>';
        const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
            abas.map((a, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            '</Types>';
        const raiz = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '</Relationships>';

        const arquivos = [
            { nome: '[Content_Types].xml', dados: utf8(tipos) },
            { nome: '_rels/.rels', dados: utf8(raiz) },
            { nome: 'xl/workbook.xml', dados: utf8(workbook) },
            { nome: 'xl/_rels/workbook.xml.rels', dados: utf8(rels) },
            { nome: 'xl/styles.xml', dados: utf8(ESTILOS_XML) }
        ];
        abas.forEach((a, i) => arquivos.push({ nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', dados: utf8(a.xml) }));
        return zip(arquivos);
    }

    // ---------------------------------------------------------------
    // PDF (gerado aqui, sem bibliotecas: texto em Helvetica, uma ou mais páginas A4)
    // ---------------------------------------------------------------

    const LARGURA_PAGINA = 595;
    const ALTURA_PAGINA = 842;
    const MARGEM = 36;
    const CONTEUDO = LARGURA_PAGINA - 2 * MARGEM;

    // Caracteres comuns que o WinAnsi tem fora da faixa Latin-1 (0x80 a 0x9F).
    const WINANSI_EXTRA = {
        '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
        'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
        '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F
    };

    /** Texto em WinAnsi (um caractere por byte). Quebras e controles viram espaço; o resto fora da tabela vira '?'. */
    function codificarTexto(s) {
        let saida = '';
        for (const ch of String(s)) {
            const c = ch.codePointAt(0);
            if (c < 0x20) saida += ' ';
            else if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) saida += ch;
            else if (WINANSI_EXTRA[ch] !== undefined) saida += String.fromCharCode(WINANSI_EXTRA[ch]);
            else saida += '?';
        }
        return saida;
    }

    function escaparPdf(s) {
        return codificarTexto(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    }

    function larguraTexto(s, tamanho, negrito) {
        return String(s).length * tamanho * (negrito ? 0.56 : 0.5);
    }

    function cortar(s, largura, tamanho) {
        const max = Math.max(1, Math.floor((largura - 6) / (tamanho * 0.5)));
        const t = String(s);
        return t.length <= max ? t : t.slice(0, Math.max(1, max - 3)) + '...';
    }

    /**
     * Monta o PDF. cabecalho = { titulo, empresa, periodo, geradoEm }.
     * Devolve Uint8Array pronto para virar Blob.
     */
    function pdf(cabecalho, secoes) {
        const paginas = [];
        let pag = null;
        let y = 0;

        function novaPagina() {
            pag = { ops: [] };
            paginas.push(pag);
            const titulo = (cabecalho && cabecalho.titulo) || 'Relatórios';
            escrever(MARGEM, ALTURA_PAGINA - MARGEM, 8, false, titulo);
            escrever(LARGURA_PAGINA - MARGEM - larguraTexto('Página ' + paginas.length, 8, false), ALTURA_PAGINA - MARGEM, 8, false, 'Página ' + paginas.length);
            y = ALTURA_PAGINA - MARGEM - 26;
        }

        function escrever(x, yy, tamanho, negrito, s) {
            pag.ops.push('BT /' + (negrito ? 'F2' : 'F1') + ' ' + tamanho + ' Tf ' + x.toFixed(1) + ' ' + yy.toFixed(1) +
                ' Td (' + escaparPdf(s) + ') Tj ET');
        }

        function linha(x1, y1, x2) {
            pag.ops.push('0.6 w 0.7 G ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' m ' + x2.toFixed(1) + ' ' + y1.toFixed(1) + ' l S 0 G');
        }

        function faixa(yy, altura) {
            pag.ops.push('0.92 g ' + MARGEM + ' ' + (yy - 3).toFixed(1) + ' ' + CONTEUDO + ' ' + altura.toFixed(1) + ' re f 0 g');
        }

        function garantir(altura) {
            if (pag === null || y - altura < MARGEM + 16) novaPagina();
        }

        // Cabeçalho do documento (primeira página)
        novaPagina();
        const capa = [
            { t: (cabecalho && cabecalho.empresa) || '', n: 14, b: true },
            { t: (cabecalho && cabecalho.titulo) || 'Relatórios', n: 12, b: true },
            { t: (cabecalho && cabecalho.periodo) || '', n: 9, b: false },
            { t: (cabecalho && cabecalho.geradoEm) || '', n: 8, b: false }
        ];
        for (const c of capa) {
            if (!c.t) continue;
            escrever(MARGEM, y, c.n, c.b, c.t);
            y -= c.n + 6;
        }
        y -= 6;

        for (const secao of secoes) {
            garantir(70);
            escrever(MARGEM, y, 11, true, secao.titulo);
            y -= 18;

            if (!secao.linhas.length) {
                garantir(16);
                escrever(MARGEM, y, 9, false, 'Nenhum registro no período.');
                y -= 24;
                continue;
            }

            const pesos = secao.colunas.map((c) => c.largura || 1);
            const soma = pesos.reduce((a, b) => a + b, 0);
            const larguras = pesos.map((p) => (p / soma) * CONTEUDO);
            const posX = [];
            larguras.reduce((x, l) => { posX.push(x); return x + l; }, MARGEM);

            const desenharLinha = (valores, negrito, tamanho) => {
                valores.forEach((v, i) => {
                    const col = secao.colunas[i];
                    const texto = cortar(formatarTela(v, col.tipo), larguras[i], tamanho);
                    const x = col.alinhar === 'direita'
                        ? posX[i] + larguras[i] - 3 - larguraTexto(texto, tamanho, negrito)
                        : posX[i] + 3;
                    escrever(x, y, tamanho, negrito, texto);
                });
            };

            garantir(30);
            faixa(y, 13);
            desenharLinha(secao.colunas.map((c) => c.titulo), true, 8);
            y -= 13;
            linha(MARGEM, y + 9, MARGEM + CONTEUDO);

            for (const registro of secao.linhas) {
                garantir(14);
                desenharLinha(registro, false, 8);
                y -= 12;
            }

            if (secao.totais) {
                garantir(18);
                linha(MARGEM, y + 9, MARGEM + CONTEUDO);
                y -= 3;
                desenharLinha(secao.totais, true, 8);
                y -= 13;
            }
            y -= 14;
        }

        return montarArquivo(paginas);
    }

    function montarArquivo(paginas) {
        // Objetos: 1 catálogo, 2 páginas, 3 fonte normal, 4 fonte negrito, depois página e conteúdo de cada página.
        const objetos = [];
        const n = paginas.length;
        const idPagina = (i) => 5 + i * 2;
        const idConteudo = (i) => 6 + i * 2;

        objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objetos[2] = '<< /Type /Pages /Kids [' + paginas.map((_, i) => idPagina(i) + ' 0 R').join(' ') + '] /Count ' + n + ' >>';
        objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        paginas.forEach((p, i) => {
            objetos[idPagina(i)] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + LARGURA_PAGINA + ' ' + ALTURA_PAGINA + '] ' +
                '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + idConteudo(i) + ' 0 R >>';
            const conteudo = p.ops.join('\n');
            objetos[idConteudo(i)] = '<< /Length ' + conteudo.length + ' >>\nstream\n' + conteudo + '\nendstream';
        });

        let texto = '%PDF-1.4\n';
        const posicoes = [];
        for (let id = 1; id < objetos.length; id++) {
            posicoes[id] = texto.length;
            texto += id + ' 0 obj\n' + objetos[id] + '\nendobj\n';
        }
        const inicioXref = texto.length;
        const total = objetos.length; // ids de 1 a total-1, mais o 0 livre
        texto += 'xref\n0 ' + total + '\n';
        texto += '0000000000 65535 f \n';
        for (let id = 1; id < total; id++) {
            texto += String(posicoes[id]).padStart(10, '0') + ' 00000 n \n';
        }
        texto += 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + inicioXref + '\n%%EOF\n';

        // Cada caractere vira um byte (texto já está em Latin-1).
        const bytes = new Uint8Array(texto.length);
        for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i) & 0xFF;
        return bytes;
    }

    const API = {
        diaLocal, filtrarVendas, vendasPorPeriodo, lucroPorProduto, recebimentosPorForma,
        situacaoEstoque, estoqueAtual, topProdutos, alertasEstoque,
        secaoVendasPorPeriodo, secaoLucroPorProduto, secaoEstoqueAtual, secaoRecebimentos,
        formatarTela, pdf, xlsx, zip, crc32, escaparHtml
    };

    raiz.Relatorios = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
