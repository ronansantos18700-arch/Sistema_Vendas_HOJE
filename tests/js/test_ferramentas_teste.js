// Verifica a ferramenta de teste "Excluir todos os dados" (Configurações > Ferramentas).
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

teste('flag do app começa desligada (false)', () => {
  assert.ok(/ferramentasTeste:\s*false,/.test(app), 'config.ferramentasTeste deve ser false');
});

teste('servidor: Ferramentas:ModoTeste começa desligado no appsettings.json', () => {
  const cfg = JSON.parse(ler('SV.Api/appsettings.json'));
  assert.strictEqual(cfg.Ferramentas.ModoTeste, false);
});

teste('botão fica dentro de um bloco oculto por padrão', () => {
  const m = html.match(/<div id="ferramentas-teste" class="([^"]*)"/);
  assert.ok(m, 'bloco #ferramentas-teste não encontrado');
  assert.ok(m[1].split(/\s+/).includes('hidden'), 'bloco deve começar com a classe hidden');
  assert.ok(html.includes('onclick="app.excluirTodosDadosTeste()"'), 'botão sem ação');
});

teste('botão só é exibido quando a flag do app está ligada', () => {
  assert.ok(app.includes("configurarFerramentasTeste()"), 'init não chama configurarFerramentasTeste');
  assert.ok(/classList\.toggle\('hidden',\s*!this\.config\.ferramentasTeste\)/.test(app));
});

teste('ação exige a flag e perfil admin antes de qualquer coisa', () => {
  const corpo = app.slice(app.indexOf('excluirTodosDadosTeste() {'), app.indexOf('confirmarExclusaoTotalTeste() {'));
  assert.ok(corpo.indexOf('if (!this.config.ferramentasTeste) return;') >= 0);
  assert.ok(corpo.indexOf("requireAdmin('apagar todos os dados')") > corpo.indexOf('ferramentasTeste'));
});

teste('há duas confirmações: a segunda abre depois que a primeira fecha o modal', () => {
  assert.ok(app.includes('() => setTimeout(() => this.confirmarExclusaoTotalTeste(), 0)'));
  assert.ok(app.includes('() => this.executarExclusaoTotalTeste()'));
});

teste('cliente envia a confirmação exata ao servidor', () => {
  assert.ok(api.includes("'/api/dados/excluir-tudo'"));
  assert.ok(api.includes("confirmacao: 'APAGAR TUDO'"));
});

teste('rota existe só com Ferramentas:ModoTeste e exige admin + confirmação', () => {
  const i = rotas.indexOf('if (app.Configuration.GetValue<bool>("Ferramentas:ModoTeste"))');
  const j = rotas.indexOf('MapPost("/api/dados/excluir-tudo"');
  assert.ok(i >= 0 && j > i, 'rota fora do bloco protegido');
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

console.log(falhas === 0 ? '\nTodos os testes de ferramenta de teste passaram.' : `\n${falhas} teste(s) falharam.`);
process.exitCode = falhas === 0 ? 0 : 1;
