// ============================================
// ⚠️ /adv — Advertências com justificativa (Mongo)
// ============================================
// Aliases: /advertir e /warn.
//
//    /adv @membro motivo        → aplica a advertência
//    /adv (respondendo alguém) motivo
//
// Regras:
//   - SOMENTE admin do grupo (mesmo critério do /ban, /kick e /soadm);
//   - o alvo NUNCA pode ser o dono do bot (ehDonoDoBot — mesma proteção do
//     /ban e /kick);
//   - motivo é OBRIGATÓRIO (sem ele o comando recusa e mostra o uso);
//   - o número do alvo é RESOLVIDO antes de gravar (lid.js): nunca gravamos
//     LID cru no Mongo — mesma correção aplicada em VIP/RPG;
//   - a 3ª advertência ATIVA no mesmo grupo dispara o BAN automático
//     reutilizando `banirDoGrupo` do /ban (blacklist + expulsão) e ARQUIVA
//     as advertências (histórico preservado, contagem zerada).
//
// A camada de dados vive em advertencias.js (collection "advertencias",
// documento {numero, grupo_id, motivo, aplicado_por, data, ativa}).
// Este arquivo exporta também os helpers de parse usados pelos comandos
// /advs e /remadv (o loader ignora propriedades extras, como no /ban).

const { ehDonoDoBot, limparNumero } = require('../../config')
const { resolverNumeroAlvo } = require('../../lid')
const {
  criarAdvertencia,
  listarAdvertencias,
  arquivarAdvertencias,
  formatarData,
  LIMITE_ADVERTENCIAS
} = require('../../advertencias')
const { banirDoGrupo } = require('./ban')

function isAdmin (p) {
  return p?.admin === 'admin' || p?.admin === 'superadmin'
}

// ─── 💬 Mensagens (padrão temático do projeto) ───
const AVISO_SO_GRUPO = 'Este comando só serve para grupos, gênio. 🥱'

const AVISO_SEM_ALVO =
  '⚠️ Marque alguém com @ ou responda a mensagem da pessoa.\n' +
  'Ex: `/adv @usuario motivo da advertência`'

const AVISO_SEM_MOTIVO =
  '📝 Falta o motivo da advertência — sem justificativa eu não registro nada.\n' +
  'Ex: `/adv @usuario xingou os colegas`'

const AVISO_SEM_PERMISSAO =
  '❌ Apenas administradores podem usar este comando.'

const AVISO_DONO =
  '⛔ Não é possível executar essa ação contra o dono do bot.'

const AVISO_AUTO_ADV =
  '🙃 Você não pode advertir a si mesmo. Tenha dignidade... 💤'

const AVISO_LID =
  '🔍 Não consegui identificar o número real dessa pessoa (o WhatsApp a entrega como @lid).\n' +
  'Peca para ela mandar uma mensagem no grupo e tente de novo.'

const AVISO_SEM_METADADOS =
  '🌫️ Não consegui ler os dados deste grupo agora (falha de conexão).\n' +
  'Tente novamente em instantes.'

const AVISO_ERRO_BANCO =
  '🌫️ As sombras não responderam: não consegui registrar a advertência agora.\n' +
  'Tente novamente em instantes.'

// ─── 🎯 Parse do alvo e do motivo ───

// Alvo = menção (@) ou a mensagem respondida (reply). null se não houver.
function extrairAlvo (msg) {
  const contexto = msg?.message?.extendedTextMessage?.contextInfo
  return contexto?.mentionedJid?.[0] || contexto?.participant || null
}

// Motivo = o texto depois do comando, sem as menções e sem o número do alvo
// (o WhatsApp escreve "@5511999999999" no corpo da mensagem, e isso não faz
// parte da justificativa). Funciona tanto com menção quanto com reply.
function extrairMotivo (text, alvoBruto) {
  const digitosDoAlvo = String(alvoBruto || '').split('@')[0].split(':')[0].replace(/\D/g, '')
  const partes = String(text || '').trim().split(/\s+/).slice(1) // [0] = o próprio comando

  const restantes = partes.filter((parte) => {
    if (parte.startsWith('@')) return false
    const digitos = parte.replace(/\D/g, '')
    if (digitosDoAlvo && digitos === digitosDoAlvo) return false
    return true
  })

  return restantes.join(' ').trim()
}

// 🔎 Resolve o JID (número real ou LID) para o NÚMERO real via lid.js.
// Devolve null quando não foi possível — o chamador NÃO deve gravar o LID.
async function resolverNumeroReal (participants, jidBruto) {
  const { numero, via } = await resolverNumeroAlvo(participants, jidBruto)
  if (!numero || !via) return null
  return numero
}

