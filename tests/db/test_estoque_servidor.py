"""
Espelho em Python da validação de estoque do servidor (SV.Api/Servicos/Dados.cs:
ValidarEstoque, SimularMudanca, EstourosDoLivro). Testa a regra, não o C# em si.
Uso: python3 tests/db/test_estoque_servidor.py
"""
import copy
import json


def simular_mudanca(atuais, mudanca):
    if "full" in mudanca:
        return copy.deepcopy(mudanca["full"])
    lista = copy.deepcopy(atuais)
    if "delete" in mudanca:
        ids = set(str(i) for i in mudanca["delete"])
        lista = [m for m in lista if str(m.get("id", "")) not in ids]
    if "upsert" in mudanca:
        for item in mudanca["upsert"]:
            idx = next((i for i, m in enumerate(lista) if str(m.get("id", "")) == str(item["id"])), -1)
            if idx >= 0:
                lista[idx] = copy.deepcopy(item)
            else:
                lista.append(copy.deepcopy(item))
    if "order" in mudanca:
        pos = {str(id_): i for i, id_ in enumerate(mudanca["order"])}
        listados = sorted((m for m in lista if str(m.get("id", "")) in pos), key=lambda m: pos[str(m["id"])])
        resto = [m for m in lista if str(m.get("id", "")) not in pos]
        lista = listados + resto
    return lista


def estouros(livro, saldos=None):
    if saldos is None:
        saldos = {}
    resultado = []
    for mov in livro:
        if mov.get("ignorada") is True:
            continue
        produto = str(mov.get("produtoId", ""))
        tipo = mov.get("tipo", "")
        qtd = mov.get("qtd", 0)
        saldo = max(0, saldos.get(produto, 0))
        if tipo == "saldo_inicial":
            saldos[produto] = max(0, qtd)
        elif tipo == "ajuste_custo":
            pass
        elif tipo == "entrada":
            saldos[produto] = saldo + qtd
        else:
            if saldo + qtd < 0:
                resultado.append((str(mov["id"]), produto))
            saldos[produto] = max(0, saldo + qtd)
    return resultado


def saldos_do_livro(livro):
    saldos = {}
    estouros(livro, saldos)
    return saldos


def corrigir_estoque(produtos_banco, mud_products, livro):
    """Espelho de Dados.CorrigirSaldos. Devolve a lista de produtos gravados (upsert/full ajustados + extras)."""
    saldos = saldos_do_livro(livro)
    if not saldos:
        return {"upsert": mud_products.get("upsert", [])} if mud_products else None
    enviados = set()
    mud = copy.deepcopy(mud_products) if mud_products else None
    if mud:
        for chave in ("full", "upsert"):
            for item in mud.get(chave, []):
                enviados.add(str(item["id"]))
                if str(item["id"]) in saldos:
                    item["stock"] = saldos[str(item["id"])]
    extras = []
    for p in produtos_banco:
        pid = str(p["id"])
        if pid not in saldos or pid in enviados:
            continue
        esperado = round(saldos[pid])
        if abs(p.get("stock", 0) - esperado) < 0.0001:
            continue
        copia = copy.deepcopy(p)
        copia["stock"] = esperado
        extras.append(copia)
    if extras:
        mud = mud or {}
        if "upsert" in mud:
            mud["upsert"] = mud["upsert"] + extras
        else:
            mud["upsert"] = extras
    return mud


def validar(atuais, mudanca):
    """Devolve None se a gravação pode entrar; senão, (id da movimentação, produto) do estouro novo."""
    antes = set(e[0] for e in estouros(atuais))
    for e in estouros(simular_mudanca(atuais, mudanca)):
        if e[0] not in antes:
            return e
    return None


def mov(id_, tipo, qtd, produto="P1", **extra):
    m = {"id": id_, "produtoId": produto, "tipo": tipo, "qtd": qtd, "date": "2026-11-19"}
    m.update(extra)
    return m


def inserir(*movs):
    return {"upsert": list(movs)}


testes = []


def teste(fn):
    testes.append(fn)
    return fn


@teste
def venda_que_cabe_no_saldo_passa():
    atuais = [mov("M1", "entrada", 5)]
    assert validar(atuais, inserir(mov("M2", "venda", -3))) is None


@teste
def venda_acima_do_saldo_e_recusada():
    atuais = [mov("M1", "entrada", 2)]
    assert validar(atuais, inserir(mov("M2", "venda", -3))) == ("M2", "P1")


@teste
def dois_pcs_vendendo_o_mesmo_estoque_o_segundo_e_recusado():
    atuais = [mov("M1", "entrada", 3)]
    # PC A grava primeiro: venda de 2, aceita e já no banco
    atuais = atuais + [mov("M2", "venda", -2)]
    # PC B tinha saldo 3 na tela e tenta vender 2: o servidor recusa
    assert validar(atuais, inserir(mov("M3", "venda", -2))) == ("M3", "P1")


@teste
def estorno_sempre_passa():
    atuais = [mov("M1", "entrada", 1), mov("M2", "venda", -1)]
    assert validar(atuais, inserir(mov("M3", "estorno", 1))) is None


