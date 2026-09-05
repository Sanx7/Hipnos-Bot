// ============================================
// 👤 PERFIL — Pergaminho de identidade de um mortal (uso LIVRE)
// ============================================
// Mostra o perfil do AUTOR do comando (ou de uma pessoa @mencionada):
//   - Nome e número (resolvendo LID -> phoneNumber nos metadados do grupo)
//   - Foto de perfil via sock.profilePictureUrl (se falhar — 404/privacidade —
//     avisa "nenhuma foto pública" em vez de quebrar o comando)
//   - Cargo no grupo (dono/admin/membro), quando usado dentro de um grupo
//   - 📊 Se o banco do /ranking existir: POSIÇÃO no ranking do grupo atual
//     e TOTAL de mensagens enviadas — busca LID-safe (tenta o id do
//     participante, o phoneNumber e o JID bruto, a mesma normalização
//     usada pelo bot ao gravar as mensagens)
// Sem estatísticas registradas? Mostra os dados básicos mesmo assim.
// Uso LIVRE: qualquer pessoa pode chamar /perfil (sem checagem de dono/admin).
// ============================================

const { formatarNumero, acharParticipante, RODAPE_MENU } = require('../config')
const { buscarEstatisticasUsuario, normalizarId } = require('../database')

// Cargo legível do participante no grupo (null quando fora de grupo)
function cargoDoParticipante(participante) {
  if (!participante) return null
  if (participante.admin === 'superadmin') return '👑 Dono(a) do grupo'
  if (participante.admin === 'admin') return '🛡️ Administrador(a)'
  return '👤 Membro'
}

// Seção de estatísticas do card (null quando fora de grupo)
function secaoEstatisticas(estatisticas, bancoIndisponivel, emGrupo) {
  if (!emGrupo) return null

  if (estatisticas) {
    const palavra = estatisticas.total > 1 ? 'mensagens' : 'mensagem'
    return (
      `🏆 Posição no ranking: *#${estatisticas.posicao} de ${estatisticas.totalUsuarios} ranqueados*\n` +
      `💬 Mensagens registradas: *${estatisticas.total}* ${palavra}`
    )
  }

  if (bancoIndisponivel) {
    return '📊 Estatísticas: indisponíveis no momento (banco do ranking desativado).'
  }

  return '🌑 *Ainda sem ecos neste recinto* — nenhuma mensagem registrada aqui até agora.'
}

module.exports = {
  nome: 'perfil',
  descricao: 'Mostra o perfil do autor (ou de um @mencionado): foto, número, cargo e ranking do grupo.',

  async executar(sock, jid, msg) {
    try {
      const emGrupo = jid.endsWith('@g.us')
      const sender = msg.key.participant || msg.key.remoteJid

      // 1) Alvo: @menção (se houver) OU o próprio autor da mensagem
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo
      const alvoJid = contextInfo?.mentionedJid?.[0] || sender

      // 2) Metadados do grupo (quando em grupo): resolve phoneNumber (LID) e cargo
      let participantes = []
      if (emGrupo) {
        try {
          participantes = (await sock.groupMetadata(jid)).participants || []
        } catch (err) {
          // Sem metadados o perfil continua funcionando (só perde cargo/telefone)
          console.error('[perfil] Sem metadados do grupo:', err?.message || err)
        }
      }
      const participante = acharParticipante(participantes, alvoJid)

      // 3) Número de EXIBIÇÃO: prefere o phoneNumber real (resolução de LID)
      const digitosExibicao =
        normalizarId(participante?.phoneNumber) ||
        normalizarId(participante?.id) ||
        normalizarId(alvoJid)

      // 4) Autor? (o pushName da mensagem só serve para o próprio autor)
      const ehAutor = normalizarId(alvoJid) === normalizarId(sender)

      // 5) Estatísticas do /ranking — LID-safe: tenta o id do participante,
      //    o phoneNumber e o JID bruto (mesma normalização do bot ao gravar)
      let estatisticas = null
      let bancoIndisponivel = false
      if (emGrupo) {
        const candidatos = [
          ...new Set([
            normalizarId(participante?.id),
            normalizarId(participante?.phoneNumber),
            normalizarId(alvoJid)
          ].filter(Boolean))
        ]

        for (const candidato of candidatos) {
          let e = null
          try {
            e = buscarEstatisticasUsuario(jid, candidato)
          } catch (errBanco) {
            // Banco corrompido/inacessível -> não derruba o /perfil
            console.error('[perfil] Banco do ranking indisponível:', errBanco?.message || errBanco)
          }
          if (!e) {
            bancoIndisponivel = true
            continue
          }
          if (e.total > 0) {
            estatisticas = e
            break
          }
        }
      }

      // 6) Nome: pushName do autor; para mencionados, o nome gravado no banco; senão, o número
      const nomeExibicao =
        (ehAutor && msg.pushName) ||
        estatisticas?.nome ||
        formatarNumero(digitosExibicao)

      // 7) Foto de perfil (se o WhatsApp tiver e a privacidade permitir)
      let fotoUrl = null
      try {
        fotoUrl = await sock.profilePictureUrl(participante?.id || alvoJid, 'image')
      } catch (err) {
        // 404 (sem foto) ou bloqueio de privacidade -> segue sem foto
      }

      // 8) Monta o card
      const cargo = cargoDoParticipante(participante)
      // "saiu do grupo" só quando temos a lista COMPLETA de participantes
      const saiuDoGrupo = emGrupo && participantes.length > 0 && !participante && estatisticas

      const linhas = [
        '╔══════════════════════════════╗',
        '║     👤 𝐏𝐄𝐑𝐅𝐈𝐋 𝐍𝐎 𝐋𝐈𝐌𝐁𝐎 👤     ║',
        '╚══════════════════════════════╝',
        '',
        '🌑 A identidade deste mortal, revelada pelas sombras:',
        '',
        `🪪 *Nome:* ${nomeExibicao}`,
        `🔢 *Número:* ${formatarNumero(digitosExibicao)}`
      ]
      if (cargo) linhas.push(`⚔️ *Cargo:* ${cargo}`)
      if (saiuDoGrupo) linhas.push('🚪 *(não está mais neste grupo)*')
      linhas.push(
        `📸 *Foto:* ${fotoUrl ? 'acima 👆' : 'nenhuma foto pública disponível'}`,
        ''
      )

      const rankingTexto = secaoEstatisticas(estatisticas, bancoIndisponivel, emGrupo)
      if (rankingTexto) {
        linhas.push('════════════════════', '📊 ECOOS NO RECINTO', '', rankingTexto, '')
      }

      linhas.push(
        '(Uso livre — qualquer mortal pode consultar um perfil.)',
        '',
        '════════════════════',
        '',
        RODAPE_MENU
      )
      const card = linhas.join('\n')

      // 9) Envia: com a foto (imagem + legenda) ou só o texto
      if (fotoUrl) {
        await sock.sendMessage(jid, { image: { url: fotoUrl }, caption: card }, { quoted: msg })
      } else {
        await sock.sendMessage(jid, { text: card }, { quoted: msg })
      }
    } catch (err) {
      console.error('[perfil] Erro inesperado:', err?.message || err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras não conseguiram revelar este perfil... Tente novamente.'
      }, { quoted: msg })
    }
  }
};