// ─── ✍️ Mensagens da rodada de advertência ───

function montarConfirmacao ({ alvoNumero, motivo, aplicadoPor, total, data }) {
  const restantes = Math.max(0, LIMITE_ADVERTENCIAS - total)
  const aviso = restantes > 0
    ? `⚠️ Faltam *${restantes}* advertência${restantes === 1 ? '' : 's'} para o ban automático.`
    : '☠️ Limite atingido!'

  return '⚠️ *ADVERTÊNCIA APLICADA* ⚠️\n\n' +
    `👤 Alvo: @${alvoNumero}\n` +
    `📝 Motivo: ${motivo}\n` +
    `🛡️ Aplicada por: @${aplicadoPor}\n` +
    `🗓️ Data: ${formatarData(data)}\n` +
    `📊 Advertências ativas: *${total}/${LIMITE_ADVERTENCIAS}*\n\n` +
    aviso
}

function montarBanimento ({ alvoNumero, motivos, aplicadoPor }) {
  // Ordem cronológica (1ª → 3ª): listarAdvertencias devolve mais-recente-primeiro.
  const lista = [...motivos].reverse()
    .map((m, i) => `${i + 1}. ${m.motivo}\n   ↳ por @${m.aplicado_por} em ${formatarData(m.data)}`)
    .join('\n')

  return '☠️ *BANIDO POR ' + LIMITE_ADVERTENCIAS + ' ADVERTÊNCIAS* ☠️\n\n' +
    `👤 @${alvoNumero} atingiu o limite e foi lançado na blacklist.\n\n` +
    '📜 *Motivos acumulados:*\n' + lista + '\n\n' +
    `🗓️ Banido em ${formatarData(Date.now())} por @${aplicadoPor}.`
}

// ⚔️ Aviso quando o limite estourou mas o WhatsApp recusou a expulsão
// (normalmente porque o bot não é admin). As advertências NÃO são arquivadas
// nesse caso — a punição fica pendente para o /ban manual.
function montarFalhaBan ({ alvoNumero, motivos, aplicadoPor }) {
  const lista = motivos
    .map((m, i) => `${i + 1}. ${m.motivo}\n   ↳ por @${m.aplicado_por} em ${formatarData(m.data)}`)
    .join('\n')

  return '⚠️ *LIMITE DE ADVERTÊNCIAS ATINGIDO* ⚠️\n\n' +
    `👤 @${alvoNumero} chegou a *${LIMITE_ADVERTENCIAS}* advertências, mas o WhatsApp recusou a expulsão ` +
    '(provavelmente eu não sou administrador do grupo).\n\n' +
    '📜 *Motivos acumulados:*\n' + lista + '\n\n' +
    '⚔️ Remova manualmente com `/ban @membro` — as advertências seguem ativas até isso acontecer.\n' +
    `🗓️ Aviso gerado por @${aplicadoPor} em ${formatarData(Date.now())}.`
}

// ─── 🚨 Ban automático ao atingir o limite ───
// Reusa a punição do /ban (`banirDoGrupo`: blacklist + expulsão) e só então
// ARQUIVA as advertências do alvo neste grupo (histórico preservado, contagem
// zerada). O sucesso/falha do WhatsApp decide entre a mensagem de banimento e
// o aviso de falha acima.
async function aplicarBanAutomatico (sock, jid, msg, alvoBruto, alvoReal, autorReal) {
  // 📜 Histórico lido ANTES de arquivar (é ele que vai na mensagem)
  let motivos = []
  try {
    motivos = await listarAdvertencias(alvoReal, jid)
  } catch (erro) {
    console.error('[adv] ⚠️ não consegui listar os motivos do ban:', erro?.message || erro)
  }
  if (!motivos.length) motivos = [{ motivo: 'Sem motivo registrado', aplicado_por: autorReal, data: Date.now() }]

  let banido = true
  try {
    console.log(`[adv] 🚨 ${alvoReal} atingiu ${LIMITE_ADVERTENCIAS} advertências em ${jid} — ban automático`)
    await banirDoGrupo(sock, jid, alvoBruto, alvoReal)
  } catch (erro) {
    banido = false
    console.error('[adv] 💥 o WhatsApp recusou a expulsão automática:', erro?.message || erro)
  }

  if (banido) {
    try {
      const total = await arquivarAdvertencias(alvoReal, jid)
      console.log(`[adv] 📦 ${total} advertência(s) de ${alvoReal} arquivadas após o ban`)
    } catch (erro) {
      console.error('[adv] ⚠️ ban feito, mas falhou ao arquivar as advertências:', erro?.message || erro)
    }
  }

  const texto = banido
    ? montarBanimento({ alvoNumero: alvoReal, motivos, aplicadoPor: autorReal })
    : montarFalhaBan({ alvoNumero: alvoReal, motivos, aplicadoPor: autorReal })

  return await sock.sendMessage(jid, { text: texto, mentions: [alvoBruto] }, { quoted: msg })
}

