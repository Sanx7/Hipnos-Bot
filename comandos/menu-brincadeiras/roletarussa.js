// ============================================
// 🔫 ROLETARUSSA — A Roleta do Limbo
// ============================================
// Versão LETAL da /roleta: sorteia UM mortal COMUM do grupo ao acaso
// e o remove do grupo DE VERDADE (groupParticipantsUpdate 'remove').
//
// Regras da casa:
//   - Só funciona dentro de GRUPO (no privado, avisa e sai);
//   - Restrito a ADMINISTRADORES do grupo ou DONOS DO BOT
//     (OWNER_NUMBERS + ehAdminDoGrupo, mesmo padrão dos comandos admin);
//   - NUNCA entram no tambor: admins/superadmins, o dono do grupo
//     (metadados.owner), os donos do bot (OWNER_NUMBERS) e o próprio bot;
//   - O BOT precisa ser admin do grupo para conseguir remover alguém —
//     se não for, avisa e NÃO tenta a remoção (mesmo padrão do /seradm);
//   - Anuncia o sorteado com menção, dá um suspense curto e remove,
//     tudo sob try/catch para nunca travar o bot.
// ============================================

const {
  OWNER_NUMBERS,
  limparNumero,
  acharParticipante,
  ehAdminDoGrupo
} = require('../../config')

// Pausa dramática entre o anúncio do sorteado e a remoção efetiva (ms)
const SUSPENSE_MS = 2500

// Frases de suspense para o anúncio (mesmo estilo da /roleta)
const SUSPENSE = [
  'O tambor do destino girou entre as almas deste grupo...',
  'As sombras giraram o cilindro lentamente... click... click...',
  'O pêndulo do sono hesita sobre um nome...',
  'O limbo estende a mão e escolhe...'
]

// Sorteia uma frase aleatória de uma lista
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)]
}

// Diz se o participante tem cargo de admin (admin ou superadmin)
function ehParticipanteAdmin(participante) {
  return Boolean(
    participante &&
      (participante.admin === 'admin' || participante.admin === 'superadmin')
  )
}

// Retorna o JID real e mencionável de um participante do grupo.
// (mesma técnica da /roleta: prefere phoneNumber, mantém o domínio
// ORIGINAL do id e remove o sufixo de dispositivo :N)
function jidMencionavel(participante) {
  const bruto = participante?.phoneNumber || participante?.id || ''
  const [usuario, servidor] = String(bruto).split('@')
  if (!usuario || !servidor) return ''
  return `${usuario.split(':')[0]}@${servidor}`
}

// Dígitos do participante (id E phoneNumber) — para comparar com as
// listas de exclusão mesmo quando o Baileys entrega o id como LID (@lid)
function numerosDoParticipante(participante) {
  return [
    limparNumero(participante?.id),
    limparNumero(participante?.phoneNumber)
  ].filter(Boolean)
}

