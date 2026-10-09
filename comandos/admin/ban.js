const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

// Configuração global do bot (helper de dono — PROOF-LID)
const { limparNumero } = require('../../config');
const { ehProprioBot, respostaAutoexpulsao } = require('../../dados/protecao-bot');
const { identificar, autorizado, extrairAlvo } = require('../../dados/advertencias-contexto');

// Caminho da lista negra (comandos/dados/blacklist.json)
const BANCO_BLACKLIST = path.join(__dirname, '..', 'dados', 'blacklist.json');

// Adiciona o número na lista negra após confirmar a expulsão
// (exportada: o /adv REUSA esta gravação no ban automático por advertências).
function adicionarNaBlacklist(numero) {
  try {
    let lista = [];
    if (fs.existsSync(BANCO_BLACKLIST)) {
      lista = JSON.parse(fs.readFileSync(BANCO_BLACKLIST, 'utf8'));
    }
    if (!Array.isArray(lista)) throw new Error('Blacklist inválida; arquivo existente preservado.');

    if (!lista.includes(numero)) {
      lista.push(numero);
      // Substituição atômica no mesmo diretório; uma falha não trunca o JSON atual.
      const temporario = `${BANCO_BLACKLIST}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporario, JSON.stringify(lista, null, 2), { flag: 'wx' });
        fs.renameSync(temporario, BANCO_BLACKLIST);
      } finally {
        if (fs.existsSync(temporario)) fs.unlinkSync(temporario);
      }
    }
  } catch (erro) {
    console.error('Erro ao salvar blacklist no ban:', erro);
    throw erro;
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

// ☠️ PUNIÇÃO MÁXIMA reutilizável: confirma a expulsão e então grava blacklist.
// Extraída do executar() para que o /adv aplique EXATAMENTE a mesma punição
// no ban automático por advertências (nada de lógica duplicada).
// `numeroParaBlacklist` (opcional) permite gravar na lista negra o NÚMERO
// REAL resolvido (lid.js) quando o alvo veio como "@lid" — sem isso, o /adv
// gravaria o LID cru, contrariando a correção já aplicada em VIP/RPG.
// Lança se o WhatsApp recusar a remoção (ex.: bot não é admin).
async function banirDoGrupo(sock, jid, alvoJid, numeroParaBlacklist, opcoes = {}) {
  // Também protege chamadas do /adv e das votações, antes da blacklist.
  if (await ehProprioBot(sock, jid, alvoJid)) {
    throw new Error(respostaAutoexpulsao());
  }
  const participantes = (await sock.groupMetadata(jid))?.participants || [];
  const alvo = await identificar(participantes, alvoJid);
  if (!alvo.numero || alvo.dono || (numeroParaBlacklist && limparNumero(numeroParaBlacklist) !== alvo.numero)) {
    throw new Error('Alvo protegido ou identidade não comprovada');
  }
  const alvoLimpo = alvo.numero;
  // Automações podem exigir prova recente de membro/ADM. O status retornado
  // pelo WhatsApp sempre é verificado antes da blacklist e do arquivamento.
  await removerDoGrupoConfirmado(sock, jid, alvoJid, opcoes);
  // Somente uma remoção aceita pode gerar blacklist. Não migra o JSON existente.
  try {
    if (opcoes.aoConfirmar) await opcoes.aoConfirmar();
    gravarNaBlacklist(alvoLimpo);
  } catch (erro) { erro.remocaoConfirmada = true; throw erro; }
  return alvoLimpo;
}

async function removerDoGrupoConfirmado(sock, jid, alvoJid, opcoes = {}) {
  if (await ehProprioBot(sock, jid, alvoJid)) throw new Error(respostaAutoexpulsao());
  if (opcoes.validar) await opcoes.validar();
  if (opcoes.antesRemover) await opcoes.antesRemover();
  const resultado = await sock.groupParticipantsUpdate(jid, [alvoJid], 'remove');
  if (!resultado?.length || resultado.length !== 1 || resultado.some(r => String(r.status) !== '200')) {
    const erro = new Error('Remoção recusada ou não confirmada pelo WhatsApp');
    erro.remocaoRecusada = Boolean(resultado?.length && resultado.every(r => r.status != null && String(r.status) !== '200'));
    throw erro;
  }
  return resultado;
}

module.exports = {
  nome: 'ban',
  // ♻️ Helpers exportados: o /adv reusa `banirDoGrupo` no ban automático
  // das 3 advertências (o loader ignora propriedades extras).
  banirDoGrupo,
  removerDoGrupoConfirmado,
  adicionarNaBlacklist,
  __definirGravacaoBlacklistTeste,
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { text: 'Este comando só serve para grupos, gênio. 🥱' }, { quoted: msg });
      }

      const sender = msg.key.participant || msg.key.remoteJid;
      const alvo = extrairAlvo(msg);

      if (!alvo) {
        return await sock.sendMessage(jid, { text: 'Você precisa marcar alguém com @ ou responder à mensagem da pessoa para eu chutar daqui! 🥱' }, { quoted: msg });
      }

      // Verifica se quem usou o comando é administrador ou o dono do grupo
      const metadados = await sock.groupMetadata(jid);
      if (await ehProprioBot(sock, jid, alvo, metadados.participants)) {
        return await sock.sendMessage(jid, { text: respostaAutoexpulsao() }, { quoted: msg });
      }
      const ehAdmin = await autorizado(metadados, sender);

      if (!ehAdmin) {
        return await sock.sendMessage(jid, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: msg });
      }

      // 🚫 PROTEÇÃO DO DONO DO BOT (falha de segurança corrigida):
      // A checagem é sobre QUEM É O ALVO — vale para admin, outro dono ou
      // até o próprio bot processando o comando por engano. Nada é gravado
      // na blacklist nem removido antes desta verificação.
      if ((await identificar(metadados.participants, alvo)).dono) {
        return await sock.sendMessage(jid, { text: '⛔ Não é possível executar essa ação contra o dono do bot.' }, { quoted: msg });
      }

      // Confirma a remoção antes de adicionar o alvo à blacklist
      // (mesma função usada pelo /adv no ban automático por advertências)
      try {
        await banirDoGrupo(sock, jid, alvo);
        return await sock.sendMessage(jid, { text: 'Pronto. Mais um insolente removido do recinto e lançado na blacklist. 🥱' });
      } catch (wsError) {
        if (wsError.remocaoConfirmada) return await sock.sendMessage(jid, { text: '⚠️ Participante removido, mas não consegui concluir o registro na blacklist. Solicite revisão ao dono.' }, { quoted: msg });
        // Se falhar, significa que o bot não é admin no grupo real
        return await sock.sendMessage(jid, { text: 'Eu tentei chutar ele, mas o WhatsApp não deixou. Me dê administrador de verdade primeiro. 🥱' }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando ban:', err);
    }
  }
};
