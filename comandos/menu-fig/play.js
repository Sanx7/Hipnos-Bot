const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const ffmpeg = require('fluent-ffmpeg')
const os = require('os')
const path = require('path')
const fs = require('fs')

// Injeta o FFmpeg instalado no Render
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
  ffmpeg.setFfmpegPath(ffmpegInstaller.path)
} catch (e) {}

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

      // Trava de segurança para não estourar os 512MB de RAM do Render
      if (video.seconds > 600) {
        return await sock.sendMessage(jid, { text: '❌ A música não pode ter mais de 10 minutos para proteger o servidor!' }, { quoted: msg })
      }

      const infoTexto = `🎵 *Música Encontrada!*\n\n📌 *Título:* ${video.title}\n⏱️ *Duração:* ${video.timestamp}\n\n⏳ *Baixando e convertendo o áudio...*`
      await sock.sendMessage(jid, { text: infoTexto }, { quoted: msg })

      const pastaTemp = os.tmpdir()
      const arquivoSaida = path.join(pastaTemp, `play_${Date.now()}.mp3`)

      // Faz o download usando a versão corrigida do DisTube
      const streamDownload = ytdl(video.url, { 
        filter: 'audioonly', 
        quality: 'highestaudio',
        highWaterMark: 1 << 25
      })

      ffmpeg(streamDownload)
        .toFormat('mp3')
        .audioBitrate(128)
        .save(arquivoSaida)
        .on('end', async () => {
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
        .on('error', async (err) => {
          console.error('Erro no FFmpeg:', err)
          await sock.sendMessage(jid, { text: '❌ Erro ao processar o áudio.' }, { quoted: msg })
          if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
        })

    } catch (err) {
      console.error('Erro no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro. O YouTube pode ter bloqueado temporariamente.' }, { quoted: msg })
    }
  }
}