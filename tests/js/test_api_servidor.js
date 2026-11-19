// Testa o cliente do servidor (api.js) com um fetch falso. Não precisa de servidor rodando.
// Uso: node tests/js/test_api_servidor.js
const path = require('path');
const assert = require('assert');
const SV = require(path.join(__dirname, '../../SistemaVendas/frontend/api.js'));

let falhas = 0;
function teste(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log('OK    ' + nome))
    .catch(e => { falhas++; console.log('FALHA ' + nome + '\n      ' + e.message); });
}

// Armazenamento em memória com a mesma interface do localStorage.
function armazenamentoFalso() {
  const dados = new Map();
  return {
    getItem: k => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => dados.set(k, String(v)),
    removeItem: k => dados.delete(k)
  };
}

// fetch falso: responde pela função "responder" e guarda as chamadas.
function fetchFalso(responder) {
  const chamadas = [];
  const fn = async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    const r = await responder(url, opcoes);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => (r.corpo === undefined ? '' : (typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo)))
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

function novoCliente(responder) {
  const armazenamento = armazenamentoFalso();
  const sessao = armazenamentoFalso();
  const fetch = fetchFalso(responder || (() => ({ status: 500 })));
  const servidor = new SV.ServidorAPI({ armazenamento, sessao, fetch });
  return { servidor, fetch, armazenamento, sessao };
}

