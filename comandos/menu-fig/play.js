const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando ytdl-core atualizado com cookies.',
  async ejecutar(sock, jid, msg, texto) {
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
      
      // Carrega os cookies do seu arquivo txt de forma nativa
      const caminhoCookies = path.join(process.cwd(), 'cookies.txt')
      let opcoesYtdl = {
        quality: 'highestaudio',
        filter: 'audioonly',
        highWaterMark: 1024 * 1024 * 32
      }

      if (fs.existsSync(caminhoCookies)) {
        // Converte o arquivo cookies.txt do formato Netscape para o formato que o ytdl aceita
        const cookiesString = fs.readFileSync(caminhoCookies, 'utf8')
        const cookiesArray = cookiesString.split('\n')
          .filter(line => line && !line.startsWith('#'))
          .map(line => {
            const parts = line.split('\t')
            if (parts.length >= 7) {
              return `${parts[5].trim()}=${parts[6].trim()}`
            }
            return null
          }).filter(Boolean).join('; ')

        opcoesYtdl.requestOptions = {
          headers: {
            Cookie: cookiesString // Passa o arquivo bruto ou os headers
          }
        }
      } else {
        console.log('Aviso: cookies.txt não encontrado na raiz!')
      }

      // Cria a stream de download direto do YouTube usando sua conta
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
        console.error('Erro na escrita do arquivo:', err)
        await sock.sendMessage(jid, { text: '❌ Erro ao processar o arquivo de áudio.' }, { quoted: msg })
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      })

    } catch (err) {
      console.error('Erro geral no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Falha ao baixar áudio. Tentando contornar o YouTube...' }, { quoted: msg })
    }
  }
}