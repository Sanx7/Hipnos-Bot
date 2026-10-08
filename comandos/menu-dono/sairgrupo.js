const estadoBot = require('../../estado-bot')
const { limparNumero } = require('../../config')
const { ehLid, resolverNumeroAlvo } = require('../../lid')
const { obterPrefixo } = require('../../prefixo')
const pendentes = new Map()
const PRAZO_MS = 30000

function apagar(jid) {
  const pedido = pendentes.get(jid)
  if (pedido) clearTimeout(pedido.timer)
  pendentes.delete(jid)
}

module.exports = {
  nome: 'sairgrupo',
  aliases: ['sairdogrupo', 'sairgp', 'leavegp'],
  categoria: 'dono',
  descricao: 'Retira o Hipnos do grupo mediante confirmação do dono.',
  async executar(sock, jid, msg, text = '') {
    try {
      if (!jid.endsWith('@g.us')) return await sock.sendMessage(jid, { text: '🌙 O /sairgrupo só funciona dentro de grupos.' }, { quoted: msg })
      const sender = msg.key.participant || msg.key.remoteJid
      if (!await estadoBot.remetenteEhDono(sock, jid, sender)) {
        return await sock.sendMessage(jid, { text: '👑 Só o dono do bot pode retirar Hipnos do grupo.' }, { quoted: msg })
      }
      let participantes = []
      if (ehLid(sender)) {
        try { participantes = (await sock.groupMetadata(jid))?.participants || [] } catch (_) { /* tenta sessão */ }
        participantes = participantes.filter(p => ehLid(p.id) && limparNumero(p.id) === limparNumero(sender))
      }
      const identidade = await resolverNumeroAlvo(participantes, sender)
      if (!identidade.via || !identidade.numero) throw new Error('Identidade do dono indisponível.')
      const argumento = String(text).trim().split(/\s+/).slice(1).join(' ').toLowerCase()
      if (argumento && argumento !== 'confirmar') {
        return await sock.sendMessage(jid, { text: '🌙 Use /sairgrupo para iniciar ou /sairgrupo confirmar para confirmar.' }, { quoted: msg })
      }
      if (!argumento) {
        const prefixo = await obterPrefixo()
        apagar(jid)
        const pedido = { dono: identidade.numero, expiraEm: Date.now() + PRAZO_MS }
        pedido.timer = setTimeout(() => { if (pendentes.get(jid) === pedido) pendentes.delete(jid) }, PRAZO_MS)
        pedido.timer.unref()
        pendentes.set(jid, pedido)
        try {
          await sock.sendMessage(jid, { text: `🌙 Deseja realmente retirar Hipnos deste grupo?\n\nPara confirmar, envie ${prefixo}sairgrupo confirmar em até 30 segundos.` }, { quoted: msg })
        } catch (err) {
          if (pendentes.get(jid) === pedido) apagar(jid)
          throw err
        }
        return
      }
      const pedido = pendentes.get(jid)
      if (pedido && Date.now() >= pedido.expiraEm) apagar(jid)
      if (!pedido || Date.now() >= pedido.expiraEm || pedido.dono !== identidade.numero) {
        return await sock.sendMessage(jid, { text: '🌙 Não há confirmação válida sua neste grupo. Inicie novamente com /sairgrupo.' }, { quoted: msg })
      }
      // Consumir sincronamente ANTES de qualquer envio/saída: confirmações
      // concorrentes e reutilizadas não conseguem chamar groupLeave novamente.
      apagar(jid)
      try {
        await sock.sendMessage(jid, { text: '🌑 O sono chegou ao fim neste reino. Hipnos retorna às sombras.' })
      } catch (err) {
        console.error('[sairgrupo] Falha na despedida:', err?.message || err)
      }
      try {
        await sock.groupLeave(jid)
      } catch (err) {
        console.error('[sairgrupo] Falha ao sair do grupo:', err?.message || err)
        await sock.sendMessage(jid, { text: '🌙 Não consegui sair deste grupo. Para tentar novamente, inicie uma nova confirmação.' }, { quoted: msg }).catch(() => {})
      }
    } catch (err) {
      console.error('[sairgrupo]', err?.message || err)
      await sock.sendMessage(jid, { text: '🌙 Não consegui concluir o pedido agora. Tente novamente.' }, { quoted: msg }).catch(() => {})
    }
  },
  __limparConfirmacoesTeste() { for (const jid of pendentes.keys()) apagar(jid) }
}
