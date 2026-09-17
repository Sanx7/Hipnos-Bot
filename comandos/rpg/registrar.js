// ============================================================
// 🪪 REGISTRAR — Identidade do jogador no RPG (Fase 1)
// ============================================================
// Uso: /registrar <nome> <gênero>     (ex.: "/registrar João M")
//
// Regras:
//   - Nome: 2 a 20 caracteres (após juntar as palavras do argumento)
//   - Gênero: aceita m/M/masculino → "M" | f/F/feminino → "F" (flexível);
//     é o ÚLTIMO token da mensagem, então nomes com espaço funcionam
//     (ex.: "/registrar Maria Silva F")
//   - Já registrado (nome preenchido): permite TROCAR livremente e sem
//     burocracia — a confirmação avisa explicitamente que era uma
//     ATUALIZAÇÃO e mostra o registro anterior (decisão documentada:
//     como as chamadas são indistinguíveis, toda chamada válida gravada
//     num jogador já registrado substitui o registro e diz isso).
//
// Persistência: rpg/database.js (getPlayer auto-cria o jogador na 1ª
// interação; savePlayer grava). Nenhum JSON local.
// ============================================================

const { getPlayer, savePlayer } = require('../../rpg/database')

// 🔒 Limites do nome (evita nome vazio/absurdamente longo)
const NOME_MIN = 2
const NOME_MAX = 20

// 🚻 Mapa flexível de gêneros aceitos → valor canônico gravado no banco
const GENEROS_ACEITOS = {
  m: 'M',
  masculino: 'M',
  f: 'F',
  feminino: 'F'
}

module.exports = {
  nome: 'registrar',
  descricao: 'Registra sua identidade no RPG. Uso: /registrar <nome> <M ou F>',

  async executar(sock, jid, msg, texto) {
    try {
      // 👤 JID do remetente (mesma convenção do testrpg)
      const sender = msg.key?.participant || msg.key?.remoteJid || jid

      // ✂️ Parse: "/registrar <nome...> <gênero>" — o gênero é o ÚLTIMO
      // token, o nome é todo o resto (nomes com espaço funcionam).
      const partes = String(texto || '').trim().split(/\s+/)
      const args = partes.slice(1)
      const generoBruto = args.pop()
      const nome = args.join(' ').trim()

      // 🚫 Validações ANTES de tocar no banco (mensagens de uso explícitas)
      if (!nome || !generoBruto) {
        return await sock.sendMessage(jid, {
          text:
            '🪪 *Como se registrar no mundo onírico:*\n\n' +
            '`/registrar <nome> <M ou F>`\n\n' +
            '✏️ Exemplos: `/registrar João M` • `/registrar Maria F`\n' +
            `(nome de ${NOME_MIN} a ${NOME_MAX} caracteres — gênero aceita ` +
            '`m`, `M`, `masculino`, `f`, `F`, `feminino`)'
        }, { quoted: msg })
      }

      const genero = GENEROS_ACEITOS[String(generoBruto).toLowerCase()]
      if (!genero) {
        return await sock.sendMessage(jid, {
          text:
            `🚻 *Gênero inválido:* "${generoBruto}"\n\n` +
            'Aceito apenas `M`/`masculino` ou `F`/`feminino`.\n' +
            'Ex.: `/registrar João M`'
        }, { quoted: msg })
      }

      if (nome.length < NOME_MIN || nome.length > NOME_MAX) {
        return await sock.sendMessage(jid, {
          text:
            `📏 *Nome fora dos limites do sonho.*\n\n` +
            `Ele precisa ter entre *${NOME_MIN} e ${NOME_MAX} caracteres* ` +
            `(você mandou com ${nome.length}). Tente de novo: \`/registrar <nome> <M ou F>\``
        }, { quoted: msg })
      }

      // 💾 Lê/cria o jogador (getPlayer auto-cria com padrões) e grava a
      // identidade. O _id vem do findOne do Mongo e NÃO pode ir no $set
      // (campo imutável) — por isso é removido antes do savePlayer.
      const jogador = await getPlayer(sender)
      const registroAnterior = jogador.nome
      const { _id, ...dadosSemId } = jogador

      await savePlayer(jogador.jid, {
        ...dadosSemId,
        nome,
        genero
      })

      // 💬 Confirmação — gênero ajusta vindo/vinda
      const saudacao = genero === 'F' ? 'Bem-vinda' : 'Bem-vindo'
      const pronomePossessivo = genero === 'F' ? 'sua' : 'seu'

      if (registroAnterior) {
        // 🔁 Já registrado: troca livre, mas avisa que era atualização
        await sock.sendMessage(jid, {
          text:
            `🔄 *Registro ATUALIZADO!*\n\n` +
            `Você já tinha um registro (${registroAnterior}) — troquei livremente, ` +
            `como pedido, sem burocracia.\n\n` +
            `🪪 Nome: *${nome}*\n` +
            `🚻 Gênero: *${genero === 'F' ? 'F (feminino)' : 'M (masculino)'}*\n\n` +
            `${saudacao} de volta, *${nome}*! Use /ficha pra conferir ${pronomePossessivo} ficha. 🌙`
        }, { quoted: msg })
      } else {
        await sock.sendMessage(jid, {
          text:
            `🪪 *REGISTRO CONCLUÍDO*\n\n` +
            `${saudacao} ao RPG, *${nome}*! 🌙\n\n` +
            `🚻 Gênero: *${genero === 'F' ? 'F (feminino)' : 'M (masculino)'}*\n\n` +
            `Sua jornada no mundo onírico começa agora. Use /ficha para ver ${pronomePossessivo} ` +
            `ficha a qualquer momento. 💤`
        }, { quoted: msg })
      }
    } catch (err) {
      // 🛡️ Mesma rede de segurança do testrpg: loga e avisa com calma
      console.error('[registrar] 💥 erro ao gravar o registro do RPG:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não consegui gravar seu registro no reino dos sonhos agora.*\n\nO banco de dados do RPG não respondeu — tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