@teste
def ignorar_entrada_que_sustenta_venda_posterior_e_recusado():
    atuais = [mov("M1", "entrada", 2), mov("M2", "venda", -2)]
    assert validar(atuais, inserir(mov("M1", "entrada", 2, ignorada=True))) == ("M2", "P1")


@teste
def saida_antiga_ja_inconsistente_nao_bloqueia_outra_gravacao():
    # M2 já estourou antes da validação existir (dado antigo)
    atuais = [mov("M1", "entrada", 1), mov("M2", "venda", -3)]
    assert validar(atuais, inserir(mov("M3", "entrada", 5))) is None
    # e reenviar a mesma M2 sem mudança também não é bloqueado
    assert validar(atuais, inserir(mov("M2", "venda", -3))) is None


@teste
def produtos_sao_independentes():
    atuais = [mov("M1", "entrada", 5, produto="P1"), mov("M2", "entrada", 0 + 1, produto="P2")]
    assert validar(atuais, inserir(mov("M3", "venda", -2, produto="P1"))) is None
    assert validar(atuais, inserir(mov("M3", "venda", -2, produto="P2"))) == ("M3", "P2")


@teste
def delete_de_entrada_que_deixa_venda_sem_saldo_e_recusado():
    atuais = [mov("M1", "entrada", 2), mov("M2", "venda", -2)]
    assert validar(atuais, {"delete": ["M1"]}) == ("M2", "P1")


@teste
def ordem_nao_altera_saldo_quando_a_entrada_vem_antes():
    atuais = [mov("M2", "venda", -2), mov("M1", "entrada", 2)]
    # a venda antes da entrada estoura; a ordem nova corrige
    assert validar(atuais, {"order": ["M1", "M2"]}) is None


@teste
def saldo_inicial_e_ajuste_positivo_passam():
    assert validar([], inserir(mov("M1", "saldo_inicial", 4, custoUnit=2.0))) is None
    assert validar([mov("M1", "saldo_inicial", 4, custoUnit=2.0)], inserir(mov("M2", "ajuste", -4))) is None
    assert validar([mov("M1", "saldo_inicial", 4, custoUnit=2.0)], inserir(mov("M2", "ajuste", -5))) == ("M2", "P1")


@teste
def json_do_frontend_e_lido_como_no_servidor():
    # formato enviado por montarMudancas: upsert com itens completos e campos extras
    payload = json.loads('{"movimentacoes":{"upsert":[{"id":"M9","produtoId":"P1","tipo":"venda","qtd":-1,"ignorada":false}]}}')
    assert validar([mov("M1", "entrada", 1)], payload["movimentacoes"]) is None


def produto(id_, stock):
    return {"id": id_, "name": "P" + id_, "stock": stock, "cost": 1.0, "price": 2.0}


@teste
def produto_enviado_com_estoque_desatualizado_recebe_o_saldo_das_movimentacoes():
    livro = [mov("M1", "entrada", 5)]
    mud = corrigir_estoque([produto("P1", 5)], {"upsert": [produto("P1", 9)]}, livro)
    assert mud["upsert"][0]["stock"] == 5


@teste
def produto_nao_enviado_com_estoque_errado_entra_com_o_registro_completo():
    livro = [mov("M1", "entrada", 5)]
    mud = corrigir_estoque([produto("P1", 9)], None, livro)
    assert mud["upsert"][0]["stock"] == 5
    assert mud["upsert"][0]["name"] == "PP1" and mud["upsert"][0]["price"] == 2.0, "registro completo, não só o estoque"


@teste
def produto_sem_historico_nao_e_alterado():
    livro = [mov("M1", "entrada", 5, produto="P1")]
    assert corrigir_estoque([produto("P2", 7)], None, livro) is None


@teste
def produto_com_estoque_certo_nao_gera_gravacao():
    livro = [mov("M1", "entrada", 5)]
    assert corrigir_estoque([produto("P1", 5)], None, livro) is None


@teste
def envio_completo_tem_todos_os_produtos_com_saldo_certo():
    livro = [mov("M1", "entrada", 5), mov("M2", "venda", -2)]
    mud = corrigir_estoque([produto("P1", 3)], {"full": [produto("P1", 9)]}, livro)
    assert mud["full"][0]["stock"] == 3


@teste
def saldo_negativo_nao_acontece_e_a_saida_antiga_conta_como_zero():
    livro = [mov("M1", "entrada", 1), mov("M2", "venda", -3)]
    assert saldos_do_livro(livro)["P1"] == 0


if __name__ == "__main__":
    falhas = 0
    for fn in testes:
        try:
            fn()
            print("OK    " + fn.__name__)
        except AssertionError as e:
            falhas += 1
            print("FALHA " + fn.__name__ + " " + str(e))
    print("\nTodos os testes de estoque no servidor passaram." if falhas == 0 else f"\n{falhas} falha(s).")
    raise SystemExit(1 if falhas else 0)
