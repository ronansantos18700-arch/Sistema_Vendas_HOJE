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

            // --- Usuários (somente leitura por enquanto; gestão completa na próxima etapa) ---

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

        private static string TokenDe(HttpRequest req)
        {
            string cabecalho = req.Headers["Authorization"].ToString();
            if (!cabecalho.StartsWith("Bearer ", StringComparison.Ordinal)) return null;
            return cabecalho.Substring(7).Trim();
        }

        private static Sessao Autenticar(HttpRequest req)
        {
            return Sessoes.Obter(TokenDe(req));
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
