// ============================================
// 📕 BLACKLIST — Lista os números banidos (apenas DONOS do bot)
// ============================================
// - Mostra TODOS os números que estão na blacklist
//   (comandos/dados/blacklist.json — o mesmo banco de /addblacklist
//   e /remblacklist).
// - A blacklist é GLOBAL: vale para todos os grupos monitorados pelo bot
//   (quem entra sendo blacklist é removido na hora pelo bot.js). Por isso o
//   acesso à listagem é restrito aos DONOS do bot — a mesma decisão de
//   permissão já usada por /addblacklist e /remblacklist (e pelos /darvip e
//   /servip): OWNER_NUMBERS do config.js.
// - Formata os números de forma legível com formatarNumero (mesma função
//   usada em /dono e /servip).
// ============================================

const fs = require('fs')
const path = require('path')

const { formatarNumero, ehDonoDoBot } = require('../../config')

// Mesmo banco usado por /addblacklist e /remblacklist
const BANCO_BLACKLIST = path.join(__dirname, '..', 'dados', 'blacklist.json')

function lerBlacklist() {
  try {
    if (!fs.existsSync(BANCO_BLACKLIST)) return []
    const dados = fs.readFileSync(BANCO_BLACKLIST, 'utf-8')
    const lista = JSON.parse(dados)
    return Array.isArray(lista) ? lista : []
  } catch (err) {
    console.error('Erro ao ler blacklist.json:', err)
    return []
  }
}

module.exports = {
  nome: 'blacklist',
  descricao: 'Lista os números banidos na blacklist (apenas donos do bot).',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid

      // 1) 🔒 Apenas donos do bot (mesma checagem de /addblacklist e /remblacklist).
      //    Checagem PROOF-LID: em grupo buscamos os metadados para resolver
      //    o sender mesmo quando ele vem como "@lid"; no privado (sem
      //    metadados) a própria função cai na comparação direta.
      let participantes = null
      if (jid.endsWith('@g.us')) {
        try {
          const metadados = await sock.groupMetadata(jid)
          participantes = metadados.participants
        } catch (err) {
          console.error('[blacklist] Sem metadados do grupo:', err?.message || err)
        }
      }
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos só obedece aos donos do bot.*\n\nO livro das sombras 📕 permanece selado aos olhos dos mortais.'
        }, { quoted: msg })
      }

      const lista = lerBlacklist()

      // 2) Blacklist vazia -> aviso amigável
      if (!lista.length) {
        return await sock.sendMessage(jid, {
          text: '📕 *A lista de sombras está vazia.*\n\nNenhuma alma jaz aprisionada no limbo... O silêncio reina.\n\nUse */addblacklist @membro* para condenar a primeira alma.'
        }, { quoted: msg })
      }

      // 3) Lista numerada com números legíveis (formatarNumero do config.js)
      const linhas = lista.map((numero, indice) => {
        return `${indice + 1}. ☠️ *${formatarNumero(numero)}*`
      })

      const resposta =
        `📕 *LISTA DE SOMBRAS* (${lista.length} banido${lista.length > 1 ? 's' : ''}) 📕\n\n` +
        linhas.join('\n') +
        '\n\n🕊️ Para libertar uma alma: */remblacklist @membro* ou */remblacklist [número]*'

      await sock.sendMessage(jid, { text: resposta }, { quoted: msg })
    } catch (err) {
      console.error('Erro no comando blacklist:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg })
    }
  }
}