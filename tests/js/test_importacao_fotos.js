// Verifica que a importação de backup leva as fotos ao servidor (modo servidor) e mantém o restauro no desktop.
// Uso: node tests/js/test_importacao_fotos.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const app = fs.readFileSync(path.join(__dirname, '../../SistemaVendas/frontend/app.js'), 'utf8');

const inicio = app.indexOf('async aplicarBackup(backupData, nomeArquivo) {');
assert.ok(inicio >= 0, 'aplicarBackup não encontrado');
const corpo = app.slice(inicio, app.indexOf('updateBrand() {', inicio));

let falhas = 0;
function teste(nome, fn) {
  try { fn(); console.log('OK   ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); }
}

teste('modo servidor envia cada foto com enviarImagem', () => {
  assert.ok(corpo.includes('this.emModoServidor() && Object.keys(media).length > 0'));
  assert.ok(corpo.includes('await this.servidor.enviarImagem(caminho.split(\'/\').pop(), base64)'));
});

teste('upload acontece antes de qualquer alteração do estado', () => {
  const upload = corpo.indexOf('enviarImagem(');
  const alteracao = corpo.indexOf('this.state.products = st.products');
  assert.ok(upload > 0 && alteracao > upload, 'upload deve vir antes de alterar o estado');
});

teste('falha no envio cancela sem alterar nada', () => {
  const bloco = corpo.slice(corpo.indexOf('} catch (err) {'), corpo.indexOf('} finally {'));
  assert.ok(bloco.includes('Restauração cancelada: não foi possível enviar as fotos'));
  assert.ok(bloco.includes('return;'));
});

teste('produtos e clientes recebem a URL devolvida pelo servidor', () => {
  assert.ok(corpo.includes('this.state.products = st.products.map(p => comFotoDoServidor({ ...p }))'));
  assert.ok(corpo.includes('this.state.customers = st.customers.map(c => comFotoDoServidor({ ...c }))'));
});

teste('desktop continua restaurando as imagens pela ponte', () => {
  assert.ok(corpo.includes('bridge.RestoreImage(path, base64)'));
});

console.log(falhas === 0 ? '\nTodos os testes de importação passaram.' : `\n${falhas} teste(s) falharam.`);
process.exitCode = falhas === 0 ? 0 : 1;
