const { downloadMediaMessage, normalizeMessageContent, getContentType, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { ehAdminDoGrupo, ehDonoDoBot } = require('../../config');
const { resolverNumeroAlvo } = require('../../lid');
const { extrairTextoComando } = require('../../dados/texto-comando');

function contextoCitado(message) {
  // O roteador aceita comandos em texto e em legendas. A citação pertence
  // ao nó que contém o comando, não necessariamente a extendedTextMessage.
  const conteudo = normalizeMessageContent(message) || {};
  for (const valor of Object.values(conteudo)) {
    if (valor?.contextInfo?.quotedMessage) return valor.contextInfo;
  }
  return null;
}

function visualizacaoUnica(conteudo, profundidade = 0) {
  if (!conteudo || typeof conteudo !== 'object') return false;
  if (profundidade > 10) return true;
  if (conteudo.viewOnceMessage || conteudo.viewOnceMessageV2 || conteudo.viewOnceMessageV2Extension) return true;
  return Object.values(conteudo).some(valor => valor?.viewOnce === true ||
    (valor?.message && visualizacaoUnica(valor.message, profundidade + 1)));
}

module.exports = {
  nome: 'totag',
  aliases: ['notag2'],
  descricao: 'Envia texto direto ou reenvia texto, imagem, vídeo ou áudio citado com menções ocultas (admin ou dono).',

  async executar(sock, jid, msg, text) {
    try {
      if (!String(jid || '').endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '🌑 Use /totag em um grupo: escreva um texto depois do comando ou responda a uma mensagem de texto, imagem, vídeo ou áudio.'
        }, { quoted: msg });
      }

      let metadados;
      try {
        metadados = await sock.groupMetadata(jid);
      } catch (err) {
        console.error('[totag] falha nos metadados:', err?.message || err);
        return await sock.sendMessage(jid, {
          text: '⚠️ Não consegui ler os membros deste grupo agora. Tente de novo em instantes.'
        }, { quoted: msg });
      }
      const participantes = metadados?.participants || [];

      // Mesma autorização de /hidetag: ADM OU dono, usando JID cru e
      // telefone comprovado pelos metadados ou pelo mapeamento da sessão.
      const sender = msg?.key?.participant || msg?.key?.remoteJid || '';
      const doRemetente = jid => participantes.filter(p => [p.id, p.phoneNumber].filter(Boolean)
        .some(id => jidNormalizedUser(id) === jidNormalizedUser(jid)));
      const resolucao = /@(lid|s\.whatsapp\.net)$/.test(sender)
        ? await resolverNumeroAlvo(doRemetente(sender), sender) : { via: null };
      const telefone = resolucao.via && resolucao.numero ? `${resolucao.numero}@s.whatsapp.net` : null;
      const admin = ehAdminDoGrupo(doRemetente(sender), sender) ||
        (telefone && ehAdminDoGrupo(doRemetente(telefone), telefone));
      const dono = telefone && ehDonoDoBot([], telefone);
      if (!admin && !dono) {
        return await sock.sendMessage(jid, {
          text: '🔒 Só administradores do grupo ou donos do bot podem usar /totag.'
        }, { quoted: msg });
      }

      // Retira só o primeiro token (comando/prefixo/alias), preservando o
      // conteúdo do argumento. Texto direto tem prioridade sobre o reply.
      const textoDireto = String(text ?? extrairTextoComando(msg)).replace(/^\s*\S+\s*/, '');
      // Mantém os IDs no formato do grupo (inclusive @lid).
      const mentions = participantes.map((p) => p.id).filter(Boolean);
      const marcacao = { mentions, contextInfo: { mentionedJid: mentions } };
      if (textoDireto.trim()) {
        await sock.sendMessage(jid, { text: textoDireto, ...marcacao });
        return;
      }

      const contexto = contextoCitado(msg.message);
      const quoted = contexto?.quotedMessage;
      if (!quoted) {
        return await sock.sendMessage(jid, {
          text: '📩 Use /totag seu texto (ou /notag2 seu texto).\n\nResponda a uma mensagem de texto, imagem, vídeo ou áudio e envie /totag sem texto para reenviá-la. Todos serão marcados silenciosamente.'
        }, { quoted: msg });
      }

      // Normalizar remove o envelope viewOnce. Conferir antes de normalizar
      // impede transformar mídia de visualização única em cópia permanente.
      if (visualizacaoUnica(quoted)) {
        return await sock.sendMessage(jid, {
          text: '🔒 Essa mídia é de visualização única e não pode ser reenviada por /totag. Peça ao autor uma imagem, vídeo ou áudio comum.'
        }, { quoted: msg });
      }

      const original = normalizeMessageContent(quoted) || {};
      const tipo = getContentType(original);
      if (!['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage'].includes(tipo)) {
        return await sock.sendMessage(jid, {
          text: '📩 O /totag só funciona respondendo a texto, imagem, vídeo ou áudio. Figurinhas não são suportadas.'
        }, { quoted: msg });
      }

      if (tipo === 'conversation' || tipo === 'extendedTextMessage') {
        const text = tipo === 'conversation' ? original.conversation : original.extendedTextMessage.text;
        await sock.sendMessage(jid, { text, ...marcacao });
        return;
      }

      // Buffer em memória: não cria arquivos temporários para limpar.
      // A key identifica a mensagem CITADA, não o comando de quem respondeu.
      const alvo = {
        key: {
          remoteJid: contexto.remoteJid || jid,
          id: contexto.stanzaId,
          participant: contexto.participant,
          fromMe: false
        },
        message: quoted
      };
      const buffer = await downloadMediaMessage(alvo, 'buffer', {});
      if (!buffer || buffer.length === 0) throw new Error('Mídia vazia');

      if (tipo === 'imageMessage') {
        const imagem = original.imageMessage;
        await sock.sendMessage(jid, {
          image: buffer,
          caption: imagem.caption ?? undefined,
          mimetype: imagem.mimetype || 'image/jpeg',
          ...marcacao
        });
      } else if (tipo === 'videoMessage') {
        const video = original.videoMessage;
        await sock.sendMessage(jid, {
          video: buffer,
          caption: video.caption ?? undefined,
          mimetype: video.mimetype || 'video/mp4',
          gifPlayback: video.gifPlayback === true,
          ...marcacao
        });
      } else {
        const audio = original.audioMessage;
        // AudioMessage possui contextInfo (WAProto, campo 17), e o Baileys
        // serializa mentionedJid também no áudio (Utils/messages.js).
        // Fonte: https://github.com/WhiskeySockets/Baileys/blob/master/src/Utils/messages.ts
        // Isso NÃO comprova notificação visível nos clientes WhatsApp:
        // sem validação em aparelhos, menções em áudio são best-effort.
        // Não acrescentamos texto nem envio separado para forçar notificação.
        await sock.sendMessage(jid, {
          audio: buffer,
          ptt: audio.ptt === true,
          mimetype: audio.mimetype || 'audio/ogg; codecs=opus',
          ...marcacao
        });
      }
    } catch (err) {
      console.error('[totag] falha capturada:', err?.message || err);
      await sock.sendMessage(jid, {
        text: '❌ Não consegui reenviar essa mensagem agora. A mídia pode ter expirado; tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {});
    }
  }
};
