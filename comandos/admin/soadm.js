// ============================================
// ⚙️ SOADM — Modo Somente Admin (Restrição Real)
// ============================================
// Alterna o "modo somente admin" PARA O GRUPO ATUAL:
//   - ATIVO   -> apenas administradores do grupo (e o dono do bot) usam os comandos
//   - INATIVO -> qualquer membro usa os comandos
//
// Uso:
//   /soadm    -> alterna (liga se desligado, desliga se ligado)  [comportamento padrão]
//   /soadm 1  -> força ativação
//   /soadm 0  -> força desativação
//
// Persistência: o estado fica salvo em comandos/dados/antias.json, na chave
// `onlyAdmin` (uma lista de grupo_id). Assim não reseta quando o bot reinicia
// e cada grupo tem o SEU estado (nunca afeta outros grupos).
// ============================================

const fs = require('fs')
const path = require('path')

// Configuração global do bot (lista de donos + helpers de admin)
const { OWNER_NUMBERS, limparNumero, ehAdminDoGrupo } = require('../../config')

// Arquivo onde ficam salvos os modos restritos (mesmo banco dos antix)
const BANCO_CONFIG = path.join(__dirname, '..', 'dados', 'antias.json')

// Lê as configurações persistidas, garantindo que a chave `onlyAdmin` exista
function lerConfiguracoes() {
  try {
    const pastaDados = path.dirname(BANCO_CONFIG)
    if (!fs.existsSync(pastaDados)) {
      fs.mkdirSync(pastaDados, { recursive: true })
    }
    if (!fs.existsSync(BANCO_CONFIG)) {
      const padrao = { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [], onlyAdmin: [] }
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2))
      return padrao
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8')
    const json = JSON.parse(dados)
    if (!Array.isArray(json.onlyAdmin)) json.onlyAdmin = []
    return json
  } catch (err) {
    console.error('Erro ao ler antias.json:', err)
    return { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [], onlyAdmin: [] }
  }
}

// Salva as configurações de volta no arquivo
function salvarConfiguracoes(config) {
  try {
    fs.writeFileSync(BANCO_CONFIG, JSON.stringify(config, null, 2))
  } catch (err) {
    console.error('Erro ao salvar antias.json:', err)
  }
}

module.exports = {
  nome: 'soadm',
  descricao: 'Ativa/desativa o modo somente admin para este grupo.',

  async executar(sock, jid, msg, text) {
    try {
      // 1) Só funciona dentro de grupos
      if (!jid.endsWith('@g.us')) {
        return await sock.sendMessage(jid, {
          text: '⚙️ *Hipnos não gerencia hierarquias fora de um grupo.*\n\nUse este comando em um grupo para ativar/desativar o modo somente admin.'
        }, { quoted: msg })
      }

      const sender = msg.key.participant || msg.key.remoteJid

      // 2) Busca os metadados do grupo para saber quem é admin
      const metadados = await sock.groupMetadata(jid)

      // 3) Autorização: dono do bot (lista OWNER_NUMBERS) OU admin do grupo OU dono do grupo
      const ehAutorizado =
        OWNER_NUMBERS.includes(limparNumero(sender)) ||
        ehAdminDoGrupo(metadados.participants, sender) ||
        limparNumero(sender) === limparNumero(metadados.owner)

      if (!ehAutorizado) {
        return await sock.sendMessage(jid, {
          text: '🌑 *Hipnos ignora sua petição...*\n\nApenas *administradores do grupo* (ou o dono do bot) podem ativar/desativar o modo somente admin.'
        }, { quoted: msg })
      }

      // 4) Decide o novo estado:
      //    - /soadm 1  -> ativa
      //    - /soadm 0  -> desativa
      //    - /soadm    -> alterna o estado atual
      const args = String(text || '').split(' ').slice(1)
      const opcao = (args[0] || '').trim().toLowerCase()

      const configs = lerConfiguracoes()
      const estaAtivo = configs.onlyAdmin.includes(jid)

      let novoEstado
      if (opcao === '1') novoEstado = true
      else if (opcao === '0') novoEstado = false
      else novoEstado = !estaAtivo

      // 5) Aplica a mudança (somente para ESTE grupo) e confirma o novo estado
      if (novoEstado && estaAtivo) {
        return await sock.sendMessage(jid, {
          text: '⚠️ O *modo somente admin* já está *ATIVO* neste grupo. Nada mudou.'
        }, { quoted: msg })
      }

      if (novoEstado) {
        configs.onlyAdmin.push(jid) // adiciona ESTE grupo à lista
        salvarConfiguracoes(configs)

        return await sock.sendMessage(jid, {
          text: '🌑⚖️ *MODO SOMENTE ADMIN ATIVADO* ✅\n\n🛡️ A partir de agora, apenas *administradores do grupo* (e o dono do bot) podem invocar meus comandos neste recinto.\n\n💤 Os mortais podem falar, mas Hipnos os ignorará.'
        }, { quoted: msg })
      }

      if (!novoEstado && estaAtivo) {
        configs.onlyAdmin = configs.onlyAdmin.filter((id) => id !== jid) // remove ESTE grupo
        salvarConfiguracoes(configs)

        return await sock.sendMessage(jid, {
          text: '🌑⚙️ *MODO SOMENTE ADMIN DESATIVADO* ❌\n\n📣 Hipnos volta a escutar e responder todos os membros deste grupo.'
        }, { quoted: msg })
      }

      // !novoEstado && !estaAtivo
      return await sock.sendMessage(jid, {
        text: '⚠️ O *modo somente admin* já está *DESATIVADO* neste grupo. Nada mudou.'
      }, { quoted: msg })

    } catch (err) {
      console.error('Erro no comando soadm:', err)
      await sock.sendMessage(jid, {
        text: '⛔ As sombras confundiram o comando... Tente novamente.'
      }, { quoted: msg })
    }
  }
}