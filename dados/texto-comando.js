// ============================================
// 📝 texto-comando.js — extração do texto que alimenta o ROTEADOR de comandos
// ============================================
// Módulo sem estado (mesmo estilo de dados/cooldowns.js e dados/jogos-ativos.js)
// que resolve UMA pergunta: "qual é o texto desta mensagem?".
//
// Por que ele existe:
//   🐞 Antes, o bot.js só olhava `conversation` e `extendedTextMessage.text`.
//      Uma FOTO enviada com o comando na LEGENDA chega como
//      `imageMessage.caption` (e vídeo/documento idem) — nenhum dos dois
//      campos acima. Resultado: a mensagem chegava ao messages.upsert com
//      text = '' e era descartada silenciosamente; o comando NUNCA era
//      roteado. Só funcionava o fluxo de RESPOSTA (reply), porque aí o texto
//      "/s" vem numa mensagem de texto normal.
//
// Regras (nesta ordem):
//   1) conversation                → mensagem de texto simples;
//   2) extendedTextMessage.text    → mensagem com citação/formatação;
//   3) imageMessage.caption        → 🖼️ legenda da foto (ex.: "/s");
//   4) videoMessage.caption        → 🎬 legenda do vídeo;
//   5) documentMessage.caption     → 📄 legenda do documento;
//   6) ''                          → sem texto nenhum.
//
// 🔓 normalizeMessageContent (Baileys) desembrulha as embalagens de protocolo
// (viewOnceMessage/V2/Extension, ephemeralMessage, documentWithCaptionMessage)
// ANTES da leitura — sem isso, mídia "ver uma vez" ou em grupo com mensagens
// temporárias teria o texto invisível. É o mesmo helper já usado no /revelar,
// /tomp3, /transcrever e /perfil.
//
// ⚠️ A mensagem ORIGINAL não é modificada: os monitores de grupo
// (antiDocument, antiStatus etc.) precisam ver a estrutura crua.
// ============================================

const { normalizeMessageContent } = require('@whiskeysockets/baileys')

// ─── 📝 extrairTextoComando(msgOuConteudo) ───
// Aceita tanto a mensagem inteira ({ message }) quanto o conteúdo já solto
// ({ conversation, imageMessage, ... }) — devolve SEMPRE uma string.
function extrairTextoComando (msgOuConteudo) {
  if (!msgOuConteudo) return ''

  const bruto = msgOuConteudo.message || msgOuConteudo
  const conteudo = normalizeMessageContent(bruto) || bruto
  if (!conteudo || typeof conteudo !== 'object') return ''

  const texto =
    conteudo.conversation ||
    conteudo.extendedTextMessage?.text ||
    conteudo.imageMessage?.caption ||
    conteudo.videoMessage?.caption ||
    conteudo.documentMessage?.caption ||
    ''

  return typeof texto === 'string' ? texto : ''
}

module.exports = { extrairTextoComando }