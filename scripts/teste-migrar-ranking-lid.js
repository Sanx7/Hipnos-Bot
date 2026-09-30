// ============================================================
// 🧪 teste-migrar-ranking-lid.js — a migração LID→número do /ranking
// ============================================================
// Roda 100% offline: o migrador recebe DUAS coleções em memória
// (__definirColecoesTeste) com o contrato mínimo do driver MongoDB — inclusive
// o ÍNDICE ÚNICO (grupo_id, usuario_id), que é o que faz a corrida com o bot
// estourar E11000, e o `findOneAndDelete`, usado para capturar o total final.
//
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require): o config.js
// carrega o .env da raiz e o teste promete não tocar em nenhum banco real.
//
// Cobre: par COMPROVADO renomeia; par comprovado com documento no telefone
// FUNDE e SOMA; par SEM prova dupla é ignorado; dry-run não escreve nada;
// backup é gravado antes de escrever; idempotência (2ª rodada não soma de
// novo); E11000 cai no caminho de fusão; LID órfão fica como está.
// Uso: node scripts/teste-migrar-ranking-lid.js
// ============================================================

process.env.MONGODB_URI = ''

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  __definirColecoesTeste,
  lerMapeamentoComprovado,
  montarPlano,
  simularResultado,
  mascarar,
  gravarBackup,
  migrar,
  fundir
} = require('./migrar-ranking-lid')

const GRUPO = '120363000000000001@g.us'
const OUTRO_GRUPO = '120363000000000002@g.us'
const LID_A = '175952680210489'
const LID_B = '175952680210490'
const LID_ORFAO = '175911111111149'   // 15 dígitos, como um LID de verdade
const TEL_A = '554184062975'
const TEL_B = '5541999999999'

let reprovadas = 0
async function testar (nome, fn) {
  try {
    await fn()
    console.log('PASSOU: ' + nome)
  } catch (err) {
    reprovadas += 1
    console.log('FALHOU: ' + nome + ' :: ' + (err?.message || err))
  }
}
function exigir (cond, detalhe) { if (!cond) throw new Error(detalhe || 'condicao falsa') }

// ─── 🗄️ Coleção em memória com o contrato do driver (índice único incluso) ───
function criarColecao (docsIniciais = []) {
  const documentos = new Map()
  let sequencia = 0
  const chaveDe = (doc) => `${doc.grupo_id}|${doc.usuario_id}`
  const casa = (doc, filtro) =>
    Object.entries(filtro || {}).every(([campo, valor]) => {
      if (valor && typeof valor === 'object' && !Array.isArray(valor) && valor.$regex) {
        return new RegExp(valor.$regex).test(String(doc[campo]))
      }
      return doc[campo] === valor
    })
  const semIndice = () => {}
  void semIndice
  for (const doc of docsIniciais) documentos.set(String(doc._id), { ...doc })

  return {
    _docs: documentos,
    async findOne (filtro) {
      for (const doc of documentos.values()) if (casa(doc, filtro)) return { ...doc }
      return null
    },
    // 🪟 No driver real `find()` devolve um CURSOR (não uma Promise) — por isso
    //    aqui também: é o cursor que tem `.toArray()`.
    find (filtro) {
      return {
        async toArray () {
          return [...documentos.values()].filter((d) => casa(d, filtro)).map((d) => ({ ...d }))
        }
      }
    },
    async updateOne (filtro, atualizacao) {
      // 🧨 FIDELIDADE AO MONGO: o índice único (grupo_id, usuario_id) é testado
      // ANTES de aplicar. É ele que devolve E11000 quando o bot criou o
      // documento do telefone entre o findOne e esta escrita (a corrida que o
      // migrador trata caindo no caminho de fusão).
      if (atualizacao.$set && atualizacao.$set.usuario_id !== undefined) {
        let alvo = null
        for (const doc of documentos.values()) if (casa(doc, filtro)) { alvo = doc; break }
        if (alvo) {
          // O filtro pode ser só pelo _id (o renomear do migrador): o grupo vem
          // do próprio documento.
          const grupo = filtro.grupo_id ?? alvo.grupo_id
          for (const [chave, doc] of documentos) {
            if (doc === alvo) continue
            if (chaveDe(doc) === `${grupo}|${atualizacao.$set.usuario_id}`) {
              const err = new Error('E11000 duplicate key error collection')
              err.code = 11000
              throw err
            }
          }
        }
      }
      for (const doc of documentos.values()) {
        if (!casa(doc, filtro)) continue
        if (atualizacao.$set) Object.assign(doc, atualizacao.$set)
        if (atualizacao.$max) {
          for (const [campo, valor] of Object.entries(atualizacao.$max)) {
            doc[campo] = Math.max(Number(doc[campo]) || 0, valor)
          }
        }
        if (atualizacao.$inc) {
          for (const [campo, valor] of Object.entries(atualizacao.$inc)) {
            doc[campo] = (Number(doc[campo]) || 0) + valor
          }
        }
        return { matchedCount: 1 }
      }
      return { matchedCount: 0 }
    },
    async findOneAndDelete (filtro) {
      for (const [chave, doc] of documentos) {
        if (!casa(doc, filtro)) continue
        documentos.delete(chave)
        return { ...doc }
      }
      return null
    }
  }
}

