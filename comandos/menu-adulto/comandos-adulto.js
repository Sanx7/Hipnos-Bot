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
//
// 📹 ENVIO DE MÍDIA: .mp4 vai como video+gifPlayback; .gif é convertido
// para .mp4 via ffmpeg em processo filho (igual ao acoes.js) e enviado
// como video+gifPlayback. Motivo: GIF cru enviado como `image` passa pelo
// sharp interno da Baileys p/ gerar thumbnail e o libvips cospe
// "GLib-GObject-CRITICAL ... cannot retrieve class for invalid
// (unclassed) type '<invalid>'" — o GIF chega quebrado/não anima. Em MP4
// com gifPlayback o WhatsApp anima liso. Falhas de conversão nunca enviam
// GIF bruto como MP4: o comando apresenta seu aviso de indisponibilidade.
// =========================================================================

const CONFIGURACOES = require('../../dados/comandos-adulto');
const envioAnimacoes = require('../../func/animacoes-locais');

// Tenta carregar o helper do /modoadulto.
// Se ainda não existir, bloqueia por segurança.
let modoAdultoAtivo;

try {
  ({ modoAdultoAtivo } = require('../../modoadulto'));
} catch (e) {
  modoAdultoAtivo = async () => false;
}

// Aceita somente JIDs de pessoas; o sufixo de dispositivo não muda a identidade.
function normalizarPessoa(jid) {
  if (typeof jid !== 'string') return null;
  const partes = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(jid);
  return partes ? `${partes[1]}@${partes[2]}` : null;
}

// Descobre um alvo explícito diferente do autor, mantendo prioridade da menção.
function acharAlvo(msg, autorJid) {
  const contexto =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    {};

  // participantAlt é o identificador alternativo informado pela própria mensagem.
  // PN e LID não são comparados pelos dígitos.
  const autores = new Set([autorJid, msg.key?.participantAlt, msg.participant]
    .map(normalizarPessoa).filter(Boolean));
  const valido = jid => {
    const pessoa = normalizarPessoa(jid);
    return pessoa && !autores.has(pessoa) ? pessoa : null;
  };
  const mencionados = Array.isArray(contexto.mentionedJid) ? contexto.mentionedJid : [];
  for (const jid of mencionados) {
    const alvo = valido(jid);
    if (alvo) return alvo;
  }

  // participant isolado não comprova que há uma mensagem respondida.
  if (contexto.quotedMessage && typeof contexto.quotedMessage === 'object') {
    return valido(contexto.participant);
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

        // Quem executou o comando
        const autorJid =
          msg.key.participant ||
          msg.participant ||
          msg.key.remoteJid;

        // Quem foi mencionado/respondido
        const alvoJid = acharAlvo(msg, autorJid);

        // Monta a legenda
        //
        // Somente com alvo válido, usa "frase":
        // [autor] -> quem executou
        // [alvo]  -> quem foi mencionado/respondido
        //
        // Sem alvo válido, utiliza exclusivamente a legenda configurada.
        let legendaFinal = config.legenda || undefined;
        let mentions = [];

        if (alvoJid && config.frase) {
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

        // O helper sorteia entre os arquivos existentes e converte GIF antes do envio.
        await envioAnimacoes.enviarAnimacao(sock, jid, config.gifs, {
          text: legendaFinal,
          mentions: mentions.length ? mentions : undefined,
        }, opcoesEnvio, { fallbackTexto: false });
      } catch (erro) {
        console.warn('[comandos-adulto]', { evento: 'animacao_indisponivel' });

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
