// ============================================================
// 🔊 REVELARAUDIO (/revelaraudio) — Reenvia áudio view-once em reply
// ============================================================
// Primo do /revelar (comandos/admin/revelar.js — NÃO mexido aqui):
// a MESMA lógica de desembrulhar view-once (normalizeMessageContent),
// mas filtrando SÓ audioMessage. Foto/vídeo view-once continuam sendo
// escopo do /revelar (recusamos com aviso apontando pra ele).
//
// Uso: /revelaraudio em REPLY a um áudio de visualização única.
//   - download via downloadMediaMessage ({ key, message }, 'buffer')
//     — o MESMO método do /revelar (ele desembrulha a view-once
//     internamente antes de baixar);
//   - reenvio preservando o formato original:
//     ptt = audioMessage.ptt === true (nota de voz ou áudio comum),
//     mimetype = audioMessage.mimetype (fallback ogg/opus).
//
// Permissão: VIP, ADMIN do grupo ou DONO do bot (escopo SÓ deste
// comando — o /revelar de imagem/vídeo continua livre, intocado).
// Ordem: checagem ANTES de tocar na mídia (sem download p/ recusado).
// Remetente resolvido via lid.js (PROOF-LID, padrão /hidetag//adv):
// sender cru + número real resolvido, cobrindo os dois formatos.
// ============================================================

const {
  downloadMediaMessage,
  normalizeMessageContent,
  getContentType
} = require('@whiskeysockets/baileys');
const { ehAdminDoGrupo, ehDonoDoBot } = require('../../config');
const { resolverNumeroAlvo } = require('../../lid');
const vip = require('../../vip');

// Chaves de embrulho view-once conhecidas (v1, v2 e extensão nova).
const CHAVES_VIEW_ONCE = [
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension'
];

const AVISO_SEM_REPLY =
  '❌ O ritual falhou... Você precisa responder (marcar) um áudio de visualização única.\n\n' +
  '📩 Peça para enviarem um áudio com 👁️ (visualização única) e responda a ele com `/revelaraudio`.';

const AVISO_NAO_EH_AUDIO_VIEW_ONCE =
  '❌ Hipnos não encontrou nenhum áudio de visualização única nesta mensagem.\n\n' +
  '🎙️ Responda (marque) um áudio enviado com 👁️ (visualização única) e chame `/revelaraudio`.';

const AVISO_NAO_EH_AUDIO_MAS_EH_MIDIA =
  '❌ Isso é uma foto/vídeo de visualização única — escopo do `/revelar`.\n\n' +
  '👁️‍🗨️ Responda a ela com `/revelar` em vez de `/revelaraudio` (este só revela ÁUDIOS).';

const AVISO_EXPIRADO =
  '⌛ Esse áudio já foi visualizado antes e a chave de mídia expirou no WhatsApp.\n\n' +
  '🔒 O WhatsApp apaga a chave após a primeira visualização — não é mais possível recuperar. Peça para reenviarem.';

const AVISO_GENERICO =
  '❌ Não consegui revelar esse áudio agora — o feitiço falhou, mas Hipnos segue de pé. Tente novamente em instantes.';

const AVISO_SEM_PERMISSAO =
  '🔒 *Este feitiço é só para os coroados...*\n\n' +
  'O `/revelaraudio` é exclusivo para 💠 *VIPs*, *admins do grupo* ou *donos do bot*.\n\n' +
  '💠 Quer virar VIP? Fale com um dono do bot ou consulte o `/menu-vip`.';

const LEGENDA_REVELADO = '🔊 *ÁUDIO REVELADO* 🔊\n\n🪐 Hipnos materializou o som que estava prestes a sumir no limbo.';

// ─── 🔐 Permissão: VIP, admin do grupo ou dono do bot ───
// Roda ANTES de qualquer processamento de mídia. Metadados do grupo
// servem p/ resolver o remetente (lid.js) e checar admin/dono —
// padrão /hidetag e /darvip. Falha de infra (Mongo/grupo) = recusa
// segura, nunca libera sem saber. Tudo injetável pros testes offline.
//
// 💠 Checagem real de VIP. 🛡️ Guarda de infra: sem MONGODB_URI o sistema
// de VIP está desativado (vip.js lançaria) — devolvemos false na hora em
// vez de esperar o timeout de conexão por um resultado que não existe.
const checarVipReal = async (alvo) => {
  if (!process.env.MONGODB_URI) return false;
  return vip.isVip(alvo);
};
let checarVip = checarVipReal;

