using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Newtonsoft.Json;
using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SistemaVendas
{
    public partial class FormVendas : Form
    {
        private Bridge _bridge;
        private WebView2 webView21;

        public FormVendas()
        {
            InitializeComponent();

            try
            {
                Database.Initialize();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro ao abrir o banco de dados:\n" + ex.Message, "Erro",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }

            // Criar WebView2 via código (NÃO usar no Designer)
            webView21 = new WebView2();
            webView21.Dock = DockStyle.Fill;
            this.Controls.Add(webView21);

            _bridge = new Bridge(this);
            IniciarWebview();
        }

        private async void IniciarWebview()
        {
            try
            {
                if (webView21 == null) return;

                string userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SistemaVendas_UNIQ");

                var environment = await CoreWebView2Environment.CreateAsync(
                    browserExecutableFolder: null,
                    userDataFolder: userDataFolder);

                await webView21.EnsureCoreWebView2Async(environment);

                // Desativa Tracking Prevention diretamente no perfil
                // (única forma confiável nas versões recentes do WebView2)
                if (webView21.CoreWebView2.Profile is CoreWebView2Profile profile)
                {
                    profile.PreferredTrackingPreventionLevel =
                        CoreWebView2TrackingPreventionLevel.None;
                }

                // Bridge com JS
                webView21.CoreWebView2.AddHostObjectToScript("bridge", _bridge);

                // O frontend vem do servidor central (mesmos arquivos, http://IP:5080/).
                // Sem servidor, o sistema não abre: os dados ficam só no servidor.
                string url = LerUrlServidor();
                while (!await ServidorDisponivel(url))
                {
                    DialogResult resposta = MessageBox.Show(
                        "Não foi possível conectar ao servidor de vendas (" + url + ").\n\n" +
                        "Verifique se o servidor está ligado e se o endereço no arquivo servidor.txt está certo.\n\n" +
                        "Tentar de novo?",
                        "Servidor indisponível",
                        MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
                    if (resposta != DialogResult.Retry)
                    {
                        Close();
                        return;
                    }
                }

                webView21.CoreWebView2.Navigate(url + "/");
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro ao iniciar WebView2:\n" + ex.Message);
            }
        }

        /// <summary>
        /// Endereço do servidor: linha de %LOCALAPPDATA%\SistemaVendas_UNIQ\servidor.txt
        /// (ex.: http://192.168.0.10:5080). Sem o arquivo, usa http://localhost:5080.
        /// </summary>
        private static string LerUrlServidor()
        {
            string url = "http://localhost:5080";
            try
            {
                string arquivo = Path.Combine(Path.GetDirectoryName(Database.Caminho), "servidor.txt");
                if (File.Exists(arquivo))
                {
                    foreach (string linha in File.ReadAllLines(arquivo))
                    {
                        string texto = linha.Trim();
                        if (texto.Length == 0 || texto.StartsWith("#")) continue;
                        url = texto;
                        break;
                    }
                }
            }
            catch (IOException)
            {
                // Arquivo em uso ou ilegível: segue com o endereço padrão.
            }

            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                url = "http://" + url;
            }
            return url.TrimEnd('/');
        }

        private static async Task<bool> ServidorDisponivel(string url)
        {
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) })
            {
                try
                {
                    HttpResponseMessage resposta = await http.GetAsync(url + "/api/saude");
                    return resposta.IsSuccessStatusCode;
                }
                catch (Exception)
                {
                    return false;
                }
            }
        }

        public void SendNotification(string type, string message)
        {
            if (webView21 != null && webView21.CoreWebView2 != null)
            {
                var notification = new { type = type, message = message };
                string json = JsonConvert.SerializeObject(notification);
                webView21.CoreWebView2.PostWebMessageAsJson(json);
            }
        }

        private void FormVendas_Load(object sender, EventArgs e)
        {
        }

        private void FormVendas_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                DialogResult result = MessageBox.Show(
                    "Deseja realmente fechar a aplicação?", "Confirmação",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);

                if (result == DialogResult.No)
                {
                    e.Cancel = true;
                }
            }
        }
    }
}