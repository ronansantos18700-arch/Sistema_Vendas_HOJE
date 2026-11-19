// Cliente do servidor central (SV Ultra API). Sem DOM: usado pelo app.js e pelos testes.
// Expõe window.SvServidor (ou module.exports no Node).
(function (raiz) {
    'use strict';

    const CHAVE_URL = 'sv_servidor_url';
    const CHAVE_TOKEN = 'sv_token';
    const TEMPO_LIMITE_MS = 15000;

    class ErroServidor extends Error {
        constructor(mensagem, status = 0) {
            super(mensagem);
            this.name = 'ErroServidor';
            this.status = status;
        }
    }

    // Aceita "192.168.0.10:5080", "http://192.168.0.10:5080/" etc. Retorna a origem ou ''.
    function normalizarUrl(texto) {
        let url = String(texto || '').trim();
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
        try {
            const u = new URL(url);
            return u.hostname ? u.origin : '';
        } catch (_) {
            return '';
        }
    }

    class ServidorAPI {
        constructor(opcoes = {}) {
            this.armazenamento = opcoes.armazenamento || raiz.localStorage;
            this.sessao = opcoes.sessao || raiz.sessionStorage;
            this.fetchFn = opcoes.fetch || (raiz.fetch ? raiz.fetch.bind(raiz) : null);
        }

        // Com a página servida pelo próprio servidor (http://IP:5080/), a origem da página é o servidor.
        // Fora disso (testes, arquivo local), usa o endereço guardado.
        get url() {
            const protocolo = raiz.location ? raiz.location.protocol : '';
            if (protocolo === 'http:' || protocolo === 'https:') return raiz.location.origin;
            return normalizarUrl(this.armazenamento.getItem(CHAVE_URL));
        }

        definirUrl(texto) {
            const url = normalizarUrl(texto);
            if (!url) {
                throw new ErroServidor('Endereço do servidor inválido. Exemplo: http://192.168.0.10:5080');
            }
            this.armazenamento.setItem(CHAVE_URL, url);
            return url;
        }

        get token() {
            return this.sessao.getItem(CHAVE_TOKEN) || '';
        }

        set token(valor) {
            if (valor) this.sessao.setItem(CHAVE_TOKEN, valor);
            else this.sessao.removeItem(CHAVE_TOKEN);
        }

        get logado() {
            return !!this.token;
        }

        // Faz a chamada e devolve o texto da resposta. Erros viram ErroServidor com a mensagem do servidor.
        async requisitar(metodo, caminho, opcoes = {}) {
            const base = this.url;
            if (!base) throw new ErroServidor('Informe o endereço do servidor.');
            if (!this.fetchFn) throw new ErroServidor('Este ambiente não tem acesso à rede.');

            const cabecalhos = { Accept: 'application/json' };
            const temCorpo = opcoes.corpo !== undefined;
            if (temCorpo) cabecalhos['Content-Type'] = 'application/json; charset=utf-8';

            const autenticado = opcoes.autenticado !== false;
            if (autenticado) {
                if (!this.token) throw new ErroServidor('Sessão encerrada. Entre novamente.', 401);
                cabecalhos.Authorization = 'Bearer ' + this.token;
            }

            const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = controle ? setTimeout(() => controle.abort(), TEMPO_LIMITE_MS) : null;

            let resposta;
            try {
                resposta = await this.fetchFn(base + caminho, {
                    method: metodo,
                    headers: cabecalhos,
                    body: temCorpo ? JSON.stringify(opcoes.corpo) : undefined,
                    signal: controle ? controle.signal : undefined
                });
            } catch (_) {
                throw new ErroServidor(
                    'Não foi possível conectar ao servidor (' + base + '). Verifique o endereço e se ele está ligado.'
                );
            } finally {
                if (timer) clearTimeout(timer);
            }

            const texto = await resposta.text();
            if (!resposta.ok) {
                let mensagem = 'Erro ' + resposta.status + ' no servidor.';
                try {
                    const dados = JSON.parse(texto);
                    if (dados && dados.erro) mensagem = dados.erro;
                } catch (_) { /* resposta sem JSON: fica a mensagem genérica */ }
                if (resposta.status === 401 && autenticado) this.token = '';
                throw new ErroServidor(mensagem, resposta.status);
            }
            return texto;
        }

        // Verifica se o servidor responde (sem login). Não lança erro: devolve true ou false.
        async verificarConexao() {
            const base = this.url;
            if (!base || !this.fetchFn) return false;
            const controle = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = controle ? setTimeout(() => controle.abort(), 4000) : null;
            try {
                const resposta = await this.fetchFn(base + '/api/saude', {
                    cache: 'no-store',
                    signal: controle ? controle.signal : undefined
                });
                return resposta.ok;
            } catch (_) {
                return false;
            } finally {
                if (timer) clearTimeout(timer);
            }
        }

        // true se a sessão ainda vale no servidor; false se o servidor recusou (reiniciou ou expirou).
        // Outros erros (servidor fora) são lançados para quem chamou tratar.
        async sessaoValida() {
            try {
                await this.requisitar('GET', '/api/eu');
                return true;
            } catch (erro) {
                if (erro.status === 401) return false;
                throw erro;
            }
        }

        async login(usuario, senha) {
            const texto = await this.requisitar('POST', '/api/login', {
                corpo: { username: usuario, password: senha },
                autenticado: false
            });
            const dados = JSON.parse(texto);
            this.token = dados.token;
            return { ...dados.usuario, trocarSenha: !!dados.trocarSenha };
        }

        async sair() {
            try {
                if (this.logado) await this.requisitar('POST', '/api/sair');
            } catch (_) {
                // Se o servidor não responder, a sessão local é encerrada mesmo assim.
            } finally {
                this.token = '';
            }
        }

        async trocarMinhaSenha(senhaAtual, novaSenha) {
            await this.requisitar('POST', '/api/senha', { corpo: { senhaAtual, novaSenha } });
        }

        async listarUsuarios() {
            return JSON.parse(await this.requisitar('GET', '/api/usuarios'));
        }

        async criarUsuario({ fullname, username, role, senha }) {
            const texto = await this.requisitar('POST', '/api/usuarios', {
                corpo: { fullname, username, role, senha }
            });
            return JSON.parse(texto);
        }

        async atualizarUsuario(id, { fullname, username, role, senha }) {
            const texto = await this.requisitar('PUT', '/api/usuarios/' + encodeURIComponent(id), {
                corpo: { fullname, username, role, senha: senha || '' }
            });
            return JSON.parse(texto);
        }

        async excluirUsuario(id) {
            await this.requisitar('DELETE', '/api/usuarios/' + encodeURIComponent(id));
        }

        // Devolve o JSON (texto) de um tipo de dado, como o Bridge.GetData.
        async lerDados(tipo) {
            return this.requisitar('GET', '/api/dados/' + encodeURIComponent(tipo));
        }

        // Mesmo formato de Bridge.SaveChanges. Lança ErroServidor se nada foi gravado.
        async salvarAlteracoes(alteracoes) {
            await this.requisitar('POST', '/api/dados/alteracoes', { corpo: alteracoes });
            return true;
        }

        // Envia a imagem (base64 puro, sem "data:...,") e devolve a URL completa para usar em <img src>.
        async enviarImagem(nomeArquivo, conteudoBase64) {
            const texto = await this.requisitar('POST', '/api/imagens', {
                corpo: { nome: nomeArquivo, conteudo: conteudoBase64 }
            });
            return this.url + JSON.parse(texto).url;
        }
    }

    // Adaptador com a mesma forma do Bridge (GetData/SaveChanges), para o app.js
    // reaproveitar a leitura e a normalização que já existem.
    function origemDeDados(servidor) {
        return {
            GetData: async (tipo) => {
                if (tipo === 'users') {
                    try {
                        return JSON.stringify(await servidor.listarUsuarios());
                    } catch (erro) {
                        // Operador não lista usuários: a lista fica vazia, sem erro.
                        if (erro.status === 403) return '[]';
                        throw erro;
                    }
                }
                return servidor.lerDados(tipo);
            },
            SaveChanges: async (json) => servidor.salvarAlteracoes(JSON.parse(json))
        };
    }

    const api = { ServidorAPI, ErroServidor, normalizarUrl, origemDeDados };

    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.SvServidor = api;
})(typeof window !== 'undefined' ? window : globalThis);
