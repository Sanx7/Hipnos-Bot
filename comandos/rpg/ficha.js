// ============================================================
// 📜 FICHA — Ficha do jogador no RPG (Fase 1)
// ============================================================
// Uso: /ficha (alias: /rpgperfil)
//
// 📌 NOME ESCOLHIDO: "ficha" — o /perfil JÁ EXISTE no projeto para outra
// coisa (perfil WhatsApp/ranking, comandos/perfil.js), então a ficha do
// RPG usa /ficha. O alias /rpgperfil fica registrado p/ quem escrever
// "perfil do rpg" sem pensar.
//
// DECISÃO DE DESIGN (documentada): se o jogador AINDA NÃO se registrou
// (nome === null), a ficha NÃO é recusada — mostramos uma "ficha
// provisória" com os dados padrão que já existem (idade 18, carteira 0,
// etc.) e um convite educado ao /registrar. Motivo: recusar exige uma
// etapa extra só pra ler dados públicos; mostrar a provisória + convite
// acolhe melhor e ensina o comando no mesmo lugar.
//
// Persistência: apenas leitura via getPlayer (rpg/database.js).
// ============================================================

const { getPlayer } = require('../../rpg/database')
// 🪪 Resolução LID→número real (lid.js — mesmo módulo do /darvip)
const { resolverNumeroAlvo } = require('../../lid')
// 💰 Formatação de dinheiro unificada com a Fase 2 (R$ 1.234,56)
const { formatarReais } = require('../../rpg/economia')

// 📝 Uma barra temática p/ separar seções (estilo onírico do projeto)
const LINHA = '━━━━━━━━━━━━━━━━━━━'

module.exports = {
  nome: 'ficha',
  aliases: ['rpgperfil'],
  descricao: 'Mostra sua ficha do RPG: nome, idade, carteira, banco, emprego, fama, fome e energia.',

  async executar(sock, jid, msg) {
    try {
      // 👤 JID do remetente (mesma convenção do testrpg)
      let sender = msg.key?.participant || msg.key?.remoteJid || jid

      // 🪪 RESOLUÇÃO LID→NÚMERO REAL (lid.js — mesmo padrão do /darvip):
      // o remetente pode chegar como "@lid"; consultar o jogador por LID
      // quebra a base indexada por telefone (MESMO bug dos VIPs).
      // Grupo → metadados (phoneNumber); privado → mapeamento da sessão.
      // Sem resolução possível, segue com o LID cru + warning no log
      // (scripts/migrar-rpg-lid.js corrige os registros depois — idempotente).
      if (String(sender).endsWith('@lid')) {
        let participantes = null
        if (jid.endsWith('@g.us')) {
          try {
            participantes = (await sock.groupMetadata(jid)).participants
          } catch (err) {
            console.error('[ficha] sem metadados do grupo p/ resolver @lid:', err?.message || err)
          }
        }
        const resolucao = await resolverNumeroAlvo(participantes, sender)
        if (resolucao.numero && resolucao.via !== null) {
          console.log(`[ficha] 🪪 remetente resolvido de @lid p/ o número real ${resolucao.numero} via ${resolucao.via}`)
          sender = resolucao.numero
        } else {
          console.warn('[ficha] 🪪 @lid do remetente não resolvível — seguindo com o LID cru (corrigível via scripts/migrar-rpg-lid.js)')
        }
      }

      // 🔎 getPlayer cria o jogador com os padrões na 1ª interação
      const jogador = await getPlayer(sender)

      const registrado = Boolean(jogador.nome)

      // 💰 Dinheiro formatado pt-BR (ex.: "R$ 1.234")
      const carteira = Number(jogador.carteira) || 0
      const banco = Number(jogador.banco) || 0

      // 📊 Barrinhas de status (fome/energia) em blocos: 10 blocos = 100%
      const barra = (valor) => {
        const v = Math.max(0, Math.min(100, Number(valor) || 0))
        const cheios = Math.round(v / 10)
        return `${'🟩'.repeat(cheios)}${'⬜'.repeat(10 - cheios)} ${v}/100`
      }

      const cabecalho = registrado
        ? `🌙 *FICHA ONÍRICA — ${jogador.nome}* 🌙`
        : `🌙 *FICHA PROVISÓRIA (sem registro)* 🌙`

      const avisoRegistro = registrado
        ? ''
        : (
          `⚠️ *Você ainda não se registrou.*\n` +
          'Esta é a sua ficha provisória com os valores iniciais.\n\n' +
          '🪪 Para criar sua identidade: `/registrar <nome> <M ou F>`\n' +
          '   Ex.: `/registrar João M` • `/registrar Maria F`\n\n'
        )

      await sock.sendMessage(jid, {
        text:
          `${cabecalho}\n${LINHA}\n\n` +
          avisoRegistro +
          `🪪 Nome: *${registrado ? jogador.nome : '—'}*\n` +
          `🚻 Gênero: ${jogador.genero === 'F' ? 'F (feminino)' : jogador.genero === 'M' ? 'M (masculino)' : '— (defina no /registrar)'}\n` +
          `🎂 Idade: *${jogador.idade ?? '?'} anos*\n` +
          `💼 Emprego: ${jogador.emprego ? `*${jogador.emprego}* (cargo ${jogador.cargo})` : '*sem emprego*'}\n\n` +
          `💵 Carteira: *${formatarReais(carteira)}*\n` +
          `🏦 Banco: *${formatarReais(banco)}*\n` +
          `⭐ Fama: *${Number(jogador.fama) || 0}*\n\n` +
          `🍽️ Fome: ${barra(jogador.fome)}\n` +
          `⚡ Energia: ${barra(jogador.energia)}\n\n` +
          `${LINHA}\n` +
          `💤 *Hipnos observa seus sonhos... e anota cada passo.*`
      }, { quoted: msg })
    } catch (err) {
      // 🛡️ Mesma rede de segurança do testrpg
      console.error('[ficha] 💥 erro ao ler a ficha do RPG:', err?.stack || err)
      await sock.sendMessage(jid, {
        text: '⚠️ *Não consegui abrir sua ficha no reino dos sonhos agora.*\n\nO banco de dados do RPG não respondeu — tente novamente em instantes.'
      }, { quoted: msg }).catch(() => {})
    }
  }
}
