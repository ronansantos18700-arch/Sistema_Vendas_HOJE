using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Newtonsoft.Json;
using System;
using System.IO;
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

                string baseDir = AppDomain.CurrentDomain.BaseDirectory;

                // Ambiente de desenvolvimento
                if (baseDir.Contains("\\bin\\Debug") || baseDir.Contains("\\bin\\Release"))
                {
                    string projectRoot = Path.GetFullPath(Path.Combine(baseDir, "..", ".."));
                    if (Directory.Exists(Path.Combine(projectRoot, "frontend")))
                    {
                        baseDir = projectRoot;
                    }
                }

                string frontendPath = Path.Combine(baseDir, "frontend");

                // Fallback
                if (!Directory.Exists(frontendPath))
                {
                    string assemblyDir = Path.GetDirectoryName(
                        new Uri(System.Reflection.Assembly.GetExecutingAssembly().CodeBase).LocalPath);

                    baseDir = assemblyDir;
                    frontendPath = Path.Combine(baseDir, "frontend");
                }

                // Mapeia domínio virtual para a pasta frontend
                // Elimina erros de "file: URLs are treated as unique origins"
                webView21.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local",
                    frontendPath,
                    CoreWebView2HostResourceAccessKind.Allow);

                string filepath = Path.Combine(frontendPath, "index.html");
               
                if (File.Exists(filepath))
                {
                    // Navega pelo domínio virtual em vez de file://
                    webView21.CoreWebView2.Navigate("https://app.local/index.html");
                }
                else
                {
                    MessageBox.Show("Arquivo index.html não encontrado.", "Erro",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro ao iniciar WebView2:\n" + ex.Message);
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

                if (result == DialogResult.Yes)
                {
                    Globals.ThisWorkbook.Save();
                    Globals.ThisWorkbook.Application.Quit();
                }
                else if (result == DialogResult.No)
                {
                    e.Cancel = true;
                }
            }
        }
    }
}