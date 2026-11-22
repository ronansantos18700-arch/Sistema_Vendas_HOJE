// Verifica a ferramenta "Excluir todos os dados" (Configurações > Ferramentas).
// Uso: node tests/js/test_ferramentas_teste.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const raiz = path.join(__dirname, '../..');
const ler = p => fs.readFileSync(path.join(raiz, p), 'utf8');

const html = ler('SistemaVendas/frontend/index.html');
const app = ler('SistemaVendas/frontend/app.js');
const api = ler('SistemaVendas/frontend/api.js');
const rotas = ler('SV.Api/Rotas.cs');
const dados = ler('SV.Api/Servicos/Dados.cs');
const sessoes = ler('SV.Api/Seguranca/Sessoes.cs');

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log('OK   ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

teste('botão aparece em Configurações > Ferramentas (sem flag)', () => {
  const m = html.match(/<div id="ferramentas-teste"[^>]*>/);
  assert.ok(m, 'bloco #ferramentas-teste não encontrado');
  assert.ok(!/class="[^"]*\bhidden\b/.test(m[0]), 'bloco não deve começar oculto');
  assert.ok(html.includes('onclick="app.excluirTodosDadosTeste()"'), 'botão sem ação');
});

teste('não há mais flags de teste no app nem no servidor', () => {
  assert.ok(!app.includes('ferramentasTeste'), 'app.js ainda referencia ferramentasTeste');
  assert.ok(!app.includes('configurarFerramentasTeste'), 'função de flag ainda existe');
  assert.ok(!rotas.includes('Ferramentas:ModoTeste'), 'Rotas.cs ainda checa a flag');
  assert.ok(!ler('SV.Api/appsettings.json').includes('ModoTeste'), 'appsettings ainda tem a flag');
});

teste('ação exige administrador no cliente antes de qualquer coisa', () => {
  const corpo = app.slice(app.indexOf('excluirTodosDadosTeste() {'), app.indexOf('confirmarExclusaoTotalTeste() {'));
  assert.ok(corpo.includes("requireAdmin('apagar todos os dados')"));
});

teste('há duas confirmações: a segunda abre depois que a primeira fecha o modal', () => {
  assert.ok(app.includes('() => setTimeout(() => this.confirmarExclusaoTotalTeste(), 0)'));
  assert.ok(app.includes('() => this.executarExclusaoTotalTeste()'));
});

teste('cliente envia a confirmação exata ao servidor', () => {
  assert.ok(api.includes("'/api/dados/excluir-tudo'"));
  assert.ok(api.includes("confirmacao: 'APAGAR TUDO'"));
});

teste('rota exige admin e confirmação no servidor', () => {
  const j = rotas.indexOf('MapPost("/api/dados/excluir-tudo"');
  assert.ok(j >= 0, 'rota não encontrada');
  const bloco = rotas.slice(j, j + 900);
  assert.ok(bloco.includes('sessao.Papel != "admin"'), 'falta checagem de admin');
  assert.ok(bloco.includes('"APAGAR TUDO"'), 'falta confirmação no servidor');
});

teste('serviço apaga usuários e fotos e recria o admin padrão', () => {
  const corpo = dados.slice(dados.indexOf('public static void ExcluirTudo()'));
  assert.ok(corpo.includes('vazio["users"] = new JArray();'));
  assert.ok(corpo.includes('Directory.GetFiles(PastaImagens())'));
  assert.ok(corpo.includes('GarantirAdministrador();'));
});

teste('sessões são encerradas após apagar', () => {
  assert.ok(sessoes.includes('public static void EncerrarTodas()'));
  assert.ok(rotas.includes('Sessoes.EncerrarTodas();'));
});

teste('erro inesperado no servidor vira 500 com mensagem (não fica sem resposta)', () => {
  const j = rotas.indexOf('MapPost("/api/dados/excluir-tudo"');
  const bloco = rotas.slice(j, rotas.indexOf('// --- Imagens:', j));
  assert.ok(bloco.includes('catch (Exception ex)'), 'falta catch geral');
  assert.ok(bloco.includes('Erro(500,'), 'catch geral não devolve 500');
});

teste('fotos presas não impedem a exclusão do banco nem o admin padrão', () => {
  const corpo = dados.slice(dados.indexOf('public static void ExcluirTudo()'), dados.indexOf('public static string SalvarImagem'));
  assert.ok(corpo.includes('File.Delete(arquivo);') && corpo.includes('catch (IOException ex)'));
  assert.ok(corpo.indexOf('GarantirAdministrador();') > corpo.indexOf('Directory.GetFiles'));
});

teste('tela fica bloqueada para gravação durante a exclusão e em caso de falha', () => {
  const corpo = app.slice(app.indexOf('async executarExclusaoTotalTeste() {'), app.indexOf('async resetSystemUsers() {'));
  const antesDoTry = corpo.slice(0, corpo.indexOf('try {'));
  assert.ok(antesDoTry.includes('this.state.dataLoaded = false;'), 'flag não é zerada antes da chamada');
  assert.ok(corpo.includes('Recarregue a página (F5)'), 'falta orientação de recarregar em caso de falha');
});

teste('carregarDados não cria produtos/clientes de exemplo (eles voltavam ao servidor)', () => {
  assert.ok(!app.includes('MacBook Pro M3'), 'produto de exemplo ainda existe');
  assert.ok(!app.includes('João Silva'), 'cliente de exemplo ainda existe');
  const corpo = app.slice(app.indexOf('async carregarDados() {'), app.indexOf('chaveDiaLocal(d) {'));
  assert.ok(!/products\.length === 0 && !window\.chrome/.test(corpo), 'bloco de exemplo voltou');
});

console.log(falhas === 0 ? '\nTodos os testes de ferramenta de teste passaram.' : `\n${falhas} teste(s) falharam.`);
process.exitCode = falhas === 0 ? 0 : 1;
