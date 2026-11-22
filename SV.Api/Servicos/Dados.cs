using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SV.Api.Seguranca;

namespace SV.Api.Servicos
{
    /// <summary>Erro de regra de negócio (dado inválido, conflito). A mensagem vai para o usuário.</summary>
    public class RegraNegocioException : Exception
    {
        public RegraNegocioException(string mensagem) : base(mensagem) { }
    }

    /// <summary>
    /// Acesso ao banco central. Usa a mesma camada SQLite do desktop (SistemaVendas.Database),
    /// com uma trava para uma operação por vez.
    /// Usuários não passam pela rota genérica de dados: têm rotas próprias, para o cliente
    /// nunca enviar hash de senha.
    /// </summary>
    public static class Dados
    {
        /// <summary>Tipos que a rota genérica aceita. "users" fica de fora de propósito.</summary>
        public static readonly string[] TiposPublicos =
        {
            "products", "customers", "sales", "settings", "reversals",
            "entradas", "fechamentos", "categories", "movimentacoes", "caixa"
        };

        public static readonly string[] Papeis = { "admin", "operador" };

        private static readonly string[] ExtensoesImagem = { ".jpg", ".jpeg", ".png", ".bmp" };
        public const int TamanhoMaximoImagem = 5 * 1024 * 1024;

        private static readonly object _trava = new object();

        public static void Iniciar(string caminhoBanco)
        {
            lock (_trava)
            {
                SistemaVendas.Database.Caminho = caminhoBanco;
                SistemaVendas.Database.Initialize();
            }
        }

        public static bool TipoPublico(string tipo)
        {
            return !string.IsNullOrEmpty(tipo) &&
                   TiposPublicos.Any(t => string.Equals(t, tipo, StringComparison.OrdinalIgnoreCase));
        }

        public static string Ler(string tipo)
        {
            lock (_trava)
            {
                return SistemaVendas.Database.Read(tipo);
            }
        }

        public static bool Aplicar(string jsonAlteracoes)
        {
            lock (_trava)
            {
                return SistemaVendas.Database.ApplyChanges(jsonAlteracoes);
            }
        }

        /// <summary>Retorna null se o JSON é aceito pela rota genérica; senão, o motivo.</summary>
        public static string ValidarAlteracoes(JObject alteracoes)
        {
            foreach (JProperty p in alteracoes.Properties())
            {
                if (!TipoPublico(p.Name))
                {
                    return "Tipo de dado não permitido nesta operação: " + p.Name + ".";
                }
            }
            // Recebimentos de fiado: mesma regra do Database.ApplyChanges, com a mensagem para o usuário.
            return SistemaVendas.Database.ValidarRecebimentosFiado(alteracoes);
        }

        // ---------------------------------------------------------------
        // Usuários
        // ---------------------------------------------------------------

        public static JObject BuscarUsuario(string usuario)
        {
            foreach (JToken item in JArray.Parse(Ler("users")))
            {
                if (string.Equals((string)item["username"], usuario, StringComparison.Ordinal))
                {
                    return (JObject)item;
                }
            }
            return null;
        }

        public static JObject BuscarUsuarioPorId(string id)
        {
            foreach (JToken item in JArray.Parse(Ler("users")))
            {
                if (string.Equals((string)item["id"], id, StringComparison.Ordinal))
                {
                    return (JObject)item;
                }
            }
            return null;
        }

        public static int ContarAdministradores()
        {
            int total = 0;
            foreach (JToken item in JArray.Parse(Ler("users")))
            {
                if (string.Equals((string)item["role"], "admin", StringComparison.Ordinal)) total++;
            }
            return total;
        }

        /// <summary>Lista de usuários sem o campo de senha.</summary>
        public static JArray ListarUsuarios()
        {
            var saida = new JArray();
            foreach (JToken item in JArray.Parse(Ler("users")))
            {
                saida.Add(Publico(item as JObject));
            }
            return saida;
        }

        public static JObject Publico(JObject usuario)
        {
            if (usuario == null) return null;
            return new JObject
            {
                ["id"] = (string)usuario["id"] ?? "",
                ["fullname"] = (string)usuario["fullname"] ?? "",
                ["username"] = (string)usuario["username"] ?? "",
                ["role"] = (string)usuario["role"] ?? "operador",
                ["isDefaultCredential"] = (bool?)usuario["isDefaultCredential"] ?? false
            };
        }

