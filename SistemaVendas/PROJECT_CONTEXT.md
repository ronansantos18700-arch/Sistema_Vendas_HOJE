# Contexto do Projeto (SV Ultra / SistemaVendas)

Este arquivo registra o contexto e o histórico resumido de mudanças realizadas no projeto, para facilitar manutenção, auditoria e continuidade de desenvolvimento.

## Como usar

- A cada alteração feita no projeto, adicionar uma entrada em **Histórico de Mudanças**.
- Manter as entradas curtas, com links para arquivos alterados e um resumo do “porquê”.

## Visão geral

O SV Ultra (SistemaVendas) é um PDV que roda dentro do Excel (VSTO), abrindo uma janela Windows Forms com WebView2 para renderizar o Frontend (HTML/CSS/JS). Os dados são persistidos principalmente em abas de uma planilha Excel via uma bridge C# ⇄ JavaScript, com fallback em `localStorage`.

## Stack e arquitetura

- Excel/VSTO (.NET Framework) + Ribbon
  - O usuário abre o sistema via botão no Ribbon do Excel.
  - A UI principal é um `Form` (Windows Forms) que inicializa o WebView2.
- WebView2
  - Carrega o Frontend via domínio virtual: `https://app.local/index.html` (evita problemas de origem do `file://`).
  - Expõe a bridge em JS via `window.chrome.webview.hostObjects.bridge`.
- Frontend (HTML/CSS/JS)
  - Estado e regras de negócio ficam em `frontend/app.js` (objeto `app`).
  - Layout e telas em `frontend/index.html`.
  - Tema e estilos em `frontend/style.css`.

## Estrutura (alto nível)

- Frontend: `SistemaVendas/frontend`
  - UI: `index.html`, `style.css`
  - Lógica: `app.js`
- Host (Excel/VSTO): `SistemaVendas/`
  - Ribbon: `Ribbon1.cs` (abre a janela do sistema)
  - Host UI: `FormVendas.cs` (WebView2 + bridge)
  - Bridge: `Bridge.cs` (GetData/SaveData + seleção de imagens)
- Persistência: via `bridge.SaveData(...)` quando disponível e fallback em `localStorage`
  - Tema: `sv_theme`
  - Zoom: `sv_zoom_v4`
  - Caixa: `sv_caixa`
  - Fechamentos (histórico): `sv_fechamentos`

## Funcionalidades (mapa do produto)

### Autenticação e usuários

- Login por usuário/senha, com proteção de tentativas (lockout).
- Hash de senha: PBKDF2 (SHA-256) com salt derivado do username; fallback SHA-256 simples para migrar senhas antigas.
- Perfis:
  - `admin` (acesso total)
  - `operador` (acesso operacional, com bloqueios de telas e botões)
- Gestão de usuários em Configurações (criar/editar/excluir/reset).

### Dashboard

- Cards e gráficos (ex.: Evolução de Vendas) com filtros (Faturamento/Lucro/Custo).

### PDV

- Carrinho, adição/remoção de itens, seleção de cliente, desconto e forma de pagamento.
- Finalização de venda e geração de recibo A4 para impressão.

### Caixa

- Abertura de caixa (fundo), sessão por operador.
- Movimentações: sangria e suprimento.
- Fechamento de caixa com cálculo de esperado vs contado e diferença, com impressão do resumo.
- Histórico de fechamentos persistido (e exibido para admin em Configurações > Histórico Caixa).

### Produtos

- Cadastro/edição/exclusão, ajuste de estoque, filtros e associação com categorias.
- Suporte a imagem de produto via seleção de arquivo (copia para `frontend/images`).

### Clientes

- Cadastro/edição/exclusão, busca/filtro e suporte a observações/endereço e imagem.

### Saídas (Histórico)

- Listagem de vendas, detalhes (itens), e ações relacionadas a recibo.

### Entradas

- Registro de entradas de estoque (fornecedor, nota, itens e custo total).

### Configurações

- Empresa (dados e logo).
- Usuários.
- Notificações.
- Aparência (tema).
- Ferramentas (tutorial e backup).
- Categorias.
- Histórico Caixa (admin).

## Dados e persistência (fonte da verdade)

### Bridge (Excel ⇄ JSON)

A bridge persiste e recupera dados em abas do Excel usando os tipos abaixo. Campos “complexos” (ex.: `items`, `sangrias`, `suprimentos`) são serializados como JSON dentro da célula.

- `products` → aba `produtos`
  - `id,name,code,cost,price,stock,image,obs,category`
- `customers` → aba `clientes`
  - `id,name,whatsapp,email,obs,date,image`
- `sales` → aba `Planilha1`
  - `id,date,cliente,valor_total,desconto,valor_final,cost,lucro,pagamento,items`
- `settings` → aba `configuracoes`
  - `razao_social,responsavel,whatsapp,email,endereco,foto`
- `reversals` → aba `extornos`
  - `id,sale_id,product_id,product_name,qty,date`
