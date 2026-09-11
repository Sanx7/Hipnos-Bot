// ============================================
// 🧪 teste-checkativo.js — Valida o comando /checkativo e seus aliases
// ============================================
// RODA OFFLINE: substitui database.buscarEstatisticasUsuario por um fake
// (ANTES de carregar o comando, que faz destructuring no require) e usa
// um sock mockado que registra as mensagens enviadas. Verifica:
//   - exports (nome, aliases, descricao, categoria) e simulação do
//     registro de aliases do loader do bot.js;
//   - bloqueio fora de grupos;
//   - alvo: próprio emissor -> menção -> autor da mensagem respondida;
//   - formatação pt-BR do total, posição no ranking e plural;
//   - caso "silêncio" (total 0) e banco indisponível (null);
//   - falha do banco -> erro tratado, sem propagar.
// Uso: node scripts/teste-checkativo.js
// ============================================

const limparNumero = require('../config').limparNumero

// ─── Fake do database: instalado ANTES do require do comando ───
const database = require('../database')
const chamadas = []
let estatisticasFake = { dados: null }
database.buscarEstatisticasUsuario = async (grupoId, usuarioId) => {
  chamadas.push({ grupoId, usuarioId })
  if (estatisticasFake.erro) throw new Error('boom: banco fora do ar')
  return estatisticasFake.dados
}

const comando = require('../comandos/utilitario/checkativo')

// ─── Mocks ───
const JID_GRUPO = '120363000000000000@g.us'
const JID_PRIVADO = '5555000000001@s.whatsapp.net'
const JID_EMISSOR = '5555000000002@s.whatsapp.net'
const JID_MENCIONADO = '5555000000003@s.whatsapp.net'
const JID_AUTOR_CITADO = '5555000000004@s.whatsapp.net'

function criarMsg({ grupo = true, semAlvo = false, mencionado = null, citado = null } = {}) {
  const contextInfo = {}
  if (mencionado) contextInfo.mentionedJid = [mencionado]
  if (citado) contextInfo.participant = citado
  return {
    key: {
      remoteJid: grupo ? JID_GRUPO : JID_PRIVADO,
      fromMe: false,
      id: 'MSG123',
      participant: grupo ? JID_EMISSOR : undefined
    },
    message: semAlvo ? {} : { extendedTextMessage: { text: '/checkativo', contextInfo } }
  }
}

function criarSock() {
  const enviadas = []
  return {
    enviadas,
    sock: {
      sendMessage: async (jid, conteudo, extra) => {
        enviadas.push({ jid, conteudo, extra })
        return { key: { id: `fake-${enviadas.length}` } }
      }
    }
  }
}

const textoUnico = (enviadas) => {
  const textos = enviadas.filter((e) => e.conteudo?.text)
  return textos.length === 1 ? textos[0].conteudo.text : null
}