// ─── 📤 Envio padronizado (sempre citando a mensagem do comando) ───
async function enviar (sock, jid, msg, texto) {
  return await sock.sendMessage(jid, { text: texto }, { quoted: msg })
}

module.exports = {
  nome: 'adv',
  // ♻️ Aliases no padrão do projeto (o loader registra todos)
  aliases: ['advertir', 'warn'],
  // ♻️ Helpers reusados por /advs e /remadv (o loader ignora extras)
  isAdmin,
  extrairAlvo,
  extrairMotivo,
  resolverNumeroReal,
  async executar (sock, jid, msg, text) {
    try {
      // 1️⃣ Só em grupo
      if (!jid.endsWith('@g.us')) return await enviar(sock, jid, msg, AVISO_SO_GRUPO)

      const sender = msg?.key?.participant || msg?.key?.remoteJid

      // 2️⃣ Metadados (permissão + resolução LID dos dois lados)
      let metadados = null
      try {
        metadados = await sock.groupMetadata(jid)
      } catch (erroMeta) {
        console.error('[adv] ⚠️ sem metadados do grupo:', erroMeta?.message || erroMeta)
        return await enviar(sock, jid, msg, AVISO_SEM_METADADOS)
      }
      const participantes = metadados?.participants || []

      // 3️⃣ Permissão: SOMENTE admin (mesmo critério do /ban)
      const dadosSender = participantes.find((p) => p.id === sender)
      if (!(isAdmin(dadosSender) || metadados?.owner === sender)) {
        return await enviar(sock, jid, msg, AVISO_SEM_PERMISSAO)
      }

      // 4️⃣ Alvo: menção (@) ou mensagem respondida
      const alvoBruto = extrairAlvo(msg)
      if (!alvoBruto) return await enviar(sock, jid, msg, AVISO_SEM_ALVO)

      // 5️⃣ Não advertir a si mesmo
      if (limparNumero(alvoBruto) === limparNumero(sender)) {
        return await enviar(sock, jid, msg, AVISO_AUTO_ADV)
      }

      // 6️⃣ 👑 Proteção do dono do bot (PROOF-LID — mesma do /ban e /kick).
      // Nada é gravado no Mongo antes desta checagem.
      if (ehDonoDoBot(participantes, alvoBruto)) {
        return await enviar(sock, jid, msg, AVISO_DONO)
      }

      // 7️⃣ Motivo OBRIGATÓRIO
      const motivo = extrairMotivo(text, alvoBruto)
      if (!motivo) return await enviar(sock, jid, msg, AVISO_SEM_MOTIVO)

      // 8️⃣ 🪪 Número REAL do alvo e do autor (nunca gravamos LID cru)
      const alvoReal = await resolverNumeroReal(participantes, alvoBruto)
      if (!alvoReal) return await enviar(sock, jid, msg, AVISO_LID)

      let autorReal = await resolverNumeroReal(participantes, sender)
      if (!autorReal) {
        console.log('[adv] 🪪 número de quem aplicou não resolvido — gravando "desconhecido"')
        autorReal = 'desconhecido'
      }

      // 9️⃣ Gravação no Mongo
      let resultado = null
      try {
        resultado = await criarAdvertencia({
          numero: alvoReal,
          grupoId: jid,
          motivo,
          aplicadoPor: autorReal
        })
      } catch (erro) {
        console.error('[adv] 💥 erro ao gravar a advertência:', erro?.stack || erro)
        return await enviar(sock, jid, msg, AVISO_ERRO_BANCO)
      }
      if (!resultado) return await enviar(sock, jid, msg, AVISO_ERRO_BANCO)

      const { total, doc } = resultado
      console.log(`[adv] ⚠️ ${alvoReal} advertido em ${jid} (${total}/${LIMITE_ADVERTENCIAS}) por ${autorReal}`)

      // 🔟 Limite atingido → ban automático (senão, confirmação normal)
      if (total >= LIMITE_ADVERTENCIAS) {
        return await aplicarBanAutomatico(sock, jid, msg, alvoBruto, alvoReal, autorReal)
      }

      return await sock.sendMessage(jid, {
        text: montarConfirmacao({ alvoNumero: alvoReal, motivo, aplicadoPor: autorReal, total, data: doc.data }),
        mentions: [alvoBruto, sender]
      }, { quoted: msg })

    } catch (err) {
      console.error('Erro no comando adv:', err)
    }
  }
}


