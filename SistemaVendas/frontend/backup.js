/*
 * Validação de arquivos de backup (módulo puro, sem DOM).
 * Usado pelo app.js antes de qualquer restauração. Uso no Node: require('./backup.js').
 */
(function (raiz) {
    'use strict';

    const VERSOES = ['SV_ULTRA_V4', 'SV_ULTRA_V4_IMG'];

    // Obrigatórias: um backup sem elas apagaria dados ao ser restaurado.
    const OBRIGATORIAS = ['products', 'customers', 'sales'];
    // Opcionais: backups antigos podem não ter essas coleções.
    const OPCIONAIS = ['reversals', 'entradas', 'movimentacoes', 'categories'];
    const COLECOES = OBRIGATORIAS.concat(OPCIONAIS);

    const erro = (mensagem) => ({ ok: false, erro: mensagem });

    const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

    // obj: JSON já convertido. checksumCalculado: hash recalculado pelo app (só quando o arquivo traz checksum).
    function validarBackup(obj, checksumCalculado) {
        if (!ehObjeto(obj)) return erro('O arquivo não é um backup do SV Ultra.');
        if (!VERSOES.includes(obj.version)) return erro('Versão de backup incompatível.');

        const st = obj.state;
        if (!ehObjeto(st)) return erro('Backup sem dados.');

        if (obj.checksum !== undefined && checksumCalculado !== undefined && obj.checksum !== checksumCalculado) {
            return erro('Backup corrompido ou modificado. Restauração cancelada por segurança.');
        }

        for (const nome of OBRIGATORIAS) {
            if (!Array.isArray(st[nome])) return erro(`Backup sem a lista "${nome}".`);
        }
        for (const nome of COLECOES) {
            const v = st[nome];
            if (v === undefined || v === null) continue;
            if (!Array.isArray(v)) return erro(`Dados de "${nome}" inválidos.`);
            if (!v.every(ehObjeto)) return erro(`Itens inválidos em "${nome}".`);
        }
        if (st.settings !== undefined && st.settings !== null && !ehObjeto(st.settings)) {
            return erro('Configurações inválidas no backup.');
        }
        if (obj.media !== undefined && obj.media !== null && !ehObjeto(obj.media)) {
            return erro('Imagens inválidas no backup.');
        }

        const contagem = {};
        for (const nome of COLECOES) contagem[nome] = Array.isArray(st[nome]) ? st[nome].length : 0;

        return { ok: true, contagem: contagem, data: obj.exportedAt || obj.date || null };
    }

    const api = { VERSOES: VERSOES, COLECOES: COLECOES, validarBackup: validarBackup };

    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.Backup = api;
})(typeof window !== 'undefined' ? window : globalThis);
