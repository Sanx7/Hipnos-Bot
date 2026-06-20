const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = {
  nome: "revelar",
  async executar(sock, jid, msg, text) {
    let caminhoInput = null;
    let caminhoOutput = null;

    try {
      // 1. Identificar se a mensagem respondida (quoted) contém visualização única
      const mQuoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      
      if (!mQuoted) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual falhou... Você precisa responder (marcar) a uma imagem ou vídeo de visualização única.' 
        }, { quoted: msg });
      }

      // Procura a estrutura interna de viewOnce (visualização única) do WhatsApp
      const tipoMensagem = Object.keys(mQuoted)[0];
      let dadosMidia = null;
      let ehImagem = false;
      let ehVideo = false;

      if (tipoMensagem === 'viewOnceMessage' || tipoMensagem === 'viewOnceMessageV2') {
        const subMensagem = mQuoted[tipoMensagem].message;
        const subTipo = Object.keys(subMensagem)[0];

        if (subTipo === 'imageMessage') {
          dadosMidia = subMensagem.imageMessage;
          ehImagem = true;
        } else if (subTipo === 'videoMessage') {
          dadosMidia = subMensagem.videoMessage;
          ehVideo = true;
        }
      } else if (tipoMensagem === 'imageMessage') {
        dadosMidia = mQuoted.imageMessage;
        ehImagem = true;
      } else if (tipoMensagem === 'videoMessage') {
        dadosMidia = mQuoted.videoMessage;
        ehVideo = true;
      }

      if (!dadosMidia) {
        return await sock.sendMessage(jid, { 
          text: '❌ Hipnos não encontrou nenhuma ilusão ou mídia efêmera nesta mensagem para revelar.' 
        }, { quoted: msg });
      }

      // Reage para indicar processamento
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });

      // 2. Definir caminhos temporários
      const idUnico = Math.random().toString(36).substring(2, 10);
      const pastaTemp = path.join(__dirname, '..', 'dados', 'temp');
      
      if (!fs.existsSync(pastaTemp)) {
        fs.mkdirSync(pastaTemp, { recursive: true });
      }

      caminhoInput = path.join(pastaTemp, `in_${idUnico}`);
      caminhoOutput = path.join(pastaTemp, `out_${idUnico}.${ehImagem ? 'jpg' : 'mp4'}`);

      // 3. Baixar o fluxo criptografado da mídia do WhatsApp
      const tipoDownload = ehImagem ? 'image' : 'video';
      const stream = await downloadContentFromMessage(dadosMidia, tipoDownload);
      let buffer = Buffer.from([]);
      
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      fs.writeFileSync(caminhoInput, buffer);

      // 4. Converter com FFmpeg para remover metadados de trava e estabilizar o arquivo
      const comandoFFmpeg = ehImagem 
        ? `ffmpeg -y -i "${caminhoInput}" -q:v 2 "${caminhoOutput}"`
        : `ffmpeg -y -i "${caminhoInput}" -c copy "${caminhoOutput}"`;

      await new Promise((resolve, reject) => {
        exec(comandoFFmpeg, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      // 5. Enviar de volta ao grupo sem as restrições
      const legenda = `👁️‍🗨️ **VISÃO REVELADA** 👁️‍🗨️\n\n🪐 Hipnos materializou os dados que estavam prestes a sumir no limbo.`;

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
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });

    } catch (err) {
      console.error('Erro ao executar o comando revelar:', err);
      await sock.sendMessage(jid, { 
        text: '❌ Ocorreu um erro ao quebrar o feitiço da visualização única. Certifique-se de que o servidor possui o FFmpeg instalado.' 
      }, { quoted: msg });
    } finally {
      // Limpeza absoluta dos arquivos para não entupir o servidor
      if (caminhoInput && fs.existsSync(caminhoInput)) fs.unlinkSync(caminhoInput);
      if (caminhoOutput && fs.existsSync(caminhoOutput)) fs.unlinkSync(caminhoOutput);
    }
  }
};