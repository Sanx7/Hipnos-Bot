const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando ytdl-core com cookies estruturados.',
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

      const infoTexto = `🎵 *Música Encontrada!*\n\n📌 *Título:* ${video.title}\n⏱️ *Duração:* ${video.timestamp}\n\n⏳ *Baixando áudio autenticado via Cookies...*`
      await sock.sendMessage(jid, { text: infoTexto }, { quoted: msg })

      const pastaTemp = os.tmpdir()
      const arquivoSaida = path.join(pastaTemp, `play_${Date.now()}.mp3`)
      const caminhoCookies = path.join(process.cwd(), 'cookies.txt')
      
      let opcoesYtdl = {
        quality: 'highestaudio',
        filter: 'audioonly',
        highWaterMark: 1024 * 1024 * 64 // Aumentado para evitar gargalo
      }

      // Injeta os cookies se o arquivo existir
      if (fs.existsSync(caminhoCookies)) {
        try {
          const cookiesBrutos = fs.readFileSync(caminhoCookies, 'utf8')
          // O @distube/ytdl-core aceita os cookies analisados em formato de string na propriedade cookie dos headers
          opcoesYtdl.requestOptions = {
            headers: {
              'cookie': cookiesBrutos,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          }
        } catch (cookieErr) {
          console.error('Erro ao ler cookies:', cookieErr)
        }
      }

      // Baixa e salva o arquivo de áudio
      const stream = ytdl(video.url, opcoesYtdl)
      const writer = fs.createWriteStream(arquivoSaida)
      
      stream.pipe(writer)

      writer.on('finish', async () => {
        if (!fs.existsSync(arquivoSaida) || fs.statSync(arquivoSaida).size === 0) {
          throw new Error('Arquivo gravado vazio.')
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
        console.error('Erro na stream do ytdl:', err)
        await sock.sendMessage(jid, { text: '❌ Erro ao processar o arquivo de áudio.' }, { quoted: msg })
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      })

    } catch (err) {
      console.error('Erro geral no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Falha ao processar o comando.' }, { quoted: msg })
    }
  }
}