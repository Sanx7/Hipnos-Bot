// ============================================
// 🧪 teste-alcunha.js — testes OFFLINE do /alcunha
// ============================================
// Roda SEM WhatsApp e SEM MongoDB de verdade:
//   🗄️ collection FAKE de VIPs injetada no vip.js (__definirColecaoTeste),
//      com o contrato mínimo do driver;
//   💬 sock mockado — só registra o que seria enviado.
// ⚠️ MONGODB_URI é zerada no TOPO (antes de qualquer require do projeto): o
// config.js carrega o .env da raiz e, sem isso, o harness pegaria o Atlas real.
//
// Cobre: alcunha padrão determinística (mesma pessoa = mesma alcunha, sem
// data), definir/mostrar/remover, limite, sanitização, recusa de emoji,
// não-VIP, VIP vencido, LID, checagem quebrada e infra sem banco.
// Uso: node scripts/teste-alcunha.js
// ============================================

process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const vip = require('../vip')
const lid = require('../lid')
const { limparNumero } = require('../config')
const alcunhas = require('../dados/alcunhas')

// ─── 🗄️ Collection FAKE de VIPs (contrato mínimo do driver MongoDB) ───
function criarColecaoFake () {
  const documentos = new Map()
  const clone = (d) => JSON.parse(JSON.stringify(d))
  const casa = (d, filtro) =>
    Object.entries(filtro || {}).every(([campo, valor]) => {
      if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
        if (Array.isArray(valor.$in)) return valor.$in.includes(d[campo])
        if (valor.$lte !== undefined) return d[campo] <= valor.$lte
        if (valor.$gt !== undefined) return d[campo] > valor.$gt
      }
      return d[campo] === valor
    })

  return {
    _mapa: documentos,
    async findOne (filtro) {
      for (const d of documentos.values()) if (casa(d, filtro)) return clone(d)
      return null
    },
    async updateOne (filtro, atualizacao, opcoes = {}) {
      for (const [, d] of documentos) {
        if (casa(d, filtro)) {
          if (atualizacao.$set) Object.assign(d, atualizacao.$set)
          if (atualizacao.$unset) for (const c of Object.keys(atualizacao.$unset)) delete d[c]
          return { matchedCount: 1 }
        }
      }
      if (opcoes.upsert) {
        const novo = { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}) }
        documentos.set(novo.numero, novo)
        return { upsertedCount: 1 }
      }
      return { matchedCount: 0 }
    },
    async deleteOne (filtro) {
      for (const [chave, d] of documentos) {
        if (casa(d, filtro)) { documentos.delete(chave); return { deletedCount: 1 } }
      }
      return { deletedCount: 0 }
    },
    async deleteMany (filtro) {
      let removidos = 0
      const teto = filtro?.expira_em?.$lte
      if (teto !== undefined) {
        for (const [chave, d] of documentos) {
          if (d.expira_em <= teto) { documentos.delete(chave); removidos += 1 }
        }
      }
      return { deletedCount: removidos }
    },
    find (filtro) {
      return {
        sort () { return this },
        async toArray () { return [...documentos.values()].filter((d) => casa(d, filtro)).map(clone) }
      }
    }
  }
}

const colecaoFake = criarColecaoFake()
vip.__definirColecaoTeste(colecaoFake)

const comando = require('../comandos/menu-vip/alcunha')
const T = comando._test

// ─── 👥 Cenário ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_VIP = '5511900000001@s.whatsapp.net'
const JID_COMUM = '5511900000002@s.whatsapp.net'
const NUM_VIP = limparNumero(JID_VIP)
const NUM_COMUM = limparNumero(JID_COMUM)
const LID_VIP = '999888777@lid'
const DOIS_DIAS = 2 * vip.DIA_EM_MS
const PARTICIPANTES = [
  { id: JID_VIP },
  { id: JID_COMUM },
  { id: LID_VIP, phoneNumber: JID_VIP }
]

// ─── 💬 Mocks ───
function criarSock () {
  const enviadas = []
  const sock = {
    enviadas,
    groupMetadata: async () => ({ subject: 'Recinto de Teste', participants: PARTICIPANTES }),
    profilePictureUrl: async () => { throw Object.assign(new Error('item-not-found'), { statusCode: 404 }) },
    sendMessage: async (jid, conteudo, extra) => {
      enviadas.push({ jid, conteudo, extra })
      return { key: { id: `fake-${enviadas.length}` } }
    }
  }
  return { enviadas, sock }
}
// ⚠️ `participant` é OBRIGATÓRIO: sem ele o vip-acesso.js cai no remoteJid
// (o próprio grupo) e TODOS os testes de VIP passariam a ver "não é VIP".
const mensagem = (texto, autor) => ({
  key: {
    remoteJid: JID_GRUPO,
    participant: autor || JID_VIP,
    id: 'MSG' + Math.random().toString(36).slice(2, 8),
    fromMe: false
  },
  message: { conversation: texto }
})
const textoUnico = (enviadas) => enviadas.map((e) => e.conteudo?.text).filter(Boolean).join(' | ')

