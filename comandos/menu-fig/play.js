const yts = require('yt-search')
const ytStream = require('yt-stream')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando stream nativo direto.',
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

      if (video.seconds > 600) {
        return await sock.sendMessage(jid, { text: '❌ A música não pode ter mais de 10 minutos para proteger o servidor.' }, { quoted: msg })
      }

      const infoTexto = `🎵 *Música Encontrada!*\n\n📌 *Título:* ${video.title}\n⏱️ *Duração:* ${video.timestamp}\n\n⏳ *Obtendo fluxo de áudio direto...*`
      await sock.sendMessage(jid, { text: infoTexto }, { quoted: msg })

      const pastaTemp = os.tmpdir()
      const arquivoSaida = path.join(pastaTemp, `play_${Date.now()}.mp3`)

      // Obtém o fluxo de áudio diretamente sem depender de binários do yt-dlp ou downloads do GitHub
      const stream = await ytStream.stream(video.url, {
        quality: 'high',
        type: 'audio',
        highWaterMark: 1048576 * 32
      })

      const writer = fs.createWriteStream(arquivoSaida)
      stream.stream.pipe(writer)

      writer.on('finish', async () => {
        if (!fs.existsSync(arquivoSaida) || fs.statSync(arquivoSaida).size === 0) {
          throw new Error('Falha ao gravar arquivo de áudio vazio.')
        }

        await sock.sendMessage(jid, { 
          audio: fs.readFileSync(arquivoSaida), 
          mimetype: 'audio/mp4',
          ptt: false
        }, { quoted: msg })

        setTimeout(() => {
          if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
        }, 2000)
      })

      writer.on('error', async (err) => {
        console.error(err)
        await sock.sendMessage(jid, { text: '❌ Erro ao gravar o arquivo de música.' }, { quoted: msg })
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      })

    } catch (err) {
      console.error('Erro geral no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Servidor de stream ocupado. Tente novamente em instantes.' }, { quoted: msg })
    }
  }
}