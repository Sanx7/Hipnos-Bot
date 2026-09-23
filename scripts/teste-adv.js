// ============================================
// 🧪 teste-adv.js — Sistema de advertências (/adv, /advs, /remadv)
// ============================================
// Teste OFFLINE (sem rede, sem Mongo real, sem tocar no blacklist.json):
//   - a collection "advertencias" é substituída por um fake em memória
//     (__definirColecaoTeste do advertencias.js);
//   - a gravação da blacklist é trocada por uma função espiã
//     (__definirGravacaoBlacklistTeste do /ban) — o ban automático das 3
//     advertências NUNCA escreve no arquivo real durante os testes;
//   - o sock é um fake que registra o que foi enviado/removido.
//
// Cobre: 1ª/2ª advertência (sem ban), 3ª (ban automático + arquivamento),
// recusa sem motivo, recusa sem alvo, recusa para não-admin, proteção do
// dono do bot, /advs (ficha limpa e com advertências), /remadv (perdão,
// saldo, sem advertências), resolução LID→número real, falha de expulsão
// (bot não-admin) e robustez (banco fora / socket quebrado).
//
// Rodar: node scripts/teste-adv.js
// ============================================

// 👑 Dono do bot: precisa ser definido ANTES de exigir config.js, porque
// OWNER_NUMBERS é lido do ambiente no carregamento do módulo.
const DONO = '5511900000001'
process.env.OWNER_NUMBERS = DONO

const adv = require('../comandos/admin/adv')
const advs = require('../comandos/admin/advs')
const remadv = require('../comandos/admin/remadv')
const ban = require('../comandos/admin/ban')
const dadosAdv = require('../advertencias')
const { limparNumero } = require('../config')

// ─── 🎭 Dados de teste ───
const JID = '120363000000000001@g.us'
const JID_PRIVADO = '5511900000001@s.whatsapp.net'

const ADMIN = '5511911111111@s.whatsapp.net'
const ADMIN2 = '5511944444444@s.whatsapp.net'
const COMUM = '5511922222222@s.whatsapp.net'
const MEMBRO = '5511955555555@s.whatsapp.net'
const ALVO = '5511933333333@s.whatsapp.net'
const ALVO_NUMERO = '5511933333333'
const DONO_JID = `${DONO}@s.whatsapp.net`
const LID_ALVO = '175952680210400@lid'

let participantes = []

function montarParticipantes () {
  return [
    { id: ADMIN, admin: 'admin', phoneNumber: undefined },
    { id: ADMIN2, admin: 'admin', phoneNumber: undefined },
    { id: COMUM, admin: null, phoneNumber: undefined },
    { id: MEMBRO, admin: null, phoneNumber: undefined },
    { id: ALVO, admin: null, phoneNumber: undefined },
    { id: DONO_JID, admin: 'admin', phoneNumber: undefined },
    { id: LID_ALVO, admin: null, phoneNumber: ALVO }
  ]
}

// ============================================
// 🧰 HARNESS
// ============================================

let total = 0
let falhas = 0

async function testar (nome, fn) {
  total++
  try {
    await fn()
    console.log(`✅ ${nome}`)
  } catch (err) {
    falhas++
    console.error(`❌ ${nome}`)
    console.error(`   ↳ ${err?.message || err}`)
  }
}

function afirmar (condicao, mensagem) {
  if (!condicao) throw new Error(mensagem || 'afirmação falhou')
}

function igual (recebido, esperado, mensagem) {
  if (recebido !== esperado) {
    throw new Error(`${mensagem || 'valor diferente'} (esperado: ${esperado} | recebido: ${recebido})`)
  }
}

function contem (texto, trecho, mensagem) {
  if (!String(texto || '').includes(trecho)) {
    throw new Error(`${mensagem || 'trecho ausente'}: faltou "${trecho}"`)
  }
}

