const yts = require('yt-search')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const os = require('os')

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando o provedor estável Y2Mate.',
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

      const infoTexto = `🎵 *Música Encontrada!*\n\n📌 *Título:* ${video.title}\n⏱️ *Duração:* ${video.timestamp}\n\n⏳ *Baixando áudio (Servidor Y2Mate)...*`
      await sock.sendMessage(jid, { text: infoTexto }, { quoted: msg })

      const pastaTemp = os.tmpdir()
      const arquivoSaida = path.join(pastaTemp, `play_${Date.now()}.mp3`)

      // Requisição direta para o serviço do Y2Mate que não bloqueia o Render
      const deRozier = await axios.post('https://www.y2mate.com/mates/enM/analyzeV2/ajax', new URLSearchParams({
        k_query: video.url,
        k_page: 'home',
        hl: 'en',
        q_auto: '0'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })

      if (!deRozier.data || !deRozier.data.links || !deRozier.data.links.mp3) {
        throw new Error('Falha ao analisar o link no Y2Mate')
      }

      // Pega a primeira chave de qualidade do MP3 (geralmente 128kbps)
      const keyId = Object.keys(deRozier.data.links.mp3)[0]
      const fileId = deRozier.data.links.mp3[keyId].k

      // Gera o link final para download
      const respostaConvert = await axios.post('https://www.y2mate.com/mates/enM/convertV2/index', new URLSearchParams({
        vid: deRozier.data.vid,
        k: fileId
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })

      if (!respostaConvert.data || respostaConvert.data.status !== 'ok') {
        throw new Error('Falha ao converter o arquivo')
      }

      const downloadUrl = respostaConvert.data.dlink

      // Baixa o arquivo para o servidor do Render
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
        await sock.sendMessage(jid, { text: '❌ Erro ao salvar o áudio.' }, { quoted: msg })
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      })

    } catch (err) {
      console.error('Erro no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Não foi possível baixar a música neste momento. Tente novamente.' }, { quoted: msg })
    }
  }
}