// 📦 Cenário pronto: sessão com PARES COMPROVADOS de A e B e um LID órfão
// (só a chave reversa, sem o par direto — logo, SEM prova dupla).
function cenario () {
  const ranking = criarColecao([
    { _id: 'r1', grupo_id: GRUPO, usuario_id: LID_A, nome: 'A pelo LID', total: 7, ultimaMensagem: 100, lid: LID_A },
    { _id: 'r2', grupo_id: GRUPO, usuario_id: TEL_B, nome: 'B pelo telefone', total: 3, ultimaMensagem: 200 },
    { _id: 'r3', grupo_id: GRUPO, usuario_id: LID_ORFAO, nome: 'Órfã', total: 2, ultimaMensagem: 50 },
    { _id: 'r4', grupo_id: OUTRO_GRUPO, usuario_id: LID_B, nome: 'B noutro grupo', total: 9, ultimaMensagem: 300 }
  ])
  const auth = criarColecao([
    { _id: `lid-mapping-${LID_A}_reverse`, __rawValue__: TEL_A },
    { _id: `lid-mapping-${TEL_A}`, __rawValue__: LID_A },
    { _id: `lid-mapping-${LID_B}_reverse`, __rawValue__: TEL_B },
    { _id: `lid-mapping-${TEL_B}`, __rawValue__: LID_B },
    { _id: `lid-mapping-${LID_ORFAO}_reverse`, __rawValue__: '555500000000' },   // sem par direto
    { _id: 'creds.currents', __rawValue__: 'lixo-que-nao-e-par' }
  ])
  return { ranking, auth }
}

const silencioso = () => {}

const docCom = (colecao, grupo, usuario) =>
  [...colecao._docs.values()].find((d) => d.grupo_id === grupo && d.usuario_id === usuario) || null