(async () => {
  await teste('normalizarUrl aceita endereço sem http e remove barra final', () => {
    assert.strictEqual(SV.normalizarUrl('192.168.0.10:5080'), 'http://192.168.0.10:5080');
    assert.strictEqual(SV.normalizarUrl('http://192.168.0.10:5080/'), 'http://192.168.0.10:5080');
    assert.strictEqual(SV.normalizarUrl('  '), '');
    assert.strictEqual(SV.normalizarUrl('http://'), '');
  });

  await teste('definirUrl recusa endereço inválido e grava o válido', () => {
    const { servidor, armazenamento } = novoCliente();
    assert.throws(() => servidor.definirUrl('http://'), /inválido/);
    servidor.definirUrl('10.0.0.5:5080');
    assert.strictEqual(armazenamento.getItem('sv_servidor_url'), 'http://10.0.0.5:5080');
  });

  await teste('login guarda o token e devolve o usuário com trocarSenha', async () => {
    const { servidor, fetch, sessao } = novoCliente(() => ({
      status: 200,
      corpo: { token: 'T123', usuario: { id: 'U1', fullname: 'Admin', username: 'admin', role: 'admin' }, trocarSenha: true }
    }));
    servidor.definirUrl('http://srv:5080');
    const usuario = await servidor.login('admin', '1234');
    assert.strictEqual(sessao.getItem('sv_token'), 'T123');
    assert.strictEqual(usuario.username, 'admin');
    assert.strictEqual(usuario.trocarSenha, true);
    const c = fetch.chamadas[0];
    assert.strictEqual(c.url, 'http://srv:5080/api/login');
    assert.strictEqual(c.opcoes.method, 'POST');
    assert.strictEqual(JSON.parse(c.opcoes.body).password, '1234');
    assert.strictEqual(c.opcoes.headers.Authorization, undefined);
  });

  await teste('login recusado mostra a mensagem do servidor e não guarda token', async () => {
    const { servidor, sessao } = novoCliente(() => ({ status: 401, corpo: { erro: 'Usuário ou senha incorretos.' } }));
    servidor.definirUrl('http://srv:5080');
    await assert.rejects(servidor.login('admin', 'errada'), err => {
      assert.strictEqual(err.message, 'Usuário ou senha incorretos.');
      assert.strictEqual(err.status, 401);
      return true;
    });
    assert.strictEqual(sessao.getItem('sv_token'), null);
  });

  await teste('chamada autenticada envia Bearer e token inválido limpa a sessão', async () => {
    const { servidor, fetch, sessao } = novoCliente(() => ({ status: 401, corpo: { erro: 'Sessão expirada.' } }));
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'velho');
    await assert.rejects(servidor.lerDados('products'), /Sessão expirada/);
    assert.strictEqual(fetch.chamadas[0].opcoes.headers.Authorization, 'Bearer velho');
    assert.strictEqual(sessao.getItem('sv_token'), null);
  });

  await teste('sem token, chamada autenticada nem sai da máquina', async () => {
    const { servidor, fetch } = novoCliente(() => ({ status: 200, corpo: [] }));
    servidor.definirUrl('http://srv:5080');
    await assert.rejects(servidor.lerDados('products'), err => err.status === 401);
    assert.strictEqual(fetch.chamadas.length, 0);
  });

  await teste('falha de rede vira mensagem de conexão', async () => {
    const { servidor, sessao } = novoCliente(() => { throw new TypeError('Failed to fetch'); });
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'T');
    await assert.rejects(servidor.lerDados('products'), /Não foi possível conectar ao servidor/);
  });

  await teste('salvarAlteracoes envia o JSON no corpo e devolve true', async () => {
    const { servidor, fetch, sessao } = novoCliente(() => ({ status: 200, corpo: { ok: true } }));
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'T');
    const alteracoes = { products: { upsert: [{ id: 'P1', name: 'Café' }] } };
    assert.strictEqual(await servidor.salvarAlteracoes(alteracoes), true);
    const c = fetch.chamadas[0];
    assert.strictEqual(c.url, 'http://srv:5080/api/dados/alteracoes');
    assert.deepStrictEqual(JSON.parse(c.opcoes.body), alteracoes);
    assert.strictEqual(c.opcoes.headers.Authorization, 'Bearer T');
  });

  await teste('origemDeDados: operador recebe lista de usuários vazia (403)', async () => {
    const { servidor, sessao } = novoCliente(() => ({ status: 403, corpo: { erro: 'Somente administradores.' } }));
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'T');
    const origem = SV.origemDeDados(servidor);
    assert.strictEqual(await origem.GetData('users'), '[]');
  });

  await teste('origemDeDados: GetData devolve o JSON do servidor como texto', async () => {
    const { servidor, sessao } = novoCliente(() => ({ status: 200, corpo: [{ id: 'P1' }] }));
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'T');
    const origem = SV.origemDeDados(servidor);
    const texto = await origem.GetData('products');
    assert.strictEqual(typeof texto, 'string');
    assert.deepStrictEqual(JSON.parse(texto), [{ id: 'P1' }]);
  });

  await teste('excluirUsuario usa DELETE com o id codificado', async () => {
    const { servidor, fetch, sessao } = novoCliente(() => ({ status: 200, corpo: { ok: true } }));
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'T');
    await servidor.excluirUsuario('U 1/2');
    assert.strictEqual(fetch.chamadas[0].opcoes.method, 'DELETE');
    assert.strictEqual(fetch.chamadas[0].url, 'http://srv:5080/api/usuarios/U%201%2F2');
  });

  await teste('enviarImagem devolve a URL completa no servidor', async () => {
    const { servidor, fetch, sessao } = novoCliente(() => ({ status: 200, corpo: { url: '/api/imagens/abc.jpg' } }));
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'T');
    const url = await servidor.enviarImagem('foto.jpg', 'QUJD');
    assert.strictEqual(url, 'http://srv:5080/api/imagens/abc.jpg');
    assert.deepStrictEqual(JSON.parse(fetch.chamadas[0].opcoes.body), { nome: 'foto.jpg', conteudo: 'QUJD' });
  });

  await teste('sair limpa o token mesmo se o servidor não responder', async () => {
    const { servidor, sessao } = novoCliente(() => { throw new TypeError('offline'); });
    servidor.definirUrl('http://srv:5080');
    sessao.setItem('sv_token', 'T');
    await servidor.sair();
    assert.strictEqual(sessao.getItem('sv_token'), null);
  });

  await teste('url é a origem da página quando servida pelo servidor (http)', () => {
    global.location = { protocol: 'http:', origin: 'http://192.168.0.10:5080' };
    try {
      const { servidor } = novoCliente();
      assert.strictEqual(servidor.url, 'http://192.168.0.10:5080');
    } finally {
      delete global.location;
    }
  });

  await teste('sem página http, url vem do endereço guardado', () => {
    const { servidor } = novoCliente();
    assert.strictEqual(servidor.url, '');
    servidor.definirUrl('10.0.0.5:5080');
    assert.strictEqual(servidor.url, 'http://10.0.0.5:5080');
  });

  await teste('verificarConexao: true com /api/saude ok, false se cair ou der erro', async () => {
    const ok = novoCliente(() => ({ status: 200, corpo: { ok: true } }));
    ok.servidor.definirUrl('http://srv:5080');
    assert.strictEqual(await ok.servidor.verificarConexao(), true);
    assert.strictEqual(ok.fetch.chamadas[0].url, 'http://srv:5080/api/saude');

    const caiu = novoCliente(() => { throw new TypeError('offline'); });
    caiu.servidor.definirUrl('http://srv:5080');
    assert.strictEqual(await caiu.servidor.verificarConexao(), false);

    const erro = novoCliente(() => ({ status: 503 }));
    erro.servidor.definirUrl('http://srv:5080');
    assert.strictEqual(await erro.servidor.verificarConexao(), false);
  });

  await teste('sessaoValida: true com sessão, false com 401 (limpa o token), erro de rede é lançado', async () => {
    const ok = novoCliente(() => ({ status: 200, corpo: { usuario: 'admin' } }));
    ok.servidor.definirUrl('http://srv:5080');
    ok.sessao.setItem('sv_token', 'T');
    assert.strictEqual(await ok.servidor.sessaoValida(), true);

    const expirou = novoCliente(() => ({ status: 401, corpo: { erro: 'Sessão expirada.' } }));
    expirou.servidor.definirUrl('http://srv:5080');
    expirou.sessao.setItem('sv_token', 'T');
    assert.strictEqual(await expirou.servidor.sessaoValida(), false);
    assert.strictEqual(expirou.sessao.getItem('sv_token'), null);

    const caiu = novoCliente(() => { throw new TypeError('offline'); });
    caiu.servidor.definirUrl('http://srv:5080');
    caiu.sessao.setItem('sv_token', 'T');
    await assert.rejects(() => caiu.servidor.sessaoValida(), /conectar/);
  });

  console.log(falhas === 0 ? '\nTodos os testes do cliente do servidor passaram.' : `\n${falhas} teste(s) falharam.`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
