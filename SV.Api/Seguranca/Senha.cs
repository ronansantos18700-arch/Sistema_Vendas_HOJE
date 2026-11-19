using System;
using System.Security.Cryptography;
using System.Text;

namespace SV.Api.Seguranca
{
    /// <summary>
    /// Mesmo algoritmo de app.js (hashPassword): PBKDF2-HMAC-SHA256, 100.000 iterações,
    /// 256 bits, salt = "&lt;usuario em minúsculas&gt;_SV2024_&lt;tamanho do usuário&gt;",
    /// saída em hexadecimal minúsculo. Assim as senhas já gravadas continuam válidas.
    /// </summary>
    public static class Senha
    {
        public const int Iteracoes = 100000;
        public const int TamanhoMinimo = 6;

        public static string Gerar(string senha, string usuario)
        {
            byte[] salt = Encoding.UTF8.GetBytes(usuario.ToLowerInvariant() + "_SV2024_" + usuario.Length);
            byte[] chave = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(senha ?? ""),
                salt,
                Iteracoes,
                HashAlgorithmName.SHA256,
                32);
            return Convert.ToHexString(chave).ToLowerInvariant();
        }

        public static bool Conferir(string senha, string usuario, string hashGuardado)
        {
            if (string.IsNullOrEmpty(hashGuardado)) return false;
            byte[] calculado = Encoding.ASCII.GetBytes(Gerar(senha, usuario));
            byte[] guardado = Encoding.ASCII.GetBytes(hashGuardado.ToLowerInvariant());
            return CryptographicOperations.FixedTimeEquals(calculado, guardado);
        }
    }
}