- `users` → aba `usuarios`
  - `id,username,fullname,password,role,isDefaultCredential`
- `entradas` → aba `entradas`
  - `id,date,fornecedor,nota,obs,items,totalCusto`
- `fechamentos` → aba `fechamentos`
  - `id,dataAbertura,dataFechamento,operador,valorAbertura,valorFechamento,totalVendasDinheiro,totalVendasCartao,totalVendasPix,totalGeral,diferenca,sangrias,suprimentos`
- `categories` → aba `categorias`
  - `id,name`

### Fallback localStorage

Quando o `bridge` não está disponível (ou quando o tipo não é suportado por planilha), o Frontend usa `localStorage`:

- `sv_products`, `sv_customers`, `sv_sales`, `sv_settings`, `sv_reversals`, `sv_users`, `sv_entradas`, `sv_categories`
- Caixa atual: `sv_caixa`
- Histórico de fechamentos: `sv_fechamentos`

## Regras e Convenções

## Regras e Convenções

- Tema: alternância por classe `body.light-theme`.
- Permissões: baseadas em `currentUser.role` (`admin` / `operador`), aplicadas via `applyPermissions()` e bloqueios em `switchView()`.
- Segurança de senha: hash PBKDF2 (SHA-256) com salt derivado do username; fallback SHA-256 simples para migração.
- Impressão:

## Como abrir/rodar (visão prática)

- No Excel: clicar no botão do Ribbon que abre o `FormVendas` (janela do sistema).
- Em dev/debug: o host mapeia `frontend/` e navega em `https://app.local/index.html` usando WebView2.
  - Recibo A4 em `#receipt-container` (CSS com `@media print`)
  - Impressão de caixa usa classe `printing-caixa`

### 2026-05-06

- Documentação — expansão do contexto do projeto:
  - O arquivo passou a descrever a arquitetura completa (VSTO/Excel + WebView2 + bridge + Frontend), mapa de funcionalidades e modelo de dados/persistência.
  - Arquivo: `PROJECT_CONTEXT.md`

- Tutorial — roteiro completo por área:
  - Refatorado o tutorial para ser dirigido por uma lista de passos (com navegação por views/seções e destaques por seletor), cobrindo todas as áreas e funcionalidades principais.
  - Admin: inclui Dashboard, PDV, Caixa, Produtos, Entradas, Saídas, Configurações (todas as seções) e Histórico do Caixa.
  - Operador: cobre PDV, Caixa, Clientes e Saídas, e explica as áreas administrativas que exigem perfil Admin.
  - Arquivo: `frontend/app.js`

- Entradas — validações e merge de itens:
  - Bloqueado registrar entrada se `Fornecedor` ou `Nº da Nota` estiverem vazios.
  - Ao adicionar o mesmo produto mais de uma vez na entrada, soma a quantidade em vez de criar uma nova linha.
  - Arquivo: `frontend/app.js`

- UI (botões) — texto fixo independente do tema:
  - Fixado `color: #fff` para: `#btn-finish-sale` (PDV) e `.btn-save` nas views Produtos/Clientes/Entradas.
  - Arquivo: `frontend/style.css`

- Configurações > Usuários — texto de segurança atualizado:
  - Ajustado aviso de “SHA-256” para refletir o mecanismo real (PBKDF2 100k iterações, SHA-256, com salt).
  - Arquivo: `frontend/index.html`

- Configurações > Aparência — removido zoom e adicionado toggle de tema:
  - Removido conteúdo de zoom (`sv-section-aparencia`).
  - Adicionado checkbox “Tema claro” sincronizado com o toggle global.
  - Arquivos: `frontend/index.html`, `frontend/app.js`

- Dashboard (tema light) — botões do filtro do gráfico “Evolução de Vendas”:
  - Corrigido background/active/hover do `chart-dataset-toggles` no tema light.
  - Arquivo: `frontend/style.css`

- Permissões do perfil Operador:
  - Permitido: PDV, Caixa, Clientes, Saídas (Histórico).
  - Bloqueado: Dashboard, Produtos, Entradas, Configurações.
  - Operador agora inicia em PDV após login/refresh.
  - Arquivos: `frontend/app.js`, `frontend/index.html`

- Impressão (Recibo A4) — reorganização para muitas linhas:
  - Totais (Subtotal/Desconto/Total) movidos para o topo.
  - Itens renderizados em tabela (`thead` repetível) com regras de page-break.
  - Arquivos: `frontend/index.html`, `frontend/app.js`, `frontend/style.css`

- Admin — aba “Histórico Caixa” em Configurações:
  - Nova seção listando sessões de caixa (operador, abertura/fechamento, esperado, contado, diferença).
  - Arquivos: `frontend/index.html`, `frontend/app.js`, `frontend/style.css`

- Admin — Histórico Caixa (datas):
  - Ajustado o parse/ordenação de datas usando `parseDate()` para evitar “Invalid Date” quando vier vazio ou em formato Excel.
  - Arquivo: `frontend/app.js`