async function main() {
  let reprovadas = 0
  const testar = async (nome, fn) => {
    try {
      await fn()
      console.log(`✅ ${nome}`)
    } catch (err) {
      reprovadas += 1
      console.log(`❌ ${nome}:`, err?.message || err)
    }
  }

  const comandos = new Map()

  await testar('exports corretos + aliases registrados como o loader faria', async () => {
    if (comando.nome !== 'checkativo') throw new Error(`nome: ${comando.nome}`)
    if (JSON.stringify(comando.aliases) !== JSON.stringify(['mensagens', 'msgs', 'ativo'])) {
      throw new Error(`aliases: ${JSON.stringify(comando.aliases)}`)
    }
    if (!/mensagens enviadas no grupo pela pessoa ou por quem foi marcado/.test(comando.descricao)) {
      throw new Error(`descricao: ${comando.descricao}`)
    }
    if (comando.categoria !== 'utilitario') throw new Error(`categoria: ${comando.categoria}`)
    if (typeof comando.executar !== 'function') throw new Error('executar não é função')

    // Simula o registro do loader do bot.js (nome + aliases, sem sobrescrever)
    comandos.set(comando.nome, comando)
    for (const apelido of comando.aliases) {
      if (!comandos.has(apelido)) comandos.set(apelido, comando)
    }
    for (const rota of ['checkativo', 'mensagens', 'msgs', 'ativo']) {
      if (comandos.get(rota) !== comando) throw new Error(`rota /${rota} não resolve para o módulo`)
    }
  })

  await testar('bloqueia uso fora de grupos', async () => {
    chamadas.length = 0
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_PRIVADO, criarMsg({ grupo: false, semAlvo: true }))
    if (chamadas.length !== 0) throw new Error('consultou o banco fora de grupo')
    const texto = textoUnico(enviadas)
    if (!texto || !/só funciona em grupos/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('sem menção/resposta: consulta o PRÓPRIO emissor', async () => {
    chamadas.length = 0
    estatisticasFake = { dados: { total: 12345, posicao: 7, totalUsuarios: 60, nome: null } }
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg({ semAlvo: true }))
    if (chamadas.length !== 1) throw new Error('deveria fazer 1 consulta')
    if (chamadas[0].grupoId !== JID_GRUPO) throw new Error(`grupoId: ${chamadas[0].grupoId}`)
    if (chamadas[0].usuarioId !== limparNumero(JID_EMISSOR)) throw new Error(`usuarioId: ${chamadas[0].usuarioId}`)
    const texto = textoUnico(enviadas)
    if (!texto || !/12\.345/.test(texto)) throw new Error('total não formatado em pt-BR')
    if (!/CONTA DE MENSAGENS/.test(texto)) throw new Error('título ausente')
  })

  await testar('menção @usuario: consulta o mencionado e o marca no mentions', async () => {
    chamadas.length = 0
    estatisticasFake = { dados: { total: 10, posicao: 3, totalUsuarios: 50, nome: 'Mortal' } }
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg({ mencionado: JID_MENCIONADO }))
    if (chamadas[0].usuarioId !== limparNumero(JID_MENCIONADO)) throw new Error('usuarioId não é o mencionado')
    const texto = textoUnico(enviadas)
    if (!texto || !/Mortal/.test(texto)) throw new Error('nome do banco não usado')
    if (!texto || !/3º/.test(texto) || !/50/.test(texto)) throw new Error('posição no ranking ausente')
    const envio = enviadas.find((e) => e.conteudo?.text)
    if (!envio?.conteudo?.mentions?.includes(JID_MENCIONADO)) throw new Error('mencionado ausente em mentions')
  })

  await testar('resposta a mensagem: consulta o autor citado', async () => {
    chamadas.length = 0
    estatisticasFake = { dados: { total: 1, posicao: null, totalUsuarios: 20, nome: null } }
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg({ citado: JID_AUTOR_CITADO }))
    if (chamadas[0].usuarioId !== limparNumero(JID_AUTOR_CITADO)) throw new Error('usuarioId não é o autor citado')
    const texto = textoUnico(enviadas)
    if (!texto || !/\*1\* mensagem\n/.test(texto)) throw new Error('singular inesperado: ' + texto)
    if (texto && /ranking/.test(texto)) throw new Error('posição deveria ser omitida quando é null')
  })

  await testar('total 0: mensagem de silêncio com o alvo marcado', async () => {
    chamadas.length = 0
    estatisticasFake = { dados: { total: 0, posicao: null, totalUsuarios: 5, nome: null } }
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg({ mencionado: JID_MENCIONADO }))
    const texto = textoUnico(enviadas)
    if (!texto || !/silêncio/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
    const envio = enviadas.find((e) => e.conteudo?.text)
    if (!envio?.conteudo?.mentions?.includes(JID_MENCIONADO)) throw new Error('alvo ausente em mentions')
  })

  await testar('banco indisponível (null): aviso amigável', async () => {
    chamadas.length = 0
    estatisticasFake = { dados: null }
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg({ semAlvo: true }))
    const texto = textoUnico(enviadas)
    if (!texto || !/sombras do banco/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  await testar('falha do banco: erro tratado sem propagar', async () => {
    chamadas.length = 0
    estatisticasFake = { erro: true }
    const { sock, enviadas } = criarSock()
    await comando.executar(sock, JID_GRUPO, criarMsg({ semAlvo: true }))
    const texto = textoUnico(enviadas)
    if (!texto || !/sombras confundiram/i.test(texto)) throw new Error(`aviso inesperado: ${texto}`)
  })

  console.log(reprovadas === 0 ? '\n🎉 Todos os testes passaram.' : `\n💥 ${reprovadas} teste(s) reprovado(s).`)
  process.exit(reprovadas === 0 ? 0 : 1)
}

main()