async function temPermissao (sock, jid, msg) {
  const sender = msg?.key?.participant || msg?.key?.remoteJid || '';
  let participantes = [];
  if (String(jid || '').endsWith('@g.us')) {
    try {
      const metadados = await sock.groupMetadata(jid);
      participantes = metadados?.participants || [];
    } catch (errMeta) {
      console.error('[revelaraudio] ⚠️ sem metadados do grupo:', errMeta?.message || errMeta);
    }
  }
  // Candidatos PROOF-LID: sender cru + número real resolvido.
  const candidatos = [sender];
  try {
    const { numero, via } = await resolverNumeroAlvo(participantes, sender);
    if (via !== null && numero) candidatos.push(`${numero}@s.whatsapp.net`);
  } catch (errLid) {
    console.error('[revelaraudio] ⚠️ falha ao resolver remetente:', errLid?.message || errLid);
  }
  if (candidatos.some((c) => ehAdminDoGrupo(participantes, c) || ehDonoDoBot(participantes, c))) return true;
  for (const c of candidatos) {
    try {
      if (await checarVip(c)) return true;
    } catch (errVip) {
      console.error('[revelaraudio] ⚠️ falha ao checar VIP (seguindo sem liberar):', errVip?.message || errVip);
    }
  }
  return false;
}

// ─── 🔍 Extrai o áudio view-once da mensagem citada ───
// Retorna { estado, audio } onde estado é:
//   'sem-reply' | 'nao-audio-view-once' | 'midia-nao-audio' | 'ok'
function extrairAudioViewOnce (mQuoted) {
  if (!mQuoted || typeof mQuoted !== 'object') return { estado: 'sem-reply', audio: null };
  const ehViewOnce = CHAVES_VIEW_ONCE.some((k) => mQuoted && typeof mQuoted[k] === 'object');
  let conteudo = null;
  try {
    conteudo = normalizeMessageContent(mQuoted) || {};
  } catch (err) {
    return { estado: 'nao-audio-view-once', audio: null };
  }
  const tipo = getContentType(conteudo);
  if (tipo === 'audioMessage' && conteudo.audioMessage && typeof conteudo.audioMessage === 'object') {
    if (!ehViewOnce) return { estado: 'nao-audio-view-once', audio: null };
    return { estado: 'ok', audio: conteudo.audioMessage };
  }
  if (ehViewOnce && (tipo === 'imageMessage' || tipo === 'videoMessage')) {
    return { estado: 'midia-nao-audio', audio: null };
  }
  return { estado: 'nao-audio-view-once', audio: null };
}

// ─── ⚠️ A falha parece chave expirada? ───
// O WhatsApp apaga a mediaKey após a primeira visualização: o download
// falha com 400/401/403/404/410/412 ou mensagens de bad-key/decrypt.
function pareceChaveExpirada (err) {
  const status = Number(err?.response?.status ?? err?.status ?? err?.statusCode ?? NaN);
  if ([400, 401, 403, 404, 410, 412].includes(status)) return true;
  const texto = String(err?.mensagemFfmpeg || err?.message || err || '').toLowerCase();
  return /expir|bad[-_ ]?key|decrypt|media.*(not found|gone|unavailable)|404|410|412|no.*media|download.*fail/.test(texto);
}

let baixarMidia = (alvo) => downloadMediaMessage(alvo, 'buffer', {});

