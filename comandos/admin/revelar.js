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
// ============================================================
// ⚠️ CAUSA RAIZ DO BUG "FOTO DERRUBA A CONEXÃO":
// Ao enviar uma IMAGEM sem "jpegThumbnail", a Baileys gera a miniatura na
// hora usando a lib de imagem NATIVA (sharp/libvips) DENTRO do processo do
// Node (messages-media.js → extractImageThumb → getImageProcessingLibrary).
// No caminho de VÍDEO isso nunca acontece: a miniatura do vídeo é extraída
// pelo binário do ffmpeg num PROCESSO FILHO e qualquer falha é engolida
// (try/catch no próprio generateThumbnail da lib).
//
// Ou seja: o envio de FOTO era o ÚNICO trecho do comando que executava
// código nativo in-process. Um problema no sharp/libvips em nível nativo
// (binário incompatível com o runtime, OOM, ou o duelo de versões que este
// projeto carrega: sharp@0.35.1 via Baileys + sharp@0.30.7 via
// wa-sticker-formatter) mata o processo SEM chances de try/catch — e um
// processo morto é exatamente "a conexão inteira cai" (com risco de QR
// novo se a sessão for considerada inválida na retomada).
//
// SOLUÇÃO (espelhando a arquitetura que já funciona no vídeo): gerar o
// thumbnail ANTES, pelo binário do ffmpeg em processo filho, e entregá-lo
// pronto à Baileys via `jpegThumbnail`. Com isso `requiresThumbnailComputation`
// vira false em prepareWAMessageMedia e a lib PULA o sharp/libvips por
// completo. Se até o ffmpeg falhar, usamos este JPEG 8x8 válido (gerado
// pelo próprio @ffmpeg-installer do projeto) como fallback: a mensagem
// sai com preview simples, mas sai — e o bot permanece de pé.
// ============================================================
const THUMB_FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzU4LjQyLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z';

/**
 * Apaga um arquivo temporário com pequenas tentativas extras: no Windows o
 * ffmpeg/antivírus pode segurar o handle por alguns instantes (EPERM/EBUSY).
 * No Render (Linux) a 1ª tentativa costuma bastar. NUNCA lança.
 */
function apagarComRetry(caminho, tentativas = 3) {
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  return (async () => {
    for (let i = 0; i < tentativas; i++) {
      try {
        if (!fs.existsSync(caminho)) return;
        fs.unlinkSync(caminho);
        return;
      } catch (err) {
        if (i === tentativas - 1) {
          console.error('⚠️ revelar: falha ao apagar temporário', caminho, err?.message);
        } else {
          await espera(150); // pequena pausa antes de tentar de novo (não trava o event loop)
        }
      }
    }
  })();
}

/**
 * Gera um thumbnail JPEG (~64px) da imagem usando o binário do ffmpeg em
 * PROCESSO FILHO — nunca toca na stack nativa de imagem da Baileys.
 * NUNCA rejeita: em caso de qualquer falha devolve o fallback 8x8.
 * @returns {Promise<{base64: string, fonte: 'ffmpeg'|'fallback', caminho: string|null}>}
 */
function gerarThumbnailJpeg(caminhoImagem, pastaTemp, idUnico) {
  return new Promise((resolve) => {
    const caminhoThumb = path.join(pastaTemp, `thumb_${idUnico}.jpg`);
    const cmd = `"${binarioFfmpeg}" -y -nostdin -i "${caminhoImagem}" -vf "scale=64:-1" -vframes 1 "${caminhoThumb}"`;
    exec(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (error) => {
      try {
        if (!error && fs.existsSync(caminhoThumb)) {
          const bufferThumb = fs.readFileSync(caminhoThumb);
          if (bufferThumb.length > 0) {
            return resolve({ base64: bufferThumb.toString('base64'), fonte: 'ffmpeg', caminho: caminhoThumb });
          }
        }
        console.error('[revelar:foto] ⚠️ ffmpeg não produziu thumbnail — usando fallback 8x8. Motivo:', error?.message || 'arquivo ausente');
      } catch (errLeitura) {
        console.error('[revelar:foto] ⚠️ falha ao ler thumbnail gerado — usando fallback 8x8:', errLeitura?.message);
      }
      // Fallback não cria arquivo (só devolve o JPEG embutido em memória)
      resolve({ base64: THUMB_FALLBACK_JPEG_BASE64, fonte: 'fallback', caminho: caminhoThumb });
    });
  });
}


