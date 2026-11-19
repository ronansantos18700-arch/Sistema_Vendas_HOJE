using System;
using System.IO;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using SV.Api;
using SV.Api.Servicos;

var builder = WebApplication.CreateBuilder(args);

// Banco: caminho configurado (Banco:Caminho ou Banco__Caminho no ambiente);
// se vazio, fica em ./dados/sistema_vendas.db ao lado do executável.
string caminhoBanco = builder.Configuration["Banco:Caminho"];
if (string.IsNullOrWhiteSpace(caminhoBanco))
{
    caminhoBanco = Path.Combine(builder.Environment.ContentRootPath, "dados", "sistema_vendas.db");
}

// Origens que podem chamar a API (o WebView2 do desktop usa https://app.local).
string[] origens = builder.Configuration.GetSection("Cors:Origens").Get<string[]>();
if (origens == null || origens.Length == 0)
{
    origens = new[] { "https://app.local" };
}

builder.WebHost.UseUrls(builder.Configuration["Servidor:Url"] ?? "http://0.0.0.0:5080");

builder.Services.AddCors(opcoes =>
{
    opcoes.AddDefaultPolicy(politica =>
    {
        politica.WithOrigins(origens).AllowAnyHeader().AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseCors();

// Frontend (mesmos arquivos do desktop), copiados para a pasta "frontend" ao lado do exe na compilação.
// Caminho explícito: com "dotnet run", a raiz de conteúdo é a pasta do projeto.
var arquivosSite = new PhysicalFileProvider(Path.Combine(AppContext.BaseDirectory, "frontend"));
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = arquivosSite });
app.UseStaticFiles(new StaticFileOptions { FileProvider = arquivosSite });

Dados.Iniciar(caminhoBanco);
Dados.GarantirAdministrador();
Console.WriteLine("Banco: " + caminhoBanco);

Rotas.Mapear(app);

app.Run();
