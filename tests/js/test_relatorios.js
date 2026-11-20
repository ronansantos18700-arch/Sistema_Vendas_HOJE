// Relatórios (SistemaVendas/frontend/relatorios.js): agregações, CSV e estrutura do PDF.
// Uso: node tests/js/test_relatorios.js
const assert = require('assert');
const path = require('path');
const R = require(path.join(__dirname, '../../SistemaVendas/frontend/relatorios.js'));

const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);

const vendas = () => [
  { id: 'V1', date: '2026-11-18T14:00:00', valor_total: 16, desconto: 0, valor_final: 16, cost: 10, pagamento: 'dinheiro',
    items: [{ id: 'P1', name: 'Arroz', qty: 2, price: 8, cost: 5 }] },
  { id: 'V2', date: '2026-11-19T10:00:00', valor_total: 20, desconto: 2, valor_final: 18, cost: 12, pagamento: 'misto',
    pagamentos: [{ forma: 'pix', valor: 10 }, { forma: 'dinheiro', valor: 8 }],
    items: [{ id: 'P1', name: 'Arroz', qty: 1, price: 8, cost: 5 }, { id: 'P2', name: 'Feijão', qty: 2, price: 6, cost: 3.5 }] }
];

teste('filtro por dia é inclusivo e sem limite quando vazio', () => {
  const v = vendas();
  assert.strictEqual(R.filtrarVendas(v, '', '').length, 2);
  assert.deepStrictEqual(R.filtrarVendas(v, '2026-11-19', '2026-11-19').map(x => x.id), ['V2']);
  assert.deepStrictEqual(R.filtrarVendas(v, '2026-11-18', '').map(x => x.id), ['V1', 'V2']);
  assert.deepStrictEqual(R.filtrarVendas(v, '', '2026-11-18').map(x => x.id), ['V1']);
});

teste('data inválida fica de fora do filtro', () => {
  assert.strictEqual(R.filtrarVendas([{ id: 'X', date: 'nao-e-data' }], '', '').length, 0);
});

teste('vendas por dia: quantidade, faturamento, custo, lucro e ticket', () => {
  const linhas = R.vendasPorPeriodo(vendas(), 'dia');
  assert.deepStrictEqual(linhas.map(l => l.periodo), ['2026-11-18', '2026-11-19']);
  assert.deepStrictEqual(linhas[1], { periodo: '2026-11-19', quantidade: 1, faturamento: 18, custo: 12, lucro: 6, ticketMedio: 18 });
});

teste('vendas por mês agrupa os dias do mesmo mês', () => {
  const linhas = R.vendasPorPeriodo(vendas(), 'mes');
  assert.strictEqual(linhas.length, 1);
  assert.strictEqual(linhas[0].quantidade, 2);
  assert.strictEqual(linhas[0].faturamento, 34);
});

teste('lucro por produto reparte o desconto da venda e bate com o valor final', () => {
  const linhas = R.lucroPorProduto(vendas());
  const arroz = linhas.find(l => l.produto === 'Arroz');
  const feijao = linhas.find(l => l.produto === 'Feijão');
  // Arroz: 2x8 na V1 + 1x8 com 10% de desconto na V2 = 16 + 7,20
  assert.strictEqual(arroz.receita, 23.2);
  assert.strictEqual(arroz.custo, 15);
  assert.strictEqual(arroz.quantidade, 3);
  assert.strictEqual(feijao.receita, 10.8);
  const receitaTotal = linhas.reduce((a, l) => a + l.receita, 0);
  assert.ok(Math.abs(receitaTotal - 34) < 0.001, 'soma das receitas = valor final das vendas');
});

teste('lucro por produto ordena do maior lucro para o menor', () => {
  const linhas = R.lucroPorProduto(vendas());
  assert.ok(linhas[0].lucro >= linhas[1].lucro);
});

teste('recebimentos: misto soma cada parcela, troco não entra', () => {
  const v = vendas();
  v[1].troco = 5; // troco não é recebimento
  const linhas = R.recebimentosPorForma(v);
  const dinheiro = linhas.find(l => l.forma === 'Dinheiro');
  const pix = linhas.find(l => l.forma === 'PIX');
  assert.deepStrictEqual([dinheiro.valor, dinheiro.vendas], [24, 2]);
  assert.deepStrictEqual([pix.valor, pix.vendas], [10, 1]);
});

teste('situação de estoque segue os níveis do app', () => {
  assert.strictEqual(R.situacaoEstoque(0, 10, 25), 'Sem estoque');
  assert.strictEqual(R.situacaoEstoque(-1, 10, 25), 'Sem estoque');
  assert.strictEqual(R.situacaoEstoque(9, 10, 25), 'Baixo');
  assert.strictEqual(R.situacaoEstoque(10, 10, 25), 'Médio');
  assert.strictEqual(R.situacaoEstoque(25, 10, 25), 'OK');
});

