using Microsoft.VisualStudio.Tools.Applications.Runtime;
using System;
using System.Data;
using System.Drawing;
using System.Windows.Forms;
using Excel = Microsoft.Office.Interop.Excel;
using Office = Microsoft.Office.Core;

namespace SistemaVendas
{
    public partial class Planilha3
    {
        private void Planilha3_Startup(object sender, System.EventArgs e)
        {
        }

        private void Planilha3_Shutdown(object sender, System.EventArgs e)
        {
        }

        #region VSTO Designer generated code

        /// <summary>
        /// Required method for Designer support - do not modify
        /// the contents of this method with the code editor.
        /// </summary>
        private void InternalStartup()
        {
            this.Startup += new System.EventHandler(Planilha3_Startup);
            this.Shutdown += new System.EventHandler(Planilha3_Shutdown);
        }

        #endregion

    }
}
