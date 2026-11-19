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
  - Sem importação dos dados antigos de `vendas.xlsx` (começa do zero). O arquivo foi removido do repositório (histórico do Git mantém a cópia).
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

### 2026-11-14 (Fase 4 — interface, parte 1)

- Janela: sem bordas (`FormBorderStyle.None`), maximizada ao abrir (`WindowState.Maximized`) e visível na barra de tarefas (`ShowInTaskbar = true`, para ser possível minimizar e voltar à janela).
- Zoom flutuante removido: botões, atalhos Ctrl +/−/0, Ctrl + roda do mouse e controle do zoom salvo. Layout precisa funcionar sem zoom.
- Fonte: `Segoe UI` (fonte do Windows) no lugar de `SF Pro Display`, que não existe no Windows. Import externo de fonte removido.
- Bibliotecas locais em `frontend/vendor/`: Chart.js 4.6.1 e Lucide 0.460.0. Não dependem mais de CDN, então funcionam sem internet.
- Não verificado: layout em 1920×1080 e 1366×768 com 125% de escala (sem navegador no ambiente de desenvolvimento). Precisa de teste no Windows.
- Fase 3: vendas, entradas e estoque já usam as movimentações (Fase 2). O caixa continua como documento separado, sem reconstrução, até decidir o uso do caixa.

### 2026-11-14 (Fase 3 — caixa simplificado)

- Decisão: caixa simplificado para a v1 (abertura, fechamento, sangria e suprimento saíram do sistema).
- A tela "Caixa" virou "Resumo": total de vendas e quantidade por forma de pagamento (dinheiro, cartão, Pix e outros) em um dia ou período.
  - Regra pura em `frontend/resumo.js` (`resumoPorPagamento`, `periodo`, `formaDePagamento`).
  - Testes: `node tests/js/test_resumo.js`.
- Saíram: menu "Histórico Caixa", seção de configurações, impressão de fechamento, passos do tutorial sobre caixa.
- Dados antigos de caixa e fechamentos continuam nas tabelas `caixa` e `fechamentos` do banco, mas o app não lê nem grava mais. Backups deixam de incluir `fechamentos`; backups antigos com essa chave são ignorados na restauração.
- Não verificado no Windows: a tela Resumo e os filtros de data.

### 2026-11-14 (edição de venda registrada)

- Na tela Saídas, o botão de lápis abre o modal "Editar venda". É possível alterar: quantidade de cada item (0 remove o item), desconto em R$, cliente e forma de pagamento. Data e número da venda não mudam. Não é possível adicionar produto novo a uma venda existente.
- Estoque: a diferença de quantidade vira movimentação, sem apagar o histórico. Mais unidades = movimentação de venda (com o custo do item na venda); menos unidades = estorno. Se faltar estoque para aumentar a venda, a edição é recusada e nada muda.
- Venda paga em mais de uma forma: a divisão só é mantida se a soma continuar batendo com o novo total; caso contrário, é preciso escolher uma forma única.
- Correção junto: a normalização das vendas ao carregar descartava `pagamentos` e `troco`, então a divisão de pagamento sumia após reiniciar. Agora esses campos são mantidos.
- Regras puras em `frontend/edicao_venda.js`. Testes: `node tests/js/test_edicao_venda.js`.
- Saídas: coluna AÇÕES com três botões (editar, recibo, excluir) e larguras ajustadas para caber em 1366 px sem cortar. A regra efetiva da grade é a do bloco "Saídas: colunas com larguras fixas".
- Não compilado no Windows nem executado no WebView2: validar edição com venda normal, venda mista e venda com estoque insuficiente, e confirmar que o estoque bate depois de reiniciar.
- Arquivos: `SistemaVendas/frontend/edicao_venda.js` (novo), `SistemaVendas/frontend/app.js`, `SistemaVendas/frontend/index.html`, `SistemaVendas/frontend/style.css`, `tests/js/test_edicao_venda.js` (novo).

### 2026-11-19 (servidor central — etapa 2)

- Usuários pelo servidor: criar, editar e excluir (`POST /api/usuarios`, `PUT /api/usuarios/{id}`, `DELETE /api/usuarios/{id}`), só admin. Operador troca só a própria senha (`POST /api/senha`).
- Regras no servidor: não excluir o próprio usuário; não excluir nem rebaixar o último admin; trocar o login exige nova senha (o hash usa o login como salt).
- Sessão relê o usuário do banco a cada requisição: papel alterado ou usuário excluído valem na hora.
- Fotos: `POST /api/imagens` (base64, até 5 MB, JPG/PNG/BMP) grava na pasta `imagens` ao lado do banco e devolve a URL. `GET /api/imagens/{arquivo}` serve a foto (nome aleatório). Produtos e clientes gravam a URL completa.
- Frontend: `frontend/api.js` (cliente do servidor e adaptador com a forma do `Bridge`). Login obrigatório (`loginAtivo: true`); no modo servidor os usuários ficam fora do `SaveChanges`.
- Frontend servido pelo próprio servidor: `http://IP:5080/`. O `SV.Api.csproj` copia `SistemaVendas/frontend` para a pasta `frontend` ao lado do exe (sem `images`). A janela do desktop (`FormVendas.cs`) abre esse endereço, em vez de `https://app.local`. Assim não há conteúdo misto entre PCs.
- Endereço do servidor no desktop: arquivo `%LOCALAPPDATA%\SistemaVendas_UNIQ\servidor.txt`, com uma linha (ex.: `http://192.168.0.10:5080`). Sem o arquivo, usa `http://localhost:5080`. Se o WebView2 não conseguir abrir o servidor, o desktop mostra o motivo informado pelo navegador e pergunta se quer tentar de novo (sem teste de conexão separado).
- Queda do servidor com a tela aberta: o monitor do frontend (a cada 4 s) bloqueia o sistema com o aviso "Servidor indisponível". Ao voltar: confere a sessão; se o servidor reiniciou, volta ao login; senão, grava o pendente e recarrega os dados.
- Dados nunca vão para a ponte (banco local) quando o servidor está configurado. Antes, uma sessão expirada podia gravar no SQLite local.
- SHA-256 do backup em JS puro (`sha256.js`), usado quando `crypto.subtle` não existe (http). Mesmo valor do navegador (testado em `tests/js/test_sha256.js`).
- Pendência: o desktop ainda inicializa o SQLite local ao abrir (`Database.Initialize`). Não é mais usado para dados, mas pode ser removido depois.

