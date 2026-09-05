const fs = require('fs');
const path = require('path');

// Configuração global do bot (lista de donos + helpers)
const { OWNER_NUMBERS, limparNumero } = require('../../config');

// Caminho corrigido apontando para comandos/dados
const BANCO_BLACKLIST = path.join(__dirname, '..', 'dados', 'blacklist.json');

function lerBlacklist() {
  try {
    if (!fs.existsSync(BANCO_BLACKLIST)) {
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
  nome: 'remblacklist',
  async executar(sock, jid, msg, text) {
    try {
      const sender = msg.key.participant || msg.key.remoteJid;

      // 🔒 Permissão: APENAS donos do bot (lista OWNER_NUMBERS do config.js —
      // mesma verificação usada em /soadm, /dono, /darvip e /servip).
      // Antes, esta checagem comparava com um ÚNICO LID hardcoded (SEU_LID),
      // então os demais donos configurados em OWNER_NUMBERS eram barrados.
      if (!OWNER_NUMBERS.includes(limparNumero(sender))) {
        return await sock.sendMessage(jid, {
          text: '🌑 Hipnos recusa sua invocação... você não possui domínio sobre a lista de sombras.'
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      const contextInfo = msg.message.extendedTextMessage?.contextInfo;
      let alvo = contextInfo?.mentionedJid?.[0] || contextInfo?.participant;

      // Se passou o número digitado puro (ex: /remblacklist 5511999999999)
      if (!alvo && args.length > 0) {
        const numeroLimpo = args[0].replace(/\D/g, '');
        if (numeroLimpo.length >= 10) {
          alvo = `${numeroLimpo}@s.whatsapp.net`;
        }
      }

      if (!alvo) {
        return await sock.sendMessage(jid, {
          text: '🌑 O ritual falhou...\nMarque um ser ou responda sua mensagem para que Hipnos o remova do limbo.'
        }, { quoted: msg });
      }

      let listaAtual = lerBlacklist();

      // Purifica o alvo para ficar APENAS o número puro, igualzinho está salvo no JSON
      const alvoLimpo = limparNumero(alvo);

      // Procura a posição exata do número puro na lista
      const index = listaAtual.indexOf(alvoLimpo);

      if (index === -1) {
        return await sock.sendMessage(jid, {
          text: '💀 Este espírito não foi encontrado nas profundezas do limbo.'
        }, { quoted: msg });
      }

      // Remove o número da lista usando o index encontrado
      listaAtual.splice(index, 1);

      salvarBlacklist(listaAtual);

      return await sock.sendMessage(jid, {
        text: '🌑⚖️ O perdão de Hipnos foi concedido. A alma foi libertada da lista negra.'
      }, { quoted: msg });

    } catch (err) {
      console.error('Erro no comando remblacklist:', err);
    }
  }
};