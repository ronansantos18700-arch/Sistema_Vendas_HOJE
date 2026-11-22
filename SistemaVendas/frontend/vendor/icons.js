/*
 * Ícones do sistema: Boxicons 2.1.2 (pasta vendor/boxicons, sem internet).
 * Mantém a API lucide.createIcons() usada pelo app: cada <i data-lucide="nome"> vira
 * <i class="bx bx-..."> no mesmo elemento. Os nomes do app continuam os mesmos.
 */
(function (global) {
    var MAPA = {
        'x': 'bx-x',
        'trash-2': 'bx-trash',
        'eye': 'bx-show',
        'eye-off': 'bx-hide',
        'plus': 'bx-plus',
        'plus-circle': 'bx-plus-circle',
        'minus': 'bx-minus',
        'printer': 'bx-printer',
        'help-circle': 'bx-help-circle',
        'edit': 'bx-edit',
        'edit-3': 'bx-edit',
        'shopping-bag': 'bx-shopping-bag',
        'receipt': 'bx-receipt',
        'package': 'bx-package',
        'package-plus': 'bx-package',
        'boxes': 'bx-package',
        'box': 'bx-box',
        'menu': 'bx-menu',
        'image': 'bx-image',
        'chevron-right': 'bx-chevron-right',
        'chevron-left': 'bx-chevron-left',
        'alert-triangle': 'bx-error',
        'alert-circle': 'bx-error-circle',
        'wrench': 'bx-wrench',
        'users': 'bx-group',
        'user': 'bx-user',
        'user-plus': 'bx-user-plus',
        'user-cog': 'bx-user-check',
        'upload': 'bx-upload',
        'upload-cloud': 'bx-cloud-upload',
        'download': 'bx-download',
        'trending-up': 'bx-trending-up',
        'tag': 'bx-purchase-tag',
        'shield-check': 'bx-shield-quarter',
        'settings': 'bx-cog',
        'search': 'bx-search',
        'refresh-ccw': 'bx-refresh',
        'moon': 'bx-moon',
        'sun': 'bx-sun',
        'monitor': 'bx-desktop',
        'log-out': 'bx-log-out',
        'layout-dashboard': 'bx-grid-alt',
        'layout-grid': 'bx-grid-alt',
        'info': 'bx-info-circle',
        'history': 'bx-history',
        'database': 'bx-data',
        'calculator': 'bx-calculator',
        'building-2': 'bx-building',
        'bell': 'bx-bell',
        'bell-ring': 'bx-bell',
        'banknote': 'bx-money',
        'line-chart': 'bx-line-chart',
        'credit-card': 'bx-credit-card',
    'file-text': 'bx-file',
    'file-spreadsheet': 'bx-spreadsheet',
    'bar-chart': 'bx-bar-chart-alt-2',
    'pie-chart': 'bx-pie-chart-alt-2',
    'calendar': 'bx-calendar',
    'check-square': 'bx-check-square'
    };
    var FALLBACK = 'bx-square-rounded';

    function converter(el) {
        var nome = el.getAttribute('data-lucide');
        if (!nome) return;
        var classe = MAPA[nome] || FALLBACK;
        Array.prototype.slice.call(el.classList).forEach(function (c) {
            if (c === 'bx' || c.indexOf('bx-') === 0) el.classList.remove(c);
        });
        el.classList.add('bx', classe);
        // Boxicons é fonte: o tamanho vem de font-size. Se o elemento tem width inline, o glifo acompanha.
        if (el.style && el.style.width) el.style.fontSize = el.style.width;
        el.removeAttribute('data-lucide');
    }

    global.lucide = {
        createIcons: function (opcoes) {
            var raiz = (opcoes && opcoes.root) || document;
            if (raiz.getAttribute && raiz.getAttribute('data-lucide')) converter(raiz);
            if (raiz.querySelectorAll) {
                Array.prototype.slice.call(raiz.querySelectorAll('[data-lucide]')).forEach(converter);
            }
        }
    };
})(typeof window !== 'undefined' ? window : this);
