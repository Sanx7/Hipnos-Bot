// ============================================
// 🎤 LETRA — Busca a letra de músicas (Lyrics.ovh — grátis, sem key)
// ============================================
// /letra <artista> - <musica>
//   Ex.: /letra Coldplay - Yellow
//
// Como funciona:
//   1) Separa artista e música pelo " - " no texto do comando;
//   2) GET https://api.lyrics.ovh/v1/{artista}/{musica} (grátis, sem key);
//   3) Extrai o campo `lyrics` e envia — em PARTES se a letra for longa.
//
// Detalhes:
//   - ⏳ Timeout de 10s via AbortController (API presa não prende o comando);
//   - 404 / letra vazia → "Letra não encontrada, confira o nome do artista
//     e da música" (mensagem amigável, sem derrubar nada);
//   - ✂️ Letra longa: dividida em partes de até 3500 chars, cortando em fim
//     de linha quando possível, no MÁXIMO 3 mensagens — se ainda sobrar
//     letra, a última parte é truncada com aviso;
//   - 🪝 Ponto de injeção (_injetarBusca) para os testes offline.
// ============================================

const API_BASE = 'https://api.lyrics.ovh/v1'
const TIMEOUT_MS = 10000

// ✂️ Limite de chars por mensagem e máximo de partes enviadas
const LIMITE_PARTE = 3500
const MAX_PARTES = 3

// ─── 🌐 Busca na Lyrics.ovh ───
// Retorna { status: 'ok', letra } ou { status: 'nao_encontrada' | 'api' |
// 'timeout' | 'rede' } — nunca lança (o executar traduz para aviso amigável).
async function buscarLetraPadrao (artista, musica) {
  const url = `${API_BASE}/${encodeURIComponent(artista)}/${encodeURIComponent(musica)}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'Hipnos-Bot/1.0' },
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    if (resp.status === 404) return { status: 'nao_encontrada' }
    if (!resp.ok) return { status: 'api' }
    const dados = await resp.json()
    const letra = String(dados?.lyrics || '').replace(/\r\n/g, '\n').trim()
    if (!letra) return { status: 'nao_encontrada' }
    return { status: 'ok', letra }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err?.name === 'AbortError') return { status: 'timeout' }
    return { status: 'rede' }
  }
}

// 🪝 Ponto de injeção para os testes offline
let buscarLetra = buscarLetraPadrao

// ─── ✂️ Divide a letra em partes (corta em fim de linha quando possível) ───
// Nunca gera mais que `maxPartes` partes; se sobrar letra, a última parte é
// truncada com aviso (requisito: "dividir em múltiplas mensagens ou truncar").
function dividirLetra (letra, limite = LIMITE_PARTE, maxPartes = MAX_PARTES) {
  if (letra.length <= limite) return [letra]
  const partes = []
  let restante = letra
  while (restante.length > 0 && partes.length < maxPartes) {
    if (restante.length <= limite) {
      partes.push(restante)
      restante = ''
      break
    }
    let corte = restante.lastIndexOf('\n', limite)
    if (corte < limite * 0.5) corte = limite // sem linha boa por perto: corta seco
    partes.push(restante.slice(0, corte))
    restante = restante.slice(corte).replace(/^\n+/, '')
  }
  if (restante.length > 0) {
    partes[partes.length - 1] += '\n\n⚠️ *Letra muito longa — exibindo só o começo.*'
  }
  return partes
}

// ---- EXPORTACAO PRINCIPAL (mesmo contrato do loader: nome + executar) ----
module.exports = {
  nome: 'letra',
  descricao: 'Busca a letra de uma música (Lyrics.ovh). Formato: /letra artista - musica.',

  executar: async function (sock, jid, msg, texto) {
    try {
      const entrada = String(texto || '').replace(/^\/\S+\s*/, '').trim()
      const separador = entrada.indexOf(' - ')

      // Sem os dois campos → explica o formato esperado
      if (!entrada || separador === -1 || !entrada.slice(0, separador).trim() || !entrada.slice(separador + 3).trim()) {
        return await sock.sendMessage(jid, {
          text: '🎤 *Como usar a busca de letras*\n\n' +
            'Envie no formato (os dois campos, separados por " - "):\n' +
            '`/letra artista - musica`\n\n' +
            '🗝️ Exemplo: `/letra Coldplay - Yellow`'
        }, { quoted: msg })
      }

      const artista = entrada.slice(0, separador).trim()
      const musica = entrada.slice(separador + 3).trim()

      await sock.sendMessage(jid, {
        text: `🎤 Buscando a letra de *${musica}* (${artista}) no limbo...`
      }, { quoted: msg })

      const resultado = await buscarLetra(artista, musica)

      // Erros amigáveis por tipo
      if (resultado.status !== 'ok') {
        const aviso = resultado.status === 'nao_encontrada'
          ? '❌ *Letra não encontrada, confira o nome do artista e da música.*\n\n' +
            '💡 Dica: tente sem trechos entre parênteses (feat., ao vivo, remix...)'
          : resultado.status === 'timeout'
            ? '⏰ A busca demorou demais (10s). Tente novamente em instantes.'
            : '⛔ A API de letras está fora do ar agora. Tente novamente em instantes.'
        return await sock.sendMessage(jid, { text: aviso }, { quoted: msg })
      }

      // Envia a letra (em partes, se for longa)
      const partes = dividirLetra(resultado.letra)
      for (let i = 0; i < partes.length; i++) {
        const cabecalho = partes.length > 1 ? `(Parte ${i + 1}/${partes.length})` : ''
        await sock.sendMessage(jid, {
          text: `🎤 *${artista} — ${musica}* ${cabecalho}\n\n${partes[i]}`
        }, { quoted: msg })
      }
    } catch (err) {
      // 🛡️ Última linha de defesa: NADA escapa para o socket
      console.error('[letra] 💥 erro capturado (o bot segue vivo):', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⛔ Algo deu errado ao buscar a letra... Tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  },

  // Extras internos para os testes offline (mesmo padrão do pinterest)
  dividirLetra,
  LIMITE_PARTE,
  MAX_PARTES,
  _injetarBusca: (fn) => { buscarLetra = fn || buscarLetraPadrao }
}
