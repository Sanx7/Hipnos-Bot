const yts = require('yt-search')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando a API estável do Cobalt.',
  async executar(sock, jid, msg, texto) {
    try {
      if (!texto || !texto.trim()) {
        return await sock.sendMessage(jid, { 
          text: '❌ Digite o nome da música! Exemplo: `/play Linkin Park In The End`' 
        }, { quoted: msg })
      }

      const termoPesquisa = texto.trim()
      await sock.sendMessage(jid, { text: `🔍 Buscando por "${termoPesquisa}" no YouTube...` }, { quoted: msg })

      const resultado = await yts(termoPesquisa)
      const video = resultado.videos[0]

      if (!video) {
        return await sock.sendMessage(jid, { text: '❌ Nenhuma música encontrada com esse nome.' }, { quoted: msg })
      }

      const infoTexto = `🎵 *Música Encontrada!*\n\n📌 *Título:* ${video.title}\n⏱️ *Duração:* ${video.timestamp}\n\n⏳ *Baixando áudio via Cobalt Engine...*`
      await sock.sendMessage(jid, { text: infoTexto }, { quoted: msg })

      const pastaTemp = os.tmpdir()
      const arquivoSaida = path.join(pastaTemp, `play_${Date.now()}.mp3`)

      // Requisição para a API moderna do Cobalt (Parâmetros atualizados V10)
      const response = await axios.post('https://api.cobalt.tools/api/json', {
        url: video.url,
        isAudioOnly: true,
        aFormat: 'mp3'
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 15000
      })

      if (!response.data || !response.data.url) {
        throw new Error('Cobalt não retornou uma URL válida.')
      }

      const downloadUrl = response.data.url

      // Baixando o arquivo stream finalizado
      const writer = fs.createWriteStream(arquivoSaida)
      const stream = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream'
      })

      stream.data.pipe(writer)

      writer.on('finish', async () => {
        await sock.sendMessage(jid, { 
          audio: fs.readFileSync(arquivoSaida), 
          mimetype: 'audio/mp4',
          ptt: false
        }, { quoted: msg })

        setTimeout(() => {
          if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
        }, 1000)
      })

      writer.on('error', async (err) => {
        console.error(err)
        await sock.sendMessage(jid, { text: '❌ Erro ao processar o áudio no servidor.' }, { quoted: msg })
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      })

    } catch (err) {
      console.error('Erro geral no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ O servidor de download está instável no momento. Tente novamente em instantes.' }, { quoted: msg })
    }
  }
}