teste('estoque atual: valor parado e ordenação do menor saldo', () => {
  const produtos = [
    { id: 'A', name: 'Zebra', stock: 40, cost: 2 },
    { id: 'B', name: 'Arroz', stock: 0, cost: 5 },
    { id: 'C', name: 'Feijão', stock: 3, cost: 4.5 }
  ];
  const linhas = R.estoqueAtual(produtos, 10, 25);
  assert.deepStrictEqual(linhas.map(l => l.produto), ['Arroz', 'Feijão', 'Zebra']);
  assert.strictEqual(linhas[1].valorParado, 13.5);
  assert.strictEqual(linhas[1].situacao, 'Baixo');
  assert.strictEqual(linhas[0].situacao, 'Sem estoque');
});

teste('alertas separam sem estoque e estoque baixo', () => {
  const produtos = [
    { id: 'A', name: 'Arroz', stock: 0 },
    { id: 'B', name: 'Feijão', stock: 4 },
    { id: 'C', name: 'Sal', stock: 30 }
  ];
  const a = R.alertasEstoque(produtos, 10, 25);
  assert.deepStrictEqual(a.semEstoque.map(x => x.produto), ['Arroz']);
  assert.deepStrictEqual(a.estoqueBaixo.map(x => x.produto), ['Feijão']);
});

teste('top produtos por quantidade', () => {
  const top = R.topProdutos(vendas(), 1);
  assert.strictEqual(top.length, 1);
  assert.strictEqual(top[0].produto, 'Arroz');
});

// Lê um ZIP sem compressão (o que o R.xlsx gera) e devolve { nome: { crc, dados } }.
function lerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  assert.ok(eocd >= 0, 'fim do ZIP (EOCD) encontrado');
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const arquivos = {};
  for (let k = 0; k < total; k++) {
    assert.strictEqual(dv.getUint32(p, true), 0x02014b50, 'entrada do diretório central');
    const crc = dv.getUint32(p + 16, true);
    const tamanho = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const nome = Buffer.from(bytes.subarray(p + 46, p + 46 + nl)).toString('utf8');
    assert.strictEqual(dv.getUint32(off, true), 0x04034b50, 'cabeçalho local de ' + nome);
    const ln = dv.getUint16(off + 26, true), lx = dv.getUint16(off + 28, true);
    const inicio = off + 30 + ln + lx;
    arquivos[nome] = { crc, dados: bytes.subarray(inicio, inicio + tamanho) };
    p += 46 + nl + xl + cl;
  }
  return arquivos;
}

teste('CRC-32 de referência (123456789 → CBF43926)', () => {
  assert.strictEqual(R.crc32(Buffer.from('123456789')).toString(16).toUpperCase(), 'CBF43926');
});

teste('XLSX: ZIP com as partes obrigatórias do Excel', () => {
  const zip = lerZip(R.xlsx([{ titulo: 'Vendas', colunas: [{ titulo: 'A', tipo: 'texto' }], linhas: [['x']] }]));
  for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
    assert.ok(zip[parte], 'falta ' + parte);
  }
});

teste('XLSX: CRC de cada parte confere com o conteúdo', () => {
  const zip = lerZip(R.xlsx(secoesXlsx(), { empresa: 'Loja' }));
  for (const [nome, a] of Object.entries(zip)) {
    assert.strictEqual(R.crc32(a.dados), a.crc, 'CRC de ' + nome);
  }
});

teste('XLSX: uma aba por relatório, mais o resumo quando há cabeçalho', () => {
  const comResumo = lerZip(R.xlsx(secoesXlsx(), { empresa: 'Loja', periodo: 'Período: 01/11/2026 a 20/11/2026' }));
  const wb = Buffer.from(comResumo['xl/workbook.xml'].dados).toString('utf8');
  assert.ok(wb.includes('name="Resumo"') && wb.includes('name="Vendas por dia"') && wb.includes('name="Estoque atual"'), wb);
  const semResumo = lerZip(R.xlsx(secoesXlsx()));
  const wb2 = Buffer.from(semResumo['xl/workbook.xml'].dados).toString('utf8');
  assert.ok(!wb2.includes('name="Resumo"'), 'sem cabeçalho, sem aba de resumo');
});

teste('XLSX: números viram células numéricas; texto é escapado', () => {
  const zip = lerZip(R.xlsx([{ titulo: 'Dados', colunas: [{ titulo: 'Nome', tipo: 'texto' }, { titulo: 'Valor', tipo: 'moeda' }, { titulo: 'Qtd', tipo: 'inteiro' }],
    linhas: [['Arroz & <feijão>', 1234.5, 3]] }]));
  const xml = Buffer.from(zip['xl/worksheets/sheet1.xml'].dados).toString('utf8');
  assert.ok(xml.includes('<v>1234.5</v>'), 'valor numérico');
  assert.ok(xml.includes('<v>3</v>'), 'inteiro');
  assert.ok(xml.includes('Arroz &amp; &lt;feijão&gt;'), 'texto escapado: ' + xml);
  assert.ok(!xml.includes('<feijão>'), 'sem XML vindo do texto');
});

