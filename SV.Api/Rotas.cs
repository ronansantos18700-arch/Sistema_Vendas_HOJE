using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SV.Api.Seguranca;
using SV.Api.Servicos;

namespace SV.Api
{
    public static class Rotas
    {
        private const string TipoJson = "application/json; charset=utf-8";

        public static void Mapear(WebApplication app)
        {
            app.MapGet("/api/saude", () => Results.Json(new { ok = true, servico = "SV Ultra API" }));

            // --- Login e sessão ---

            app.MapPost("/api/login", async Task<IResult> (HttpRequest req) =>
            {
                JObject corpo = await LerCorpo(req);
                if (corpo == null) return Erro(400, "Requisição inválida.");

                string usuario = ((string)corpo["username"] ?? "").Trim();
                string senha = (string)corpo["password"] ?? "";
                if (usuario.Length == 0) return Erro(400, "Informe o usuário.");

                int aguarde;
                if (ControleLogin.Bloqueado(usuario, out aguarde))
                {
                    return Erro(429, "Muitas tentativas. Aguarde " + aguarde + " segundo(s).");
                }

                try
                {
                    JObject registro = Dados.BuscarUsuario(usuario);
                    if (registro == null || !Senha.Conferir(senha, usuario, (string)registro["password"]))
                    {
                        ControleLogin.RegistrarFalha(usuario);
                        return Erro(401, "Usuário ou senha incorretos.");
                    }

                    ControleLogin.Limpar(usuario);
                    JObject publico = Dados.Publico(registro);
                    string papel = (string)publico["role"];
                    string token = Sessoes.Criar(usuario, (string)publico["fullname"], papel);

                    return Results.Json(new
                    {
                        token = token,
                        usuario = new
                        {
                            id = (string)publico["id"],
                            fullname = (string)publico["fullname"],
                            username = (string)publico["username"],
                            role = (string)publico["role"],
                            isDefaultCredential = (bool)publico["isDefaultCredential"]
                        },
                        trocarSenha = (bool)publico["isDefaultCredential"]
                    });
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro no login: " + ex);
                    return Erro(500, "Erro interno ao entrar.");
                }
            });

            app.MapGet("/api/eu", (HttpRequest req) =>
            {
                Sessao sessao = Autenticar(req);
                if (sessao == null) return Erro(401, "Sessão expirada. Entre novamente.");
                return Results.Json(new { usuario = sessao.Usuario, nome = sessao.Nome, papel = sessao.Papel });
            });

            app.MapPost("/api/sair", (HttpRequest req) =>
            {
                string token = TokenDe(req);
                Sessoes.Encerrar(token);
                return Results.Json(new { ok = true });
            });

            app.MapPost("/api/senha", async Task<IResult> (HttpRequest req) =>
            {
                Sessao sessao = Autenticar(req);
                if (sessao == null) return Erro(401, "Sessão expirada. Entre novamente.");

                JObject corpo = await LerCorpo(req);
                if (corpo == null) return Erro(400, "Requisição inválida.");

                string atual = (string)corpo["senhaAtual"] ?? "";
                string nova = (string)corpo["novaSenha"] ?? "";
                if (nova.Length < Senha.TamanhoMinimo)
                {
                    return Erro(400, "A senha deve ter no mínimo " + Senha.TamanhoMinimo + " caracteres.");
                }

                try
                {
                    JObject registro = Dados.BuscarUsuario(sessao.Usuario);
                    if (registro == null || !Senha.Conferir(atual, sessao.Usuario, (string)registro["password"]))
                    {
                        return Erro(403, "Senha atual incorreta.");
                    }

                    Dados.TrocarSenha(sessao.Usuario, Senha.Gerar(nova, sessao.Usuario));
                    return Results.Json(new { ok = true });
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao trocar senha: " + ex);
                    return Erro(500, "Não foi possível trocar a senha.");
                }
            });

            // --- Usuários: listar, criar, editar e excluir são só do administrador ---

            app.MapGet("/api/usuarios", (HttpRequest req) =>
            {
                Sessao sessao = Autenticar(req);
                if (sessao == null) return Erro(401, "Sessão expirada. Entre novamente.");
                if (sessao.Papel != "admin") return Erro(403, "Somente administradores.");

                try
                {
                    return Results.Content(Dados.ListarUsuarios().ToString(Formatting.None), TipoJson);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao listar usuários: " + ex);
                    return Erro(500, "Erro ao ler os usuários.");
                }
            });

            app.MapPost("/api/usuarios", async Task<IResult> (HttpRequest req) =>
            {
                Sessao sessao = Autenticar(req);
                if (sessao == null) return Erro(401, "Sessão expirada. Entre novamente.");
                if (sessao.Papel != "admin") return Erro(403, "Somente administradores.");

                JObject corpo = await LerCorpo(req);
                if (corpo == null) return Erro(400, "Requisição inválida.");

                string nome = ((string)corpo["fullname"] ?? "").Trim();
                string login = ((string)corpo["username"] ?? "").Trim();
                string papel = (string)corpo["role"] ?? "operador";
                string senha = (string)corpo["senha"] ?? "";

                string erro = ValidarUsuario(nome, login, papel);
                if (erro != null) return Erro(400, erro);
                if (senha.Length < Senha.TamanhoMinimo)
                {
                    return Erro(400, "A senha deve ter no mínimo " + Senha.TamanhoMinimo + " caracteres.");
                }

                try
                {
                    JObject criado = Dados.CriarUsuario(nome, login, papel, senha);
                    return Results.Content(criado.ToString(Formatting.None), TipoJson, null, 201);
                }
                catch (RegraNegocioException ex)
                {
                    return Erro(400, ex.Message);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao criar usuário: " + ex);
                    return Erro(500, "Erro ao criar o usuário.");
                }
            });

            app.MapPut("/api/usuarios/{id}", async Task<IResult> (string id, HttpRequest req) =>
            {
                Sessao sessao = Autenticar(req);
                if (sessao == null) return Erro(401, "Sessão expirada. Entre novamente.");
                if (sessao.Papel != "admin") return Erro(403, "Somente administradores.");

                JObject corpo = await LerCorpo(req);
                if (corpo == null) return Erro(400, "Requisição inválida.");

                string nome = ((string)corpo["fullname"] ?? "").Trim();
                string login = ((string)corpo["username"] ?? "").Trim();
                string papel = (string)corpo["role"] ?? "operador";
                string senha = (string)corpo["senha"] ?? "";

                string erro = ValidarUsuario(nome, login, papel);
                if (erro != null) return Erro(400, erro);
                if (senha.Length > 0 && senha.Length < Senha.TamanhoMinimo)
                {
                    return Erro(400, "A senha deve ter no mínimo " + Senha.TamanhoMinimo + " caracteres.");
                }

                try
                {
                    JObject atualizado = Dados.AtualizarUsuario(id, nome, login, papel, senha);
                    return Results.Content(atualizado.ToString(Formatting.None), TipoJson);
                }
                catch (RegraNegocioException ex)
                {
                    return Erro(400, ex.Message);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao atualizar usuário: " + ex);
                    return Erro(500, "Erro ao atualizar o usuário.");
                }
            });

            app.MapDelete("/api/usuarios/{id}", (string id, HttpRequest req) =>
            {
                Sessao sessao = Autenticar(req);
                if (sessao == null) return Erro(401, "Sessão expirada. Entre novamente.");
                if (sessao.Papel != "admin") return Erro(403, "Somente administradores.");

                try
                {
                    JObject solicitante = Dados.BuscarUsuario(sessao.Usuario);
                    string idSolicitante = solicitante == null ? "" : (string)solicitante["id"];
                    Dados.ExcluirUsuario(id, idSolicitante);
                    return Results.Json(new { ok = true });
                }
                catch (RegraNegocioException ex)
                {
                    return Erro(400, ex.Message);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao excluir usuário: " + ex);
                    return Erro(500, "Erro ao excluir o usuário.");
                }
            });

            // --- Ferramentas de teste: apagar todos os dados. Só existe com Ferramentas:ModoTeste = true ---
            if (app.Configuration.GetValue<bool>("Ferramentas:ModoTeste"))
            {
                app.MapPost("/api/dados/excluir-tudo", async Task<IResult> (HttpRequest req) =>
                {
                    Sessao sessao = Autenticar(req);
                    if (sessao == null) return Erro(401, "Sessão expirada. Entre novamente.");
                    if (sessao.Papel != "admin") return Erro(403, "Somente administradores.");

                    JObject corpo = await LerCorpo(req);
                    if (corpo == null || (string)corpo["confirmacao"] != "APAGAR TUDO")
                    {
                        return Erro(400, "Confirmação inválida.");
                    }

                    try
                    {
                        Dados.ExcluirTudo();
                        Sessoes.EncerrarTodas();
                        Console.WriteLine("[TESTE] Todos os dados foram apagados por " + sessao.Usuario);
                        return Results.Json(new { ok = true });
                    }
                    catch (RegraNegocioException ex)
                    {
                        return Erro(400, ex.Message);
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("Erro ao apagar os dados: " + ex);
                        return Erro(500, "Erro ao apagar os dados.");
                    }
                });
            }

            // --- Imagens: upload exige login; leitura é pública, mas os nomes são aleatórios (GUID) ---

            app.MapPost("/api/imagens", async Task<IResult> (HttpRequest req) =>
            {
                if (Autenticar(req) == null) return Erro(401, "Sessão expirada. Entre novamente.");

                JObject corpo = await LerCorpo(req);
                if (corpo == null) return Erro(400, "Requisição inválida.");

                try
                {
                    string arquivo = Dados.SalvarImagem((string)corpo["nome"], (string)corpo["conteudo"]);
                    return Results.Json(new { url = "/api/imagens/" + arquivo });
                }
                catch (RegraNegocioException ex)
                {
                    return Erro(400, ex.Message);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao salvar imagem: " + ex);
                    return Erro(500, "Erro ao salvar a imagem.");
                }
            });

            app.MapGet("/api/imagens/{arquivo}", (string arquivo) =>
            {
                string caminho = Dados.CaminhoImagem(arquivo);
                if (caminho == null) return Results.NotFound();
                return Results.File(caminho, TipoImagem(arquivo));
            });

            // --- Dados ---

            app.MapGet("/api/dados/{tipo}", (string tipo, HttpRequest req) =>
            {
                if (Autenticar(req) == null) return Erro(401, "Sessão expirada. Entre novamente.");
                if (!Dados.TipoPublico(tipo)) return Erro(404, "Tipo de dado desconhecido.");

                try
                {
                    return Results.Content(Dados.Ler(tipo), TipoJson);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao ler " + tipo + ": " + ex);
                    return Erro(500, "Erro ao ler os dados.");
                }
            });

            // Mesmo formato de Bridge.SaveChanges: { "products": { "upsert": [...], "delete": [...], "order": [...] } }
            // ou { "products": { "full": [...] } }. Tudo ou nada, em uma transação.
            app.MapPost("/api/dados/alteracoes", async Task<IResult> (HttpRequest req) =>
            {
                if (Autenticar(req) == null) return Erro(401, "Sessão expirada. Entre novamente.");

                JObject alteracoes = await LerCorpo(req);
                if (alteracoes == null) return Erro(400, "Requisição inválida.");

                string motivo = Dados.ValidarAlteracoes(alteracoes);
                if (motivo != null) return Erro(400, motivo);

                try
                {
                    bool gravou = Dados.Aplicar(alteracoes.ToString(Formatting.None));
                    if (!gravou) return Erro(400, "Alterações inválidas. Nada foi gravado.");
                    return Results.Json(new { ok = true });
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Erro ao gravar alterações: " + ex);
                    return Erro(500, "Erro ao gravar. Nada foi gravado.");
                }
            });
        }

