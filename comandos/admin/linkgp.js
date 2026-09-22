const { ehAdminDoGrupo, ehDonoDoBot } = require("../../config");
const { resolverNumeroAlvo } = require("../../lid");

module.exports = {
  nome: "linkgp",
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não gerencia portais fora de um território coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // 1) Metadados PRIMEIRO (padrão do /hidetag): participants necessários
      //    p/ resolver o remetente via lid.js e checar admin/dono.
      let metadados;
      try {
        metadados = await sock.groupMetadata(jid);
      } catch (erroMeta) {
        console.error('Erro no comando linkgp (metadados):', erroMeta);
        return await sock.sendMessage(jid, {
          text: '⚠️ Não consegui ler os membros deste grupo agora. Tente de novo em instantes.'
        }, { quoted: msg });
      }
      const participantes = metadados.participants || [];

      // 2) 🪪 Resolve o remetente (PROOF-LID — pode vir "@lid")
      const sender = msg.key.participant || msg.key.remoteJid;
      const resolucao = await resolverNumeroAlvo(participantes, sender);

      // Candidatos: sender CRU (bate com id LID/número do participant) E o
      // número REAL resolvido (bate com phoneNumber/id) — cobre os DOIS
      // formatos que o groupMetadata pode devolver.
      const candidatos = [sender];
      if (resolucao.via !== null && resolucao.numero) {
        candidatos.push(`${resolucao.numero}@s.whatsapp.net`);
      }

      // 3) 🔐 ADMIN do grupo OU DONO do bot (mesmo critério do /hidetag)
      const ehAutorizado = candidatos.some(
        (c) => ehAdminDoGrupo(participantes, c) || ehDonoDoBot(participantes, c)
      );

      if (!ehAutorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 Hipnos recusa sua ordem... apenas os administradores e o Soberano podem revelar as coordenadas deste território.'
        }, { quoted: msg });
      }

      // Tenta obter o código de convite do grupo usando a função nativa do Baileys
      try {
        const codigoConvite = await sock.groupInviteCode(jid);
        
        if (!codigoConvite) {
          return await sock.sendMessage(jid, { 
            text: '❌ Erro ao invocar o portal. Certifique-se de que Hipnos possui privilégios de Administrador neste recinto.' 
          }, { quoted: msg });
        }

        const linkCompleto = `https://chat.whatsapp.com/${codigoConvite}`;

        await sock.sendMessage(jid, {
          text: `🌌 **PORTAL DO LIMBO REVELADO** 🌌\n\n🪐 Aqui está o caminho para novos mortais entrarem no reino:\n🔗 ${linkCompleto}`
        }, { quoted: msg });

      } catch (err) {
        // Se cair no catch aqui, geralmente significa que o bot não é admin
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos está impotente... Conceda-me o cargo de Administrador para que eu possa ler os pergaminhos de convite.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando linkgp:', err);
    }
  }
};