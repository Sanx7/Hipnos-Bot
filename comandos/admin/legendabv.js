// ============================================
// 📝 LEGENDABV — Legenda personalizada das boas-vindas DESTE grupo
// ============================================
// Uso (dentro de um grupo, restrito a ADMIN do grupo ou DONO do bot — o
// MESMO critério do /welcome e do /soadm, via ehAutorizadoNoGrupo):
//
//   /legendabv <texto>   → salva a legenda personalizada deste grupo
//   /legendabv           → mostra a legenda atual (customizada ou padrão)
//                          + os placeholders e um PREVIEW de como ficaria
//   /legendabv reset     → volta à legenda padrão
//
//  PLACEHOLDERS (substituídos na hora do envio, em boasvindas.js):
//   @nome       → pushName do novo membro (ou o número formatado)
//   @numero     → número do novo membro (somente dígitos — vira MENÇÃO no
//                 WhatsApp, notificando a pessoa)
//   @grupo      → nome do grupo
//   @quantidade → total de membros do grupo APÓS a entrada
//
//  LEGENDA PADRÃO (usada quando o grupo não tem nenhuma salva):
//   " 🌙 *Bem-vindo(a) aos Campos Elísios, @nome.* O sono profundo te
//     aguarda em *@grupo*."
//
// Persistência: MongoDB — campo `legenda_customizada` do MESMO documento de
// configurações do grupo (collection "configuracoesGrupo", 1 por grupo_id);
// a lógica vive em configuracoes-grupo.js.
// ============================================

const {
  definirLegenda,
  removerLegenda,
  obterLegenda,
  LIMITE_CARACTERES_LEGENDA
} = require('../../configuracoes-grupo')
const {
  ehAutorizadoNoGrupo,
  montarLegenda,
  LEGENDA_PADRAO,
  PLACEHOLDERS
} = require('../../boasvindas')
const { limparNumero, formatarNumero } = require('../../config')

// Palavras que disparam o reset (aceitas como 1º argumento)
const OPCOES_RESET = ['reset', 'padrao', 'padrão', 'remover', 'limpar', 'apagar', '0', 'off']

const MSG_SEM_PERMISSAO =
  '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem definir a legenda das boas-vindas.'

const MSG_FORA_DE_GRUPO =
  '📝 *Hipnos só escreve em portais de um grupo.*\n\nUse este comando em um grupo para definir a legenda das boas-vindas.'

// -------------------------------------------------------------------
// ️ extrairTexto(text): remove o token do comando ("/legendabv") e devolve
// o que sobrou (a legenda em si), PRESERVANDO quebras de linha.
// -------------------------------------------------------------------
function extrairTexto(text) {
  return String(text || '')
    .replace(/^\/?\S+/, '')  // tira o próprio comando
    .replace(/^\s+/, '')      // e o espaço logo depois dele
    .trimEnd()
}

// -------------------------------------------------------------------
// 🔍 placeholdersDesconhecidos(legenda): lista os "@palavras" que NÃO são
// placeholders suportados (ajuda o admin a não escrever "@membro" achando
// que virará um nome). Ignora as menções numéricas (@5511...).
// -------------------------------------------------------------------
function placeholdersDesconhecidos(legenda) {
  const suportados = PLACEHOLDERS.map((p) => p.slice(1).toLowerCase())
  const encontrados = new Set()

  for (const casamento of String(legenda).matchAll(/@([a-zà-ÿ_]+)/gi)) {
    const nome = (casamento[1] || '').toLowerCase()
    if (!nome || suportados.includes(nome)) continue
    encontrados.add(`@${nome}`)
  }

  return [...encontrados]
}

// -------------------------------------------------------------------
// 👁️ previewLegenda(modelo, metadados, sender): mostra como a legenda ficaria
// numa entrada real (usando o nome do autor do comando como exemplo).
// -------------------------------------------------------------------
function previewLegenda(modelo, metadados, sender) {
  const numero = limparNumero(sender) || '5511999999999'
  return montarLegenda(modelo, {
    nome: 'Alma Nova',
    numero,
    grupo: metadados?.subject || 'Recinto',
    quantidade: (metadados?.participants?.length || 0) + 1
  })
}

