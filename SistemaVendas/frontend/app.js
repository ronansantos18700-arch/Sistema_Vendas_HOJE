/**
 * SV Ultra - Core Application Logic
 * Refactored for Labs Design Theme
 */

const app = {
    // --- Configuração ---
    config: {
        // Login e gestão de usuários. Com false, o sistema abre direto (usuário local administrador)
        // e as telas de login e de usuários ficam ocultas. Para voltar, troque para true.
        loginAtivo: true,
        notifPorPagina: 4,
        // Tema escuro: desativado por enquanto. Com false, o sistema usa só o tema claro e os controles de tema ficam ocultos.
        // Para voltar, troque para true.
        temaEscuroAtivo: false,
        usuarioLocal: { id: 'local', fullname: 'Administrador', username: 'local', role: 'admin' },
        loginMaxAttempts: 5,
        loginLockoutMs: 30000,
        pbkdf2Iterations: 100000,
        backupMaxSizeMb: 100,
        auditLogMaxEntries: 1000,
        passwordMinLength: 6,
        weakPasswords: [
            '1234', '123456', 'admin',
            'password', '0000', '111111'
        ]
    },

    // --- State ---
    state: {
        products: [],
        customers: [],
        sales: [],
        reversals: [],
        movimentacoes: [],
        users: [],
        currentUser: null,
        cart: [],
        settings: {
            companyName: 'SV Ultra',
            ownerName: '',
            whatsapp: '',
            email: '',
            address: '',
            logoUrl: ''
        },
        currentView: 'pos',
        editingId: null,
        charts: {
            line: null,
            profit: null,
            cost: null,
            customers: null,
            topProducts: null,
            paymentMethods: null,
            salesByHour: null,
            profitMarginPercent: null,
            topProfitable: null
        },
        dashboardFilter: '7d',
        dashboardVisao: 'vendas',
        relatorioPeriodo: 'mes',
        relatorioFormato: 'xlsx',
        activeChartDatasets: ['faturamento', 'lucro', 'custo'],
        latestEntradasPage: 1,
        criticalStockPage: 1,
        recentSalesDashboardPage: 1,
        posState: {
            customer: '',
            payment: 'dinheiro',
            discount: '',
            paid: '',
            isDirectSale: false
        },
        tutorialStep: 0,
        dataLoaded: false,
        loginAttempts: 0,
        lockoutUntil: null,
        mustChangePassword: false,
        auditLog: [],
        entradas: [],
        categories: []
    },

    // --- Temporários ---
    entradaItemsTemp: [],
    snapshotSalvo: null, // última gravação bem-sucedida (usado para gravar só o que mudou)

    // --- Utilitários de DOM ---
    getDOMRefs() {
        // Centraliza as referências de DOM para lidar com inconsistências de IDs/Classes
        return {
            loginScreen: document.getElementById('login-screen') || document.getElementById('loginscreen'),
            appContainer: document.querySelector('.app-container') || document.querySelector('.appcontainer'),
        };
    },

    exitConfirm() {
        // Abre modal de saída sem usar confirmAction() para não 
        // contaminar o modal genérico com textos customizados 
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-msg');
        const iconEl = document.getElementById('confirm-modal-icon');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');

        if (titleEl) titleEl.textContent = 'Sair do Sistema';
        if (msgEl) msgEl.textContent = this.config.loginAtivo ? 'O que deseja fazer agora?' : 'Deseja fechar o programa?';
        if (iconEl) iconEl.setAttribute('data-lucide', 'log-out');

        if (okBtn) {
            okBtn.style.display = this.config.loginAtivo ? '' : 'none';
            okBtn.textContent = 'Sair da Sessão';
            okBtn.onclick = () => {
                this.logout();
                this.closeModal();
            };
        }
        if (cancelBtn) {
            cancelBtn.textContent = 'Fechar Programa';
            cancelBtn.onclick = () => {
                this.exitApp();
                this.closeModal();
            };
        }

        this.initLucide();
        this.openModal('generic-confirm');
    },

    esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    },

    // --- Segurança de Login ---
    saveLoginSecurityState() {
        const data = {
            attempts: this.state.loginAttempts,
            lockoutUntil: this.state.lockoutUntil,
            savedAt: Date.now()
        };
        localStorage.setItem(
            'sv_login_security',
            JSON.stringify(data)
        );
    },

    loadLoginSecurityState() {
        try {
            const raw = localStorage.getItem('sv_login_security');
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data.lockoutUntil && Date.now() > data.lockoutUntil) {
                localStorage.removeItem('sv_login_security');
                return;
            }
            this.state.loginAttempts = data.attempts || 0;
            this.state.lockoutUntil = data.lockoutUntil || null;
        } catch (e) {
            localStorage.removeItem('sv_login_security');
        }
    },

    hojeISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    logAudit(action, details = {}) {
        const entry = {
            ts: new Date().toISOString(),
            user: this.state.currentUser?.username || 'sistema',
            userId: this.state.currentUser?.id || null,
            action,
            details
        };
        this.state.auditLog.push(entry);
        if (this.state.auditLog.length > this.config.auditLogMaxEntries) {
            this.state.auditLog = this.state.auditLog.slice(-this.config.auditLogMaxEntries);
        }
        try {
            const saved = JSON.parse(localStorage.getItem('sv_audit_log') || '[]');
            saved.push(entry);
            localStorage.setItem('sv_audit_log', JSON.stringify(saved.slice(-1000)));
        } catch (e) {
            console.warn('Erro no log de auditoria:', e);
        }
    },

    // --- Initialization ---
    // --- Servidor central ---
    emModoServidor() {
        return !!(this.servidor && this.servidor.logado);
    },

    origemDeDados() {
        // Com servidor configurado, os dados só vão para o servidor, mesmo sem sessão.
        // Nunca cair na ponte: ela grava no banco local da máquina e separaria os dados.
        if (this.servidor && window.SvServidor) return window.SvServidor.origemDeDados(this.servidor);
        if (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects && window.chrome.webview.hostObjects.bridge) {
            return window.chrome.webview.hostObjects.bridge;
        }
        return null;
    },

    // --- Monitor do servidor ---
    // Se o servidor cai, o sistema para (tela bloqueada com aviso). Quando volta, confere a sessão,
    // grava o que ficou pendente e recarrega os dados (inclui o que outros computadores gravaram).
    iniciarMonitorServidor() {
        if (!this.servidor || this.monitorServidor) return;
        this.monitorServidor = setInterval(() => this.verificarServidor(), 4000);
    },

    async verificarServidor() {
        if (this.verificandoServidor) return;
        this.verificandoServidor = true;
        try {
            const ok = await this.servidor.verificarConexao();
            if (!ok) {
                if (!this.servidorCaido) {
                    this.servidorCaido = true;
                    this.mostrarServidorIndisponivel(true);
                }
                return;
            }
            if (this.servidorCaido) {
                this.servidorCaido = false;
                this.mostrarServidorIndisponivel(false);
                await this.servidorVoltou();
            }
        } finally {
            this.verificandoServidor = false;
        }
    },

    async servidorVoltou() {
        if (!this.emModoServidor()) return; // ninguém logado: a tela de login volta ao normal
        let valida = true;
        try {
            valida = await this.servidor.sessaoValida();
        } catch (_) {
            return; // caiu de novo: o monitor detecta na próxima verificação
        }
        if (!valida) {
            // Sessão perdida (o servidor reiniciou ou expirou): volta para o login.
            this.logout();
            this.showLoginError('O servidor foi reiniciado. Entre novamente.');
            return;
        }
        try {
            // Grava o que ficou pendente antes de recarregar; se falhar, não recarrega (não perde nada).
            // Se a leitura inicial nunca deu certo, não há o que gravar: só recarrega.
            if (this.state.dataLoaded) {
                const gravou = await this.salvarDados();
                if (gravou === false) return;
            }
            await this.carregarDados();
        } catch (err) {
            this.showNotification('error', err.message);
        }
    },

    mostrarServidorIndisponivel(ativo) {
        let aviso = document.getElementById('servidor-indisponivel');
        if (!ativo) {
            if (aviso) aviso.remove();
            return;
        }
        if (aviso) return;

        aviso = document.createElement('div');
        aviso.id = 'servidor-indisponivel';
        aviso.setAttribute('role', 'alertdialog');
        aviso.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,0.92);color:#fff;' +
            'display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;';

        const caixa = document.createElement('div');
        caixa.style.cssText = 'max-width:460px;';

        const titulo = document.createElement('h2');
        titulo.textContent = 'Servidor indisponível';
        titulo.style.cssText = 'margin:0 0 12px;font-size:1.4rem;';

        const texto = document.createElement('p');
        texto.textContent = 'A conexão com o servidor de vendas caiu. O sistema está pausado para não perder dados.';
        texto.style.cssText = 'margin:0 0 8px;';

        const endereco = document.createElement('p');
        endereco.textContent = 'Endereço: ' + (this.servidor.url || '(não definido)');
        endereco.style.cssText = 'margin:0 0 16px;opacity:0.85;';

        const rodape = document.createElement('p');
        rodape.textContent = 'Esta tela some sozinha quando o servidor voltar. Não feche o programa.';
        rodape.style.cssText = 'margin:0;opacity:0.85;';

        caixa.append(titulo, texto, endereco, rodape);
        aviso.appendChild(caixa);
        document.body.appendChild(aviso);
    },

    async loginServidor(username, password) {
        this.setLoading(true);
        try {
            const usuario = await this.servidor.login(username, password);
            this.state.loginAttempts = 0;
            this.state.lockoutUntil = null;
            localStorage.removeItem('sv_login_security');
            this.state.currentUser = usuario;
            this.hideLoginError();

            await this.carregarDados();
            this.logAudit('LOGIN_SUCCESS', { username: usuario.username });

            const { loginScreen, appContainer } = this.getDOMRefs();
            if (loginScreen) loginScreen.classList.add('hidden');
            if (appContainer) appContainer.classList.remove('hidden');
            this.updateBrand();
            this.switchView('pos');

            if (usuario.trocarSenha) {
                this.state.mustChangePassword = true;
                setTimeout(() => {
                    this.showAlert(
                        'Troca de Senha Obrigatória',
                        'Senha provisória detectada. Defina uma nova senha em Configurações > Usuários antes de continuar.',
                        'shield-alert'
                    );
                    this.switchView('settings');
                    setTimeout(() => this.switchSettingsSection('usuarios'), 300);
                }, 500);
            }
        } catch (err) {
            this.showLoginError(err.message);
        } finally {
            this.setLoading(false);
        }
    },

    async recarregarUsuariosServidor() {
        let lista = [];
        try {
            lista = await this.servidor.listarUsuarios();
        } catch (err) {
            if (err.status !== 403) throw err;
        }
        this.state.users = lista.map(u => ({
            id: String(u.id || ''),
            fullname: String(u.fullname || ''),
            username: String(u.username || ''),
            password: '',
            role: String(u.role || 'operador'),
            isDefaultCredential: !!u.isDefaultCredential
        }));
    },

    async salvarUsuarioServidor(e, editingId, fullname, username, role, password) {
        const campoAtual = document.getElementById('user-current-password');
        const senhaAtual = campoAtual ? campoAtual.value : '';
        const euMesmo = !!editingId && !!this.state.currentUser && this.state.currentUser.id === editingId;
        const mudouLogin = euMesmo && this.state.currentUser.username !== username;

        this.setLoading(true);
        try {
            if (!editingId) {
                if (!password) {
                    this.showNotification('error', 'A senha é obrigatória para novos usuários.');
                    return;
                }
                await this.servidor.criarUsuario({ fullname, username, role, senha: password });
                this.showNotification('success', 'Usuário criado com sucesso!');
            } else {
                if (euMesmo && password) {
                    if (!senhaAtual) {
                        this.showNotification('error', 'Informe a senha atual para trocar a sua senha.');
                        return;
                    }
                    await this.servidor.trocarMinhaSenha(senhaAtual, password);
                }
                // Operador só troca a própria senha; nome, login e perfil são editados pelo admin.
                const podeEditarCadastro = !euMesmo || this.state.currentUser.role === 'admin';
                if (podeEditarCadastro) {
                    // Para o próprio usuário, a senha já foi trocada acima; só repete se o login mudou (o hash usa o login).
                    const senhaParaEnviar = euMesmo ? (mudouLogin ? password : '') : password;
                    await this.servidor.atualizarUsuario(editingId, { fullname, username, role, senha: senhaParaEnviar });
                }
                this.showNotification('success', 'Usuário atualizado com sucesso!');
            }

            await this.recarregarUsuariosServidor();
            if (euMesmo) {
                const eu = this.state.users.find(u => u.id === editingId);
                this.state.currentUser = { ...this.state.currentUser, ...(eu || {}) };
                if (password) {
                    this.state.mustChangePassword = false;
                    this.state.currentUser.isDefaultCredential = false;
                }
                this.updateBrand();
            }
            this.renderUsers();
            this.closeModal();
            e.target.reset();
            document.getElementById('user-password').required = true;
            document.getElementById('user-confirm-password').required = true;
        } catch (err) {
            this.showNotification('error', err.message);
        } finally {
            this.setLoading(false);
        }
    },

    // Foto escolhida no PC vai para o servidor; a URL do servidor é o que fica gravado no produto/cliente.
    async escolherFoto(bridge) {
        const caminhoLocal = await bridge.SelectFile();
        if (!caminhoLocal || !this.emModoServidor()) return caminhoLocal;
        try {
            const dataUrl = await bridge.GetFileBase64(caminhoLocal);
            if (!dataUrl) throw new Error('Não foi possível ler a foto escolhida.');
            const base64 = String(dataUrl).split(',').pop();
            return await this.servidor.enviarImagem(caminhoLocal.split('/').pop(), base64);
        } catch (err) {
            this.showNotification('error', 'Foto não enviada: ' + err.message);
            return null;
        }
    },

    async init() {
        this.servidor = window.SvServidor ? new window.SvServidor.ServidorAPI() : null;
        if (!this.config.loginAtivo) {
            this.state.currentUser = { ...this.config.usuarioLocal };
            document.body.classList.add('sem-login');
        }
        this.loadTheme();
        this.loadLoginSecurityState();
        this.setupGlobalHandlers();
        this.setupBridge();
        // Com login, os dados são carregados depois de entrar (o servidor exige sessão).
        if (!this.config.loginAtivo) await this.carregarDados();
        this.iniciarMonitorServidor();
        this.setupEventListeners();
        this.initLucide();

        const { loginScreen, appContainer } = this.getDOMRefs();

        // Se já houver um usuário logado no estado (ex: após refresh), tenta restaurar
        if (this.state.currentUser) {
            const initialView = this.state.currentUser.role === 'operador' ? 'pos' : 'pos';
            this.switchView(initialView);
            if (loginScreen) loginScreen.classList.add('hidden');
            if (appContainer) appContainer.classList.remove('hidden');
        } else {
            // Caso contrário, garante que a tela de login está visível
            if (loginScreen) loginScreen.classList.remove('hidden');
            if (appContainer) appContainer.classList.add('hidden');
        }

        this.updateNotifications();
        this.renderAll();
    },

    // --- Authentication ---
    async hashPassword(password, username = 'default') {
        const encoder = new TextEncoder();
        const saltString = username.toLowerCase() + '_SV2024_' + username.length;
        const saltBuffer = encoder.encode(saltString);
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: saltBuffer,
                iterations: this.config.pbkdf2Iterations,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );
        return Array.from(new Uint8Array(derivedBits))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    },

    async login(username, password) {
        if (this.servidor) return this.loginServidor(username, password);
        // Mensagem de lockout atualiza em tempo real
        if (this.state.lockoutUntil && Date.now() < this.state.lockoutUntil) {
            if (this.lockoutInterval) clearInterval(this.lockoutInterval);
            const updateLockoutMsg = () => {
                const remaining = Math.ceil((this.state.lockoutUntil - Date.now()) / 1000);
                if (remaining <= 0) {
                    clearInterval(this.lockoutInterval);
                    this.hideLoginError();
                    return;
                }
                this.showLoginError(
                    `Muitas tentativas! Aguarde ${remaining} segundo${remaining !== 1 ? 's' : ''}.`
                );
            };
            updateLockoutMsg();
            this.lockoutInterval = setInterval(updateLockoutMsg, 1000);
            return;
        }

        const user = this.state.users.find(u => u.username === username);
        if (!user) {
            this.handleLoginFailure('Usuário não encontrado.');
            return;
        }

        this.setLoading(true);
        try {
            const hashedPassword = await this.hashPassword(password, username);

            // Fallback: Verificar se é uma senha antiga (sem salt)
            if (user.password !== hashedPassword) {
                const msgUint8 = new TextEncoder().encode(password);
                const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const oldHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                if (user.password === oldHash) {
                    // Migrar para o novo formato de salt automaticamente
                    user.password = hashedPassword;
                    await this.salvarDados();
                } else {
                    this.handleLoginFailure('Senha incorreta.');
                    return;
                }
            }

            // Login bem-sucedido
            this.state.loginAttempts = 0;
            this.state.lockoutUntil = null;
            if (this.lockoutInterval) clearInterval(this.lockoutInterval);
            localStorage.removeItem('sv_login_security');
            this.state.currentUser = user;
            this.hideLoginError();
            this.logAudit('LOGIN_SUCCESS', { username });

            // UI Transition
            const { loginScreen, appContainer } = this.getDOMRefs();
            if (loginScreen) loginScreen.classList.add('hidden');
            if (appContainer) appContainer.classList.remove('hidden');

            // Atualizar perfil no sidebar
            this.updateBrand();

            // Inicializar view padrão
            const initialView = user.role === 'operador' ? 'pos' : 'pos';
            this.switchView(initialView);

            // Se for o admin padrão ou senha provisória, obriga a trocar
            if (user.isDefaultCredential || (user.username === 'admin' && password === '1234')) {
                this.state.mustChangePassword = true;
                setTimeout(() => {
                    this.showAlert(
                        'Troca de Senha Obrigatória',
                        'Senha provisória detectada. Defina uma nova senha em Configurações > Usuários antes de continuar.',
                        'shield-alert'
                    );
                    this.switchView('settings');
                    setTimeout(() => this.switchSettingsSection('usuarios'), 300);
                }, 500);
            }
        } finally {
            this.setLoading(false);
        }
    },

    handleLoginFailure(message) {
        this.state.loginAttempts++;

        if (this.state.loginAttempts >= this.config.loginMaxAttempts) {
            // Lockout configurado: contador regressivo em tempo real
            this.state.lockoutUntil = Date.now() + this.config.loginLockoutMs;
            
            if (this.lockoutInterval) clearInterval(this.lockoutInterval);
            const updateMsg = () => {
                const remaining = Math.ceil((this.state.lockoutUntil - Date.now()) / 1000);
                if (remaining <= 0) {
                    clearInterval(this.lockoutInterval);
                    this.hideLoginError();
                    return;
                }
                this.showLoginError(
                    `Sistema bloqueado! Aguarde ${remaining} segundo${remaining !== 1 ? 's' : ''}.`
                );
            };
            updateMsg();
            this.lockoutInterval = setInterval(updateMsg, 1000);

            // Resetar tentativas após lockout expirar
            setTimeout(() => {
                this.state.loginAttempts = 0;
                this.state.lockoutUntil = null;
                if (this.lockoutInterval) clearInterval(this.lockoutInterval);
            }, this.config.loginLockoutMs);
        } else {
            this.showLoginError(`${message} (${this.state.loginAttempts}/${this.config.loginMaxAttempts} tentativas)`);
        }
        this.saveLoginSecurityState();
        this.logAudit('LOGIN_FAILURE', { attempts: this.state.loginAttempts });
    },

    logout() {
        if (!this.config.loginAtivo) return; // sem login, não há sessão para encerrar
        this.logAudit('LOGOUT', {});
        if (this.servidor) this.servidor.sair();
        this.state.currentUser = null;
        const { loginScreen, appContainer } = this.getDOMRefs();
        if (loginScreen) loginScreen.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');

        // Limpar campos de login
        const loginUsername = document.getElementById('login-username');
        const loginPassword = document.getElementById('login-password');
        if (loginUsername) loginUsername.value = '';
        if (loginPassword) loginPassword.value = '';

        // Resetar perfil no sidebar
        this.updateBrand();
    },

    showLoginError(msg) {
        const errEl = document.getElementById('login-error');
        if (errEl) {
            errEl.textContent = msg;
            errEl.classList.remove('hidden');
        }
    },

    hideLoginError() {
        const errEl = document.getElementById('login-error');
        if (errEl) errEl.classList.add('hidden');
    },

    // --- Autorização e Segurança ---
    requirePasswordChange() {
        if (!this.state.mustChangePassword) return false;
        this.showNotification('error',
            'Troque sua senha provisória primeiro. ' +
            'Acesse Configurações > Usuários.'
        );
        return true;
    },

    requireAdmin(acao = 'realizar esta ação') {
        if (!this.state.currentUser) {
            this.showNotification('error', 'Faça login novamente.');
            this.logout();
            return false;
        }
        if (this.state.currentUser.role !== 'admin') {
            this.showNotification('error',
                `Apenas administradores podem ${acao}.`
            );
            return false;
        }
        return true;
    },

    applyPermissions() {
        const user = this.state.currentUser;
        if (!user) return;

        const isAdmin = user.role === 'admin';

        // Seletores de botões que devem ser escondidos para operadores
        const restrictedBtns = [
            'button[data-view="dashboard"]',
            'button[data-view="products"]',
            'button[data-view="entradas"]',
            'button[data-view="settings"]',
            '#btn-notifications',
            '#btn-add-user-shortcut'
        ];

        restrictedBtns.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) el.style.display = isAdmin ? 'flex' : 'none';
        });
    },

    renderTopProfitableProductsChart() {
        const ctx = document.getElementById('topProfitableProductsChart');
        if (!ctx) return;

        const filteredSales = this.getFilteredSales();
        let top5;
        if (window.Dashboard && typeof Dashboard.rankingProdutos === 'function') {
            // Fonte única da verdade: mesmo cálculo com rateio de desconto usado em #dash-ven-lucro
            top5 = Dashboard.rankingProdutos(filteredSales, this.state.products)
                .sort((a, b) => b.lucro - a.lucro)
                .slice(0, 5)
                .map(p => ({ id: p.id, name: p.nome, profit: p.lucro }));
        } else {
            const productStats = {};
            filteredSales.forEach(sale => {
                const total = Number(sale.valor_total) || 0;
                const final = total - (Number(sale.desconto) || 0);
                const fator = total > 0 ? final / total : 1;
                if (sale.items && Array.isArray(sale.items)) {
                    sale.items.forEach(item => {
                        const id = item.productId || item.id;
                        if (!productStats[id]) {
                            const productInfo = this.state.products.find(p => p.id === id);
                            productStats[id] = {
                                id: id,
                                name: item.name || productInfo?.name || 'Produto Desconhecido',
                                profit: 0
                            };
                        }
                        const qty = Number(item.qtySold) || Number(item.qty) || 0;
                        const price = Number(item.price) || 0;
                        const cost = Number(item.cost) || 0;
                        productStats[id].profit += (price * fator - cost) * qty;
                    });
                }
            });
            top5 = Object.values(productStats)
                .sort((a, b) => b.profit - a.profit)
                .slice(0, 5);
        }

        const labels = top5.map(p => {
            return p.name.length > 18 ? p.name.substring(0, 18) + '...' : p.name;
        });
        const data = top5.map(p => p.profit);

        if (this.state.charts.topProfitable) {
            this.state.charts.topProfitable.destroy();
        }

        if (top5.length === 0) return;

        const theme = this.getThemeColors();
        this.state.charts.topProfitable = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Lucro Total',
                    data: data,
                    backgroundColor: 'rgba(127, 165, 142, 0.6)',
                    borderColor: '#2e9e6a',
                    borderWidth: 1,
                    borderRadius: 6,
                    barThickness: 18
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { left: 0, right: 10, top: 0, bottom: 0 }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: theme.tooltipBg,
                        titleColor: theme.tooltipText,
                        bodyColor: theme.tooltipText,
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                            label: (context) => `Lucro: ${this.formatCurrency(context.raw)}`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: theme.grid, drawBorder: false },
                        ticks: { color: theme.ticks, font: { size: 10 } }
                    },
                    y: {
                        grid: { display: false, drawBorder: false },
                        ticks: { 
                            color: theme.text, 
                            font: { size: 11, weight: '500' }
                        }
                    }
                }
            }
        });
    },

    setupGlobalHandlers() {
        window.onerror = (msg, url, line, col, error) => {
            console.error("Global JS Error:", { msg, url, line, col, error });
            this.showNotification('error', `Erro interno: ${msg}`);
            this.setLoading(false);
            return false;
        };

        window.onunhandledrejection = (event) => {
            console.error("Unhandled Promise Rejection:", event.reason);
            this.showNotification('error', `Erro assíncrono: ${event.reason?.message || event.reason}`);
            this.setLoading(false);
        };
    },

    setLoading(active) {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.toggle('hidden', !active);
        }
    },

    async handlePhotoSelection() {
        if (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects.bridge) {
            const bridge = window.chrome.webview.hostObjects.bridge;
            const photoPath = await this.escolherFoto(bridge);
            if (photoPath) {
                document.getElementById('prod-image-url').value = photoPath;
                this.updatePhotoPreview(photoPath);
            }
        } else {
            this.showNotification('info', 'Seleção de arquivo disponível apenas no Excel.');
        }
    },

    updatePhotoPreview(path) {
        const preview = document.getElementById('prod-photo-preview');
        if (path) {
            preview.innerHTML = `<img src="${path}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        } else {
            preview.innerHTML = `<i data-lucide="package" style="width: 32px; height: 32px; color: var(--text-dim);"></i>`;
            this.initLucide();
        }
    },

    setupBridge() {
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.addEventListener('message', event => {
                const { type, message } = event.data;
                this.showNotification(type, message);
            });
        }
    },

    showNotification(type, message) {
        // Criar elemento de notificação se não existir
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px;';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        const tipo = ['success', 'error'].includes(type) ? type : 'info';
        toast.className = `sv-toast sv-toast-${tipo}`;
        toast.setAttribute('role', 'status');
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    setupEventListeners() {
        // Login Form
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const user = document.getElementById('login-username').value;
                const pass = document.getElementById('login-password').value;
                await this.login(user, pass);
            });
        }

        // Toggle Password
        const btnTogglePass = document.getElementById('toggle-password');
        if (btnTogglePass) {
            btnTogglePass.setAttribute('aria-label', 'Mostrar senha');
            btnTogglePass.addEventListener('click', () => {
                const passInput = document.getElementById('login-password');
                const icon = document.getElementById('toggle-password-icon');
                const mostrar = passInput.type === 'password';
                passInput.type = mostrar ? 'text' : 'password';
                btnTogglePass.setAttribute('aria-label', mostrar ? 'Ocultar senha' : 'Mostrar senha');
                if (icon) {
                    icon.textContent = '';
                    icon.setAttribute('data-lucide', mostrar ? 'eye-off' : 'eye');
                    if (typeof lucide !== 'undefined') {
                        lucide.createIcons({
                            attrs: {
                                class: 'lucide-icon',
                                'stroke-width': 1.2
                            },
                            nameAttr: 'data-lucide',
                            icons: undefined,
                            root: icon
                        });
                    }
                }
            });
        }

        // Alternância de visualização: Produtos e Entradas
        document.querySelectorAll('.seg-toggle[data-vista]').forEach(grupo => {
            grupo.querySelectorAll('button[data-visao]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const vista = grupo.dataset.vista;
                    localStorage.setItem('sv_visao_' + vista, btn.dataset.visao);
                    if (vista === 'produtos') {
                        this.renderProducts(document.getElementById('filter-products')?.value || '', document.getElementById('filter-category')?.value || '');
                    } else if (vista === 'entradas') {
                        this.renderEntradas(document.getElementById('filter-entradas')?.value || '', document.getElementById('filter-date-entradas')?.value || '');
                    }
                });
            });
        });

        // Controles de janela (minimizar e fechar): só no app desktop, pela ponte do WebView2
        const winControls = document.getElementById('win-controls');
        const hostBridge = window.chrome?.webview?.hostObjects?.bridge;
        if (winControls && !hostBridge) winControls.style.display = 'none';
        if (hostBridge) {
            document.getElementById('btn-win-min')?.addEventListener('click', () => {
                Promise.resolve(hostBridge.MinimizeWindow()).catch(err => console.error('Falha ao minimizar', err));
            });
            // O FormClosing do C# já pede confirmação antes de fechar
            document.getElementById('btn-win-close')?.addEventListener('click', () => {
                Promise.resolve(hostBridge.QuitApplication()).catch(err => console.error('Falha ao fechar', err));
            });
        }

        // Estoque em tempo real: filtro e ordenação
        const filtroEstoque = document.getElementById('filter-estoque');
        if (filtroEstoque) filtroEstoque.addEventListener('input', () => this.renderEstoque());
        const ordemEstoque = document.getElementById('sort-estoque');
        if (ordemEstoque) ordemEstoque.addEventListener('change', () => this.renderEstoque());
        document.querySelectorAll('#estoque-visao-toggle button').forEach(btn => {
            btn.addEventListener('click', () => {
                localStorage.setItem('sv_estoque_visao', btn.dataset.visao);
                this.renderEstoque();
            });
        });
        this.bindMovimentacoes();

        // Nova venda: abre o PDV (o switchView já foca o código de barras). Não limpa o carrinho atual.
        const btnNovaVenda = document.getElementById('btn-nova-venda');
        if (btnNovaVenda) {
            btnNovaVenda.addEventListener('click', () => {
                this.switchView('pos');
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) sidebar.classList.remove('show');
            });
        }

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-view');
                if (view) {
                    this.switchView(view);
                    // Fechar sidebar no mobile após clicar
                    const sidebar = document.querySelector('.sidebar');
                    if (sidebar) sidebar.classList.remove('show');
                }
            });
        });

        // PDV: botão para sair do modo foco e mostrar o menu
        const btnPosFoco = document.getElementById('btn-pos-foco');
        if (btnPosFoco) {
            btnPosFoco.addEventListener('click', () => this.aplicarFocoPdv(null));
        }

        // Sidebar Toggle
        const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
        if (btnToggleSidebar) {
            btnToggleSidebar.addEventListener('click', () => {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) sidebar.classList.toggle('show');
            });
        }

        const btnToggleSidebarMini = document.getElementById('btn-toggle-sidebar-mini');
        if (btnToggleSidebarMini) {
            // Restore state
            const isCollapsed = localStorage.getItem('sv_sidebar_collapsed') === 'true';
            const sidebar = document.querySelector('.sidebar');
            if (isCollapsed && sidebar) sidebar.classList.add('collapsed');

            btnToggleSidebarMini.addEventListener('click', () => {
                if (sidebar) {
                    sidebar.classList.toggle('collapsed');
                    localStorage.setItem('sv_sidebar_collapsed', sidebar.classList.contains('collapsed'));
                }
            });
        }

        // Tutorial
        const startTutorialBtn = document.getElementById('start-tutorial');
        if (startTutorialBtn) {
            startTutorialBtn.addEventListener('click', () => this.startTutorial());
        }
        const nextTutorialBtn = document.getElementById('tutorial-next-btn');
        if (nextTutorialBtn) {
            nextTutorialBtn.addEventListener('click', () => this.nextTutorialStep());
        }

        // Close modal on overlay click
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                // Não fechar se for tutorial (usuário deve usar botões do tutorial)
                if (overlay.classList.contains('tutorial-active')) return;
                if (e.target === overlay) this.closeModal();
            });
        }

        // PDV: busca/leitor, categorias, pagamento e atalhos
        const barcodeInput = document.getElementById('pos-barcode');
        const paidInput = document.getElementById('pos-paid');
        const paymentSelect = document.getElementById('pos-payment');
        const finishBtn = document.getElementById('btn-finish-sale');

        if (barcodeInput) {
            barcodeInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.handleBarcodeEntry(barcodeInput.value);
                }
            });
            barcodeInput.addEventListener('input', () => this.renderPosCatalog());
        }

        const chips = document.getElementById('pos-chips');
        if (chips) {
            chips.onclick = (e) => {
                const botao = e.target.closest('.pos-chip');
                if (!botao) return;
                this.state.posCatalog = { categoria: botao.dataset.cat || '' };
                this.renderPosCatalog();
            };
        }

        document.querySelectorAll('.pos-pay-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (!paymentSelect) return;
                paymentSelect.value = btn.dataset.pay;
                paymentSelect.dispatchEvent(new Event('change'));
            });
        });

        if (paymentSelect) {
            paymentSelect.addEventListener('change', () => {
                this.state.posState.payment = paymentSelect.value;
                this.state.posState.split = false;
                this.updatePaidVisibility();
            });
            this.updatePaidVisibility();
        }
        const btnSplit = document.getElementById('btn-split-pay');
        if (btnSplit) btnSplit.addEventListener('click', () => this.toggleSplitPay());
        const btnSplitAdd = document.getElementById('btn-split-add');
        if (btnSplitAdd) btnSplitAdd.addEventListener('click', () => this.addSplitRow());
        const splitRows = document.getElementById('pos-split-rows');
        if (splitRows) {
            splitRows.addEventListener('change', (e) => {
                if (!e.target.classList.contains('pos-split-forma')) return;
                this.state.posState.splitRows[Number(e.target.dataset.idx)].forma = e.target.value;
                this.updateSplitSummary();
            });
            splitRows.addEventListener('input', (e) => {
                if (!e.target.classList.contains('pos-split-valor')) return;
                this.state.posState.splitRows[Number(e.target.dataset.idx)].valor = parseFloat(e.target.value) || 0;
                this.updateSplitSummary();
            });
            splitRows.addEventListener('click', (e) => {
                const btn = e.target.closest('.pos-split-remove');
                if (!btn) return;
                this.state.posState.splitRows.splice(Number(btn.dataset.idx), 1);
                this.renderSplitRows();
                this.updateSplitSummary();
            });
        }
        if (paidInput) {
            paidInput.addEventListener('input', () => {
                this.state.posState.paid = paidInput.value;
                this.calculateChange();
            });
        }
        const discountInput = document.getElementById('pos-discount');
        if (discountInput) {
            discountInput.addEventListener('input', () => {
                this.state.posState.discount = discountInput.value;
                this.calculateTotals();
            });
        }
        document.querySelectorAll('.pos-disc-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setDiscountType(btn.getAttribute('data-disc')));
        });
        const btnClear = document.getElementById('btn-clear-sale');
        if (btnClear) btnClear.addEventListener('click', () => this.limparVenda());
        const customerEl = document.getElementById('pos-customer');
        if (customerEl) {
            customerEl.addEventListener('change', () => {
                this.state.posState.customer = customerEl.value;
            });
        }
        if (finishBtn) finishBtn.addEventListener('click', () => this.finishSale());

        // F2: foca a busca. F4: finaliza a venda. Só com o PDV aberto e sem modal.
        document.addEventListener('keydown', (e) => {
            if (this.state.currentView !== 'pos') return;
            const overlay = document.getElementById('modal-overlay');
            if (overlay && !overlay.classList.contains('hidden')) return;
            if (e.key === 'F2') {
                e.preventDefault();
                barcodeInput?.focus();
            } else if (e.key === 'F3') {
                e.preventDefault();
                this.limparVenda();
            } else if (e.key === 'F4') {
                e.preventDefault();
                this.finishSale();
            }
        });

        const exitBtn = document.getElementById('btn-exit-app');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => this.exitConfirm());
        }

        // Notifications logic
        const btnNotif = document.getElementById('btn-notifications');
        const notifDropdown = document.getElementById('notification-dropdown');
        if (btnNotif) {
            btnNotif.addEventListener('click', (e) => {
                e.stopPropagation();
                notifDropdown.classList.toggle('hidden');
            });
        }

        // Theme Toggle logic
        const btnTheme = document.getElementById('btn-theme-toggle');
        if (btnTheme) {
            btnTheme.addEventListener('click', () => this.toggleTheme());
        }

        const appearanceThemeToggle = document.getElementById('appearance-theme-toggle');
        if (appearanceThemeToggle) {
            appearanceThemeToggle.addEventListener('change', (e) => {
                const shouldBeLight = !!e.target.checked;
                const isLight = document.body.classList.contains('light-theme');
                if (shouldBeLight !== isLight) this.toggleTheme();
            });
        }

        // Shortcut to Users
        const btnAddUserShortcut = document.getElementById('btn-add-user-shortcut');
        if (btnAddUserShortcut) {
            btnAddUserShortcut.addEventListener('click', () => {
                if (!this.requireAdmin('acessar gestão de usuários')) return;
                this.switchView('settings');
                setTimeout(() => {
                    this.switchSettingsSection('usuarios');
                    // Opcional: Abrir o modal de novo usuário diretamente
                    // this.openModal('user-modal');
                }, 100);
            });
        }

        document.addEventListener('click', (e) => {
            // composedPath: o alvo da paginação pode sair do DOM antes do fim do clique
            const caminho = e.composedPath ? e.composedPath() : [];
            if (notifDropdown && !caminho.includes(notifDropdown) && !caminho.includes(btnNotif)) {
                notifDropdown.classList.add('hidden');
            }
        });

        // Modals
        const productForm = document.getElementById('product-form');
        if (productForm) productForm.addEventListener('submit', (e) => this.handleProductSubmit(e));

        const customerForm = document.getElementById('customer-form');
        if (customerForm) customerForm.addEventListener('submit', (e) => this.handleCustomerSubmit(e));

        const userForm = document.getElementById('user-form');
        if (userForm) userForm.addEventListener('submit', (e) => this.handleUserSubmit(e));

        const filterProd = document.getElementById('filter-products');
        if (filterProd) filterProd.addEventListener('input', (e) => {
            const categoria = document.getElementById('filter-category')?.value || '';
            this.renderProducts(e.target.value, categoria);
        });

        const filterCat = document.getElementById('filter-category');
        if (filterCat) filterCat.addEventListener('change', (e) => {
            const query = document.getElementById('filter-products')?.value || '';
            this.renderProducts(query, e.target.value);
        });

        const filterCust = document.getElementById('filter-customers');
        if (filterCust) filterCust.addEventListener('input', (e) => this.renderCustomers(e.target.value));

        const filterHist = document.getElementById('filter-history');
        if (filterHist) filterHist.addEventListener('input', () => this.renderHistory());

        const filterDateHist = document.getElementById('filter-date-history');
        if (filterDateHist) filterDateHist.addEventListener('change', () => this.renderHistory());

        // Receipt actions
        const btnPrint = document.getElementById('btn-receipt-print');
        if (btnPrint) btnPrint.addEventListener('click', () => this.confirmFinishSale('print'));

        // Stock adjustment
        const stockForm = document.getElementById('stock-form');
        if (stockForm) stockForm.addEventListener('submit', (e) => this.handleStockSubmit(e));

        // Settings
        const settingsForm = document.getElementById('settings-form-page');
        if (settingsForm) settingsForm.addEventListener('submit', (e) => this.handleSettingsSubmit(e));

        // WhatsApp Masks
        ['cust-whatsapp', 'set-company-whatsapp-page'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', (e) => {
                    let v = e.target.value.replace(/\D/g, '');
                    if (v.length > 11) v = v.slice(0, 11);

                    if (v.length > 10) {
                        v = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
                    } else if (v.length > 6) {
                        v = `(${v.slice(0, 2)}) ${v.slice(2, 6)}-${v.slice(6)}`;
                    } else if (v.length > 2) {
                        v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
                    } else if (v.length > 0) {
                        v = `(${v}`;
                    }
                    e.target.value = v;
                });
            }
        });
    },

    toggleTheme() {
        if (!this.config.temaEscuroAtivo) return;
        const isLight = document.body.classList.toggle('light-theme');
        localStorage.setItem('sv_theme', isLight ? 'light' : 'dark');
        this.updateThemeIcon();
        this.syncAppearanceThemeToggle();
    },

    loadTheme() {
        const savedTheme = localStorage.getItem('sv_theme');
        if (!this.config.temaEscuroAtivo || savedTheme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }
        this.updateThemeIcon();
        this.syncAppearanceThemeToggle();
    },

    updateThemeIcon() {
        const themeIcon = document.getElementById('theme-icon');
        if (themeIcon) {
            const isLight = document.body.classList.contains('light-theme');
            themeIcon.setAttribute('data-lucide', isLight ? 'sun' : 'moon');
            this.initLucide();
        }
        // Re-renderizar dashboard se estiver visível para atualizar cores dos gráficos
        if (this.state.currentView === 'dashboard') {
            this.renderDashboard();
        }
    },

    syncAppearanceThemeToggle() {
        const appearanceThemeToggle = document.getElementById('appearance-theme-toggle');
        if (appearanceThemeToggle) {
            appearanceThemeToggle.checked = document.body.classList.contains('light-theme');
        }
    },

    getThemeColors() {
        const isLight = document.body.classList.contains('light-theme');
        return {
            grid: isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.05)',
            ticks: isLight ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)',
            text: isLight ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)',
            tooltipBg: isLight ? 'rgba(255, 255, 255, 0.95)' : 'rgba(17, 17, 30, 0.95)',
            tooltipText: isLight ? '#0f172a' : '#ffffff',
            border: isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)'
        };
    },

    atualizarTopbarMeta() {
        // Data e vendas do dia foram removidas do topbar
    },

    // PDV em modo foco: esconde menu lateral e barra superior ao entrar no PDV
    // PDV em modo foco: esconde menu lateral e barra superior. Além da classe (CSS),
    // define o display direto nos elementos, para o efeito não depender de cache do CSS.
    aplicarFocoPdv(viewId) {
        const container = document.querySelector('.app-container');
        if (!container) return;
        const foco = viewId === 'pos';
        container.classList.toggle('pos-focus', foco);
        const sidebar = container.querySelector('.sidebar');
        const topo = container.querySelector('.top-header');
        const botao = document.getElementById('btn-pos-foco');
        if (sidebar) sidebar.style.display = foco ? 'none' : '';
        if (topo) topo.style.display = foco ? 'none' : '';
        if (botao) botao.style.display = foco ? 'inline-flex' : 'none';
    },

    initLucide() {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({
                attrs: {
                    'stroke-width': 1.2
                }
            });
        }
    },

    // --- Navigation Logic ---
    switchView(viewId) {
        // Verificar permissões
        if (this.state.currentUser && this.state.currentUser.role === 'operador') {
            const forbiddenViews = ['dashboard', 'products', 'entradas', 'settings'];
            if (forbiddenViews.includes(viewId)) {
                this.showNotification('error', 'Acesso não permitido para seu perfil.');
                return;
            }
        }

        this.state.currentView = viewId;
        this.aplicarFocoPdv(viewId);

        // Toggle classe para dashboard no main-content
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.classList.toggle('dashboard-active', viewId === 'dashboard');
            mainContent.classList.toggle('settings-active', viewId === 'settings');
        }

        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
        });

        document.querySelectorAll('.view').forEach(view => {
            view.classList.toggle('active', view.id === `${viewId}-view`);
        });

        const titles = {
            dashboard: 'Visão Geral do Dashboard',
            pos: 'Ponto de Venda',
            products: 'Gestão de Produtos',
            estoque: 'Estoque em Tempo Real',
            customers: 'Gestão de Clientes',
            history: 'Histórico de Saídas',
            entradas: 'Histórico de Entradas',
            settings: 'Configurações do Sistema'
        };

        const tags = {
            dashboard: 'AO VIVO',
            pos: 'OPERACIONAL',
            products: 'ESTOQUE',
            customers: 'CLIENTES',
            history: 'RELATÓRIOS',
            entradas: 'ESTOQUE',
            settings: 'SISTEMA'
        };

        const titleEl = document.getElementById('view-title');
        const tagEl = document.getElementById('view-tag');
        if (titleEl) titleEl.textContent = titles[viewId] || 'Labs.';
        if (tagEl) tagEl.textContent = tags[viewId] || 'DRAFT';

        this.atualizarTopbarMeta();
        if (viewId === 'dashboard') {
            this.renderDashboard();
        }
        if (viewId === 'settings') {
            this.renderSettings();
            this.renderUsers();
            this.switchSettingsSection('empresa');
        }
        if (viewId === 'pos') {
            this.updatePOSCustomerList();
            this.updatePOSProductList();

            // Restore POS state
            const customerEl = document.getElementById('pos-customer');
            const paymentEl = document.getElementById('pos-payment');
            const discountInput = document.getElementById('pos-discount');
            const paidInput = document.getElementById('pos-paid');

            if (customerEl) customerEl.value = this.state.posState.customer;
            if (paymentEl) paymentEl.value = this.state.posState.payment;
            if (discountInput) discountInput.value = this.state.posState.discount;
            if (paidInput) paidInput.value = this.state.posState.paid;
            this.setDiscountType(this.state.posState.discountType || 'reais');

            this.updatePaidVisibility();
            this.calculateTotals();

            const barcodeInput = document.getElementById('pos-barcode');
            if (barcodeInput) barcodeInput.focus();
        }
        if (viewId === 'products') {
            this.updateCategoryFilter();
            // Preservar filtros ao trocar de tela (se já houver valores nos inputs)
            const queryAtiva = document.getElementById('filter-products')?.value || '';
            const categoriaAtiva = document.getElementById('filter-category')?.value || '';
            this.renderProducts(queryAtiva, categoriaAtiva);
        }
        if (viewId === 'customers') this.renderCustomers();
        if (viewId === 'history') this.renderHistory();
        if (viewId === 'entradas') this.renderEntradas();
        if (viewId === 'estoque') this.renderEstoque();

        this.initLucide();
    },

    renderProductExits() {
        // Esta função agora está integrada ao renderProductSalesReport
    },

    renderProductSalesReport() {
        const container = document.getElementById('product-sales-report-list');
        if (!container) return;

        // Processar vendas para o relatório
        const salesReport = this.state.sales.map(sale => {
            const items = sale.items || [];
            const totalQty = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
            return {
                id: sale.id || sale.ID,
                customer: sale.cliente || sale.Cliente || 'Consumidor Final',
                totalQty: totalQty,
                date: sale.date || sale.Data,
                items: items
            };
        });

        // Ordenar por data (mais recente primeiro)
        salesReport.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (salesReport.length === 0) {
            container.innerHTML = '<div class="empty-cart-msg">Nenhuma venda registrada</div>';
            return;
        }

        container.innerHTML = `
            <div class="list-header-labs">
                <span>ID VENDA</span>
                <span>CLIENTE</span>
                <span>QTD PRODUTOS</span>
                <span>AÇÃO</span>
            </div>
            ${salesReport.map(sale => `
                <div class="nested-item-labs-row">
                    <span class="col-id">#${sale.id.toString().slice(-6)}</span>
                    <span class="col-name">${this.esc(sale.customer)}</span>
                    <span class="col-qty-sum">${sale.totalQty} un.</span>
                    <div>
                        <button class="btn-details-link" onclick="app.showSaleDetails('${sale.id}')">Detalhes da Compra</button>
                    </div>
                </div>
            `).join('')}
        `;
    },

    showSaleDetails(saleId) {
        const sale = this.state.sales.find(s => (s.id || s.ID).toString() === saleId.toString());
        if (!sale) {
            this.showNotification('error', 'Venda não encontrada.');
            return;
        }

        const container = document.getElementById('sale-details-items');
        if (!container) return;

        const items = sale.items || [];
        container.innerHTML = items.map(item => {
            const initialLetter = item.name ? item.name.charAt(0).toUpperCase() : '?';
            const avatar = item.image
                ? `<img src="${item.image}" class="detail-img-mini">`
                : `<div class="item-avatar-letter" style="width: 40px; height: 40px; font-size: 0.8rem;">${initialLetter}</div>`;

            return `
                <div class="detail-row-mini">
                    ${avatar}
                    <div class="detail-name-mini">${this.esc(item.name)}</div>
                    <div class="detail-qty-mini">${item.qty || item.qtySold || 0} un.</div>
                </div>
            `;
        }).join('');

        const titleEl = document.getElementById('details-modal-title');
        if (titleEl) titleEl.textContent = `Venda #${saleId.toString().slice(-6)} - Itens`;

        this.openModal('sale-details-modal');
    },

    renderUsers() {
        const container = document.getElementById('users-list-labs');
        if (!container) return;

        if (this.state.users.length === 0) {
            container.innerHTML = '<div class="empty-cart-msg">Nenhum usuário cadastrado.</div>';
            return;
        }

        container.innerHTML = this.state.users.map(user => {
            const initial = user.fullname ? user.fullname.charAt(0).toUpperCase() : '?';
            return `
                <div class="sv-user-card">
                    <div class="sv-user-info">
                        <div class="sv-user-avatar ${user.role}">${initial}</div>
                        <div class="sv-user-details">
                            <span class="sv-user-name">${this.esc(user.fullname)}</span>
                            <span class="sv-user-badge ${user.role}">${user.role === 'admin' ? 'Administrador' : 'Operador'}</span>
                        </div>
                    </div>
                    <div class="sv-user-actions">
                        <button type="button" class="btn-user-edit" onclick="app.editUser('${user.id}')" title="Editar Usuário" style="width: 32px; height: 32px; border-radius: 8px; background: rgba(64, 112, 244, 0.1); color: var(--accent); border: 1px solid rgba(64, 112, 244, 0.2); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: var(--transition);">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button type="button" class="btn-user-delete" onclick="app.deleteUser('${user.id}')" title="Excluir Usuário" style="width: 32px; height: 32px; border-radius: 8px; background: rgba(214, 69, 69, 0.1); color: #d64545; border: 1px solid rgba(214, 69, 69, 0.2); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: var(--transition);">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        this.initLucide();
    },

    editUser(userId) {
        const user = this.state.users.find(u => u.id === userId);
        if (!user) return;

        this.state.editingId = userId;
        document.getElementById('user-fullname').value = user.fullname;
        document.getElementById('user-username').value = user.username;
        document.getElementById('user-password').value = ''; // Não exibir senha atual por segurança
        document.getElementById('user-confirm-password').value = '';
        document.getElementById('user-role').value = user.role;

        // Tornar campos de senha opcionais na edição
        document.getElementById('user-password').required = false;
        document.getElementById('user-confirm-password').required = false;

        this.openModal('user-modal');
    },

    async handleUserSubmit(e) {
        e.preventDefault();
        const editingId = this.state.editingId;
        const fullname = document.getElementById('user-fullname').value.trim();
        const username = document.getElementById('user-username').value.trim();
        const password = document.getElementById('user-password').value;
        const confirmPassword = document.getElementById('user-confirm-password').value;
        const role = document.getElementById('user-role').value;

        if (password !== confirmPassword) {
            this.showNotification('error', 'As senhas não coincidem.');
            return;
        }

        // Validação de senha forte (apenas para senhas novas)
        if (password && password.length > 0) {
            if (password.length < this.config.passwordMinLength) {
                this.showNotification('error', `A senha deve ter no mínimo ${this.config.passwordMinLength} caracteres.`);
                return;
            }

            // Aviso para senhas muito fracas
            if (this.config.weakPasswords.includes(password.toLowerCase())) {
                this.showNotification('error',
                    'Senha muito fraca! Por segurança, escolha uma senha mais complexa.'
                );
                return;
            }
        }

        // Se não for edição, verificar se usuário já existe
        if (!editingId && this.state.users.some(u => u.username === username)) {
            this.showNotification('error', 'Este nome de usuário já está em uso.');
            return;
        }

        // Se for edição e mudou o username, verificar se o novo já existe
        if (editingId) {
            const otherUser = this.state.users.find(u => u.username === username && u.id !== editingId);
            if (otherUser) {
                this.showNotification('error', 'Este nome de usuário já está em uso por outro colaborador.');
                return;
            }
        }

        if (this.emModoServidor()) {
            await this.salvarUsuarioServidor(e, editingId, fullname, username, role, password);
            return;
        }

        let hashedPassword = null;
        if (password) {
            this.setLoading(true);
            try {
                hashedPassword = await this.hashPassword(password, username);
            } finally {
                this.setLoading(false);
            }
        }

        if (editingId) {
            const index = this.state.users.findIndex(u => u.id === editingId);
            if (index !== -1) {
                const updatedUser = { ...this.state.users[index], fullname, username, role };
                if (hashedPassword) updatedUser.password = hashedPassword;
                this.state.users[index] = updatedUser;

                // Se o usuário editado for o atual, atualizar o estado local
                if (this.state.currentUser && this.state.currentUser.id === editingId) {
                    this.state.currentUser = updatedUser;
                    this.state.mustChangePassword = false;
                    const u = this.state.users.find(u => u.id === this.state.currentUser?.id);
                    if (u) delete u.isDefaultCredential;
                    this.updateBrand();
                }
            }
        } else {
            if (!password) {
                this.showNotification('error', 'A senha é obrigatória para novos usuários.');
                return;
            }
            const newUser = {
                id: 'U' + Date.now(),
                fullname,
                username,
                password: hashedPassword,
                role
            };
            this.state.users.push(newUser);
        }

        await this.salvarDados();
        this.renderUsers();
        this.closeModal();
        this.showNotification('success', editingId ? 'Usuário atualizado com sucesso!' : 'Usuário criado com sucesso!');
        e.target.reset();

        // Restaurar obrigatoriedade dos campos de senha
        document.getElementById('user-password').required = true;
        document.getElementById('user-confirm-password').required = true;
    },

    async deleteUser(userId) {
        if (!this.requireAdmin('excluir usuários')) return;
        const user = this.state.users.find(u => u.id === userId);
        if (!user) return;

        // Impedir excluir o último admin
        const admins = this.state.users.filter(u => u.role === 'admin');
        if (user.role === 'admin' && admins.length <= 1) {
            this.showNotification('error', 'Não é possível excluir o último administrador.');
            return;
        }

        // Impedir excluir a si mesmo
        if (this.state.currentUser && this.state.currentUser.id === userId) {
            this.showNotification('error', 'Você não pode excluir seu próprio usuário.');
            return;
        }

        this.confirmAction(
            'Excluir Usuário',
            `Deseja realmente excluir o usuário ${user.fullname}?`,
            async () => {
                if (this.emModoServidor()) {
                    try {
                        await this.servidor.excluirUsuario(userId);
                        await this.recarregarUsuariosServidor();
                        this.renderUsers();
                        this.showNotification('success', 'Usuário excluído.');
                    } catch (err) {
                        this.showNotification('error', err.message);
                    }
                    return;
                }
                this.logAudit('DELETE_USER', { targetId: userId, targetUsername: user.username });
                this.state.users = this.state.users.filter(u => u.id !== userId);
                await this.salvarDados();
                this.renderUsers();
                this.showNotification('success', 'Usuário excluído.');
            },
            'trash-2'
        );
    },

    // Apaga TODOS os dados (produtos, vendas, clientes, caixa, configurações, usuários e fotos).
    // Duas confirmações. A ação exige administrador (verificado também no servidor).
    excluirTodosDadosTeste() {
        if (!this.requireAdmin('apagar todos os dados')) return;
        this.confirmAction(
            'Apagar TODOS os dados?',
            'Produtos, clientes, vendas, entradas, caixa, configurações, usuários e fotos serão apagados. Não é possível desfazer.',
            // O modal fecha depois do callback; a segunda confirmação precisa abrir depois disso.
            () => setTimeout(() => this.confirmarExclusaoTotalTeste(), 0),
            'alert-triangle'
        );
    },

    confirmarExclusaoTotalTeste() {
        this.confirmAction(
            'Confirmar exclusão definitiva',
            'Última confirmação. Depois disso o sistema volta ao usuário padrão admin / 1234.',
            () => this.executarExclusaoTotalTeste(),
            'alert-triangle'
        );
    },

    async executarExclusaoTotalTeste() {
        this.logAudit('EXCLUIR_TUDO_TESTE', {});
        this.setLoading(true);
        // Antes de tudo: nada da memória pode ser gravado de volta enquanto a exclusão acontece.
        this.state.dataLoaded = false;
        try {
            if (this.emModoServidor()) {
                await this.servidor.excluirTudo();
            } else {
                const bridge = window.chrome?.webview?.hostObjects?.bridge;
                if (!bridge) throw new Error('Ponte do desktop indisponível.');
                // Mesmo admin padrão do reset de usuários: admin / 1234.
                const admin = {
                    id: 'U' + Date.now(),
                    fullname: 'Administrador Padrão',
                    username: 'admin',
                    password: await this.hashPassword('1234', 'admin'),
                    role: 'admin',
                    isDefaultCredential: true
                };
                const payload = {};
                ['products', 'customers', 'sales', 'settings', 'reversals', 'entradas',
                 'fechamentos', 'categories', 'movimentacoes', 'caixa'].forEach(t => { payload[t] = []; });
                payload.users = [admin];
                const ok = await bridge.SaveAll(JSON.stringify(payload));
                if (!ok) throw new Error('O banco recusou a gravação.');
            }
            this.showNotification('success', 'Todos os dados foram apagados. Entre com admin / 1234.');
            setTimeout(() => location.reload(), 1200);
        } catch (e) {
            // A tela pode estar diferente do banco (a exclusão pode ter ocorrido mesmo com erro).
            // Fica bloqueada para gravação; recarregar mostra o que realmente está gravado.
            this.showNotification('error', 'Não foi possível confirmar a exclusão: ' + (e.message || e) +
                ' Recarregue a página (F5) para ver o que está gravado no banco. Nada da tela foi gravado.');
        } finally {
            this.setLoading(false);
        }
    },

    async resetSystemUsers() {
        if (!this.requireAdmin('resetar usuários')) return;
        if (this.emModoServidor()) {
            this.showNotification('info', 'No modo servidor, os usuários são gerenciados um a um, na lista de usuários.');
            return;
        }
        this.logAudit('RESET_USERS', {});
        this.confirmAction(
            'Resetar Todos os Usuários?',
            'ATENÇÃO: Todos os usuários e senhas atuais serão excluídos. O sistema será resetado para o usuário padrão (admin / 1234) e você será deslogado. Deseja continuar?',
            async () => {
                try {
                    this.setLoading(true);

                    // Gerar hash PBKDF2 da senha padrão antes de qualquer outra operação
                    const hashedPassword = await this.hashPassword('1234', 'admin');

                    const novoAdmin = {
                        id: 'U' + Date.now(),
                        fullname: 'Administrador Padrão',
                        username: 'admin',
                        password: hashedPassword,
                        role: 'admin',
                        isDefaultCredential: true
                    };

                    this.state.users = [novoAdmin];

                    // Salvar usuários diretamente via bridge E localStorage
                    // para garantir consistência entre as duas fontes antes do reload
                    localStorage.setItem('sv_users', JSON.stringify(this.state.users));

                    if (window.chrome?.webview?.hostObjects?.bridge) {
                        const bridge = window.chrome.webview.hostObjects.bridge;
                        this.snapshotSalvo = null; // gravação direta: próxima gravação compara com o banco inteiro
                        // Aguarda o SaveData terminar completamente antes de continuar
                        const saved = await bridge.SaveData(
                            'users',
                            JSON.stringify(this.state.users)
                        );
                        if (!saved) {
                            console.warn('Bridge users falhou no reset. Dados mantidos no localStorage.');
                        }
                    }

                    this.setLoading(false);
                    this.showNotification('success', 'Usuários resetados com sucesso!');

                    // Aguarda notificação ser exibida, faz logout e recarrega
                    setTimeout(() => {
                        this.logout();
                        window.location.reload();
                    }, 1500);
                } catch (err) {
                    this.setLoading(false);
                    this.showNotification('error', 'Erro ao resetar usuários: ' + err.message);
                }
            },
            'refresh-ccw'
        );
    },

    renderSettings() {
        const setCompanyName = document.getElementById('set-company-name-page');
        const setOwnerName = document.getElementById('set-owner-name-page');
        const setCompanyWhatsapp = document.getElementById('set-company-whatsapp-page');
        const setCompanyEmail = document.getElementById('set-company-email-page');
        const setCompanyAddress = document.getElementById('set-company-address-page');
        const settingsLogoUrl = document.getElementById('settings-logo-url-page');

        if (setCompanyName) setCompanyName.value = this.state.settings.companyName || '';
        if (setOwnerName) setOwnerName.value = this.state.settings.ownerName || '';
        if (setCompanyWhatsapp) setCompanyWhatsapp.value = this.formatWhatsApp(this.state.settings.whatsapp) || '';
        if (setCompanyEmail) setCompanyEmail.value = this.state.settings.email || '';
        if (setCompanyAddress) setCompanyAddress.value = this.state.settings.address || '';
        if (settingsLogoUrl) settingsLogoUrl.value = this.state.settings.logoUrl || '';
        this.updateLogoPreview(this.state.settings.logoUrl);
    },


    async handleLogoSelection() {
        if (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects.bridge) {
            const bridge = window.chrome.webview.hostObjects.bridge;
            const photoPath = await this.escolherFoto(bridge);
            if (photoPath) {
                const settingsLogoUrl = document.getElementById('settings-logo-url-page');
                if (settingsLogoUrl) settingsLogoUrl.value = photoPath;
                this.updateLogoPreview(photoPath);
            }
        } else {
            this.showNotification('info', 'Seleção de arquivo disponível apenas no Excel.');
        }
    },

    updateLogoPreview(path) {
        const preview = document.getElementById('settings-logo-preview-page');
        const btnRemove = document.getElementById('btn-remove-logo-page');
        const btnInsert = document.getElementById('btn-insert-logo-page');

        if (!preview) return;

        if (path) {
            preview.innerHTML = `<img src="${path}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            if (btnRemove) btnRemove.classList.remove('hidden');
            if (btnInsert) btnInsert.classList.add('hidden');
        } else {
            preview.innerHTML = `<i data-lucide="image" style="width: 48px; height: 48px; color: var(--text-dim);"></i>`;
            if (btnRemove) btnRemove.classList.add('hidden');
            if (btnInsert) btnInsert.classList.remove('hidden');
            this.initLucide();
        }
    },

    removeLogo() {
        const settingsLogoUrl = document.getElementById('settings-logo-url-page');
        if (settingsLogoUrl) settingsLogoUrl.value = '';
        this.updateLogoPreview(null);
        this.closeModal(); // Fecha o modal de confirmação
    },

    async handleSettingsSubmit(e) {
        e.preventDefault();
        if (!this.requireAdmin('alterar config')) return;
        try {
            const settings = {
                companyName: document.getElementById('set-company-name-page').value.trim(),
                ownerName: document.getElementById('set-owner-name-page').value.trim(),
                whatsapp: document.getElementById('set-company-whatsapp-page').value.replace(/\D/g, ''),
                email: document.getElementById('set-company-email-page').value.trim(),
                address: document.getElementById('set-company-address-page').value.trim(),
                logoUrl: document.getElementById('settings-logo-url-page').value
            };

            if (!settings.companyName || !settings.ownerName) {
                throw new Error("Razão Social e Responsável são obrigatórios.");
            }

            this.state.settings = settings;

            await this.salvarDados();
            this.showNotification('success', 'Configurações salvas com sucesso!');
            this.updateBrand();
        } catch (err) {
            this.showNotification('error', err.message);
        }
    },

    switchSettingsSection(sectionName) {
        // Esconde todas as seções
        document.querySelectorAll('.sv-settings-section').forEach(section => {
            section.classList.remove('active');
        });

        // Remove classe active do menu
        document.querySelectorAll('.sv-settings-menu-item').forEach(item => {
            item.classList.remove('active');
        });

        if (sectionName === 'relatorios') this.iniciarRelatorios();

        // Ativa a seção e o item do menu
        const targetSection = document.getElementById(`sv-section-${sectionName}`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        const menuItems = document.querySelectorAll('.sv-settings-menu-item');
        menuItems.forEach(item => {
            const onclick = item.getAttribute('onclick');
            if (onclick && onclick.includes(`'${sectionName}'`)) {
                item.classList.add('active');
            }
        });

        // Handlers específicos por seção
        if (sectionName === 'notificacoes') {
            this.renderSettingsNotifications();
        }
        if (sectionName === 'aparencia') {
            this.syncAppearanceThemeToggle();
        }
        if (sectionName === 'categorias') {
            this.renderCategories();
        }

        this.initLucide();
    },

    saveSettingsNotifications() {
        if (!this.state.settings.notifications) {
            this.state.settings.notifications = {};
        }

        this.state.settings.notifications = {
            stockLow: document.getElementById('notif-stock-low').checked,
            stockMedium: document.getElementById('notif-stock-medium').checked,
            settingsIncomplete: document.getElementById('notif-settings').checked,
            stockLowVal: parseInt(document.getElementById('notif-stock-low-val').value) || 10,
            stockMediumVal: parseInt(document.getElementById('notif-stock-medium-val').value) || 25
        };

        this.salvarDados();
        this.updateNotifications(); // Atualiza os alertas imediatamente
        if (this.state.currentView === 'estoque') this.renderEstoque();
    },

    renderSettingsNotifications() {
        const notifs = this.state.settings.notifications || {
            stockLow: true,
            stockMedium: true,
            settingsIncomplete: true,
            stockLowVal: 10,
            stockMediumVal: 25
        };

        const low = document.getElementById('notif-stock-low');
        const med = document.getElementById('notif-stock-medium');
        const sets = document.getElementById('notif-settings');
        const lowVal = document.getElementById('notif-stock-low-val');
        const medVal = document.getElementById('notif-stock-medium-val');

        if (low) low.checked = notifs.stockLow !== false;
        if (med) med.checked = notifs.stockMedium !== false;
        if (sets) sets.checked = notifs.settingsIncomplete !== false;
        if (lowVal) lowVal.value = notifs.stockLowVal || 10;
        if (medVal) medVal.value = notifs.stockMediumVal || 25;
    },

    renderCategories() {
        const container = document.getElementById('categories-list-container');
        if (!container) return;

        if (this.state.categories.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">Nenhuma categoria cadastrada</div>';
            return;
        }

        container.innerHTML = this.state.categories.map(cat => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--glass-border);">
                <span style="font-weight: 500;">${this.esc(cat.name)}</span>
                <button class="btn-action-delete" onclick="app.deleteCategory('${cat.id}')" title="Excluir categoria">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `).join('');
        this.initLucide();
    },

    async criarCategoria(nome) {
        const name = (nome || '').trim();
        if (!name) return { erro: 'Informe o nome da categoria.' };

        const existente = this.state.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (existente) return { erro: 'Já existe uma categoria com este nome.', existente: existente };

        const cat = { id: 'CAT' + Date.now(), name: name };
        this.state.categories.push(cat);
        await this.salvarDados();
        return { cat: cat };
    },

    atualizarCategorias() {
        this.renderCategories();
        this.populateCategorySelect();
        this.updateCategoryFilter();
        this.renderPosCatalog();
    },

    openCategoriesModal() {
        this.renderCategories();
        this.openModal('categories');
    },

    async addCategory() {
        const input = document.getElementById('new-category-name');
        if (!input) return;
        const r = await this.criarCategoria(input.value);
        if (r.erro) {
            this.showNotification('error', r.erro);
            return;
        }
        input.value = '';
        this.atualizarCategorias();
        this.showNotification('success', 'Categoria adicionada com sucesso!');
    },

    toggleQuickCategory() {
        const linha = document.getElementById('prod-quick-category');
        const input = document.getElementById('prod-new-category-name');
        if (!linha) return;
        linha.classList.toggle('hidden');
        if (!linha.classList.contains('hidden') && input) input.focus();
    },

    async addCategoryFromProduct() {
        const input = document.getElementById('prod-new-category-name');
        const r = await this.criarCategoria(input ? input.value : '');
        if (r.erro && !r.existente) {
            this.showNotification('error', r.erro);
            return;
        }
        const cat = r.cat || r.existente;
        if (input) input.value = '';
        document.getElementById('prod-quick-category')?.classList.add('hidden');
        this.atualizarCategorias();
        const select = document.getElementById('prod-category');
        if (select) select.value = cat.id;
        if (r.cat) this.showNotification('success', 'Categoria criada e selecionada.');
        else this.showNotification('info', 'Essa categoria já existia e foi selecionada.');
    },

    async deleteCategory(id) {
        const cat = this.state.categories.find(c => c.id === id);
        if (!cat) return;

        const produtosComCategoria = this.state.products.filter(p => p.category === id);
        if (produtosComCategoria.length > 0) {
            this.showNotification('error', 'Categoria em uso por produtos. Remova antes.');
            return;
        }

        this.confirmAction(
            'Excluir Categoria',
            `Deseja realmente excluir a categoria "${cat.name}"?`,
            async () => {
                this.state.categories = this.state.categories.filter(c => c.id !== id);
                this.state.products.forEach(p => {
                    if (p.category === id) p.category = '';
                });
                await this.salvarDados();
                this.renderCategories();
                this.populateCategorySelect();
                this.updateCategoryFilter();
                this.showNotification('success', 'Categoria excluída com sucesso!');
            },
            'trash-2'
        );
    },

    populateCategorySelect() {
        const select = document.getElementById('prod-category');
        if (!select) return;

        select.innerHTML = '<option value="">Sem categoria</option>' +
            this.state.categories.map(c => `<option value="${c.id}">${this.esc(c.name)}</option>`).join('');
    },

    updateCategoryFilter() {
        const select = document.getElementById('filter-category');
        if (!select) return;

        select.innerHTML = '<option value="">Todas as categorias</option>' +
            this.state.categories.map(c => `<option value="${c.id}">${this.esc(c.name)}</option>`).join('');
    },

    async generateChecksum(data) {
        const content = JSON.stringify(data);
        // Em http:// (outro PC na rede) não existe crypto.subtle: usa o SHA-256 em JS (mesmo resultado).
        if (!(window.crypto && window.crypto.subtle) && window.SvSha256) {
            return window.SvSha256.sha256Hex(content);
        }
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            encoder.encode(content)
        );
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    },

    // --- Relatórios (exportação em Excel ou PDF) ---

    /** Datas (YYYY-MM-DD, dia local) de um atalho de período. Null para "personalizado". */
    intervaloRelatorio(periodo) {
        const hoje = new Date();
        const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const ano = hoje.getFullYear();
        const mes = hoje.getMonth();
        switch (periodo) {
            case 'hoje': return { inicio: iso(hoje), fim: iso(hoje) };
            case '7dias': return { inicio: iso(new Date(ano, mes, hoje.getDate() - 6)), fim: iso(hoje) };
            case 'mes': return { inicio: iso(new Date(ano, mes, 1)), fim: iso(hoje) };
            case 'mes_anterior': return { inicio: iso(new Date(ano, mes - 1, 1)), fim: iso(new Date(ano, mes, 0)) };
            case 'ano': return { inicio: iso(new Date(ano, 0, 1)), fim: iso(hoje) };
            case 'todos': return { inicio: '', fim: '' };
            default: return null;
        }
    },

    /** Ao abrir a sub-página: período e formato lembrados nesta sessão (padrão: mês atual, Excel). */
    iniciarRelatorios() {
        this.selecionarPeriodoRelatorio(this.state.relatorioPeriodo || 'mes');
        this.selecionarFormatoRelatorio(this.state.relatorioFormato || 'xlsx');
    },

    selecionarPeriodoRelatorio(periodo) {
        const validos = ['hoje', '7dias', 'mes', 'mes_anterior', 'ano', 'todos', 'personalizado'];
        this.state.relatorioPeriodo = validos.includes(periodo) ? periodo : 'mes';
        document.querySelectorAll('.rel-chip').forEach((b) => {
            b.classList.toggle('active', b.dataset.periodo === this.state.relatorioPeriodo);
        });
        const intervalo = this.intervaloRelatorio(this.state.relatorioPeriodo);
        if (intervalo) {
            const ini = document.getElementById('rel-inicio');
            const fim = document.getElementById('rel-fim');
            if (ini) ini.value = intervalo.inicio;
            if (fim) fim.value = intervalo.fim;
        }
        this.atualizarResumoRelatorio();
    },

    /** Data digitada à mão: o período passa a ser "personalizado". */
    dataRelatorioAlterada() {
        this.state.relatorioPeriodo = 'personalizado';
        document.querySelectorAll('.rel-chip').forEach((b) => {
            b.classList.toggle('active', b.dataset.periodo === 'personalizado');
        });
        this.atualizarResumoRelatorio();
    },

    selecionarFormatoRelatorio(formato) {
        this.state.relatorioFormato = formato === 'pdf' ? 'pdf' : 'xlsx';
        document.querySelectorAll('.rel-formato').forEach((b) => {
            b.classList.toggle('active', b.dataset.formato === this.state.relatorioFormato);
        });
        this.atualizarResumoRelatorio();
    },

    marcarTodosRelatorios(marcar) {
        ['vendas', 'lucro', 'estoque', 'pagamentos'].forEach((id) => {
            const el = document.getElementById('rel-' + id);
            if (el) el.checked = !!marcar;
        });
        this.atualizarResumoRelatorio();
    },

    /** Ids dos relatórios marcados, na ordem da tela. */
    relatoriosSelecionados() {
        return ['vendas', 'lucro', 'estoque', 'pagamentos'].filter((id) => {
            const el = document.getElementById('rel-' + id);
            return !!(el && el.checked);
        });
    },

    /** Texto do período, contagem e formato; desabilita o botão se nada estiver marcado. */
    atualizarResumoRelatorio() {
        const ids = this.relatoriosSelecionados();
        const ini = (document.getElementById('rel-inicio') || {}).value || '';
        const fim = (document.getElementById('rel-fim') || {}).value || '';
        const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

        const personalizado = this.state.relatorioPeriodo === 'personalizado';
        const datas = document.getElementById('rel-datas');
        if (datas) datas.hidden = !personalizado;
        const periodoEl = document.getElementById('rel-periodo-texto');
        if (periodoEl) {
            periodoEl.hidden = personalizado;
            periodoEl.textContent = (ini || fim)
                ? `Período: de ${dataBr(ini) || 'o início'} até ${dataBr(fim) || 'hoje'}.`
                : 'Período: todo o histórico de vendas.';
        }

        const formatoTxt = this.state.relatorioFormato === 'pdf' ? 'PDF' : 'Excel (.xlsx)';
        const resumo = document.getElementById('rel-resumo');
        if (resumo) {
            resumo.textContent = ids.length
                ? `${ids.length} relatório(s) em ${formatoTxt}.`
                : 'Escolha pelo menos um relatório.';
        }
        const btn = document.getElementById('rel-exportar');
        if (btn) btn.disabled = ids.length === 0;

        ['vendas', 'lucro', 'estoque', 'pagamentos'].forEach((id) => {
            const el = document.getElementById('rel-' + id);
            const cartao = document.getElementById('rel-opcao-' + id);
            if (cartao) cartao.classList.toggle('selecionada', !!(el && el.checked));
        });
    },

    niveisEstoque() {
        const cfg = (this.state.settings && this.state.settings.notifications) || {};
        return {
            nivelBaixo: Number(cfg.stockLowVal) || 10,
            nivelMedio: Number(cfg.stockMediumVal) || 25
        };
    },

    /** Seções pedidas. Cada uma vem com id, título, colunas, linhas e totais. */
    montarSecoesRelatorio(ids, inicio, fim) {
        const R = window.Relatorios;
        const vendas = R.filtrarVendas(this.state.sales, inicio, fim);
        const { nivelBaixo, nivelMedio } = this.niveisEstoque();
        const agrupar = (document.getElementById('rel-agrupar') || {}).value === 'mes' ? 'mes' : 'dia';
        const construtores = {
            vendas: () => R.secaoVendasPorPeriodo(vendas, agrupar),
            lucro: () => R.secaoLucroPorProduto(vendas),
            estoque: () => R.secaoEstoqueAtual(this.state.products, nivelBaixo, nivelMedio),
            // Recebimentos usam o total de vendas: o fiado recebido no período entra pela data do pagamento
            pagamentos: () => R.secaoRecebimentos(this.state.sales, inicio, fim)
        };
        return ids.map((id) => construtores[id]());
    },

    baixarArquivo(conteudo, tipo, nome) {
        const blob = new Blob([conteudo], { type: tipo });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = nome;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    exportarRelatorios() {
        if (this.requirePasswordChange()) return;
        if (!this.requireAdmin('exportar relatórios')) return;

        const ids = this.relatoriosSelecionados();
        if (ids.length === 0) {
            this.showNotification('error', 'Marque pelo menos um relatório.');
            return;
        }
        const ini = (document.getElementById('rel-inicio') || {}).value || '';
        const fim = (document.getElementById('rel-fim') || {}).value || '';
        if (ini && fim && ini > fim) {
            this.showNotification('error', 'A data inicial é depois da data final.');
            return;
        }

        const formato = this.state.relatorioFormato === 'pdf' ? 'pdf' : 'xlsx';
        const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
        const periodoTexto = (ini ? dataBr(ini) : 'início') + ' a ' + (fim ? dataBr(fim) : 'hoje');
        const sufixo = (ini || 'inicio') + '_a_' + (fim || 'hoje');
        const cabecalho = {
            titulo: 'Relatórios',
            empresa: (this.state.settings || {}).companyName || '',
            periodo: 'Período: ' + periodoTexto,
            geradoEm: 'Gerado em ' + new Date().toLocaleString('pt-BR') + ' por ' + (this.state.currentUser?.username || 'sistema')
        };

        try {
            const secoes = this.montarSecoesRelatorio(ids, ini, fim);
            if (formato === 'pdf') {
                const bytes = window.Relatorios.pdf(cabecalho, secoes);
                this.baixarArquivo(bytes, 'application/pdf', 'relatorios_' + sufixo + '.pdf');
            } else {
                const bytes = window.Relatorios.xlsx(secoes, cabecalho);
                this.baixarArquivo(bytes,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'relatorios_' + sufixo + '.xlsx');
            }
        } catch (err) {
            this.showNotification('error', 'Erro ao gerar o relatório: ' + err.message);
            return;
        }

        this.logAudit('RELATORIO_EXPORT', { formato, relatorios: ids, inicio: ini, fim });
        this.showNotification('success', `Relatório exportado (${formato === 'pdf' ? 'PDF' : 'Excel'}, ${periodoTexto}).`);
    },

    // --- Backup Logic ---
    async exportBackup() {
        if (this.requirePasswordChange()) return;
        if (!this.requireAdmin('exportar backups')) return;
        this.logAudit('BACKUP_EXPORT', {});
        this.setLoading(true);
        this.showNotification('info',
            'Backup sendo gerado. Por segurança, usuários e senhas NÃO serão incluídos.'
        );
        try {
            // Coletar todas as imagens únicas
            const imagePaths = new Set();
            this.state.products.forEach(p => p.image && imagePaths.add(p.image));
            this.state.customers.forEach(c => c.image && imagePaths.add(c.image));
            if (this.state.settings.logoUrl) imagePaths.add(this.state.settings.logoUrl);

            // Converter imagens para Base64 usando o Bridge (mais confiável que fetch)
            const imagesBase64 = {};
            if (window.chrome?.webview?.hostObjects?.bridge) {
                const bridge = window.chrome.webview.hostObjects.bridge;
                for (const path of imagePaths) {
                    // Se o caminho for relativo (ex: images/foto.png), o Bridge lê do disco
                    if (path.startsWith('images/')) {
                        const b64 = await bridge.GetFileBase64(path);
                        if (b64) imagesBase64[path] = b64;
                    }
                }
            }

            // Backup de Segurança: Inclui apenas dados de negócio (produtos, clientes, vendas)
            // Usuários e senhas são INTENCIONALMENTE EXCLUÍDOS por segurança
            // Mesmo com hash SHA-256, não é seguro expor credenciais em arquivos de backup
            const backupData = {
                version: 'SV_ULTRA_V4_IMG',
                date: new Date().toISOString(),
                state: {
                    products: this.state.products,
                    customers: this.state.customers,
                    sales: this.state.sales,
                    reversals: this.state.reversals,
                    entradas: this.state.entradas,
                    movimentacoes: this.state.movimentacoes,
                    settings: this.state.settings,
                    categories: this.state.categories
                },
                media: imagesBase64
            };

            // Adicionar integridade e metadados
            backupData.checksum = await this.generateChecksum(backupData.state);
            backupData.exportedBy = this.state.currentUser?.username || 'sistema';
            backupData.exportedAt = new Date().toISOString();

            const dataStr = JSON.stringify(backupData, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `backup_completo_sv_ultra_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this.showNotification('success',
                'Backup exportado com sucesso! (Produtos, clientes, vendas e imagens incluídos. Usuários excluídos por segurança)'
            );
        } catch (err) {
            this.showNotification('error', 'Erro ao exportar backup: ' + err.message);
        } finally {
            this.setLoading(false);
        }
    },

    async importBackup(event) {
        if (!this.requireAdmin('importar backups')) return;
        const input = event.target;
        const file = input.files[0];
        input.value = ''; // libera o mesmo arquivo para uma nova escolha
        if (!file) return;

        const maxBytes = this.config.backupMaxSizeMb * 1024 * 1024;
        if (file.size > maxBytes) {
            this.showNotification('error',
                `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: ${this.config.backupMaxSizeMb}MB.`
            );
            return;
        }
        if (!file.name.toLowerCase().endsWith('.json')) {
            this.showNotification('error', 'Formato inválido. Apenas arquivos .json aceitos.');
            return;
        }

        // Lê e valida antes de pedir confirmação: nada é alterado se o arquivo estiver ruim.
        this.setLoading(true);
        let backupData = null;
        let validacao;
        try {
            const texto = await this.lerArquivo(file);
            backupData = JSON.parse(texto);
            const temChecksum = backupData && backupData.checksum !== undefined && backupData.state !== undefined;
            const checksumCalc = temChecksum ? await this.generateChecksum(backupData.state) : undefined;
            validacao = Backup.validarBackup(backupData, checksumCalc);
        } catch (err) {
            validacao = { ok: false, erro: 'Não foi possível ler o arquivo: ' + err.message };
        } finally {
            this.setLoading(false);
        }

        if (!validacao.ok) {
            this.showNotification('error', validacao.erro);
            return;
        }

        const c = validacao.contagem;
        const quando = validacao.data ? new Date(validacao.data).toLocaleString('pt-BR') : 'data desconhecida';
        this.confirmAction(
            'Restaurar Backup?',
            `Backup de ${quando}: ${c.products} produtos, ${c.customers} clientes, ${c.sales} vendas e ${c.entradas} entradas. ` +
            'Todos os dados atuais serão substituídos e a tela será recarregada. Deseja continuar?',
            async () => { await this.aplicarBackup(backupData, file.name); },
            'upload-cloud'
        );
    },

    lerArquivo(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('falha de leitura'));
            reader.readAsText(file);
        });
    },

    async aplicarBackup(backupData, nomeArquivo) {
        const st = backupData.state;
        const media = backupData.media || {};

        // Modo servidor: as fotos do backup sobem para o servidor e os produtos/clientes passam a
        // guardar a URL devolvida. Feito ANTES de qualquer alteração: se uma foto falhar, nada muda.
        let fotosNoServidor = null;
        if (this.emModoServidor() && Object.keys(media).length > 0) {
            this.setLoading(true);
            try {
                fotosNoServidor = {};
                for (const [caminho, base64] of Object.entries(media)) {
                    fotosNoServidor[caminho] = await this.servidor.enviarImagem(caminho.split('/').pop(), base64);
                }
            } catch (err) {
                this.showNotification('error', 'Restauração cancelada: não foi possível enviar as fotos (' + err.message + '). Nada foi alterado.');
                return;
            } finally {
                this.setLoading(false);
            }
        }
        const comFotoDoServidor = (item) => {
            if (fotosNoServidor && item && fotosNoServidor[item.image]) item.image = fotosNoServidor[item.image];
            return item;
        };

        // Referências atuais: se a gravação falhar, o estado volta exatamente como estava.
        const anterior = {
            products: this.state.products,
            customers: this.state.customers,
            sales: this.state.sales,
            reversals: this.state.reversals,
            entradas: this.state.entradas,
            settings: this.state.settings,
            categories: this.state.categories,
            movimentacoes: this.state.movimentacoes
        };

        this.setLoading(true);
        try {
            this.state.products = st.products.map(p => comFotoDoServidor({ ...p }));
            this.state.customers = st.customers.map(c => comFotoDoServidor({ ...c }));
            this.state.sales = st.sales;
            this.state.reversals = st.reversals || [];
            this.state.entradas = st.entradas || [];
            this.state.settings = st.settings || anterior.settings;
            this.state.categories = st.categories || [];
            // Backups antigos não têm movimentações: o saldo inicial é recriado a partir do estoque
            this.state.movimentacoes = st.movimentacoes || [];
            this.iniciarHistoricoEstoque();
            this.state.dataLoaded = true;

            const gravado = await this.salvarDados();
            if (!gravado) {
                Object.assign(this.state, anterior);
                this.showNotification('error', 'Restauração cancelada: o banco não gravou os dados. Nada foi alterado.');
                return;
            }
        } catch (err) {
            Object.assign(this.state, anterior);
            this.showNotification('error', 'Erro ao restaurar backup: ' + err.message);
            return;
        } finally {
            this.setLoading(false);
        }

        // Imagens só são gravadas depois que os dados foram gravados com sucesso.
        const bridge = window.chrome?.webview?.hostObjects?.bridge;
        if (bridge) {
            for (const [path, base64] of Object.entries(media)) {
                try { await bridge.RestoreImage(path, base64); } catch (_) { /* a imagem é opcional */ }
            }
        }

        this.logAudit('BACKUP_IMPORT', { file: nomeArquivo });
        this.showNotification('success',
            'Backup restaurado com sucesso! Seus usuários atuais foram mantidos (não alterados por segurança).'
        );
        setTimeout(() => window.location.reload(), 1500);
    },

    updateBrand() {
        const brandEl = document.getElementById('brand-name');
        const loginBrandEl = document.getElementById('login-brand');
        
        // Novos elementos do Topbar
        const topbarProfileName = document.getElementById('topbar-profile-name');
        const topbarProfileRole = document.getElementById('topbar-profile-role');
        const topbarLogoContainer = document.querySelector('.profile-logo-container-topbar');

        const settings = this.state.settings;
        const currentUser = this.state.currentUser;

        // Atualizar Nome da Marca no Topo e na Tela de Login
        if (brandEl) brandEl.textContent = settings.companyName || 'Labs.';
        if (loginBrandEl) loginBrandEl.textContent = settings.companyName || 'SV Ultra';

        // Topbar: logo redonda, nome da empresa, cargo e indicadores do dia
        if (topbarProfileName) topbarProfileName.textContent = settings.companyName || 'SV Ultra';
        if (topbarProfileRole) topbarProfileRole.textContent = !currentUser || currentUser.role === 'admin' ? 'Administrador' : 'Operador';

        if (topbarLogoContainer) {
            // Avatar do usuário: foto se houver, senão a inicial do nome
            const foto = currentUser && (currentUser.photo || currentUser.image);
            if (foto) {
                topbarLogoContainer.innerHTML = `<img src="${foto}" alt="Usuário" class="avatar-topbar">`;
            } else {
                const nome = (currentUser && (currentUser.fullname || currentUser.username)) || 'U';
                const inicial = nome.charAt(0).toUpperCase();
                topbarLogoContainer.innerHTML = `<span class="avatar-topbar avatar-topbar-letter">${this.esc(inicial)}</span>`;
            }
        }
        this.atualizarTopbarMeta();

        // Atualizar permissões do menu
        this.applyPermissions();
    },

    // --- Storage Logic ---
    // --- Estoque e custo (movimentações) ---

    // Acrescenta movimentações e recalcula saldo e custo médio dos produtos afetados.
    registrarMovimentacoes(novas) {
        if (!novas || novas.length === 0) return;
        this.state.movimentacoes.push(...novas);
        const ids = new Set(novas.map(m => m.produtoId));
        ids.forEach(id => {
            const produto = this.state.products.find(p => String(p.id) === id);
            if (produto) Estoque.sincronizar(produto, this.state.movimentacoes);
        });
    },

    // Ajuste manual de quantidade. Só registra se o estoque mudar (não cai abaixo de zero).
    registrarAjusteEstoque(produto, delta, obs) {
        const efetivo = Math.max(0, produto.stock + delta) - produto.stock;
        if (efetivo === 0) return false;
        this.registrarMovimentacoes([Estoque.movimentoAjuste(produto.id, efetivo, obs)]);
        return true;
    },

    // Edição de produto: diferença de estoque vira ajuste; diferença de custo vira ajuste de custo.
    registrarAlteracaoProduto(anterior, novo) {
        const delta = novo.stock - anterior.stock;
        const novas = [];
        if (delta !== 0) novas.push(Estoque.movimentoAjuste(novo.id, delta, 'Edição de produto'));
        if (Number(novo.cost) !== Number(anterior.cost)) {
            novas.push(Estoque.movimentoAjusteCusto(novo.id, novo.cost));
        }
        if (novas.length === 0) {
            novo.stock = anterior.stock;
            novo.cost = anterior.cost;
            return;
        }
        // Mantém o produto anterior e aplica as movimentações (o recálculo define stock e cost)
        this.state.movimentacoes.push(...novas);
        Estoque.sincronizar(novo, this.state.movimentacoes);
    },

    // Produtos sem histórico (dados anteriores a esta versão) ganham saldo inicial a partir do estoque atual.
    iniciarHistoricoEstoque() {
        const novas = Estoque.garantirSaldoInicial(this.state.products, this.state.movimentacoes);
        if (novas.length > 0) this.state.movimentacoes.push(...novas);
    },

    colecoesParaSalvar() {
        return {
            products: this.state.products,
            customers: this.state.customers,
            sales: this.state.sales,
            reversals: this.state.reversals,
            entradas: this.state.entradas,
            movimentacoes: this.state.movimentacoes,
            categories: this.state.categories,
            users: this.state.users
        };
    },

    // Mapa id -> JSON do registro, na ordem da lista. Retorna null se houver id ausente ou repetido.
    snapshotDaLista(lista) {
        const ids = [];
        const mapa = new Map();
        for (const item of lista) {
            const id = String(item.id ?? '');
            if (!id || mapa.has(id)) return null;
            mapa.set(id, JSON.stringify(item));
            ids.push(id);
        }
        return { ids, mapa };
    },

    criarSnapshot(colecoes) {
        const resultado = {};
        for (const [nome, lista] of Object.entries(colecoes)) {
            const snap = this.snapshotDaLista(lista);
            if (!snap) return null; // próxima gravação regrava tudo
            resultado[nome] = snap;
        }
        return { colecoes: resultado };
    },

    // Compara a lista atual com o snapshot e devolve só o necessário (null = sem mudanças).
    montarMudancas(lista, snapshot) {
        const atual = this.snapshotDaLista(lista);
        if (!atual || !snapshot) return { full: lista };

        const upsert = lista.filter(item => {
            const id = String(item.id);
            return snapshot.mapa.get(id) !== atual.mapa.get(id);
        });
        const remover = snapshot.ids.filter(id => !atual.mapa.has(id));
        const ordemMudou = atual.ids.length !== snapshot.ids.length
            || atual.ids.some((id, idx) => id !== snapshot.ids[idx]);

        if (upsert.length === 0 && remover.length === 0 && !ordemMudou) return null;

        const mudanca = {};
        if (upsert.length) mudanca.upsert = upsert;
        if (remover.length) mudanca.delete = remover;
        if (ordemMudou) mudanca.order = atual.ids;
        return mudanca;
    },

    async salvarDados() {
        // Sem leitura bem-sucedida, a memória não é o banco: gravar tudo a partir dela regravaria por cima
        // de dados que não foram lidos. Por isso nada é gravado. Só avisa quando há dados do usuário em memória.
        if (!this.state.dataLoaded) {
            console.warn("Tentativa de salvar dados antes de carregar. Operação cancelada.");
            const temDados = [this.state.products, this.state.sales, this.state.customers].some(l => l && l.length > 0);
            if (temDados) {
                this.showNotification('error', 'Os dados não foram carregados do banco. Nenhuma alteração foi gravada. Recarregue o sistema.');
            }
            return false;
        }

        this.setLoading(true);
        try {
            const bridge = this.origemDeDados();
            if (bridge) {

                // Grava somente o que mudou desde a última gravação bem-sucedida (uma transação).
                const colecoes = this.colecoesParaSalvar();
                // Usuários têm rotas próprias no servidor: ficam fora desta gravação.
                if (this.emModoServidor()) delete colecoes.users;
                const anterior = this.snapshotSalvo;
                const payload = {};

                for (const [nome, lista] of Object.entries(colecoes)) {
                    const mudanca = anterior
                        ? this.montarMudancas(lista, anterior.colecoes[nome])
                        : { full: lista };
                    if (mudanca) payload[nome] = mudanca;
                }

                // Configurações são pequenas: sempre regravadas por inteiro.
                payload.settings = { full: [this.state.settings] };

                const saved = await bridge.SaveChanges(JSON.stringify(payload));
                if (!saved) {
                    // Mantém o snapshot antigo: a próxima gravação tenta as mesmas mudanças de novo.
                    throw new Error("Não foi possível salvar os dados. Nenhuma alteração foi gravada.");
                }

                this.snapshotSalvo = this.criarSnapshot(colecoes);
            } else {
                localStorage.setItem('sv_products', JSON.stringify(this.state.products));
                localStorage.setItem('sv_customers', JSON.stringify(this.state.customers));
                localStorage.setItem('sv_sales', JSON.stringify(this.state.sales));
                localStorage.setItem('sv_settings', JSON.stringify(this.state.settings));
                localStorage.setItem('sv_users', JSON.stringify(this.state.users));
                localStorage.setItem('sv_entradas', JSON.stringify(this.state.entradas));
                localStorage.setItem('sv_movimentacoes', JSON.stringify(this.state.movimentacoes));
                localStorage.setItem('sv_categories', JSON.stringify(this.state.categories));
            }
            this.updateNotifications();
            if (this.state.currentView === 'estoque') this.renderEstoque();
            return true;
        } catch (err) {
            console.error("Erro ao salvar dados:", err);
            this.showNotification('error', "Erro crítico ao salvar dados: " + err.message);
            return false;
        } finally {
            this.setLoading(false);
        }
    },

    async carregarDados() {
        this.snapshotSalvo = null; // estado recém-lido: próxima gravação compara com o banco inteiro
        this.setLoading(true);
        try {
            const bridge = this.origemDeDados();
            if (bridge) {

                // Carregar dados principais
                const [productsData, customersData, salesData, settingsData, reversalsData, entradasData, categoriesData, movimentacoesData] = await Promise.all([
                    bridge.GetData('products'),
                    bridge.GetData('customers'),
                    bridge.GetData('sales'),
                    bridge.GetData('settings'),
                    bridge.GetData('reversals'),
                    bridge.GetData('entradas'),
                    bridge.GetData('categories'),
                    bridge.GetData('movimentacoes')
                ]);

                // Tenta carregar usuários via bridge, com fallback para localStorage
                let usersData = null;
                try {
                    usersData = await bridge.GetData('users');
                } catch (e) {
                    console.warn("Bridge 'users' falhou no carregamento.");
                }

                if (!this.emModoServidor() && (!usersData || usersData === "[]" || usersData === "")) {
                    usersData = localStorage.getItem('sv_users');
                }

                const rawProducts = JSON.parse(productsData || '[]');
                const rawCustomers = JSON.parse(customersData || '[]');
                const rawSales = JSON.parse(salesData || '[]');
                const rawSettings = JSON.parse(settingsData || '[]');
                const rawReversals = JSON.parse(reversalsData || '[]');
                const rawUsers = JSON.parse(usersData || '[]');

                // Normalização e Garantia de IDs para Produtos
                this.state.products = rawProducts.map(p => ({
                    id: String(p.id || p.ID || 'P' + Math.random().toString(36).substr(2, 9)),
                    name: String(p.name || p.Nome || p.Produto || ''),
                    code: String(p.code || p.Código || p.Codigo || ''),
                    cost: parseFloat(p.cost || p.Custo || p.custo || 0) || 0,
                    price: parseFloat(p.price || p.Preço || p.Preco || p.preco || 0) || 0,
                    stock: parseInt(p.stock || p.Estoque || p.estoque || 0) || 0,
                    image: String(p.image || p.Imagem || ''),
                    obs: String(p.obs || p.Observação || p.Observacao || ''),
                    category: String(p.category || p.Categoria || '')
                }));

                // Normalização e Garantia de IDs para Clientes
                this.state.customers = rawCustomers.map(c => ({
                    id: String(c.id || c.ID || 'C' + Math.random().toString(36).substr(2, 9)),
                    name: String(c.name || c.Nome || ''),
                    whatsapp: String(c.whatsapp || c.WhatsApp || ''),
                    email: String(c.email || c.Email || ''),
                    obs: String(c.obs || c.Observação || c.Observacao || c["Observações / Endereço"] || ''),
                    date: String(c.date || c.Data || new Date().toISOString()),
                    image: String(c.image || c.Imagem || '')
                }));

                // Normalização de Vendas
                this.state.sales = rawSales.map(s => {
                    let items = [];
                    try {
                        if (s.items) {
                            items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
                        }
                    } catch (e) {
                        console.error("Erro ao processar itens da venda:", e);
                    }

                    return {
                        id: String(s.id || s.ID || ''),
                        date: String(s.date || s.Data || ''),
                        cliente: String(s.cliente || s.Cliente || 'Consumidor Final'),
                        valor_total: parseFloat(s.valor_total || s["Valor Total"] || s.total || 0) || 0,
                        desconto: parseFloat(s.desconto || s.Desconto || 0) || 0,
                        valor_final: parseFloat(s.valor_final || s["Valor Final"] || 0) || 0,
                        cost: parseFloat(s.cost || s.custo || s.Custo || s.custoTotal || 0) || 0,
                        lucro: parseFloat(s.lucro || s.Lucro || 0) || 0,
                        pagamento: String(s.pagamento || s["Forma de Pagamento"] || 'N/A'),
                        // Venda paga em mais de uma forma: mantém a divisão (vem de _extra no banco)
                        pagamentos: Array.isArray(s.pagamentos) ? s.pagamentos : undefined,
                        troco: s.troco !== undefined ? (Number(s.troco) || 0) : undefined,
                        items: items,
                        // Fiado: recebimentos e id do cliente (vêm de _extra no banco)
                        ...Fiado.camposFiado(s)
                    };
                });

                // Normalização de Estornos
                this.state.reversals = rawReversals.map(r => ({
                    id: String(r.id || ''),
                    sale_id: String(r.sale_id || ''),
                    product_id: String(r.product_id || ''),
                    product_name: String(r.product_name || ''),
                    qty: parseInt(r.qty || 0),
                    date: String(r.date || '')
                }));

                // Normalização de Entradas
                this.state.entradas = JSON.parse(entradasData || '[]').map(e => ({
                    id: String(e.id || ''),
                    date: String(e.date || ''),
                    fornecedor: String(e.fornecedor || ''),
                    nota: String(e.nota || ''),
                    obs: String(e.obs || ''),
                    items: typeof e.items === 'string' ? JSON.parse(e.items || '[]') : (e.items || []),
                    totalCusto: parseFloat(e.totalCusto || 0) || 0
                }));

                this.state.movimentacoes = JSON.parse(movimentacoesData || '[]').map(m => ({
                    id: String(m.id || ''),
                    date: String(m.date || ''),
                    produtoId: String(m.produtoId || ''),
                    tipo: String(m.tipo || ''),
                    qtd: Number(m.qtd) || 0,
                    custoUnit: m.custoUnit == null ? null : (Number(m.custoUnit) || 0),
                    refId: m.refId ? String(m.refId) : null,
                    obs: String(m.obs || ''),
                    ignorada: m.ignorada === true || m.ignorada === 'true'
                }));

                this.state.categories = JSON.parse(categoriesData || '[]').map(c => ({
                    id: String(c.id || ''),
                    name: String(c.name || '')
                }));

                // Normalização de Configurações
                if (rawSettings && rawSettings.length > 0) {
                    const s = rawSettings[0];
                    this.state.settings = {
                        companyName: String(s.companyName || s.razao_social || s["Razão Social"] || 'Labs. - SV Ultra'),
                        ownerName: String(s.ownerName || s.responsavel || s.Responsavel || ''),
                        whatsapp: String(s.whatsapp || s.WhatsApp || ''),
                        email: String(s.email || s.Email || ''),
                        address: String(s.address || s.endereco || s.Endereco || ''),
                        logoUrl: String(s.logoUrl || s.foto || s.Foto || '')
                    };
                }

                // Normalização de Usuários
                this.state.users = rawUsers.map(u => ({
                    id: String(u.id || ''),
                    fullname: String(u.fullname || ''),
                    username: String(u.username || ''),
                    password: String(u.password || ''),
                    role: String(u.role || 'operador')
                }));

                // Criar usuário admin padrão se não houver usuários (somente sem servidor)
                if (this.state.users.length === 0 && !this.emModoServidor()) {
                    const hashedPassword = await this.hashPassword('1234', 'admin');
                    this.state.users.push({
                        id: 'U' + Date.now(),
                        fullname: 'Administrador Padrão',
                        username: 'admin',
                        password: hashedPassword,
                        role: 'admin',
                        isDefaultCredential: true
                    });
                    await this.salvarDados();
                    console.log('Usuário admin padrão criado: admin / 1234');
                }

                this.updateBrand();
                this.state.dataLoaded = true;
            } else {
                this.state.products = JSON.parse(localStorage.getItem('sv_products')) || [];
                this.state.customers = JSON.parse(localStorage.getItem('sv_customers')) || [];
                this.state.sales = JSON.parse(localStorage.getItem('sv_sales')) || [];
                this.state.settings = JSON.parse(localStorage.getItem('sv_settings')) || this.state.settings;
                this.state.users = JSON.parse(localStorage.getItem('sv_users')) || [];

                this.state.entradas = JSON.parse(localStorage.getItem('sv_entradas') || '[]');
                this.state.categories = JSON.parse(localStorage.getItem('sv_categories') || '[]');
                this.state.movimentacoes = JSON.parse(localStorage.getItem('sv_movimentacoes') || '[]');

                // Criar usuário admin padrão se não houver usuários (fallback, somente sem servidor)
                if (this.state.users.length === 0 && !this.emModoServidor()) {
                    const hashedPassword = await this.hashPassword('1234', 'admin');
                    this.state.users.push({
                        id: 'U' + Date.now(),
                        fullname: 'Administrador Padrão',
                        username: 'admin',
                        password: hashedPassword,
                        role: 'admin',
                        isDefaultCredential: true
                    });
                    localStorage.setItem('sv_users', JSON.stringify(this.state.users));
                }

                this.updateBrand();
                this.state.dataLoaded = true;
            }
        } catch (err) {
            console.error("Erro ao carregar dados:", err);
            this.showNotification('error', "Erro fatal ao carregar dados. Verifique a planilha.");
        } finally {
            this.setLoading(false);
        }

        // Linha de base: o que acabou de ser lido é o que está no banco. Assim a próxima gravação
        // manda só o que mudou nesta sessão, e não regrava a tabela inteira por cima de outro terminal.
        if (this.state.dataLoaded) {
            const colecoesBase = this.colecoesParaSalvar();
            if (this.emModoServidor()) delete colecoesBase.users;
            this.snapshotSalvo = this.criarSnapshot(colecoesBase);
        }

        // Vendas fiado antigas (sem id do cliente): liga pelo nome quando ele é único; grava só essas.
        if (this.state.dataLoaded) {
            const vinculo = Fiado.vincularLegado(this.state.sales, this.state.customers);
            if (vinculo.vinculadas > 0) await this.salvarDados();
        }

        this.iniciarHistoricoEstoque();

    },

    // --- Dashboard Helpers ---
    chaveDiaLocal(d) {
        if (!d || isNaN(d.getTime())) return '';
        if (window.Dashboard && typeof Dashboard.chaveDia === 'function') return Dashboard.chaveDia(d);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },

    getFilteredSales() {
        const sales = this.state.sales || [];
        if (sales.length === 0) return [];

        const now = new Date();
        const intervalos = window.Dashboard && typeof Dashboard.intervalosPeriodo === 'function'
            ? Dashboard.intervalosPeriodo(this.state.dashboardFilter, now)
            : null;

        if (!intervalos) return sales;

        return sales.filter(s => {
            const dateStr = s.date || s.Data;
            const d = this.parseDate(dateStr);
            if (!d) return false;
            return d >= intervalos.atualInicio && d <= intervalos.atualFim;
        });
    },

    // --- Dashboard Logic ---
    initCharts() {
        if (typeof Chart === 'undefined') return;

        const canvasLine = document.getElementById('lineChart');
        if (!canvasLine) return;

        // Série do gráfico pelo módulo Dashboard: dia local, uma passagem pelas vendas.
        const serie = Dashboard.serieLinha(this.state.sales || [], this.state.dashboardFilter, new Date(), (d) => this.parseDate(d));
        const theme = this.getThemeColors();

        const ativos = ['faturamento', 'lucro', 'custo'].filter((k) => this.state.activeChartDatasets.includes(k));
        const definicoes = {
            faturamento: { label: 'Faturamento', data: serie.revenue, cor: '#4070f4', fundo: 'rgba(64, 112, 244, 0.1)' },
            lucro: { label: 'Lucro', data: serie.profit, cor: '#2e9e6a', fundo: 'rgba(46, 158, 106, 0.12)' },
            custo: { label: 'Custo', data: serie.cost, cor: '#d64545', fundo: 'rgba(214, 69, 69, 0.1)' }
        };

        // Mesmas linhas, mesmo período e mesmo tema: só troca os valores, sem recriar o gráfico.
        const chave = ativos.join(',') + '|' + this.state.dashboardFilter + '|' + theme.text + '|' + theme.grid;
        const atual = this.state.charts.line;
        if (atual && this.state.charts.lineChave === chave) {
            atual.data.labels = serie.labels;
            ativos.forEach((k, i) => { atual.data.datasets[i].data = definicoes[k].data; });
            atual.update('none');
            return;
        }
        if (atual) {
            atual.destroy();
            this.state.charts.line = null;
        }

        const ctxLine = canvasLine.getContext('2d');
        Chart.defaults.color = theme.text;
        Chart.defaults.font.family = "'SV Poppins', 'Segoe UI', system-ui, sans-serif";
        Chart.defaults.font.size = 13;
        Chart.defaults.devicePixelRatio = window.devicePixelRatio || 2;
        Chart.defaults.responsive = true;
        Chart.defaults.maintainAspectRatio = false;
        Chart.defaults.plugins.tooltip.usePointStyle = true;
        Chart.defaults.plugins.tooltip.padding = 10;
        Chart.defaults.plugins.tooltip.cornerRadius = 8;
        Chart.defaults.plugins.tooltip.boxPadding = 5;
        Chart.defaults.plugins.tooltip.titleFont = { weight: 'bold', size: 14 };
        Chart.defaults.plugins.tooltip.bodyFont = { size: 13 };
        Chart.defaults.plugins.tooltip.backgroundColor = theme.tooltipBg;
        Chart.defaults.plugins.tooltip.titleColor = theme.tooltipText;
        Chart.defaults.plugins.tooltip.bodyColor = theme.tooltipText;

        const datasets = ativos.map((k) => ({
            label: definicoes[k].label,
            data: definicoes[k].data,
            borderColor: definicoes[k].cor,
            backgroundColor: definicoes[k].fundo,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        }));

        this.state.charts.line = new Chart(ctxLine, {
            type: 'line',
            data: {
                labels: serie.labels,
                datasets: datasets
            },
            options: {
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index',
                    axis: 'x'
                },
                layout: {
                    padding: { left: 10, right: 20, top: 20, bottom: 10 }
                },
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid },
                        ticks: { font: { size: 13 }, color: theme.text }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 13 }, color: theme.text }
                    }
                }
            }
        });
        this.state.charts.lineChave = chave;
    },

    toggleChartDataset(dataset) {
        const index = this.state.activeChartDatasets.indexOf(dataset);
        if (index === -1) {
            this.state.activeChartDatasets.push(dataset);
        } else {
            // Garantir que pelo menos um esteja ativo
            if (this.state.activeChartDatasets.length > 1) {
                this.state.activeChartDatasets.splice(index, 1);
            } else {
                this.showNotification('info', 'Pelo menos um dado deve estar visível.');
                return;
            }
        }

        // Atualizar UI dos botões
        document.querySelectorAll('.dataset-btn').forEach(btn => {
            const ds = btn.getAttribute('data-dataset');
            btn.classList.toggle('active', this.state.activeChartDatasets.includes(ds));
        });

        this.initCharts();
    },

    renderDashboard() {
        this.updateDashboardStats();
        
        this.renderTopProductsChart();
        this.renderTopProfitableProductsChart();
        this.renderCriticalStockTable();
        this.renderPaymentMethodsChart();
        this.renderSalesByHourChart();
        this.renderProfitMarginPercentChart();
        this.renderRecentSalesDashboard();
        this.renderDashboardKpis();
        this.renderDashboardDestaques();
    },

    /** KPIs estratégicos: estoque (últimos 30 dias, fixo) e vendas (período do filtro). */
    renderDashboardKpis() {
        const R = window.Dashboard;
        if (!R || !document.getElementById('dash-est-ruptura')) return;

        const parse = (d) => this.parseDate(d);
        const est = R.kpisEstoque(this.state.products, this.state.sales, new Date(), { parseDate: parse });
        const ven = R.kpisVendas(this.getFilteredSales(), this.state.products, parse);
        const txt = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = valor; };
        const pct = (v) => v == null ? '—' : v.toFixed(1).replace('.', ',') + '%';
        const pad = (n) => String(n).padStart(2, '0');

        txt('dash-est-ruptura', pct(est.taxaRuptura));
        txt('dash-est-ruptura-sub', `${est.zerados} de ${est.totalProdutos} produtos sem saldo`);
        txt('dash-est-cobertura', est.coberturaMediaDias == null ? '—' : `${Math.round(est.coberturaMediaDias)} dias`);
        txt('dash-est-parado', this.formatCurrency(est.valorParado));
        txt('dash-est-parado-sub', `${est.paradosQuantidade} produto(s) com saldo e sem venda`);
        txt('dash-est-giro', est.giro == null ? '—' : est.giro.toFixed(2).replace('.', ',') + 'x');

        const reposicao = document.getElementById('dash-est-reposicao');
        if (reposicao) {
            const linhas = est.reposicao.slice(0, 5).map((i) => {
                const dura = i.cobertura < 1 ? 'menos de 1 dia' : `${Math.round(i.cobertura)} dias`;
                const classe = i.cobertura < R.COBERTURA_CRITICA_DIAS ? 'dash-alerta-zero' : 'dash-alerta-baixo';
                return `<tr>
                    <td>${this.esc(i.produto)}</td>
                    <td>${i.saldo} un.</td>
                    <td class="${classe}">${dura}</td>
                    <td>${i.sugestao > 0 ? i.sugestao + ' un.' : '—'}</td>
                </tr>`;
            });
            reposicao.innerHTML = linhas.length
                ? linhas.join('')
                : '<tr><td colspan="4" class="dash-vazio">Nenhum produto precisa de reposição agora.</td></tr>';
        }

        txt('dash-ven-margem', pct(ven.margemBruta));
        txt('dash-ven-margem-sub', ven.vendas ? `lucro de ${this.formatCurrency(ven.lucro)} em ${ven.vendas} venda(s)` : 'sem vendas no período');
        txt('dash-ven-dia', ven.diaPico || '—');
        txt('dash-ven-hora', ven.horaPico == null ? '—' : `${pad(ven.horaPico)}h às ${pad((ven.horaPico + 1) % 24)}h`);
        this.renderDashboardInsights(R, est, ven);
        txt('dash-ven-recorrencia', pct(ven.taxaRecorrencia));
        txt('dash-ven-recorrencia-sub', ven.clientesDistintos
            ? `${ven.clientesRecorrentes} de ${ven.clientesDistintos} clientes com 2 ou mais compras`
            : 'nenhum cliente identificado no período');

        const lucro = document.getElementById('dash-ven-lucro');
        if (lucro) {
            lucro.innerHTML = ven.produtosLucro.length
                ? ven.produtosLucro.map((p) => `<tr>
                    <td>${this.esc(p.nome)}</td>
                    <td>${p.qtd}</td>
                    <td>${this.formatCurrency(p.lucro)}</td>
                    <td>${pct(p.margem)}</td>
                </tr>`).join('')
                : '<tr><td colspan="4" class="dash-vazio">Sem vendas no período.</td></tr>';
        }
    },

    /** Textos de insight das duas visões (Vendas e Estoque), gerados pela lógica pura de dashboard.js. */
    renderDashboardInsights(R, est, ven) {
        const filtro = this.state.dashboardFilter;
        const agora = new Date();
        const parse = (d) => this.parseDate(d);
        const serie = R.serieLinha(this.state.sales || [], filtro, agora, parse);
        const indiceAtual = filtro === '7d' ? 6 : filtro === 'month' ? agora.getDate() - 1 : agora.getMonth();
        const anterior = this.calculateTotalsFromSales(this.getPreviousPeriodSales(filtro));

        const preencher = (id, textos) => {
            const ul = document.getElementById(id);
            if (!ul) return;
            ul.innerHTML = '';
            textos.forEach((t) => {
                const li = document.createElement('li');
                li.textContent = t;
                ul.appendChild(li);
            });
        };
        preencher('dash-insight-vendas', R.insightsVendas(serie, indiceAtual,
            { faturamento: ven.faturamento, vendas: ven.vendas }, { faturamento: anterior.faturamento }, ven));
        preencher('dash-insight-estoque', R.insightsEstoque(est));
    },

    /** Troca a visão do dashboard: Vendas ou Estoque. Só o bloco escolhido fica visível. */
    setDashboardVisao(visao) {
        this.state.dashboardVisao = visao === 'estoque' ? 'estoque' : 'vendas';
        const view = document.getElementById('dashboard-view');
        if (view) view.dataset.visao = this.state.dashboardVisao;
        document.querySelectorAll('.dash-visao-btn').forEach((btn) => {
            const ativo = btn.dataset.visao === this.state.dashboardVisao;
            btn.classList.toggle('active', ativo);
            btn.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        });
    },

    /** Troca o período (7 dias, mês ou ano) e redesenha o dashboard. */
    setDashboardFilter(filtro) {
        this.state.dashboardFilter = ['7d', 'month', 'year'].includes(filtro) ? filtro : '7d';
        const sel = document.getElementById('dash-periodo');
        if (sel) sel.value = this.state.dashboardFilter;
        this.renderDashboard();
    },

    /** Destaques: alertas de estoque (sem saldo e baixo) e produtos mais vendidos no período. */
    renderDashboardDestaques() {
        const R = window.Dashboard;
        const elAlertas = document.getElementById('dash-alertas');
        const elTop = document.getElementById('dash-top-produtos');
        if (!R || (!elAlertas && !elTop)) return;

        if (elAlertas) {
            const nCfg = this.state.settings.notifications || {};
            const a = R.alertasEstoque(this.state.products, Number(nCfg.stockLowVal) || 10);
            const itens = [
                ...a.semEstoque.map((x) => `<li class="dash-alerta-zero">${this.esc(x.produto)}: sem estoque</li>`),
                ...a.estoqueBaixo.map((x) => `<li class="dash-alerta-baixo">${this.esc(x.produto)}: ${x.saldo} un.</li>`)
            ];
            elAlertas.innerHTML = itens.length ? `<ul>${itens.join('')}</ul>` : '<p class="dash-vazio">Nenhum produto em alerta.</p>';
        }

        if (elTop) {
            const top = R.rankingProdutos(this.getFilteredSales(), this.state.products)
                .sort((a, b) => b.qtd - a.qtd)
                .slice(0, 5);
            elTop.innerHTML = top.length
                ? `<ol>${top.map((x) => `<li>${this.esc(x.nome)} <span class="dash-meta">${x.qtd} un. · ${this.formatCurrency(x.lucro)} de lucro</span></li>`).join('')}</ol>`
                : '<p class="dash-vazio">Sem vendas no período.</p>';
        }
    },

    renderTopProductsChart() {
        const ctx = document.getElementById('topProductsChart');
        if (!ctx) return;

        const filteredSales = this.getFilteredSales();
        const productStats = {};

        // Agrupar vendas por produto
        filteredSales.forEach(sale => {
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const id = item.productId || item.id;
                    if (!productStats[id]) {
                        // Buscar info completa do produto no estado
                        const productInfo = this.state.products.find(p => p.id === id);
                        productStats[id] = {
                            id: id,
                            name: item.name || productInfo?.name || 'Produto Desconhecido',
                            qtySold: 0
                        };
                    }
                    const qty = Number(item.qtySold) || Number(item.qty) || 0;
                    productStats[id].qtySold += qty;
                });
            }
        });

        // Ordenar por quantidade desc e pegar top 5
        const top5 = Object.values(productStats)
            .sort((a, b) => b.qtySold - a.qtySold)
            .slice(0, 5);

        const labels = top5.map(p => {
            return p.name.length > 18 ? p.name.substring(0, 18) + '...' : p.name;
        });
        const data = top5.map(p => p.qtySold);

        if (this.state.charts.topProducts) {
            this.state.charts.topProducts.destroy();
        }

        if (top5.length === 0) {
            // Se não houver dados, podemos mostrar uma mensagem ou gráfico vazio
            return;
        }

        const theme = this.getThemeColors();
        this.state.charts.topProducts = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Qtd. Vendida',
                    data: data,
                    backgroundColor: 'rgba(64, 112, 244, 0.6)',
                    borderColor: '#4070f4',
                    borderWidth: 1,
                    borderRadius: 6,
                    barThickness: 18
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { left: 0, right: 10, top: 0, bottom: 0 }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: theme.tooltipBg,
                        titleColor: theme.tooltipText,
                        bodyColor: theme.tooltipText,
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: false,
                        callbacks: {
                            label: (context) => `Quantidade: ${context.raw}`
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: theme.grid, drawBorder: false },
                        ticks: { color: theme.ticks, font: { size: 10 } }
                    },
                    y: {
                        grid: { display: false, drawBorder: false },
                        ticks: { 
                            color: theme.text, 
                            font: { size: 11, weight: '500' }
                        }
                    }
                }
            }
        });
    },

    renderPaymentMethodsChart() {
        const ctx = document.getElementById('paymentMethodsChart');
        if (!ctx) return;

        const filteredSales = this.getFilteredSales();
        const metodos = window.Dashboard && typeof Dashboard.resumoPagamentos === 'function'
            ? Dashboard.resumoPagamentos(filteredSales)
            : [];

        const labels = metodos.map((m) => `${m.rotulo} (${m.percentual.toFixed(0)}%)`);
        const revenues = metodos.map((m) => m.faturamento);
        const counts = metodos.map((m) => m.vendas);
        const percentuais = metodos.map((m) => m.percentual.toFixed(1).replace('.', ','));

        if (this.state.charts.paymentMethods) {
            this.state.charts.paymentMethods.destroy();
        }

        if (metodos.length === 0) return;

        const theme = this.getThemeColors();
        this.state.charts.paymentMethods = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    data: revenues,
                    backgroundColor: 'rgba(64, 112, 244, 0.65)',
                    hoverBackgroundColor: 'rgba(64, 112, 244, 0.9)',
                    borderRadius: 6,
                    barThickness: 18
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: theme.tooltipBg,
                        titleColor: theme.tooltipText,
                        bodyColor: theme.tooltipText,
                        padding: 10,
                        cornerRadius: 8,
                        callbacks: {
                            label: (context) => {
                                const i = context.dataIndex;
                                return [
                                    ` Faturamento: ${this.formatCurrency(revenues[i])} (${percentuais[i]}%)`,
                                    ` Nº de vendas: ${counts[i]}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: theme.grid },
                        ticks: { color: theme.text, font: { size: 11 }, callback: (v) => this.formatCurrency(v) }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: theme.text, font: { size: 12 } }
                    }
                }
            }
        });
    },

    renderSalesByHourChart() {
        const ctx = document.getElementById('salesByHourChart');
        if (!ctx) return;

        const filteredSales = this.getFilteredSales();
        const hourlyStats = Array(24).fill(0);

        filteredSales.forEach(sale => {
            const date = this.parseDate(sale.date || sale.Data);
            if (date) {
                const hour = date.getHours();
                if (hour >= 0 && hour < 24) {
                    hourlyStats[hour]++;
                }
            }
        });

        const labels = Array.from({ length: 24 }, (_, i) => `${i}h`);
        
        if (this.state.charts.salesByHour) {
            this.state.charts.salesByHour.destroy();
        }

        const theme = this.getThemeColors();
        this.state.charts.salesByHour = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Vendas',
                    data: hourlyStats,
                    backgroundColor: 'rgba(64, 112, 244, 0.4)',
                    borderColor: '#4070f4',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: theme.tooltipBg,
                        titleColor: theme.tooltipText,
                        bodyColor: theme.tooltipText,
                        callbacks: {
                            label: (context) => ` ${context.raw} vendas às ${context.label}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { 
                            color: theme.ticks,
                            font: { size: 10 },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid, drawBorder: false },
                        ticks: { 
                            color: theme.ticks,
                            font: { size: 10 },
                            precision: 0
                        }
                    }
                }
            }
        });
    },

    renderProfitMarginPercentChart() {
        const ctx = document.getElementById('profitMarginPercentChart');
        if (!ctx) return;

        const filteredSales = this.getFilteredSales();
        const labels = [];
        const marginData = [];

        // Agrupamento por hora (0-23)
        const hourlyTotal = Array(24).fill(0);
        const hourlyProfit = Array(24).fill(0);

        filteredSales.forEach(s => {
            const dateStr = s.date || s.Data;
            const d = this.parseDate(dateStr);
            if (d) {
                const hour = d.getHours();
                const subtotal = s.valor_total ?? s["Valor Total"] ?? s.total ?? 0;
                const desconto = s.desconto ?? s.Desconto ?? 0;
                const totalFinal = subtotal - desconto;
                const custo = s.cost ?? s.custo ?? s.Custo ?? s.custoTotal ?? 0;
                const lucro = s.lucro ?? s.Lucro ?? (totalFinal - custo);

                hourlyTotal[hour] += Number(totalFinal) || 0;
                hourlyProfit[hour] += Number(lucro) || 0;
            }
        });

        // Gerar labels e dados apenas para as horas que tiveram vendas
        hourlyTotal.forEach((total, hour) => {
            if (total > 0) {
                labels.push(`${hour}h`);
                const margin = ((hourlyProfit[hour] / total) * 100).toFixed(1);
                marginData.push(margin);
            }
        });

        if (this.state.charts.profitMarginPercent) {
            this.state.charts.profitMarginPercent.destroy();
        }

        if (marginData.length === 0) return;

        const theme = this.getThemeColors();
        this.state.charts.profitMarginPercent = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Margem %',
                    data: marginData,
                    borderColor: '#4070f4',
                    backgroundColor: 'rgba(64, 112, 244, 0.1)',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: '#2e9e6a',
                    tension: 0.4,
                    fill: true,
                    spanGaps: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: theme.tooltipBg,
                        titleColor: theme.tooltipText,
                        bodyColor: theme.tooltipText,
                        callbacks: {
                            label: (context) => ` Margem: ${context.raw}%`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: theme.ticks, font: { size: 10 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: theme.grid, drawBorder: false },
                        ticks: { 
                            color: theme.ticks, 
                            font: { size: 10 }, 
                            callback: (value) => value + '%' 
                        }
                    }
                }
            }
        });
    },

    renderCriticalStockTable() {
        const body = document.getElementById('critical-stock-body');
        if (!body) return;

        const nCfg = this.state.settings.notifications || {};
        const lowLevel = Number(nCfg.stockLowVal) || 10;
        const mediumLevel = Number(nCfg.stockMediumVal) || 25;

        // Filtrar produtos com estoque baixo ou médio
        const criticalProducts = this.state.products
            .filter(p => p.stock < mediumLevel)
            .sort((a, b) => a.stock - b.stock);

        // Paginação
        const itemsPerPage = 5;
        const totalPages = Math.ceil(criticalProducts.length / itemsPerPage) || 1;
        
        if (this.state.criticalStockPage > totalPages) this.state.criticalStockPage = totalPages;
        if (this.state.criticalStockPage < 1) this.state.criticalStockPage = 1;

        const startIndex = (this.state.criticalStockPage - 1) * itemsPerPage;
        const pageItems = criticalProducts.slice(startIndex, startIndex + itemsPerPage);

        // Atualizar info de página
        const pageInfo = document.getElementById('critical-stock-page-info');
        if (pageInfo) pageInfo.textContent = `${this.state.criticalStockPage} / ${totalPages}`;

        const prevBtn = document.getElementById('prev-critical-stock');
        const nextBtn = document.getElementById('next-critical-stock');
        if (prevBtn) prevBtn.disabled = this.state.criticalStockPage === 1;
        if (nextBtn) nextBtn.disabled = this.state.criticalStockPage === totalPages;

        if (pageItems.length === 0) {
            body.innerHTML = '<tr><td colspan="4" class="text-center" style="padding: 2rem; color: var(--text-dim);">Todos os produtos com estoque em dia.</td></tr>';
            return;
        }

        body.innerHTML = pageItems.map(p => {
            const status = p.stock < lowLevel ? 'Baixo' : 'Médio';
            const statusClass = p.stock < lowLevel ? 'status-low' : 'status-medium';
            
            return `
                <tr>
                    <td>
                        <div class="product-cell">
                            ${p.image 
                                ? `<img src="${p.image}" class="product-img-mini">` 
                                : `<div class="product-img-mini-fallback">${p.name.charAt(0).toUpperCase()}</div>`
                            }
                            <div class="product-info-mini">
                                <span class="product-name-mini">${this.esc(p.name)}</span>
                                <span class="product-meta-mini">${this.formatCurrency(p.price)}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="category-badge">${this.esc(p.category || 'Geral')}</span>
                    </td>
                    <td>
                        <span style="font-weight: 600;">${p.stock}</span>
                    </td>
                    <td>
                        <span class="stock-status-badge ${statusClass}">${status}</span>
                    </td>
                </tr>
            `;
        }).join('');
    },

    changeCriticalStockPage(delta) {
        this.state.criticalStockPage += delta;
        this.renderCriticalStockTable();
    },

    renderRecentSalesDashboard() {
        const body = document.getElementById('recent-sales-body');
        if (!body) return;

        // Pegar as últimas 25 vendas ordenadas por data desc
        const last25Sales = [...this.state.sales]
            .sort((a, b) => {
                const dateA = this.parseDate(a.date || a.Data);
                const dateB = this.parseDate(b.date || b.Data);
                return dateB - dateA;
            })
            .slice(0, 25);

        // Paginação (5 itens por página para manter o padrão visual)
        const itemsPerPage = 5;
        const totalPages = Math.ceil(last25Sales.length / itemsPerPage) || 1;

        if (this.state.recentSalesDashboardPage > totalPages) this.state.recentSalesDashboardPage = totalPages;
        if (this.state.recentSalesDashboardPage < 1) this.state.recentSalesDashboardPage = 1;

        const startIndex = (this.state.recentSalesDashboardPage - 1) * itemsPerPage;
        const pageItems = last25Sales.slice(startIndex, startIndex + itemsPerPage);

        // Atualizar info de página
        const pageInfo = document.getElementById('recent-sales-page-info');
        if (pageInfo) pageInfo.textContent = `${this.state.recentSalesDashboardPage} / ${totalPages}`;

        const prevBtn = document.getElementById('prev-recent-sales');
        const nextBtn = document.getElementById('next-recent-sales');
        if (prevBtn) prevBtn.disabled = this.state.recentSalesDashboardPage === 1;
        if (nextBtn) nextBtn.disabled = this.state.recentSalesDashboardPage === totalPages;

        if (pageItems.length === 0) {
            body.innerHTML = '<tr><td colspan="8" class="text-center" style="padding: 2rem; color: var(--text-dim);">Nenhuma venda registrada.</td></tr>';
            return;
        }

        body.innerHTML = pageItems.map(s => {
            const subtotal = s.valor_total ?? s["Valor Total"] ?? s.total ?? 0;
            const desconto = s.desconto ?? s.Desconto ?? 0;
            const totalFinal = subtotal - desconto;
            const custo = s.cost ?? s.custo ?? s.Custo ?? s.custoTotal ?? 0;
            const lucro = s.lucro ?? s.Lucro ?? (totalFinal - custo);
            const data = this.parseDate(s.date || s.Data);
            const qtdItens = s.items ? s.items.reduce((acc, item) => acc + (Number(item.qty) || Number(item.qtySold) || 0), 0) : 0;

            return `
                <tr>
                    <td>${data ? data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '---'}</td>
                    <td><span style="font-weight: 500; color: var(--text-white);">${this.esc(s.cliente || s.Cliente || 'Consumidor')}</span></td>
                    <td>
                        <span class="badge-qty">${qtdItens}</span>
                    </td>
                    <td style="color: #d64545;">${this.formatCurrency(desconto)}</td>
                    <td style="font-weight: 700; color: var(--accent);">${this.formatCurrency(totalFinal)}</td>
                    <td style="color: var(--text-dim);">${this.formatCurrency(custo)}</td>
                    <td style="font-weight: 600; color: ${lucro >= 0 ? '#2e9e6a' : '#d64545'};">${this.formatCurrency(lucro)}</td>
                    <td>
                        <button class="btn-action-view" onclick="app.showSaleDetails('${s.id}')" title="Ver Itens">
                            <i data-lucide="eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        this.initLucide();
    },

    changeRecentSalesPage(delta) {
        this.state.recentSalesDashboardPage += delta;
        this.renderRecentSalesDashboard();
    },

    renderLatestEntradas() {
        const container = document.getElementById('latest-entradas-list');
        if (!container) return;

        // Ordenar todas as entradas por data desc
        const sorted = [...this.state.entradas]
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        // Paginação
        const itemsPerPage = 5;
        const totalPages = Math.ceil(sorted.length / itemsPerPage) || 1;

        if (this.state.latestEntradasPage > totalPages) this.state.latestEntradasPage = totalPages;
        if (this.state.latestEntradasPage < 1) this.state.latestEntradasPage = 1;

        const startIndex = (this.state.latestEntradasPage - 1) * itemsPerPage;
        const pageItems = sorted.slice(startIndex, startIndex + itemsPerPage);

        // Atualizar info de página
        const pageInfo = document.getElementById('latest-entradas-page-info');
        if (pageInfo) pageInfo.textContent = `${this.state.latestEntradasPage} / ${totalPages}`;

        const prevBtn = document.getElementById('prev-latest-entradas');
        const nextBtn = document.getElementById('next-latest-entradas');
        if (prevBtn) prevBtn.disabled = this.state.latestEntradasPage === 1;
        if (nextBtn) nextBtn.disabled = this.state.latestEntradasPage === totalPages;

        if (pageItems.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.8rem;">Nenhuma entrada recente registrada.</div>';
            return;
        }

        container.innerHTML = pageItems.map(e => `
            <div class="latest-item">
                <div class="item-info">
                    <span class="item-title">${this.esc(e.fornecedor || 'Entrada de Estoque')}</span>
                    <span class="item-date">${new Date(e.date).toLocaleDateString()} - ${e.items.length} itens</span>
                </div>
                <div class="item-actions-wrapper">
                    <span class="item-amount">${this.formatCurrency(e.totalCusto)}</span>
                    <button class="btn-action-view" onclick="app.showEntradaDetails('${e.id}')" title="Ver Detalhes">
                        <i data-lucide="eye"></i>
                    </button>
                </div>
            </div>
        `).join('');

        this.initLucide();
    },

    changeLatestEntradasPage(delta) {
        this.state.latestEntradasPage += delta;
        this.renderLatestEntradas();
    },

    getPreviousPeriodSales(filter) {
        const now = new Date();
        const intervalos = window.Dashboard && typeof Dashboard.intervalosPeriodo === 'function'
            ? Dashboard.intervalosPeriodo(filter, now)
            : null;
        if (!intervalos) return [];

        return (this.state.sales || []).filter(s => {
            const d = this.parseDate(s.date || s.Data);
            if (!d) return false;
            return d >= intervalos.anteriorInicio && d <= intervalos.anteriorFim;
        });
    },

    calculateTotalsFromSales(sales) {
        return sales.reduce((acc, s) => {
            const subtotal = s.valor_total ?? s["Valor Total"] ?? s.total ?? 0;
            const desconto = s.desconto ?? s.Desconto ?? 0;
            const totalFinal = subtotal - desconto;
            const custo = s.cost ?? s.custo ?? s.Custo ?? s.custoTotal ?? 0;
            const lucro = s.lucro ?? s.Lucro ?? (totalFinal - custo);
            return {
                faturamento: acc.faturamento + (Number(totalFinal) || 0),
                custo: acc.custo + (Number(custo) || 0),
                lucro: acc.lucro + (Number(lucro) || 0)
            };
        }, { faturamento: 0, custo: 0, lucro: 0 });
    },

    updateVariation(elementId, current, previous) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const valueEl = el.querySelector('.var-value');
        if (!valueEl) return;

        if (previous > 0) {
            const diffPercent = ((current - previous) / previous) * 100;
            const sign = diffPercent >= 0 ? '▲' : '▼';
            const fmt = Math.abs(diffPercent).toFixed(1).replace('.', ',');
            valueEl.textContent = `${sign} ${fmt}%`;
            valueEl.className = 'var-value ' + (diffPercent >= 0 ? 'positive' : 'negative');
        } else if (current > 0) {
            valueEl.textContent = 'Novo';
            valueEl.className = 'var-value positive';
        } else if (current < 0) {
            valueEl.textContent = '▼ 100,0%';
            valueEl.className = 'var-value negative';
        } else {
            valueEl.textContent = '0,0%';
            valueEl.className = 'var-value';
        }
    },

    updateDashboardStats() {
        const filter = this.state.dashboardFilter;
        const currentSales = this.getFilteredSales();
        const previousSales = this.getPreviousPeriodSales(filter);

        const currentTotals = this.calculateTotalsFromSales(currentSales);
        const previousTotals = this.calculateTotalsFromSales(previousSales);

        const totalFaturamento = currentTotals.faturamento;
        const totalLucro = currentTotals.lucro;
        const numVendas = currentSales.length;
        const ticketMedio = numVendas > 0 ? totalFaturamento / numVendas : 0;

        document.getElementById('dash-faturamento').textContent = this.formatCurrency(totalFaturamento);
        document.getElementById('dash-lucro').textContent = this.formatCurrency(totalLucro);
        document.getElementById('dash-vendas').textContent = numVendas;
        document.getElementById('dash-ticket').textContent = this.formatCurrency(ticketMedio);

        // Atualizar variações
        this.updateVariation('dash-faturamento-var', totalFaturamento, previousTotals.faturamento);
        this.updateVariation('dash-lucro-var', totalLucro, previousTotals.lucro);
        
        const prevNumVendas = previousSales.length;
        this.updateVariation('dash-vendas-var', numVendas, prevNumVendas);
        
        const prevTicketMedio = prevNumVendas > 0 ? previousTotals.faturamento / prevNumVendas : 0;
        this.updateVariation('dash-ticket-var', ticketMedio, prevTicketMedio);

        this.initCharts();
    },

    renderRecentSales() {
        // Removido conforme solicitado
    },

    // --- POS Logic ---
    updatePaidVisibility() {
        const split = !!this.state.posState.split;
        this.setSplitLayout(split);
        if (split) {
            this.renderSplitRows();
            this.updateSplitSummary();
            return;
        }
        const payment = document.getElementById('pos-payment') ? document.getElementById('pos-payment').value : '';
        document.querySelectorAll('.pos-pay-btn').forEach(b => b.classList.toggle('active', b.dataset.pay === payment));
        const paidInput = document.getElementById('pos-paid');
        const changeRow = document.getElementById('pos-change-row');
        if (!paidInput || !changeRow) return;

        const isCash = payment && payment.toLowerCase() === 'dinheiro';
        const paidGroup = document.getElementById('pos-paid-group');

        if (paidGroup) {
            paidGroup.classList.toggle('hidden', !isCash);
        }

        changeRow.classList.toggle('hidden', !isCash);
        if (!isCash) {
            paidInput.value = '';
            document.getElementById('pos-change-val').textContent = 'R$ 0,00';
        } else {
            this.calculateChange();
        }
    },

    handleBarcodeEntry(code) {
        const termo = (code || '').trim();
        if (!termo) return;

        let produto = this.state.products.find(p => String(p.code) === termo);
        if (!produto && !/^\d+$/.test(termo)) {
            // Não é código de barras: procura pelo nome. Só aceita se for um único produto.
            const achados = this.state.products.filter(p => (p.name || '').toLowerCase().includes(termo.toLowerCase()));
            if (achados.length > 1) {
                this.showNotification('error', `${achados.length} produtos encontrados. Digite o nome completo ou clique no produto.`);
                return;
            }
            produto = achados[0];
        }
        if (!produto) {
            this.showNotification('error', 'Produto não encontrado pelo código ou nome informado.');
            return;
        }

        if (this.addToCart(produto.id, 1)) {
            const barcodeInput = document.getElementById('pos-barcode');
            if (barcodeInput) barcodeInput.value = '';
            this.renderPosCatalog();
        }
    },

    addToCart(id, qty = 1) {
        const product = this.state.products.find(p => p.id === id);
        if (!product) return false;

        const cartItem = this.state.cart.find(item => item.id === id);
        const currentQty = cartItem ? cartItem.qty : 0;
        if (currentQty + qty > product.stock) {
            this.showNotification('error', 'Estoque insuficiente para este produto.');
            return false;
        }

        if (cartItem) cartItem.qty += qty;
        else this.state.cart.push({ ...product, qty: qty });
        this.renderCart();
        return true;
    },

    renderCart() {
        const container = document.getElementById('pos-cart-items');
        const countEl = document.getElementById('pos-cart-count');
        const totalItens = this.state.cart.reduce((acc, item) => acc + item.qty, 0);
        if (countEl) countEl.textContent = totalItens;
        if (!container) return;

        if (this.state.cart.length === 0) {
            container.innerHTML = '<div class="empty-cart-msg">Carrinho vazio</div>';
        } else {
            container.innerHTML = this.state.cart.map(item => `
                <div class="pos-cart-item">
                    <div class="pos-ci-thumb">${item.image
                        ? `<img class="pos-foto" src="${item.image}" alt="">`
                        : `<span>${this.esc((item.name || '?').charAt(0).toUpperCase())}</span>`}</div>
                    <div class="pos-ci-info">
                        <span class="pos-ci-name">${this.esc(item.name)}</span>
                        <span class="pos-ci-unit">${this.formatCurrency(item.price)} cada</span>
                    </div>
                    <div class="pos-ci-qty">
                        <button type="button" onclick="app.changeCartQty('${item.id}', -1)">-</button>
                        <span>${item.qty}</span>
                        <button type="button" onclick="app.changeCartQty('${item.id}', 1)">+</button>
                    </div>
                    <span class="pos-ci-total">${this.formatCurrency(item.price * item.qty)}</span>
                    <button type="button" class="pos-ci-remove" title="Remover item" onclick="app.removeFromCart('${item.id}')"><i data-lucide="trash-2"></i></button>
                </div>`).join('');
            this.initLucide();
            this.ajustarFotosPdv(container);
        }
        this.renderPosCatalog(); // atualiza o estoque exibido nos cards
        this.calculateTotals();
    },

    renderPosCatalog() {
        const grid = document.getElementById('pos-product-grid');
        const chips = document.getElementById('pos-chips');
        if (!grid || !chips) return;

        const categoria = (this.state.posCatalog && this.state.posCatalog.categoria) || '';
        const busca = (document.getElementById('pos-barcode')?.value || '').trim().toLowerCase();

        chips.innerHTML = [{ id: '', name: 'Todos' }, ...this.state.categories].map(c =>
            `<button type="button" class="pos-chip${categoria === c.id ? ' active' : ''}" data-cat="${this.esc(c.id)}">${this.esc(c.name)}</button>`
        ).join('');

        const lista = this.state.products
            .filter(p => !categoria || p.category === categoria)
            .filter(p => !busca || (p.name || '').toLowerCase().includes(busca) || String(p.code || '').toLowerCase().includes(busca))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        if (lista.length === 0) {
            grid.innerHTML = '<div class="pos-empty">Nenhum produto encontrado.</div>';
            return;
        }

        grid.innerHTML = lista.map(p => {
            const semEstoque = !(p.stock > 0);
            const foto = p.image
                ? `<img class="pos-foto" src="${p.image}" alt="">`
                : `<span class="pos-card-letter">${this.esc((p.name || '?').charAt(0).toUpperCase())}</span>`;
            return `
                <button type="button" class="pos-card${semEstoque ? ' is-out' : ''}" ${semEstoque ? 'disabled' : ''} onclick="app.addToCart('${p.id}', 1)">
                    <span class="pos-card-img">${foto}</span>
                    <span class="pos-card-name">${this.esc(p.name)}</span>
                    <span class="pos-card-foot">
                        <strong>${this.formatCurrency(p.price)}</strong>
                        <span class="pos-card-stock">${semEstoque ? 'Sem estoque' : p.stock + ' un'}</span>
                    </span>
                </button>`;
        }).join('');
        this.ajustarFotosPdv(grid);
    },

    // PDV: se a foto tem margem branca, amplia o conteúdo para preencher o quadro.
    // Só muda a exibição na tela; o arquivo da foto não é alterado.
    fotoBbox(img) {
        try {
            const w = img.naturalWidth, h = img.naturalHeight;
            if (!w || !h) return null;
            const escala = Math.min(1, 160 / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * escala)), ch = Math.max(1, Math.round(h * escala));
            const cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, cw, ch);
            const d = ctx.getImageData(0, 0, cw, ch).data;
            let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
            for (let y = 0; y < ch; y++) {
                for (let x = 0; x < cw; x++) {
                    const i = (y * cw + x) * 4;
                    const fundo = d[i + 3] < 20 || (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235);
                    if (!fundo) {
                        if (x < x0) x0 = x;
                        if (x > x1) x1 = x;
                        if (y < y0) y0 = y;
                        if (y > y1) y1 = y;
                    }
                }
            }
            if (x1 < 0) return null;
            return { x0: x0 / cw, y0: y0 / ch, x1: (x1 + 1) / cw, y1: (y1 + 1) / ch };
        } catch (_) {
            return null; // imagem não lida pelo canvas: mantém o recorte padrão
        }
    },

    ajustarFotosPdv(raiz) {
        if (!raiz || typeof raiz.querySelectorAll !== 'function') return;
        if (!this._pdvFotoResize) {
            this._pdvFotoResize = true;
            window.addEventListener('resize', () => {
                document.querySelectorAll('#pos-view img.pos-foto').forEach(img => {
                    if (img._bboxFeito) this.posicionarFotoPdv(img);
                });
            });
        }
        raiz.querySelectorAll('img.pos-foto').forEach(img => {
            const aplicar = () => {
                if (!img._bboxFeito) {
                    img._bbox = this.fotoBbox(img);
                    img._bboxFeito = true;
                }
                this.posicionarFotoPdv(img);
            };
            if (img.complete && img.naturalWidth) aplicar();
            else img.addEventListener('load', aplicar, { once: true });
        });
    },

    posicionarFotoPdv(img) {
        const b = img._bbox;
        const W = img.clientWidth, H = img.clientHeight;
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!b || !W || !H || !w || !h) { img.style.transform = ''; return; }
        // Cobertura padrão (object-fit: cover) e posição do conteúdo dentro do quadro
        const s0 = Math.max(W / w, H / h);
        const Rw = w * s0, Rh = h * s0;
        const ox = (W - Rw) / 2, oy = (H - Rh) / 2;
        const bw = (b.x1 - b.x0) * Rw, bh = (b.y1 - b.y0) * Rh;
        const bcx = ox + (b.x0 + b.x1) / 2 * Rw, bcy = oy + (b.y0 + b.y1) / 2 * Rh;
        // Amplia o conteúdo até caber no quadro, com limite para não pixelizar
        const k = Math.min(1.35, Math.max(1, Math.min(W / bw, H / bh)));
        let tx = -k * (bcx - W / 2), ty = -k * (bcy - H / 2);
        // A área do quadro precisa continuar coberta pela foto (sem faixa vazia)
        const mx = (k - 1) * W / 2, my = (k - 1) * H / 2;
        tx = Math.min(Math.max(tx, -mx), mx);
        ty = Math.min(Math.max(ty, -my), my);
        img.style.transformOrigin = '50% 50%';
        img.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(3)})`;
    },

    changeCartQty(id, delta) {
        const item = this.state.cart.find(i => i.id === id);
        if (!item) return;
        const novo = item.qty + delta;
        if (novo <= 0) {
            this.removeFromCart(id);
            return;
        }
        const produto = this.state.products.find(p => p.id === id);
        if (produto && novo > produto.stock) {
            this.showNotification('error', 'Estoque insuficiente para este produto.');
            return;
        }
        item.qty = novo;
        this.renderCart();
    },

    removeFromCart(id) {
        this.state.cart = this.state.cart.filter(item => item.id !== id);
        this.renderCart();
    },

    // Desconto em R$ ou em % do subtotal. Sempre devolve o valor em reais.
    descontoReais(subtotal) {
        const input = document.getElementById('pos-discount');
        const valor = input ? Math.max(0, parseFloat(input.value) || 0) : 0;
        if (this.state.posState.discountType === 'percent') {
            const pct = Math.min(valor, 100);
            return Math.round(subtotal * pct) / 100;
        }
        return valor;
    },

    setDiscountType(tipo) {
        this.state.posState.discountType = tipo === 'percent' ? 'percent' : 'reais';
        document.querySelectorAll('.pos-disc-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-disc') === this.state.posState.discountType);
        });
        const input = document.getElementById('pos-discount');
        if (input) input.placeholder = this.state.posState.discountType === 'percent' ? '0%' : '0,00';
        this.calculateTotals();
    },

    // Limpa itens e desconto da venda atual (pede confirmação se houver algo).
    limparVenda() {
        const desconto = document.getElementById('pos-discount');
        if (this.state.cart.length === 0 && !(desconto && desconto.value)) return;
        this.confirmAction(
            'Limpar venda',
            'Remover todos os itens e o desconto desta venda?',
            () => {
                this.state.cart = [];
                if (desconto) desconto.value = '';
                this.state.posState.discount = '';
                const paid = document.getElementById('pos-paid');
                if (paid) paid.value = '';
                this.state.posState.paid = '';
                this.renderCart();
            },
            'trash-2'
        );
    },

    calculateTotals() {
        const subtotal = this.state.cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
        const desconto = this.descontoReais(subtotal);
        const totalFinal = Math.max(0, subtotal - desconto);
        const subEl = document.getElementById('pos-subtotal');
        if (subEl) subEl.textContent = this.formatCurrency(subtotal);
        document.getElementById('pos-total-val').textContent = this.formatCurrency(totalFinal);
        this.calculateChange();
    },

    calculateChange() {
        if (this.state.posState.split) {
            this.updateSplitSummary();
            return;
        }
        const totalEl = document.getElementById('pos-total-val');
        const paidEl = document.getElementById('pos-paid');
        const changeEl = document.getElementById('pos-change-val');
        const changeRow = document.getElementById('pos-change-row');
        if (!totalEl || !paidEl || !changeEl || !changeRow) return;

        const payment = document.getElementById('pos-payment') ? document.getElementById('pos-payment').value : '';
        const isCash = payment && payment.toLowerCase() === 'dinheiro';
        if (!isCash) {
            changeEl.textContent = 'R$ 0,00';
            changeRow.classList.add('hidden');
            return;
        }

        const totalStr = totalEl.textContent.replace(/[^\d,-]/g, '').replace(',', '.');
        const total = parseFloat(totalStr) || 0;
        const paid = parseFloat(paidEl.value) || 0;
        const change = paid - total;

        if (change <= 0) {
            changeEl.textContent = 'R$ 0,00';
        } else {
            changeEl.textContent = this.formatCurrency(change);
        }
    },

    // ---- Pagamento dividido: uma venda paga em mais de uma forma ----
    setSplitLayout(split) {
        const botoes = document.querySelector('.pos-pay-buttons');
        const box = document.getElementById('pos-split');
        const toggle = document.getElementById('btn-split-pay');
        if (botoes) botoes.classList.toggle('hidden', split);
        if (box) box.classList.toggle('hidden', !split);
        if (split) {
            const paidGroup = document.getElementById('pos-paid-group');
            const changeRow = document.getElementById('pos-change-row');
            if (paidGroup) paidGroup.classList.add('hidden');
            if (changeRow) changeRow.classList.add('hidden');
        }
        if (toggle) {
            toggle.classList.toggle('active', split);
            toggle.textContent = split ? 'Voltar para uma forma' : 'Dividir pagamento';
        }
    },

    toggleSplitPay() {
        const ps = this.state.posState;
        ps.split = !ps.split;
        if (ps.split && (!ps.splitRows || ps.splitRows.length === 0)) {
            ps.splitRows = [{ forma: 'dinheiro', valor: 0 }, { forma: 'pix', valor: 0 }];
        }
        this.updatePaidVisibility();
    },

    addSplitRow() {
        const ps = this.state.posState;
        const usada = new Set(ps.splitRows.map(l => l.forma));
        const livre = ['cartao', 'pix', 'dinheiro'].find(f => !usada.has(f)) || 'cartao';
        ps.splitRows.push({ forma: livre, valor: 0 });
        this.renderSplitRows();
        this.updateSplitSummary();
    },

    renderSplitRows() {
        const box = document.getElementById('pos-split-rows');
        if (!box) return;
        const nomes = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX' };
        box.innerHTML = this.state.posState.splitRows.map((l, i) => `
            <div class="pos-split-row">
                <select class="pos-split-forma" data-idx="${i}">
                    ${Object.entries(nomes).map(([v, t]) => `<option value="${v}"${v === l.forma ? ' selected' : ''}>${t}</option>`).join('')}
                </select>
                <input type="number" class="pos-split-valor" data-idx="${i}" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${l.valor ? l.valor : ''}">
                <button type="button" class="pos-split-remove" data-idx="${i}" title="Remover">&times;</button>
            </div>`).join('');
    },

    totaisVenda() {
        const subtotal = this.state.cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
        const desconto = this.descontoReais(subtotal);
        const total = Math.max(0, Math.round((subtotal - desconto) * 100) / 100);
        return { subtotal, desconto, total };
    },

    // Confere as linhas do pagamento dividido contra o total. Dinheiro é o único que gera troco.
    calcularPagamentoMisto(total) {
        const r2 = (v) => Math.round(v * 100) / 100;
        const T = r2(total);
        const validas = (this.state.posState.splitRows || []).filter(l => (Number(l.valor) || 0) > 0);
        if (validas.length === 0) return { ok: false, motivo: 'Informe o valor de cada forma de pagamento.' };

        const caixa = validas.filter(l => l.forma === 'dinheiro');
        const outras = validas.filter(l => l.forma !== 'dinheiro');
        if (caixa.length > 1) return { ok: false, motivo: 'Use uma única linha em dinheiro.' };

        const somaOutras = r2(outras.reduce((acc, l) => acc + Number(l.valor), 0));
        if (somaOutras > T) return { ok: false, motivo: 'Cartão e Pix passam do total da venda.' };
        const restante = r2(T - somaOutras);
        const pagamentos = outras.map(l => ({ forma: l.forma, valor: r2(Number(l.valor)) }));

        if (caixa.length === 0) {
            if (restante > 0) return { ok: false, motivo: `Falta ${this.formatCurrency(restante)}` };
            return { ok: true, pagamentos, troco: 0 };
        }
        if (restante <= 0) return { ok: false, motivo: 'O total já está coberto. Remova a linha de dinheiro.' };

        const recebido = r2(Number(caixa[0].valor));
        if (recebido < restante) return { ok: false, motivo: `Falta ${this.formatCurrency(r2(restante - recebido))}` };
        pagamentos.push({ forma: 'dinheiro', valor: restante });
        return { ok: true, pagamentos, troco: r2(recebido - restante) };
    },

    updateSplitSummary() {
        const el = document.getElementById('pos-split-summary');
        if (!el) return;
        const pg = this.calcularPagamentoMisto(this.totaisVenda().total);
        if (pg.ok) {
            el.textContent = pg.troco > 0 ? `Troco ${this.formatCurrency(pg.troco)}` : 'Pagamento completo';
        } else {
            el.textContent = pg.motivo;
        }
        el.classList.toggle('is-ok', pg.ok);
        el.classList.toggle('is-error', !pg.ok);
    },

    // Texto da forma de pagamento para histórico e recibo
    /** Situação do fiado logo abaixo do valor final da venda: falta pagar ou quitado. Venda à vista não mostra nada. */
    statusFiadoVendaHtml(sale) {
        if (!Fiado.ehFiado(sale)) return '';
        const falta = Fiado.saldoAberto(sale);
        const total = Number(sale.valor_final) || 0;
        const titulo = `Pago ${this.formatCurrency(Fiado.recebido(sale))} de ${this.formatCurrency(total)}`;
        return falta > 0
            ? `<small class="fiado-status-aberto" style="display:block" title="${titulo}">Falta ${this.formatCurrency(falta)}</small>`
            : `<small class="fiado-status-quitado" style="display:block" title="${titulo}">Quitado</small>`;
    },

    rotuloPagamento(sale) {
        if (Array.isArray(sale.pagamentos) && sale.pagamentos.length) {
            const nomes = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX' };
            return 'Misto: ' + sale.pagamentos.map(p => `${nomes[p.forma] || p.forma} ${this.formatCurrency(p.valor)}`).join(' + ');
        }
        if (sale.pagamento === 'fiado') {
            const saldo = Fiado.saldoAberto(sale);
            return saldo > 0 ? `Fiado · em aberto ${this.formatCurrency(saldo)}` : 'Fiado · quitado';
        }
        return sale.pagamento || sale["Forma de Pagamento"] || 'N/A';
    },

    async finishSale() {
        if (this.requirePasswordChange()) return;
        if (this.state.cart.length === 0) return;

        // Custo do momento da venda: usa o custo atual do produto (o carrinho pode estar aberto durante uma entrada)
        const itensVenda = this.state.cart.map(item => {
            const atual = this.state.products.find(p => p.id === item.id);
            return { ...item, cost: atual ? atual.cost : item.cost };
        });
        const subtotal = itensVenda.reduce((acc, item) => acc + (item.price * item.qty), 0);
        const custoTotal = itensVenda.reduce((acc, item) => acc + (item.cost * item.qty), 0);
        const desconto = this.descontoReais(subtotal);
        const totalFinal = Math.max(0, subtotal - desconto);
        const lucro = totalFinal - custoTotal;
        const paymentEl = document.getElementById('pos-payment');
        let pagamentoVenda = { pagamento: paymentEl ? paymentEl.value : 'N/A' };
        if (this.state.posState.split) {
            const pg = this.calcularPagamentoMisto(totalFinal);
            if (!pg.ok) {
                this.showNotification('error', pg.motivo);
                return;
            }
            pagamentoVenda = { pagamento: 'misto', pagamentos: pg.pagamentos, troco: pg.troco };
        }
        const customerEl = document.getElementById('pos-customer');
        const clienteCadastro = customerEl && customerEl.value ? this.clientePorId(customerEl.value) : null;
        const cliente = clienteCadastro ? clienteCadastro.name : 'Consumidor Final';

        if (pagamentoVenda.pagamento === 'fiado') {
            const checagem = Fiado.validarVendaFiado(clienteCadastro ? String(clienteCadastro.id) : '');
            if (!checagem.ok) {
                this.showNotification('error', checagem.motivo);
                return;
            }
            const limite = Fiado.validarLimite(this.state.sales, String(clienteCadastro.id), clienteCadastro.limite_credito, totalFinal);
            if (!limite.ok) {
                this.showNotification('error', `${limite.motivo} Disponível para fiado: ${this.formatCurrency(limite.disponivel)}.`);
                return;
            }
            const vencimento = Fiado.vencimentoPara(new Date(), clienteCadastro.prazo_dias);
            pagamentoVenda = { pagamento: 'fiado', recebimentos: [], cliente_id: String(clienteCadastro.id), ...(vencimento ? { vencimento } : {}) };
        }

        // Armazena a venda pendente no estado
        this.state.pendingSale = {
            id: 'V' + Date.now(),
            date: new Date().toISOString(),
            cliente: cliente,
            valor_total: subtotal,
            desconto: desconto,
            valor_final: totalFinal,
            cost: custoTotal,
            lucro: lucro,
            ...pagamentoVenda,
            items: itensVenda
        };

        // Resetar textos do modal para modo "Nova Venda"
        document.getElementById('receipt-modal-title').textContent = 'Finalizar Venda';
        document.getElementById('receipt-modal-msg-primary').textContent = 'Venda processada com sucesso!';

        // Abre o modal de confirmação de recibo
        this.openModal('receipt-confirm');
    },

    async confirmFinishSale(action) {
        if (!this.state.pendingSale) return;

        const sale = this.state.pendingSale;

        // Se a venda ainda não está no histórico (é uma venda nova do PDV)
        if (!this.state.sales.find(s => (s.id || s.ID) === sale.id)) {
            // Atualiza o estoque
            this.registrarMovimentacoes(Estoque.movimentosDaVenda(sale));

            // Adiciona a venda ao histórico
            this.state.sales.push(sale);
            this.state.cart = [];

            await this.salvarDados();
            this.showNotification('success', 'Venda finalizada com sucesso!');

            // Limpar campos do PDV
            const paidInput = document.getElementById('pos-paid');
            if (paidInput) paidInput.value = '';
            const discountInput = document.getElementById('pos-discount');
            if (discountInput) discountInput.value = '';

            // Limpar estado do POS
            this.state.posState = {
                customer: '',
                payment: 'dinheiro',
                discount: '',
                paid: '',
                isDirectSale: false,
                split: false,
                splitRows: []
            };
            this.updatePaidVisibility();

            const changeRow = document.getElementById('pos-change-row');
            if (changeRow) changeRow.classList.add('hidden');

            this.renderCart();
            this.updateDashboardStats();
            this.renderHistory();
        }

        // Fecha o modal de confirmação
        this.closeModal();

        if (action === 'print') {
            this.generateReceipt(sale);
        }

        this.state.pendingSale = null;
    },

    generateReceipt(sale, shouldPrint = true) {
        // Preencher informações da empresa
        document.getElementById('receipt-company-name').textContent = this.state.settings.companyName || 'Sua Empresa';
        document.getElementById('receipt-company-address').textContent = this.state.settings.address || 'Endereço não informado';
        document.getElementById('receipt-company-contact').textContent = `WhatsApp: ${this.state.settings.whatsapp || 'N/A'} | Email: ${this.state.settings.email || 'N/A'}`;

        const logoContainer = document.getElementById('receipt-logo-container');
        if (this.state.settings.logoUrl) {
            logoContainer.innerHTML = `<img src="${this.state.settings.logoUrl}" alt="Logo">`;
        } else {
            logoContainer.innerHTML = '';
        }

        // Informações da venda
        const saleId = sale.id || sale.ID || '';
        const saleDate = sale.date || sale.Data || new Date().toISOString();
        const saleCustomer = sale.cliente || sale.Cliente || 'Consumidor Final';
        const salePayment = this.rotuloPagamento(sale);

        document.getElementById('receipt-sale-id').textContent = `#${saleId.toString().slice(-6)}`;
        document.getElementById('receipt-sale-date').textContent = new Date(saleDate).toLocaleString('pt-BR');
        document.getElementById('receipt-customer-name').textContent = saleCustomer;
        document.getElementById('receipt-payment-method').textContent = salePayment;

        // Lista de itens
        const itemsContainer = document.getElementById('receipt-items-container');
        const itemCount = sale.items.length;
        const itemsCountEl = document.getElementById('receipt-items-count');
        if (itemsCountEl) itemsCountEl.textContent = String(itemCount);

        const itemsHtml = sale.items.map(item => {
            const qty = Number(item.qty) || 0;
            const price = Number(item.price) || 0;
            return `
                <tr>
                    <td>${this.esc(item.name)}</td>
                    <td>${qty}</td>
                    <td>${this.formatCurrency(price)}</td>
                    <td>${this.formatCurrency(price * qty)}</td>
                </tr>
            `;
        }).join('');

        itemsContainer.innerHTML = itemsHtml;

        // Totais
        const subtotal = sale.valor_total ?? sale["Valor Total"] ?? 0;
        const desconto = sale.desconto ?? sale.Desconto ?? 0;
        const totalFinal = subtotal - desconto;
        const custo = sale.cost ?? sale.custo ?? sale.Custo ?? 0;

        document.getElementById('receipt-subtotal').textContent = this.formatCurrency(subtotal);
        document.getElementById('receipt-discount').textContent = this.formatCurrency(desconto);
        document.getElementById('receipt-total-final').textContent = this.formatCurrency(totalFinal);
        document.getElementById('receipt-footer-date').textContent = `Gerado em ${new Date().toLocaleString('pt-BR')}`;

        // Mostrar container do recibo e disparar impressão
        const container = document.getElementById('receipt-container');
        container.classList.remove('hidden');

        // Pequeno delay para garantir renderização antes de imprimir
        if (shouldPrint) {
            setTimeout(() => {
                window.print();
                // Após imprimir (ou cancelar), esconder novamente
                setTimeout(() => {
                    container.classList.add('hidden');
                }, 500);
            }, 1000);
        }
        // Se não for para imprimir (ex: para PDF), deixamos o controle de visibilidade para quem chamou
    },

    // --- Management Logic ---
    visaoDe(vista) {
        const v = localStorage.getItem('sv_visao_' + vista) === 'cards' ? 'cards' : 'tabela';
        document.querySelectorAll('.seg-toggle[data-vista="' + vista + '"] button').forEach(b => {
            b.classList.toggle('active', b.dataset.visao === v);
        });
        return v;
    },

    produtoCardHtml(p, lowLevel, mediumLevel) {
        const inicial = p.name ? p.name.charAt(0).toUpperCase() : '?';
        const foto = p.image
            ? `<img src="${p.image}" alt="">`
            : `<span class="tabela-card-letra">${inicial}</span>`;
        const cat = this.state.categories.find(c => c.id === p.category);
        const nivelCls = p.stock < lowLevel ? 'stock-low' : (p.stock < mediumLevel ? 'stock-medium' : '');
        return `
            <div class="tabela-card">
                <div class="tabela-card-topo">
                    <div class="tabela-card-foto">${foto}</div>
                    <div class="tabela-card-titulo">
                        <strong title="${this.esc(p.name)}">${this.esc(p.name)}</strong>
                        <span>#${p.id.toString().slice(-4)} · ${this.esc(p.code) || 'N/A'}</span>
                        ${cat ? `<span class="category-badge">${this.esc(cat.name)}</span>` : ''}
                    </div>
                </div>
                <div class="tabela-card-dados">
                    <div><small>Custo</small><b>${this.formatCurrency(p.cost)}</b></div>
                    <div><small>Venda</small><b>${this.formatCurrency(p.price)}</b></div>
                    <div class="tabela-card-estoque-bloco">
                        <small>Estoque</small>
                        <div class="tabela-card-estoque">
                            <button class="btn-stock-minus" onclick="app.adjustStock('${p.id}', -2)" title="Ajuste Manual — Saída"><i data-lucide="minus"></i></button>
                            <span class="stock-val ${nivelCls}">${p.stock}</span>
                            <button class="btn-stock-add" onclick="app.adjustStock('${p.id}', 2)" title="Ajuste Manual — Entrada"><i data-lucide="plus"></i></button>
                        </div>
                    </div>
                </div>
                <div class="tabela-card-acoes">
                    <button class="btn-action-view" onclick="app.showProductHistory('${p.id}')" title="Histórico de Estoque"><i data-lucide="history"></i></button>
                    <button class="btn-action-edit" onclick="app.editProduct('${p.id}')" title="Editar"><i data-lucide="edit-3"></i></button>
                    <button class="btn-action-delete" onclick="app.deleteProduct('${p.id}')" title="Excluir"><i data-lucide="trash-2"></i></button>
                </div>
            </div>`;
    },

    renderProducts(query = '', category = '') {
        const container = document.getElementById('products-items-container');
        if (!container) return;

        const termo = String(query || '').trim().toLowerCase();
        let filtered = this.state.products.filter(p => {
            if (!termo) return true;
            return (p.name || '').toLowerCase().includes(termo)
                || String(p.code || '').toLowerCase().includes(termo)
                || String(p.id || '').toLowerCase().includes(termo);
        });

        if (category) {
            filtered = filtered.filter(p => p.category === category);
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-dim);">Nenhum produto encontrado.</div>';
            return;
        }

        const nSettings = this.state.settings.notifications || {
            stockLowVal: 10,
            stockMediumVal: 25
        };
        const lowLevel = nSettings.stockLowVal || 10;
        const mediumLevel = nSettings.stockMediumVal || 25;

        const visaoProd = this.visaoDe('produtos');
        container.dataset.visao = visaoProd;
        const listaProd = document.getElementById('products-list-labs');
        if (listaProd) listaProd.classList.toggle('modo-cards', visaoProd === 'cards');
        if (visaoProd === 'cards') {
            container.innerHTML = filtered.map(p => this.produtoCardHtml(p, lowLevel, mediumLevel)).join('');
            this.initLucide();
            return;
        }
        container.innerHTML = filtered.map(p => {
            const initialLetter = p.name ? p.name.charAt(0).toUpperCase() : '?';
            const avatar = p.image
                ? `<img src="${p.image}" class="item-avatar">`
                : `<div class="item-avatar-letter">${initialLetter}</div>`;

            const cat = this.state.categories.find(c => c.id === p.category);
            const categoryBadge = cat ? `<span class="category-badge">${this.esc(cat.name)}</span>` : '';

            return `
                <div class="nested-item-labs-row">
                    <span class="col-id" data-label="ID">#${p.id.toString().slice(-4)}</span>
                    <div class="col-product" data-label="PRODUTO">
                        ${avatar}
                        <div class="product-info-mini">
                            <span class="product-name-mini">${this.esc(p.name)}</span>
                            ${categoryBadge}
                            <span class="product-obs-mini">${this.esc(p.obs) || 'Sem observação'}</span>
                        </div>
                    </div>
                    <span class="col-code" data-label="CÓDIGO">${this.esc(p.code) || 'N/A'}</span>
                    <span class="col-cost" data-label="CUSTO">${this.formatCurrency(p.cost)}</span>
                    <span class="col-price" data-label="VENDA">${this.formatCurrency(p.price)}</span>
                    <div class="col-stock" data-label="ESTOQUE">
                        <button class="btn-stock-minus" onclick="app.adjustStock('${p.id}', -2)" title="Ajuste Manual — Saída"><i data-lucide="minus"></i></button>
                        <span class="stock-val ${p.stock < lowLevel ? 'stock-low' : (p.stock < mediumLevel ? 'stock-medium' : '')}">${p.stock}</span>
                        <button class="btn-stock-add" onclick="app.adjustStock('${p.id}', 2)" title="Ajuste Manual — Entrada"><i data-lucide="plus"></i></button>
                    </div>
                    <div class="col-actions" data-label="AÇÕES">
                        <button class="btn-action-view" onclick="app.showProductHistory('${p.id}')" title="Histórico de Estoque"><i data-lucide="history"></i></button>
                        <button class="btn-action-edit" onclick="app.editProduct('${p.id}')"><i data-lucide="edit-3"></i></button>
                        <button class="btn-action-delete" onclick="app.deleteProduct('${p.id}')"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                `;
        }).join('');
        this.initLucide();
    },

    async adjustStock(id, amount) {
        if (!this.requireAdmin('ajustar estoque')) return;
        const p = this.state.products.find(prod => prod.id === id);
        if (p) {
            // Se o amount for +/- 1, faz o ajuste direto (botões da lista)
            if (Math.abs(amount) === 1) {
                this.registrarAjusteEstoque(p, amount, 'Ajuste rápido');
                await this.salvarDados();
                // Preservar filtros ativos ao re-renderizar após ajuste de estoque
                const queryAtiva = document.getElementById('filter-products')?.value || '';
                const categoriaAtiva = document.getElementById('filter-category')?.value || '';
                this.renderProducts(queryAtiva, categoriaAtiva);
                return;
            }

            // Caso contrário, abre o modal (ajuste manual de grande quantidade)
            this.state.editingId = id;
            this.state.stockAdjustmentType = amount > 0 ? 'add' : 'remove';

            const title = amount > 0 ? 'Ajuste Manual — Entrada' : 'Ajuste Manual — Saída';
            const label = amount > 0 ? 'QUANTIDADE A AJUSTAR (ENTRADA)' : 'QUANTIDADE A AJUSTAR (SAÍDA)';

            const modalTitleEl = document.getElementById('stock-modal-title');
            const qtyLabelEl = document.getElementById('stock-qty-label');
            const prodNameEl = document.getElementById('stock-prod-name');
            const qtyInputEl = document.getElementById('stock-qty-add');

            if (modalTitleEl) modalTitleEl.textContent = title;
            if (qtyLabelEl) qtyLabelEl.textContent = label;
            if (prodNameEl) prodNameEl.textContent = `Produto: ${p.name} (Atual: ${p.stock})`;
            if (qtyInputEl) qtyInputEl.value = '';

            this.openModal('stock');
        }
    },

    async handleStockSubmit(e) {
        e.preventDefault();
        const qty = parseInt(document.getElementById('stock-qty-add').value) || 0;
        const p = this.state.products.find(prod => prod.id === this.state.editingId);

        if (p) {
            this.registrarAjusteEstoque(p, this.state.stockAdjustmentType === 'add' ? qty : -qty, 'Ajuste manual');

            await this.salvarDados();
            this.showNotification('success', `Ajuste manual aplicado: ${this.state.stockAdjustmentType === 'add' ? '+' : '-'}${qty} un.`);
            this.closeModal();
            // Preservar filtros ativos ao re-renderizar após ajuste de estoque
            const queryAtiva = document.getElementById('filter-products')?.value || '';
            const categoriaAtiva = document.getElementById('filter-category')?.value || '';
            this.renderProducts(queryAtiva, categoriaAtiva);
        }
    },

    async handleProductSubmit(e) {
        e.preventDefault();
        if (this.requirePasswordChange()) return;
        if (!this.requireAdmin('editar produtos')) return;
        try {
            const product = {
                id: this.state.editingId || 'P' + Date.now().toString(),
                name: document.getElementById('prod-name').value.trim(),
                code: document.getElementById('prod-code').value.trim(),
                cost: parseFloat(document.getElementById('prod-cost').value) || 0,
                price: parseFloat(document.getElementById('prod-price').value) || 0,
                stock: parseInt(document.getElementById('prod-stock').value) || 0,
                image: document.getElementById('prod-image-url').value,
                obs: document.getElementById('prod-obs').value.trim(),
                category: document.getElementById('prod-category')?.value || ''
            };

            this.validate(product, {
                name: { required: true, label: 'Nome' },
                code: { required: true, label: 'Código' },
                cost: { type: 'number', min: 0, label: 'Custo' },
                price: { type: 'number', min: 0, label: 'Preço' },
                stock: { type: 'number', min: 0, label: 'Estoque' }
            });

            if (this.state.editingId) {
                const index = this.state.products.findIndex(p => p.id === this.state.editingId);
                if (index !== -1) {
                    const anterior = this.state.products[index];
                    this.state.products[index] = product;
                    this.registrarAlteracaoProduto(anterior, product);
                }
            } else {
                this.state.products.push(product);
                this.registrarMovimentacoes([Estoque.movimentoCadastro(product.id, product.stock, product.cost)]);
            }

            await this.salvarDados();
            this.showNotification('success', this.state.editingId ? 'Produto atualizado com sucesso!' : 'Produto cadastrado com sucesso!');
            this.closeModal();
            // Preservar filtros ativos ao re-renderizar após editar/adicionar produto
            const queryAtiva = document.getElementById('filter-products')?.value || '';
            const categoriaAtiva = document.getElementById('filter-category')?.value || '';
            this.renderProducts(queryAtiva, categoriaAtiva);
        } catch (err) {
            this.showNotification('error', err.message);
        }
    },

    editProduct(id) {
        const p = this.state.products.find(p => p.id === id);
        if (!p) return;

        this.state.editingId = id;
        document.getElementById('prod-name').value = p.name;
        document.getElementById('prod-code').value = p.code;
        document.getElementById('prod-cost').value = p.cost;
        document.getElementById('prod-price').value = p.price;
        document.getElementById('prod-stock').value = p.stock;
        document.getElementById('prod-image-url').value = p.image || '';
        document.getElementById('prod-obs').value = p.obs || '';

        // Garantir que o select de categorias esteja populado antes de setar o valor
        this.populateCategorySelect();
        const catSelect = document.getElementById('prod-category');
        if (catSelect) catSelect.value = p.category || '';

        this.updatePhotoPreview(p.image);
        this.openModal('product');
    },

    async deleteProduct(id) {
        if (!this.requireAdmin('excluir produtos')) return;
        this.confirmAction(
            'Excluir Produto',
            'Deseja realmente excluir este produto?',
            async () => {
                this.logAudit('DELETE_PRODUCT', { productId: id });
                this.state.products = this.state.products.filter(p => p.id !== id);
                await this.salvarDados();
                this.showNotification('success', 'Produto excluído com sucesso!');
                // Preservar filtros ativos ao re-renderizar após excluir produto
                const queryAtiva = document.getElementById('filter-products')?.value || '';
                const categoriaAtiva = document.getElementById('filter-category')?.value || '';
                this.renderProducts(queryAtiva, categoriaAtiva);
            },
            'trash-2'
        );
    },

    async handleCustomerSubmit(e) {
        e.preventDefault();
        try {
            const limiteRaw = document.getElementById('cust-limite').value.trim();
            const prazoRaw = document.getElementById('cust-prazo').value.trim();
            const credito = Fiado.validarCadastroCredito(limiteRaw, prazoRaw);
            if (!credito.ok) throw new Error(credito.motivo);

            const customer = {
                id: this.state.editingId || 'C' + Date.now().toString(),
                name: document.getElementById('cust-name').value.trim(),
                whatsapp: document.getElementById('cust-whatsapp').value.replace(/\D/g, ''),
                email: document.getElementById('cust-email').value.trim(),
                obs: document.getElementById('cust-obs').value.trim(),
                date: new Date().toISOString(),
                image: document.getElementById('cust-image-url').value,
                limite_credito: limiteRaw === '' ? null : Number(limiteRaw),
                prazo_dias: prazoRaw === '' ? null : Number(prazoRaw)
            };

            this.validate(customer, {
                name: { required: true, label: 'Nome' },
                whatsapp: { required: true, label: 'WhatsApp' }
            });

            if (this.state.editingId) {
                const index = this.state.customers.findIndex(c => c.id === this.state.editingId);
                const nomeAnterior = index !== -1 ? this.state.customers[index].name : null;
                if (index !== -1) this.state.customers[index] = customer;
                if (nomeAnterior !== null && nomeAnterior !== customer.name) {
                    Fiado.renomearCliente(this.state.sales, customer.id, customer.name);
                }
            } else {
                this.state.customers.push(customer);
            }

            await this.salvarDados();
            this.showNotification('success', this.state.editingId ? 'Cliente atualizado com sucesso!' : 'Cliente cadastrado com sucesso!');
            this.closeModal();
            this.renderCustomers();
        } catch (err) {
            this.showNotification('error', err.message);
        }
    },

    renderCustomers(query) {
        this.renderFiadoPendentes();
        const container = document.getElementById('customers-items-container');
        if (!container) return;
        const busca = query !== undefined ? query : (document.getElementById('filter-customers')?.value || '');
        const termo = String(busca || '').trim().toLowerCase();
        const digitos = termo.replace(/\D/g, '');
        const filtered = this.state.customers.filter(c => {
            if (!termo) return true;
            if ((c.name || '').toLowerCase().includes(termo)) return true;
            if (String(c.id || '').toLowerCase().includes(termo)) return true;
            const whats = String(c.whatsapp || '');
            if (whats.toLowerCase().includes(termo)) return true;
            if (digitos && whats.replace(/\D/g, '').includes(digitos)) return true;
            return false;
        });

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-dim);">Nenhum cliente encontrado.</div>';
            return;
        }

        const resumos = Fiado.resumosPorCliente(this.state.sales);
        const atrasos = Fiado.atrasosPorCliente(this.state.sales);
        const textoFiado = (r, at) => {
            if (!r || r.totalPrazo <= 0) return '<span class="fiado-sem">-</span>';
            if (r.falta > 0) {
                const aviso = at && at.quantidade > 0
                    ? `<span class="fiado-atraso">${at.quantidade} venda(s) em atraso · ${at.diasMax} dia(s)</span>`
                    : '';
                return `<span class="fiado-falta"><strong>${this.formatCurrency(r.falta)}</strong> em aberto</span>` +
                    `<small>Pago ${this.formatCurrency(r.pago)} de ${this.formatCurrency(r.totalPrazo)}</small>` + aviso;
            }
            return `<span class="fiado-quitado">Quitado</span><small>${this.formatCurrency(r.totalPrazo)} a prazo</small>`;
        };
        container.innerHTML = filtered.map(c => {
            const r = resumos.get(String(c.id));
            const receber = r && r.falta > 0
                ? `<button type="button" class="btn-fiado-receber-lista" onclick="app.abrirRecebimentoFiado('${c.id}')">Receber</button>`
                : '';
            const extrato = r && r.totalPrazo > 0
                ? `<button type="button" class="btn-fiado-extrato" onclick="app.abrirExtratoFiado('${c.id}')">Extrato</button>`
                : '';
            return `
                <div class="nested-item-labs-row">
                    <span class="col-id" data-label="ID">#${c.id.toString().slice(-4)}</span>
                    <span class="col-name" data-label="NOME">${this.esc(c.name)}</span>
                    <span class="col-fiado" data-label="FIADO">${textoFiado(r, atrasos.get(String(c.id)))}</span>
                    <span class="col-whatsapp" data-label="WHATSAPP">${this.formatWhatsApp(c.whatsapp)}</span>
                    <span class="col-date" data-label="DATA">${this.parseDate(c.date) ? this.parseDate(c.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</span>
                    <span class="col-obs" data-label="OBS/ENDEREÇO">${this.esc(c.obs) || 'Sem observação'}</span>
                    <div class="col-actions" data-label="AÇÕES">
                        ${receber}
                        ${extrato}
                        <button class="btn-action-edit" onclick="app.editCustomer('${c.id}')"><i data-lucide="edit-3"></i></button>
                        <button class="btn-action-delete" onclick="app.deleteCustomer('${c.id}')"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>`;
        }).join('');
        this.initLucide();
    },

    /** Cliente cadastrado pelo id (texto), ou null. */
    clientePorId(id) {
        if (id === undefined || id === null || id === '') return null;
        return this.state.customers.find(x => String(x.id) === String(id)) || null;
    },

    /** Abre o recebimento de fiado de um cliente: saldo, vendas em aberto e valor sugerido (saldo total). */
    abrirRecebimentoFiado(customerId) {
        if (this.requirePasswordChange()) return;
        const c = this.clientePorId(customerId);
        if (!c) return;
        const saldo = Fiado.saldoCliente(this.state.sales, c.id);
        if (saldo <= 0) {
            this.showNotification('error', 'Este cliente não tem saldo em aberto.');
            return;
        }
        this.state.fiadoCliente = String(c.id);
        document.getElementById('fiado-valor').value = saldo.toFixed(2);
        document.getElementById('fiado-forma').value = 'dinheiro';
        document.getElementById('fiado-erro').classList.add('hidden');
        this.atualizarModalFiado();
        this.openModal('fiado');
    },

    /** Preenche o modal de Fiado: totais (total, pago, falta), andamento de cada venda e recebimentos. */
    atualizarModalFiado() {
        const c = this.clientePorId(this.state.fiadoCliente);
        if (!c) return;
        const r = Fiado.resumoCliente(this.state.sales, c.id);
        const m = (v) => this.formatCurrency(v);
        document.getElementById('fiado-titulo').textContent = `Receber fiado · ${c.name}`;
        document.getElementById('fiado-total').textContent = m(r.totalPrazo);
        document.getElementById('fiado-pago').textContent = m(r.pago);
        document.getElementById('fiado-saldo').textContent = m(r.falta);
        document.getElementById('fiado-lista').innerHTML = r.vendas.map(v => {
            const data = new Date(v.date).toLocaleDateString('pt-BR');
            const situacao = v.falta > 0 ? `<strong>Falta ${m(v.falta)}</strong>` : '<span class="fiado-quitado">Quitada</span>';
            const orig = this.state.sales.find(s => String(s.id) === String(v.vendaId));
            const venc = orig && orig.vencimento ? orig.vencimento : '';
            const atraso = v.falta > 0 ? Fiado.diasAtraso(venc) : 0;
            const prazo = venc && v.falta > 0
                ? (atraso > 0 ? ` · <span class="fiado-atraso">Atrasada há ${atraso} dia(s)</span>` : ` · <small>Vence ${venc.split('-').reverse().join('/')}</small>`)
                : '';
            return `<div class="fiado-linha fiado-venda"><span>${data} · venda #${this.esc(String(v.vendaId).slice(-6))}${prazo}</span><span>Total ${m(v.total)} · Pago ${m(v.pago)} · ${situacao}</span></div>`;
        }).join('') || '<div class="fiado-linha"><span>Nenhuma venda a prazo.</span></div>';

        const admin = this.state.currentUser?.role === 'admin';
        const operacoes = Fiado.operacoes(this.state.sales, c.id);
        document.getElementById('fiado-recebidos').innerHTML = operacoes.map(o => {
            const data = new Date(o.date).toLocaleDateString('pt-BR');
            const forma = Fiado.NOMES_FORMA[o.forma] || o.forma;
            const estornar = admin
                ? `<button type="button" class="btn-fiado-estornar" onclick="app.estornarRecebimentoFiado('${this.esc(o.operacao)}')">Estornar</button>`
                : '';
            return `<div class="fiado-linha"><span>${data} · ${this.esc(forma)}</span><span><strong>${this.formatCurrency(o.valor)}</strong>${estornar}</span></div>`;
        }).join('') || '<div class="fiado-linha"><span>Nenhum pagamento recebido ainda.</span></div>';

        this.atualizarPreviaFiado();
    },

    /** Abre o extrato do cliente: todas as compras a prazo e pagamentos, mesmo depois de quitado. */
    abrirExtratoFiado(customerId) {
        const c = this.clientePorId(customerId);
        if (!c) return;
        this.state.extratoClienteId = String(c.id);
        this.atualizarExtratoFiado();
        this.openModal('extrato');
    },

    atualizarExtratoFiado() {
        const c = this.clientePorId(this.state.extratoClienteId);
        if (!c) return;
        const e = Fiado.extratoCliente(this.state.sales, c.id);
        const m = (v) => this.formatCurrency(v);
        document.getElementById('extrato-titulo').textContent = `Extrato · ${c.name}`;
        document.getElementById('extrato-total').textContent = m(e.totalPrazo);
        document.getElementById('extrato-pago').textContent = m(e.pago);
        document.getElementById('extrato-falta').textContent = m(e.falta);
        document.getElementById('extrato-lista').innerHTML = e.movimentos.map(x => {
            const data = new Date(x.date).toLocaleDateString('pt-BR');
            if (x.tipo === 'venda') {
                const itens = x.itens ? ` · ${x.itens} ${x.itens === 1 ? 'produto' : 'produtos'}` : '';
                return `<div class="extrato-linha extrato-venda"><span class="extrato-data">${data}</span><span class="extrato-desc">Compra a prazo · venda #${this.esc(String(x.vendaId).slice(-6))}${itens}</span><span class="extrato-valor">+ ${m(x.valor)}</span><span class="extrato-saldo">Saldo ${m(x.saldoApos)}</span></div>`;
            }
            const forma = Fiado.NOMES_FORMA[x.forma] || x.forma;
            return `<div class="extrato-linha extrato-pagamento"><span class="extrato-data">${data}</span><span class="extrato-desc">Pagamento · ${this.esc(forma)}</span><span class="extrato-valor">- ${m(x.valor)}</span><span class="extrato-saldo">Saldo ${m(x.saldoApos)}</span></div>`;
        }).join('') || '<div class="fiado-linha"><span>Nenhuma compra a prazo ainda.</span></div>';
        document.getElementById('extrato-receber').classList.toggle('hidden', e.falta <= 0);
    },

    /** Enquanto digita o valor, mostra quanto fica em aberto depois do recebimento. Não grava nada. */
    atualizarPreviaFiado() {
        const c = this.clientePorId(this.state.fiadoCliente);
        const previa = document.getElementById('fiado-previa');
        const campo = document.getElementById('fiado-valor');
        if (!c || !previa || !campo) return;
        const falta = Fiado.saldoCliente(this.state.sales, c.id);
        const valor = Number(campo.value);
        const r = Fiado.restanteAposRecebimento(falta, valor);
        if (!r.ok) {
            previa.className = 'fiado-previa fiado-previa-erro';
            previa.textContent = r.motivo;
            return;
        }
        previa.className = 'fiado-previa';
        previa.textContent = r.restante > 0
            ? `Recebendo ${this.formatCurrency(valor)}: ficam ${this.formatCurrency(r.restante)} em aberto.`
            : `Recebendo ${this.formatCurrency(valor)}: a conta fica quitada.`;
    },

    /** Estorna uma operação de recebimento inteira (administrador). Pede confirmação antes. */
    estornarRecebimentoFiado(operacao) {
        if (this.requirePasswordChange()) return;
        if (!this.requireAdmin('estornar recebimento de fiado')) return;
        const c = this.clientePorId(this.state.fiadoCliente);
        this.confirmAction(
            'Estornar recebimento',
            'O valor volta para o saldo em aberto das vendas em que foi recebido. Deseja continuar?',
            async () => {
                const resultado = Fiado.estornarRecebimento(this.state.sales, operacao);
                if (!resultado.ok) {
                    this.showNotification('error', resultado.motivo);
                    return;
                }
                this.logAudit('FIADO_ESTORNO', { cliente: c ? c.name : '', clienteId: c ? c.id : null, operacao: operacao, valor: resultado.valor, vendas: resultado.vendas });
                await this.salvarDados();
                this.showNotification('success', `Recebimento de ${this.formatCurrency(resultado.valor)} estornado.`);
                this.atualizarModalFiado();
                this.renderCustomers();
                this.renderHistory();
                this.updateDashboardStats();
                // O confirm fecha os demais modais; reabre o recebimento depois da gravação.
                this.openModal('fiado');
            },
            'trash-2'
        );
    },

    async confirmarRecebimentoFiado() {
        if (this.requirePasswordChange()) return;
        const c = this.clientePorId(this.state.fiadoCliente);
        const erro = document.getElementById('fiado-erro');
        const valor = Number(document.getElementById('fiado-valor').value);
        const forma = document.getElementById('fiado-forma').value;
        const resultado = Fiado.registrarRecebimento(this.state.sales, c ? c.id : '', valor, forma, new Date().toISOString(), 'R' + Date.now());
        if (!resultado.ok) {
            erro.textContent = resultado.motivo;
            erro.classList.remove('hidden');
            return;
        }
        this.logAudit('FIADO_RECEBIMENTO', { cliente: c.name, clienteId: c.id, valor: valor, forma: forma, vendas: resultado.aplicacoes });
        this.state.fiadoCliente = null;
        this.closeModal();
        await this.salvarDados();
        this.showNotification('success', `Recebimento de ${this.formatCurrency(valor)} registrado.`);
        this.renderCustomers();
        this.renderHistory();
        this.updateDashboardStats();
    },

    /** Painel na tela de Clientes: vendas fiado com saldo que ainda não têm cliente (nome repetido ou sem cadastro). */
    renderFiadoPendentes() {
        const box = document.getElementById('fiado-pendentes');
        if (!box) return;
        const pendentes = Fiado.pendentesSemCliente(this.state.sales);
        this.state.fiadoPendentes = pendentes;
        if (pendentes.length === 0) {
            box.classList.add('hidden');
            box.innerHTML = '';
            return;
        }
        const opcoes = this.state.customers.map(c => `<option value="${this.esc(c.id)}">${this.esc(c.name)}</option>`).join('');
        box.innerHTML = `
            <div class="fiado-pendentes-titulo">Fiado sem cliente identificado (${pendentes.length})</div>
            <div class="fiado-pendentes-texto">Estas vendas a prazo não estão ligadas a um cliente, então o saldo não aparece em nenhum cliente. Escolha o cliente correto em cada uma.</div>
            ${pendentes.map((p, i) => `
                <div class="fiado-pendente-linha">
                    <span>${new Date(p.date).toLocaleDateString('pt-BR')} · ${this.esc(p.cliente || 'sem nome')} · <strong>${this.formatCurrency(p.saldo)}</strong></span>
                    <select id="fiado-pend-${i}" class="glass-input-labs">${opcoes}</select>
                    <button type="button" class="btn-fiado-receber" onclick="app.vincularFiadoPendente(${i})">Vincular</button>
                </div>`).join('')}`;
        box.classList.remove('hidden');
    },

    /** Liga uma venda fiado pendente ao cliente escolhido no painel. */
    async vincularFiadoPendente(i) {
        if (this.requirePasswordChange()) return;
        const p = (this.state.fiadoPendentes || [])[i];
        const sel = document.getElementById('fiado-pend-' + i);
        const cliente = sel && sel.value ? this.clientePorId(sel.value) : null;
        const resultado = Fiado.vincular(this.state.sales, p ? p.vendaId : null, cliente);
        if (!resultado.ok) {
            this.showNotification('error', resultado.motivo);
            return;
        }
        this.logAudit('FIADO_VINCULO', { vendaId: p.vendaId, cliente: cliente.name, clienteId: cliente.id, saldo: p.saldo });
        await this.salvarDados();
        this.showNotification('success', `Venda vinculada a ${cliente.name}.`);
        this.renderCustomers();
        this.renderHistory();
        this.updateDashboardStats();
    },

    async deleteCustomer(id) {
        const saldo = Fiado.saldoCliente(this.state.sales, id);
        if (saldo > 0) {
            this.showNotification('error', `Este cliente tem ${this.formatCurrency(saldo)} em aberto. Receba o fiado antes de excluir.`);
            return;
        }
        this.confirmAction(
            'Excluir Cliente',
            'Deseja realmente excluir este cliente?',
            async () => {
                this.state.customers = this.state.customers.filter(c => c.id !== id);
                await this.salvarDados();
                this.showNotification('success', 'Cliente excluído com sucesso!');
                this.renderCustomers();
            },
            'trash-2'
        );
    },

    editCustomer(id) {
        const c = this.state.customers.find(c => c.id === id);
        if (!c) return;

        this.state.editingId = id;
        document.getElementById('cust-name').value = c.name;
        document.getElementById('cust-whatsapp').value = this.formatWhatsApp(c.whatsapp);
        document.getElementById('cust-email').value = c.email || '';
        document.getElementById('cust-obs').value = c.obs || '';
        document.getElementById('cust-image-url').value = c.image || '';
        document.getElementById('cust-limite').value = c.limite_credito ?? '';
        document.getElementById('cust-prazo').value = c.prazo_dias ?? '';

        this.openModal('customer');
    },

    renderHistory() {
        const container = document.getElementById('history-items-container');
        if (!container) return;

        const query = document.getElementById('filter-history')?.value.toLowerCase() || '';
        const dateQuery = document.getElementById('filter-date-history')?.value || '';

        let filtered = this.state.sales.slice().reverse();

        if (query) {
            filtered = filtered.filter(s => {
                const cliente = (s.cliente || s.Cliente || '').toLowerCase();
                const id = (s.id || s.ID || '').toLowerCase();
                return cliente.includes(query) || id.includes(query);
            });
        }

        if (dateQuery) {
            filtered = filtered.filter(s => {
                const date = s.date || s.Data || '';
                const d = this.parseDate(date);
                if (!d) return false;
                return this.chaveDiaLocal(d) === dateQuery;
            });
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-dim);">Nenhuma saída encontrada.</div>';
            return;
        }

        container.innerHTML = filtered.map(s => {
            const id = s.id || s.ID || '';
            const date = s.date || s.Data || '';
            const cliente = s.cliente || s.Cliente || '';
            const subtotal = Number(s.valor_total || s["Valor Total"] || s.total || 0);
            const desconto = Number(s.desconto || s.Desconto || 0);
            const totalFinal = subtotal - desconto;
            const custo = Number(s.cost || s.custo || s.Custo || s.custoTotal || 0);
            const lucro = Number(s.lucro || s.Lucro || (totalFinal - custo));
            const pagamento = this.rotuloPagamento(s);
            const itemsCount = s.items ? s.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0) : 0;
            const nomesItens = (s.items || []).map(it => it.name).filter(Boolean);
            const itensTxt = nomesItens.length
                ? `${nomesItens.length} ${nomesItens.length === 1 ? 'produto' : 'produtos'} · ${itemsCount} un.`
                : 'Sem itens';
            const nomesTxt = nomesItens.length
                ? nomesItens.slice(0, 2).map(n => this.esc(n)).join(', ') + (nomesItens.length > 2 ? ` +${nomesItens.length - 2}` : '')
                : '';


            return `
                <div class="nested-item-labs-row">
                    <span class="col-id" data-label="ID">#${id.toString().slice(-4)}</span>
                    <span class="col-date" data-label="DATA">${this.parseDate(date) ? this.parseDate(date).toLocaleDateString('pt-BR') : 'N/A'}</span>
                    <span class="col-name" data-label="CLIENTE">${this.esc(cliente)}</span>
                    <span class="col-subtotal" data-label="TOTAL">${this.formatCurrency(subtotal)}</span>
                    <span class="col-discount" data-label="DESC.">${this.formatCurrency(desconto)}</span>
                    <span class="col-total-final" data-label="FINAL">${this.formatCurrency(totalFinal)}${this.statusFiadoVendaHtml(s)}</span>
                    <span class="col-cost" data-label="CUSTO">${this.formatCurrency(custo)}</span>
                    <span class="col-profit" data-label="LUCRO">${this.formatCurrency(lucro)}</span>
                    <div class="col-items-action" data-label="ITENS">
                        <div class="itens-resumo">
                            <strong>${itensTxt}</strong>
                            <small>${nomesTxt}</small>
                        </div>
                        <button class="btn-itens-ver" onclick="app.showSaleDetails('${id}')" title="Ver todos os itens"><i class="bx bx-list-ul"></i>Ver</button>
                    </div>
                    <span class="col-payment" data-label="PAGAMENTO">${this.esc(pagamento)}</span>
                    <div class="col-actions" data-label="AÇÕES">
                        <button class="btn-action-edit" title="Editar venda" onclick="app.openSaleEdit('${id}')"><i data-lucide="edit"></i></button>
                        <button class="btn-action-edit" title="Gerar Recibo" onclick="app.openReceiptOptions('${id}')"><i data-lucide="printer"></i></button>
                        <button class="btn-action-delete" title="Excluir Venda" onclick="app.deleteSale('${id}')"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                `;
        }).join('');
        this.initLucide();
    },

    async deleteSale(id) {
        const vendaRef = this.state.sales.find(s => (s.ID || s.id) === id);
        if (vendaRef && Fiado.recebido(vendaRef) > 0) {
            this.showNotification('error', 'Esta venda já tem recebimentos. Não é possível excluí-la.');
            return;
        }
        this.confirmAction(
            'Excluir Venda',
            'Deseja realmente excluir este registro de saída? O estoque dos produtos será estornado automaticamente.',
            async () => {
                this.logAudit('DELETE_SALE', { saleId: id });
                const saleToDelete = this.state.sales.find(s => (s.ID || s.id) === id);

                if (saleToDelete && saleToDelete.items) {
                    // Estorna o estoque
                    saleToDelete.items.forEach(item => {
                        const product = this.state.products.find(p => p.id === item.id);
                        if (product) {
                            // Registra o estorno
                            this.state.reversals.push({
                                id: 'E' + Date.now() + Math.floor(Math.random() * 1000),
                                sale_id: id,
                                product_id: item.id,
                                product_name: item.name,
                                qty: item.qty,
                                date: new Date().toISOString()
                            });
                        }
                    });
                }

                if (saleToDelete) this.registrarMovimentacoes(Estoque.movimentosDoEstorno(saleToDelete));
                this.state.sales = this.state.sales.filter(s => (s.ID || s.id) !== id);
                await this.salvarDados();
                this.showNotification('success', 'Registro de saída excluído e estoque estornado com sucesso!');
                this.renderHistory();
                this.updateDashboardStats();
            },
            'trash-2'
        );
    },

    // ===== Edição de venda registrada (regras puras em edicao_venda.js) =====
    vendaEmEdicao() {
        const id = this.state.saleEditId;
        if (!id) return null;
        return this.state.sales.find(s => String(s.id || s.ID) === String(id)) || null;
    },

    openSaleEdit(saleId) {
        const sale = this.state.sales.find(s => String(s.id || s.ID) === String(saleId));
        if (!sale || !Array.isArray(sale.items) || sale.items.length === 0) {
            this.showNotification('error', 'Venda não encontrada ou sem itens.');
            return;
        }
        this.state.saleEditId = String(sale.id || sale.ID);

        // Select por id do cliente. '' = Consumidor Final; '__atual__' = nome antigo que não tem cadastro único.
        const clienteSel = document.getElementById('sale-edit-cliente');
        const opcoesCliente = ['<option value="">Consumidor Final</option>'];
        this.state.customers.forEach(c => opcoesCliente.push(`<option value="${this.esc(c.id)}">${this.esc(c.name)}</option>`));
        let valorCliente = '';
        if (this.clientePorId(Fiado.clienteIdDe(sale))) {
            valorCliente = Fiado.clienteIdDe(sale);
        } else if (sale.cliente && sale.cliente !== 'Consumidor Final') {
            const iguais = this.state.customers.filter(c => c.name === sale.cliente);
            if (iguais.length === 1) {
                valorCliente = String(iguais[0].id);
            } else {
                opcoesCliente.push(`<option value="__atual__">${this.esc(sale.cliente)} (sem cadastro)</option>`);
                valorCliente = '__atual__';
            }
        }
        clienteSel.innerHTML = opcoesCliente.join('');
        clienteSel.value = valorCliente;

        const nomesForma = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'PIX', fiado: 'Fiado (a prazo)' };
        const misto = Array.isArray(sale.pagamentos) && sale.pagamentos.length > 0;
        const comRecebimento = Fiado.recebido(sale) > 0;
        const formas = comRecebimento ? ['fiado'] : [...EdicaoVenda.FORMAS, 'fiado'];
        const pagSel = document.getElementById('sale-edit-pagamento');
        pagSel.innerHTML = (misto ? '<option value="manter">Manter pagamento dividido</option>' : '')
            + formas.map(f => `<option value="${f}">${nomesForma[f]}</option>`).join('');
        pagSel.value = misto ? 'manter' : (formas.includes(sale.pagamento) ? sale.pagamento : 'dinheiro');

        document.getElementById('sale-edit-desconto').value = Number(sale.desconto) || 0;
        document.getElementById('sale-edit-title').textContent = `Editar venda #${String(sale.id || sale.ID).slice(-6)}`;

        document.getElementById('sale-edit-items').innerHTML = sale.items.map((item, i) => `
            <div class="sale-edit-row">
                <div class="sale-edit-nome">
                    ${this.esc(item.name || 'Produto')}
                    <small>${this.formatCurrency(Number(item.price) || 0)} cada</small>
                </div>
                <input type="number" class="glass-input-labs sale-edit-qty" min="0" step="1" inputmode="numeric"
                       value="${Number(item.qty) || 0}" data-idx="${i}" oninput="app.atualizarTotaisEdicaoVenda()">
                <div class="sale-edit-sub" data-sub="${i}"></div>
            </div>`).join('');

        this.mostrarErroEdicaoVenda('');
        this.atualizarTotaisEdicaoVenda();
        this.openModal('sale-edit-modal');
        this.initLucide();
    },

    mostrarErroEdicaoVenda(msg) {
        const el = document.getElementById('sale-edit-erro');
        if (!el) return;
        el.textContent = msg || '';
        el.classList.toggle('hidden', !msg);
    },

    lerQuantidadesEdicao() {
        return Array.from(document.querySelectorAll('#sale-edit-items .sale-edit-qty'))
            .map(inp => (inp.value === '' ? NaN : Number(inp.value)));
    },

    atualizarTotaisEdicaoVenda() {
        const sale = this.vendaEmEdicao();
        const totaisEl = document.getElementById('sale-edit-totais');
        if (!sale || !totaisEl) return;

        const qtds = this.lerQuantidadesEdicao();
        qtds.forEach((q, i) => {
            const sub = document.querySelector(`#sale-edit-items [data-sub="${i}"]`);
            const price = Number(sale.items[i].price) || 0;
            if (sub) sub.textContent = this.formatCurrency(price * (Number.isFinite(q) ? q : 0));
        });

        const desconto = Number(document.getElementById('sale-edit-desconto').value) || 0;
        try {
            const t = EdicaoVenda.recalcularVenda(sale, qtds, desconto);
            totaisEl.innerHTML = `
                <div><span>Subtotal</span><span>${this.formatCurrency(t.valor_total)}</span></div>
                <div><span>Desconto</span><span>- ${this.formatCurrency(t.desconto)}</span></div>
                <div class="total"><span>Total da venda</span><span>${this.formatCurrency(t.valor_final)}</span></div>`;
        } catch (e) {
            totaisEl.innerHTML = `<div class="sale-edit-aviso">${this.esc(e.message)}</div>`;
        }
    },

    async salvarEdicaoVenda() {
        const sale = this.vendaEmEdicao();
        if (!sale) {
            this.mostrarErroEdicaoVenda('Venda não encontrada.');
            return;
        }

        const qtds = this.lerQuantidadesEdicao();
        const desconto = Number(document.getElementById('sale-edit-desconto').value) || 0;
        const escolhaCliente = document.getElementById('sale-edit-cliente').value;
        const cadastro = escolhaCliente && escolhaCliente !== '__atual__' ? this.clientePorId(escolhaCliente) : null;
        const cliente = cadastro ? cadastro.name : (escolhaCliente === '__atual__' ? sale.cliente : 'Consumidor Final');
        const clienteId = cadastro ? String(cadastro.id) : '';
        const escolha = document.getElementById('sale-edit-pagamento').value;

        let totais, pag, plano;
        try {
            totais = EdicaoVenda.recalcularVenda(sale, qtds, desconto);
            if (escolha === 'fiado' || Fiado.recebido(sale) > 0) {
                const checagem = Fiado.validarEdicao(sale, totais.valor_final, escolha, clienteId);
                if (!checagem.ok) throw new Error(checagem.motivo);
                if (Fiado.recebido(sale) > 0 && clienteId !== Fiado.clienteIdDe(sale)) {
                    throw new Error('Esta venda já tem recebimentos: não é possível trocar o cliente.');
                }
                if (escolha === 'fiado') {
                    const limite = Fiado.validarLimiteEdicao(this.state.sales, sale, clienteId, cadastro ? cadastro.limite_credito : null, totais.valor_final);
                    if (!limite.ok) throw new Error(`${limite.motivo} Disponível para fiado: ${this.formatCurrency(limite.disponivel)}.`);
                }
            }
            pag = escolha === 'fiado'
                ? { pagamento: 'fiado' }
                : EdicaoVenda.pagamentoAposEdicao(sale, totais.valor_final, escolha);
            plano = EdicaoVenda.planejarEdicao(this.state.movimentacoes, sale, qtds);
        } catch (e) {
            this.mostrarErroEdicaoVenda(e.message);
            return;
        }

        if (!plano.ok) {
            const lista = plano.problemas.map(p => `${p.nome}: faltam ${p.falta} un.`).join(' · ');
            this.mostrarErroEdicaoVenda('Estoque insuficiente para aumentar esta venda. ' + lista);
            return;
        }

        const itensAntes = sale.items.map(it => ({ id: it.id, qty: it.qty }));
        const saleId = sale.id || sale.ID;

        // Tudo validado: aplica estoque (movimentações) e a venda
        this.registrarMovimentacoes(plano.novas);
        Object.assign(sale, {
            items: totais.items,
            valor_total: totais.valor_total,
            desconto: totais.desconto,
            valor_final: totais.valor_final,
            cost: totais.cost,
            lucro: totais.lucro,
            cliente: cliente
        });
        delete sale.pagamentos;
        delete sale.troco;
        Object.assign(sale, pag);
        if (escolha === 'fiado') sale.cliente_id = clienteId;
        else delete sale.cliente_id;

        this.logAudit('EDIT_SALE', {
            saleId: saleId,
            itensAntes: itensAntes,
            itensDepois: totais.items.map(it => ({ id: it.id, qty: it.qty })),
            desconto: totais.desconto,
            pagamento: pag.pagamento
        });

        this.state.saleEditId = null;
        this.closeModal();
        await this.salvarDados();
        this.showNotification('success', 'Venda editada e estoque ajustado.');
        this.renderHistory();
        this.updateDashboardStats();
    },

    openStockAlerts() {
        const container = document.getElementById('stock-alerts-list');
        const alerts = this.state.products.filter(p => p.stock < 50);

        if (alerts.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">Nenhum alerta de estoque no momento.</div>';
        } else {
            container.innerHTML = alerts.map(p => {
                const isCritical = p.stock < 20;
                const status = isCritical ? 'Crítico' : 'Médio';
                const iconClass = isCritical ? 'critical' : 'medium';
                const iconName = isCritical ? 'alert-triangle' : 'alert-circle';

                return `
                    <div class="stock-alert-item" onclick="app.goToProductAdjust('${p.id}')" style="cursor: pointer;">
                        <div class="stock-alert-icon ${iconClass}">
                            <i data-lucide="${iconName}"></i>
                        </div>
                        <div class="stock-alert-info">
                            <span class="stock-alert-name">${p.name}</span>
                            <span class="stock-alert-status">${status}: <b>${p.stock} un</b></span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        this.openModal('stock-alerts');
        this.initLucide();
    },

    goToProductAdjust(id) {
        this.closeModal(); // Fecha o modal de alertas
        this.switchView('products'); // Vai para a aba de produtos
        setTimeout(() => {
            // Nota: openStockAdjust deve estar implementado ou ser chamado via editProduct
            this.editProduct(id);
        }, 300);
    },

    updateNotifications() {
        const badge = document.getElementById('notification-badge');
        const list = document.getElementById('notification-list');
        if (!badge || !list) return;

        // Notificações administrativas (estoque/configurações) são restritas a administradores
        if (this.state.currentUser && this.state.currentUser.role !== 'admin') {
            this._notifLista = [];
            badge.classList.add('hidden');
            this.renderNotifPage();
            return;
        }

        const notifications = [];
        const nSettings = this.state.settings.notifications || {
            stockLow: true,
            stockMedium: true,
            settingsIncomplete: true,
            stockLowVal: 10,
            stockMediumVal: 25
        };

        const lowLevel = nSettings.stockLowVal || 10;
        const mediumLevel = nSettings.stockMediumVal || 25;

        // 1. Estoque Baixo e Médio
        this.state.products.forEach(p => {
            if (p.stock < lowLevel && nSettings.stockLow !== false) {
                notifications.push({
                    type: 'stock-low',
                    level: 'red',
                    title: 'Estoque Baixo!',
                    desc: `${p.name} está com apenas ${p.stock} unidades.`,
                    icon: 'alert-triangle',
                    action: () => {
                        this.switchView('products');
                        setTimeout(() => this.adjustStock(p.id, 2), 300);
                    }
                });
            } else if (p.stock < mediumLevel && nSettings.stockMedium !== false) {
                notifications.push({
                    type: 'stock-medium',
                    level: 'yellow',
                    title: 'Estoque Médio',
                    desc: `${p.name} está com ${p.stock} unidades.`,
                    icon: 'alert-circle',
                    action: () => {
                        this.switchView('products');
                        setTimeout(() => this.adjustStock(p.id, 2), 300);
                    }
                });
            }
        });

        // 2. Configurações Incompletas
        if (nSettings.settingsIncomplete !== false) {
            const s = this.state.settings;
            const missingFields = [];
            if (!s.companyName) missingFields.push('Razão Social');
            if (!s.ownerName) missingFields.push('Responsável');
            if (!s.whatsapp) missingFields.push('WhatsApp');
            if (!s.email) missingFields.push('E-mail');
            if (!s.address) missingFields.push('Endereço');

            if (missingFields.length > 0) {
                notifications.push({
                    type: 'settings-incomplete',
                    level: 'blue',
                    title: 'Configurações Incompletas',
                    desc: `Campos essenciais pendentes: ${missingFields.join(', ')}. Preencha para emitir recibos.`,
                    icon: 'settings',
                    action: () => {
                        this.switchView('settings');
                    }
                });
            }
        }

        // Renderizar: cartões ordenados por gravidade, com paginação
        const ordemNivel = { red: 0, yellow: 1, blue: 2 };
        this._notifLista = notifications.slice().sort((x, y) => (ordemNivel[x.level] ?? 9) - (ordemNivel[y.level] ?? 9));
        const total = this._notifLista.length;
        if (total > 0) {
            badge.textContent = total;
            badge.classList.remove('hidden');
            if (notifications.some(n => n.level === 'red')) {
                badge.style.background = '#d64545';
            } else if (notifications.some(n => n.level === 'yellow')) {
                badge.style.background = '#e0a100';
            } else {
                badge.style.background = '#8a9099';
            }
        } else {
            badge.classList.add('hidden');
        }
        this._notifPagina = this._notifPagina || 1;
        this.renderNotifPage();
    },

    renderNotifPage() {
        const list = document.getElementById('notification-list');
        const pager = document.getElementById('notification-pager');
        if (!list) return;
        const lista = this._notifLista || [];
        const total = lista.length;
        if (total === 0) {
            list.innerHTML = '<div class="empty-notif-msg">Sem novas notificações</div>';
            if (pager) pager.innerHTML = '';
            return;
        }
        const porPagina = this.config.notifPorPagina || 4;
        const paginas = Math.max(1, Math.ceil(total / porPagina));
        this._notifPagina = Math.min(Math.max(1, this._notifPagina), paginas);
        const ini = (this._notifPagina - 1) * porPagina;
        const pagina = lista.slice(ini, ini + porPagina);
        const rotulos = { red: 'Crítico', yellow: 'Atenção', blue: 'Informação' };
        list.innerHTML = pagina.map((n, i) => `
            <div class="notification-item notif-${n.level}" data-notif="${ini + i}">
                <div class="notif-icon ${n.level}"><i data-lucide="${n.icon}"></i></div>
                <div class="notif-content">
                    <div class="notif-topo">
                        <span class="notif-title">${this.esc(n.title)}</span>
                        <span class="notif-tag ${n.level}">${rotulos[n.level] || 'Aviso'}</span>
                    </div>
                    <span class="notif-desc">${this.esc(n.desc)}</span>
                </div>
            </div>
        `).join('');
        list.onclick = (e) => {
            const el = e.target.closest('[data-notif]');
            if (!el) return;
            const n = this._notifLista[Number(el.dataset.notif)];
            if (!n || !n.action) return;
            n.action();
            document.getElementById('notification-dropdown').classList.add('hidden');
        };
        if (pager) {
            pager.innerHTML = paginas > 1
                ? `<button type="button" class="notif-page-btn" data-pag="-1" ${this._notifPagina === 1 ? 'disabled' : ''}>&lsaquo; Anterior</button>
                   <span class="notif-page-info">${this._notifPagina} de ${paginas}</span>
                   <button type="button" class="notif-page-btn" data-pag="1" ${this._notifPagina === paginas ? 'disabled' : ''}>Próxima &rsaquo;</button>`
                : `<span class="notif-page-info">${total} alerta${total > 1 ? 's' : ''}</span>`;
            pager.onclick = (e) => {
                const b = e.target.closest('[data-pag]');
                if (!b || b.disabled) return;
                this._notifPagina += Number(b.dataset.pag);
                this.renderNotifPage();
            };
        }
        this.initLucide();
    },

    // --- Utils & Modals ---
    confirmAction(title, message, onConfirm, icon = 'help-circle') {
        const titleEl = document.getElementById('confirm-modal-title');
        const msgEl = document.getElementById('confirm-modal-msg');
        const iconEl = document.getElementById('confirm-modal-icon');
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (iconEl) iconEl.setAttribute('data-lucide', icon);

        this.initLucide();

        if (okBtn) {
            okBtn.style.display = '';
            okBtn.textContent = 'Confirmar';
            okBtn.onclick = () => {
                onConfirm();
                this.closeModal();
            };
        }

        // Resetar botão cancelar para apenas fechar o modal
        if (cancelBtn) {
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.onclick = () => this.closeModal();
        }

        this.openModal('generic-confirm');
    },

    showAlert(title, message, icon = 'alert-circle') {
        const titleEl = document.getElementById('alert-modal-title');
        const msgEl = document.getElementById('alert-modal-msg');
        const iconEl = document.getElementById('alert-modal-icon');

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = message;
        if (iconEl) iconEl.setAttribute('data-lucide', icon);

        this.initLucide();
        this.openModal('generic-alert');
    },

    parseDate(dateVal) {
        if (!dateVal) return null;

        // Se for uma string ISO ou algo que o JS entenda
        let d = new Date(dateVal);

        // Se falhou e for um número (formato de data do Excel)
        if (isNaN(d.getTime()) && !isNaN(parseFloat(dateVal))) {
            // Excel começa em 30/12/1899 para OLE Automation dates
            const excelDate = parseFloat(dateVal);
            d = new Date((excelDate - 25569) * 86400 * 1000);
        }

        return isNaN(d.getTime()) ? null : d;
    },

    formatCurrency(v) { 
        const val = parseFloat(v) || 0;
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val); 
    },
    formatWhatsApp(v) {
        if (!v) return '';
        const numbers = String(v).replace(/\D/g, '');
        if (numbers.length === 11) {
            return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
        } else if (numbers.length === 10) {
            return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
        }
        return v;
    },

    // --- Validation Helper ---
    validate(data, schema) {
        for (const [key, rules] of Object.entries(schema)) {
            const value = data[key];
            if (rules.required && (value === undefined || value === null || value === '')) {
                throw new Error(`O campo ${rules.label || key} é obrigatório.`);
            }
            if (rules.type === 'number' && isNaN(parseFloat(value))) {
                throw new Error(`O campo ${rules.label || key} deve ser um número válido.`);
            }
            if (rules.min !== undefined && parseFloat(value) < rules.min) {
                throw new Error(`O campo ${rules.label || key} deve ser no mínimo ${rules.min}.`);
            }
        }
        return true;
    },

    openModal(type) {
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('hidden');

        // No tutorial, queremos manter o modal de tutorial visível enquanto mostramos outros popups
        const isTutorial = this.state.tutorialStep > 0 || type === 'tutorial';
        overlay.classList.toggle('tutorial-active', isTutorial);

        // Adiciona classe ao container principal para ajudar no CSS de destaque
        const { appContainer } = this.getDOMRefs();
        if (appContainer) {
            appContainer.classList.toggle('tutorial-running', isTutorial);
        }

        document.getElementById('product-modal').classList.toggle('hidden', type !== 'product');
        document.getElementById('customer-modal').classList.toggle('hidden', type !== 'customer');
        document.getElementById('stock-modal').classList.toggle('hidden', type !== 'stock');
        document.getElementById('receipt-confirm-modal').classList.toggle('hidden', type !== 'receipt-confirm');
        document.getElementById('generic-confirm-modal').classList.toggle('hidden', type !== 'generic-confirm');
        document.getElementById('generic-alert-modal').classList.toggle('hidden', type !== 'generic-alert');

        // O tutorial modal só fica oculto se não estivermos no modo tutorial
        document.getElementById('tutorial-modal').classList.toggle('hidden', !isTutorial);

        const saleDetailsModal = document.getElementById('sale-details-modal');
        if (saleDetailsModal) saleDetailsModal.classList.toggle('hidden', type !== 'sale-details-modal');

        const saleEditModal = document.getElementById('sale-edit-modal');
        if (saleEditModal) saleEditModal.classList.toggle('hidden', type !== 'sale-edit-modal');

        const alertsModal = document.getElementById('stock-alerts-modal');
        if (alertsModal) alertsModal.classList.toggle('hidden', type !== 'stock-alerts');

        const confirmRemoveLogo = document.getElementById('confirm-remove-logo');
        if (confirmRemoveLogo) confirmRemoveLogo.classList.toggle('hidden', type !== 'confirm-remove-logo');

        const backupModal = document.getElementById('backup-modal');
        if (backupModal) backupModal.classList.toggle('hidden', type !== 'backup');

        const confirmImportBackup = document.getElementById('confirm-import-backup');
        if (confirmImportBackup) confirmImportBackup.classList.toggle('hidden', type !== 'confirm-import-backup');

        const userModal = document.getElementById('user-modal');
        if (userModal) userModal.classList.toggle('hidden', type !== 'user-modal');

        const categoriesModal = document.getElementById('categories-modal');
        if (categoriesModal) categoriesModal.classList.toggle('hidden', type !== 'categories');

        const entradaModal = document.getElementById('entrada-modal');
        if (entradaModal) entradaModal.classList.toggle('hidden', type !== 'entrada-modal');

        const entradaDetailsModal = document.getElementById('entrada-details-modal');
        if (entradaDetailsModal) entradaDetailsModal.classList.toggle('hidden', type !== 'entrada-details-modal');

        const historyModal = document.getElementById('product-history-modal');
        if (historyModal) historyModal.classList.toggle('hidden', type !== 'product-history-modal');

        const fiadoModal = document.getElementById('fiado-modal');
        if (fiadoModal) fiadoModal.classList.toggle('hidden', type !== 'fiado');

        const extratoModal = document.getElementById('extrato-modal');
        if (extratoModal) extratoModal.classList.toggle('hidden', type !== 'extrato');

        this.initLucide();

        // Reset form if not editing and not stock adjustment
        if (!this.state.editingId && (type === 'product' || type === 'customer' || type === 'user-modal')) {
            const formId = type === 'product' ? 'product-form' : (type === 'customer' ? 'customer-form' : 'user-form');
            const form = document.getElementById(formId);
            if (form) form.reset();

            if (type === 'product') {
                document.getElementById('prod-image-url').value = '';
                this.updatePhotoPreview(null);
                this.populateCategorySelect();
            }

            if (type === 'user-modal') {
                document.getElementById('user-password').required = true;
                document.getElementById('user-confirm-password').required = true;
            }
        }

        if (type === 'stock') {
            document.getElementById('stock-qty-add').focus();
        }

        this.initLucide();
    },
    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.add('hidden');
        overlay.classList.remove('tutorial-active');

        const { appContainer } = this.getDOMRefs();
        if (appContainer) {
            appContainer.classList.remove('tutorial-running');
        }

        this.state.editingId = null;
        this.state.tutorialStep = 0;

        // Restaurar textos padrão dos botões do modal genérico 
        const okBtn = document.getElementById('confirm-modal-ok');
        const cancelBtn = document.getElementById('confirm-modal-cancel');
        if (okBtn) {
            okBtn.style.display = '';
            okBtn.textContent = 'Confirmar';
            okBtn.onclick = null;
        }
        if (cancelBtn) {
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.onclick = () => this.closeModal();
        }

        // Garantir que todos os modais internos estejam escondidos
        const modals = ['product-modal', 'customer-modal', 'stock-modal', 'receipt-confirm-modal', 'tutorial-modal', 'stock-alerts-modal', 'sale-details-modal', 'sale-edit-modal', 'confirm-remove-logo', 'backup-modal', 'categories-modal', 'user-modal', 'generic-confirm-modal', 'generic-alert-modal', 'product-history-modal'];
        modals.forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });
    },
    renderAll() { 
        const queryAtiva = document.getElementById('filter-products')?.value || '';
        const categoriaAtiva = document.getElementById('filter-category')?.value || '';
        
        // Atualizar selects de categoria
        this.populateCategorySelect();
        this.updateCategoryFilter();

        this.renderProducts(queryAtiva, categoriaAtiva); 
        this.renderProductExits(); 
        this.renderCustomers(); 
        this.renderHistory(); 
        this.updateDashboardStats(); 
    },
    updatePOSCustomerList() {
        const select = document.getElementById('pos-customer');
        if (select) select.innerHTML = '<option value="">Consumidor Final</option>' + this.state.customers.map(c => `<option value="${this.esc(c.id)}">${this.esc(c.name)}</option>`).join('');
    },
    updatePOSProductList() {
        this.renderPosCatalog();
    },

    openReceiptOptions(id) {
        const sale = this.state.sales.find(s => (s.id || s.ID) === id);
        if (!sale) {
            this.showNotification('error', 'Venda não encontrada.');
            return;
        }

        this.state.pendingSale = sale;

        // Ajustar modal para modo "Reimpressão"
        document.getElementById('receipt-modal-title').textContent = 'Recibo de Venda';
        document.getElementById('receipt-modal-msg-primary').textContent = `Venda #${id.toString().slice(-6)}`;

        this.openModal('receipt-confirm');
    },

    // --- Tutorial Logic ---
    startTutorial() {
        this.state.tutorialStep = 0;
        this.openModal('tutorial');
        this.updateTutorialContent();
    },

    nextTutorialStep() {
        this.state.tutorialStep++;
        const { steps } = this.getTutorialDefinition();
        if (this.state.tutorialStep >= steps.length) {
            this.closeTutorial();
            return;
        }
        this.updateTutorialContent();
    },

    getTutorialDefinition() {
        const role = this.state.currentUser?.role || 'operador';
        const isAdmin = role === 'admin';

        const adminSteps = [
            {
                title: 'Bem-vindo ao SV Ultra',
                desc: 'Este tutorial passa por todas as áreas do sistema e pelos recursos principais. Clique em "Começar" para iniciar.',
                icon: 'help-circle',
                view: 'pos',
                highlight: ['button[data-view="pos"]']
            },
            {
                title: 'Navegação (menu lateral)',
                desc: 'Use o menu lateral para alternar entre as áreas: PDV, Produtos, Estoque, Clientes, Saídas e Entradas.',
                icon: 'layout-dashboard',
                view: 'pos',
                highlight: ['.sidebar .nav-links']
            },
            {
                title: 'Barra superior (tema e alertas)',
                desc: 'Aqui você alterna o tema e vê notificações do sistema (ex.: estoque baixo e alertas de configuração).',
                icon: 'sun',
                view: 'pos',
                highlight: ['#btn-theme-toggle', '#btn-notifications']
            },
            {
                title: 'Dashboard: leitura rápida',
                desc: 'Acompanhe os indicadores principais e a evolução do negócio em tempo real.',
                icon: 'layout-grid',
                view: 'pos',
                highlight: ['#dashboard-view .stats-grid-labs']
            },
            {
                title: 'Dashboard: filtros do gráfico',
                desc: 'No gráfico "Evolução de Vendas", alterne o conjunto de dados (Faturamento/Lucro/Custo) e o período para comparar resultados.',
                icon: 'line-chart',
                view: 'pos',
                highlight: ['.chart-dataset-toggles', '.dash-filter-group']
            },
            {
                title: 'PDV: montar a venda',
                desc: 'Clique no produto para adicionar, ou use o leitor de código de barras. F2 foca a busca.',
                icon: 'shopping-bag',
                view: 'pos',
                highlight: ['#pos-barcode', '#pos-product-grid']
            },
            {
                title: 'PDV: cliente e pagamento',
                desc: 'O cliente é opcional: sem seleção, a venda vai como Consumidor Final. Escolha o pagamento e, em dinheiro, informe o valor pago para o troco.',
                icon: 'credit-card',
                view: 'pos',
                highlight: ['#pos-customer', '.pos-pay-buttons', '#pos-discount', '#pos-paid-group', '#pos-change-row']
            },
            {
                title: 'PDV: finalizar e imprimir',
                desc: 'Finalize a venda e escolha imprimir o recibo A4. A impressão foi preparada para funcionar bem com muitos itens.',
                icon: 'printer',
                view: 'pos',
                highlight: ['#btn-finish-sale']
            },
            {
                title: 'Clientes: cadastro e busca',
                desc: 'Cadastre clientes e use a busca para localizar rapidamente. Isso agiliza a seleção no PDV.',
                icon: 'users',
                view: 'customers',
                highlight: ['#filter-customers', '#customers-view .btn-save']
            },
            {
                title: 'Produtos: cadastro e filtros',
                desc: 'Cadastre produtos com custo, preço e estoque. Use filtros de texto e categoria para encontrar itens rapidamente.',
                icon: 'box',
                view: 'products',
                highlight: ['#filter-products', '#filter-category', '#products-view .btn-save']
            },
            {
                title: 'Produtos: ações e estoque',
                desc: 'Edite e exclua itens com cuidado. Ajustes rápidos de estoque permitem corrigir entradas/saídas sem abrir a edição.',
                icon: 'edit',
                view: 'products',
                highlight: ['#products-items-container']
            },
            {
                title: 'Entradas: compras/estoque',
                desc: 'Registre entradas (fornecedor, nota, itens e custo). Isso ajuda a manter o estoque atualizado.',
                icon: 'package-plus',
                view: 'entradas',
                highlight: ['#entradas-view .btn-save']
            },
            {
                title: 'Saídas: histórico de vendas',
                desc: 'Veja as vendas realizadas, filtre por cliente/data, reimprima recibos e faça correções de estoque (quando aplicável).',
                icon: 'receipt',
                view: 'history',
                highlight: ['#history-view']
            },
            {
                title: 'Configurações: visão geral',
                desc: 'Em Configurações você gerencia Empresa, Usuários, Notificações, Aparência, Ferramentas, Categorias e relatórios administrativos.',
                icon: 'settings',
                view: 'settings',
                highlight: ['.sv-settings-menu']
            },
            {
                title: 'Configurações: Empresa (logo e dados)',
                desc: 'Defina nome da empresa, contato e endereço. A logo aparece no topo e nos relatórios.',
                icon: 'building-2',
                view: 'settings',
                settingsSection: 'empresa',
                highlight: ['#sv-section-empresa']
            },
            {
                title: 'Configurações: Usuários e permissões',
                desc: 'Crie usuários, defina perfil (Administrador/Operador) e gerencie senhas. Usuários e senhas não vão no backup.',
                icon: 'user-cog',
                view: 'settings',
                settingsSection: 'usuarios',
                highlight: ['#sv-section-usuarios']
            },
            {
                title: 'Configurações: Notificações',
                desc: 'Ajuste alertas (estoque crítico/médio e configurações incompletas) conforme sua operação.',
                icon: 'bell',
                view: 'settings',
                settingsSection: 'notificacoes',
                highlight: ['#sv-section-notificacoes']
            },
            {
                title: 'Configurações: Ferramentas (tutorial e backup)',
                desc: 'Em Ferramentas você pode abrir o tutorial e gerenciar backup (exportar/importar dados e imagens).',
                icon: 'wrench',
                view: 'settings',
                settingsSection: 'ferramentas',
                highlight: ['#start-tutorial', '#open-backup-modal']
            },
            {
                title: 'Produtos: categorias',
                desc: 'Crie categorias pelo botão Categorias em Produtos, ou direto no cadastro do produto.',
                icon: 'tag',
                view: 'products',
                highlight: ['#btn-open-categories']
            },
            {
                title: 'Encerrar o sistema',
                desc: 'Ao finalizar suas atividades, use o botão "Sair" para fechar com segurança.',
                icon: 'log-out',
                view: 'pos',
                highlight: ['#btn-exit-app']
            }
        ];

        const operatorSteps = [
            {
                title: 'Bem-vindo ao SV Ultra (Operação)',
                desc: 'Este tutorial cobre todas as áreas disponíveis para o perfil Operador e também explica as áreas administrativas.',
                icon: 'help-circle',
                view: 'pos',
                highlight: ['button[data-view="pos"]']
            },
            {
                title: 'PDV: montar a venda',
                desc: 'Clique no produto para adicionar, ou use o leitor de código de barras. Ajuste a quantidade no carrinho.',
                icon: 'shopping-bag',
                view: 'pos',
                highlight: ['#pos-barcode', '#pos-product-grid']
            },
            {
                title: 'PDV: pagamento e finalização',
                desc: 'Informe pagamento, desconto e finalize a venda. Em dinheiro, informe o valor pago para calcular o troco. Para pagar em mais de uma forma, use Dividir pagamento.',
                icon: 'printer',
                view: 'pos',
                highlight: ['.pos-pay-buttons', '#pos-discount', '#pos-paid-group', '#btn-finish-sale']
            },
            {
                title: 'Clientes: cadastro e busca',
                desc: 'Cadastre clientes e use a busca para agilizar atendimentos no PDV.',
                icon: 'users',
                view: 'customers',
                highlight: ['#filter-customers']
            },
            {
                title: 'Saídas: histórico de vendas',
                desc: 'Consulte vendas, filtre por data/cliente e reimprima recibos quando necessário.',
                icon: 'receipt',
                view: 'history',
                highlight: ['#history-view']
            },
            {
                title: 'Áreas administrativas (somente Admin)',
                desc: 'Algumas áreas exigem perfil Administrador: Dashboard, Produtos, Entradas e Configurações (Empresa/Usuários/Backup/Categorias).',
                icon: 'shield-check',
                highlight: ['#topbar-user-profile']
            },
            {
                title: 'Encerrar o sistema',
                desc: 'Ao finalizar suas atividades, use o botão "Sair".',
                icon: 'log-out',
                highlight: ['#btn-exit-app']
            }
        ];

        const lista = isAdmin ? adminSteps : operatorSteps;
        // Sem login, a seção de usuários não existe: o passo correspondente sai do tutorial
        return { steps: this.config.loginAtivo ? lista : lista.filter(s => s.settingsSection !== 'usuarios') };
    },

    updateTutorialContent() {
        const titleEl = document.getElementById('tutorial-title');
        const descEl = document.getElementById('tutorial-description');
        const stepNumEl = document.getElementById('current-step-num');
        const nextBtn = document.getElementById('tutorial-next-btn');
        const iconEl = document.getElementById('tutorial-step-icon');

        const { steps } = this.getTutorialDefinition();
        const step = steps[this.state.tutorialStep];
        if (!step) return;

        titleEl.textContent = step.title;
        descEl.textContent = step.desc;

        const current = this.state.tutorialStep + 1;
        const total = steps.length;
        const indicator = document.querySelector('.tutorial-steps-indicator');
        stepNumEl.textContent = String(current);
        if (indicator) indicator.innerHTML = `<span id="current-step-num">${current}</span>/${total}`;
        nextBtn.textContent = this.state.tutorialStep === 0 ? 'Começar' : (this.state.tutorialStep === total - 1 ? 'Finalizar' : 'Próximo');

        iconEl.setAttribute('data-lucide', step.icon);
        this.initLucide();

        if (step.view) {
            this.switchView(step.view);
        }

        // Gerenciar Destaques do Tutorial (com pequeno atraso para garantir renderização)
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('dark-highlight');
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));

        setTimeout(() => {
            if (step.settingsSection && step.view === 'settings') {
                this.switchSettingsSection(step.settingsSection);
            }

            const selectors = Array.isArray(step.highlight) ? step.highlight : [];
            const highlighted = [];

            selectors.forEach(sel => {
                try {
                    const el = document.querySelector(sel);
                    if (el) {
                        el.classList.add('tutorial-highlight');
                        highlighted.push(el);
                    }
                } catch (_) {
                }
            });

            overlay.classList.toggle('dark-highlight', highlighted.length > 0);
            this.updateTutorialSpotlight();
        }, step.view === 'settings' ? 250 : 120);
    },

    closeTutorial() {
        const overlay = document.getElementById('modal-overlay');
        overlay.classList.remove('dark-highlight');
        overlay.style.setProperty('--spotlight-path', 'none');
        document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
        this.closeModal();
    },

    updateTutorialSpotlight() {
        const overlay = document.getElementById('modal-overlay');
        const highlights = document.querySelectorAll('.tutorial-highlight');
        const { appContainer } = this.getDOMRefs();

        if (highlights.length === 0 || !overlay.classList.contains('dark-highlight')) {
            overlay.style.setProperty('--spotlight-path', 'none');
            return;
        }

        const containerRect = appContainer.getBoundingClientRect();

        // Inicia o polígono do clip-path (caixa externa)
        // Usamos uma técnica de polígono invertido para criar furos
        let path = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%';

        highlights.forEach(el => {
            const rect = el.getBoundingClientRect();

            // Calcular coordenadas relativas ao app-container
            const l = (rect.left - containerRect.left) - 4; // -4 para margem de respiro
            const t = (rect.top - containerRect.top) - 4;
            const r = (rect.right - containerRect.left) + 4;
            const b = (rect.bottom - containerRect.top) + 4;

            // Adiciona o furo ao polígono
            path += `, ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px, 0% 0%`;
        });

        path += ')';
        overlay.style.setProperty('--spotlight-path', path);
    },

    // --- Módulo de Entradas ---
    openNovaEntrada() {
        this.entradaItemsTemp = [];
        const form = document.getElementById('entrada-form');
        if (form) form.reset();

        const select = document.getElementById('entrada-produto');
        if (select) {
            select.innerHTML = '<option value="">Selecione um produto</option>' +
                this.state.products
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(p => `<option value="${p.id}">${this.esc(p.name)} (${p.code})</option>`)
                    .join('');
        }

        this.renderEntradaItemsTemp();
        this.openModal('entrada-modal');
    },

    updateEntradaCustoPrevia() {
        const productId = document.getElementById('entrada-produto').value;
        const product = this.state.products.find(p => p.id === productId);
        if (product) {
            document.getElementById('entrada-custo-unit').value = product.cost.toFixed(2);
        }
    },

    adicionarItemEntrada() {
        const productId = document.getElementById('entrada-produto').value;
        const qty = parseInt(document.getElementById('entrada-qty').value);
        const unitCost = parseFloat(document.getElementById('entrada-custo-unit').value);

        if (!productId || isNaN(qty) || qty <= 0 || isNaN(unitCost) || unitCost < 0) {
            this.showNotification('error', 'Preencha o produto, quantidade e custo corretamente.');
            return;
        }

        const product = this.state.products.find(p => p.id === productId);
        if (!product) return;

        // Cada linha guarda o próprio custo. Se o mesmo produto entrar duas vezes, são duas linhas,
        // e o custo médio é recalculado na ordem delas.
        this.entradaItemsTemp.push({
            productId,
            productName: product.name,
            qty,
            unitCost,
            totalCost: qty * unitCost
        });

        // Resetar campos de item
        document.getElementById('entrada-produto').value = '';
        document.getElementById('entrada-qty').value = '1';
        document.getElementById('entrada-custo-unit').value = '';

        this.renderEntradaItemsTemp();
    },

    removerItemEntrada(index) {
        this.entradaItemsTemp.splice(index, 1);
        this.renderEntradaItemsTemp();
    },

    renderEntradaItemsTemp() {
        const container = document.getElementById('entrada-items-temp-container');
        if (!container) return;

        if (this.entradaItemsTemp.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem; font-size: 0.8rem;">Nenhum item adicionado</p>';
            document.getElementById('entrada-total-geral').textContent = 'R$ 0,00';
            return;
        }

        let totalGeral = 0;
        container.innerHTML = this.entradaItemsTemp.map((item, index) => {
            totalGeral += item.totalCost;
            return `
                <div class="nested-item-labs-row" style="grid-template-columns: 1fr 80px 120px 120px 50px; padding: 0.75rem 0.5rem; font-size: 0.85rem; border-bottom: 1px solid var(--glass-border);">
                    <span style="font-weight: 500;">${this.esc(item.productName)}</span>
                    <span>${item.qty}</span>
                    <span>R$ ${item.unitCost.toFixed(2)}</span>
                    <span style="font-weight: 600; color: var(--accent);">R$ ${item.totalCost.toFixed(2)}</span>
                    <button type="button" class="btn-action-delete" onclick="app.removerItemEntrada(${index})">
                        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
            `;
        }).join('');

        document.getElementById('entrada-total-geral').textContent = `R$ ${totalGeral.toFixed(2)}`;
        this.initLucide();
    },

    async handleEntradaSubmit() {
        if (this.entradaItemsTemp.length === 0) {
            this.showNotification('error', 'Adicione pelo menos um item à entrada.');
            return;
        }

        const fornecedor = document.getElementById('entrada-fornecedor').value.trim();
        const nota = document.getElementById('entrada-nota').value.trim();
        const obs = document.getElementById('entrada-obs').value.trim();
        if (!fornecedor) {
            this.showNotification('error', 'Informe o fornecedor.');
            document.getElementById('entrada-fornecedor')?.focus();
            return;
        }
        if (!nota) {
            this.showNotification('error', 'Informe o número da nota.');
            document.getElementById('entrada-nota')?.focus();
            return;
        }
        const totalCusto = this.entradaItemsTemp.reduce((sum, item) => sum + item.totalCost, 0);

        const novaEntrada = {
            id: 'EN' + Date.now(),
            date: new Date().toISOString(),
            fornecedor,
            nota,
            obs,
            items: [...this.entradaItemsTemp],
            totalCusto
        };

        // Atualizar estoque e custo dos produtos
        // Estoque e custo médio ponderado são recalculados pelas movimentações
        this.registrarMovimentacoes(Estoque.movimentosDaEntrada(novaEntrada));

        this.state.entradas.unshift(novaEntrada);
        await this.salvarDados();
        this.logAudit('ENTRADA_REGISTRADA', { id: novaEntrada.id, total: totalCusto });

        this.showNotification('success', 'Entrada registrada e estoque atualizado!');
        this.closeModal();
        this.renderEntradas();
        // Preservar filtros ativos ao re-renderizar produtos após entrada
        const queryAtiva = document.getElementById('filter-products')?.value || '';
        const categoriaAtiva = document.getElementById('filter-category')?.value || '';
        this.renderProducts(queryAtiva, categoriaAtiva);
    },

    renderEntradas(query, dateFilter) {
        const container = document.getElementById('entradas-items-container');
        if (!container) return;

        const busca = query !== undefined ? query : (document.getElementById('filter-entradas')?.value || '');
        const filtroData = dateFilter !== undefined ? dateFilter : (document.getElementById('filter-date-entradas')?.value || '');
        let filtered = this.state.entradas;

        if (busca) {
            const q = String(busca).toLowerCase();
            filtered = filtered.filter(e =>
                e.id.toLowerCase().includes(q) ||
                (e.fornecedor && e.fornecedor.toLowerCase().includes(q)) ||
                (e.nota && e.nota.toLowerCase().includes(q))
            );
        }

        if (filtroData) {
            filtered = filtered.filter(e => {
                const d = this.parseDate(e.date);
                return d ? this.chaveDiaLocal(d) === filtroData : String(e.date || '').startsWith(filtroData);
            });
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-dim);">Nenhuma entrada encontrada.</div>';
            return;
        }

        const visaoEnt = this.visaoDe('entradas');
        container.dataset.visao = visaoEnt;
        const listaEnt = document.getElementById('entradas-list-labs');
        if (listaEnt) listaEnt.classList.toggle('modo-cards', visaoEnt === 'cards');
        if (visaoEnt === 'cards') {
            container.innerHTML = filtered.map(e => `
            <div class="tabela-card">
                <div class="tabela-card-topo">
                    <div class="tabela-card-foto tabela-card-icone"><i class="bx bx-package"></i></div>
                    <div class="tabela-card-titulo">
                        <strong>${this.esc(e.fornecedor || '---')}</strong>
                        <span>#${e.id.toString().slice(-6)} · NF ${this.esc(e.nota || '---')}</span>
                        <span>${new Date(e.date).toLocaleDateString('pt-BR')}</span>
                    </div>
                </div>
                <div class="tabela-card-dados">
                    <div><small>Itens</small><b>${e.items.length} itens</b></div>
                    <div><small>Custo total</small><b>${this.formatCurrency(e.totalCusto)}</b></div>
                </div>
                <div class="tabela-card-acoes">
                    <button class="btn-action-edit" onclick="app.showEntradaDetails('${e.id}')" title="Ver detalhes"><i data-lucide="eye"></i></button>
                    <button class="btn-action-delete" onclick="app.deleteEntrada('${e.id}')" title="Excluir entrada"><i data-lucide="trash-2"></i></button>
                </div>
            </div>`).join('');
            this.initLucide();
            return;
        }
        container.innerHTML = filtered.map(e => `
            <div class="nested-item-labs-row">
                <span class="col-id" data-label="ID">#${e.id.toString().slice(-6)}</span>
                <span class="col-date" data-label="DATA">${new Date(e.date).toLocaleDateString('pt-BR')}</span>
                <span class="col-name" data-label="FORNECEDOR">${this.esc(e.fornecedor || '---')}</span>
                <span class="col-code" data-label="Nº NOTA">${this.esc(e.nota || '---')}</span>
                <span class="col-qty-sum" data-label="ITENS">${e.items.length} itens</span>
                <span class="col-price" data-label="CUSTO">${this.formatCurrency(e.totalCusto)}</span>
                <div class="col-actions" data-label="AÇÕES" style="justify-content: flex-end;">
                    <button class="btn-action-edit" onclick="app.showEntradaDetails('${e.id}')" title="Ver Detalhes">
                        <i data-lucide="eye" style="width: 16px; height: 16px;"></i>
                    </button>
                    <button class="btn-action-delete" onclick="app.deleteEntrada('${e.id}')" title="Excluir Entrada">
                        <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                    </button>
                </div>
            </div>
        `).join('');

        this.initLucide();
    },

    // Estoque em tempo real: cards com foto, quantidade e nível (mesmos limites das notificações).
    estoqueTabelaHtml(lista, vendido30, ultimaMov, nivel, rotulo, moeda) {
        const linhas = lista.map(p => {
            const nv = nivel(p);
            const id = String(p.id);
            const vendas = vendido30[id] || 0;
            const qtd = Number(p.stock) || 0;
            const dias = vendas > 0 && qtd > 0 ? Math.round(qtd / (vendas / 30)) : 0;
            const cobertura = qtd === 0 ? 'Zerado' : vendas === 0 ? 'Sem giro' : 'Cerca de ' + dias + ' dias';
            const ultima = ultimaMov[id] ? new Date(ultimaMov[id]).toLocaleDateString('pt-BR') : '—';
            const capital = qtd * (Number(p.cost) || 0);
            return '<tr class="estoque-linha estoque-' + nv + '">'
                + '<td><div class="estoque-nome-tab"><strong>' + this.esc(p.name) + '</strong><span>' + this.esc(p.code) + '</span></div></td>'
                + '<td class="num">' + qtd + '</td>'
                + '<td><span class="estoque-status">' + rotulo[nv] + '</span></td>'
                + '<td>' + cobertura + '</td>'
                + '<td class="num">' + vendas + ' un.</td>'
                + '<td class="num">' + moeda(capital) + '</td>'
                + '<td>' + ultima + '</td>'
                + '</tr>';
        }).join('');
        return '<div class="table-container-labs"><table class="custom-table-labs estoque-tabela">'
            + '<thead><tr><th>Produto</th><th class="num">Estoque</th><th>Situação</th><th>Cobertura</th><th class="num">Vendas 30 dias</th><th class="num">Capital parado</th><th>Última movimentação</th></tr></thead>'
            + '<tbody>' + linhas + '</tbody></table></div>';
    },

    /** Estado do histórico de movimentações (filtros e paginação). */
    _movEstado() {
        if (!this._mov) this._mov = { periodo: 'tudo', produto: '', tipos: [], busca: '', limite: 50 };
        return this._mov;
    },

    /**
     * Aba ativa de Estoque ('produtos' ou 'movimentos') e visibilidade das abas.
     * Movimentações são só para administrador: para os demais a aba some e volta a Produtos.
     */
    sincronizarAbaEstoque() {
        const isAdmin = this.state.currentUser?.role === 'admin';
        const aba = isAdmin && this._abaEstoque === 'movimentos' ? 'movimentos' : 'produtos';
        document.getElementById('estoque-abas')?.classList.toggle('hidden', !isAdmin);
        document.querySelectorAll('#estoque-abas button').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
        document.getElementById('estoque-produtos')?.classList.toggle('hidden', aba !== 'produtos');
        document.getElementById('estoque-mov')?.classList.toggle('hidden', aba !== 'movimentos');
        return aba;
    },

    bindMovimentacoes() {
        const estado = this._movEstado();
        const recarregar = () => { estado.limite = 50; this.renderMovimentacoes(); };

        document.querySelectorAll('#estoque-abas button').forEach(btn => {
            btn.addEventListener('click', () => {
                this._abaEstoque = btn.dataset.aba;
                this.renderEstoque();
            });
        });

        const tipos = document.getElementById('mov-tipos');
        if (tipos) {
            tipos.innerHTML = HistoricoMov.TIPOS.map(t =>
                `<button type="button" class="mov-chip" data-tipo="${t}">${HistoricoMov.ROTULOS[t]}</button>`
            ).join('');
            tipos.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-tipo]');
                if (!btn) return;
                const t = btn.dataset.tipo;
                const marcados = new Set(estado.tipos);
                if (marcados.has(t)) marcados.delete(t); else marcados.add(t);
                estado.tipos = [...marcados];
                recarregar();
            });
        }

        document.querySelectorAll('#mov-periodo [data-periodo]').forEach(btn => {
            btn.addEventListener('click', () => {
                estado.periodo = btn.dataset.periodo;
                recarregar();
            });
        });
        ['mov-inicio', 'mov-fim'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', recarregar);
        });
        document.getElementById('mov-produto')?.addEventListener('change', (e) => {
            estado.produto = e.target.value;
            recarregar();
        });
        document.getElementById('mov-busca')?.addEventListener('input', (e) => {
            estado.busca = e.target.value.trim();
            recarregar();
        });
        document.getElementById('mov-mais')?.addEventListener('click', () => {
            estado.limite += 50;
            this.renderMovimentacoes();
        });
        document.getElementById('mov-xlsx')?.addEventListener('click', () => this.exportarMovimentacoes('xlsx'));
        document.getElementById('mov-pdf')?.addEventListener('click', () => this.exportarMovimentacoes('pdf'));
    },

    /** Intervalo do filtro de período, em dias YYYY-MM-DD (vazio = sem limite). */
    intervaloMovimentos() {
        const estado = this._movEstado();
        const hoje = new Date();
        const dia = (n) => HistoricoMov.diaLocal(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - n));
        switch (estado.periodo) {
            case 'hoje': return { inicio: dia(0), fim: dia(0) };
            case '7': return { inicio: dia(6), fim: dia(0) };
            case '30': return { inicio: dia(29), fim: dia(0) };
            case 'personalizado':
                return {
                    inicio: (document.getElementById('mov-inicio') || {}).value || '',
                    fim: (document.getElementById('mov-fim') || {}).value || ''
                };
            default: return { inicio: '', fim: '' };
        }
    },

    /** Linhas do histórico que passam nos filtros atuais (mais recentes primeiro). */
    movimentosFiltrados() {
        const estado = this._movEstado();
        const { inicio, fim } = this.intervaloMovimentos();
        const todas = HistoricoMov.linhas(this.state.movimentacoes || [], this.state.products || [], Estoque.historico);
        const filtradas = HistoricoMov.filtrar(todas, {
            inicio, fim, produtoId: estado.produto, tipos: estado.tipos, busca: estado.busca
        });
        return { filtradas, total: todas.length, inicio, fim };
    },

    renderMovimentacoes() {
        const estado = this._movEstado();
        const { filtradas, total } = this.movimentosFiltrados();
        const visiveis = HistoricoMov.paginar(filtradas, estado.limite);
        const t = HistoricoMov.totais(filtradas);

        document.querySelectorAll('#mov-periodo [data-periodo]').forEach(b => b.classList.toggle('active', b.dataset.periodo === estado.periodo));
        document.querySelectorAll('#mov-tipos [data-tipo]').forEach(b => b.classList.toggle('active', estado.tipos.includes(b.dataset.tipo)));
        document.getElementById('mov-datas')?.classList.toggle('hidden', estado.periodo !== 'personalizado');

        const sel = document.getElementById('mov-produto');
        if (sel) {
            const produtos = [...(this.state.products || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            sel.innerHTML = '<option value="">Todos os produtos</option>' + produtos.map(p =>
                `<option value="${this.esc(String(p.id))}">${this.esc(p.name || String(p.id))}</option>`).join('');
            sel.value = estado.produto;
            estado.produto = sel.value;
        }

        const totaisEl = document.getElementById('mov-totais');
        if (totaisEl) {
            const sinal = (n) => (n > 0 ? '+' : '') + n;
            totaisEl.innerHTML = [
                ['Entradas', '+' + t.entradas, 'entrada'],
                ['Saídas', t.saidas > 0 ? '-' + t.saidas : '0', 'saida'],
                ['Ajustes', sinal(t.ajustes), 'ajuste'],
                ['Ignoradas', String(t.ignoradas), 'ignorada']
            ].map(([rotulo, valor, tom]) =>
                `<div class="mov-total mov-total-${tom}"><span>${rotulo}</span><strong>${valor}${tom === 'ignorada' ? '' : ' un.'}</strong></div>`
            ).join('');
        }

        const tbody = document.getElementById('mov-tbody');
        if (tbody) {
            if (total === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="mov-vazio">Nenhuma movimentação registrada.</td></tr>';
            } else if (filtradas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="mov-vazio">Nenhuma movimentação com esses filtros.</td></tr>';
            } else {
                tbody.innerHTML = visiveis.map(l => {
                    const qtd = l.qtd > 0 ? `+${l.qtd}` : `${l.qtd}`;
                    const custo = l.custoUnit == null ? '—' : this.formatCurrency(l.custoUnit);
                    const tag = l.ignorada ? ' <span class="mov-tag-ignorada">ignorada</span>' : '';
                    return `<tr class="${l.ignorada ? 'mov-apagada' : ''}">`
                        + `<td>${HistoricoMov.dataHoraBr(l.data)}</td>`
                        + `<td>${this.esc(l.produto)}</td>`
                        + `<td><span class="mov-tipo-tag mov-tipo-${l.tipo}">${this.esc(l.rotulo)}</span>${tag}</td>`
                        + `<td class="num">${qtd}</td>`
                        + `<td class="num">${custo}</td>`
                        + `<td class="num">${l.saldoApos == null ? '—' : l.saldoApos}</td>`
                        + `<td>${this.esc(l.origem)}</td>`
                        + `<td>${this.esc(l.obs) || '—'}</td>`
                        + '</tr>';
                }).join('');
            }
        }

        const contagem = document.getElementById('mov-contagem');
        if (contagem) {
            contagem.textContent = filtradas.length === 0
                ? ''
                : `Mostrando ${visiveis.length} de ${filtradas.length} movimentações`;
        }
        document.getElementById('mov-mais')?.classList.toggle('hidden', filtradas.length <= estado.limite);
    },

    /** Exporta o histórico filtrado (todas as linhas, não só as visíveis). Só administrador. */
    exportarMovimentacoes(formato) {
        if (this.requirePasswordChange()) return;
        if (!this.requireAdmin('exportar o histórico de movimentações')) return;

        const estado = this._movEstado();
        const { filtradas, inicio, fim } = this.movimentosFiltrados();
        if (filtradas.length === 0) {
            this.showNotification('error', 'Nenhuma movimentação para exportar.');
            return;
        }

        const dataBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
        const periodoTexto = !inicio && !fim
            ? 'todo o período'
            : (inicio ? dataBr(inicio) : 'início') + ' a ' + (fim ? dataBr(fim) : 'hoje');
        const sufixo = inicio || fim ? (inicio || 'inicio') + '_a_' + (fim || 'hoje') : 'todas';

        const partes = ['Período: ' + periodoTexto];
        if (estado.produto) {
            const p = (this.state.products || []).find(x => String(x.id) === estado.produto);
            partes.push('Produto: ' + (p ? p.name : estado.produto));
        }
        if (estado.tipos.length) partes.push('Tipos: ' + estado.tipos.map(t => HistoricoMov.ROTULOS[t]).join(', '));
        if (estado.busca) partes.push('Busca: "' + estado.busca + '"');

        const cabecalho = {
            titulo: 'Histórico de movimentações',
            empresa: (this.state.settings || {}).companyName || '',
            periodo: partes.join(' · '),
            geradoEm: 'Gerado em ' + new Date().toLocaleString('pt-BR') + ' por ' + (this.state.currentUser?.username || 'sistema')
        };

        try {
            const secoes = [HistoricoMov.secao(filtradas)];
            if (formato === 'pdf') {
                const bytes = window.Relatorios.pdf(cabecalho, secoes);
                this.baixarArquivo(bytes, 'application/pdf', 'movimentacoes_' + sufixo + '.pdf');
            } else {
                const bytes = window.Relatorios.xlsx(secoes, cabecalho);
                this.baixarArquivo(bytes,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'movimentacoes_' + sufixo + '.xlsx');
            }
        } catch (err) {
            this.showNotification('error', 'Erro ao gerar o arquivo: ' + err.message);
            return;
        }

        this.logAudit('MOVIMENTACOES_EXPORT', {
            formato, linhas: filtradas.length, inicio, fim, produto: estado.produto, tipos: estado.tipos, busca: estado.busca
        });
        this.showNotification('success', `Histórico exportado (${formato === 'pdf' ? 'PDF' : 'Excel'}, ${filtradas.length} movimentações).`);
    },

    renderEstoque() {
        const aba = this.sincronizarAbaEstoque();
        if (aba === 'movimentos') {
            this.renderMovimentacoes();
            return;
        }
        const grid = document.getElementById('estoque-grid');
        if (!grid) return;

        const n = this.state.settings.notifications || {};
        const baixo = Number(n.stockLowVal) || 10;
        const medio = Number(n.stockMediumVal) || 25;
        const nivel = (p) => (p.stock < baixo ? 'baixo' : p.stock < medio ? 'medio' : 'ok');
        const rotulo = { baixo: 'Baixo', medio: 'Médio', ok: 'Normal' };
        const moeda = (v) => this.formatCurrency(Number(v) || 0);

        const busca = (document.getElementById('filter-estoque')?.value || '').trim().toLowerCase();
        const ordem = document.getElementById('sort-estoque')?.value || 'estoque';

        // Apoio: vendas dos últimos 30 dias e data da última movimentação de cada produto
        const limite = Date.now() - 30 * 24 * 3600 * 1000;
        const vendido30 = {};
        (this.state.sales || []).forEach(v => {
            const dv = this.parseDate(v.date || v.Data);
            if (!dv || dv.getTime() < limite) return;
            (v.items || []).forEach(it => {
                const id = String(it.productId != null ? it.productId : it.id);
                const qtd = Number(it.qtySold) || Number(it.qty) || 0;
                vendido30[id] = (vendido30[id] || 0) + qtd;
            });
        });
        const ultimaMov = {};
        (this.state.movimentacoes || []).forEach(m => {
            if (m.ignorada) return;
            const t = new Date(m.date).getTime();
            const id = String(m.produtoId);
            if (!isNaN(t) && (!ultimaMov[id] || t > ultimaMov[id])) ultimaMov[id] = t;
        });

        const contagem = { baixo: 0, medio: 0, ok: 0 };
        let valorEstoque = 0;
        this.state.products.forEach(p => {
            contagem[nivel(p)]++;
            valorEstoque += (Number(p.stock) || 0) * (Number(p.cost) || 0);
        });
        const resumo = document.getElementById('estoque-resumo');
        if (resumo) resumo.textContent = `${contagem.baixo} baixo · ${contagem.medio} médio · ${contagem.ok} normal · valor em estoque ${moeda(valorEstoque)}`;

        const lista = this.state.products
            .filter(p => !busca || (p.name || '').toLowerCase().includes(busca) || String(p.code || '').toLowerCase().includes(busca))
            .sort(ordem === 'nome'
                ? (a, b) => (a.name || '').localeCompare(b.name || '')
                : (a, b) => (a.stock - b.stock) || (a.name || '').localeCompare(b.name || ''));

        const visao = localStorage.getItem('sv_estoque_visao') === 'tabela' ? 'tabela' : 'cards';
        const secaoEstoque = document.getElementById('estoque-view');
        if (secaoEstoque) secaoEstoque.classList.toggle('modo-tabela', visao === 'tabela');
        document.querySelectorAll('#estoque-visao-toggle button').forEach(b => b.classList.toggle('active', b.dataset.visao === visao));
        if (visao === 'tabela') {
            grid.innerHTML = lista.length === 0
                ? '<div class="pos-empty">Nenhum produto encontrado.</div>'
                : this.estoqueTabelaHtml(lista, vendido30, ultimaMov, nivel, rotulo, moeda);
            return;
        }

        if (lista.length === 0) {
            grid.innerHTML = '<div class="pos-empty">Nenhum produto encontrado.</div>';
            return;
        }

        grid.innerHTML = lista.map(p => {
            const nv = nivel(p);
            const id = String(p.id);
            const foto = p.image
                ? `<img src="${p.image}" alt="">`
                : `<span class="estoque-letter">${this.esc((p.name || '?').charAt(0).toUpperCase())}</span>`;
            const vendas = vendido30[id] || 0;
            const estoqueQtd = Number(p.stock) || 0;
            const cobertura = vendas === 0
                ? 'Sem vendas'
                : estoqueQtd === 0 ? 'Zerado' : `~${Math.round(estoqueQtd / (vendas / 30))} dias`;
            const ultima = ultimaMov[id] ? new Date(ultimaMov[id]).toLocaleDateString('pt-BR') : '—';
            const diasCobertura = vendas > 0 && estoqueQtd > 0 ? Math.round(estoqueQtd / (vendas / 30)) : 0;
            const frase = estoqueQtd === 0
                ? 'Zerado: repor para voltar a vender'
                : vendas === 0
                    ? 'Sem giro nos últimos 30 dias'
                    : 'Dura cerca de ' + diasCobertura + ' dias no ritmo atual';
            const capital = estoqueQtd * (Number(p.cost) || 0);
            return `
                <div class="estoque-card estoque-${nv}">
                    <div class="estoque-topo">
                        <div class="estoque-foto">${foto}</div>
                        <div class="estoque-info">
                            <span class="estoque-nome" title="${this.esc(p.name)}">${this.esc(p.name)}</span>
                            <span class="estoque-cod">${this.esc(p.code)}</span>
                        </div>
                        <span class="estoque-status">${rotulo[nv]}</span>
                    </div>
                    <div class="estoque-principal">
                        <strong>${estoqueQtd}</strong>
                        <span>unidades em estoque</span>
                    </div>
                    <div class="estoque-frases">
                        <p>${frase}</p>
                        <p>Vendeu ${vendas} un. em 30 dias</p>
                    </div>
                    <div class="estoque-rodape">
                        <span>Capital parado<b>${moeda(capital)}</b></span>
                        <span>Última movimentação<b>${ultima}</b></span>
                    </div>
                </div>`;
        }).join('');
    },

    // Histórico de movimentações de um produto (mais recente primeiro).
    // Mostra as últimas 100 e permite carregar mais e filtrar por período.
    // O saldo de cada linha vem do histórico completo, mesmo quando o filtro esconde linhas.
    showProductHistory(id) {
        const produto = this.state.products.find(p => String(p.id) === String(id));
        if (!produto) return;

        this._hist = { id: produto.id, limite: 100, periodo: 'tudo' };
        const select = document.getElementById('hist-periodo');
        if (select) select.value = 'tudo';

        document.getElementById('product-history-title').textContent = `Histórico — ${produto.name}`;
        document.getElementById('product-history-summary').textContent =
            `Estoque atual: ${produto.stock} un. · Custo médio: ${this.formatCurrency(produto.cost)}`;

        this.renderProductHistory();
        this.openModal('product-history-modal');
    },

    setProductHistoryPeriod(valor) {
        if (!this._hist) return;
        this._hist.periodo = valor;
        this._hist.limite = 100;
        this.renderProductHistory();
    },

    loadMoreProductHistory() {
        if (!this._hist) return;
        this._hist.limite += 100;
        this.renderProductHistory();
    },

    renderProductHistory() {
        const hist = this._hist;
        const produto = hist && this.state.products.find(p => String(p.id) === String(hist.id));
        if (!produto) return;

        const todas = Estoque.historico(this.state.movimentacoes, produto.id).slice().reverse();
        const dias = hist.periodo === 'tudo' ? null : Number(hist.periodo);
        const corte = dias ? Date.now() - dias * 24 * 60 * 60 * 1000 : null;
        const filtradas = corte === null
            ? todas
            : todas.filter(({ mov }) => mov.date && new Date(mov.date).getTime() >= corte);
        const visiveis = filtradas.slice(0, hist.limite);

        const contador = document.getElementById('product-history-count');
        if (contador) {
            contador.textContent = filtradas.length === 0
                ? ''
                : `Mostrando ${visiveis.length} de ${filtradas.length}`;
        }

        const maisWrap = document.getElementById('product-history-more-wrap');
        if (maisWrap) maisWrap.classList.toggle('hidden', filtradas.length <= hist.limite);

        const container = document.getElementById('product-history-list');
        if (todas.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.85rem;">Nenhuma movimentação registrada para este produto.</div>';
        } else if (filtradas.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim); font-size: 0.85rem;">Nenhuma movimentação neste período.</div>';
        } else {
            container.innerHTML = visiveis.map(({ mov, saldoApos }) => {
                const apagada = mov.ignorada;
                const estilo = apagada ? 'opacity: 0.45;' : '';
                const data = mov.date ? new Date(mov.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
                const qtd = mov.qtd > 0 ? `+${mov.qtd}` : `${mov.qtd}`;
                const custo = mov.custoUnit == null ? '—' : this.formatCurrency(mov.custoUnit);
                const saldo = apagada ? '—' : saldoApos;
                return `
                    <div class="nested-item-labs-row" style="grid-template-columns: 140px 1.4fr 70px 110px 80px 1fr; padding: 0.6rem 0.5rem; font-size: 0.82rem; border-bottom: 1px solid var(--glass-border); ${estilo}">
                        <span>${data}</span>
                        <span style="font-weight: 500;">${mov.tipo === 'entrada' && apagada ? 'Entrada (excluída)' : Estoque.rotulo(mov.tipo)}</span>
                        <span style="${apagada ? 'text-decoration: line-through;' : ''}">${qtd}</span>
                        <span>${custo}</span>
                        <span>${saldo}</span>
                        <span style="color: var(--text-dim);">${this.esc(mov.obs) || ''}</span>
                    </div>`;
            }).join('');
        }
    },

    showEntradaDetails(id) {
        const entrada = this.state.entradas.find(e => e.id === id);
        if (!entrada) return;

        document.getElementById('details-entrada-id').textContent = `ID: ${entrada.id}`;
        document.getElementById('details-entrada-fornecedor').textContent = entrada.fornecedor || '---';
        document.getElementById('details-entrada-nota').textContent = entrada.nota || '---';
        document.getElementById('details-entrada-total').textContent = `R$ ${entrada.totalCusto.toFixed(2)}`;

        const container = document.getElementById('details-entrada-items-container');
        container.innerHTML = entrada.items.map(item => `
            <div class="nested-item-labs-row" style="grid-template-columns: 1fr 80px 120px 120px; padding: 0.75rem 0.5rem; font-size: 0.85rem; border-bottom: 1px solid var(--glass-border);">
                <span style="font-weight: 500;">${this.esc(item.productName)}</span>
                <span>${item.qty}</span>
                <span>R$ ${item.unitCost.toFixed(2)}</span>
                <span style="font-weight: 600;">R$ ${item.totalCost.toFixed(2)}</span>
            </div>
        `).join('');

        this.openModal('entrada-details-modal');
    },

    deleteEntrada(id) {
        const entradaAlvo = this.state.entradas.find(e => e.id === id);
        if (entradaAlvo) {
            // Bloqueia a exclusão se vendas feitas depois da entrada dependem do estoque dela
            const verificacao = Estoque.verificarExclusaoEntrada(this.state.movimentacoes, entradaAlvo);
            if (!verificacao.ok) {
                const linhas = verificacao.problemas.map(pr => {
                    const produto = this.state.products.find(p => String(p.id) === pr.produtoId);
                    const nome = produto ? produto.name : pr.produtoId;
                    return `${nome}: ${pr.falta} unidade(s) já vendida(s)`;
                });
                this.showNotification('error', 'Não é possível excluir esta entrada porque o estoque já foi vendido. ' + linhas.join('; ') + '.');
                return;
            }
        }

        this.confirmAction(
            'Excluir Entrada?',
            'O estoque e o custo médio dos produtos serão recalculados sem esta entrada. Deseja continuar?',
            async () => {
                const index = this.state.entradas.findIndex(e => e.id === id);
                if (index === -1) return;

                const entrada = this.state.entradas[index];

                // Reverte estoque e custo médio: as movimentações da entrada deixam de contar
                const plano = Estoque.planejarExclusaoEntrada(this.state.movimentacoes, entrada);
                this.state.movimentacoes.forEach(m => { if (plano.ignorar.includes(m.id)) m.ignorada = true; });
                this.registrarMovimentacoes(plano.novas);

                this.state.entradas.splice(index, 1);
                await this.salvarDados();
                this.logAudit('ENTRADA_EXCLUIDA', { id });

                this.showNotification('success', 'Entrada excluída e estoque atualizado!');
                this.renderEntradas();
                // Preservar filtros ativos ao re-renderizar produtos após excluir entrada
                const queryAtiva = document.getElementById('filter-products')?.value || '';
                const categoriaAtiva = document.getElementById('filter-category')?.value || '';
                this.renderProducts(queryAtiva, categoriaAtiva);
            },
            'trash-2'
        );
    },

    async exitApp() {
        if (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects.bridge) {
            const bridge = window.chrome.webview.hostObjects.bridge;
            await bridge.QuitApplication();
        } else {
            window.close();
        }
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
