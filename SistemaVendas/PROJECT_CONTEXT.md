# Contexto do Projeto (SV Ultra / SistemaVendas)

Este arquivo registra o contexto e o histórico resumido de mudanças realizadas no projeto, para facilitar manutenção, auditoria e continuidade de desenvolvimento.

## Como usar

- A cada alteração feita no projeto, adicionar uma entrada em **Histórico de Mudanças**.
- Manter as entradas curtas, com links para arquivos alterados e um resumo do “porquê”.

## Visão geral

O SV Ultra (SistemaVendas) é um PDV desktop (aplicativo Windows Forms independente, sem Excel) que renderiza o Frontend (HTML/CSS/JS) em uma janela WebView2. Os dados são persistidos em um banco SQLite (`sistema_vendas.db`) via uma bridge C# ⇄ JavaScript, com fallback em `localStorage`.

## Stack e arquitetura

- .NET Framework 4.8 (Windows Forms, SDK-style)
  - `Program.cs` inicia o `FormVendas` (`Form` que inicializa o WebView2 e o banco).
  - Banco: SQLite via `Microsoft.Data.Sqlite` (`Database.cs`).
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
- Host (WinForms): `SistemaVendas/`
  - Entrada: `Program.cs`
  - Host UI: `FormVendas.cs` (WebView2 + bridge)
  - Bridge: `Bridge.cs` (GetData/SaveData + seleção de imagens)
  - Banco: `Database.cs` (SQLite: criação de tabelas, leitura e gravação)
- Persistência: via `bridge.SaveData(...)` (SQLite) quando disponível e fallback em `localStorage`
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

### Bridge (C# ⇄ SQLite)

O arquivo do banco fica em `%LOCALAPPDATA%\SistemaVendas_UNIQ\sistema_vendas.db` (criado na primeira execução). Cada tipo enviado pelo frontend vira uma tabela de mesmo nome. `GetData(tipo)` devolve um array JSON; `SaveData(tipo, json)` substitui todo o conteúdo da tabela (em transação). Campos “complexos” (`items`, `sangrias`, `suprimentos`) são guardados como JSON em colunas `TEXT`. Propriedades sem coluna correspondente ficam em `_extra` (JSON), para não serem perdidas.

- `products` → colunas `id,name,code,cost,price,stock,image,obs,category`
- `customers` → `id,name,whatsapp,email,obs,date,image`
- `sales` → `id,date,cliente,valor_total,desconto,valor_final,cost,lucro,pagamento,items`
- `settings` → `companyName,ownerName,whatsapp,email,address,logoUrl`
- `reversals` → `id,sale_id,product_id,product_name,qty,date`
- `users` → `id,username,fullname,password,role,isDefaultCredential`
- `entradas` → `id,date,fornecedor,nota,obs,items,totalCusto`
- `fechamentos` → `id,dataAbertura,dataFechamento,operador,valorAbertura,valorFechamento,totalVendasDinheiro,totalVendasCartao,totalVendasPix,totalGeral,diferenca,sangrias,suprimentos`
- `categories` → `id,name`
- `caixa` → tabela de documento (cada sessão de caixa guardada inteira como JSON em `dados`)

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

- Executar o projeto `SistemaVendas.csproj` (Visual Studio 2022 ou `dotnet build` no Windows). Abre diretamente a janela do sistema.
- O host mapeia `frontend/` e navega em `https://app.local/index.html` usando WebView2.
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

### 2026-11-14

- Persistência migrada de Excel (VSTO) para SQLite:
  - Novo `Database.cs` com criação de tabelas, leitura e gravação (`Microsoft.Data.Sqlite`). Banco em `%LOCALAPPDATA%\SistemaVendas_UNIQ\sistema_vendas.db`.
  - `Bridge.cs`: `GetData`/`SaveData` agora usam `Database`; API do bridge e formato JSON mantidos (o frontend não mudou).
  - Projeto convertido de add-in VSTO para aplicação WinForms (`OutputType` WinExe, SDK-style), com `Program.cs` como entrada.
  - Removidos: `ThisWorkbook`, `Ribbon1/2`, `Planilha1-4` e `packages.config` (substituído por `PackageReference`).
  - Sem importação dos dados antigos de `vendas.xlsx` (começa do zero). O arquivo foi mantido no repositório, sem uso pelo sistema.
  - Caixa agora é persistido no banco (antes o bridge recusava o tipo `caixa`).
  - Arquivos: `SistemaVendas/Database.cs`, `SistemaVendas/Bridge.cs`, `SistemaVendas/FormVendas.cs`, `SistemaVendas/Program.cs`, `SistemaVendas/SistemaVendas.csproj`, `SistemaVendas/PROJECT_CONTEXT.md`

### 2026-11-14 (Fase 1 — camada de dados)

