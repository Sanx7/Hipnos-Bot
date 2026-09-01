const yts = require('yt-search')
const ytdl = require('@distube/ytdl-core')
const fs = require('fs')
const path = require('path')
const os = require('os')

// Converte o cookies.txt (formato Netscape) em uma string de cabeçalho Cookie válida
function lerCookies(caminho) {
  const bruto = fs.readFileSync(caminho, 'utf8');
  const linhasValidas = [];

  for (const linha of bruto.split(/\r?\n/)) {
    if (!linha.trim() || linha.startsWith('#')) continue;

    const partes = linha.split('\t');
    if (partes.length < 7) continue;

    const [, , , , expiracao, nome, valor] = partes;
    const exp = parseInt(expiracao, 10);

    // Ignora cookies já expirados
    if (exp && exp < Math.floor(Date.now() / 1000)) continue;

    linhasValidas.push(`${nome}=${valor}`);
  }

  return linhasValidas.join('; ');
}

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

      // Injeta os cookies se o arquivo existir (já convertidos para cabeçalho Cookie válido)
      if (fs.existsSync(caminhoCookies)) {
        try {
          const cookies = lerCookies(caminhoCookies);
          if (cookies) {
            opcoesYtdl.requestOptions = {
              headers: {
                'cookie': cookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            };
          }
        } catch (cookieErr) {
          console.error('Erro ao ler cookies:', cookieErr)
        }
      }

      // Baixa e salva o arquivo de áudio aguardando o processamento completo
      await new Promise((resolve, reject) => {
        const stream = ytdl(video.url, opcoesYtdl)
        const writer = fs.createWriteStream(arquivoSaida)

        stream.on('error', (err) => { writer.destroy(); reject(err); });
        writer.on('error', reject)
        writer.on('finish', () => {
          if (!fs.existsSync(arquivoSaida) || fs.statSync(arquivoSaida).size === 0) {
            return reject(new Error('Arquivo gravado vazio.'))
          }
          resolve()
        })

        stream.pipe(writer)
      })

      await sock.sendMessage(jid, {
        audio: fs.readFileSync(arquivoSaida),
        mimetype: 'audio/mp4',
        ptt: false
      }, { quoted: msg })

      setTimeout(() => {
        if (fs.existsSync(arquivoSaida)) fs.unlinkSync(arquivoSaida)
      }, 2000)

    } catch (err) {
      console.error('Erro geral no comando play:', err)
      await sock.sendMessage(jid, { text: '❌ Falha ao processar o comando.' }, { quoted: msg })
    }
  }
}