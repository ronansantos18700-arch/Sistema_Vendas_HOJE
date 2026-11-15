/**
 * SV Ultra - Core Application Logic
 * Refactored for Labs Design Theme
 */

const app = {
    // --- Configuração ---
    config: {
        // Login e gestão de usuários. Com false, o sistema abre direto (usuário local administrador)
        // e as telas de login e de usuários ficam ocultas. Para voltar, troque para true.
        loginAtivo: false,
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
        currentView: 'dashboard',
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

    // --- Resumo de vendas por forma de pagamento (substitui o caixa na v1) ---
    hojeISO() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    resumoHoje() {
        const hoje = this.hojeISO();
        document.getElementById('resumo-de').value = hoje;
        document.getElementById('resumo-ate').value = hoje;
        this.renderResumo();
    },

    renderResumo() {
        const container = document.getElementById('resumo-tabela');
        if (!container) return;
        const deEl = document.getElementById('resumo-de');
        const ateEl = document.getElementById('resumo-ate');
        if (deEl && !deEl.value) deEl.value = this.hojeISO();
        if (ateEl && !ateEl.value) ateEl.value = this.hojeISO();

        const de = deEl ? deEl.value : this.hojeISO();
        const ate = ateEl ? ateEl.value : de;
        if (de > ate) {
            container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">A data inicial é posterior à data final.</div>';
            return;
        }

        const p = Resumo.periodo(de, ate);
        const r = Resumo.resumoPorPagamento(this.state.sales, p.inicio, p.fim);
        const colunas = 'grid-template-columns: 1fr 120px 180px;';

        const linhas = r.linhas.map(l => `
            <div class="nested-item-labs-row" style="${colunas} padding: 0.75rem 0.5rem; font-size: 0.9rem; border-bottom: 1px solid var(--glass-border);">
                <span style="font-weight: 500;">${l.rotulo}</span>
                <span>${l.quantidade}</span>
                <span>${this.formatCurrency(l.total)}</span>
            </div>`).join('');

        container.innerHTML = `
            <div class="list-header-labs" style="${colunas} padding: 1rem; font-size: 0.75rem; border-bottom: 1px solid var(--glass-border);">
                <span>FORMA DE PAGAMENTO</span>
                <span>VENDAS</span>
                <span>TOTAL</span>
            </div>
            ${linhas}
            <div class="nested-item-labs-row" style="${colunas} padding: 0.9rem 0.5rem; font-size: 1rem; font-weight: 700;">
                <span>Total</span>
                <span>${r.quantidade}</span>
                <span>${this.formatCurrency(r.total)}</span>
            </div>`;
        this.initLucide();
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
    async init() {
        if (!this.config.loginAtivo) {
            this.state.currentUser = { ...this.config.usuarioLocal };
            document.body.classList.add('sem-login');
        }
        this.loadTheme();
        this.loadLoginSecurityState();
        this.setupGlobalHandlers();
        this.setupBridge();
        await this.carregarDados();
        this.setupEventListeners();
        this.initLucide();

        const { loginScreen, appContainer } = this.getDOMRefs();

        // Se já houver um usuário logado no estado (ex: após refresh), tenta restaurar
        if (this.state.currentUser) {
            const initialView = this.state.currentUser.role === 'operador' ? 'pos' : 'dashboard';
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
            const initialView = user.role === 'operador' ? 'pos' : 'dashboard';
            this.switchView(initialView);

            // Se for o admin padrão ou senha provisória, obriga a trocar
            if (user.isDefaultCredential || (user.username === 'admin' && password === '1234')) {
                this.state.mustChangePassword = true;
                setTimeout(() => {
                    this.showAlert(
                        '🔐 Troca de Senha Obrigatória',
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
        const productStats = {};

        filteredSales.forEach(sale => {
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
                    const profit = (price - cost) * qty;
                    productStats[id].profit += profit;
                });
            }
        });

        const top5 = Object.values(productStats)
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 5);

        const labels = top5.map(p => {
            let name = p.name.length > 18 ? p.name.substring(0, 18) + '...' : p.name;
            if (this.state.hotProductIds && this.state.hotProductIds.includes(p.id.toString())) {
                name = `🔥 ${name}`;
            }
            return name;
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
                    borderColor: '#7fa58e',
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
            const photoPath = await bridge.SelectFile();
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
            btnTogglePass.addEventListener('click', () => {
                const passInput = document.getElementById('login-password');
                const icon = document.getElementById('toggle-password-icon');
                if (passInput.type === 'password') {
                    passInput.type = 'text';
                    icon.innerHTML = '<i data-lucide="eye-off"></i>';
                } else {
                    passInput.type = 'password';
                    icon.innerHTML = '<i data-lucide="eye"></i>';
                }
                // Usar lucide.createIcons apenas no container do ícone para evitar erros globais
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
            });
        }

        // Estoque em tempo real: filtro e ordenação
        const filtroEstoque = document.getElementById('filter-estoque');
        if (filtroEstoque) filtroEstoque.addEventListener('input', () => this.renderEstoque());
        const ordemEstoque = document.getElementById('sort-estoque');
        if (ordemEstoque) ordemEstoque.addEventListener('change', () => this.renderEstoque());

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
                this.updatePaidVisibility();
            });
            this.updatePaidVisibility();
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
            if (notifDropdown && !notifDropdown.contains(e.target) && e.target !== btnNotif) {
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
        if (filterProd) filterProd.addEventListener('input', (e) => this.renderProducts(e.target.value));

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
        const isLight = document.body.classList.toggle('light-theme');
        localStorage.setItem('sv_theme', isLight ? 'light' : 'dark');
        this.updateThemeIcon();
        this.syncAppearanceThemeToggle();
    },

    loadTheme() {
        const savedTheme = localStorage.getItem('sv_theme');
        if (savedTheme === 'light') {
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
            resumo: 'Resumo de Vendas',
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
            resumo: 'RELATÓRIOS',
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

        if (viewId === 'dashboard') {
            this.renderDashboard();
        }
        if (viewId === 'resumo') {
            this.renderResumo();
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
            this.updatePaidVisibility();

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
                        <button type="button" class="btn-user-edit" onclick="app.editUser('${user.id}')" title="Editar Usuário" style="width: 32px; height: 32px; border-radius: 8px; background: rgba(201, 169, 110, 0.1); color: var(--accent); border: 1px solid rgba(201, 169, 110, 0.2); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: var(--transition);">
                            <i data-lucide="edit-3"></i>
                        </button>
                        <button type="button" class="btn-user-delete" onclick="app.deleteUser('${user.id}')" title="Excluir Usuário" style="width: 32px; height: 32px; border-radius: 8px; background: rgba(181, 103, 106, 0.1); color: #b5676a; border: 1px solid rgba(181, 103, 106, 0.2); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: var(--transition);">
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
                    '⚠️ Senha muito fraca! Por segurança, escolha uma senha mais complexa.'
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
                this.logAudit('DELETE_USER', { targetId: userId, targetUsername: user.username });
                this.state.users = this.state.users.filter(u => u.id !== userId);
                await this.salvarDados();
                this.renderUsers();
                this.showNotification('success', 'Usuário excluído.');
            },
            'trash-2'
        );
    },

    async resetSystemUsers() {
        if (!this.requireAdmin('resetar usuários')) return;
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
            const photoPath = await bridge.SelectFile();
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
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            encoder.encode(content)
        );
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    },

    // --- Backup Logic ---
    async exportBackup() {
        if (this.requirePasswordChange()) return;
        if (!this.requireAdmin('exportar backups')) return;
        this.logAudit('BACKUP_EXPORT', {});
        this.setLoading(true);
        this.showNotification('info',
            '🔒 Backup sendo gerado. Por segurança, usuários e senhas NÃO serão incluídos.'
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
                '✅ Backup exportado com sucesso! (Produtos, clientes, vendas e imagens incluídos. Usuários excluídos por segurança)'
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
            this.state.products = st.products;
            this.state.customers = st.customers;
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
            '✅ Backup restaurado com sucesso! Seus usuários atuais foram mantidos (não alterados por segurança).'
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

        // Atualizar Topbar
        if (currentUser) {
            if (topbarProfileName) topbarProfileName.textContent = currentUser.fullname || currentUser.username;
            if (topbarProfileRole) topbarProfileRole.textContent = currentUser.role === 'admin' ? 'Administrador' : 'Operador';
        }

        if (topbarLogoContainer) {
            if (settings.logoUrl) {
                topbarLogoContainer.innerHTML = `<img src="${settings.logoUrl}" alt="User" class="avatar-topbar">`;
            } else {
                const initial = settings.companyName ? settings.companyName.charAt(0).toUpperCase() : (currentUser ? currentUser.username.charAt(0).toUpperCase() : '?');
                topbarLogoContainer.innerHTML = `<div class="item-avatar-letter" style="width: 36px; height: 36px; font-size: 0.9rem; background: var(--glass-inner); border: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--text-white);">${initial}</div>`;
            }
        }

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
        // Forçar dataLoaded se tivermos itens no estado (indica que o sistema está operacional)
        if (!this.state.dataLoaded && (this.state.products.length > 0 || this.state.sales.length > 0)) {
            this.state.dataLoaded = true;
        }

        if (!this.state.dataLoaded) {
            console.warn("Tentativa de salvar dados antes de carregar. Operação cancelada.");
            return false;
        }

        this.setLoading(true);
        try {
            if (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects.bridge) {
                const bridge = window.chrome.webview.hostObjects.bridge;

                // Grava somente o que mudou desde a última gravação bem-sucedida (uma transação).
                const colecoes = this.colecoesParaSalvar();
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
            if (window.chrome && window.chrome.webview && window.chrome.webview.hostObjects && window.chrome.webview.hostObjects.bridge) {
                const bridge = window.chrome.webview.hostObjects.bridge;

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

                if (!usersData || usersData === "[]" || usersData === "") {
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
                        items: items
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

                // Criar usuário admin padrão se não houver usuários
                if (this.state.users.length === 0) {
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

                // Criar usuário admin padrão se não houver usuários (fallback)
                if (this.state.users.length === 0) {
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

        this.iniciarHistoricoEstoque();

        if (this.state.products.length === 0 && !window.chrome?.webview) {
            this.state.products = [
                { id: '1', name: 'MacBook Pro M3', code: '1001', cost: 8000, price: 14500, stock: 5, image: '' },
                { id: '2', name: 'iPhone 15 Pro', code: '1002', cost: 4500, price: 8900, stock: 12, image: '' }
            ];
            this.state.customers = [
                { id: 'c1', name: 'João Silva', whatsapp: '(11) 98888-7777', date: new Date().toISOString(), image: '' }
            ];
            this.iniciarHistoricoEstoque();
            this.salvarDados();
        }
    },

    // --- Dashboard Helpers ---
    getFilteredSales() {
        const sales = this.state.sales || [];
        if (sales.length === 0) return [];

        const now = new Date();
        let fromDate = null;

        switch (this.state.dashboardFilter) {
            case '7d':
                fromDate = new Date(now);
                fromDate.setDate(now.getDate() - 6);
                break;
            case 'month':
                fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'year':
                fromDate = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                return sales;
        }

        return sales.filter(s => {
            const dateStr = s.date || s.Data;
            const d = this.parseDate(dateStr);
            if (!d) return false;
            return d >= fromDate && d <= now;
        });
    },

    // --- Dashboard Logic ---
    initCharts() {
        if (typeof Chart === 'undefined') return;

        const canvasLine = document.getElementById('lineChart');
        if (!canvasLine) return;

        const ctxLine = canvasLine.getContext('2d');

        // Destruir apenas o gráfico de linha que este método gerencia
        if (this.state.charts.line) {
            this.state.charts.line.destroy();
            this.state.charts.line = null;
        }

        const filteredSales = this.getFilteredSales();
        const labels = [];
        const revenueData = [];
        const profitData = [];
        const costData = [];

        const now = new Date();
        const filterType = this.state.dashboardFilter;

        if (filterType === '7d') {
            for (let i = 6; i >= 0; i--) {
                const day = new Date(now);
                day.setDate(now.getDate() - i);
                const dayKey = day.toISOString().slice(0, 10);
                labels.push(day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));

                let dayTotal = 0;
                let dayProfit = 0;
                let dayCost = 0;

                filteredSales.forEach(s => {
                    const dateStr = s.date || s.Data;
                    const d = this.parseDate(dateStr);
                    if (!d) return;
                    const key = d.toISOString().slice(0, 10);
                    if (key !== dayKey) return;

                    const subtotal = s.valor_total ?? s["Valor Total"] ?? s.total ?? 0;
                    const desconto = s.desconto ?? s.Desconto ?? 0;
                    const totalFinal = subtotal - desconto;
                    const custo = s.cost ?? s.custo ?? s.Custo ?? s.custoTotal ?? 0;
                    const lucro = s.lucro ?? s.Lucro ?? (totalFinal - custo);

                    dayTotal += Number(totalFinal) || 0;
                    dayProfit += Number(lucro) || 0;
                    dayCost += Number(custo) || 0;
                });

                revenueData.push(dayTotal);
                profitData.push(dayProfit);
                costData.push(dayCost);
            }
        } else if (filterType === 'month') {
            const year = now.getFullYear();
            const month = now.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            for (let i = 1; i <= daysInMonth; i++) {
                const day = new Date(year, month, i);
                const dayKey = day.toISOString().slice(0, 10);
                labels.push(i.toString());

                let dayTotal = 0;
                let dayProfit = 0;
                let dayCost = 0;

                filteredSales.forEach(s => {
                    const dateStr = s.date || s.Data;
                    const d = this.parseDate(dateStr);
                    if (!d) return;
                    const key = d.toISOString().slice(0, 10);
                    if (key !== dayKey) return;

                    const subtotal = s.valor_total ?? s["Valor Total"] ?? s.total ?? 0;
                    const desconto = s.desconto ?? s.Desconto ?? 0;
                    const totalFinal = subtotal - desconto;
                    const custo = s.cost ?? s.custo ?? s.Custo ?? s.custoTotal ?? 0;
                    const lucro = s.lucro ?? s.Lucro ?? (totalFinal - custo);

                    dayTotal += Number(totalFinal) || 0;
                    dayProfit += Number(lucro) || 0;
                    dayCost += Number(custo) || 0;
                });

                revenueData.push(dayTotal);
                profitData.push(dayProfit);
                costData.push(dayCost);
            }
        } else if (filterType === 'year') {
            const year = now.getFullYear();
            const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

            for (let i = 0; i < 12; i++) {
                labels.push(monthNames[i]);

                let monthTotal = 0;
                let monthProfit = 0;
                let monthCost = 0;

                filteredSales.forEach(s => {
                    const dateStr = s.date || s.Data;
                    const d = this.parseDate(dateStr);
                    if (!d) return;
                    if (d.getFullYear() !== year || d.getMonth() !== i) return;

                    const subtotal = s.valor_total ?? s["Valor Total"] ?? s.total ?? 0;
                    const desconto = s.desconto ?? s.Desconto ?? 0;
                    const totalFinal = subtotal - desconto;
                    const custo = s.cost ?? s.custo ?? s.Custo ?? s.custoTotal ?? 0;
                    const lucro = s.lucro ?? s.Lucro ?? (totalFinal - custo);

                    monthTotal += Number(totalFinal) || 0;
                    monthProfit += Number(lucro) || 0;
                    monthCost += Number(custo) || 0;
                });

                revenueData.push(monthTotal);
                profitData.push(monthProfit);
                costData.push(monthCost);
            }
        }

        const theme = this.getThemeColors();
        Chart.defaults.color = theme.text;
        Chart.defaults.font.family = "'SV Roboto', 'Segoe UI', system-ui, sans-serif";
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

        const datasets = [];
        if (this.state.activeChartDatasets.includes('faturamento')) {
            datasets.push({
                label: 'Faturamento',
                data: revenueData,
                borderColor: '#c9a96e',
                backgroundColor: 'rgba(201, 169, 110, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            });
        }
        if (this.state.activeChartDatasets.includes('lucro')) {
            datasets.push({
                label: 'Lucro',
                data: profitData,
                borderColor: '#8a9099',
                backgroundColor: 'rgba(138, 144, 153, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            });
        }
        if (this.state.activeChartDatasets.includes('custo')) {
            datasets.push({
                label: 'Custo',
                data: costData,
                borderColor: '#b5676a',
                backgroundColor: 'rgba(181, 103, 106, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            });
        }

        this.state.charts.line = new Chart(ctxLine, {
            type: 'line',
            data: {
                labels: labels,
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
        
        // Identificar produtos "Hot" (Top 5 vendidos E Top 5 lucrativos)
        const filteredSales = this.getFilteredSales();
        const soldStats = {};
        const profitStats = {};

        filteredSales.forEach(sale => {
            if (sale.items && Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    const id = item.productId || item.id;
                    if (!id) return;
                    
                    const qty = Number(item.qtySold) || Number(item.qty) || 0;
                    const price = Number(item.price) || 0;
                    const cost = Number(item.cost) || 0;

                    if (!soldStats[id]) soldStats[id] = 0;
                    soldStats[id] += qty;

                    if (!profitStats[id]) profitStats[id] = 0;
                    profitStats[id] += (price - cost) * qty;
                });
            }
        });

        const top5SoldIds = Object.entries(soldStats).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
        const top5ProfitIds = Object.entries(profitStats).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
        this.state.hotProductIds = top5SoldIds.filter(id => top5ProfitIds.includes(id));

        this.renderTopProductsChart();
        this.renderTopProfitableProductsChart();
        this.renderCriticalStockTable();
        this.renderPaymentMethodsChart();
        this.renderSalesByHourChart();
        this.renderProfitMarginPercentChart();
        this.renderRecentSalesDashboard();
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
            let name = p.name.length > 18 ? p.name.substring(0, 18) + '...' : p.name;
            if (this.state.hotProductIds && this.state.hotProductIds.includes(p.id.toString())) {
                name = `🔥 ${name}`;
            }
            return name;
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
                    backgroundColor: 'rgba(201, 169, 110, 0.6)',
                    borderColor: '#c9a96e',
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
        const paymentStats = {};
        let totalRevenue = 0;

        filteredSales.forEach(sale => {
            const method = sale.pagamento || sale.PaymentMethod || sale.formaPagamento || 'Outros';
            const amount = sale.valor_total ?? sale["Valor Total"] ?? sale.total ?? 0;
            
            if (!paymentStats[method]) {
                paymentStats[method] = { count: 0, revenue: 0 };
            }
            paymentStats[method].count++;
            paymentStats[method].revenue += amount;
            totalRevenue += amount;
        });

        const labels = Object.keys(paymentStats).map(m => m.charAt(0).toUpperCase() + m.slice(1));
        const data = Object.values(paymentStats).map(stat => 
            totalRevenue > 0 ? ((stat.revenue / totalRevenue) * 100).toFixed(1) : 0
        );
        const revenues = Object.values(paymentStats).map(stat => stat.revenue);
        const counts = Object.values(paymentStats).map(stat => stat.count);

        if (this.state.charts.paymentMethods) {
            this.state.charts.paymentMethods.destroy();
        }

        if (data.length === 0) return;

        const theme = this.getThemeColors();
        this.state.charts.paymentMethods = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        'rgba(201, 169, 110, 0.7)', // Purple
                        'rgba(127, 165, 142, 0.7)',  // Green
                        'rgba(249, 115, 22, 0.7)',  // Orange
                        'rgba(6, 182, 212, 0.7)',   // Cyan
                        'rgba(181, 103, 106, 0.7)'    // Red
                    ],
                    borderColor: theme.border,
                    borderWidth: 2,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                layout: {
                    padding: { top: 25, bottom: 25, left: 10, right: 10 }
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: theme.text,
                            padding: 12,
                            font: { size: 11 },
                            usePointStyle: true,
                            boxWidth: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: theme.tooltipBg,
                        titleColor: theme.tooltipText,
                        bodyColor: theme.tooltipText,
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            label: (context) => {
                                const index = context.dataIndex;
                                const revenue = revenues[index];
                                const count = counts[index];
                                const percentage = data[index];
                                return [
                                    ` ${context.label}: ${percentage}%`,
                                    ` Faturamento: ${this.formatCurrency(revenue)}`,
                                    ` Nº de vendas: ${count}`
                                ];
                            }
                        }
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
                    backgroundColor: 'rgba(201, 169, 110, 0.4)',
                    borderColor: '#c9a96e',
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
                    borderColor: '#c9a96e',
                    backgroundColor: 'rgba(201, 169, 110, 0.1)',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointBackgroundColor: '#7fa58e',
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
                    <td style="color: #b5676a;">${this.formatCurrency(desconto)}</td>
                    <td style="font-weight: 700; color: var(--accent);">${this.formatCurrency(totalFinal)}</td>
                    <td style="color: var(--text-dim);">${this.formatCurrency(custo)}</td>
                    <td style="font-weight: 600; color: ${lucro >= 0 ? '#7fa58e' : '#b5676a'};">${this.formatCurrency(lucro)}</td>
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
        let startCurrent, startPrevious;

        if (filter === '7d') {
            startCurrent = new Date(now);
            startCurrent.setDate(now.getDate() - 7);
            startPrevious = new Date(startCurrent);
            startPrevious.setDate(startCurrent.getDate() - 7);
        } else if (filter === 'month') {
            startCurrent = new Date(now.getFullYear(), now.getMonth(), 1);
            startPrevious = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        } else if (filter === 'year') {
            startCurrent = new Date(now.getFullYear(), 0, 1);
            startPrevious = new Date(now.getFullYear() - 1, 0, 1);
        } else {
            return [];
        }

        return this.state.sales.filter(s => {
            const d = this.parseDate(s.date || s.Data);
            return d >= startPrevious && d < startCurrent;
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

        let diffPercent = 0;
        if (previous > 0) {
            diffPercent = ((current - previous) / previous) * 100;
        } else if (current > 0) {
            diffPercent = 100;
        } else if (current === 0 && previous === 0) {
            diffPercent = 0;
        } else {
            diffPercent = -100;
        }

        const valueEl = el.querySelector('.var-value');
        if (valueEl) {
            const sign = diffPercent >= 0 ? '▲' : '▼';
            valueEl.textContent = `${sign} ${Math.abs(diffPercent).toFixed(1)}%`;
            valueEl.className = 'var-value ' + (diffPercent >= 0 ? 'positive' : 'negative');
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
        const pagamento = paymentEl ? paymentEl.value : 'N/A';
        const customerEl = document.getElementById('pos-customer');
        let cliente = (customerEl && customerEl.value) || 'Consumidor Final';

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
            pagamento: pagamento,
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
                isDirectSale: false
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
        const salePayment = sale.pagamento || sale["Forma de Pagamento"] || 'N/A';

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
    renderProducts(query = '', category = '') {
        const container = document.getElementById('products-items-container');
        if (!container) return;

        let filtered = this.state.products.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));

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

            this.state.dataLoaded = true; // Forçar flag antes de salvar para evitar bloqueio

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
                this.state.dataLoaded = true; // Garantir flag
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
            const customer = {
                id: this.state.editingId || 'C' + Date.now().toString(),
                name: document.getElementById('cust-name').value.trim(),
                whatsapp: document.getElementById('cust-whatsapp').value.replace(/\D/g, ''),
                email: document.getElementById('cust-email').value.trim(),
                obs: document.getElementById('cust-obs').value.trim(),
                date: new Date().toISOString(),
                image: document.getElementById('cust-image-url').value
            };

            this.validate(customer, {
                name: { required: true, label: 'Nome' },
                whatsapp: { required: true, label: 'WhatsApp' }
            });

            if (this.state.editingId) {
                const index = this.state.customers.findIndex(c => c.id === this.state.editingId);
                if (index !== -1) this.state.customers[index] = customer;
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

    renderCustomers(query = '') {
        const container = document.getElementById('customers-items-container');
        if (!container) return;
        const filtered = this.state.customers.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-dim);">Nenhum cliente encontrado.</div>';
            return;
        }

        container.innerHTML = filtered.map(c => `
                <div class="nested-item-labs-row">
                    <span class="col-id" data-label="ID">#${c.id.toString().slice(-4)}</span>
                    <span class="col-name" data-label="NOME">${this.esc(c.name)}</span>
                    <span class="col-whatsapp" data-label="WHATSAPP">${this.formatWhatsApp(c.whatsapp)}</span>
                    <span class="col-date" data-label="DATA">${this.parseDate(c.date) ? this.parseDate(c.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'N/A'}</span>
                    <span class="col-obs" data-label="OBS/ENDEREÇO">${this.esc(c.obs) || 'Sem observação'}</span>
                    <div class="col-actions" data-label="AÇÕES">
                        <button class="btn-action-edit" onclick="app.editCustomer('${c.id}')"><i data-lucide="edit-3"></i></button>
                        <button class="btn-action-delete" onclick="app.deleteCustomer('${c.id}')"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
            `).join('');
        this.initLucide();
    },

    async deleteCustomer(id) {
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
                const dStr = d.toISOString().split('T')[0];
                return dStr === dateQuery;
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
            const pagamento = s.pagamento || s["Forma de Pagamento"] || 'N/A';
            const itemsCount = s.items ? s.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0) : 0;

            return `
                <div class="nested-item-labs-row">
                    <span class="col-id" data-label="ID">#${id.toString().slice(-4)}</span>
                    <span class="col-date" data-label="DATA">${this.parseDate(date) ? this.parseDate(date).toLocaleDateString('pt-BR') : 'N/A'}</span>
                    <span class="col-name" data-label="CLIENTE">${this.esc(cliente)}</span>
                    <span class="col-subtotal" data-label="TOTAL">${this.formatCurrency(subtotal)}</span>
                    <span class="col-discount" data-label="DESC.">${this.formatCurrency(desconto)}</span>
                    <span class="col-total-final" data-label="FINAL">${this.formatCurrency(totalFinal)}</span>
                    <span class="col-cost" data-label="CUSTO">${this.formatCurrency(custo)}</span>
                    <span class="col-profit" data-label="LUCRO">${this.formatCurrency(lucro)}</span>
                    <div class="col-items-action" data-label="ITENS">
                        <button class="btn-items-visualizer" onclick="app.showSaleDetails('${id}')" title="Ver Itens">
                            <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
                            <span>Itens (${itemsCount})</span>
                        </button>
                    </div>
                    <span class="col-payment" data-label="PAGAMENTO">${this.esc(pagamento)}</span>
                    <div class="col-actions" data-label="AÇÕES">
                        <button class="btn-action-edit" title="Gerar Recibo" onclick="app.openReceiptOptions('${id}')"><i data-lucide="printer"></i></button>
                        <button class="btn-action-delete" title="Excluir Venda" onclick="app.deleteSale('${id}')"><i data-lucide="trash-2"></i></button>
                    </div>
                </div>
                `;
        }).join('');
        this.initLucide();
    },

    async deleteSale(id) {
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

        // Renderizar
        if (notifications.length > 0) {
            badge.textContent = notifications.length;
            badge.classList.remove('hidden');

            // Cor do badge (prioridade vermelho > amarelo > azul)
            if (notifications.some(n => n.level === 'red')) {
                badge.style.background = '#b5676a';
            } else if (notifications.some(n => n.level === 'yellow')) {
                badge.style.background = '#d4a75a';
            } else {
                badge.style.background = '#8a9099';
            }

            list.innerHTML = notifications.map((n, index) => `
                <div class="notification-item" id="notif-item-${index}">
                    <div class="notif-icon ${n.level}">
                        <i data-lucide="${n.icon}"></i>
                    </div>
                    <div class="notif-content">
                        <span class="notif-title">${n.title}</span>
                        <span class="notif-desc">${n.desc}</span>
                    </div>
                </div>
            `).join('');

            // Adicionar eventos de clique
            notifications.forEach((n, index) => {
                const el = document.getElementById(`notif-item-${index}`);
                if (el) {
                    el.onclick = () => {
                        n.action();
                        document.getElementById('notification-dropdown').classList.add('hidden');
                    };
                }
            });

            this.initLucide();
        } else {
            badge.classList.add('hidden');
            list.innerHTML = '<div class="empty-notif-msg">Sem novas notificações</div>';
        }
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
            okBtn.textContent = 'Confirmar';
            okBtn.onclick = null;
        }
        if (cancelBtn) {
            cancelBtn.textContent = 'Cancelar';
            cancelBtn.onclick = () => this.closeModal();
        }

        // Garantir que todos os modais internos estejam escondidos
        const modals = ['product-modal', 'customer-modal', 'stock-modal', 'receipt-confirm-modal', 'tutorial-modal', 'stock-alerts-modal', 'sale-details-modal', 'confirm-remove-logo', 'backup-modal', 'categories-modal', 'user-modal', 'generic-confirm-modal', 'generic-alert-modal', 'product-history-modal'];
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
        if (select) select.innerHTML = '<option value="">Consumidor Final</option>' + this.state.customers.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
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
                view: 'dashboard',
                highlight: ['button[data-view="dashboard"]']
            },
            {
                title: 'Navegação (menu lateral)',
                desc: 'Use o menu lateral para alternar entre as áreas: Dashboard, PDV, Resumo, Produtos, Clientes, Saídas e Entradas.',
                icon: 'layout-dashboard',
                view: 'dashboard',
                highlight: ['.sidebar .nav-links']
            },
            {
                title: 'Barra superior (tema e alertas)',
                desc: 'Aqui você alterna o tema e vê notificações do sistema (ex.: estoque baixo e alertas de configuração).',
                icon: 'sun',
                view: 'dashboard',
                highlight: ['#btn-theme-toggle', '#btn-notifications']
            },
            {
                title: 'Dashboard: leitura rápida',
                desc: 'Acompanhe os indicadores principais e a evolução do negócio em tempo real.',
                icon: 'layout-grid',
                view: 'dashboard',
                highlight: ['#dashboard-view .stats-grid-labs']
            },
            {
                title: 'Dashboard: filtros do gráfico',
                desc: 'No gráfico "Evolução de Vendas", alterne o conjunto de dados (Faturamento/Lucro/Custo) e o período para comparar resultados.',
                icon: 'line-chart',
                view: 'dashboard',
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
                title: 'Resumo de vendas',
                desc: 'Veja o total de vendas por forma de pagamento (dinheiro, cartão e Pix) em um dia ou em um período.',
                icon: 'receipt',
                view: 'resumo',
                highlight: ['#resumo-content']
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
                title: 'Configurações: Aparência',
                desc: 'Alterne entre tema claro e escuro. O tema também impacta a leitura do dashboard e gráficos.',
                icon: 'monitor',
                view: 'settings',
                settingsSection: 'aparencia',
                highlight: ['#sv-section-aparencia', '#appearance-theme-toggle']
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
                view: 'dashboard',
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
                desc: 'Informe pagamento, desconto e finalize a venda. Em dinheiro, informe o valor pago para calcular o troco.',
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

    renderEntradas(query = '', dateFilter = '') {
        const container = document.getElementById('entradas-items-container');
        if (!container) return;

        let filtered = this.state.entradas;

        if (query) {
            const q = query.toLowerCase();
            filtered = filtered.filter(e =>
                e.id.toLowerCase().includes(q) ||
                (e.fornecedor && e.fornecedor.toLowerCase().includes(q)) ||
                (e.nota && e.nota.toLowerCase().includes(q))
            );
        }

        if (dateFilter) {
            filtered = filtered.filter(e => e.date.startsWith(dateFilter));
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-dim);">Nenhuma entrada encontrada.</div>';
            return;
        }

        container.innerHTML = filtered.map(e => `
            <div class="nested-item-labs-row">
                <span class="col-id" data-label="ID">#${e.id.toString().slice(-6)}</span>
                <span class="col-date" data-label="DATA">${new Date(e.date).toLocaleString()}</span>
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
    renderEstoque() {
        const grid = document.getElementById('estoque-grid');
        if (!grid) return;

        const n = this.state.settings.notifications || {};
        const baixo = Number(n.stockLowVal) || 10;
        const medio = Number(n.stockMediumVal) || 25;
        const nivel = (p) => (p.stock < baixo ? 'baixo' : p.stock < medio ? 'medio' : 'ok');
        const rotulo = { baixo: 'Baixo', medio: 'Médio', ok: 'Normal' };

        const busca = (document.getElementById('filter-estoque')?.value || '').trim().toLowerCase();
        const ordem = document.getElementById('sort-estoque')?.value || 'estoque';

        const contagem = { baixo: 0, medio: 0, ok: 0 };
        this.state.products.forEach(p => { contagem[nivel(p)]++; });
        const resumo = document.getElementById('estoque-resumo');
        if (resumo) resumo.textContent = `${contagem.baixo} baixo · ${contagem.medio} médio · ${contagem.ok} normal`;

        const lista = this.state.products
            .filter(p => !busca || (p.name || '').toLowerCase().includes(busca) || String(p.code || '').toLowerCase().includes(busca))
            .sort(ordem === 'nome'
                ? (a, b) => (a.name || '').localeCompare(b.name || '')
                : (a, b) => (a.stock - b.stock) || (a.name || '').localeCompare(b.name || ''));

        if (lista.length === 0) {
            grid.innerHTML = '<div class="pos-empty">Nenhum produto encontrado.</div>';
            return;
        }

        grid.innerHTML = lista.map(p => {
            const nv = nivel(p);
            const foto = p.image
                ? `<img src="${p.image}" alt="">`
                : `<span class="estoque-letter">${this.esc((p.name || '?').charAt(0).toUpperCase())}</span>`;
            return `
                <div class="estoque-card estoque-${nv}">
                    <div class="estoque-foto">${foto}</div>
                    <div class="estoque-info">
                        <span class="estoque-nome" title="${this.esc(p.name)}">${this.esc(p.name)}</span>
                        <span class="estoque-cod">${this.esc(p.code)}</span>
                    </div>
                    <div class="estoque-qtd">
                        <strong>${p.stock}</strong>
                        <span>${rotulo[nv]}</span>
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