function darVip (numero, ms = DOIS_DIAS) {
  colecaoFake._mapa.set(numero, { numero, adicionado_em: Date.now(), expira_em: Date.now() + ms })
}
function limparVips () { colecaoFake._mapa.clear() }

// ─── 🧪 Harness ───
let reprovadas = 0
let total = 0
async function testar (nome, fn) {
  total += 1
  try { await fn(); console.log('PASSOU: ' + nome) }
  catch (err) { reprovadas += 1; console.log('FALHOU: ' + nome + ' :: ' + (err?.message || err)) }
}
function exigir (cond, detalhe) { if (!cond) throw new Error(detalhe || 'condicao falsa') }

async function main () {
  console.log('Teste offline do /alcunha (dados/alcunhas + vip.js + comando)')

  // ─── ⚔️ A alcunha padrão (dados/alcunhas.js) ───
  await testar('dados/alcunhas: banco com alcunhas distintas e sem vazio', async () => {
    exigir(Array.isArray(alcunhas.ALCUNHAS) && alcunhas.ALCUNHAS.length >= 12, 'banco pequeno demais')
    exigir(new Set(alcunhas.ALCUNHAS).size === alcunhas.ALCUNHAS.length, 'alcunhas repetidas no banco')
    for (const a of alcunhas.ALCUNHAS) {
      exigir(typeof a === 'string' && a.trim().length > 0, 'alcunha vazia no banco: ' + a)
    }
  })

  await testar('dados/alcunhas: mesma pessoa SEMPRE recebe a mesma alcunha (sem data)', async () => {
    const primeira = alcunhas.alcunhaPadrao(NUM_VIP)
    for (let i = 0; i < 50; i += 1) {
      exigir(alcunhas.alcunhaPadrao(NUM_VIP) === primeira, 'a alcunha mudou entre chamadas')
    }
    // ⚠️ Ponto central do requisito: a alcunha é uma IDENTIDADE. Se a data
    // entrasse no hash, virar o dia trocaria o apelido de guerra de todos.
    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
    exigir(amanha.getTime() > Date.now(), 'sanidade da data')
    exigir(alcunhas.alcunhaPadrao(NUM_VIP) === primeira, 'a alcunha mudaria com a data')
  })

  await testar('dados/alcunhas: JID cru, @lid e com :dispositivo dão a MESMA alcunha', async () => {
    const base = alcunhas.alcunhaPadrao('5511999999999')
    exigir(alcunhas.alcunhaPadrao('5511999999999') === base, 'só dígitos divergiu')
    exigir(alcunhas.alcunhaPadrao('5511999999999@s.whatsapp.net') === base, 'JID @s divergiu')
    exigir(alcunhas.alcunhaPadrao('5511999999999@lid') === base, 'JID @lid divergiu')
    exigir(alcunhas.alcunhaPadrao('5511999999999:12@s.whatsapp.net') === base, 'JID com :id divergiu')
  })

  await testar('dados/alcunhas: entrada vazia/errada NÃO devolve string vazia', async () => {
    for (const entrada of ['', null, undefined, 'abc', '   ']) {
      const r = alcunhas.alcunhaPadrao(entrada)
      exigir(typeof r === 'string' && alcunhas.ALCUNHAS.includes(r), 'não devolveu do banco: ' + entrada)
    }
  })

  await testar('dados/alcunhas: hash FNV-1a bate com o algoritmo do /horoscopo', async () => {
    // 2166136261 inicial; XOR do byte; Math.imul por 16777619.
    let h = 2166136261
    for (let i = 0; i < '55'.length; i += 1) {
      h ^= '55'.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    exigir(alcunhas.hashFnv1a('55') === (h >>> 0), 'hash diferente do FNV-1a padrão')
  })

  await testar('dados/alcunhas: números diferentes espalham pelo banco inteiro', async () => {
    const vistas = new Set()
    for (let i = 0; i < 3000; i += 1) vistas.add(alcunhas.alcunhaPadrao('55119000' + String(i).padStart(4, '0')))
    exigir(vistas.size === alcunhas.ALCUNHAS.length, 'só ' + vistas.size + ' de ' + alcunhas.ALCUNHAS.length)
  })

  // ─── 🏷️ vip.js: validação e sanitização ───
  await testar('vip.validarAlcunha: aceita texto normal e recusa vazio', async () => {
    const ok = await vip.validarAlcunha('Punho de Zeus')
    exigir(ok.ok && ok.alcunha === 'Punho de Zeus', 'não aceitou texto válido: ' + JSON.stringify(ok))
    const vazio = await vip.validarAlcunha('   ')
    exigir(!vazio.ok && vazio.motivo === 'vazio', 'não recusou vazio: ' + JSON.stringify(vazio))
  })

  await testar('vip.validarAlcunha: recusa acima de ALCUNHA_MAX com motivo "longo"', async () => {
    const longo = 'A'.repeat(vip.ALCUNHA_MAX + 1)
    const r = await vip.validarAlcunha(longo)
    exigir(!r.ok && r.motivo === 'longo', 'motivo errado: ' + JSON.stringify(r))
    const noLimite = 'A'.repeat(vip.ALCUNHA_MAX)
    exigir((await vip.validarAlcunha(noLimite)).ok, 'recusou texto exatamente no limite')
  })

  await testar('vip.validarAlcunha: sanitiza quebra de linha, zero-width e espaços', async () => {
    const ZWSP = String.fromCharCode(0x200B) // marca zero-width
    // A limpeza é a do /nomecustom: os invisíveis são APAGADOS (o \n some
    // inteiro, não vira espaço) e os espaços repetidos viram um só.
    const r = await vip.validarAlcunha('  Punho' + ZWSP + ' de   Zeus  ')
    exigir(r.ok, 'recusou texto sujo: ' + JSON.stringify(r))
    exigir(!/\n/.test(r.alcunha), 'quebra de linha sobreviveu')
    exigir(!r.alcunha.includes(ZWSP), 'zero-width sobreviveu')
    exigir(r.alcunha === 'Punho de Zeus', 'sanitização errada: ' + JSON.stringify(r.alcunha))
    // Texto só de invisíveis => "vazio" (não uma alcunha em branco).
    const soInvisivel = await vip.validarAlcunha(ZWSP + ZWSP)
    exigir(!soInvisivel.ok && soInvisivel.motivo === 'vazio', 'invisíveis deveriam dar vazio')
  })

  await testar('vip.validarAlcunha: recusa emoji com motivo "emoji"', async () => {
    const r = await vip.validarAlcunha('Punho 🗡️ de Zeus')
    exigir(!r.ok && r.motivo === 'emoji', 'motivo errado: ' + JSON.stringify(r))
  })

  // ─── 🗄️ vip.js: persistência ───
  await testar('vip.definirAlcunha: grava alcunhaCustom no documento do VIP', async () => {
    limparVips(); darVip(NUM_VIP)
    const r = await vip.definirAlcunha(NUM_VIP, 'Punho de Zeus')
    exigir(r.ok && r.alcunha === 'Punho de Zeus', 'não gravou: ' + JSON.stringify(r))
    exigir(colecaoFake._mapa.get(NUM_VIP).alcunhaCustom === 'Punho de Zeus', 'campo não apareceu no documento')
  })

  await testar('vip.definirAlcunha: sem VIP ativo devolve "sem-vip" e não grava', async () => {
    limparVips()
    const r = await vip.definirAlcunha(NUM_COMUM, 'Qualquer Coisa')
    exigir(!r.ok && r.motivo === 'sem-vip', 'motivo errado: ' + JSON.stringify(r))
    exigir(!colecaoFake._mapa.has(NUM_COMUM), 'gravou sem VIP!')
  })

  await testar('vip.obterAlcunhaCustom: devolve a custom do VIP ativo e null sem ela', async () => {
    limparVips(); darVip(NUM_VIP)
    exigir((await vip.obterAlcunhaCustom(NUM_VIP)) === null, 'devolveu algo sem ter definido')
    await vip.definirAlcunha(NUM_VIP, 'Tempestade')
    exigir((await vip.obterAlcunhaCustom(NUM_VIP)) === 'Tempestade', 'não leu a custom')
    exigir((await vip.obterAlcunhaCustom(NUM_COMUM)) === null, 'devolveu alcunha de não-VIP')
  })

  await testar('vip.removerAlcunha: apaga o campo e informa se tinha', async () => {
    limparVips(); darVip(NUM_VIP)
    await vip.definirAlcunha(NUM_VIP, 'Eclipse')
    const r = await vip.removerAlcunha(NUM_VIP)
    exigir(r.ok && r.tinha === true, 'não avisou que tinha: ' + JSON.stringify(r))
    exigir(!('alcunhaCustom' in colecaoFake._mapa.get(NUM_VIP)), 'campo não foi apagado')
    const r2 = await vip.removerAlcunha(NUM_VIP)
    exigir(r2.ok && r2.tinha === false, 'segunda remoção deveria dizer que não tinha')
  })

  await testar('vip: VIP VENCIDO apaga o registro — a alcunha custom morre junto', async () => {
    limparVips()
    darVip(NUM_VIP, -1000) // já venceu
    const r = await vip.definirAlcunha(NUM_VIP, 'Nada Disso')
    exigir(!r.ok, 'aceitou escrita em VIP vencido: ' + JSON.stringify(r))
    exigir((await vip.obterAlcunhaCustom(NUM_VIP)) === null, 'devolveu alcunha de VIP vencido')
    exigir(!colecaoFake._mapa.has(NUM_VIP), 'registro vencido não foi limpo')
  })

  await testar('vip.definirAlcunha: LID é resolvido e grava no NÚMERO REAL', async () => {
    limparVips(); darVip(NUM_VIP)
    // 🪪 O hook oficial do lid.js (o mesmo usado pelo teste-nomecustom): um
    // LID que NÃO está nos metadados do grupo, resolvido pelo lid-mapping.
    const LID_SEM_METADADOS = '424242424242@lid'
    lid.__definirConsultaSessaoTeste(async (l) => (l === limparNumero(LID_SEM_METADADOS) ? NUM_VIP : null))
    try {
      const r = await vip.definirAlcunha(LID_SEM_METADADOS, 'Golpe de Esparta')
      exigir(r.ok, 'não gravou via LID: ' + JSON.stringify(r))
      exigir(colecaoFake._mapa.get(NUM_VIP).alcunhaCustom === 'Golpe de Esparta', 'não gravou no número real')
    } finally {
      lid.__definirConsultaSessaoTeste(null)
    }
  })

  await testar('vip.obterEstilosVip: devolve nome, cor E alcunha numa consulta só', async () => {
    limparVips(); darVip(NUM_VIP)
    await vip.definirAlcunha(NUM_VIP, 'Brasa do Olimpo')
    const estilos = await vip.obterEstilosVip([JID_VIP])
    const estilo = estilos.get(NUM_VIP)
    exigir(estilo, 'o mapa não trouxe o VIP')
    exigir(estilo.alcunha === 'Brasa do Olimpo', 'alcunha não veio: ' + JSON.stringify(estilo))
    exigir('nome' in estilo && 'cor' in estilo, 'o mapa perdeu nome/cor usados pelo /ranking')
  })

  await testar('vip: sem MONGODB_URI as escritas recusam com "infra" (não gravam)', async () => {
    vip.__definirColecaoTeste(null)
    process.env.MONGODB_URI = ''
    const r = await vip.definirAlcunha(NUM_VIP, 'Sem Banco')
    exigir(!r.ok && r.motivo === 'infra', 'motivo errado: ' + JSON.stringify(r))
    exigir((await vip.obterAlcunhaCustom(NUM_VIP)) === null, 'leitura deveria devolver null sem banco')
    vip.__definirColecaoTeste(colecaoFake) // restaura para o resto
  })

  // ─── 💬 O comando /alcunha ───
  await testar('comando: metadados (nome, descrição, categoria, executar)', async () => {
    exigir(comando.nome === 'alcunha', 'nome errado')
    exigir(typeof comando.descricao === 'string' && comando.descricao.length > 0, 'sem descrição')
    exigir(comando.categoria === 'vip', 'categoria errada')
    exigir(typeof comando.executar === 'function', 'sem executar')
  })

  await testar('comando: VIP define a alcunha pelo comando', async () => {
    limparVips(); darVip(NUM_VIP)
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha'), '/alcunha Punho de Zeus')
    const texto = textoUnico(enviadas)
    exigir(texto.includes('Punho de Zeus'), 'não confirmou a alcunha: ' + texto)
    exigir(colecaoFake._mapa.get(NUM_VIP).alcunhaCustom === 'Punho de Zeus', 'não gravou no banco')
  })

  await testar('comando: sem argumento mostra a custom quando existe', async () => {
    limparVips(); darVip(NUM_VIP)
    await vip.definirAlcunha(NUM_VIP, 'Sopro de Tição')
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha'), '/alcunha')
    const texto = textoUnico(enviadas)
    exigir(texto.includes('Sopro de Tição'), 'não mostrou a custom: ' + texto)
  })

  await testar('comando: sem argumento e sem custom mostra a alcunha PADRÃO', async () => {
    limparVips(); darVip(NUM_VIP)
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha'), '/alcunha')
    const texto = textoUnico(enviadas)
    const padrao = alcunhas.alcunhaPadrao(NUM_VIP)
    exigir(texto.includes(padrao), 'não mostrou a padrão (' + padrao + '): ' + texto)
  })

  await testar('comando: "remover" e "reset" voltam para a alcunha padrão', async () => {
    for (const termo of ['remover', 'reset']) {
      limparVips(); darVip(NUM_VIP)
      await vip.definirAlcunha(NUM_VIP, 'Temporaria')
      const { sock, enviadas } = criarSock()
      await comando.executar(sock, JID_GRUPO, mensagem('/alcunha ' + termo), '/alcunha ' + termo)
      const texto = textoUnico(enviadas)
      exigir(texto.includes(alcunhas.alcunhaPadrao(NUM_VIP)), termo + ': não mostrou a padrão: ' + texto)
      exigir(!('alcunhaCustom' in colecaoFake._mapa.get(NUM_VIP)), termo + ' não apagou')
    }
  })

  await testar('comando: NÃO-VIP é recusado (nem admin, nem dono)', async () => {
    limparVips() // ninguém é VIP
    const { sock, enviadas } = criarSock()
    // O autor precisa ser explicitamente o não-VIP: o mock usa JID_VIP por padrão.
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha Invadir', JID_COMUM), '/alcunha Invadir')
    const texto = textoUnico(enviadas)
    exigir(texto.includes(T.AVISO_SEM_PERMISSAO), 'não recusou não-VIP: ' + texto)
    exigir(!colecaoFake._mapa.has(NUM_COMUM), 'gravou para não-VIP!')
  })

  await testar('comando: VIP que chegou como @lid é aceito e grava no número real', async () => {
    limparVips(); darVip(NUM_VIP)
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha Teimoso', LID_VIP), '/alcunha Teimoso')
    const texto = textoUnico(enviadas)
    exigir(texto.includes('Teimoso'), 'não aceitou o VIP via LID: ' + texto)
    exigir(colecaoFake._mapa.get(NUM_VIP).alcunhaCustom === 'Teimoso', 'não gravou no número real')
  })

  await testar('comando: texto longo demais é recusado com o aviso de limite', async () => {
    limparVips(); darVip(NUM_VIP)
    const { sock, enviadas } = criarSock()
    const longo = 'X'.repeat(40)
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha ' + longo), '/alcunha ' + longo)
    const texto = textoUnico(enviadas)
    exigir(texto.includes('Alcunha inválida'), 'não avisou o limite: ' + texto)
    exigir(!('alcunhaCustom' in colecaoFake._mapa.get(NUM_VIP)), 'gravou texto inválido!')
  })

  await testar('comando: alcunha com emoji é recusada', async () => {
    limparVips(); darVip(NUM_VIP)
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha Fera 🐺'), '/alcunha Fera 🐺')
    const texto = textoUnico(enviadas)
    exigir(texto.includes('emoji'), 'não avisou do emoji: ' + texto)
    exigir(!('alcunhaCustom' in colecaoFake._mapa.get(NUM_VIP)), 'gravou alcunha com emoji!')
  })

  await testar('comando: queima da checagem não derruba o socket', async () => {
    limparVips(); darVip(NUM_VIP)
    const { sock, enviadas } = criarSock()
    T._injetarChecarVip(async () => { throw new Error('glp em chamas') })
    await comando.executar(sock, JID_GRUPO, mensagem('/alcunha X'), '/alcunha X')
    T._injetarChecarVip(null)
    exigir(enviadas.length > 0, 'não respondeu nada quando a checagem quebrou')
  })

  console.log('')
  console.log(reprovadas === 0
    ? '✅ Todos os ' + total + ' testes de alcunha passaram.'
    : '❌ ' + reprovadas + ' de ' + total + ' falharam.')
  process.exitCode = reprovadas === 0 ? 0 : 1
}

main().catch((err) => { console.error('💥 erro fatal no teste:', err); process.exitCode = 1 })


