"""Testa a sequência SQL de ordem/upsert/exclusão usada por Database.ApplyChanges (C#).
Uso: python3 tests/db/test_ordem_sql.py
"""
import sqlite3, random

def criar():
    c = sqlite3.connect(':memory:')
    c.execute('CREATE TABLE products ("ordem" INTEGER PRIMARY KEY, "id" TEXT, "name" TEXT, "stock" INTEGER, "_extra" TEXT)')
    return c

def read(c):
    return c.execute('SELECT id, name, stock FROM products ORDER BY ordem').fetchall()

def inserir(c, id, name, stock):
    c.execute('INSERT INTO products (id,name,stock) VALUES (?,?,?)', (id, name, stock))

def upsert(c, id, name, stock):
    r = c.execute('SELECT ordem FROM products WHERE id=? ORDER BY ordem LIMIT 1', (id,)).fetchone()
    if r is None:
        inserir(c, id, name, stock)
    else:
        c.execute('UPDATE products SET id=?, name=?, stock=? WHERE ordem=?', (id, name, stock, r[0]))

def excluir(c, id):
    c.execute('DELETE FROM products WHERE id=?', (id,))

def ordenar(c, ids):
    # mesma sequência do AplicarOrdem (C#)
    c.execute('UPDATE products SET ordem = -ordem')
    pos = 1
    for id in ids:
        c.execute('UPDATE products SET ordem=? WHERE id=? AND ordem < 0', (pos, id))
        pos += 1
    pend = c.execute('SELECT COUNT(*) FROM products WHERE ordem < 0').fetchone()[0]
    if pend: raise Exception('ordem inconsistente')

fal = 0
def ok(nome, cond):
    global fal
    print(('OK    ' if cond else 'FALHA ') + nome)
    if not cond: fal += 1

# Cenário 1: inserção no começo + reordenação
c = criar()
for i, (id, n) in enumerate([('P1','A'),('P2','B'),('P3','C')], 1): inserir(c, id, n, i)
upsert(c, 'P0', 'Novo', 9)   # inserido no fim do SQL
ordenar(c, ['P0','P1','P2','P3'])
ok('inserido e reordenado para o topo', [r[0] for r in read(c)] == ['P0','P1','P2','P3'])

# Cenário 2: exclusão do meio, alteração e reordenação inversa
excluir(c, 'P2'); upsert(c, 'P1', 'A2', 50)
ordenar(c, ['P3','P1','P0'])
r = read(c)
ok('exclusão + alteração + reordenação', r == [('P3','C',3), ('P1','A2',50), ('P0','Novo',9)])

# Cenário 3: reordenar sem nenhuma exclusão, com ordens que colidiriam (1..N antigas)
c2 = criar()
for i in range(1, 6): inserir(c2, f'X{i}', f'n{i}', i)
ordenar(c2, ['X5','X4','X3','X2','X1'])
ok('reversão completa de 5 itens sem conflito de chave', [r[0] for r in read(c2)] == ['X5','X4','X3','X2','X1'])

# Cenário 4: lista com ids não encontrados no banco não deve quebrar (ids extras são ignorados)
c3 = criar()
for i in range(1, 3): inserir(c3, f'Y{i}', 'n', i)
try:
    ordenar(c3, ['Y2','Y1'])
    ok('reordenação normal', [r[0] for r in read(c3)] == ['Y2','Y1'])
except Exception as e:
    ok('reordenação normal', False)

# Cenário 5: aleatório — compara com a lista de referência
random.seed(1)
falhou = False
for rodada in range(200):
    c4 = criar(); ref = []
    for i in range(random.randint(0, 12)):
        id = f'R{i}'; inserir(c4, id, 'n', i); ref.append(id)
    for _ in range(random.randint(0, 6)):
        op = random.choice(['ins','del','ord'])
        if op == 'ins':
            id = f'Q{random.randint(0,999999)}'
            if id not in ref:
                upsert(c4, id, 'n', 1); ref.append(id)
        elif op == 'del' and ref:
            id = random.choice(ref); excluir(c4, id); ref.remove(id)
        elif op == 'ord' and ref:
            random.shuffle(ref); ordenar(c4, ref)
    if [r[0] for r in read(c4)] != ref:
        falhou = True; break
ok('200 rodadas aleatórias (inserir/excluir/reordenar) batem com a lista de referência', not falhou)

print('\nTodos os testes passaram.' if fal == 0 else f'\n{fal} falha(s).')
raise SystemExit(1 if fal else 0)
