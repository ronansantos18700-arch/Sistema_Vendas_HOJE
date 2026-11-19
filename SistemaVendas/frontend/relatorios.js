/*
 * Relatórios (lógica pura, sem DOM): agregação, CSV e PDF.
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
            if (Array.isArray(v.pagamentos) && v.pagamentos.length) {
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
        return {
            id: 'pagamentos',
            titulo: 'Recebimentos por forma de pagamento',
            colunas: [
                { titulo: 'Forma', tipo: 'texto', largura: 3 },
                { titulo: 'Vendas', tipo: 'inteiro', largura: 1, alinhar: 'direita' },
                { titulo: 'Valor recebido', tipo: 'moeda', largura: 2, alinhar: 'direita' }
            ],
            linhas: linhas.map((l) => [l.forma, l.vendas, l.valor]),
            totais: ['TOTAL', linhas.reduce((acc, l) => acc + l.vendas, 0), valor]
        };
    }

    // ---------------------------------------------------------------
    // Formatação
    // ---------------------------------------------------------------

    /** Texto de um valor para CSV: número com vírgula decimal (Excel em português), sem separador de milhar. */
    function formatarCsv(valor, tipo) {
        if (tipo === 'texto' || typeof valor === 'string') return String(valor == null ? '' : valor);
        const n = numero(valor);
        if (tipo === 'inteiro') return String(Math.round(n));
        return n.toFixed(2).replace('.', ',');
    }

    /** Texto de um valor para exibição (PDF): R$ e separador de milhar do pt-BR. */
    function formatarTela(valor, tipo) {
        if (tipo === 'texto' || typeof valor === 'string') return String(valor == null ? '' : valor);
        const n = numero(valor);
        if (tipo === 'inteiro') return String(Math.round(n));
        const numeroPt = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (tipo === 'percentual') return numeroPt + '%';
        return 'R$ ' + numeroPt;
    }

    function celulaCsv(valor) {
        const s = String(valor);
        return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    /** CSV de uma seção. UTF-8 com BOM e ponto e vírgula, para abrir direto no Excel em português. */
    function csv(secao) {
        const linhas = [secao.colunas.map((c) => c.titulo)];
        for (const linha of secao.linhas) {
            linhas.push(linha.map((v, i) => formatarCsv(v, secao.colunas[i].tipo)));
        }
        if (secao.totais) {
            linhas.push(secao.totais.map((v, i) => formatarCsv(v, secao.colunas[i].tipo)));
        }
        return '\uFEFF' + linhas.map((l) => l.map(celulaCsv).join(';')).join('\r\n') + '\r\n';
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
        formatarCsv, formatarTela, csv, pdf, escaparHtml
    };

    raiz.Relatorios = API;
    if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
