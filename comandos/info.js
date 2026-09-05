// ============================================
// 🌙 INFO — Pergaminho de identidade do bot (uso LIVRE)
// ============================================
// Mostra as informações gerais do bot: nome, versão, quantidade de
// comandos disponíveis (contada dinamicamente do registro do loader),
// tempo online (uptime do processo) e em quantos grupos o bot está.
//
// Uso LIVRE: qualquer pessoa pode chamar /info — sem checagem de dono ou
// admin, no mesmo espírito do /ping, /menu e /dono.
// ============================================

const fs = require('fs')
const path = require('path')

const { RODAPE_MENU, VERSAO_BOT } = require('../config')

const NOME_BOT = 'Hipnos Bot'

// ─── 📚 Contagem de comandos ───
// 1ª fonte: o registro dos comandos carregados pelo loader (comandos-registry.js,
// preenchido pelo bot.js). É exatamente o que o roteador responde — inclusive
// os aliases (ex.: /flip e /brincadeira contam como comandos próprios).
// 2ª fonte (fallback): varre a pasta de comandos com a MESMA regra do loader
// (arquivo .js que exporta nome + executar), caso o registro esteja vazio.
function contarComandos() {
  try {
    const { comandos } = require('../comandos-registry')
    if (comandos && comandos.size > 0) return comandos.size
  } catch (err) {
    // Registro indisponível — segue para o plano B.
  }

  let total = 0
  const varrer = (pasta) => {
    for (const item of fs.readdirSync(pasta)) {
      const caminho = path.join(pasta, item)
      if (fs.statSync(caminho).isDirectory()) {
        varrer(caminho)
      } else if (item.endsWith('.js')) {
        try {
          const comando = require(caminho)
          if (comando && comando.nome && comando.executar) total += 1
        } catch (err) {
          // Arquivo quebrado não conta — o loader também não o carregaria.
        }
      }
    }
  }

  try {
    varrer(__dirname)
  } catch (err) {
    return null
  }
  return total > 0 ? total : null
}

// ─── ⏳ Uptime do processo (desde que o bot subiu) ───
function formatarUptime(segundos) {
  const dias = Math.floor(segundos / 86400)
  const horas = Math.floor((segundos % 86400) / 3600)
  const minutos = Math.floor((segundos % 3600) / 60)
  const resto = Math.floor(segundos % 60)

  const partes = []
  if (dias) partes.push(`${dias}d`)
  if (horas) partes.push(`${horas}h`)
  if (minutos) partes.push(`${minutos}m`)
  partes.push(`${resto}s`)
  return partes.join(' ')
}

// ─── 👥 Quantidade de grupos em que o bot participa ───
// O Baileys expõe sock.groupFetchAllParticipating() (todos os grupos da
// sessão). Se a consulta falhar (instabilidade/sem conexão), mostramos
// "Indisponível" em vez de quebrar o comando.
async function contarGrupos(sock) {
  try {
    const grupos = await sock.groupFetchAllParticipating()
    return Object.keys(grupos || {}).length
  } catch (err) {
    return null
  }
}

module.exports = {
  nome: 'info',
  descricao: 'Mostra as informações do bot: versão, comandos disponíveis, tempo online e grupos.',

  async executar(sock, jid, msg) {
    try {
      const totalComandos = contarComandos()
      const uptime = formatarUptime(process.uptime())
      const grupos = await contarGrupos(sock)

      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║      🌙 𝐈𝐍𝐅𝐎 𝐃𝐎 𝐁𝐎𝐓 🌙      ║
╚══════════════════════════════╝

🌑 O pergaminho de identidade de Hipnos.

🤖 Nome: ${NOME_BOT}
🔖 Versão: v${VERSAO_BOT}
📚 Comandos disponíveis: ${totalComandos ?? 'Indisponível'}
⏳ Tempo online: ${uptime}
👥 Grupos: ${grupos === null ? 'Indisponível (as sombras não responderam agora)' : `${grupos} recinto${grupos === 1 ? '' : 's'}`}
⚙️ Node.js: ${process.version}

(Uso livre — qualquer mortal pode consultar este pergaminho.)

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o info:", err);
    }
  }
};