        private static void GravarUsuario(JObject registro)
        {
            // Registro completo (com todas as colunas) para o upsert não apagar campos.
            var alteracao = new JObject
            {
                ["users"] = new JObject
                {
                    ["upsert"] = new JArray(registro.DeepClone())
                }
            };
            if (!Aplicar(alteracao.ToString(Formatting.None)))
            {
                throw new InvalidOperationException("Não foi possível gravar o usuário.");
            }
        }

        public static JObject CriarUsuario(string nome, string login, string papel, string senhaPlano)
        {
            lock (_trava)
            {
                if (BuscarUsuario(login) != null)
                {
                    throw new RegraNegocioException("Este nome de usuário já está em uso.");
                }

                var registro = new JObject
                {
                    ["id"] = "U" + DateTime.UtcNow.Ticks,
                    ["fullname"] = nome,
                    ["username"] = login,
                    ["password"] = Senha.Gerar(senhaPlano, login),
                    ["role"] = papel,
                    ["isDefaultCredential"] = false
                };
                GravarUsuario(registro);
                return Publico(registro);
            }
        }

        /// <summary>
        /// Atualiza nome, login e papel. Se senhaPlano vier vazio, a senha não muda.
        /// Trocar o login exige nova senha, porque o hash usa o login como salt.
        /// </summary>
        public static JObject AtualizarUsuario(string id, string nome, string login, string papel, string senhaPlano)
        {
            lock (_trava)
            {
                JObject atual = BuscarUsuarioPorId(id);
                if (atual == null) throw new RegraNegocioException("Usuário não encontrado.");

                JObject outro = BuscarUsuario(login);
                if (outro != null && !string.Equals((string)outro["id"], id, StringComparison.Ordinal))
                {
                    throw new RegraNegocioException("Este nome de usuário já está em uso por outro colaborador.");
                }

                bool trocouLogin = !string.Equals((string)atual["username"], login, StringComparison.Ordinal);
                bool informouSenha = !string.IsNullOrEmpty(senhaPlano);
                if (trocouLogin && !informouSenha)
                {
                    throw new RegraNegocioException("Ao trocar o nome de usuário, informe uma nova senha.");
                }

                bool eraAdmin = string.Equals((string)atual["role"], "admin", StringComparison.Ordinal);
                if (eraAdmin && papel != "admin" && ContarAdministradores() <= 1)
                {
                    throw new RegraNegocioException("Não é possível tirar o papel do último administrador.");
                }

                atual["fullname"] = nome;
                atual["username"] = login;
                atual["role"] = papel;
                if (informouSenha)
                {
                    atual["password"] = Senha.Gerar(senhaPlano, login);
                    atual["isDefaultCredential"] = false;
                }

                GravarUsuario(atual);
                return Publico(atual);
            }
        }

        public static void ExcluirUsuario(string id, string idSolicitante)
        {
            lock (_trava)
            {
                JObject atual = BuscarUsuarioPorId(id);
                if (atual == null) throw new RegraNegocioException("Usuário não encontrado.");

                if (string.Equals(id, idSolicitante, StringComparison.Ordinal))
                {
                    throw new RegraNegocioException("Você não pode excluir seu próprio usuário.");
                }

                bool eraAdmin = string.Equals((string)atual["role"], "admin", StringComparison.Ordinal);
                if (eraAdmin && ContarAdministradores() <= 1)
                {
                    throw new RegraNegocioException("Não é possível excluir o último administrador.");
                }

                var ids = new JArray();
                ids.Add(id);
                var alteracao = new JObject
                {
                    ["users"] = new JObject
                    {
                        ["delete"] = ids
                    }
                };
                if (!Aplicar(alteracao.ToString(Formatting.None)))
                {
                    throw new InvalidOperationException("Não foi possível excluir o usuário.");
                }
            }
        }

        /// <summary>Grava a nova senha (hash) e desliga a senha provisória.</summary>
        public static void TrocarSenha(string usuario, string novoHash)
        {
            lock (_trava)
            {
                JObject registro = BuscarUsuario(usuario);
                if (registro == null) throw new InvalidOperationException("Usuário não encontrado.");

                registro["password"] = novoHash;
                registro["isDefaultCredential"] = false;
                GravarUsuario(registro);
            }
        }