        /// <summary>Retorna null se os dados do usuário são válidos; senão, a mensagem de erro.</summary>
        private static string ValidarUsuario(string nome, string login, string papel)
        {
            if (string.IsNullOrEmpty(nome)) return "Informe o nome.";
            if (string.IsNullOrEmpty(login)) return "Informe o nome de usuário.";
            if (login.Length > 50) return "O nome de usuário pode ter no máximo 50 caracteres.";
            if (Array.IndexOf(Dados.Papeis, papel) < 0) return "Papel inválido.";
            return null;
        }

        private static string TipoImagem(string arquivo)
        {
            string ext = System.IO.Path.GetExtension(arquivo).ToLowerInvariant();
            if (ext == ".png") return "image/png";
            if (ext == ".bmp") return "image/bmp";
            return "image/jpeg";
        }

        private static string TokenDe(HttpRequest req)
        {
            string cabecalho = req.Headers["Authorization"].ToString();
            if (!cabecalho.StartsWith("Bearer ", StringComparison.Ordinal)) return null;
            return cabecalho.Substring(7).Trim();
        }

        /// <summary>
        /// Confere a sessão e relê o usuário no banco: papel alterado ou usuário excluído
        /// valem na hora, sem esperar a sessão expirar.
        /// </summary>
        private static Sessao Autenticar(HttpRequest req)
        {
            string token = TokenDe(req);
            Sessao sessao = Sessoes.Obter(token);
            if (sessao == null) return null;

            JObject atual = Dados.BuscarUsuario(sessao.Usuario);
            if (atual == null)
            {
                Sessoes.Encerrar(token);
                return null;
            }

            sessao.Nome = (string)atual["fullname"] ?? sessao.Nome;
            sessao.Papel = (string)atual["role"] ?? "operador";
            return sessao;
        }

        private static async Task<JObject> LerCorpo(HttpRequest req)
        {
            using (var leitor = new StreamReader(req.Body, Encoding.UTF8))
            {
                string texto = await leitor.ReadToEndAsync();
                try
                {
                    return JObject.Parse(texto);
                }
                catch (JsonException)
                {
                    return null;
                }
            }
        }

        private static IResult Erro(int status, string mensagem)
        {
            return Results.Json(new { erro = mensagem }, statusCode: status);
        }
    }
}
