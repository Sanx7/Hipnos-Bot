const fs = require('fs');
const path = require('path');

// Configuração global do bot (helpers de dono — verificação PROOF-LID)
const { limparNumero, ehDonoDoBot } = require('../../config');

// 🪪 Resolução LID→número real (menção/reply pode chegar como "@lid")
const { resolverNumeroAlvo } = require('../../lid');

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

      // 🔒 Permissão: APENAS donos do bot.
      // Checagem PROOF-LID (ehDonoDoBot): em grupo buscamos os metadados
      // para resolver o sender mesmo quando ele vem como "@lid"; sem
      // metadados, a própria função cai na comparação direta.
      // Antes, esta checagem comparava com um ÚNICO LID hardcoded (SEU_LID),
      // então os demais donos configurados em OWNER_NUMBERS eram barrados.
      let participantes = null
      if (jid.endsWith('@g.us')) {
        try {
          const metadados = await sock.groupMetadata(jid)
          participantes = metadados.participants
        } catch (e) {
          console.error('Sem metadados do grupo (addblacklist):', e?.message || e);
        }
      }
      if (!ehDonoDoBot(participantes, sender)) {
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

      // 🚫 PROTEÇÃO DO DONO DO BOT: nem outro dono pode lançar um dono à
      // blacklist — isso também removeria o alvo do grupo, lá embaixo.
      if (ehDonoDoBot(participantes, alvo)) {
        return await sock.sendMessage(jid, {
          text: '⛔ Não é possível executar essa ação contra o dono do bot.'
        }, { quoted: msg });
      }

      let listaAtual = lerBlacklist();

      // 🪪 RESOLUÇÃO LID→NÚMERO REAL (lid.js): a menção/reply pode chegar como
      // "175952680210489@lid" em grupos com LID habilitado. Gravar o LID no
      // blacklist.json quebrava a checagem automática de entrada (o bot.js
      // compara números REAIS). Resolvemos p/ o número REAL antes de gravar
      // (metadados do grupo → mapeamento da sessão). Número digitado é direto.
      const resolucao = await resolverNumeroAlvo(participantes, alvo);
      if (!resolucao.numero || resolucao.via === null) {
        console.warn(
          `[addblacklist] 🪪 LID ${resolucao.numero || limparNumero(alvo)} não resolvível p/ número real — recusando para NÃO gravar LID`
        );
        return await sock.sendMessage(jid, {
          text: '🪪 *Não consegui identificar o número real desse alvo* (o WhatsApp entregou só o LID).\n\nCondene direto pelo número: */addblacklist 5511999999999*.'
        }, { quoted: msg });
      }
      const alvoLimpo = resolucao.numero;
      if (resolucao.via !== 'direto') {
        console.log(`[addblacklist] 🪪 alvo resolvido de @lid p/ número real via ${resolucao.via}: ${alvoLimpo}`);
      }

      if (listaAtual.includes(alvoLimpo)) {
        return await sock.sendMessage(jid, {
          text: '💀 Este espírito já jaz aprisionado na lista negra de Hipnos.'
        }, { quoted: msg });
      }

      listaAtual.push(alvoLimpo);

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