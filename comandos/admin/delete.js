// ============================================
// 🗑️ DELETE (/delete ou /d) — Apaga mensagens do recinto
// ============================================
// Exclusivo para administradores. Apaga:
//   1) a mensagem RESPONDIDA (marcada) pelo admin;
//   2) a própria mensagem do comando — o chat fica limpo.
//
// ⚠️ Regra do WhatsApp: para apagar mensagens de OUTRAS pessoas, o BOT
// precisa ser administrador do grupo. O comando checa isso antes e avisa.
//
// Como usar: responda (segure → Responder) à mensagem indesejada e envie
// /delete (ou /d). Em caso de sucesso o bot fica em silêncio — o
// desaparecimento das duas mensagens É a confirmação.
// ============================================

const { ehAdminDoGrupo, ehDonoDoBot, limparNumero, acharParticipante } = require("../../config");

function isAdmin(p) {
  return p?.admin === "admin" || p?.admin === "superadmin";
}

module.exports = {
  nome: "delete",
  descricao: "Apaga a mensagem respondida e o próprio comando (apenas admins; responda à mensagem).",

  async executar(sock, jid, msg) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid;

      // 🚫 Este comando só tem efeito dentro de grupos
      if (!jid.endsWith("@g.us")) {
        return await sock.sendMessage(jid, {
          text: "🗑️ Este comando só funciona dentro dos recintos (grupos)."
        }, { quoted: msg });
      }

      // 👥 Metadados: autorização do autor + status do bot no recinto
      const metadados = await sock.groupMetadata(jid);
      const participantes = metadados.participants;

      // 🔒 Somente administradores do grupo (ou o dono do bot) podem apagar.
      // Checagem PROOF-LID via config (mesmo padrão do /roletarussa e /soadm).
      const ehAutorizado =
        ehAdminDoGrupo(participantes, sender) ||
        ehDonoDoBot(participantes, sender);

      if (!ehAutorizado) {
        return await sock.sendMessage(jid, {
          text: "💀 Apenas administradores do recinto podem apagar mensagens."
        }, { quoted: msg });
      }

      // ⚠️ O WhatsApp só aceita apagar mensagens de TERCEIROS se o BOT for
      // administrador. Sem isso a revogação é ignorada silenciosamente —
      // então avisamos ANTES de tentar.
      const botParticipante = acharParticipante(participantes, sock.user?.id);
      if (!isAdmin(botParticipante)) {
        return await sock.sendMessage(jid, {
          text: "🥱 Para apagar mensagens, Hipnos precisa ser administrador do recinto."
        }, { quoted: msg });
      }

      // 📌 Mensagem citada (respondida) pelo admin
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const idCitada = contextInfo?.stanzaId;
      const temCitada = Boolean(contextInfo?.quotedMessage && idCitada);

      if (!temCitada) {
        return await sock.sendMessage(jid, {
          text: "❌ Responda (marque) a mensagem que deseja apagar.\nEx.: responda à mensagem indesejada com /delete ou /d"
        }, { quoted: msg });
      }

      // A citação pode apontar para outro chat (ex.: status). Só apagamos
      // o que pertence a ESTE recinto — evita revogação fútil.
      if (contextInfo.remoteJid && contextInfo.remoteJid !== jid) {
        return await sock.sendMessage(jid, {
          text: "❌ A mensagem marcada não pertence a este recinto."
        }, { quoted: msg });
      }

      // 🗝️ Chave de revogação da mensagem citada:
      // - mensagem do próprio bot → fromMe: true (participant não vai);
      // - mensagem de terceiros  → fromMe: false + participant do autor.
      const autorCitado = contextInfo.participant || "";
      const ehCitadaDoBot = Boolean(
        autorCitado &&
        limparNumero(autorCitado) === limparNumero(sock.user?.id)
      );

      const chaveCitada = ehCitadaDoBot
        ? { remoteJid: jid, fromMe: true, id: idCitada }
        : { remoteJid: jid, fromMe: false, id: idCitada, participant: autorCitado };

      let falhaCitada = null;
      let falhaComando = null;

      // 🗑️ 1) Apaga a mensagem citada
      try {
        await sock.sendMessage(jid, { delete: chaveCitada });
      } catch (err) {
        falhaCitada = err;
        console.error("Erro ao apagar a mensagem citada:", err);
      }

      // 🗑️ 2) Apaga a própria mensagem do comando
      try {
        await sock.sendMessage(jid, {
          delete: { remoteJid: jid, fromMe: false, id: msg.key.id, participant: sender }
        });
      } catch (err) {
        falhaComando = err;
        console.error("Erro ao apagar a mensagem do comando:", err);
      }

      // ✅ Sucesso total: silêncio — o desaparecimento das mensagens É a confirmação
      if (!falhaCitada && !falhaComando) return;

      // ☠️ Algo falhou: avisa o admin com o resultado de cada parte
      const aviso =
        falhaCitada && falhaComando
          ? "❌ Não consegui apagar as mensagens. Verifique se Hipnos é administrador do recinto e tente novamente."
          : falhaCitada
            ? "❌ O comando foi apagado, mas a mensagem marcada resistiu. Verifique se Hipnos é administrador do recinto."
            : "❌ A mensagem marcada foi apagada, mas o comando resistiu.";

      return await sock.sendMessage(jid, { text: aviso });
    } catch (err) {
      console.error("Erro no comando delete:", err);
      return await sock.sendMessage(jid, {
        text: "❌ Ocorreu um erro ao tentar apagar a mensagem."
      });
    }
  }
};