const fs = require('fs');
const path = require('path');

// Caminho da lista negra (comandos/dados/blacklist.json)
const BANCO_BLACKLIST = path.join(__dirname, '..', 'dados', 'blacklist.json');

function isAdmin(p) {
  return p?.admin === 'admin' || p?.admin === 'superadmin';
}

// Adiciona o número na lista negra antes de expulsar
function adicionarNaBlacklist(numero) {
  try {
    let lista = [];
    if (fs.existsSync(BANCO_BLACKLIST)) {
      lista = JSON.parse(fs.readFileSync(BANCO_BLACKLIST, 'utf8'));
    }
    if (!Array.isArray(lista)) lista = [];

    if (!lista.includes(numero)) {
      lista.push(numero);
      fs.writeFileSync(BANCO_BLACKLIST, JSON.stringify(lista, null, 2));
    }
  } catch (erro) {
    console.error('Erro ao salvar blacklist no ban:', erro);
  }
}

module.exports = {
  nome: 'ban',
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { text: 'Este comando só serve para grupos, gênio. 🥱' }, { quoted: msg });
      }

      const sender = msg.key.participant || msg.key.remoteJid;
      const contextInfo = msg.message.extendedTextMessage?.contextInfo;
      let alvo = contextInfo?.mentionedJid?.[0] || contextInfo?.participant;

      if (!alvo) {
        return await sock.sendMessage(jid, { text: 'Você precisa marcar alguém com @ ou responder à mensagem da pessoa para eu chutar daqui! 🥱' }, { quoted: msg });
      }

      // Verifica se quem usou o comando é administrador ou o dono do grupo
      const metadados = await sock.groupMetadata(jid);
      const dadosSender = metadados.participants.find(p => p.id === sender);
      const ehAdmin = isAdmin(dadosSender) || metadados.owner === sender;

      if (!ehAdmin) {
        return await sock.sendMessage(jid, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
      }

      // IDs Fixos de Segurança (Mestre e Bot)
      const SEU_NUMERO_WHATSAPP = '14382246600@s.whatsapp.net';
      const meuJidCompleto = sock.user?.id || '';

      if (alvo.includes(SEU_NUMERO_WHATSAPP)) {
        return await sock.sendMessage(jid, { text: 'Eu jamais ousaria expulsar o meu Soberano do recinto. 🪐' }, { quoted: msg });
      }

      if (meuJidCompleto.includes(alvo.split('@')[0])) {
        return await sock.sendMessage(jid, { text: 'Tentar me banir usando meu próprio comando? Volte a dormir... 💤' }, { quoted: msg });
      }

      // Adiciona o alvo à blacklist antes de expulsar
      const alvoLimpo = alvo.split('@')[0].split(':')[0].replace(/\D/g, '');
      adicionarNaBlacklist(alvoLimpo);

      // Execução do banimento
      try {
        await sock.groupParticipantsUpdate(jid, [alvo], 'remove');
        return await sock.sendMessage(jid, { text: 'Pronto. Mais um insolente removido do recinto e lançado na blacklist. 🥱' });
      } catch (wsError) {
        // Se falhar, significa que o bot não é admin no grupo real
        return await sock.sendMessage(jid, { text: 'Eu tentei chutar ele, mas o WhatsApp não deixou. Me dê administrador de verdade primeiro. 🥱' }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando ban:', err);
    }
  }
};