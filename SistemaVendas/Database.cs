using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Data.Sqlite;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace SistemaVendas
{
    /// <summary>
    /// Persistência em SQLite.
    /// Cada tipo enviado pelo frontend (products, sales, ...) corresponde a uma tabela
    /// com o mesmo nome. A gravação substitui o conteúdo da tabela, dentro de transação.
    /// Propriedades que não existem nas colunas são guardadas em "_extra" (JSON),
    /// para não perder dados se o frontend ganhar novos campos.
    /// A versão do esquema fica em PRAGMA user_version; migrações futuras entram em Initialize.
    /// </summary>
    public static class Database
    {
        /// <summary>Versão atual do esquema do banco.</summary>
        public const int VersaoEsquema = 2;

        private enum Tipo { Texto, Real, Inteiro, Booleano, Json }

        private sealed class Coluna
        {
            public readonly string Nome;
            public readonly Tipo Tipo;

            public Coluna(string nome, Tipo tipo)
            {
                Nome = nome;
                Tipo = tipo;
            }
        }

        private sealed class Tabela
        {
            public readonly string Nome;
            public readonly Coluna[] Colunas;

            // Documento: cada item é guardado inteiro como JSON na coluna "dados".
            public readonly bool Documento;

            public Tabela(string nome, bool documento, params Coluna[] colunas)
            {
                Nome = nome;
                Documento = documento;
                Colunas = colunas;
            }
        }

        private static Coluna T(string nome) { return new Coluna(nome, Tipo.Texto); }
        private static Coluna R(string nome) { return new Coluna(nome, Tipo.Real); }
        private static Coluna I(string nome) { return new Coluna(nome, Tipo.Inteiro); }
        private static Coluna B(string nome) { return new Coluna(nome, Tipo.Booleano); }
        private static Coluna J(string nome) { return new Coluna(nome, Tipo.Json); }

        private const string ColunaExtra = "_extra";

        private static readonly Tabela[] Tabelas =
        {
            new Tabela("products", false,
                T("id"), T("name"), T("code"), R("cost"), R("price"), I("stock"),
                T("image"), T("obs"), T("category")),

            new Tabela("customers", false,
                T("id"), T("name"), T("whatsapp"), T("email"), T("obs"), T("date"), T("image")),

            new Tabela("sales", false,
                T("id"), T("date"), T("cliente"), R("valor_total"), R("desconto"), R("valor_final"),
                R("cost"), R("lucro"), T("pagamento"), J("items")),

            new Tabela("settings", false,
                T("companyName"), T("ownerName"), T("whatsapp"), T("email"), T("address"), T("logoUrl")),

            new Tabela("reversals", false,
                T("id"), T("sale_id"), T("product_id"), T("product_name"), I("qty"), T("date")),

            new Tabela("users", false,
                T("id"), T("fullname"), T("username"), T("password"), T("role"), B("isDefaultCredential")),

            new Tabela("entradas", false,
                T("id"), T("date"), T("fornecedor"), T("nota"), T("obs"), J("items"), R("totalCusto")),

            new Tabela("fechamentos", false,
                T("id"), T("dataAbertura"), T("dataFechamento"), T("operador"),
                R("valorAbertura"), R("valorFechamento"), R("totalVendasDinheiro"),
                R("totalVendasCartao"), R("totalVendasPix"), R("totalGeral"), R("diferenca"),
                J("sangrias"), J("suprimentos")),

            new Tabela("categories", false, T("id"), T("name")),

            // Histórico de estoque e custo (versão 2). Campos extras (obs, ignorada) vão para _extra.
            new Tabela("movimentacoes", false,
                T("id"), T("date"), T("produtoId"), T("tipo"), I("qtd"), R("custoUnit"), T("refId")),

            new Tabela("caixa", true),
        };

        /// <summary>Caminho do arquivo do banco (mesma pasta de dados do WebView2).</summary>
        public static readonly string Caminho = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SistemaVendas_UNIQ",
            "sistema_vendas.db");

        /// <summary>Cria o arquivo, as tabelas e aplica migrações pendentes.</summary>
        public static void Initialize()
        {
            SQLitePCL.Batteries_V2.Init();
            Directory.CreateDirectory(Path.GetDirectoryName(Caminho));

            using (var conn = Abrir())
            using (var tx = conn.BeginTransaction())
            {
                int versao = LerVersaoEsquema(conn, tx);

                if (versao > VersaoEsquema)
                {
                    throw new InvalidOperationException(
                        "O banco foi criado por uma versão mais nova do sistema (esquema " + versao + ").");
                }

                // Migrações: CREATE TABLE IF NOT EXISTS cria só o que falta
                // (versão 2 acrescenta a tabela movimentacoes; bancos novos criam tudo).
                if (versao < VersaoEsquema)
                {
                    // Também cobre bancos criados antes do versionamento.
                    foreach (Tabela t in Tabelas)
                    {
                        using (var cmd = conn.CreateCommand())
                        {
                            cmd.Transaction = tx;
                            cmd.CommandText = SqlCriarTabela(t);
                            cmd.ExecuteNonQuery();
                        }
                    }
                }

                DefinirVersaoEsquema(conn, tx, VersaoEsquema);
                tx.Commit();
            }
        }

        /// <summary>Retorna os itens do tipo informado como string JSON (array).</summary>
        public static string Read(string type)
        {
            Tabela t = ObterTabela(type);
            if (t == null) return "[]";

            string colunas = t.Documento
                ? "\"dados\""
                : string.Join(", ", t.Colunas.Select(c => Q(c.Nome)).Concat(new[] { Q(ColunaExtra) }));

            var resultado = new JArray();

            using (var conn = Abrir())
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT " + colunas + " FROM " + Q(t.Nome) + " ORDER BY \"ordem\"";

                using (var rd = cmd.ExecuteReader())
                {
                    while (rd.Read())
                    {
                        if (t.Documento)
                        {
                            resultado.Add(LerJson(rd.GetString(0)));
                            continue;
                        }

                        var obj = new JObject();
                        for (int i = 0; i < t.Colunas.Length; i++)
                        {
                            obj[t.Colunas[i].Nome] = LerValor(rd, i, t.Colunas[i].Tipo);
                        }

                        int idxExtra = t.Colunas.Length;
                        if (!rd.IsDBNull(idxExtra))
                        {
                            var extra = Parse(rd.GetString(idxExtra)) as JObject;
                            if (extra != null)
                            {
                                foreach (JProperty p in extra.Properties())
                                {
                                    if (obj[p.Name] == null)
                                        obj[p.Name] = p.Value.DeepClone();
                                }
                            }
                        }

                        resultado.Add(obj);
                    }
                }
            }

            return JsonConvert.SerializeObject(resultado, Formatting.None);
        }

        /// <summary>Substitui o conteúdo de um tipo (transação própria).</summary>
        public static bool Replace(string type, string json)
        {
            Tabela t = ObterTabela(type);
            if (t == null) return false;

            using (var conn = Abrir())
            using (var tx = conn.BeginTransaction())
            {
                GravarTabela(conn, tx, t, Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json));
                tx.Commit();
            }

            return true;
        }

        /// <summary>
        /// Grava todas as coleções recebidas em UMA transação: ou tudo é gravado, ou nada.
        /// O JSON é um objeto cujas chaves são tipos (products, sales, caixa, ...).
        /// Se algum tipo for desconhecido, nada é gravado.
        /// </summary>
        public static bool ReplaceAll(string json)
        {
            JToken raiz = Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            var colecoes = raiz as JObject;
            if (colecoes == null) return false;

            // Valida tudo antes de abrir a transação.
            var pendentes = new List<KeyValuePair<Tabela, JToken>>();
            foreach (JProperty prop in colecoes.Properties())
            {
                Tabela t = ObterTabela(prop.Name);
                if (t == null) return false;
                pendentes.Add(new KeyValuePair<Tabela, JToken>(t, prop.Value));
            }

            using (var conn = Abrir())
            using (var tx = conn.BeginTransaction())
            {
                foreach (KeyValuePair<Tabela, JToken> par in pendentes)
                {
                    GravarTabela(conn, tx, par.Key, par.Value);
                }
                tx.Commit();
            }

            return true;
        }

        // ---------------------------------------------------------------
        // Gravação
        // ---------------------------------------------------------------

        /// <summary>Apaga o conteúdo da tabela e insere os itens. Usa a transação recebida.</summary>
        private static void GravarTabela(SqliteConnection conn, SqliteTransaction tx, Tabela t, JToken raiz)
        {
            List<JObject> itens = ItensDoJson(raiz);

            Executar(conn, tx, "DELETE FROM " + Q(t.Nome));

            foreach (JObject item in itens)
            {
                InserirItem(conn, tx, t, item);
            }
        }

        private static List<JObject> ItensDoJson(JToken raiz)
        {
            var itens = new List<JObject>();
            if (raiz is JArray lista)
            {
                foreach (JToken tok in lista)
                {
                    if (tok is JObject o) itens.Add(o);
                }
            }
            else if (raiz is JObject unico)
            {
                itens.Add(unico);
            }
            return itens;
        }

        /// <summary>Insere um item. A coluna "ordem" é preenchida automaticamente (fica no fim da lista).</summary>
        private static void InserirItem(SqliteConnection conn, SqliteTransaction tx, Tabela t, JObject item)
        {
            using (var ins = conn.CreateCommand())
            {
                ins.Transaction = tx;

                if (t.Documento)
                {
                    ins.CommandText = "INSERT INTO " + Q(t.Nome) + " (\"dados\") VALUES (@p0)";
                    ins.Parameters.AddWithValue("@p0", JsonConvert.SerializeObject(item, Formatting.None));
                }
                else
                {
                    List<KeyValuePair<string, object>> valores = ValoresDoItem(t, item);
                    var nomes = new List<string>();
                    var parametros = new List<string>();

                    for (int i = 0; i < valores.Count; i++)
                    {
                        nomes.Add(Q(valores[i].Key));
                        parametros.Add("@p" + i);
                        ins.Parameters.AddWithValue("@p" + i, valores[i].Value);
                    }

                    ins.CommandText = "INSERT INTO " + Q(t.Nome) +
                                      " (" + string.Join(", ", nomes) + ")" +
                                      " VALUES (" + string.Join(", ", parametros) + ")";
                }

                ins.ExecuteNonQuery();
            }
        }

        /// <summary>Atualiza o registro com o mesmo id; se não existir, insere no fim.</summary>
        private static void AplicarUpsert(SqliteConnection conn, SqliteTransaction tx, Tabela t, JObject item)
        {
            string id = IdDoToken(item["id"]);
            long? ordem = BuscarOrdem(conn, tx, t, id);

            if (!ordem.HasValue)
            {
                InserirItem(conn, tx, t, item);
                return;
            }

            List<KeyValuePair<string, object>> valores = ValoresDoItem(t, item);
            var atribuicoes = new List<string>();

            using (var upd = conn.CreateCommand())
            {
                upd.Transaction = tx;

                for (int i = 0; i < valores.Count; i++)
                {
                    atribuicoes.Add(Q(valores[i].Key) + " = @p" + i);
                    upd.Parameters.AddWithValue("@p" + i, valores[i].Value);
                }

                upd.Parameters.AddWithValue("@ordem", ordem.Value);
                upd.CommandText = "UPDATE " + Q(t.Nome) + " SET " + string.Join(", ", atribuicoes) +
                                  " WHERE \"ordem\" = @ordem";
                upd.ExecuteNonQuery();
            }
        }

        private static long? BuscarOrdem(SqliteConnection conn, SqliteTransaction tx, Tabela t, string id)
        {
            using (var sel = conn.CreateCommand())
            {
                sel.Transaction = tx;
                sel.CommandText = "SELECT \"ordem\" FROM " + Q(t.Nome) +
                                  " WHERE \"id\" = @id ORDER BY \"ordem\" LIMIT 1";
                sel.Parameters.AddWithValue("@id", id);

                object resultado = sel.ExecuteScalar();
                if (resultado == null || resultado == DBNull.Value) return null;
                return Convert.ToInt64(resultado, CultureInfo.InvariantCulture);
            }
        }

        private static void ExcluirItem(SqliteConnection conn, SqliteTransaction tx, Tabela t, string id)
        {
            using (var del = conn.CreateCommand())
            {
                del.Transaction = tx;
                del.CommandText = "DELETE FROM " + Q(t.Nome) + " WHERE \"id\" = @id";
                del.Parameters.AddWithValue("@id", id);
                del.ExecuteNonQuery();
            }
        }

        /// <summary>
        /// Define a ordem dos registros conforme a lista de ids recebida (posições 1..N).
        /// Usa valores negativos temporários para não conflitar com a chave "ordem".
        /// </summary>
        private static void AplicarOrdem(SqliteConnection conn, SqliteTransaction tx, Tabela t, List<string> ids)
        {
            // 1) Todas as posições viram negativas (únicas e fora do caminho).
            Executar(conn, tx, "UPDATE " + Q(t.Nome) + " SET \"ordem\" = -\"ordem\"");

            // 2) Cada id recebe sua posição definitiva.
            long posicao = 1;
            foreach (string id in ids)
            {
                using (var upd = conn.CreateCommand())
                {
                    upd.Transaction = tx;
                    upd.CommandText = "UPDATE " + Q(t.Nome) +
                                      " SET \"ordem\" = @pos WHERE \"id\" = @id AND \"ordem\" < 0";
                    upd.Parameters.AddWithValue("@pos", posicao);
                    upd.Parameters.AddWithValue("@id", id);
                    upd.ExecuteNonQuery();
                }
                posicao++;
            }

            // 3) Nenhum registro pode ficar sem posição (lança erro e desfaz a transação).
            using (var cont = conn.CreateCommand())
            {
                cont.Transaction = tx;
                cont.CommandText = "SELECT COUNT(*) FROM " + Q(t.Nome) + " WHERE \"ordem\" < 0";
                long pendentes = Convert.ToInt64(cont.ExecuteScalar(), CultureInfo.InvariantCulture);
                if (pendentes > 0)
                {
                    throw new InvalidOperationException("Ordem inconsistente na tabela " + t.Nome + ".");
                }
            }
        }

        /// <summary>
        /// Aplica mudanças incrementais em uma única transação. Formato por coleção:
        ///   { "full": [ ... ] }                              regrava a tabela inteira
        ///   { "upsert": [ ... ], "delete": ["id", ...], "order": ["id", ...] }
        /// Se algo falhar, nenhuma alteração é gravada.
        /// </summary>
        public static bool ApplyChanges(string json)
        {
            JToken raiz = Parse(string.IsNullOrWhiteSpace(json) ? "{}" : json);
            var colecoes = raiz as JObject;
            if (colecoes == null) return false;

            // Valida tudo antes de abrir a transação.
            var plano = new List<KeyValuePair<Tabela, JObject>>();
            foreach (JProperty prop in colecoes.Properties())
            {
                Tabela t = ObterTabela(prop.Name);
                var mudanca = prop.Value as JObject;
                if (t == null || mudanca == null || !MudancaValida(t, mudanca)) return false;
                plano.Add(new KeyValuePair<Tabela, JObject>(t, mudanca));
            }

            using (var conn = Abrir())
            using (var tx = conn.BeginTransaction())
            {
                foreach (KeyValuePair<Tabela, JObject> par in plano)
                {
                    AplicarMudanca(conn, tx, par.Key, par.Value);
                }
                tx.Commit();
            }

            return true;
        }

        private static bool MudancaValida(Tabela t, JObject mudanca)
        {
            if (mudanca["full"] != null)
            {
                return mudanca.Count == 1 && mudanca["full"] is JArray;
            }

            // Tabelas de documento (caixa) aceitam apenas "full".
            if (t.Documento) return false;

            foreach (JProperty p in mudanca.Properties())
            {
                if (p.Name != "upsert" && p.Name != "delete" && p.Name != "order") return false;
                if (!(p.Value is JArray)) return false;
            }

            return true;
        }

        private static void AplicarMudanca(SqliteConnection conn, SqliteTransaction tx, Tabela t, JObject mudanca)
        {
            if (mudanca["full"] != null)
            {
                GravarTabela(conn, tx, t, mudanca["full"]);
                return;
            }

            if (mudanca["delete"] is JArray remover)
            {
                foreach (JToken tok in remover)
                {
                    ExcluirItem(conn, tx, t, IdDoToken(tok));
                }
            }

            if (mudanca["upsert"] is JArray upserts)
            {
                foreach (JToken tok in upserts)
                {
                    var item = tok as JObject;
                    if (item == null) throw new InvalidOperationException("Registro inválido em " + t.Nome + ".");
                    AplicarUpsert(conn, tx, t, item);
                }
            }

            // A ordem é aplicada por último, depois de inserções e exclusões.
            if (mudanca["order"] is JArray ordem)
            {
                List<string> ids = ordem.Select(IdDoToken).ToList();
                AplicarOrdem(conn, tx, t, ids);
            }
        }

        private static string IdDoToken(JToken token)
        {
            var valor = token as JValue;
            string id = valor != null && valor.Value != null
                ? Convert.ToString(valor.Value, CultureInfo.InvariantCulture)
                : null;

            if (string.IsNullOrEmpty(id)) throw new InvalidOperationException("Registro sem id.");
            return id;
        }

        /// <summary>Valores das colunas do item, incluindo "_extra" com as propriedades sem coluna própria.</summary>
        private static List<KeyValuePair<string, object>> ValoresDoItem(Tabela t, JObject item)
        {
            var valores = new List<KeyValuePair<string, object>>();
            var nomesColunas = new HashSet<string>();

            foreach (Coluna col in t.Colunas)
            {
                nomesColunas.Add(col.Nome);
                valores.Add(new KeyValuePair<string, object>(col.Nome, ParaBanco(item[col.Nome], col.Tipo)));
            }

            var extra = new JObject();
            foreach (JProperty p in item.Properties())
            {
                if (!nomesColunas.Contains(p.Name))
                    extra[p.Name] = p.Value.DeepClone();
            }

            object valorExtra = extra.Count > 0
                ? (object)JsonConvert.SerializeObject(extra, Formatting.None)
                : DBNull.Value;
            valores.Add(new KeyValuePair<string, object>(ColunaExtra, valorExtra));

            return valores;
        }

        private static void Executar(SqliteConnection conn, SqliteTransaction tx, string sql)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = sql;
                cmd.ExecuteNonQuery();
            }
        }

        // ---------------------------------------------------------------
        // Versão do esquema
        // ---------------------------------------------------------------

        private static int LerVersaoEsquema(SqliteConnection conn, SqliteTransaction tx)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "PRAGMA user_version";
                return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
            }
        }

        private static void DefinirVersaoEsquema(SqliteConnection conn, SqliteTransaction tx, int versao)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                // Valor interno (constante), não vem do usuário; PRAGMA não aceita parâmetros.
                cmd.CommandText = "PRAGMA user_version = " + versao.ToString(CultureInfo.InvariantCulture);
                cmd.ExecuteNonQuery();
            }
        }

        // ---------------------------------------------------------------
        // Auxiliares
        // ---------------------------------------------------------------

        private static SqliteConnection Abrir()
        {
            var builder = new SqliteConnectionStringBuilder { DataSource = Caminho };
            var conn = new SqliteConnection(builder.ToString());
            conn.Open();
            return conn;
        }

        private static Tabela ObterTabela(string type)
        {
            if (string.IsNullOrEmpty(type)) return null;
            foreach (Tabela t in Tabelas)
            {
                if (string.Equals(t.Nome, type, StringComparison.OrdinalIgnoreCase)) return t;
            }
            return null;
        }

        private static string Q(string identificador)
        {
            return "\"" + identificador.Replace("\"", "\"\"") + "\"";
        }

        private static string SqlTipo(Tipo tipo)
        {
            switch (tipo)
            {
                case Tipo.Real: return "REAL";
                case Tipo.Inteiro:
                case Tipo.Booleano: return "INTEGER";
                default: return "TEXT";
            }
        }

        private static string SqlCriarTabela(Tabela t)
        {
            var defs = new List<string> { "\"ordem\" INTEGER PRIMARY KEY" };

            if (t.Documento)
            {
                defs.Add("\"dados\" TEXT NOT NULL");
            }
            else
            {
                foreach (Coluna c in t.Colunas)
                    defs.Add(Q(c.Nome) + " " + SqlTipo(c.Tipo));
                defs.Add(Q(ColunaExtra) + " TEXT");
            }

            return "CREATE TABLE IF NOT EXISTS " + Q(t.Nome) + " (" + string.Join(", ", defs) + ")";
        }

        private static JToken LerValor(SqliteDataReader rd, int indice, Tipo tipo)
        {
            if (rd.IsDBNull(indice)) return JValue.CreateNull();

            switch (tipo)
            {
                case Tipo.Real: return new JValue(rd.GetDouble(indice));
                case Tipo.Inteiro: return new JValue(rd.GetInt64(indice));
                case Tipo.Booleano: return new JValue(rd.GetInt64(indice) != 0);
                case Tipo.Json: return LerJson(rd.GetString(indice));
                default: return new JValue(rd.GetString(indice));
            }
        }

        /// <summary>Converte o texto guardado em JSON de volta para objeto; se não for JSON válido, devolve o texto.</summary>
        private static JToken LerJson(string texto)
        {
            if (texto == null) return JValue.CreateNull();
            try
            {
                return Parse(texto);
            }
            catch (JsonReaderException)
            {
                return new JValue(texto);
            }
        }

        /// <summary>Parse sem converter strings de data (mantém o texto original).</summary>
        private static JToken Parse(string texto)
        {
            using (var reader = new JsonTextReader(new StringReader(texto))
            {
                DateParseHandling = DateParseHandling.None
            })
            {
                return JToken.ReadFrom(reader);
            }
        }

        private static object ParaBanco(JToken valor, Tipo tipo)
        {
            bool nulo = valor == null || valor.Type == JTokenType.Null || valor.Type == JTokenType.Undefined;

            switch (tipo)
            {
                case Tipo.Texto:
                    if (nulo) return DBNull.Value;
                    if (valor is JValue jv) return Convert.ToString(jv.Value, CultureInfo.InvariantCulture);
                    return JsonConvert.SerializeObject(valor, Formatting.None);

                case Tipo.Real:
                    return ToDouble(valor);

                case Tipo.Inteiro:
                    return (long)Math.Round(ToDouble(valor));

                case Tipo.Booleano:
                    return ToBool(valor) ? 1L : 0L;

                case Tipo.Json:
                    if (nulo) return "[]";
                    if (valor is JValue jsonStr && jsonStr.Type == JTokenType.String)
                        return jsonStr.Value<string>();
                    return JsonConvert.SerializeObject(valor, Formatting.None);

                default:
                    return DBNull.Value;
            }
        }

        private static double ToDouble(JToken valor)
        {
            if (valor is JValue jv)
            {
                switch (jv.Type)
                {
                    case JTokenType.Integer:
                    case JTokenType.Float:
                        return Convert.ToDouble(jv.Value, CultureInfo.InvariantCulture);
                    case JTokenType.String:
                        double d;
                        return double.TryParse(jv.Value<string>(), NumberStyles.Float,
                            CultureInfo.InvariantCulture, out d) ? d : 0;
                    case JTokenType.Boolean:
                        return (bool)jv.Value ? 1 : 0;
                }
            }
            return 0;
        }

        private static bool ToBool(JToken valor)
        {
            if (valor is JValue jv)
            {
                switch (jv.Type)
                {
                    case JTokenType.Boolean:
                        return (bool)jv.Value;
                    case JTokenType.Integer:
                    case JTokenType.Float:
                        return Convert.ToDouble(jv.Value, CultureInfo.InvariantCulture) != 0;
                    case JTokenType.String:
                        string s = jv.Value<string>();
                        return string.Equals(s, "true", StringComparison.OrdinalIgnoreCase)
                            || s == "1"
                            || string.Equals(s, "sim", StringComparison.OrdinalIgnoreCase);
                }
            }
            return false;
        }
    }
}