module.exports = {
  nome: 'revelaraudio',
  aliases: ['revelarpv', 'audiorevelado'],
  descricao: 'Revela áudios de visualização única (responda ao áudio view-once) — só VIP, admin do grupo ou dono do bot. Fotos/vídeos continuam no /revelar.',
  async executar (sock, jid, msg, text) {
    try {
      // 🔐 Permissão PRIMEIRO: sem download p/ quem não pode usar.
      let autorizado = false;
      try {
        autorizado = await temPermissao(sock, jid, msg);
      } catch (errPerm) {
        console.error('[revelaraudio] ⚠️ erro na checagem de permissão (recusando):', errPerm?.stack || errPerm);
        autorizado = false;
      }
      if (!autorizado) {
        return await sock.sendMessage(jid, { text: AVISO_SEM_PERMISSAO }, { quoted: msg }).catch(() => {});
      }

      const conteudoMsg = normalizeMessageContent(msg.message) || {};
      const contexto = conteudoMsg.extendedTextMessage?.contextInfo
        || conteudoMsg.imageMessage?.contextInfo
        || conteudoMsg.videoMessage?.contextInfo
        || conteudoMsg.audioMessage?.contextInfo;
      const mQuoted = contexto?.quotedMessage;

      const { estado, audio } = extrairAudioViewOnce(mQuoted);
      if (estado === 'sem-reply' || estado === 'nao-audio-view-once') {
        return await sock.sendMessage(jid, {
          text: estado === 'sem-reply' ? AVISO_SEM_REPLY : AVISO_NAO_EH_AUDIO_VIEW_ONCE
        }, { quoted: msg }).catch(() => {});
      }
      if (estado === 'midia-nao-audio') {
        return await sock.sendMessage(jid, { text: AVISO_NAO_EH_AUDIO_MAS_EH_MIDIA }, { quoted: msg }).catch(() => {});
      }

      console.log(`[revelaraudio] 🎙️ áudio view-once citado (ptt: ${audio.ptt === true}, mimetype: ${audio.mimetype || 'n/d'})`);
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } }).catch(() => {});

      let buffer = null;
      try {
        const mensagemAlvo = { key: msg.key, message: mQuoted };
        buffer = await baixarMidia(mensagemAlvo);
      } catch (errDownload) {
        console.error('[revelaraudio] 💥 falha no download:', errDownload?.stack || errDownload);
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
        if (pareceChaveExpirada(errDownload)) {
          return await sock.sendMessage(jid, { text: AVISO_EXPIRADO }, { quoted: msg }).catch(() => {});
        }
        return await sock.sendMessage(jid, { text: AVISO_GENERICO }, { quoted: msg }).catch(() => {});
      }

      if (!buffer || buffer.length === 0) {
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
        return await sock.sendMessage(jid, { text: AVISO_GENERICO }, { quoted: msg }).catch(() => {});
      }
      if (buffer.length > 25 * 1024 * 1024) {
        await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
        return await sock.sendMessage(jid, { text: '❌ Esse áudio excede o limite de 25MB suportado.' }, { quoted: msg }).catch(() => {});
      }

      // Preserva o formato original: ptt e mimetype vêm do audioMessage citado.
      const ptt = audio.ptt === true;
      const mimetype = typeof audio.mimetype === 'string' && audio.mimetype ? audio.mimetype : 'audio/ogg; codecs=opus';
      console.log(`[revelaraudio] 📤 reenviando (${buffer.length} bytes, ptt: ${ptt}, mimetype: ${mimetype})...`);
      await sock.sendMessage(jid, { audio: buffer, mimetype, ptt }, { quoted: msg });
      await sock.sendMessage(jid, { text: LEGENDA_REVELADO }).catch(() => {});
      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } }).catch(() => {});
      console.log('[revelaraudio] ✅ áudio revelado com sucesso');
    } catch (err) {
      console.error('[revelaraudio] 💥 erro capturado (o bot segue vivo):', err?.stack || err);
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await sock.sendMessage(jid, { text: AVISO_GENERICO }, { quoted: msg }).catch(() => {});
    }
  },
  // Ganchos p/ testes offline (não viram comando — o loader lê nome/executar do módulo).
  _test: {
    extrairAudioViewOnce, pareceChaveExpirada, temPermissao,
    AVISO_SEM_REPLY, AVISO_NAO_EH_AUDIO_VIEW_ONCE, AVISO_NAO_EH_AUDIO_MAS_EH_MIDIA, AVISO_EXPIRADO, AVISO_GENERICO, AVISO_SEM_PERMISSAO,
    _injetarDownload: (fn) => { baixarMidia = fn || ((alvo) => downloadMediaMessage(alvo, 'buffer', {})); },
    _injetarChecarVip: (fn) => { checarVip = fn || checarVipReal; }
  }
};
