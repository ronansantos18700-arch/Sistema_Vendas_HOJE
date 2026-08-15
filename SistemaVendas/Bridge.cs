using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Newtonsoft.Json;
using Excel = Microsoft.Office.Interop.Excel;
using Office = Microsoft.Office.Core;
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

        public string GetData(string type)
        {
            lock (_lock)
            {
                try
                {
                    Excel.Worksheet sheet = GetSheetByType(type);
                    if (sheet == null) return "[]";

                    Excel.Range range = sheet.UsedRange;
                    int rows = range.Rows.Count;

                    if (rows <= 1) return "[]";

                    var dataList = new List<Dictionary<string, object>>();
                    var headers = new List<string>();

                    int colCount = 0;
                    while (true)
                    {
                        colCount++;
                        if (colCount > range.Columns.Count) break;
                        string header = Convert.ToString(range.Cells[1, colCount].Value2);
                        if (string.IsNullOrEmpty(header)) break;
                        headers.Add(header);
                    }

                    object[,] values = range.Value2 as object[,];
                    if (values == null) return "[]";

                    for (int r = 2; r <= rows; r++)
                    {
                        var rowDict = new Dictionary<string, object>();
                        bool hasData = false;
                        for (int c = 1; c <= headers.Count; c++)
                        {
                            object val = values[r, c];
                            if (val != null) hasData = true;

                            if (val is double d && (headers[c - 1].Equals("Data", StringComparison.OrdinalIgnoreCase) || headers[c - 1].Equals("date", StringComparison.OrdinalIgnoreCase)))
                            {
                                try
                                {
                                    DateTime dt = DateTime.FromOADate(d);
                                    val = dt.ToString("yyyy-MM-ddTHH:mm:ssZ");
                                }
                                catch { }
                            }
                            else if (val is DateTime dt)
                            {
                                val = dt.ToString("yyyy-MM-ddTHH:mm:ssZ");
                            }

                            rowDict[headers[c - 1]] = val;
                        }
                        if (hasData) dataList.Add(rowDict);
                    }

                    return JsonConvert.SerializeObject(dataList);
                }
                catch (Exception ex)
                {
                    NotifyError("Erro ao ler dados de " + type + ": " + ex.Message);
                    return "[]";
                }
            }
        }

        public bool SaveData(string type, string jsonData)
        {
            lock (_lock)
            {
                try
                {
                    var data = JsonConvert.DeserializeObject<List<Dictionary<string, object>>>(jsonData);
                    Excel.Worksheet sheet = GetSheetByType(type);
                    if (sheet == null) return false;

                    Excel.Range usedRange = sheet.UsedRange;
                    if (usedRange.Rows.Count > 1)
                    {
                        Excel.Range dataRows = sheet.Range[sheet.Cells[2, 1], sheet.Cells[Math.Max(2, usedRange.Rows.Count), usedRange.Columns.Count]];
                        dataRows.ClearContents();
                    }

                    if (data == null || data.Count == 0) return true;

                    var headers = new List<string>();
                    int colCount = 0;
                    while (true)
                    {
                        colCount++;
                        string header = Convert.ToString(sheet.Cells[1, colCount].Value2);
                        if (string.IsNullOrEmpty(header)) break;
                        headers.Add(header);
                    }

                    bool needsReinit = false;
                    if (type.ToLower() == "sales" && !headers.Any(h => h.ToLower() == "desconto")) needsReinit = true;
                    if (type.ToLower() == "sales" && !headers.Any(h => h.ToLower() == "valor_final")) needsReinit = true;
                    if (type.ToLower() == "sales" && !headers.Any(h => h.ToLower() == "items")) needsReinit = true;
                    if (type.ToLower() == "products" && !headers.Any(h => h.ToLower() == "cost")) needsReinit = true;
                    if (type.ToLower() == "products" && !headers.Any(h => h.ToLower() == "category")) needsReinit = true;
                    if (needsReinit)
                    {
                        InitializeHeaders(sheet, type.ToLower());
                        headers.Clear();
                        colCount = 0;
                        while (true)
                        {
                            colCount++;
                            string header = Convert.ToString(sheet.Cells[1, colCount].Value2);
                            if (string.IsNullOrEmpty(header)) break;
                            headers.Add(header);
                        }
                    }

                    object[,] values = new object[data.Count, headers.Count];

                    for (int r = 0; r < data.Count; r++)
                    {
                        for (int c = 0; c < headers.Count; c++)
                        {
                            string header = headers[c];
                            string key = MapHeaderToKey(header);

                            if (data[r].ContainsKey(key))
                            {
                                object value = data[r][key];
                                if (value != null && (key.Equals("Data", StringComparison.OrdinalIgnoreCase) || key.Equals("date", StringComparison.OrdinalIgnoreCase)))
                                {
                                    if (DateTime.TryParse(value.ToString(), null, System.Globalization.DateTimeStyles.RoundtripKind, out DateTime dt))
                                        value = dt;
                                }

                                if (value != null && (value is Newtonsoft.Json.Linq.JToken || value.GetType().IsClass && !(value is string) && !(value is DateTime)))
                                {
                                    value = JsonConvert.SerializeObject(value);
                                }

                                values[r, c] = value;
                            }
                        }
                    }

                    Excel.Range targetRange = sheet.Range[sheet.Cells[2, 1], sheet.Cells[data.Count + 1, headers.Count]];
                    targetRange.Value2 = values;

                    SaveWorkbook();
                    return true;
                }
                catch (Exception ex)
                {
                    NotifyError("Erro ao salvar dados de " + type + ": " + ex.Message);
                    return false;
                }
            }
        }

        private void SaveWorkbook()
        {
            try
            {
                Excel.Workbook wb = Globals.ThisWorkbook.Application.ActiveWorkbook;
                if (wb != null)
                {
                    wb.Save();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Erro ao salvar workbook: " + ex.Message);
            }
        }

        private string MapHeaderToKey(string header)
        {
            switch (header.ToLower())
            {
                case "id": return "id";
                case "name": case "nome": case "produto": return "name";
                case "code": case "código": case "codigo": return "code";
                case "cost": case "custo": return "cost";
                case "price": case "preço": case "preco": return "price";
                case "stock": case "estoque": return "stock";
                case "image": case "imagem": return "image";
                case "obs": case "observação": case "observacao": return "obs";
                case "whatsapp": return "whatsapp";
                case "email": return "email";
                case "date": case "data": return "date";
                case "cliente": return "cliente";
                case "valor_total": case "valor total": return "valor_total";
                case "valor_final": case "valor final": return "valor_final";
                case "desconto": return "desconto";
                case "lucro": return "lucro";
                case "pagamento": case "forma de pagamento": return "pagamento";
                case "items": case "itens": return "items";
                case "companyname": case "razao_social": case "razão social": return "companyName";
                case "ownername": case "responsavel": case "responsável": return "ownerName";
                case "address": case "endereco": case "endereço": return "address";
                case "logourl": case "foto": return "logoUrl";
                case "sale_id": return "sale_id";
                case "product_id": return "product_id";
                case "product_name": return "product_name";
                case "qty": return "qty";
                // Mapeamentos para usuários
                case "username": return "username";
                case "fullname": case "nome completo": return "fullname";
                case "password": case "senha": return "password";
                case "role": case "perfil": return "role";
                case "isdefaultcredential": return "isDefaultCredential";
                // Mapeamentos para Entradas
                case "fornecedor": return "fornecedor";
                case "nota": return "nota";
                case "totalcusto": case "totalCusto": return "totalCusto";
                // Mapeamentos para Fechamentos
                case "dataabertura": return "dataAbertura";
                case "datafechamento": return "dataFechamento";
                case "operador": return "operador";
                case "valorabertura": return "valorAbertura";
                case "valorfechamento": return "valorFechamento";
                case "totalvendasdinheiro": return "totalVendasDinheiro";
                case "totalvendascartao": return "totalVendasCartao";
                case "totalvendaspix": return "totalVendasPix";
                case "totalgeral": return "totalGeral";
                case "diferenca": return "diferenca";
                case "sangrias": return "sangrias";
                case "suprimentos": return "suprimentos";
                case "category": case "categoria": return "category";
                default: return header;
            }
        }

        private Excel.Worksheet GetSheetByType(string type)
        {
            string sheetName = "";
            switch (type.ToLower())
            {
                case "products": sheetName = "produtos"; break;
                case "customers": sheetName = "clientes"; break;
                case "sales": sheetName = "Planilha1"; break;
                case "settings": sheetName = "configuracoes"; break;
                case "reversals": sheetName = "extornos"; break;
                case "users": sheetName = "usuarios"; break;
                case "entradas": sheetName = "entradas"; break;
                case "fechamentos": sheetName = "fechamentos"; break;
                case "categories": sheetName = "categorias"; break;
                default: return null;
            }

            try
            {
                Excel.Workbook wb = Globals.ThisWorkbook.Application.ActiveWorkbook;
                foreach (Excel.Worksheet sh in wb.Worksheets)
                {
                    if (sh.Name == sheetName) return sh;
                }

                // Se não existir, cria a planilha com os cabeçalhos corretos
                Excel.Worksheet newSheet = wb.Worksheets.Add(After: wb.Worksheets[wb.Worksheets.Count]) as Excel.Worksheet;
                newSheet.Name = sheetName;
                InitializeHeaders(newSheet, type.ToLower());
                return newSheet;
            }
            catch (Exception ex)
            {
                NotifyError("Erro ao acessar planilha: " + ex.Message);
                return null;
            }
        }

        private void InitializeHeaders(Excel.Worksheet sheet, string type)
        {
            switch (type)
            {
                case "products":
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "name";
                    sheet.Cells[1, 3].Value2 = "code";
                    sheet.Cells[1, 4].Value2 = "cost";
                    sheet.Cells[1, 5].Value2 = "price";
                    sheet.Cells[1, 6].Value2 = "stock";
                    sheet.Cells[1, 7].Value2 = "image";
                    sheet.Cells[1, 8].Value2 = "obs";
                    sheet.Cells[1, 9].Value2 = "category"; // ← adicionar
                    sheet.Range["A1:I1"].Font.Bold = true;  // ← era H1, agora I1
                    break;
                case "customers":
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "name";
                    sheet.Cells[1, 3].Value2 = "whatsapp";
                    sheet.Cells[1, 4].Value2 = "email";
                    sheet.Cells[1, 5].Value2 = "obs";
                    sheet.Cells[1, 6].Value2 = "date";
                    sheet.Cells[1, 7].Value2 = "image";
                    sheet.Range["A1:G1"].Font.Bold = true;
                    break;
                case "sales":
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "date";
                    sheet.Cells[1, 3].Value2 = "cliente";
                    sheet.Cells[1, 4].Value2 = "valor_total";
                    sheet.Cells[1, 5].Value2 = "desconto";
                    sheet.Cells[1, 6].Value2 = "valor_final";
                    sheet.Cells[1, 7].Value2 = "cost";
                    sheet.Cells[1, 8].Value2 = "lucro";
                    sheet.Cells[1, 9].Value2 = "pagamento";
                    sheet.Cells[1, 10].Value2 = "items";
                    sheet.Range["A1:J1"].Font.Bold = true;
                    break;
                case "settings":
                    sheet.Cells[1, 1].Value2 = "razao_social";
                    sheet.Cells[1, 2].Value2 = "responsavel";
                    sheet.Cells[1, 3].Value2 = "whatsapp";
                    sheet.Cells[1, 4].Value2 = "email";
                    sheet.Cells[1, 5].Value2 = "endereco";
                    sheet.Cells[1, 6].Value2 = "foto";
                    sheet.Range["A1:F1"].Font.Bold = true;
                    break;
                case "reversals":
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "sale_id";
                    sheet.Cells[1, 3].Value2 = "product_id";
                    sheet.Cells[1, 4].Value2 = "product_name";
                    sheet.Cells[1, 5].Value2 = "qty";
                    sheet.Cells[1, 6].Value2 = "date";
                    sheet.Range["A1:F1"].Font.Bold = true;
                    break;
                case "users": // ← adicionado
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "username";
                    sheet.Cells[1, 3].Value2 = "fullname";
                    sheet.Cells[1, 4].Value2 = "password";
                    sheet.Cells[1, 5].Value2 = "role";
                    sheet.Cells[1, 6].Value2 = "isDefaultCredential";
                    sheet.Range["A1:F1"].Font.Bold = true;
                    break;
                case "entradas":
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "date";
                    sheet.Cells[1, 3].Value2 = "fornecedor";
                    sheet.Cells[1, 4].Value2 = "nota";
                    sheet.Cells[1, 5].Value2 = "obs";
                    sheet.Cells[1, 6].Value2 = "items";
                    sheet.Cells[1, 7].Value2 = "totalCusto";
                    sheet.Range["A1:G1"].Font.Bold = true;
                    break;
                case "fechamentos":
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "dataAbertura";
                    sheet.Cells[1, 3].Value2 = "dataFechamento";
                    sheet.Cells[1, 4].Value2 = "operador";
                    sheet.Cells[1, 5].Value2 = "valorAbertura";
                    sheet.Cells[1, 6].Value2 = "valorFechamento";
                    sheet.Cells[1, 7].Value2 = "totalVendasDinheiro";
                    sheet.Cells[1, 8].Value2 = "totalVendasCartao";
                    sheet.Cells[1, 9].Value2 = "totalVendasPix";
                    sheet.Cells[1, 10].Value2 = "totalGeral";
                    sheet.Cells[1, 11].Value2 = "diferenca";
                    sheet.Cells[1, 12].Value2 = "sangrias";
                    sheet.Cells[1, 13].Value2 = "suprimentos";
                    sheet.Range["A1:M1"].Font.Bold = true;
                    break;
                case "categories":
                    sheet.Cells[1, 1].Value2 = "id";
                    sheet.Cells[1, 2].Value2 = "name";
                    sheet.Range["A1:B1"].Font.Bold = true;
                    break;
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
                                     .Replace("sales", "Vendas")
                                     .Replace("salvos com sucesso!", "salvos com sucesso!");
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