async function main () {
  console.log('Teste offline do migrar-ranking-lid.js (LID → número real)')

  await testar('mascarar: só os 4 últimos dígitos aparecem', async () => {
    const esperado = (id) => '*'.repeat(id.length - 4) + id.slice(-4)
    exigir(mascarar(TEL_A) === esperado(TEL_A), 'telefone não foi mascarado: ' + mascarar(TEL_A))
    exigir(mascarar(LID_A) === esperado(LID_A), 'lid não foi mascarado: ' + mascarar(LID_A))
    exigir(!mascarar(TEL_A).includes(TEL_A.slice(0, 6)), 'vazou o começo do número')
    exigir(mascarar('') === '', 'id vazio deveria virar string vazia')
  })

  await testar('sessão: só entra no mapa quem tem PROVA dupla (reverso + direto batendo)', async () => {
    const { auth } = cenario()
    const { comprovados, provados, paresNaSessao } = await lerMapeamentoComprovado(auth)
    exigir(comprovados.get(LID_A) === TEL_A, 'A deveria estar comprovado')
    exigir(comprovados.get(LID_B) === TEL_B, 'B deveria estar comprovado')
    exigir(!comprovados.has(LID_ORFAO), 'órfão entrou sem par direto: ' + JSON.stringify([...comprovados]))
    exigir(paresNaSessao === 3, 'LIDs na sessão: ' + paresNaSessao)
    exigir(provados === 2, 'pares comprovados: ' + provados)
  })

  await testar('plano: renomeia o que não tem par e funde o que já tem', async () => {
    const { ranking, auth } = cenario()
    const docs = [...ranking._docs.values()]
    const { comprovados } = await lerMapeamentoComprovado(auth)
    const { plano, semParComprovado, possiveisLids } = montarPlano(docs, comprovados)

    const acoes = plano.map((i) => i.doc._id + ':' + i.acao).sort()
    exigir(acoes.join(',') === 'r1:renomear,r4:renomear', 'plano inesperado: ' + acoes.join(','))
    // Mantidos: o órfão (só tem a chave reversa, sem prova dupla) e o documento
    // que JÁ está gravado pelo telefone — este não precisa de mapeamento nenhum.
    exigir(semParComprovado === 2, 'documentos mantidos: ' + semParComprovado)
    exigir(possiveisLids === 1, 'só o órfão tem cara de LID: ' + possiveisLids)
    exigir(plano.every((i) => i.doc.usuario_id !== LID_ORFAO), 'o órfão não pode entrar no plano')
  })

  await testar('simulação: a renomeação troca o id e preserva a contagem', async () => {
    const { ranking, auth } = cenario()
    const docs = [...ranking._docs.values()].map((d) => ({ ...d }))
    const { comprovados } = await lerMapeamentoComprovado(auth)
    const { plano } = montarPlano(docs, comprovados)

    const antes = docs.find((d) => d._id === 'r1')
    const depois = simularResultado(docs, plano).find((d) => d._id === 'r1')
    exigir(antes.usuario_id === LID_A && antes.total === 7, 'o "antes" mudou')
    exigir(depois.usuario_id === TEL_A, 'não renomeou na simulação: ' + depois.usuario_id)
    exigir(depois.total === 7, 'a renomeação não pode mexer na contagem: ' + depois.total)
  })

  await testar('simulação: a fusão soma os dois totais numa linha só', async () => {
    const docs = [
      { _id: 'r1', grupo_id: GRUPO, usuario_id: LID_A, nome: 'A pelo LID', total: 7, ultimaMensagem: 100 },
      { _id: 'r2', grupo_id: GRUPO, usuario_id: TEL_A, nome: 'A pelo telefone', total: 10, ultimaMensagem: 900 }
    ]
    const plano = [{ doc: docs[0], telefone: TEL_A, alvo: docs[1], acao: 'fundir' }]
    const depois = simularResultado(docs, plano)
    exigir(depois.length === 1, 'a pessoa ficou duplicada: ' + JSON.stringify(depois))
    exigir(depois[0].total === 17, 'não somou: ' + depois[0].total)
    exigir(depois[0].nome === 'A pelo telefone', 'o nome mais recente não valeu: ' + depois[0].nome)
  })

  await testar('DRY-RUN (padrão): imprime o plano e NÃO grava absolutamente nada', async () => {
    const { ranking, auth } = cenario()
    __definirColecoesTeste({ ranking, auth })
    const antes = JSON.stringify([...ranking._docs.entries()])

    const linhas = []
    const relatorio = await migrar({ log: (t) => linhas.push(t) })

    exigir(relatorio.aplicar === false, 'o dry-run não deveria aplicar')
    exigir(relatorio.backup === null, 'o dry-run não deveria gravar backup')
    exigir(relatorio.plano === 2, 'plano do dry-run: ' + relatorio.plano)
    exigir(JSON.stringify([...ranking._docs.entries()]) === antes, 'O DRY-RUN ALTEROU O BANCO')
    const texto = linhas.join('\n')
    exigir(texto.includes('DRY-RUN'), 'faltou avisar que é dry-run')
    exigir(!texto.includes(TEL_A.slice(0, 6)) && !texto.includes(LID_A), 'o relatório vazou um identificador sem máscara')
  })

  await testar('--aplicar: renomeia preservando o total e grava backup antes', async () => {
    const { ranking, auth } = cenario()
    __definirColecoesTeste({ ranking, auth })
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'migrar-ranking-'))

    const relatorio = await migrar({ aplicar: true, pastaBackup: pasta, log: silencioso })

    exigir(relatorio.aplicar === true, 'deveria ter aplicado')
    exigir(relatorio.renomeacoes === 2 && relatorio.fusoes === 0, 'contagem errada: ' + JSON.stringify(relatorio))
    const corrigido = docCom(ranking, GRUPO, TEL_A)
    exigir(corrigido, 'o documento do LID não virou telefone')
    exigir(corrigido.total === 7, 'a contagem se perdeu no renomear: ' + corrigido.total)
    exigir(corrigido.nome === 'A pelo LID', 'o nome mudou: ' + corrigido.nome)
    exigir(docCom(ranking, GRUPO, LID_A) === null, 'ainda existe documento sob o LID')
    exigir(docCom(ranking, GRUPO, LID_ORFAO) !== null, 'o órfão não pode ser tocado')

    exigir(relatorio.backup && fs.existsSync(relatorio.backup), 'backup não foi gravado')
    const conteudo = JSON.parse(fs.readFileSync(relatorio.backup, 'utf8'))
    exigir(conteudo.docs.length === 2, 'o backup não tem os 2 docs do plano: ' + conteudo.docs.length)
    fs.rmSync(pasta, { recursive: true, force: true })
  })

  await testar('fusão: soma os dois totais, guarda a data mais nova e o nome mais recente', async () => {
    const ranking = criarColecao([
      { _id: 'x1', grupo_id: GRUPO, usuario_id: LID_A, nome: 'A pelo LID', total: 7, ultimaMensagem: 500 },
      { _id: 'x2', grupo_id: GRUPO, usuario_id: TEL_A, nome: 'A pelo telefone', total: 10, ultimaMensagem: 100 }
    ])
    __definirColecoesTeste({ ranking, auth: criarColecao() })

    const resultado = await fundir(ranking, { doc: { ...ranking._docs.get('x1') }, telefone: TEL_A, acao: 'fundir' })
    exigir(resultado.acao === 'fundir', 'não fundiu: ' + JSON.stringify(resultado))
    exigir(ranking._docs.has('x1') === false, 'o documento do LID continua lá')
    const fundido = docCom(ranking, GRUPO, TEL_A)
    exigir(fundido.total === 17, 'os totais não foram somados: ' + fundido.total)
    exigir(fundido.ultimaMensagem === 500, 'a data mais nova não ficou: ' + fundido.ultimaMensagem)
    exigir(fundido.nome === 'A pelo LID', 'o nome do registro mais recente não valeu: ' + fundido.nome)
  })

  await testar('fusão com o telefone MAIS NOVO: o nome antigo do telefone é preservado', async () => {
    const ranking = criarColecao([
      { _id: 'y1', grupo_id: GRUPO, usuario_id: LID_A, nome: 'Antigo', total: 4, ultimaMensagem: 100 },
      { _id: 'y2', grupo_id: GRUPO, usuario_id: TEL_A, nome: 'Atual', total: 6, ultimaMensagem: 900 }
    ])
    await fundir(ranking, { doc: { ...ranking._docs.get('y1') }, telefone: TEL_A, acao: 'fundir' })
    const fundido = docCom(ranking, GRUPO, TEL_A)
    exigir(fundido.nome === 'Atual', 'o nome mais recente não foi respeitado: ' + fundido.nome)
    exigir(fundido.total === 10 && fundido.ultimaMensagem === 900, 'soma/data erradas: ' + JSON.stringify(fundido))
  })

  await testar('fusão com o documento do LID já apagado: não faz nada (idempotência do fundir)', async () => {
    const ranking = criarColecao([
      { _id: 'w1', grupo_id: GRUPO, usuario_id: TEL_A, nome: 'Já somado', total: 20, ultimaMensagem: 900 }
    ])
    const resultado = await fundir(ranking, { doc: { _id: 'sumido', grupo_id: GRUPO, usuario_id: LID_A }, telefone: TEL_A, acao: 'fundir' })
    exigir(resultado.acao === 'nada', 'deveria não fazer nada: ' + JSON.stringify(resultado))
    exigir(docCom(ranking, GRUPO, TEL_A).total === 20, 'o total foi mexido à toa')
  })


  await testar('idempotência: rodar de novo não soma NADA duas vezes', async () => {
    const { ranking, auth } = cenario()
    // Par do telefone já existente no mesmo grupo → o 1º doc vira FUSÃO.
    ranking._docs.set('r5', { _id: 'r5', grupo_id: GRUPO, usuario_id: TEL_A, nome: 'A pelo telefone', total: 10, ultimaMensagem: 900 })
    __definirColecoesTeste({ ranking, auth })
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'migrar-ranking-'))

    const primeira = await migrar({ aplicar: true, pastaBackup: pasta, log: silencioso })
    exigir(primeira.fusoes === 1, 'deveria ter fundido 1: ' + JSON.stringify(primeira))
    exigir(docCom(ranking, GRUPO, TEL_A).total === 17, 'a soma da 1ª rodada está errada')

    const segunda = await migrar({ aplicar: true, pastaBackup: pasta, log: silencioso })
    exigir(segunda.fusoes === 0 && segunda.renomeacoes === 0, 'a 2ª rodada mexeu em algo: ' + JSON.stringify(segunda))
    exigir(segunda.plano === 0, 'a 2ª rodada ainda montou plano: ' + segunda.plano)
    exigir(docCom(ranking, GRUPO, TEL_A).total === 17, 'a 2ª rodada somou de novo')
    exigir(docCom(ranking, GRUPO, LID_A) === null, 'o documento do LID voltou')
    fs.rmSync(pasta, { recursive: true, force: true })
  })

  await testar('corrida com o bot (E11000): o migrador cai sozinho na fusão', async () => {
    const ranking = criarColecao([
      { _id: 'z1', grupo_id: GRUPO, usuario_id: LID_A, nome: 'A pelo LID', total: 5, ultimaMensagem: 100 }
    ])
    const auth = criarColecao([
      { _id: `lid-mapping-${LID_A}_reverse`, __rawValue__: TEL_A },
      { _id: `lid-mapping-${TEL_A}`, __rawValue__: LID_A }
    ])
    __definirColecoesTeste({ ranking, auth })
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'migrar-ranking-'))

    // 🐗 O bot grava no telefone DEPOIS que o migrador montou o plano e ANTES da
    //    1ª escrita: o renomear estoura E11000 no índice único.
    const updateOneOriginal = ranking.updateOne.bind(ranking)
    ranking.updateOne = async (filtro, atualizacao) => {
      if (filtro._id === 'z1' && !ranking._docs.has('z2')) {
        ranking._docs.set('z2', { _id: 'z2', grupo_id: GRUPO, usuario_id: TEL_A, nome: 'do bot', total: 1, ultimaMensagem: 800 })
      }
      return updateOneOriginal(filtro, atualizacao)
    }

    const relatorio = await migrar({ aplicar: true, pastaBackup: pasta, log: silencioso })
    ranking.updateOne = updateOneOriginal

    exigir(relatorio.corridas === 1, 'a corrida não foi contabilizada: ' + JSON.stringify(relatorio))
    exigir(relatorio.fusoes === 1, 'não caiu no caminho da fusão: ' + JSON.stringify(relatorio))
    const fundido = docCom(ranking, GRUPO, TEL_A)
    exigir(fundido.total === 6, 'a soma da corrida ficou errada: ' + fundido.total)
    exigir(fundido.nome === 'do bot', 'o nome do registro mais novo (do bot) não valeu: ' + fundido.nome)
    fs.rmSync(pasta, { recursive: true, force: true })
  })

  await testar('backup: grava os docs do plano e aborta se não conseguir reler', async () => {
    const { ranking } = cenario()
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'migrar-ranking-'))
    const plano = [{ acao: 'renomear', telefone: TEL_A, doc: { _id: 'z9', grupo_id: GRUPO, usuario_id: LID_A, total: 1 } }]

    const arquivo = gravarBackup(plano, pasta)
    const lido = JSON.parse(fs.readFileSync(arquivo, 'utf8'))
    exigir(lido.docs.length === 1 && lido.docs[0].doc._id === 'z9', 'backup sem o documento do plano')
    exigir(path.basename(arquivo).startsWith('backup-ranking-lid-'), 'nome do backup fora do padrão: ' + arquivo)
    fs.rmSync(pasta, { recursive: true, force: true })

    // 📁 Pasta inexistente = falha na escrita: o chamador tem de abortar.
    let explodiu = false
    try { gravarBackup(plano, path.join(pasta, 'inexistente', 'x')) } catch { explodiu = true }
    exigir(explodiu, 'deveria lançar quando não consegue gravar o backup')
    fs.rmSync(pasta, { recursive: true, force: true })
    exigir(ranking._docs.has('r1'), 'o banco não pode ser tocado por este teste')
  })

  await testar('sem nada a fazer: plano vazio, sem backup e documento intacto', async () => {
    const ranking = criarColecao([{ _id: 'v1', grupo_id: GRUPO, usuario_id: TEL_A, total: 1, ultimaMensagem: 1 }])
    __definirColecoesTeste({ ranking, auth: criarColecao() })
    const relatorio = await migrar({ aplicar: true, log: silencioso })
    exigir(relatorio.plano === 0 && relatorio.backup === null, 'plano vazio não deveria gerar backup: ' + JSON.stringify(relatorio))
    exigir(docCom(ranking, GRUPO, TEL_A).total === 1, 'o documento foi tocado à toa')
  })

  console.log(reprovadas === 0 ? 'TODOS PASSARAM' : reprovadas + ' FALHARAM')
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })

