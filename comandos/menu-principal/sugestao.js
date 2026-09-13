// ============================================
// 💡 SUGESTAO — Guarda a ideia do mortal na caixa de sugestões
// ============================================
// Uso:
//   /sugestao <texto>  -> salva no MongoDB (collection "sugestoes")
//                         com status inicial "pendente" e avisa os donos
//
// Regras:
//   - Texto OBRIGATÓRIO (vazio = aviso de uso, nada é salvo).
//   - Grava: número de quem enviou, nome do grupo (se for grupo),
//     texto, data/hora e status "pendente".
//   - Notifica cada dono (OWNER_NUMBERS) por DM — sem travar o fluxo
//     se a DM falhar (catch individual por dono).
// ============================================

const { limparNumero, OWNER_NUMBERS } = require('../../config')
const banco = require('../../sugestoes')

// Extrai o texto depois de "/sugestao" (ou "/sugerir", alias)
function extrairTexto(text) {
  return String(text || '').replace(/^\s*\/\S+\s*/, '').trim()
}

// Nome do grupo (só em grupo; no privado retorna null)
async function obterNomeGrupo(sock, jid) {
  if (!jid.endsWith('@g.us')) return null
  try {
    const metadados = await sock.groupMetadata(jid)
    const nome = String(metadados?.subject || '').trim()
    return nome || null
  } catch (err) {
    console.error('[sugestao] sem metadados do grupo (salva sem nome):', err?.message || err)
    return null
  }
}

// Avisa cada dono por DM — falha de UMA dm não derruba as outras
async function notificarDonos(sock, donoNumeros, resumo) {
  for (const numero of donoNumeros) {
    const jidDono = `${numero}@s.whatsapp.net`
    try {
      await sock.sendMessage(jidDono, { text: resumo })
    } catch (err) {
      console.error(`[sugestao] DM ao dono ${numero} falhou:`, err?.message || err)
    }
  }
}

module.exports = {
  nome: 'sugestao',
  aliases: ['sugerir', 'sugestoes', 'sugestao-bot'],
  descricao: 'Envia uma sugestão de melhoria para os donos do bot.',

  async executar(sock, jid, msg, text) {
    try {
      const texto = extrairTexto(text)

      // 1) Texto obrigatório — nada de sugestão vazia no banco
      if (!texto) {
        return await sock.sendMessage(jid, {
          text: '💡 *Conte sua ideia para Hipnos!*\n\nEnvie o texto junto do comando:\n`/sugestao criar um comando de lembretes`\n\n(Sua sugestão chega direto aos donos do bot. 🌙)'
        }, { quoted: msg })
      }

      if (texto.length > banco.LIMITE_TEXTO) {
        return await sock.sendMessage(jid, {
          text: `💡 Sua sugestão ficou longa demais (${texto.length} caracteres)... Resuma em até *${banco.LIMITE_TEXTO}* caracteres e envie de novo. 🌙`
        }, { quoted: msg })
      }

      // 2) Quem enviou (resolve LID → número) + onde (nome do grupo)
      const sender = msg.key?.participant || msg.key?.remoteJid || ''
      const numero = limparNumero(sender)
      const nomeRemetente = msg.pushName ? String(msg.pushName).trim() || null : null
      const nomeGrupo = await obterNomeGrupo(sock, jid)

      // 3) Salva no MongoDB (status inicial "pendente")
      let registro = null
      try {
        registro = await banco.salvarSugestao({ numero, nomeRemetente, nomeGrupo, texto })
      } catch (err) {
        console.error('[sugestao] falha ao salvar no MongoDB:', err?.message || err)
        return await sock.sendMessage(jid, {
          text: '⛔ A caixa de sugestões está indisponível no momento... Tente de novo mais tarde. 🌙'
        }, { quoted: msg })
      }

      if (!registro) {
        return await sock.sendMessage(jid, {
          text: '⛔ Não consegui registrar sua sugestão... Confira o texto e tente de novo. 🌙'
        }, { quoted: msg })
      }

      // 4) Confirmação para quem sugeriu
      await sock.sendMessage(jid, {
        text: '✅ *Sugestão enviada! Obrigado por ajudar a melhorar o bot* 🙏\n\nOs donos já foram avisados e vão analisar sua ideia. 🌙'
      }, { quoted: msg })

      // 5) DM aos donos (fora do quoted — mensagem direta, não resposta)
      const donos = [...new Set((OWNER_NUMBERS || []).map(limparNumero).filter(Boolean))]
        .filter((dono) => dono !== numero)
      if (donos.length) {
        const origem = nomeGrupo ? `no grupo "${nomeGrupo}"` : 'no privado'
        const autor = nomeRemetente ? `${nomeRemetente} (@${numero})` : `@${numero}`
        const resumo =
          '💡 *Nova sugestão recebida*\n\n' +
          `👤 De: ${autor}\n` +
          `📍 Onde: ${origem}\n` +
          `🗓️ Quando: ${banco.formatarDataHora(registro.criadoEm)}\n\n` +
          `📝 "${texto}"\n\n` +
          'Use /versugestoes para gerenciar.'
        await notificarDonos(sock, donos, resumo)
      }
    } catch (err) {
      console.error('Erro no comando sugestao:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente. 🌙'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