module.exports = {
  nome: 'roletarussa',
  descricao: 'A roleta do limbo: sorteia um mortal comum do grupo e o expulsa de verdade (Admins/Donos do bot).',

  async executar(sock, jid, msg) {
    try {
      // 1) 🔒 Só funciona dentro de um grupo
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '🔫 O tambor da roleta só gira dentro de um grupo. No privado não há mortais para julgar.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 2) Lista REAL de participantes do grupo via Baileys
      const metadados = await sock.groupMetadata(jid)
      const participantes = metadados.participants || []

      // 3) 🔒 Restrito a ADMINS DO GRUPO ou DONOS DO BOT
      const ehDonoBot = OWNER_NUMBERS.includes(limparNumero(sender))
      if (!ehDonoBot && !ehAdminDoGrupo(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 *A roleta do limbo só obedece aos ADMINISTRADORES do grupo ou aos DONOS do bot.*\n\nMortais comuns não puxam o gatilho do destino.'
        }, { quoted: msg })
      }

      // 4) ⚠️ O BOT precisa ser admin do grupo para conseguir remover alguém
      const botNoGrupo = acharParticipante(participantes, sock.user?.id)
      if (!ehParticipanteAdmin(botNoGrupo)) {
        return await sock.sendMessage(jid, {
          text: '⚠️ *Hipnos precisa ser administrador deste grupo* para puxar o gatilho.\n\n👉 Adicione o bot como *admin do grupo* e gire a roleta novamente.'
        }, { quoted: msg })
      }

      // 5) Elegíveis = todos EXCETO os blindados:
      //    admins/superadmins, dono do grupo, donos do bot e o próprio bot.
      const numeroDoBot = limparNumero(sock.user?.id)
      const numeroDonoGrupo = limparNumero(metadados.owner)
      const donosDoBot = new Set(OWNER_NUMBERS.map(limparNumero).filter(Boolean))

      const elegiveis = participantes.filter((p) => {
        if (ehParticipanteAdmin(p)) return false
        const numeros = numerosDoParticipante(p)
        if (numeroDoBot && numeros.includes(numeroDoBot)) return false
        if (numeroDonoGrupo && numeros.includes(numeroDonoGrupo)) return false
        if (numeros.some((n) => donosDoBot.has(n))) return false
        return true
      })

      // 6) Ninguém elegível → não gira o tambor e não remove ninguém
      if (!elegiveis.length) {
        return await sock.sendMessage(jid, {
          text: '🕊️ *Ninguém elegível para a roleta.*\n\nTodos aqui são admins, donos ou o próprio bot — o limbo não aceita sacrifícios blindados. 😴'
        }, { quoted: msg })
      }

      // 7) 🎲 Sorteia UM participante ao acaso
      const sorteado = elegiveis[Math.floor(Math.random() * elegiveis.length)]
      const jidSorteado = sorteado.id // id EXATAMENTE como o WhatsApp conhece (pode ser @lid)
      const jidMencao = jidMencionavel(sorteado)
      const numeroExibicao = String(jidMencao || sorteado.id).split('@')[0]

      // 8) 🔫 Anuncia o sorteado ANTES de remover (com menção)
      await sock.sendMessage(jid, {
        text: `${sortearFrase(SUSPENSE)}\n\n🔫 A roleta apontou para @${numeroExibicao}.\n\n💀 "O destino escolheu. Que as sombras o recebam."`,
        mentions: [jidMencao || jidSorteado]
      }, { quoted: msg })

      // Suspense antes da remoção
      await new Promise((resolver) => setTimeout(resolver, SUSPENSE_MS))

      // 9) ⚰️ Remoção efetiva — sob try/catch para nunca travar o bot
      try {
        const resultado = await sock.groupParticipantsUpdate(jid, [jidSorteado], 'remove')

        // O Baileys às vezes NÃO lança erro, mas devolve status >= 400
        const status = Array.isArray(resultado) && resultado[0]
          ? Number(resultado[0].status || 200)
          : 200
        if (status >= 400) throw new Error(`WhatsApp devolveu status ${status} ao remover`)

        await sock.sendMessage(jid, {
          text: `⚰️ @${numeroExibicao} foi tragado pelo limbo. 😴\n\nO grupo dorme um pouco mais leve... por enquanto.`,
          mentions: [jidMencao || jidSorteado]
        }, { quoted: msg })
      } catch (errRemocao) {
        console.error('[roletarussa] Falha ao remover participante:', errRemocao?.message || errRemocao)
        await sock.sendMessage(jid, {
          text: '⛔ *O limbo recusou a oferta...*\n\nNão consegui remover o sorteado (verifique se o bot é admin do grupo e tente novamente).'
        }, { quoted: msg })
      }
    } catch (err) {
      console.error('[roletarussa] Erro inesperado:', err?.message || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras se embaraçaram e a roleta travou... Tente novamente em instantes.'
      }, { quoted: msg })
    }
  }
};