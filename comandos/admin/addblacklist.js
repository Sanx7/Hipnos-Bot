const fs = require('fs');
const path = require('path');

// Configuração global do bot (helpers de dono — verificação PROOF-LID)
const { ehDonoDoBot } = require('../../config');

// 🪪 Resolução LID→número real (menção/reply pode chegar como "@lid")
const { resolverNumeroAlvo } = require('../../lid');
const { ehProprioBot, respostaAutoexpulsao } = require('../../dados/protecao-bot');
const { obterAlvoBlacklist } = require('../../dados/blacklist-alvo');
const { identificar } = require('../../dados/identidade-participante');
const { obterPrefixo } = require('../../prefixo');

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
    const lista = JSON.parse(dados);
    if (!Array.isArray(lista) || lista.some(n => typeof n !== 'string' || !/^\d+$/.test(n))) throw new Error('Blacklist inválida');
    return lista;
  } catch (err) {
    throw new Error('Falha ao ler blacklist');
  }
}

function salvarBlacklist(lista) {
  try {
    fs.writeFileSync(BANCO_BLACKLIST, JSON.stringify(lista, null, 2));
  } catch (err) {
    throw new Error('Falha ao salvar blacklist');
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
          console.warn('[addblacklist] Metadados indisponíveis.');
        }
      }
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 Hipnos recusa sua invocação... você não possui domínio sobre a lista de sombras.'
        }, { quoted: msg });
      }

      const selecionado = obterAlvoBlacklist(msg, text);
      const alvo = selecionado?.jid;

      if (!alvo) {
        return await sock.sendMessage(jid, {
          text: `⚠️ Mencione a pessoa, responda à mensagem dela ou use ${await obterPrefixo()}addblacklist <número internacional>.\nExemplos: 55139757976987 ou +55 (13) 97579-76987.\nInforme um único número, com DDI e DDD (10–15 dígitos).`
        }, { quoted: msg });
      }

      if (await ehProprioBot(sock, jid, alvo, participantes)) {
        return await sock.sendMessage(jid, { text: respostaAutoexpulsao() }, { quoted: msg });
      }

      // 🚫 PROTEÇÃO DO DONO DO BOT: nem outro dono pode lançar um dono à
      // blacklist — isso também removeria o alvo do grupo, lá embaixo.
      if (ehDonoDoBot(participantes, alvo)) {
        return await sock.sendMessage(jid, {
          text: '⛔ Não é possível executar essa ação contra o dono do bot.'
        }, { quoted: msg });
      }

      // 🪪 RESOLUÇÃO LID→NÚMERO REAL (lid.js): a menção/reply pode chegar como
      // "175952680210489@lid" em grupos com LID habilitado. Gravar o LID no
      // blacklist.json quebrava a checagem automática de entrada (o bot.js
      // compara números REAIS). Resolvemos p/ o número REAL antes de gravar
      // (metadados do grupo → mapeamento da sessão). Número digitado é direto.
      const resolucao = await resolverNumeroAlvo(participantes, alvo);
      if (!resolucao.numero || resolucao.via === null) {
        console.warn('[addblacklist] Identidade do alvo não resolvida; cadastro recusado.');
        return await sock.sendMessage(jid, {
          text: '🪪 *Não consegui identificar o número real desse alvo* (o WhatsApp entregou só o LID).\n\nCondene direto pelo número: */addblacklist 5511999999999*.'
        }, { quoted: msg });
      }
      const alvoLimpo = resolucao.numero;
      const jidReal = `${alvoLimpo}@s.whatsapp.net`;
      // Revalida depois da resolução de sessão, inclusive para donos por LID.
      if (ehDonoDoBot(participantes, jidReal)) {
        return await sock.sendMessage(jid, { text: '⛔ Não é possível executar essa ação contra o dono do bot.' }, { quoted: msg });
      }
      if (await ehProprioBot(sock, jid, jidReal, participantes)) return await sock.sendMessage(jid, { text: respostaAutoexpulsao() }, { quoted: msg });

      let alvoRemocao = alvo;
      if (selecionado.digitado) {
        const membro = await identificar(participantes || [], jidReal);
        alvoRemocao = membro.participante?.id || null;
      }
      // Sem awaits entre leitura, deduplicação e escrita do mesmo JSON.
      const listaAtual = lerBlacklist();

      if (listaAtual.includes(alvoLimpo)) {
        return await sock.sendMessage(jid, {
          text: '💀 Este espírito já jaz aprisionado na lista negra de Hipnos.'
        }, { quoted: msg });
      }

      listaAtual.push(alvoLimpo);

      salvarBlacklist(listaAtual);

      // Tenta remover o alvo do grupo atual
      try {
        if (jid.endsWith('@g.us') && alvoRemocao) await sock.groupParticipantsUpdate(jid, [alvoRemocao], 'remove');
      } catch (e) {
        console.warn('[addblacklist] Remoção no grupo não concluída; cadastro mantido.');
      }

      await sock.sendMessage(jid, {
        text: `✅ Número ${alvoLimpo} adicionado à lista negra de Hipnos.`
      }, { quoted: msg });

    } catch (err) {
      console.warn('[addblacklist] Operação não concluída.');
      await sock.sendMessage(jid, { text: '⚠️ Não consegui concluir o cadastro. Confira o armazenamento e a identificação do alvo.' }, { quoted: msg }).catch(() => {});
    }
  }
};
