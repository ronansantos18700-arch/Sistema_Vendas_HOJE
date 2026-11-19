using System;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SV.Api.Seguranca;

namespace SV.Api.Servicos
{
    /// <summary>
    /// Acesso ao banco central. Usa a mesma camada SQLite do desktop (SistemaVendas.Database),
    /// com uma trava para uma gravação por vez.
    /// Usuários não passam pela rota genérica de dados: login, troca de senha e lista
    /// de usuários têm rotas próprias, para o cliente nunca enviar hash de senha.
    /// </summary>
    public static class Dados
    {
        /// <summary>Tipos que a rota genérica aceita. "users" fica de fora de propósito.</summary>
        public static readonly string[] TiposPublicos =
        {
            "products", "customers", "sales", "settings", "reversals",
            "entradas", "fechamentos", "categories", "movimentacoes", "caixa"
        };

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
            return null;
        }

        public static JObject BuscarUsuario(string usuario)
        {
            JArray lista = JArray.Parse(Ler("users"));
            foreach (JToken item in lista)
            {
                if (string.Equals((string)item["username"], usuario, StringComparison.Ordinal))
                {
                    return (JObject)item;
                }
            }
            return null;
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

        /// <summary>Grava a nova senha (hash) e desliga a senha provisória.</summary>
        public static void TrocarSenha(string usuario, string novoHash)
        {
            JObject registro = BuscarUsuario(usuario);
            if (registro == null) throw new InvalidOperationException("Usuário não encontrado.");

            registro["password"] = novoHash;
            registro["isDefaultCredential"] = false;

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
                throw new InvalidOperationException("Não foi possível gravar a nova senha.");
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
    }
}
