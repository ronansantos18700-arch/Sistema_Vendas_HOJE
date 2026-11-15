using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.IO;

namespace SistemaVendas
{
    [ComVisible(true)]
    public class Bridge
    {
        private readonly FormVendas _form;
        private static readonly object _lock = new object();

        public Bridge(FormVendas form)
        {
            _form = form;
        }

        public string SelectFile()
        {
            string selectedPath = null;
            try
            {
                _form.Invoke(new Action(() =>
                {
                    using (OpenFileDialog openFileDialog = new OpenFileDialog())
                    {
                        openFileDialog.Title = "Selecione a imagem";
                        openFileDialog.Filter = "Imagens (*.jpg;*.jpeg;*.png;*.bmp)|*.jpg;*.jpeg;*.png;*.bmp";
                        openFileDialog.Multiselect = false;

                        if (openFileDialog.ShowDialog(_form) == DialogResult.OK)
                        {
                            try
                            {
                                string sourceFile = openFileDialog.FileName;
                                string fileName = Guid.NewGuid().ToString() + Path.GetExtension(sourceFile);

                                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                                if (baseDir.Contains("\\bin\\Debug") || baseDir.Contains("\\bin\\Release"))
                                {
                                    string projectRoot = Path.GetFullPath(Path.Combine(baseDir, "..", ".."));
                                    if (Directory.Exists(Path.Combine(projectRoot, "frontend")))
                                        baseDir = projectRoot;
                                }

                                string destDir = Path.Combine(baseDir, "frontend", "images");
                                if (!Directory.Exists(destDir)) Directory.CreateDirectory(destDir);

                                string destFile = Path.Combine(destDir, fileName);
                                File.Copy(sourceFile, destFile, true);

                                selectedPath = "images/" + fileName;
                            }
                            catch (Exception ex)
                            {
                                MessageBox.Show("Erro ao copiar arquivo: " + ex.Message);
                            }
                        }
                    }
                }));
            }
            catch (Exception ex)
            {
                _form.SendNotification("error", "Erro ao selecionar arquivo: " + ex.Message);
            }
            return selectedPath;
        }

        /// <summary>Lê todos os itens de um tipo (products, sales, ...) do SQLite, como JSON.</summary>
        public string GetData(string type)
        {
            lock (_lock)
            {
                try
                {
                    return Database.Read(type);
                }
                catch (Exception ex)
                {
                    NotifyError("Erro ao ler dados de " + type + ": " + ex.Message);
                    return "[]";
                }
            }
        }

        /// <summary>Substitui todos os itens de um tipo pelo JSON recebido do frontend.</summary>
        public bool SaveData(string type, string jsonData)
        {
            lock (_lock)
            {
                try
                {
                    return Database.Replace(type, jsonData);
                }
                catch (Exception ex)
                {
                    NotifyError("Erro ao salvar dados de " + type + ": " + ex.Message);
                    return false;
                }
            }
        }

        /// <summary>
        /// Grava todas as coleções em uma única transação (tudo ou nada).
        /// JSON: objeto com chaves de tipo, ex.: {"products": [...], "sales": [...]}.
        /// </summary>
        public bool SaveAll(string jsonData)
        {
            lock (_lock)
            {
                try
                {
                    return Database.ReplaceAll(jsonData);
                }
                catch (Exception ex)
                {
                    NotifyError("Erro ao salvar dados: " + ex.Message);
                    return false;
                }
            }
        }

        /// <summary>
        /// Aplica somente as mudanças (inserções, alterações, exclusões e ordem) em uma transação.
        /// Veja Database.ApplyChanges para o formato do JSON.
        /// </summary>
        public bool SaveChanges(string jsonData)
        {
            lock (_lock)
            {
                try
                {
                    return Database.ApplyChanges(jsonData);
                }
                catch (Exception ex)
                {
                    NotifyError("Erro ao salvar alterações: " + ex.Message);
                    return false;
                }
            }
        }

        private void NotifyError(string message)
        {
            string traduzido = message.Replace("products", "Produtos")
                                     .Replace("customers", "Clientes")
                                     .Replace("sales", "Vendas");
            _form.SendNotification("error", traduzido);
        }

        private void NotifySuccess(string message)
        {
            string traduzido = message.Replace("products", "Produtos")
                                     .Replace("customers", "Clientes")
                                     .Replace("sales", "Vendas");
            _form.SendNotification("success", traduzido);
        }

        public string GetFileBase64(string relativePath)
        {
            try
            {
                if (string.IsNullOrEmpty(relativePath)) return null;

                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                if (baseDir.Contains("\\bin\\Debug") || baseDir.Contains("\\bin\\Release"))
                {
                    string projectRoot = Path.GetFullPath(Path.Combine(baseDir, "..", ".."));
                    if (Directory.Exists(Path.Combine(projectRoot, "frontend")))
                        baseDir = projectRoot;
                }

                string fullPath = Path.Combine(baseDir, "frontend", relativePath.Replace("/", "\\"));

                if (File.Exists(fullPath))
                {
                    byte[] bytes = File.ReadAllBytes(fullPath);
                    string extension = Path.GetExtension(fullPath).ToLower();
                    string mimeType = "image/png";
                    if (extension == ".jpg" || extension == ".jpeg") mimeType = "image/jpeg";
                    else if (extension == ".gif") mimeType = "image/gif";
                    else if (extension == ".webp") mimeType = "image/webp";

                    return $"data:{mimeType};base64,{Convert.ToBase64String(bytes)}";
                }
                return null;
            }
            catch (Exception ex)
            {
                NotifyError("Erro ao ler arquivo " + relativePath + ": " + ex.Message);
                return null;
            }
        }

        public bool RestoreImage(string relativePath, string base64Data)
        {
            try
            {
                if (string.IsNullOrEmpty(relativePath) || string.IsNullOrEmpty(base64Data)) return false;

                if (base64Data.Contains(","))
                {
                    base64Data = base64Data.Split(',')[1];
                }

                byte[] imageBytes = Convert.FromBase64String(base64Data);

                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                if (baseDir.Contains("\\bin\\Debug") || baseDir.Contains("\\bin\\Release"))
                {
                    string projectRoot = Path.GetFullPath(Path.Combine(baseDir, "..", ".."));
                    if (Directory.Exists(Path.Combine(projectRoot, "frontend")))
                        baseDir = projectRoot;
                }

                string fullPath = Path.Combine(baseDir, "frontend", relativePath.Replace("/", "\\"));
                string directory = Path.GetDirectoryName(fullPath);

                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllBytes(fullPath, imageBytes);
                return true;
            }
            catch (Exception ex)
            {
                NotifyError("Erro ao restaurar imagem " + relativePath + ": " + ex.Message);
                return false;
            }
        }

        public void MinimizeWindow()
        {
            try
            {
                _form.Invoke(new Action(() =>
                {
                    _form.WindowState = FormWindowState.Minimized;
                }));
            }
            catch (Exception ex)
            {
                NotifyError("Erro ao minimizar janela: " + ex.Message);
            }
        }

        public void QuitApplication()
        {
            try
            {
                _form.Invoke(new Action(() =>
                {
                    _form.Close();
                }));
            }
            catch (Exception ex)
            {
                NotifyError("Erro ao fechar aplicação: " + ex.Message);
            }
        }
    }
}
