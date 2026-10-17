const fs = require('fs');
const path = require('path');

// Configuração global do bot (helpers de dono — verificação PROOF-LID)
const { limparNumero, ehDonoDoBot } = require('../../config');

// 🪪 Resolução LID→número real (menção/reply pode chegar como "@lid")
const { resolverNumeroAlvo } = require('../../lid');
const { obterAlvoBlacklist } = require('../../dados/blacklist-alvo');
const { obterPrefixo } = require('../../prefixo');

// Caminho corrigido apontando para comandos/dados
const BANCO_BLACKLIST = path.join(__dirname, '..', 'dados', 'blacklist.json');

function lerBlacklist() {
  try {
    if (!fs.existsSync(BANCO_BLACKLIST)) {
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
  nome: 'remblacklist',
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
          console.warn('[remblacklist] Metadados indisponíveis.');
        }
      }
      if (!ehDonoDoBot(participantes, sender)) {
        return await sock.sendMessage(jid, {
          text: '🌑 Hipnos recusa sua invocação... você não possui domínio sobre a lista de sombras.'
        }, { quoted: msg });
      }

      const alvo = obterAlvoBlacklist(msg, text)?.jid;

      if (!alvo) {
        return await sock.sendMessage(jid, {
          text: `⚠️ Mencione a pessoa, responda à mensagem dela ou use ${await obterPrefixo()}remblacklist <número internacional>.\nExemplos: 55139757976987 ou +55 (13) 97579-76987.\nInforme um único número, com DDI e DDD (10–15 dígitos).`
        }, { quoted: msg });
      }

      // 🪪 RESOLUÇÃO LID→NÚMERO REAL (lid.js): a menção/reply pode chegar como
      // "@lid" enquanto o JSON guarda o número REAL — sem resolver, o indexOf
      // falhava e o perdão nunca saía. Também remove a variante LID legada do
      // JSON, se existir (higiene: o mesmo alvo não fica duplicado na lista).
      const resolucao = await resolverNumeroAlvo(participantes, alvo);
      const alvoBrutoLimpo = limparNumero(alvo);
      const variantes = [...new Set([resolucao.numero, alvoBrutoLimpo].filter(Boolean))];
      const listaAtual = lerBlacklist();

      // Remove TODAS as variantes presentes do mesmo alvo
      let removidos = 0;
      for (const variante of variantes) {
        let index;
        while ((index = listaAtual.indexOf(variante)) !== -1) {
          listaAtual.splice(index, 1);
          removidos += 1;
        }
      }

      if (removidos === 0) {
        return await sock.sendMessage(jid, {
          text: '💀 Este espírito não foi encontrado nas profundezas do limbo.'
        }, { quoted: msg });
      }

      if (removidos > 1) {
        console.log('[remblacklist] Variantes legadas removidas.');
      }

      salvarBlacklist(listaAtual);

      return await sock.sendMessage(jid, {
        text: `✅ Número ${resolucao.numero || alvoBrutoLimpo} removido da lista negra de Hipnos.`
      }, { quoted: msg });

    } catch (err) {
      console.warn('[remblacklist] Operação não concluída.');
      await sock.sendMessage(jid, { text: '⚠️ Não consegui concluir a remoção. Confira o armazenamento e a identificação do alvo.' }, { quoted: msg }).catch(() => {});
    }
  }
};
