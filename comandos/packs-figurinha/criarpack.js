// ============================================================
// 📦 CRIARPACK — cria um pack vazio no museu
// ============================================================
// Uso: /criarpack <nome> | <descrição opcional>
// O pack nasce ATIVO e vazio; as figurinhas entram via /addfig.
// Limites (núcleo): nome até 30, descrição até 100, 5 packs por dono.
// ============================================================

const prefixoComandos = require('../../prefixo')
const { resolverNumeroAlvo } = require('../../lid')
const { criarPack, LIMITE_NOME, LIMITE_DESCRICAO } = require('../../packs-figurinha')

module.exports = {
  nome: 'criarpack',
  descricao: 'Cria um pack de figurinhas vazio no museu.',

  async executar(sock, jid, msg, texto) {
    try {
      const argumentos = prefixoComandos.removerPrefixo(texto).split(' ').slice(1).join(' ').trim()

      let nome = argumentos
      let descricao = ''
      if (argumentos.includes('|')) {
        const partes = argumentos.split('|')
        nome = (partes[0] || '').trim()
        descricao = partes.slice(1).join('|').trim()
      }

      if (!nome) {
        return await sock.sendMessage(jid, {
          text:
            '📦 *Criar pack*\n\n' +
            'Uso: /criarpack <nome> | <descrição>\n' +
            'Ex.: /criarpack Memes do limbo | só os clássicos\n\n' +
            `• Nome: até ${LIMITE_NOME} caracteres\n` +
            `• Descrição: até ${LIMITE_DESCRICAO} caracteres (opcional)`
        }, { quoted: msg })
      }

      let participantes = []
      if (String(jid || '').endsWith('@g.us')) {
        try {
          participantes = (await sock.groupMetadata(jid))?.participants || []
        } catch (errMeta) {
          console.error('[criarpack] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta)
        }
      }
      const remetente = msg.key?.participant || msg.key?.remoteJid || ''
      const { numero } = await resolverNumeroAlvo(participantes, remetente)

      const resultado = await criarPack({
        nome,
        descricao,
        dono: numero,
        dono_nome: msg.pushName || '',
        grupo_origem: jid
      })

      if (!resultado.ok) {
        return await sock.sendMessage(jid, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
      }

      await sock.sendMessage(jid, {
        text:
          `📦 *Pack "${resultado.pack.nome}" criado!*\n\n` +
          'Adicione figurinhas respondendo a uma figurinha com:\n' +
          `/addfig ${resultado.pack.nome}\n\n` +
          'Ele já aparece no /museu. 💤'
      }, { quoted: msg })
    } catch (err) {
      console.error('[criarpack] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '❌ Não consegui criar o pack agora — tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
