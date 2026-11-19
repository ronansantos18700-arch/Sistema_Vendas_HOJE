// Confere o SHA-256 em JS puro com o do Node (crypto), em vários tamanhos e com acentos.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { sha256Hex } = require(path.join(__dirname, '..', '..', 'SistemaVendas', 'frontend', 'sha256.js'));

let ok = 0;
function check(nome, fn) {
    fn();
    ok++;
    console.log('OK    ' + nome);
}

check('vetor conhecido: "abc"', () => {
    assert.strictEqual(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

check('texto vazio', () => {
    assert.strictEqual(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

check('tamanhos de 0 a 300 bytes (bordas de bloco de 55, 56, 63, 64 bytes)', () => {
    for (let n = 0; n <= 300; n++) {
        const texto = 'a'.repeat(n);
        const esperado = crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
        assert.strictEqual(sha256Hex(texto), esperado, 'tamanho ' + n);
    }
});

check('texto com acentos e emoji (UTF-8)', () => {
    const textos = ['Ração para cães — R$ 12,50', 'Vendas do dia 14/11/2026', '🛒 promoção ção', 'çãõéíóú'];
    for (const t of textos) {
        assert.strictEqual(sha256Hex(t), crypto.createHash('sha256').update(t, 'utf8').digest('hex'), t);
    }
});

check('JSON grande (formato do backup)', () => {
    const dados = { state: Array.from({ length: 2000 }, (_, i) => ({ id: 'P' + i, name: 'Produto ' + i, price: i * 1.5 })) };
    const texto = JSON.stringify(dados);
    assert.strictEqual(sha256Hex(texto), crypto.createHash('sha256').update(texto, 'utf8').digest('hex'));
});

console.log('\n' + ok + ' verificações OK');
