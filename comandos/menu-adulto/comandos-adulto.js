// =========================================================================
// comandos/menu-adulto/comandos-adulto.js
// -------------------------------------------------------------------------
// Lê dados/comandos-adulto.js e cria os comandos automaticamente.
// Suporta frases com:
//   [autor] -> menciona quem executou o comando
//   [alvo]  -> menciona quem foi marcado/respondido
//
// Exemplos:
//
// frase: '[autor] deu um soco 👊'
// frase: '[autor] deu um tapa em [alvo] 👋'
//
// O alvo pode ser:
// - alguém mencionado no comando
// - alguém cuja mensagem foi respondida
// =========================================================================

const fs = require('fs');
const path = require('path');

const CONFIGURACOES = require('../../dados/comandos-adulto');

// Tenta carregar o helper do /modoadulto.
// Se ainda não existir, bloqueia por segurança.
let modoAdultoAtivo;

try {
  ({ modoAdultoAtivo } = require('../../modoadulto'));
} catch (e) {
  modoAdultoAtivo = async () => false;
}

// Raiz do projeto
const RAIZ_PROJETO = path.join(__dirname, '..', '..');

function sortearGif(gifs) {
  return gifs[Math.floor(Math.random() * gifs.length)];
}

function extensaoDoArquivo(caminho) {
  return path.extname(caminho).replace('.', '').toLowerCase();
}

// Descobre quem foi mencionado ou quem é o dono da mensagem respondida.
function acharAlvo(msg) {
  const contexto =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    {};

  // Pessoa mencionada no comando
  if (contexto.mentionedJid && contexto.mentionedJid.length > 0) {
    return contexto.mentionedJid[0];
  }

  // Pessoa cuja mensagem foi respondida
  if (contexto.participant) {
    return contexto.participant;
  }

  return null;
}

// Substitui os marcadores da frase pelas menções reais.
function montarLegenda(frase, autorJid, alvoJid) {
  if (!frase) {
    return {
      legenda: undefined,
      mentions: [],
    };
  }

  const autor = `@${autorJid.split('@')[0]}`;

  let legenda = frase
    .replace(/\[autor\]/gi, autor)
    .replace(/\{autor\}/gi, autor);

  const mentions = [autorJid];

  // Só substitui [alvo] se realmente existir um alvo.
  if (alvoJid) {
    const alvo = `@${alvoJid.split('@')[0]}`;

    legenda = legenda
      .replace(/\[alvo\]/gi, alvo)
      .replace(/\{alvo\}/gi, alvo);

    mentions.push(alvoJid);
  } else {
    // Se não existe alvo, remove o marcador para não ficar "[alvo]"
    legenda = legenda
      .replace(/\[alvo\]/gi, '')
      .replace(/\{alvo\}/gi, '');
  }

  return {
    legenda: legenda.trim(),
    mentions,
  };
}

function criarComando(config) {
  return {
    nome: config.nome,
    aliases: config.aliases || [],
    categoria: 'adulto',
    descricao: config.legenda || config.frase || `Comando ${config.nome}`,

    async executar(sock, jid, msg) {
      try {
        // Só funciona em grupos
        if (!jid.endsWith('@g.us')) {
          await sock.sendMessage(
            jid,
            {
              text: '⚠️ Esse comando só funciona dentro de grupos.',
            },
            { quoted: msg }
          );
          return;
        }

        // Verifica modo adulto
        const ligado = await modoAdultoAtivo(jid);

        if (!ligado) {
          await sock.sendMessage(
            jid,
            {
              text:
                `🔞 O comando /${config.nome} só funciona com o *modo adulto* ligado neste grupo.\n` +
                `Um admin pode ativar com /modoadulto ligar.`,
            },
            { quoted: msg }
          );
          return;
        }

        // Verifica se existem mídias
        if (!config.gifs || config.gifs.length === 0) {
          await sock.sendMessage(
            jid,
            {
              text:
                `⚠️ O comando /${config.nome} ainda não tem nenhum gif ` +
                `configurado em dados/comandos-adulto.js.`,
            },
            { quoted: msg }
          );
          return;
        }

        // Sorteia a mídia
        const caminhoRelativo = sortearGif(config.gifs);
        const caminhoCompleto = path.join(
          RAIZ_PROJETO,
          caminhoRelativo
        );

        // Verifica se o arquivo existe
        if (!fs.existsSync(caminhoCompleto)) {
          console.error(
            `[comandos-adulto] arquivo não encontrado: ${caminhoCompleto}`
          );

          await sock.sendMessage(
            jid,
            {
              text:
                `⚠️ Não encontrei o arquivo de mídia do /${config.nome} ` +
                `no servidor. Confira se ele foi enviado (git push) certinho.`,
            },
            { quoted: msg }
          );

          return;
        }

        const buffer = fs.readFileSync(caminhoCompleto);
        const ext = extensaoDoArquivo(caminhoCompleto);

        // Quem executou o comando
        const autorJid =
          msg.key.participant ||
          msg.participant ||
          msg.key.remoteJid;

        // Quem foi mencionado/respondido
        const alvoJid = acharAlvo(msg);

        // Monta a legenda
        //
        // Se existir "frase", usa:
        // [autor] -> quem executou
        // [alvo]  -> quem foi mencionado/respondido
        //
        // Se não existir "frase", usa a legenda antiga.
        let legendaFinal = config.legenda || undefined;
        let mentions = [];

        if (config.frase) {
          const resultado = montarLegenda(
            config.frase,
            autorJid,
            alvoJid
          );

          legendaFinal = resultado.legenda;
          mentions = resultado.mentions;
        }

        const opcoesEnvio = {
          quoted: msg,
        };

        // MP4
        if (ext === 'mp4') {
          await sock.sendMessage(
            jid,
            {
              video: buffer,
              gifPlayback: true,
              caption: legendaFinal,
              mentions: mentions.length
                ? mentions
                : undefined,
            },
            opcoesEnvio
          );
        }

        // GIF / imagem
        else {
          await sock.sendMessage(
            jid,
            {
              image: buffer,
              caption: legendaFinal,
              mentions: mentions.length
                ? mentions
                : undefined,
            },
            opcoesEnvio
          );
        }
      } catch (erro) {
        console.error(
          `[comandos-adulto] erro no /${config.nome}:`,
          erro.message
        );

        try {
          await sock.sendMessage(
            jid,
            {
              text:
                `⚠️ Não consegui enviar o gif do /${config.nome} agora. ` +
                `Tente de novo mais tarde.`,
            },
            { quoted: msg }
          );
        } catch (_) {}
      }
    },
  };
}

module.exports = CONFIGURACOES.map(criarComando);