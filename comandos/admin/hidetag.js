// ============================================
// 📢 HIDETAG — Convocação oculta em massa (/hidetag)
// ============================================
// Marca TODOS os membros do grupo numa única mensagem (menção oculta).
//
// 🔐 Permissão — ADMIN do grupo OU DONO do bot (mesmo critério do /delete,
// /soadm e /welcome):
//   - o remetente ("@lid" OU número) é RESOLVIDO via lid.js (PROOF-LID)
//     ANTES de comparar — mesma causa raiz já corrigida no VIP e no RPG:
//     msg.key.participant chega como "...@lid" e a comparação bruta
//     barrava até dono e admin de verdade;
//   - dono: ehDonoDoBot (OWNER_NUMBERS — fonte única, sem número fixo);
//   - admin: ehAdminDoGrupo comparando no FORMATO que o groupMetadata
//     devolve (participants[].id pode ser LID ou número) — por isso a
//     checagem usa o sender CRU e o NÚMERO REAL resolvido, cobrindo os
//     dois formatos de grupo.
// ============================================

const { ehAdminDoGrupo, ehDonoDoBot } = require("../../config");
const { resolverNumeroAlvo } = require("../../lid");

module.exports = {
  nome: "hidetag",
  descricao: "Marca todos os membros do grupo numa mensagem (admin do grupo ou dono do bot).",

  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, {
          text: '🌑 Hipnos não convoca almas fora de um território coletivo. Use este comando em um grupo.'
        }, { quoted: msg });
      }

      // 1) Metadados PRIMEIRO: os participants são necessários p/ resolver
      //    o remetente (lid.js) e checar admin/dono.
      let metadados;
      try {
        metadados = await sock.groupMetadata(jid);
      } catch (erroMeta) {
        console.error('Erro no comando hidetag (metadados):', erroMeta);
        return await sock.sendMessage(jid, {
          text: '⚠️ Não consegui ler os membros deste grupo agora. Tente de novo em instantes.'
        }, { quoted: msg });
      }
      const participantes = metadados.participants || [];

      // 2) 🪪 Resolve o remetente (PROOF-LID — lid.js): pode vir "@lid".
      //    Sem número resolvível a resolução devolve via: null e ficamos
      //    só com o JID cru (a checagem decide — nada de gravar LID cru).
      const sender = msg.key.participant || msg.key.remoteJid;
      const resolucao = await resolverNumeroAlvo(participantes, sender);

      // Candidatos p/ comparação: o JID cru (bate com participants[].id
      // quando o grupo é LID ou o sender já é número) E o número REAL
      // resolvido (bate com phoneNumber ou id numérico) — cobre os DOIS
      // formatos que o groupMetadata pode devolver.
      const candidatos = [sender];
      if (resolucao.via !== null && resolucao.numero) {
        candidatos.push(`${resolucao.numero}@s.whatsapp.net`);
      }

      // 3) 🔐 ADMIN do grupo (ehAdminDoGrupo) OU DONO do bot (ehDonoDoBot)
      const ehAutorizado = candidatos.some(
        (c) => ehAdminDoGrupo(participantes, c) || ehDonoDoBot(participantes, c)
      );

      if (!ehAutorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 Hipnos recusa sua ordem... você não possui a voz que ecoa no subconsciente deste reino.'
        }, { quoted: msg });
      }

      // Extrai o motivo/texto após o comando
      const args = String(text || '').split(' ').slice(1);
      const motivo = args.join(' ').trim();

      // Convocação em massa com menção oculta (ids NO FORMATO do grupo)
      const ids = participantes.map((p) => p.id);
      const mensagemInvocacao = `🔔 **CONVOCAÇÃO DO LIMBO** 🔔\n\n🪐 Hipnos exige sua atenção imediata.\n\n📝 **Mensagem:** ${motivo || 'O Soberano não deu explicações, apenas apareçam.'}`;

      await sock.sendMessage(jid, {
        text: mensagemInvocacao,
        mentions: ids
      });

    } catch (err) {
      console.error('Erro no comando hidetag:', err);
      await sock.sendMessage(jid, {
        text: '❌ Não consegui convocar o grupo agora (falha inesperada). Tente de novo em instantes.'
      }, { quoted: msg }).catch(() => {});
    }
  }
};