- Gravação em uma única transação:
  - Novo `Bridge.SaveAll(json)` e `Database.ReplaceAll(json)`: grava todas as coleções (produtos, clientes, vendas, configurações, estornos, entradas, fechamentos, categorias, caixa e usuários) em uma transação. Se algo falhar, nada é gravado.
  - `salvarDados()` no frontend passa a fazer uma única chamada a `SaveAll`, no lugar de 9 chamadas separadas.
  - `SaveData` continua disponível (usado no reset de usuários).
- Versão do esquema: `PRAGMA user_version` (versão 1). `Initialize()` aplica migrações pendentes e recusa bancos de versão mais nova.
- Arquivos: `SistemaVendas/Database.cs`, `SistemaVendas/Bridge.cs`, `SistemaVendas/frontend/app.js`, `SistemaVendas/PROJECT_CONTEXT.md`
- Pendente: gravação incremental por registro (inserir/atualizar/excluir), prevista para a próxima etapa.

### 2026-11-14 (Fase 1 — gravação incremental)

- Gravação só do que mudou:
  - `salvarDados()` compara o estado com o snapshot da última gravação bem-sucedida (`snapshotSalvo`) e envia apenas `upsert` (inclusos/alterados), `delete` (ids removidos) e `order` (quando a ordem muda).
  - Novo `Bridge.SaveChanges(json)` e `Database.ApplyChanges(json)`: aplica tudo em uma transação. Se algo falhar, nada é gravado e o snapshot antigo é mantido, então a próxima gravação tenta de novo.
  - Coleções com id ausente ou repetido, primeira gravação após carregar, e reset de usuários gravam por inteiro (`full`).
  - Configurações e caixa são sempre regravados por inteiro (são pequenos).
- `Database.cs`: `InserirItem`, `AplicarUpsert`, `ExcluirItem` e `AplicarOrdem` (valores negativos temporários para reordenar sem conflito de chave).
- `Bridge.SaveAll` continua disponível, mas não é mais usado por `salvarDados()`.
- Testes sem Windows (rodam fora do Visual Studio):
  - `node tests/js/test_diff.js` — lógica de diferença do frontend (carrega o `app.js` de verdade).
  - `python3 tests/db/test_ordem_sql.py` — sequência SQL de ordem/upsert/exclusão, incluindo 200 rodadas aleatórias.
- Arquivos: `SistemaVendas/Database.cs`, `SistemaVendas/Bridge.cs`, `SistemaVendas/frontend/app.js`, `SistemaVendas/PROJECT_CONTEXT.md`, `tests/`

### 2026-11-14 (Fase 2 — estoque e custo)

- Decisão: custo médio ponderado (confirmado pelo usuário). Cada entrada recalcula o custo médio; venda usa o custo do momento e não altera o custo médio.
- Histórico de movimentações (`movimentacoes`, tabela nova, esquema versão 2):
  - Tipos: `saldo_inicial` (cadastro ou produto antigo), `entrada`, `venda`, `estorno` (exclusão de venda), `ajuste` (manual, ±), `ajuste_custo` (troca manual do custo), `exclusao_entrada` (auditoria).
  - Saldo e custo são recalculados a partir das movimentações ativas (`frontend/estoque.js`, função `calcular`).
  - Exclusão de entrada: as movimentações da entrada ficam `ignorada: true` e não contam mais, então estoque e custo voltam ao que seriam sem ela. Entradas anteriores ao histórico só revertem a quantidade (custo não é recalculado).
  - Saldo nunca fica negativo.
- Produtos antigos ganham um `saldo_inicial` na primeira carga, a partir do estoque e custo atuais.
- Backup agora inclui `movimentacoes`. Backups antigos recriam o saldo inicial.
- Pendente: tela de histórico de movimentações (os dados já são gravados).
- Testes: `node tests/js/test_estoque.js` (regras de custo e estoque, inclusive invariantes aleatórios) e `node tests/js/test_fluxos_estoque.js` (fluxos do app.js com DOM simulado).
- Não compilado no Windows nem executado no WebView2: validar cadastro, entrada, venda, exclusão de venda e de entrada, e reinício.
- Arquivos: `SistemaVendas/frontend/estoque.js` (novo), `SistemaVendas/frontend/app.js`, `SistemaVendas/frontend/index.html`, `SistemaVendas/Database.cs`, `tests/js/`.

### 2026-11-14 (login desativado e histórico de estoque)

- Login e gestão de usuários desativados: `app.config.loginAtivo = false`. O sistema abre como administrador local; telas de login, usuários e "Sair da Sessão" ficam ocultas (classe `requer-login`). Para voltar, use `loginAtivo = true`. O código de login foi mantido.
- Histórico de estoque por produto: botão de relógio na lista de produtos abre o modal com data, tipo, quantidade, custo, saldo e observação. Movimentações excluídas aparecem apagadas e não contam no saldo (`Estoque.historico`).
- Testes: `node tests/js/test_estoque.js`, `node tests/js/test_fluxos_estoque.js`.
- Não compilado no Windows nem executado no WebView2.

