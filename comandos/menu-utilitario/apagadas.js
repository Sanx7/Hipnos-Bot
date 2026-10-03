// ============================================
// PARTE 1/2 — /apagadas: lista as apagadas do dia
// ============================================
// Consulta dados/historico-apagadas.js (Mongo com TTL ate meia-noite,
// mesmo padrao do /jornal). So grupos. Sem registro no dia = aviso amigavel.
const { listarDoDia } = require('../../dados/historico-apagadas')

const PREVIA_TEXTO = 80

function formatarHora(timestamp) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit'
    }).format(new Date(timestamp))
  } catch (e) {
    return '--:--'
  }
}

function rotuloTipo(tipo) {
  if (tipo === 'imagem') return 'mídia: imagem'
  if (tipo === 'video') return 'mídia: vídeo'
  if (tipo === 'audio') return 'mídia: áudio'
  if (tipo === 'documento') return 'mídia: documento'
  if (tipo === 'figurinha') return 'mídia: figurinha'
  return null
}

function previaItem(item) {
  const rotulo = rotuloTipo(item.tipo)
  const previa = String(item.texto || '').trim().slice(0, PREVIA_TEXTO)
  if (rotulo && previa) return `${rotulo} — "${previa}"`
  if (rotulo) return rotulo
  if (previa) return `"${previa}"`
  return 'mensagem apagada'
}

function nomeAutor(item) {
  if (item.autorNome) return item.autorNome
  const digitos = String(item.autor || '').split('@')[0].replace(/\D/g, '')
  return digitos ? `+${digitos}` : 'alguém'
}

module.exports = {
  nome: 'apagadas',
  aliases: ['historico-apagadas', 'msgsapagadas'],
  descricao: 'Lista as mensagens apagadas de hoje neste grupo (autor, horário e prévia).',
  categoria: 'utilitario',

  async executar(sock, jid, msg) {
    try {
      if (!String(jid || '').endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '🗑️ *O /apagadas só funciona em grupos.*\n\nO histórico de apagadas é próprio de cada recinto — invoque o comando dentro do grupo desejado.'
        }, { quoted: msg }).catch(() => {})
      }
      const itens = await listarDoDia(String(jid))
      if (!itens || !itens.length) {
        return await sock.sendMessage(jid, {
          text: '🗑️ *Nenhuma mensagem apagada hoje... por enquanto.*\n\nQuando alguém apagar "para todos" com a recuperação ligada (/antiapagada 1), o conteúdo volta ao grupo na hora e entra aqui no histórico do dia.'
        }, { quoted: msg }).catch(() => {})
      }
      const linhas = itens.map((item, i) => {
        const hora = formatarHora(item.horario)
        return `${i + 1}. 👤 *${nomeAutor(item)}* (${hora}) — ${previaItem(item)}`
      })
      const resposta = `🗑️ *APAGADAS DE HOJE* (${itens.length})\n\n${linhas.join('\n')}\n\n💤 *"O que o sono apaga, o Limbo registra."*`
      await sock.sendMessage(jid, { text: resposta }, { quoted: msg }).catch(() => {})
    } catch (err) {
      console.error('[apagadas] erro (bot vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram a consulta... Tente novamente.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  _internos: { formatarHora, rotuloTipo, previaItem, nomeAutor, PREVIA_TEXTO }
}

