const fs = require('fs');
const path = require('path');

// Configuração global do bot (helper de dono — PROOF-LID)
const { ehDonoDoBot, limparNumero } = require('../../config');
const { ehProprioBot, respostaAutoexpulsao } = require('../../dados/protecao-bot');

// Caminho da lista negra (comandos/dados/blacklist.json)
const BANCO_BLACKLIST = path.join(__dirname, '..', 'dados', 'blacklist.json');

function isAdmin(p) {
  return p?.admin === 'admin' || p?.admin === 'superadmin';
}

// Adiciona o número na lista negra antes de expulsar
// (exportada: o /adv REUSA esta gravação no ban automático das 3 advertências).
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

// 🧪 GANCHO DE TESTE (usado por scripts/teste-adv.js): troca a gravação em
// disco por uma função espiã, para que o ban automático das advertências
// NUNCA escreva no blacklist.json real durante os testes offline.
// Sem argumento (ou com algo que não é função), volta ao comportamento normal.
let gravarNaBlacklist = adicionarNaBlacklist;
function __definirGravacaoBlacklistTeste(fn) {
  gravarNaBlacklist = typeof fn === 'function' ? fn : adicionarNaBlacklist;
}

// ☠️ PUNIÇÃO MÁXIMA reutilizável: grava na blacklist e expulsa do grupo.
// Extraída do executar() para que o /adv aplique EXATAMENTE a mesma punição
// no ban automático das 3 advertências (nada de lógica duplicada).
// `numeroParaBlacklist` (opcional) permite gravar na lista negra o NÚMERO
// REAL resolvido (lid.js) quando o alvo veio como "@lid" — sem isso, o /adv
// gravaria o LID cru, contrariando a correção já aplicada em VIP/RPG.
// Lança se o WhatsApp recusar a remoção (ex.: bot não é admin).
async function banirDoGrupo(sock, jid, alvoJid, numeroParaBlacklist) {
  // Também protege chamadas do /adv e das votações, antes da blacklist.
  if (await ehProprioBot(sock, jid, alvoJid)) {
    throw new Error(respostaAutoexpulsao());
  }
  const alvoLimpo = limparNumero(numeroParaBlacklist || alvoJid);
  gravarNaBlacklist(alvoLimpo);
  await sock.groupParticipantsUpdate(jid, [alvoJid], 'remove');
  return alvoLimpo;
}

module.exports = {
  nome: 'ban',
  // ♻️ Helpers exportados: o /adv reusa `banirDoGrupo` no ban automático
  // das 3 advertências (o loader ignora propriedades extras).
  banirDoGrupo,
  adicionarNaBlacklist,
  __definirGravacaoBlacklistTeste,
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
      if (await ehProprioBot(sock, jid, alvo, metadados.participants)) {
        return await sock.sendMessage(jid, { text: respostaAutoexpulsao() }, { quoted: msg });
      }
      const dadosSender = metadados.participants.find(p => p.id === sender);
      const ehAdmin = isAdmin(dadosSender) || metadados.owner === sender;

      if (!ehAdmin) {
        return await sock.sendMessage(jid, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
      }

      // 🚫 PROTEÇÃO DO DONO DO BOT (falha de segurança corrigida):
      // A checagem é sobre QUEM É O ALVO — vale para admin, outro dono ou
      // até o próprio bot processando o comando por engano. Nada é gravado
      // na blacklist nem removido antes desta verificação.
      if (ehDonoDoBot(metadados.participants, alvo)) {
        return await sock.sendMessage(jid, { text: '⛔ Não é possível executar essa ação contra o dono do bot.' }, { quoted: msg });
      }

      // Adiciona o alvo à blacklist antes de expulsar + execução do banimento
      // (mesma função usada pelo /adv no ban automático das 3 advertências)
      try {
        await banirDoGrupo(sock, jid, alvo);
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