### 2026-11-19 (servidor central — etapa 3)

- Gravação por registro: cada coleção é comparada com o último snapshot salvo e só as mudanças (`upsert`, `delete`, `order`) são enviadas. Antes, a gravação mandava coleções inteiras (`full`), e um PC podia apagar registros que outro tinha acabado de criar.
- Gravações em fila: uma por vez, para não reenviar a mesma mudança. Mudança feita durante uma gravação fica para a seguinte.
- Sem snapshot, a gravação é recusada com erro (não envia a tabela inteira). Só um id repetido em uma coleção deixa essa coleção sem snapshot.
- `Database.AplicarOrdem`: registro que este PC não conhecia (inserido por outro) vai para o fim, mantendo a ordem atual. Antes, isso desfazia a gravação inteira com "Ordem inconsistente".
- Testes: `tests/js/test_gravacao_registro.js` (dois PCs, perda de dados, falha de rede, mudança durante a gravação) e cenário 6 em `tests/db/test_ordem_sql.py`.

### 2026-11-19 (servidor central — etapa 4)

- Estoque validado no servidor: `POST /api/dados/alteracoes` recusa (400, com o motivo) a gravação que deixaria um produto com saldo negativo. A validação e a gravação rodam sob a mesma trava, então dois PCs não passam ao mesmo tempo.
- Regra igual a `estoque.js`: o saldo é recalculado a partir de `movimentacoes` (com movimentações ignoradas excluídas). Só saídas novas causadas pela gravação são recusadas; saídas antigas já inconsistentes não bloqueiam outras gravações.
- Frontend: quando o servidor recusa, mostra o motivo e recarrega os dados do servidor. Antes, a gravação recusada ficava pendente e era reenviada a cada salvamento.
- Testes: `tests/db/test_estoque_servidor.py` (espelho da regra em Python) e `tests/js/test_gravacao_registro.js` (recusa e recarregamento). O C# ainda não foi compilado no sandbox; validado por `dotnet build` no Windows.
- Pendência conhecida: o `stock` do produto enviado pelo cliente pode ficar desatualizado (o app só recalcula ao registrar movimentação ou editar o produto). O saldo que vale para a validação é o das movimentações, então não há venda acima do estoque, mas o número mostrado no cadastro pode divergir.
- Pendência: backup em modo servidor não inclui as fotos do servidor (só `images/` locais).
- Firewall: o PC do servidor precisa liberar a porta 5080 na rede (entrada TCP).
- Fotos antigas (caminho local `images/...`) não são migradas para o servidor.
- Não compilado no sandbox: `dotnet build` e teste no Windows são obrigatórios.

### 2026-11-19 (servidor central — etapa 1)

- Decisão: três computadores com dados compartilhados. Servidor central em C# (.NET 10), projeto `SV.Api`, com banco SQLite no servidor.
- Reaproveitado: `SistemaVendas/Database.cs` por link de arquivo (sem cópia). O caminho do banco virou configurável (`Database.Caminho`); o desktop continua usando `%LOCALAPPDATA%`.
- Login: a senha é verificada no servidor, com o mesmo hash PBKDF2 do `app.js` (100.000 iterações, salt `usuario_SV2024_tamanho`). Por isso usuários já gravados continuam válidos.
- Primeiro uso: se não houver usuários, o servidor cria `admin` com senha `1234` e `isDefaultCredential = true`. O login avisa que a troca é obrigatória.
- Rotas: `GET /api/saude`, `POST /api/login`, `GET /api/eu`, `POST /api/sair`, `POST /api/senha`, `GET /api/usuarios` (admin), `GET /api/dados/{tipo}`, `POST /api/dados/alteracoes` (mesmo formato do `SaveChanges` do desktop). Autenticação por `Authorization: Bearer <token>`.
- Usuários ficam fora da rota genérica de dados. O servidor recusa o tipo `users` em `alteracoes`, para o cliente nunca gravar hash de senha.
- Sessões em memória, 12 horas de validade. Bloqueio de login após 5 tentativas erradas, por 30 segundos.
- CORS liberado para `https://app.local` (WebView2 do desktop). Porta padrão 5080, em HTTP simples. HTTPS ainda não configurado.
- Ainda não feito: o frontend continua usando a ponte local. A troca para a API é a etapa 2. Gravação por registro e validação de estoque no servidor são as etapas 3 e 4.
- Não compilado: o sandbox não tem .NET nem acesso ao NuGet. A sintaxe foi verificada com o parser tree-sitter; tipos e referências ainda precisam de `dotnet build` no Windows.
- Valor de referência do hash: `admin` / `1234` → `d1f098152e97b7542feffd65fe27620905e804b5fd594d5db98aa82fda903e71`.

