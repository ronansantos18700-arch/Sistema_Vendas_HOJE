using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;

namespace SV.Api.Seguranca
{
    public sealed class Sessao
    {
        public string Usuario;
        public string Nome;
        public string Papel;
        public DateTime UltimoUso;
    }

    /// <summary>
    /// Tokens de sessão guardados em memória. Ao reiniciar o servidor, todos entram de novo.
    /// </summary>
    public static class Sessoes
    {
        private static readonly TimeSpan Validade = TimeSpan.FromHours(12);
        private static readonly object _trava = new object();
        private static readonly Dictionary<string, Sessao> _sessoes = new Dictionary<string, Sessao>();

        public static string Criar(string usuario, string nome, string papel)
        {
            string token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            lock (_trava)
            {
                RemoverExpiradas();
                _sessoes[token] = new Sessao
                {
                    Usuario = usuario,
                    Nome = nome,
                    Papel = papel,
                    UltimoUso = DateTime.UtcNow
                };
            }
            return token;
        }

        public static Sessao Obter(string token)
        {
            if (string.IsNullOrEmpty(token)) return null;
            lock (_trava)
            {
                Sessao sessao;
                if (!_sessoes.TryGetValue(token, out sessao)) return null;
                if (DateTime.UtcNow - sessao.UltimoUso > Validade)
                {
                    _sessoes.Remove(token);
                    return null;
                }
                sessao.UltimoUso = DateTime.UtcNow;
                return sessao;
            }
        }

        /// <summary>Encerra todas as sessões (usado ao apagar todos os dados).</summary>
        public static void EncerrarTodas()
        {
            lock (_trava)
            {
                _sessoes.Clear();
            }
        }

        public static void Encerrar(string token)
        {
            if (string.IsNullOrEmpty(token)) return;
            lock (_trava)
            {
                _sessoes.Remove(token);
            }
        }

        private static void RemoverExpiradas()
        {
            var agora = DateTime.UtcNow;
            var vencidas = _sessoes.Where(p => agora - p.Value.UltimoUso > Validade)
                                   .Select(p => p.Key)
                                   .ToList();
            foreach (string chave in vencidas) _sessoes.Remove(chave);
        }
    }

    /// <summary>
    /// Bloqueio temporário após tentativas de senha erradas (mesmos números do app.js:
    /// 5 tentativas, 30 segundos).
    /// </summary>
    public static class ControleLogin
    {
        private const int MaximoTentativas = 5;
        private static readonly TimeSpan Bloqueio = TimeSpan.FromSeconds(30);
        private static readonly object _trava = new object();
        private static readonly Dictionary<string, int> _falhas = new Dictionary<string, int>();
        private static readonly Dictionary<string, DateTime> _bloqueadoAte = new Dictionary<string, DateTime>();

        public static bool Bloqueado(string usuario, out int segundosRestantes)
        {
            segundosRestantes = 0;
            string chave = Chave(usuario);
            lock (_trava)
            {
                DateTime ate;
                if (!_bloqueadoAte.TryGetValue(chave, out ate)) return false;
                TimeSpan restante = ate - DateTime.UtcNow;
                if (restante <= TimeSpan.Zero)
                {
                    _bloqueadoAte.Remove(chave);
                    _falhas.Remove(chave);
                    return false;
                }
                segundosRestantes = (int)Math.Ceiling(restante.TotalSeconds);
                return true;
            }
        }

        public static void RegistrarFalha(string usuario)
        {
            string chave = Chave(usuario);
            lock (_trava)
            {
                int total;
                _falhas.TryGetValue(chave, out total);
                total++;
                _falhas[chave] = total;
                if (total >= MaximoTentativas)
                {
                    _bloqueadoAte[chave] = DateTime.UtcNow.Add(Bloqueio);
                    _falhas[chave] = 0;
                }
            }
        }

        public static void Limpar(string usuario)
        {
            string chave = Chave(usuario);
            lock (_trava)
            {
                _falhas.Remove(chave);
                _bloqueadoAte.Remove(chave);
            }
        }

        private static string Chave(string usuario)
        {
            return (usuario ?? "").Trim().ToLowerInvariant();
        }
    }
}
