// ============================================
// 🎵 TOMP3 — Extrator de Áudio do Limbo (uso LIVRE)
// ============================================
// Converte a faixa de áudio de um vídeo (ou áudio) citado em MP3 e envia
// de volta no chat como áudio comum (ptt: false — NÃO vira "voz").
//
// Fluxo:
//   1) Usuário responde (cita) um vídeo/áudio com /tomp3;
//   2) A mídia é baixada via downloadMediaMessage (Baileys) p/ um temp;
//   3) O ffmpeg (PROCESSO FILHO via execFile — args em ARRAY, sem shell,
//      sem interpolação de string: o caminho do arquivo é dinâmico e
//      jamais passa por um shell) extrai o áudio p/ MP3;
//   4) O MP3 volta como mensagem de áudio, citando a original.
//
// 🛡️ LIÇÕES DO /revelar aplicadas aqui:
//   - ffmpeg SEMPRE em processo filho (nunca sharp/libvips in-process);
//   - qualquer erro é capturado e vira aviso amigável — a conexão NÃO cai;
//   - os temporários são apagados no finally (com retry p/ Windows EPERM).
//
// 🗑️ DISCO EFÊMERO (Render): os arquivos vivem em os.tmpdir() — no Render
// isso é /tmp; no Windows local cai em %TEMP%. Nada é gravado na pasta do
// projeto e tudo é apagado ao final (sucesso ou falha).
// ============================================

