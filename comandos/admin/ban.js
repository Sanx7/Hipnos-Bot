const fs = require('fs');
const path = require('path');

// Configuração global do bot (helper de dono — PROOF-LID)
const { ehDonoDoBot, limparNumero } = require('../../config');

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

      // 🛡️ PROTEÇÃO DO PRÓPRIO BOT (JID dinâmico do socket — NADA fixo no código).
      //    A proteção do DONO do bot já acontece acima via ehDonoDoBot; esta aqui
      //    impede que o bot se auto-expulse (ex.: admin responde a uma mensagem
      //    do bot e o alvo vira o próprio número dele). Comparação por dígitos
      //    normalizados (igualdade), não por substring.
      const meuNumero = limparNumero(sock.user?.id);
      if (meuNumero && meuNumero === limparNumero(alvo)) {
        return await sock.sendMessage(jid, { text: 'Tentar me banir usando meu próprio comando? Volte a dormir... 💤' }, { quoted: msg });
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