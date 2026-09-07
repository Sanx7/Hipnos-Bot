const {
  downloadMediaMessage,
  normalizeMessageContent,
  getContentType
} = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Usa o binário de FFmpeg instalado com o projeto, com fallback para o PATH
const binarioFfmpeg = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch (err) {
    return 'ffmpeg';
  }
})();

module.exports = {
  nome: "revelar",
  async executar(sock, jid, msg, text) {
    let caminhoInput = null;
    let caminhoOutput = null;

    try {
      // 1. Localizar a mensagem citada (quoted)
      // ⚠️ A PRÓPRIA mensagem de resposta pode vir embrulhada em
      // ephemeralMessage quando o grupo tem mensagens temporárias ativas,
      // o que esconde o extendedTextMessage/contextInfo. O
      // normalizeMessageContent (da própria Baileys) desembrulha todas
      // essas camadas de forma segura.
      const conteudoMsg = normalizeMessageContent(msg.message) || {};
      const contexto = conteudoMsg.extendedTextMessage?.contextInfo;
      const mQuoted = contexto?.quotedMessage;

      if (!mQuoted) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual falhou... Você precisa responder (marcar) a uma imagem ou vídeo de visualização única.' 
        }, { quoted: msg }).catch(() => {});
      }

      // 2. Identificar a mídia de visualização única dentro do quoted
      // ⚠️ A mensagem citada pode chegar sob QUALQUER embalagem do
      // protocolo: viewOnceMessage (v1), viewOnceMessageV2,
      // viewOnceMessageV2Extension (WhatsApp mais novo), ephemeralMessage,
      // editedMessage — ou direto como imageMessage/videoMessage.
      // Normalizar UMA vez cobre todas. (O código antigo olhava só a
      // primeira chave do objeto: quebrava com TypeError em quoted
      // malformado (message: null) e não reconhecia as embalagens novas.)
      const conteudoQuoted = normalizeMessageContent(mQuoted) || {};
      const tipoConteudo = getContentType(conteudoQuoted);

      let ehImagem = false;
      let ehVideo = false;

      if (tipoConteudo === 'imageMessage' && typeof conteudoQuoted.imageMessage === 'object') {
        ehImagem = true;
      } else if (tipoConteudo === 'videoMessage' && typeof conteudoQuoted.videoMessage === 'object') {
        ehVideo = true;
      }

      if (!ehImagem && !ehVideo) {
        return await sock.sendMessage(jid, { 
          text: '❌ Hipnos não encontrou nenhuma mídia de visualização única nesta mensagem. Responda (marque) uma foto ou vídeo de visualização única.' 
        }, { quoted: msg }).catch(() => {});
      }

      // Reage para indicar processamento
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

      // 2. Definir caminhos temporários
      const idUnico = Math.random().toString(36).substring(2, 10);
      const pastaTemp = path.join(__dirname, '..', 'dados', 'temp');
      
      if (!fs.existsSync(pastaTemp)) {
        fs.mkdirSync(pastaTemp, { recursive: true });
      }

      caminhoInput = path.join(pastaTemp, `in_${idUnico}`);
      caminhoOutput = path.join(pastaTemp, `out_${idUnico}.${ehImagem ? 'jpg' : 'mp4'}`);

      // 3. Baixar a mídia da mensagem citada
      // ⚠️ O downloadMediaMessage exige o objeto de MENSAGEM COMPLETO
      // ({ key, message }) — não só o conteúdo da mídia. Ele extrai,
      // normaliza (desembrulha a view-once) e localiza o nó de mídia
      // internamente antes de baixar. Tudo com await: o reenvio só
      // acontece DEPOIS do download terminar.
      const mensagemAlvo = { key: msg.key, message: mQuoted };
      const buffer = await downloadMediaMessage(mensagemAlvo, 'buffer', {});

      if (buffer.length > 25 * 1024 * 1024) {
        throw new Error('A mídia excede o limite de 25MB suportado.');
      }

      if (buffer.length === 0) {
        throw new Error('A mídia foi baixada vazia (0 bytes).');
      }

      fs.writeFileSync(caminhoInput, buffer);

      // 4. Converter com FFmpeg para remover metadados de trava e estabilizar o arquivo
      const comandoFFmpeg = ehImagem 
        ? `"${binarioFfmpeg}" -y -nostdin -i "${caminhoInput}" -q:v 2 "${caminhoOutput}"`
        : `"${binarioFfmpeg}" -y -nostdin -i "${caminhoInput}" -c copy "${caminhoOutput}"`;

      await new Promise((resolve, reject) => {
        exec(
          comandoFFmpeg,
          { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }, // 120s e até 50MB de log
          (error, stdout, stderr) => {
            if (error) {
              const detalhe = (stderr || '').toString().split('\n').slice(-3).join(' ');
              error.mensagemFfmpeg = detalhe;
              reject(error);
            } else resolve();
          }
        );
      });

      // 5. Enviar de volta ao grupo sem as restrições
      const legenda = `👁️‍🗨️ *VISÃO REVELADA* 👁️‍🗨️\n\n🪐 Hipnos materializou os dados que estavam prestes a sumir no limbo.`;

      if (ehImagem) {
        await sock.sendMessage(jid, { 
          image: fs.readFileSync(caminhoOutput), 
          caption: legenda 
        }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { 
          video: fs.readFileSync(caminhoOutput), 
          caption: legenda 
        }, { quoted: msg });
      }

      // Reage com sucesso
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});

    } catch (err) {
      console.error('Erro ao executar o comando revelar:', err);
      const detalheExtra = err?.mensagemFfmpeg ? `\n\n📎 Detalhe: ${err.mensagemFfmpeg}` : '';
      // ⚠️ O .catch(() => {}) impede que uma falha ao ENVIAR a própria
      // mensagem de erro (rede, rate limit) vaze do comando — era um dos
      // vetores que derrubavam o bot.
      await sock.sendMessage(jid, { 
        text: `❌ Ocorreu um erro ao quebrar o feitiço da visualização única. Certifique-se de que o servidor possui o FFmpeg instalado.${detalheExtra}`
      }, { quoted: msg }).catch(() => {});
    } finally {
      // Limpeza tolerante dos arquivos temporários: unlinkSync pode falhar
      // (EPERM/EBUSY no Windows, antivírus, handle aberto) e esse erro NUNCA
      // pode vazar do finally — era outro vetor de crash.
      for (const caminho of [caminhoInput, caminhoOutput]) {
        if (caminho && fs.existsSync(caminho)) {
          try {
            fs.unlinkSync(caminho);
          } catch (errLimpeza) {
            console.error('⚠️ revelar: falha ao apagar temporário', caminho, errLimpeza?.message);
          }
        }
      }
    }
  }
};