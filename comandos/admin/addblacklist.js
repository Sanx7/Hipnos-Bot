const fs = require('fs');
const path = require('path');

// Caminho atualizado apontando para a pasta 'dados'
const BANCO_BLACKLIST = path.join(__dirname, '..', 'dados', 'blacklist.json');

function lerBlacklist() {
  try {
    // Garante que a pasta 'dados' exista antes de criar o arquivo
    const pastaDados = path.dirname(BANCO_BLACKLIST);
    if (!fs.existsSync(pastaDados)) {
      fs.mkdirSync(pastaDados, { recursive: true });
    }

    if (!fs.existsSync(BANCO_BLACKLIST)) {
      fs.writeFileSync(BANCO_BLACKLIST, JSON.stringify([]));
      return [];
    }
    const dados = fs.readFileSync(BANCO_BLACKLIST, 'utf-8');
    return JSON.parse(dados);
  } catch (err) {
    console.error("Erro ao ler blacklist.json:", err);
    return [];
  }
}

function salvarBlacklist(lista) {
  try {
    fs.writeFileSync(BANCO_BLACKLIST, JSON.stringify(lista, null, 2));
  } catch (err) {
    console.error("Erro ao salvar blacklist.json:", err);
  }
}

module.exports = {
  nome: 'addblacklist',

  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid;

      // Extrai apenas os números purificados do LID ou do JID
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, {
          text: '🌑 Hipnos recusa sua invocação... você não possui domínio sobre a lista de sombras.'
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      const contextInfo = msg.message.extendedTextMessage?.contextInfo;

      let alvo = contextInfo?.mentionedJid?.[0] || contextInfo?.participant;

      if (!alvo && args.length > 0) {
        const numeroLimpo = args[0].replace(/\D/g, '');
        if (numeroLimpo.length >= 10) {
          alvo = `${numeroLimpo}@s.whatsapp.net`;
        }
      }

      if (!alvo) {
        return await sock.sendMessage(jid, {
          text: '🌑 O ritual falhou...\nMarque um ser ou responda sua mensagem para que Hipnos o condene ao limbo.'
        }, { quoted: msg });
      }

      let listaAtual = lerBlacklist();
      const alvoLimpo = alvo.split('@')[0].split(':')[0].replace(/\D/g, '');

      console.log('BANCO_BLACKLIST:', BANCO_BLACKLIST);
      console.log('ALVO LIMPO:', alvoLimpo);
      console.log('LISTA ATUAL:', listaAtual);

      if (listaAtual.includes(alvoLimpo)) {
        return await sock.sendMessage(jid, {
          text: '💀 Este espírito já jaz aprisionado na lista negra de Hipnos.'
        }, { quoted: msg });
      }

      listaAtual.push(alvoLimpo);
      console.log('LISTA APÓS ADICIONAR:', listaAtual);
      
      salvarBlacklist(listaAtual);

      // Tenta remover o alvo do grupo atual
      try {
        await sock.groupParticipantsUpdate(jid, [alvo], 'remove');
      } catch (e) {
        console.error('Erro ao remover usuário do grupo:', e);
      }

      await sock.sendMessage(jid, {
        text: 
`🌑⚖️ JULGAMENTO DE HIPNOS

☠️ O veredito foi selado...
👤 Um espírito foi lançado ao limbo

💀 "O silêncio agora o acompanha eternamente."`
      }, { quoted: msg });

    } catch (err) {
      console.error('Erro no comando addblacklist:', err);
    }
  }
};