teste('XLSX: nome de aba sem caracteres proibidos, até 31 letras e sem repetir', () => {
  const zip = lerZip(R.xlsx([
    { titulo: 'Vendas: por dia / mês [teste] com nome muito comprido', colunas: [], linhas: [] },
    { titulo: 'Vendas: por dia / mês [teste] com nome muito comprido', colunas: [], linhas: [] }
  ]));
  const wb = Buffer.from(zip['xl/workbook.xml'].dados).toString('utf8');
  const nomes = [...wb.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(nomes.length, 2);
  for (const n of nomes) {
    assert.ok(n.length <= 31, 'até 31 caracteres: ' + n);
    assert.ok(!/[\[\]:*?\/\\]/.test(n), 'sem caractere proibido: ' + n);
  }
  assert.notStrictEqual(nomes[0].toLowerCase(), nomes[1].toLowerCase(), 'nomes distintos');
});

teste('XLSX: seção sem registros avisa, e totais vão em negrito', () => {
  const zip = lerZip(R.xlsx([{ titulo: 'Vazio', colunas: [{ titulo: 'P', tipo: 'texto' }, { titulo: 'V', tipo: 'moeda' }], linhas: [], totais: ['TOTAL', 0] }]));
  const xml = Buffer.from(zip['xl/worksheets/sheet1.xml'].dados).toString('utf8');
  assert.ok(xml.includes('Nenhum registro no período.'));
  assert.ok(xml.includes('s="6"'), 'total em moeda com negrito');
});

function secoesXlsx() {
  return [
    R.secaoVendasPorPeriodo(R.filtrarVendas(vendas(), '', ''), 'dia'),
    R.secaoEstoqueAtual([{ id: 'P1', name: 'Arroz', stock: 4, cost: 5 }], 10, 25)
  ];
}

teste('formatação na tela: pt-BR com R$ e percentual', () => {
  assert.strictEqual(R.formatarTela(1234.5, 'moeda'), 'R$ 1.234,50');
  assert.strictEqual(R.formatarTela(12.3, 'percentual'), '12,30%');
  assert.strictEqual(R.formatarTela(7, 'inteiro'), '7');
});

teste('escape de HTML para listas do dashboard', () => {
  assert.strictEqual(R.escaparHtml('<b>"A" & \'B\'</b>'), '&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
});

// --- PDF: estrutura e xref ---

function pdfTexto(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

teste('PDF começa com cabeçalho e termina com %%EOF', () => {
  const t = pdfTexto(R.pdf({ titulo: 'Relatórios' }, [R.secaoVendasPorPeriodo(vendas(), 'dia')]));
  assert.ok(t.startsWith('%PDF-1.4'));
  assert.ok(t.trimEnd().endsWith('%%EOF'));
});

teste('PDF: cada entrada do xref aponta para o objeto correto', () => {
  const t = pdfTexto(R.pdf({ titulo: 'Relatórios' }, [R.secaoLucroPorProduto(vendas()), R.secaoRecebimentos(vendas())]));
  const inicio = Number(t.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.strictEqual(t.slice(inicio, inicio + 4), 'xref', 'startxref aponta para xref');
  const linhasXref = t.slice(inicio).split('\n');
  const [, , qtd] = linhasXref[1].split(' '); // "0 N"
  const total = Number(qtd);
  for (let id = 1; id < total; id++) {
    const off = Number(linhasXref[2 + id].slice(0, 10));
    assert.strictEqual(t.slice(off, off + String(id).length + 6), id + ' 0 obj\n', 'objeto ' + id);
  }
  assert.strictEqual(linhasXref[2].length, 19, 'entrada do xref tem 20 bytes com quebra');
});

teste('PDF: /Length confere com o tamanho do conteúdo', () => {
  const t = pdfTexto(R.pdf({ titulo: 'Relatórios' }, [R.secaoEstoqueAtual([{ id: 'A', name: 'Arroz', stock: 3, cost: 2 }], 10, 25)]));
  const re = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let m; let achou = 0;
  while ((m = re.exec(t))) {
    achou++;
    assert.strictEqual(Number(m[1]), m[2].length);
  }
  assert.ok(achou >= 1);
});

teste('PDF: contagem de páginas e texto do relatório aparecem', () => {
  const t = pdfTexto(R.pdf({ titulo: 'Relatórios', empresa: 'Loja (Teste)' }, [R.secaoRecebimentos(vendas())]));
  assert.ok(/\/Count 1 /.test(t));
  assert.ok(t.includes('Loja \\(Teste\\)'), 'parênteses escapados');
  assert.ok(t.includes('Recebimentos por forma de pagamento'));
  assert.ok(t.includes('PIX'));
});

teste('PDF: seção sem registros mostra aviso em vez de tabela vazia', () => {
  const t = pdfTexto(R.pdf({ titulo: 'Relatórios' }, [R.secaoVendasPorPeriodo([], 'dia')]));
  assert.ok(t.includes('Nenhum registro no período.'));
});

teste('PDF: muitas linhas quebram em nova página', () => {
  const muitos = Array.from({ length: 120 }, (_, i) => ({ id: 'P' + i, name: 'Produto ' + i, stock: i, cost: 1 }));
  const t = pdfTexto(R.pdf({ titulo: 'Relatórios' }, [R.secaoEstoqueAtual(muitos, 10, 25)]));
  const paginas = (t.match(/\/Type \/Page \//g) || []).length;
  assert.ok(paginas >= 2, 'mais de uma página: ' + paginas);
  assert.ok(/\/Count \d+ >>/.test(t));
});

teste('PDF: travessão e aspas viram o byte do WinAnsi; quebra de linha vira espaço', () => {
  const b = R.pdf({ titulo: 'Relatórios' }, [{ titulo: 'x', colunas: [{ titulo: 'Produto', tipo: 'texto', largura: 1 }], linhas: [['A\u2013B \u201cC\u201d\nD']] }]);
  const t = pdfTexto(b);
  assert.ok(t.includes('A\x96B \x93C\x94 D'), 'bytes 0x96, 0x93, 0x94 e espaço no lugar da quebra');
});

teste('PDF: caractere fora de Latin-1 vira ? (não corrompe o arquivo)', () => {
  const t = pdfTexto(R.pdf({ titulo: 'Relatórios', empresa: 'Loja ✓ Central' }, [R.secaoRecebimentos([])]));
  assert.ok(t.includes('Loja ? Central'));
});

teste('fiado: recebimentos entram por forma; saldo em aberto fica numa linha à parte, fora do total', () => {
  const lista = [
    { id: 'F1', date: '2026-11-10T10:00:00', valor_total: 100, desconto: 0, valor_final: 100, cost: 60, pagamento: 'fiado',
      recebimentos: [{ forma: 'pix', valor: 40 }, { forma: 'dinheiro', valor: 10 }],
      items: [{ id: 'P1', name: 'Arroz', qty: 1, price: 100, cost: 60 }] },
    { id: 'F2', date: '2026-11-12T10:00:00', valor_total: 50, desconto: 0, valor_final: 50, cost: 30, pagamento: 'fiado',
      recebimentos: [],
      items: [{ id: 'P2', name: 'Feijão', qty: 1, price: 50, cost: 30 }] },
    { id: 'F3', date: '2026-11-13T10:00:00', valor_total: 30, desconto: 0, valor_final: 30, cost: 10, pagamento: 'fiado',
      recebimentos: [{ forma: 'cartao', valor: 30 }],
      items: [{ id: 'P3', name: 'Sal', qty: 1, price: 30, cost: 10 }] }
  ];
  const s = R.secaoRecebimentos(JSON.parse(JSON.stringify(lista)));
  const porForma = Object.fromEntries(s.linhas.filter((l) => !l[0].startsWith('Fiado em aberto')).map((l) => [l[0], l[2]]));
  assert.strictEqual(porForma['PIX'], 40);
  assert.strictEqual(porForma['Dinheiro'], 10);
  assert.strictEqual(porForma['Cartão'], 30);
  const aberto = s.linhas.find((l) => l[0].startsWith('Fiado em aberto'));
  assert.ok(aberto, 'linha de fiado em aberto');
  assert.strictEqual(aberto[1], 2, 'duas vendas com saldo (F1 e F2)');
  assert.strictEqual(aberto[2], 100, 'saldo: 50 de F1 + 50 de F2');
  assert.strictEqual(s.totais[2], 80, 'total = só o recebido (40 + 10 + 30)');
});

teste('fiado sem recebimento não aparece como recebido', () => {
  const s = R.secaoRecebimentos(JSON.parse(JSON.stringify([
    { id: 'F9', date: '2026-11-10T10:00:00', valor_final: 90, pagamento: 'fiado', items: [] }
  ])));
  assert.strictEqual(s.totais[2], 0);
  assert.strictEqual(s.linhas.length, 1, 'só a linha de fiado em aberto');
  assert.strictEqual(s.linhas[0][2], 90);
});

(async () => {
  let falhas = 0;
  for (const [nome, fn] of testes) {
    try { fn(); console.log('OK    ' + nome); }
    catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
  }
  console.log(falhas === 0 ? '\nTodos os testes de relatórios passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
