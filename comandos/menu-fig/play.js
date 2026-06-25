const yts = require('yt-search')
const YTDlpWrap = require('yt-dlp-wrap').default
const fs = require('fs')
const path = require('path')
const os = require('os')

const pastaTemp = os.tmpdir()
// Define um local seguro para salvar o binário do yt-dlp no Render
const caminhoBinario = path.join(pastaTemp, 'yt-dlp')
let ytDlpWrap

// Função assíncrona para garantir que o yt-dlp está baixado e pronto
async function obterYTDlp() {
  if (ytDlpWrap) return ytDlpWrap

  // Se o binário não existir na pasta temporária, faz o download dele
  if (!fs.existsSync(caminhoBinario)) {
    console.log('📥 Baixando binário do yt-dlp para o servidor...')
    await YTDlpWrap.downloadFromGithub(caminhoBinario)
    fs.chmodSync(caminhoBinario, '755') // Dá permissão de execução no Linux (Render)
    console.log('✅ Binário do yt-dlp pronto para uso!')
  }

  ytDlpWrap = new YTDlpWrap(caminhoBinario)
  return ytDlpWrap
}

module.exports = {
  nome: 'play',
  descricao: 'Pesquisa e baixa uma música do YouTube usando yt-dlp com cookies e binário auto-gerenciado.',
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

      // Trava de segurança de 10 minutos para proteger a RAM do Render
      if (video.seconds > 600) {
        return await sock.sendMessage(jid, { text: '❌ A música não pode ter mais de 10 minutos para proteger o servidor.' }, { quoted: msg })
      }

      const infoTexto = `🎵 *Música Encontrada!*\n\n📌 *Título:* ${video.title}\n⏱️ *Duração:* ${video.timestamp}\n\n⏳ *Baixando áudio com Engine Nativa...*`
      await sock.sendMessage(jid, { text: infoTexto }, { quoted: msg })

      const arquivoSaida = path.join(pastaTemp, `play_${Date.now()}.mp3`)
      
      // Caminho para o cookies.txt localizado na raiz do projeto
      const caminhoCookies = path.join(process.cwd(), 'cookies.txt')

      // Configuração de argumentos do yt-dlp
      const argumentos = [
        video.url,
        '-x',
        '--audio-format', 'mp3',
        '-o', arquivoSaida
      ]

      // Se o arquivo cookies.txt existir na raiz, injeta os cookies no download
      if (fs.existsSync(caminhoCookies)) {
        argumentos.push('--cookies', caminhoCookies)
      } else {
        console.log('Aviso: cookies.txt não encontrado na raiz. Tentando sem cookies...')
      }

      // Garante o binário e executa o download nativo
      const dlp = await obterYTDlp()
      await dlp.execPromise(argumentos)

      if (!fs.existsSync(arquivoSaida)) {
        throw new Error('O arquivo MP3 não foi gerado com sucesso.')
      }

      // Envia o áudio convertido direto para o WhatsApp
      await sock.sendMessage(jid, { 
        audio: fs.readFileSync(arquivoSaida), 
        mimetype: 'audio/mp4',
        ptt: false
      }, { quoted: msg })

      // Remove o arquivo temporário após o envio
      setTimeout(() => {
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      }, 2000)

    } catch (err) {
      console.error('Erro geral no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Ocorreu um erro interno ao processar este áudio.' }, { quoted: msg })
    }
  }
}