const {
  downloadMediaMessage,
  normalizeMessageContent,
  getContentType
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const os = require('os');
const path = require('path');
// 🎛️ Conversão ffmpeg + limpeza extraídas p/ o módulo compartilhado
// (audio-extrator.js) — a MESMA lógica agora também serve ao /transcrever
const { converterParaMp3, apagarComRetry } = require('./audio-extrator');

// ⛔ Limite de tamanho da mídia citada (plano free do Render: pouca RAM
// e disco efêmero — um arquivo gigante travaria o processo todo)
const LIMITE_MB = 50;
const LIMITE_BYTES = LIMITE_MB * 1024 * 1024;

// ─── 📨 Execução do comando ───
module.exports = {
  nome: 'tomp3',
  descricao: 'Extrai o áudio de um vídeo/áudio citado e envia como MP3 (responda à mídia).',

  async executar(sock, jid, msg, texto) {
    let caminhoInput = null;
    let caminhoOutput = null;

    try {
      // 1) 🎯 Localizar a mensagem citada — cobrindo TODAS as embalagens do
      //    protocolo (viewOnce, ephemeral, edited...) com o mesmo trio do
      //    /revelar: normalizeMessageContent + getContentType.
      const conteudoMsg = normalizeMessageContent(msg.message) || {};
      const contexto = conteudoMsg.extendedTextMessage?.contextInfo;
      const mQuoted = contexto?.quotedMessage;

      if (!mQuoted) {
        return await sock.sendMessage(jid, {
          text: '🎵 *Falta a mídia...*\n\nResponda (marque) um vídeo ou áudio com `/tomp3` para que eu extraia o som dele.\n\n🗝️ Exemplo: cite o vídeo e escreva `/tomp3`'
        }, { quoted: msg }).catch(() => {});
      }

      const conteudoQuoted = normalizeMessageContent(mQuoted) || {};
      const tipoConteudo = getContentType(conteudoQuoted);

      const ehVideo = tipoConteudo === 'videoMessage' && typeof conteudoQuoted.videoMessage === 'object';
      const ehAudio = tipoConteudo === 'audioMessage' && typeof conteudoQuoted.audioMessage === 'object';

      if (!ehVideo && !ehAudio) {
        return await sock.sendMessage(jid, {
          text: '🎵 *Isso não é um vídeo nem um áudio...*\n\nHipnos só consegue arrancar sons de vídeos ou áudios. Responda (marque) um deles com `/tomp3`.'
        }, { quoted: msg }).catch(() => {});
      }

      // 2) ⏳ Reação de processamento (mesma linguagem visual do /revelar)
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

      // 3) 📥 Baixar a mídia citada (downloadMediaMessage exige a mensagem
      //    COMPLETA { key, message } — igual ao /revelar)
      const mensagemAlvo = { key: msg.key, message: mQuoted };
      console.log('[tomp3] ⬇️ baixando mídia citada via downloadMediaMessage...');
      const buffer = await downloadMediaMessage(mensagemAlvo, 'buffer', {});
      console.log(`[tomp3] ✅ download concluído: ${buffer?.length ?? 'n/d'} bytes`);

      // 4) ⛔ Limites de tamanho (disco efêmero + RAM do Render free)
      if (!buffer || buffer.length === 0) {
        throw new Error('A mídia foi baixada vazia (0 bytes).');
      }
      if (buffer.length > LIMITE_BYTES) {
        const mb = (buffer.length / 1048576).toFixed(1);
        await sock.sendMessage(jid, {
          text: `⛔ *Essa mídia é pesada demais para os portões do limbo...* (${mb} MB)\n\nO limite é de *${LIMITE_MB} MB*. Envie uma versão menor.`
        }, { quoted: msg }).catch(() => {});
        return await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
      }

      // 5) 🗑️ Caminhos temporários: os.tmpdir() = /tmp no Render (disco
      //    efêmero) e %TEMP% no Windows local. Nunca gravamos na pasta do
      //    projeto. Nome único por timestamp + random (evita colisão).
      const idUnico = `tomp3-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const pastaTemp = os.tmpdir();
      caminhoInput = path.join(pastaTemp, `${idUnico}.mp4`);
      caminhoOutput = path.join(pastaTemp, `${idUnico}.mp3`);

      fs.writeFileSync(caminhoInput, buffer);

      // 6) 🎛️ Conversão com ffmpeg (processo filho — execFile, args em array)
      console.log('[tomp3] 🎛️ extraindo áudio via ffmpeg (processo filho)...');
      await converterParaMp3(caminhoInput, caminhoOutput);

      // 7) ✅ Valida o resultado antes de enviar
      if (!fs.existsSync(caminhoOutput) || fs.statSync(caminhoOutput).size === 0) {
        throw new Error('ffmpeg não produziu o arquivo MP3.');
      }
      const tamanhoMp3 = fs.statSync(caminhoOutput).size;
      console.log(`[tomp3] ✅ MP3 pronto: ${tamanhoMp3} bytes`);

      // 8) 📤 Envia como ÁUDIO comum (ptt: false — não vira "voz"), citando
      //    a mensagem original. Mesmo formato do envio do /play.
      await sock.sendMessage(jid, {
        audio: fs.readFileSync(caminhoOutput),
        mimetype: 'audio/mpeg',
        ptt: false
      }, { quoted: msg });

      console.log('[tomp3] ✅ áudio enviado com sucesso');
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});

    } catch (err) {
      // 🛡️ ÚLTIMA LINHA DE DEFESA: nada escapa para o socket — a conexão
      // NUNCA cai (mesmo padrão do /revelar e do isolamento do bot.js).
      console.error('[tomp3] 💥 erro capturado pelo comando (o bot segue vivo):', err?.stack || err);
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});

      // Avisos amigáveis por tipo de falha
      let aviso;
      if (err?.semAudio) {
        aviso = '🔇 *Este vídeo não tem som algum...*\n\nHipnos ouviu apenas silêncio. Envie um vídeo que tenha faixa de áudio.';
      } else if (err?.corrompido) {
        aviso = '📼 *Esse arquivo parece corrompido...*\n\nNão consegui ler o conteúdo da mídia. Tente reenviá-la e use /tomp3 de novo.';
      } else if (err?.timeout) {
        aviso = '⏳ *A conversão demorou demais e foi interrompida...*\n\nA mídia deve ser muito longa ou pesada. Tente com um trecho menor.';
      } else {
        aviso = '❌ Não consegui extrair o áudio dessa mídia agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.';
      }
      if (err?.mensagemFfmpeg) {
        console.error('[tomp3] 📎 detalhe do ffmpeg:', err.mensagemFfmpeg);
      }

      await sock.sendMessage(jid, { text: aviso }, { quoted: msg }).catch(() => {});

    } finally {
      // 🧹 Limpeza SEMPRE (sucesso ou falha): apaga input e output do disco
      // efêmero. apagarComRetry nunca lança — nem a limpeza derruba o bot.
      for (const caminho of [caminhoInput, caminhoOutput]) {
        if (caminho) await apagarComRetry(caminho);
      }
    }
  }
};