        /// <summary>Cria o administrador padrão quando não há nenhum usuário (primeira execução).</summary>
        public static void GarantirAdministrador()
        {
            if (JArray.Parse(Ler("users")).Count > 0) return;

            var admin = new JObject
            {
                ["id"] = "U" + DateTime.UtcNow.Ticks,
                ["fullname"] = "Administrador Padrão",
                ["username"] = "admin",
                ["password"] = Senha.Gerar("1234", "admin"),
                ["role"] = "admin",
                ["isDefaultCredential"] = true
            };

            var alteracao = new JObject
            {
                ["users"] = new JObject
                {
                    ["upsert"] = new JArray(admin)
                }
            };
            if (!Aplicar(alteracao.ToString(Formatting.None)))
            {
                throw new InvalidOperationException("Não foi possível criar o administrador inicial.");
            }
            Console.WriteLine("Administrador inicial criado (admin). Troque a senha no primeiro acesso.");
        }

        // ---------------------------------------------------------------
        // Imagens (ficam na pasta "imagens" ao lado do banco)
        // ---------------------------------------------------------------

        public static string PastaImagens()
        {
            string pasta = Path.Combine(Path.GetDirectoryName(SistemaVendas.Database.Caminho), "imagens");
            Directory.CreateDirectory(pasta);
            return pasta;
        }

        /// <summary>
        /// Apaga todos os dados (produtos, vendas, clientes etc.), os usuários e as fotos.
        /// Usado pela rota de exclusão (administrador, com confirmação). Depois recria o administrador
        /// padrão, como a inicialização já faz quando não há usuários.
        /// Se as fotos não puderem ser apagadas (arquivo em uso), o banco continua apagado;
        /// os arquivos que sobraram são listados no console.
        /// </summary>
        public static void ExcluirTudo()
        {
            lock (_trava)
            {
                var vazio = new JObject();
                foreach (string tipo in TiposPublicos)
                {
                    vazio[tipo] = new JArray();
                }
                vazio["users"] = new JArray();

                if (!SistemaVendas.Database.ReplaceAll(vazio.ToString(Formatting.None)))
                {
                    throw new RegraNegocioException("Não foi possível apagar os dados.");
                }

                // Fotos: best-effort. O banco já foi apagado; uma foto presa não deve impedir o resto.
                foreach (string arquivo in Directory.GetFiles(PastaImagens()))
                {
                    try
                    {
                        File.Delete(arquivo);
                    }
                    catch (IOException ex)
                    {
                        Console.Error.WriteLine("[TESTE] Foto não apagada: " + arquivo + " (" + ex.Message + ")");
                    }
                    catch (UnauthorizedAccessException ex)
                    {
                        Console.Error.WriteLine("[TESTE] Foto não apagada: " + arquivo + " (" + ex.Message + ")");
                    }
                }

                GarantirAdministrador();
                Console.WriteLine("[TESTE] Banco apagado em: " + SistemaVendas.Database.Caminho);
            }
        }

        public static string SalvarImagem(string nomeOriginal, string base64)
        {
            string ext = Path.GetExtension(nomeOriginal ?? "").ToLowerInvariant();
            if (Array.IndexOf(ExtensoesImagem, ext) < 0)
            {
                throw new RegraNegocioException("Formato de imagem não aceito. Use JPG, PNG ou BMP.");
            }

            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(base64 ?? "");
            }
            catch (FormatException)
            {
                throw new RegraNegocioException("Imagem inválida.");
            }

            if (bytes.Length == 0 || bytes.Length > TamanhoMaximoImagem)
            {
                throw new RegraNegocioException("A imagem deve ter até 5 MB.");
            }

            string arquivo = Guid.NewGuid().ToString("N") + ext;
            File.WriteAllBytes(Path.Combine(PastaImagens(), arquivo), bytes);
            return arquivo;
        }

        /// <summary>Caminho físico da imagem, ou null se o nome for inválido ou não existir.</summary>
        public static string CaminhoImagem(string arquivo)
        {
            if (!Regex.IsMatch(arquivo ?? "", @"^[a-f0-9]{32}\.(jpg|jpeg|png|bmp)$")) return null;
            string caminho = Path.Combine(PastaImagens(), arquivo);
            return File.Exists(caminho) ? caminho : null;
        }
    }
}