module.exports = {
  nome: "revelar",
  async executar(sock, jid, msg, text) {
    let caminhoInput = null;
    let caminhoOutput = null;
    let caminhoThumbTemp = null;

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

      // 🪵 LOG de rastreio (Render): qual caminho o comando vai seguir
      console.log(`[revelar] 🔍 mídia citada detectada: ${tipoConteudo} → caminho ${ehImagem ? 'FOTO' : 'VÍDEO'}`);

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
      console.log('[revelar] ⬇️ baixando mídia citada via downloadMediaMessage (tipo buffer)...');
      const buffer = await downloadMediaMessage(mensagemAlvo, 'buffer', {});
      console.log(`[revelar] ✅ download concluído: ${buffer?.length ?? 'n/d'} bytes`);

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
        // ⚠️ CAMINHO DA FOTO — corrigido: geramos o thumbnail via ffmpeg em
        // processo filho e o entregamos pronto (jpegThumbnail). Com isso a
        // Baileys PULA o processamento nativo de imagem (sharp/libvips
        // in-process), que era o único trecho exclusivo da foto e o único
        // capaz de matar o processo inteiro sem chance de try/catch.
        console.log('[revelar:foto] 🖼️ gerando thumbnail via ffmpeg (processo filho — NÃO usa sharp/libvips in-process)...');
        const thumb = await gerarThumbnailJpeg(caminhoOutput, pastaTemp, idUnico);
        caminhoThumbTemp = thumb.caminho; // rastreado p/ o finally apagar
        const jpegThumbnail = thumb.base64;
        console.log(`[revelar:foto] ✅ thumbnail pronto (fonte: ${thumb.fonte}, ${jpegThumbnail.length} chars base64)`);

        const tamanhoImagem = fs.existsSync(caminhoOutput) ? fs.statSync(caminhoOutput).size : 0;
        console.log(`[revelar:foto] 📤 enviando imagem revelada (${tamanhoImagem} bytes, caption ok: ${typeof legenda === 'string'})...`);
        try {
          await sock.sendMessage(jid, {
            image: fs.readFileSync(caminhoOutput),
            caption: legenda,
            jpegThumbnail // ← entrega pronto: Baileys pula o sharp/libvips
          }, { quoted: msg });
        } catch (erroEnvio) {
          // 🪵 Ponto exato de falha no log do Render, sem derrubar nada
          console.error('[revelar:foto] 💥 FALHA no envio da imagem (capturada — a conexão NÃO cai):', erroEnvio?.stack || erroEnvio);
          throw erroEnvio; // → catch geral: avisa o usuário com calma
        }
        console.log('[revelar:foto] ✅ imagem enviada com sucesso');
      } else {
        // 🎬 CAMINHO DO VÍDEO — intocado (já funciona)
        await sock.sendMessage(jid, { 
          video: fs.readFileSync(caminhoOutput), 
          caption: legenda 
        }, { quoted: msg });
      }

      // Reage com sucesso
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});

    } catch (err) {
      // 🛡️ ÚLTIMA LINHA DE DEFESA DO COMANDO: qualquer erro (download, ffmpeg,
      // envio de imagem/vídeo) é capturado AQUI e NUNCA escapa para o
      // Baileys/socket. O bot continua de pé — na pior das hipóteses o usuário
      // recebe um aviso e o comando falha sem consequências.
      console.error('[revelar] 💥 erro capturado pelo comando (o bot segue vivo):', err?.stack || err);
      // Remove a reação ⏳ sinalizando falha (envio protegido: se falhar, ignora)
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
      const detalheExtra = err?.mensagemFfmpeg ? `\n\n📎 Detalhe: ${err.mensagemFfmpeg}` : '';
      // ⚠️ O .catch(() => {}) impede que uma falha ao ENVIAR a própria
      // mensagem de erro (rede, rate limit) vaze do comando — era um dos
      // vetores que derrubavam o bot.
      await sock.sendMessage(jid, { 
        text: `❌ Não consegui revelar essa mídia agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.${detalheExtra}`
      }, { quoted: msg }).catch(() => {});
    } finally {
      // Limpeza tolerante dos arquivos temporários (input, output e thumbnail):
      // unlinkSync pode falhar (EPERM/EBUSY no Windows, antivírus, handle
      // aberto) e esse erro NUNCA pode vazar do finally — era outro vetor de
      // crash. apagarComRetry tenta mais 2x antes de desistir, sem lançar.
      for (const caminho of [caminhoInput, caminhoOutput, caminhoThumbTemp]) {
        if (caminho && fs.existsSync(caminho)) {
          await apagarComRetry(caminho);
        }
      }
    }
  }
};