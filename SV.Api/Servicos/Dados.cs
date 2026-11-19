using System;
using System.Collections.Generic;
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

        /// <summary>
        /// Valida o estoque e grava as alterações sob a mesma trava: dois PCs não passam pela
        /// validação ao mesmo tempo. Lança RegraNegocioException se a gravação causaria estoque negativo.
        /// </summary>
        public static bool AplicarComValidacao(string jsonAlteracoes)
        {
            lock (_trava)
            {
                JObject alteracoes = JObject.Parse(jsonAlteracoes);
                ValidarEstoque(alteracoes);
                return SistemaVendas.Database.ApplyChanges(jsonAlteracoes);
            }
        }

        // ---------------------------------------------------------------
        // Estoque (regra igual a estoque.js: o saldo nunca fica negativo)
        // ---------------------------------------------------------------

        /// <summary>
        /// Recusa a gravação se ela criar uma saída sem saldo. Só saídas novas causadas por esta
        /// gravação contam: uma saída já inconsistente antes da validação não bloqueia o resto.
        /// </summary>
        private static void ValidarEstoque(JObject alteracoes)
        {
            JToken mudanca = alteracoes["movimentacoes"];
            if (mudanca == null || mudanca.Type != JTokenType.Object) return;

            JArray atuais = JArray.Parse(Ler("movimentacoes"));
            JArray depois = SimularMudanca(atuais, (JObject)mudanca);

            var antes = new HashSet<string>(EstourosDoLivro(atuais).Select(e => e.Key));
            foreach (var estouro in EstourosDoLivro(depois))
            {
                if (antes.Contains(estouro.Key)) continue;
                throw new RegraNegocioException(
                    "Estoque insuficiente para \"" + NomeDoProduto(estouro.Value) + "\". Nada foi gravado.");
            }
        }

        /// <summary>Lista de movimentações depois de aplicar a mudança (full, upsert, delete, order).</summary>
        private static JArray SimularMudanca(JArray atuais, JObject mudanca)
        {
            if (mudanca["full"] is JArray full)
            {
                return JArray.Parse(full.ToString(Formatting.None));
            }

            JArray lista = JArray.Parse(atuais.ToString(Formatting.None));

            if (mudanca["delete"] is JArray remover)
            {
                var ids = new HashSet<string>(remover.Select(t => Texto(t)));
                for (int i = lista.Count - 1; i >= 0; i--)
                {
                    if (ids.Contains(Texto(lista[i]["id"]))) lista.RemoveAt(i);
                }
            }

            if (mudanca["upsert"] is JArray upsert)
            {
                foreach (JToken item in upsert)
                {
                    string id = Texto(item["id"]);
                    int idx = -1;
                    for (int i = 0; i < lista.Count; i++)
                    {
                        if (Texto(lista[i]["id"]) == id) { idx = i; break; }
                    }
                    JToken copia = JToken.Parse(item.ToString(Formatting.None));
                    if (idx >= 0) lista[idx] = copia; else lista.Add(copia);
                }
            }

            if (mudanca["order"] is JArray ordem)
            {
                var posicao = new Dictionary<string, int>();
                for (int i = 0; i < ordem.Count; i++) posicao[Texto(ordem[i])] = i;

                var listados = lista.Where(t => posicao.ContainsKey(Texto(t["id"])))
                                    .OrderBy(t => posicao[Texto(t["id"])]);
                var resto = lista.Where(t => !posicao.ContainsKey(Texto(t["id"])));
                var nova = new JArray();
                foreach (JToken t in listados.Concat(resto))
                {
                    nova.Add(JToken.Parse(t.ToString(Formatting.None)));
                }
                lista = nova;
            }

            return lista;
        }

        /// <summary>
        /// Percorre o livro de movimentações (como o Estoque do app) e devolve as saídas que
        /// levariam o saldo abaixo de zero: par (id da movimentação, id do produto), na ordem do livro.
        /// </summary>
        private static List<KeyValuePair<string, string>> EstourosDoLivro(JArray livro)
        {
            var saldos = new Dictionary<string, double>();
            var estouros = new List<KeyValuePair<string, string>>();

            foreach (JToken mov in livro)
            {
                if (Verdadeiro(mov["ignorada"])) continue;

                string produto = Texto(mov["produtoId"]);
                string tipo = Texto(mov["tipo"]);
                double qtd = Numero(mov["qtd"]);
                double saldo = Math.Max(0, saldos.TryGetValue(produto, out double s) ? s : 0);

                switch (tipo)
                {
                    case "saldo_inicial":
                        saldos[produto] = Math.Max(0, qtd);
                        break;
                    case "ajuste_custo":
                        break;
                    case "entrada":
                        saldos[produto] = saldo + qtd;
                        break;
                    default: // venda, estorno, ajuste, exclusao_entrada
                        if (saldo + qtd < 0)
                        {
                            estouros.Add(new KeyValuePair<string, string>(Texto(mov["id"]), produto));
                        }
                        saldos[produto] = Math.Max(0, saldo + qtd);
                        break;
                }
            }
            return estouros;
        }

        private static string NomeDoProduto(string produtoId)
        {
            foreach (JToken p in JArray.Parse(Ler("products")))
            {
                if (Texto(p["id"]) == produtoId)
                {
                    string nome = Texto(p["name"]);
                    return string.IsNullOrEmpty(nome) ? produtoId : nome;
                }
            }
            return produtoId;
        }

        private static string Texto(JToken t)
        {
            if (t == null || t.Type == JTokenType.Null || t.Type == JTokenType.Undefined) return "";
            return t.Type == JTokenType.String ? t.Value<string>() : t.ToString(Formatting.None);
        }

        private static double Numero(JToken t)
        {
            double n;
            return double.TryParse(Texto(t), System.Globalization.NumberStyles.Float,
                                   System.Globalization.CultureInfo.InvariantCulture, out n) ? n : 0;
        }

        private static bool Verdadeiro(JToken t)
        {
            if (t == null || t.Type == JTokenType.Null) return false;
            if (t.Type == JTokenType.Boolean) return t.Value<bool>();
            if (t.Type == JTokenType.Integer || t.Type == JTokenType.Float) return Numero(t) != 0;
            string s = Texto(t);
            return string.Equals(s, "true", StringComparison.OrdinalIgnoreCase) || s == "1";
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
            return null;
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

        /// <summary>Grava a imagem (base64) com nome aleatório. Retorna o nome do arquivo.</summary>
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
