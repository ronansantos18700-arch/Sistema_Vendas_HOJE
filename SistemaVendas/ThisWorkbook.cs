using System;
using System.Data;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.VisualStudio.Tools.Applications.Runtime;
using Excel = Microsoft.Office.Interop.Excel;
using Office = Microsoft.Office.Core;

namespace SistemaVendas
{
    public partial class ThisWorkbook
    {
        private void ThisWorkbook_Startup(object sender, System.EventArgs e)
        {
            EnsureSheetsAndHeaders();
            //FormVendas formulario = new FormVendas();
            //formulario.ShowDialog();
        }

        private void EnsureSheetsAndHeaders()
        {
            EnsureSheet("produtos", new[] { "id", "name", "code", "cost", "price", "stock", "image" });
            EnsureSheet("clientes", new[] { "id", "name", "whatsapp", "email", "obs", "date", "image" });
            EnsureSheet("Planilha1", new[] { "ID", "Data", "Cliente", "Valor Total", "Custo", "Lucro", "Forma de Pagamento" });
        }

        private void EnsureSheet(string name, string[] headers)
        {
            Excel.Worksheet sheet = null;
            try
            {
                sheet = this.Worksheets[name] as Excel.Worksheet;
            }
            catch
            {
                sheet = this.Worksheets.Add() as Excel.Worksheet;
                sheet.Name = name;
            }

            if (sheet.Cells[1, 1].Value2 == null)
            {
                for (int i = 0; i < headers.Length; i++)
                {
                    sheet.Cells[1, i + 1].Value2 = headers[i];
                }
                sheet.Range[sheet.Cells[1, 1], sheet.Cells[1, headers.Length]].Font.Bold = true;
            }

            if (name == "clientes")
            {
                Excel.Range dateColumn = sheet.Columns[6];
                dateColumn.NumberFormat = "dd/mm/yyyy";
            }
            else if (name == "Planilha1")
            {
                Excel.Range dateColumn = sheet.Columns[2];
                dateColumn.NumberFormat = "dd/mm/yyyy";
            }
        }

        private void ThisWorkbook_Shutdown(object sender, System.EventArgs e)
        {
        }

        #region VSTO Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InternalStartup()
        {
            this.Startup += new System.EventHandler(ThisWorkbook_Startup);
            this.Shutdown += new System.EventHandler(ThisWorkbook_Shutdown);
        }

        #endregion

    }
}
