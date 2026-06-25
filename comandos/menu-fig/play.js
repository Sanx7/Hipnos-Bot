const yts = require('yt-search')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando APIs alternativas livres de bloqueio.',
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

      // Lista de APIs espelhadas prontas para uso caso alguma caia ou mude
      const apis = [
        `https://api.siputzx.my.id/api/dwn/ytmp3?url=${encodeURIComponent(video.url)}`,
        `https://api.zenkey.my.id/api/download/ytmp3?url=${encodeURIComponent(video.url)}`,
        `https://itzpire.com/api/download/ytmp3?url=${encodeURIComponent(video.url)}`
      ]

      let downloadUrl = null

      // Loop para testar as APIs disponíveis até uma dar certo
      for (const api of apis) {
        try {
          const response = await axios.get(api, { timeout: 8000 })
          const data = response.data
          downloadUrl = data.downloadUrl || data.result?.download || data.result?.url || data.data?.url
          
          if (downloadUrl) break
        } catch (e) {
          console.log(`Aviso: Falha na API secundária, testando próxima...`)
        }
      }

      if (!downloadUrl) {
        return await sock.sendMessage(jid, { text: '❌ Todas as APIs de download estão instáveis no momento. Tente novamente mais tarde.' }, { quoted: msg })
      }

      // Realiza o download do arquivo MP3
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
        await sock.sendMessage(jid, { text: '❌ Erro ao processar o arquivo de mídia.' }, { quoted: msg })
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      })

    } catch (err) {
      console.error('Erro geral no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Erro interno ao concluir o download.' }, { quoted: msg })
    }
  }
}