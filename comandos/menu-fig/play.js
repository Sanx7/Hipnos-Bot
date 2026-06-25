const yts = require('yt-search')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube.',
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

      const infoTexto = `🎵 *Música Encontrada!*\n\n📌 *Título:* ${video.title}\n⏱️ *Duração:* ${video.timestamp}\n\n⏳ *Baixando áudio (Servidor Seguro)...*`
      await sock.sendMessage(jid, { text: infoTexto }, { quoted: msg })

      const pastaTemp = os.tmpdir()
      const arquivoSaida = path.join(pastaTemp, `play_${Date.now()}.mp3`)

      // Usando uma API pública de conversão de YouTube para MP3 para burlar o bloqueio do Render
      const apiUrl = `https://api.vreden.web.id/api/ytmp3?url=${encodeURIComponent(video.url)}`
      const response = await axios.get(apiUrl)

      if (!response.data || !response.data.result || !response.data.result.download) {
        throw new Error('Falha na API de download')
      }

      const downloadUrl = response.data.result.download
      const writer = fs.createWriteStream(arquivoSaida)

      const stream = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream'
      })

      stream.data.pipe(writer)

      writer.on('finish', async () => {
        // Envia como áudio nativo do WhatsApp
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
        await sock.sendMessage(jid, { text: '❌ Erro ao salvar o arquivo de áudio.' }, { quoted: msg })
      })

    } catch (err) {
      console.error('Erro no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao processar o download. Tente novamente mais tarde.' }, { quoted: msg })
    }
  }
}