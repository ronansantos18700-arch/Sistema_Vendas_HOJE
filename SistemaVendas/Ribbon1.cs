using Microsoft.Office.Tools.Ribbon;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace SistemaVendas
{
    public partial class Ribbon1
    {
        FormVendas formulario = null;
        private void Ribbon1_Load(object sender, RibbonUIEventArgs e)
        {

        }

        private void button1_Click(object sender, RibbonControlEventArgs e)
        {
            if (formulario == null || formulario.IsDisposed)
            {
                formulario = new FormVendas();
                formulario.Show();
            }
            else
            {
                formulario.BringToFront();
            }
        }
    }
}