// -------------------------------------------------------------------
// 📐 ajuda/status quando o comando é chamado sem texto
// -------------------------------------------------------------------
function textoDeStatus(modelo, customizada, preview) {
  return [
    '📝 *PORTAL DA LEGENDA*',
    '',
    `Legenda atual: *${customizada ? 'CUSTOMIZADA' : 'PADRÃO'}*`,
    '',
    '┈┈┈┈┈┈┈┈┈┈┈┈',
    modelo,
    '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈',
    '',
    '👁️ *Como ficaria numa entrada:*',
    preview,
    '',
    '️ *Placeholders disponíveis:*',
    '• @nome — nome de quem entrou',
    '• @numero — número de quem entrou (vira menção)',
    '• @grupo — nome do grupo',
    '• @quantidade — total de membros após a entrada',
    '',
    `✏️ Para salvar: */legendabv* seguido do seu texto (até ${LIMITE_CARACTERES_LEGENDA} caracteres).`,
    '♻️ Para voltar ao padrão: */legendabv reset*'
  ].join('\n')
}
module.exports = {
  nome: 'legendabv',
  aliases: ['setlegendabv'],
  descricao: 'Define a legenda personalizada das boas-vindas deste grupo (apenas administradores).',

  async executar(sock, jid, msg, text) {
    try {
      // 1) 🚪 Só dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, { text: MSG_FORA_DE_GRUPO }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 2) 🔒 Autorização — MESMO critério do /welcome e do /soadm
      const { autorizado, metadados } = await ehAutorizadoNoGrupo(sock, jid, sender)
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: MSG_SEM_PERMISSAO }, { quoted: msg })
      }

      const conteudo = extrairTexto(text)

      // 3) ℹ️ Sem texto → mostra a legenda atual (ou o padrão) + preview
      if (!conteudo) {
        const atual = await obterLegenda(jid)
        const modelo = atual || LEGENDA_PADRAO
        return await sock.sendMessage(jid, {
          text: textoDeStatus(modelo, Boolean(atual), previewLegenda(modelo, metadados, sender))
        }, { quoted: msg })
      }

      // 4) ♻️ Reset (volta à legenda padrão)
      if (OPCOES_RESET.includes(conteudo.trim().toLowerCase())) {
        const tinhaLegenda = await removerLegenda(jid)
        return await sock.sendMessage(jid, {
          text: tinhaLegenda
            ? `♻️ *LEGENDA RESTAURADA*\n\nA legenda deste grupo foi apagada. As boas-vindas voltam à legenda padrão:\n\n${LEGENDA_PADRAO}`
            : '⚠️ Este grupo *não tinha* legenda personalizada. Nada mudou (a padrão segue em uso).'
        }, { quoted: msg })
      }

      // 5) 📏 Limite de tamanho (avisamos ANTES de gravar no banco)
      if (conteudo.length > LIMITE_CARACTERES_LEGENDA) {
        return await sock.sendMessage(jid, {
          text: `⚠️ Legenda longa demais (${conteudo.length} caracteres). O limite é ${LIMITE_CARACTERES_LEGENDA}.`
        }, { quoted: msg })
      }

      // 6) 🗄️ Salva no MongoDB (associada a ESTE grupo_id)
      await definirLegenda(jid, conteudo)
      console.log(`[legendabv] ✅ legenda salva em ${jid} (${conteudo.length} caracteres)`)

      // 7) ✅ Confirma + preview + avisos
      const avisos = []
      const desconhecidos = placeholdersDesconhecidos(conteudo)
      if (desconhecidos.length) {
        avisos.push(
          `⚠️ Placeholder(s) não reconhecido(s): ${desconhecidos.join(', ')} — eles ficarão no texto como foram escritos.`,
          `   Válidos: ${PLACEHOLDERS.join(', ')}`
        )
      }

      return await sock.sendMessage(jid, {
        text: [
          '📝 *LEGENDA DAS BOAS-VINDAS ATUALIZADA* ✅',
          '',
          '┈┈┈┈┈┈┈┈┈┈┈┈',
          conteudo,
          '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈',
          '',
          '👁️ *Como ficaria numa entrada:*',
          previewLegenda(conteudo, metadados, sender),
          ...(avisos.length ? ['', ...avisos] : []),
          '',
          '♻️ Para voltar ao padrão: */legendabv reset*'
        ].join('\n')
      }, { quoted: msg })

    } catch (err) {
      console.error('[legendabv] 💥 erro:', err?.stack || err)

      const detalhe = String(err?.message || '')
      if (detalhe.includes('MONGODB_URI') || detalhe.includes('MongoDB') || detalhe.includes('grupo_id')) {
        return await sock.sendMessage(jid, {
          text: '⛔ O *banco de dados* está indisponível agora — a legenda NÃO foi salva. Tente novamente em instantes.'
        }, { quoted: msg }).catch(() => {})
      }

      return await sock.sendMessage(jid, {
        text: ' As sombras não conseguiram escrever essa legenda... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}