function naoContem (texto, trecho, mensagem) {
  if (String(texto || '').includes(trecho)) {
    throw new Error(`${mensagem || 'trecho inesperado'}: não deveria conter "${trecho}"`)
  }
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ============================================
// 🗃️ COLLECTION FAKE (advertencias)
// ============================================
// Implementa só o que o advertencias.js usa: insertOne, countDocuments,
// find().sort().toArray(), deleteOne e updateMany.
function criarColecaoFake () {
  const documentos = []
  let sequencia = 0

  const casa = (doc, filtro) => Object
    .entries(filtro || {})
    .every(([campo, valor]) => doc[campo] === valor)

  return {
    documentos,
    async insertOne (doc) {
      sequencia++
      const novo = { _id: `fake_${sequencia}`, ...doc }
      documentos.push(novo)
      return { insertedId: novo._id }
    },
    async countDocuments (filtro) {
      return documentos.filter((d) => casa(d, filtro)).length
    },
    find (filtro) {
      const achados = documentos.filter((d) => casa(d, filtro))
      return {
        sort (spec) {
          // Suporta ordenação multi-chave (ex.: { data: -1, _id: -1 }); o _id
          // fake ("fake_N") desempatada pelo sufixo numérico (ordem de inserção).
          const chaves = Object.entries(spec || { data: -1 })
          const valorDe = (doc, campo) => {
            const v = doc[campo]
            if (campo === '_id' && typeof v === 'string') {
              const m = v.match(/(\d+)\s*$/)
              if (m) return Number(m[1])
            }
            return v ?? 0
          }
          achados.sort((a, b) => {
            for (const [campo, ordem] of chaves) {
              const va = valorDe(a, campo)
              const vb = valorDe(b, campo)
              if (va < vb) return -1 * ordem
              if (va > vb) return 1 * ordem
            }
            return 0
          })
          return this
        },
        async toArray () { return achados.map((d) => ({ ...d })) }
      }
    },
    async deleteOne (filtro) {
      const i = documentos.findIndex((d) => casa(d, filtro))
      if (i < 0) return { deletedCount: 0 }
      documentos.splice(i, 1)
      return { deletedCount: 1 }
    },
    async updateMany (filtro, update) {
      let modificados = 0
      for (const doc of documentos) {
        if (!casa(doc, filtro)) continue
        Object.assign(doc, update?.$set || {})
        modificados++
      }
      return { matchedCount: modificados, modifiedCount: modificados }
    }
  }
}

const colecao = criarColecaoFake()
const blacklistGravada = []

// ============================================
// 🎭 FAKES DE SOCK E MENSAGEM
// ============================================

function criarSock (opcoes = {}) {
  const enviadas = []
  const expulsoes = []

  return {
    user: { id: '5511999999999@s.whatsapp.net' },
    enviadas,
    expulsoes,
    async sendMessage (jid, payload, opcoesEnvio) {
      enviadas.push({ jid, payload, opcoes: opcoesEnvio })
      return { key: { id: `enviada_${enviadas.length}`, remoteJid: jid } }
    },
    async groupMetadata () {
      if (opcoes.metadadosErro) throw new Error('rede fora')
      return { participants: participantes, owner: opcoes.owner || ADMIN, ...(opcoes.metadados || {}) }
    },
    async groupParticipantsUpdate (jid, alvos, acao) {
      if (opcoes.expulsaoErro) throw new Error('o bot não é admin')
      expulsoes.push({ jid, alvos, acao })
      return []
    }
  }
}

// Mensagem no formato que o Baileys entrega (citar alguém = mentionedJid;
// responder alguém = contextInfo.participant).
function criarMsg ({ autor = ADMIN, mencionado = null, respondido = null, remoto = JID } = {}) {
  const contextInfo = {}
  if (mencionado) contextInfo.mentionedJid = [mencionado]
  if (respondido) contextInfo.participant = respondido

  return {
    key: { remoteJid: remoto, participant: autor, fromMe: false, id: 'msg_teste' },
    message: { extendedTextMessage: { text: '', contextInfo } }
  }
}

// ─── 🔎 Acesso ao que foi enviado/gravado ───
const textosDe = (sock) => sock.enviadas.map((e) => String(e.payload?.text || '')).join('\n---\n')
const ultimoTextoDe = (sock) => String(sock.enviadas[sock.enviadas.length - 1]?.payload?.text || '')
const ultimaEnviada = (sock) => sock.enviadas[sock.enviadas.length - 1]
const ativasDe = (numero) => colecao.documentos.filter((d) => d.numero === numero && d.ativa === true)

// Aplica uma advertência pelo comando real (menção + motivo no texto)
async function aplicarAdv (sock, motivo, { autor = ADMIN, alvo = ALVO } = {}) {
  const texto = `/adv @${limparNumero(alvo)} ${motivo}`
  await adv.executar(sock, JID, criarMsg({ autor, mencionado: alvo }), texto)
}

// Zera o "banco" e o espião da blacklist entre um teste e outro
function limpar () {
  colecao.documentos.length = 0
  blacklistGravada.length = 0
}

// ============================================
// 🧪 CASOS DE TESTE
// ============================================

async function principal () {
  // 🧪 Liga os ganchos de teste ANTES de qualquer caso: nada de Mongo real e
  // nada de escrever no blacklist.json de verdade.
  dadosAdv.__definirColecaoTeste(colecao)
  ban.__definirGravacaoBlacklistTeste((numero) => { blacklistGravada.push(numero) })
  participantes = montarParticipantes()

  // ─────────────────────────────────────────────────────────
  // 1) CONTRATO DOS COMANDOS (nome + aliases)
  // ─────────────────────────────────────────────────────────
  await testar('/adv tem nome e aliases no padrão do projeto', async () => {
    igual(adv.nome, 'adv', 'nome do comando')
    afirmar(Array.isArray(adv.aliases), 'aliases deve ser um array')
    contem(adv.aliases.join(','), 'advertir', 'alias advertir')
    contem(adv.aliases.join(','), 'warn', 'alias warn')
    igual(typeof adv.executar, 'function', 'executar exportado')
  })

  await testar('/advs e /remadv têm nome e aliases', async () => {
    igual(advs.nome, 'advs', 'nome do advs')
    contem(advs.aliases.join(','), 'advertencias', 'alias advertencias')
    igual(remadv.nome, 'remadv', 'nome do remadv')
    contem(remadv.aliases.join(','), 'perdoaradv', 'alias perdoaradv')
  })

  await testar('/adv exporta os helpers reusados por /advs e /remadv', async () => {
    igual(typeof adv.isAdmin, 'function', 'helper isAdmin')
    igual(typeof adv.extrairAlvo, 'function', 'helper extrairAlvo')
    igual(typeof adv.extrairMotivo, 'function', 'helper extrairMotivo')
    igual(typeof adv.resolverNumeroReal, 'function', 'helper resolverNumeroReal')
  })

  // ─────────────────────────────────────────────────────────
  // 2) 1ª E 2ª ADVERTÊNCIA (SEM BAN)
  // ─────────────────────────────────────────────────────────
  await testar('1ª advertência é gravada e confirma sem banir ninguém', async () => {
    limpar()
    const sock = criarSock()
    await aplicarAdv(sock, 'quebrou as regras do grupo')

    const texto = ultimoTextoDe(sock)
    contem(texto, 'ADVERTÊNCIA APLICADA', 'cabeçalho da confirmação')
    contem(texto, `@${ALVO_NUMERO}`, 'menção ao alvo pelo número real')
    contem(texto, 'quebrou as regras do grupo', 'motivo registrado')
    contem(texto, `@${limparNumero(ADMIN)}`, 'quem aplicou')
    contem(texto, 'Advertências ativas: *1/3*', 'contagem 1/3')
    contem(texto, 'Faltam *2* advertências', 'aviso de quanto falta para o ban')

    // Nada de punição nesta altura
    igual(sock.expulsoes.length, 0, 'não deve expulsar na 1ª advertência')
    igual(blacklistGravada.length, 0, 'não deve gravar na blacklist na 1ª advertência')

    // Documento no "Mongo" com o número REAL (nunca LID) e o grupo certo
    const docs = ativasDe(ALVO_NUMERO)
    igual(docs.length, 1, 'uma advertência ativa gravada')
    igual(docs[0].grupo_id, JID, 'grupo_id gravado')
    igual(docs[0].motivo, 'quebrou as regras do grupo', 'motivo gravado')
    igual(docs[0].aplicado_por, limparNumero(ADMIN), 'aplicado_por com número real')
    igual(docs[0].ativa, true, 'advertência nasce ativa')
    afirmar(Number.isFinite(docs[0].data), 'data numérica gravada')

    // Menções no envio (alvo + admin)
    const mencionados = ultimaEnviada(sock).payload.mentions || []
    contem(mencionados.join(','), ALVO, 'alvo mencionado no envio')
    contem(mencionados.join(','), ADMIN, 'autor mencionado no envio')
  })

  await testar('2ª advertência também não bane e mostra 2/3', async () => {
    limpar()
    const sock = criarSock()
    await aplicarAdv(sock, 'primeira reincidência')
    await aplicarAdv(sock, 'segunda reincidência')

    contem(ultimoTextoDe(sock), 'Advertências ativas: *2/3*', 'contagem 2/3')
    contem(ultimoTextoDe(sock), 'Faltam *1* advertência', 'aviso com singular correto')
    igual(sock.expulsoes.length, 0, 'ninguém foi expulso na 2ª')
    igual(blacklistGravada.length, 0, 'blacklist intocada na 2ª')
    igual(ativasDe(ALVO_NUMERO).length, 2, 'duas advertências ativas')
  })

  // ─────────────────────────────────────────────────────────
  // 3) 3ª ADVERTÊNCIA → BAN AUTOMÁTICO
  // ─────────────────────────────────────────────────────────
  await testar('3ª advertência dispara o ban automático (expulsão + blacklist)', async () => {
    limpar()
    const sock = criarSock()
    await aplicarAdv(sock, 'primeira')
    await aplicarAdv(sock, 'segunda')
    await aplicarAdv(sock, 'terceira')

    const texto = ultimoTextoDe(sock)
    contem(texto, 'BANIDO POR 3 ADVERTÊNCIAS', 'cabeçalho do banimento')
    contem(texto, 'atingiu o limite', 'explica o motivo do ban')
    // 📜 lista os motivos acumulados
    contem(texto, '1. primeira', 'motivo 1 listado')
    contem(texto, '2. segunda', 'motivo 2 listado')
    contem(texto, '3. terceira', 'motivo 3 listado')
    contem(texto, `@${ALVO_NUMERO}`, 'alvo mencionado pelo número real')

    // ☠️ Punição reusada do /ban
    igual(sock.expulsoes.length, 1, 'deve expulsar uma vez')
    igual(sock.expulsoes[0].alvos[0], ALVO, 'expulsa o JID do alvo')
    igual(sock.expulsoes[0].acao, 'remove', 'ação de expulsão')
    igual(blacklistGravada.length, 1, 'grava uma vez na blacklist')
    igual(blacklistGravada[0], ALVO_NUMERO, 'blacklist com o número real (sem @)')

    // 📦 advertências ARQUIVADAS (histórico preservado, contagem zerada)
    igual(ativasDe(ALVO_NUMERO).length, 0, 'nenhuma advertência ativa depois do ban')
    const arquivadas = colecao.documentos.filter((d) => d.numero === ALVO_NUMERO && d.ativa === false)
    igual(arquivadas.length, 3, 'as 3 advertências foram arquivadas')
    afirmar(arquivadas.every((d) => Number.isFinite(d.arquivada_em)), 'arquivada_em registrado')
  })

  await testar('3ª advertência de alvo @lid bane usando o NÚMERO real', async () => {
    limpar()
    const sock = criarSock()
    const texto = `/adv @${ALVO_NUMERO} desrespeitou a equipe`
    // Três advertências pelo LID (participant com phoneNumber = número real)
    for (let i = 0; i < 3; i++) {
      await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: LID_ALVO }), texto)
    }

    contem(ultimoTextoDe(sock), 'BANIDO POR 3 ADVERTÊNCIAS', 'ban automático disparado via LID')
    igual(blacklistGravada[0], ALVO_NUMERO, 'blacklist nunca recebe o LID cru')
    igual(sock.expulsoes[0].alvos[0], LID_ALVO, 'a expulsão usa o JID que o WhatsApp entregou')
    igual(
      colecao.documentos.filter((d) => d.numero === LID_ALVO.split('@')[0]).length,
      0,
      'nada gravado com o número do LID'
    )
  })

  await testar('se o WhatsApp recusar a expulsão, avisa e NÃO arquiva as advertências', async () => {
    limpar()
    const sock = criarSock({ expulsaoErro: true }) // ex.: o bot não é admin
    await aplicarAdv(sock, 'primeira')
    await aplicarAdv(sock, 'segunda')
    await aplicarAdv(sock, 'terceira')

    const texto = ultimoTextoDe(sock)
    contem(texto, 'LIMITE DE ADVERTÊNCIAS ATINGIDO', 'aviso de falha na expulsão')
    contem(texto, '/ban @membro', 'sugere o ban manual')
    igual(ativasDe(ALVO_NUMERO).length, 3, 'as 3 continuam ATIVAS até o ban manual')
    // Igual ao /ban: a blacklist é gravada antes da tentativa de remoção
    igual(blacklistGravada.length, 1, 'blacklist gravada antes da expulsão')
  })

  // ─────────────────────────────────────────────────────────
  // 4) RECUSAS AMIGÁVEIS (sem motivo, sem alvo, sem permissão...)
  // ─────────────────────────────────────────────────────────
  await testar('sem motivo → recusa com aviso de uso e NÃO grava nada', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), `/adv @${ALVO_NUMERO}`)

    contem(ultimoTextoDe(sock), 'Falta o motivo da advertência', 'aviso de motivo obrigatório')
    contem(ultimoTextoDe(sock), '/adv @usuario xingou os colegas', 'mostra o exemplo de uso')
    igual(colecao.documentos.length, 0, 'nada deve ser gravado sem motivo')
    igual(sock.expulsoes.length, 0, 'nada de expulsão')
  })

  await testar('motivo só com a menção citada não conta como justificativa', async () => {
    limpar()
    const sock = criarSock()
    // O WhatsApp escreve "@5511933333333" no corpo do texto; isso é o alvo, não o motivo.
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), `/adv @${ALVO_NUMERO}  `)

    contem(ultimoTextoDe(sock), 'Falta o motivo', 'espaços em branco não viram motivo')
    igual(colecao.documentos.length, 0, 'nada gravado')
  })

  await testar('sem alvo (sem menção e sem reply) → recusa com aviso de uso', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN }), '/adv fez bagunça no grupo')

    contem(ultimoTextoDe(sock), 'Marque alguém com @ ou responda', 'aviso de alvo obrigatório')
    igual(colecao.documentos.length, 0, 'nada gravado sem alvo')
  })

  await testar('não-admin não pode aplicar advertência', async () => {
    limpar()
    const sock = criarSock()
    await aplicarAdv(sock, 'quero advertir por conta própria', { autor: COMUM })

    contem(ultimoTextoDe(sock), 'Apenas administradores', 'aviso de permissão')
    igual(colecao.documentos.length, 0, 'nada gravado por não-admin')
  })

  await testar('não-admin também não vê as advertências nem perdoa (/advs e /remadv)', async () => {
    limpar()
    const sock = criarSock()
    const msg = criarMsg({ autor: COMUM, mencionado: ALVO })
    await advs.executar(sock, JID, msg, `/advs @${ALVO_NUMERO}`)
    contem(ultimoTextoDe(sock), 'Apenas administradores', 'aviso no /advs')

    await remadv.executar(sock, JID, msg, `/remadv @${ALVO_NUMERO}`)
    contem(ultimoTextoDe(sock), 'Apenas administradores', 'aviso no /remadv')
  })

  await testar('admin não pode advertir a si mesmo', async () => {
    limpar()
    const sock = criarSock()
    await aplicarAdv(sock, 'me advertindo por engano', { alvo: ADMIN })

    contem(ultimoTextoDe(sock), 'não pode advertir a si mesmo', 'aviso de auto-advertência')
    igual(colecao.documentos.length, 0, 'nada gravado')
  })

  await testar('⛔ dono do bot é protegido (nada é gravado antes da checagem)', async () => {
    limpar()
    const sock = criarSock()
    await aplicarAdv(sock, 'tentando banir o dono', { alvo: DONO_JID })

    contem(ultimoTextoDe(sock), 'Não é possível executar essa ação contra o dono do bot', 'aviso de proteção')
    igual(colecao.documentos.length, 0, 'o dono nunca é gravado no Mongo')
    igual(sock.expulsoes.length, 0, 'o dono nunca é expulso')
  })

  await testar('/adv fora de grupo avisa e não grava nada', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID_PRIVADO, criarMsg({ autor: ADMIN, mencionado: ALVO, remoto: JID_PRIVADO }), '/adv blá blá')
    contem(ultimoTextoDe(sock), 'só serve para grupos', 'aviso de fora de grupo')
    igual(colecao.documentos.length, 0, 'nada gravado no privado')
  })

  // ─────────────────────────────────────────────────────────
  // 5) RESOLUÇÃO LID → NÚMERO REAL (nunca gravar LID cru)
  // ─────────────────────────────────────────────────────────
  await testar('alvo @lid é resolvido para o número real antes de gravar', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: LID_ALVO }), `/adv @${ALVO_NUMERO} tumultuou a call`)

    const docs = ativasDe(ALVO_NUMERO)
    igual(docs.length, 1, 'gravado com o número real')
    igual(docs[0].motivo, 'tumultuou a call', 'motivo íntegro')
    contem(ultimoTextoDe(sock), `@${ALVO_NUMERO}`, 'confirmação mostra o número real')
    naoContem(ultimoTextoDe(sock), '@lid', 'nunca mostra o LID cru')
  })

  await testar('motivo por reply funciona (alvo vem da mensagem respondida)', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, respondido: ALVO }), '/adv postou link proibido')

    const docs = ativasDe(ALVO_NUMERO)
    igual(docs.length, 1, 'advertência gravada pelo reply')
    igual(docs[0].motivo, 'postou link proibido', 'motivo sem resquício do alvo')
  })

  // ─────────────────────────────────────────────────────────
  // 6) /advs — LISTAGEM DAS ADVERTÊNCIAS ATIVAS
  // ─────────────────────────────────────────────────────────
  await testar('/advs sem advertências avisa "ficha limpa"', async () => {
    limpar()
    const sock = criarSock()
    await advs.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/advs')
    contem(ultimoTextoDe(sock), 'ficha limpa', 'aviso de ficha limpa')
  })

  await testar('/advs lista motivo + quem aplicou + data', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/adv spam de figurinha')
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN2, mencionado: ALVO }), '/adv xingou membros')

    await advs.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/advs')
    const texto = ultimoTextoDe(sock)
    contem(texto, '2', 'mostra a contagem de advertências')
    contem(texto, 'spam de figurinha', '1º motivo listado')
    contem(texto, 'xingou membros', '2º motivo listado')
    contem(texto, '@5511911111111', 'quem aplicou aparece (número, sem sufixo)')
  })

  await testar('/advs aceita reply (sem @)', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, respondido: ALVO }), '/adv sem educacao')
    await advs.executar(sock, JID, criarMsg({ autor: ADMIN, respondido: ALVO }), '/advs')
    contem(ultimoTextoDe(sock), 'sem educacao', 'listou via reply')
  })

  await testar('/advs fora de grupo avisa', async () => {
    limpar()
    const sock = criarSock()
    await advs.executar(sock, JID_PRIVADO, criarMsg({ autor: ADMIN, mencionado: ALVO, remoto: JID_PRIVADO }), '/advs')
    contem(ultimoTextoDe(sock), 'só serve para grupos', 'aviso de fora de grupo')
  })

  // ─────────────────────────────────────────────────────────
  // 7) /remadv — REMOVER A MAIS RECENTE
  // ─────────────────────────────────────────────────────────
  await testar('/remadv sem advertências avisa ficha limpa', async () => {
    limpar()
    const sock = criarSock()
    await remadv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/remadv')
    contem(ultimoTextoDe(sock), 'ficha limpa', 'nada a remover')
  })

  await testar('/remadv remove a advertência mais recente', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/adv motivo antigo')
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/adv motivo novo')

    await remadv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/remadv')

    const restantes = ativasDe(ALVO_NUMERO)
    igual(restantes.length, 1, 'sobrou 1 advertência')
    igual(restantes[0].motivo, 'motivo antigo', 'a mais recente (motivo novo) foi a removida')
    contem(ultimoTextoDe(sock), 'motivo novo', 'mostra o que foi removido')
  })

  await testar('/remadv não-admin é recusado', async () => {
    limpar()
    const sock = criarSock()
    await adv.executar(sock, JID, criarMsg({ autor: ADMIN, mencionado: ALVO }), '/adv motivo')
    await remadv.executar(sock, JID, criarMsg({ autor: MEMBRO, mencionado: ALVO }), '/remadv')
    contem(ultimoTextoDe(sock), 'Apenas administradores', 'recusa membro comum')
    igual(ativasDe(ALVO_NUMERO).length, 1, 'advertência preservada')
  })

  await testar('/remadv fora de grupo avisa', async () => {
    limpar()
    const sock = criarSock()
    await remadv.executar(sock, JID_PRIVADO, criarMsg({ autor: ADMIN, mencionado: ALVO, remoto: JID_PRIVADO }), '/remadv')
    contem(ultimoTextoDe(sock), 'só serve para grupos', 'aviso de fora de grupo')
  })

  // ─────────────────────────────────────────────────────────
  // 📊 RESUMO
  // ─────────────────────────────────────────────────────────
  limpar()
  console.log('\n────────────────────────────────────────')
  console.log(`🧪 ${total - falhas}/${total} testes passaram`)
  if (falhas) {
    console.error(`❌ ${falhas} teste(s) falharam`)
    process.exit(1)
  }
  console.log('✅ /adv ok: 1ª/2ª sem ban, 3ª com ban automático, recusas, LID, /advs e /remadv.')
  process.exit(0)
}

principal().catch((err) => {
  console.error('💥 falha inesperada no teste:', err?.stack || err)
  process.exit(1)
})

