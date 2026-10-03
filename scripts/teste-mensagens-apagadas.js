// ============================================
// PARTE 1/4 — cabecalho + harness offline
// ============================================
// RODA 100% OFFLINE: sock fake, download de midia via stub, Mongo via
// collections fake. Cobre: captura de texto, midia pequena, midia grande,
// expiracao, teto de entradas, reenvio no revoke, revoke sem cache
// (silencioso), /apagadas com historico e vazio, toggle liga/desliga.
// Uso: node scripts/teste-mensagens-apagadas.js
// ============================================
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''

const cacheMensagens = require('../dados/cache-mensagens')
const historico = require('../dados/historico-apagadas')
const { extrairIdRevogado, tratarRevogacao } = require('../dados/reenvio-apagadas')
const apagadas = require('../comandos/menu-utilitario/apagadas')
const antiapagada = require('../comandos/admin/antiapagada')
const configGrupo = require('../configuracoes-grupo')

const JID_GRUPO = '120363000000000000@g.us'
const JID_PV = '5511999999999@s.whatsapp.net'
const AUTOR = '5511900000001@s.whatsapp.net'
const OUTRO = '5511911111111@s.whatsapp.net'

function criarSockFake({ participantes = null } = {}) {
  const enviadas = []
  const sock = {
    enviadas,
    async sendMessage(jid, conteudo) {
      enviadas.push({ jid, conteudo, texto: conteudo?.text || conteudo?.caption || '' })
      return {}
    },
    async groupMetadata() {
      return {
        participants: participantes || [
          { id: AUTOR, admin: 'admin' },
          { id: OUTRO, admin: null }
        ],
        owner: AUTOR,
        subject: 'Recinto de Teste'
      }
    }
  }
  return { sock, enviadas }
}

function msgTexto(id, texto, participante = AUTOR) {
  return {
    key: { remoteJid: JID_GRUPO, participant: participante, id, fromMe: false },
    message: { conversation: texto },
    pushName: 'Teste'
  }
}

function msgImagem(id, legenda = '', participante = AUTOR) {
  return {
    key: { remoteJid: JID_GRUPO, participant: participante, id, fromMe: false },
    message: { imageMessage: { caption: legenda, mimetype: 'image/jpeg' } },
    pushName: 'Teste'
  }
}

function msgRevoke(idRevogado, participante = AUTOR) {
  return {
    key: { remoteJid: JID_GRUPO, participant: participante, id: 'revoke-' + idRevogado, fromMe: false },
    message: { protocolMessage: { type: 0, key: { remoteJid: JID_GRUPO, fromMe: false, id: idRevogado } } },
    pushName: 'Teste'
  }
}

// Collection fake do historico (insertOne/find/sort/toArray)
function criarColecaoHistoricoFake() {
  const docs = []
  return {
    _docs: docs,
    async insertOne(doc) { docs.push({ ...doc }); return { insertedId: docs.length } },
    find(filtro) {
      const lista = docs.filter((d) => Object.entries(filtro || {}).every(([k, v]) => d[k] === v))
      return { sort() { return this }, async toArray() { return lista.map((d) => ({ ...d })) } }
    }
  }
}

// Collection fake das configuracoes por grupo (toggle)
function criarColecaoConfigFake() {
  const docs = new Map()
  return {
    _docs: docs,
    async findOne(filtro) {
      const d = docs.get(filtro.grupo_id)
      return d ? { ...d } : null
    },
    async updateOne(filtro, update) {
      const id = filtro.grupo_id
      const atual = docs.get(id) || { grupo_id: id }
      Object.assign(atual, update.$set || {})
      docs.set(id, atual)
      return { matchedCount: 1 }
    }
  }
}

let reprovadas = 0
async function testar(nome, fn) {
  try {
    await fn()
    console.log('✅ ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('❌ ' + nome + ' →', err?.message || err)
  }
}

// ============================================
// PARTE 2/4 — captura: texto, midia, limites
// ============================================
async function parteCaptura() {
  await testar('captura de texto guarda autor + conteudo', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(null)
    await cacheMensagens.capturarMensagem(msgTexto('id-texto-1', 'olá grupo'), JID_GRUPO)
    const e = cacheMensagens.buscar('id-texto-1')
    if (!e) throw new Error('não guardou')
    if (e.tipo !== 'texto' || e.texto !== 'olá grupo') throw new Error('conteúdo errado: ' + JSON.stringify(e))
    if (e.autorJid !== AUTOR) throw new Error('autor errado')
  })

  await testar('captura ignora PV, comando e protocolo', async () => {
    cacheMensagens._limparTudo()
    await cacheMensagens.capturarMensagem(msgTexto('id-pv', 'oi'), JID_PV)
    if (cacheMensagens.buscar('id-pv')) throw new Error('guardou PV')
    await cacheMensagens.capturarMensagem(msgTexto('id-cmd', '/menu'), JID_GRUPO)
    if (cacheMensagens.buscar('id-cmd')) throw new Error('guardou comando')
    await cacheMensagens.capturarMensagem(msgRevoke('qualquer'), JID_GRUPO)
    if (cacheMensagens.tamanho() !== 0) throw new Error('guardou revoke')
  })

  await testar('captura de midia pequena guarda buffer', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(async () => Buffer.from('IMAGEM-PEQUENA'))
    await cacheMensagens.capturarMensagem(msgImagem('id-img-1', 'olha a foto'), JID_GRUPO)
    const e = cacheMensagens.buscar('id-img-1')
    if (!e || e.tipo !== 'imagem') throw new Error('tipo errado')
    if (!e.buffer || e.buffer.toString() !== 'IMAGEM-PEQUENA') throw new Error('buffer sumiu')
    if (e.texto !== 'olha a foto') throw new Error('legenda sumiu')
    if (e.grandeDemais) throw new Error('marcou grande à toa')
  })

  await testar('midia grande demais: metadado sim, buffer não', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(async () => Buffer.alloc(cacheMensagens.MAX_MIDIA_BYTES + 1))
    await cacheMensagens.capturarMensagem(msgImagem('id-img-grande', 'foto pesada'), JID_GRUPO)
    const e = cacheMensagens.buscar('id-img-grande')
    if (!e) throw new Error('devia guardar o metadado')
    if (!e.grandeDemais) throw new Error('devia marcar grandeDemais')
    if (e.buffer) throw new Error('buffer gigante não podia ficar na memória')
  })

  await testar('expiracao: apos o TTL o cache some', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(null)
    await cacheMensagens.capturarMensagem(msgTexto('id-ttl', 'some logo'), JID_GRUPO)
    const e = cacheMensagens.cache.get('id-ttl')
    e.criadoEm = Date.now() - cacheMensagens.TTL_MS - 1000
    if (cacheMensagens.buscar('id-ttl')) throw new Error('devia ter expirado')
    if (cacheMensagens.limparExpiradas() !== 0) throw new Error('limpeza contou errado')
    await cacheMensagens.capturarMensagem(msgTexto('id-ttl2', 'some logo 2'), JID_GRUPO)
    cacheMensagens.cache.get('id-ttl2').criadoEm = Date.now() - cacheMensagens.TTL_MS - 1000
    if (cacheMensagens.limparExpiradas() !== 1) throw new Error('limpeza devia remover 1')
  })

  await testar('teto: acima de 500 remove as mais antigas', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(null)
    for (let i = 0; i < cacheMensagens.MAX_ENTRADAS + 10; i++) {
      await cacheMensagens.capturarMensagem(msgTexto('id-teto-' + i, 'msg ' + i), JID_GRUPO)
    }
    if (cacheMensagens.tamanho() !== cacheMensagens.MAX_ENTRADAS) {
      throw new Error('tamanho errado: ' + cacheMensagens.tamanho())
    }
    if (cacheMensagens.buscar('id-teto-0')) throw new Error('a mais antiga devia ter saido')
    if (!cacheMensagens.buscar('id-teto-' + (cacheMensagens.MAX_ENTRADAS + 9))) {
      throw new Error('a mais nova devia estar la')
    }
  })
}

// ============================================
// PARTE 3/4 — reenvio no revoke (texto, midia, grande, fantasma)
// ============================================
async function parteReenvio() {
  const colHist = criarColecaoHistoricoFake()
  historico._injetarColecao(colHist)

  await testar('reenvio automatico de texto ao detectar revoke', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(null)
    colHist._docs.length = 0
    await cacheMensagens.capturarMensagem(msgTexto('id-reenvio-1', 'segredo do grupo'), JID_GRUPO)
    const { sock, enviadas } = criarSockFake()
    const id = extrairIdRevogado(msgRevoke('id-reenvio-1'))
    if (id !== 'id-reenvio-1') throw new Error('nao extraiu o id: ' + id)
    const r = await tratarRevogacao(sock, msgRevoke('id-reenvio-1'), JID_GRUPO)
    if (r !== 'reenviado') throw new Error('nao reenviou: ' + r)
    if (!enviadas.length || !/Mensagem apagada/.test(enviadas[0].conteudo.text || '')) {
      throw new Error('sem aviso de apagada')
    }
    if (!/segredo do grupo/.test(enviadas[0].conteudo.text || '')) throw new Error('texto original sumiu')
    if (!colHist._docs.length) throw new Error('nao registrou no historico')
  })

  await testar('reenvio de midia pequena com legenda original', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(async () => Buffer.from('FOTO-BUFFER'))
    await cacheMensagens.capturarMensagem(msgImagem('id-reenvio-img', 'minha legenda'), JID_GRUPO)
    const { sock, enviadas } = criarSockFake()
    const r = await tratarRevogacao(sock, msgRevoke('id-reenvio-img'), JID_GRUPO)
    if (r !== 'reenviado') throw new Error('nao reenviou: ' + r)
    const midia = enviadas.find((e) => e.conteudo.image)
    if (!midia) throw new Error('midia nao voltou')
    if (!/minha legenda/.test(midia.conteudo.caption || '')) throw new Error('legenda sumiu')
  })

  await testar('midia grande: avisa que era grande demais', async () => {
    cacheMensagens._limparTudo()
    cacheMensagens._definirBaixarMidia(async () => Buffer.alloc(cacheMensagens.MAX_MIDIA_BYTES + 1))
    await cacheMensagens.capturarMensagem(msgImagem('id-grande-2', 'pesada'), JID_GRUPO)
    const { sock, enviadas } = criarSockFake()
    const r = await tratarRevogacao(sock, msgRevoke('id-grande-2'), JID_GRUPO)
    if (r !== 'reenviado') throw new Error('nao reenviou: ' + r)
    if (!/grande demais/.test(enviadas[0].conteudo.text || '')) throw new Error('sem aviso de grande')
  })

  await testar('revoke sem cache: silencioso, sem erro visivel', async () => {
    cacheMensagens._limparTudo()
    const { sock, enviadas } = criarSockFake()
    const r = await tratarRevogacao(sock, msgRevoke('id-fantasma'), JID_GRUPO)
    if (r !== 'sem-cache') throw new Error('devia ser sem-cache: ' + r)
    if (enviadas.length) throw new Error('devia ficar em silencio')
  })

  historico._injetarColecao(null)
}

// PARTE 4/4 — comandos
async function parteComandos() {
  const colHist = criarColecaoHistoricoFake()
  historico._injetarColecao(colHist)
  const colCfg = criarColecaoConfigFake()
  configGrupo.__definirColecaoTeste(colCfg)

  await testar('/apagadas lista o historico do dia', async () => {
    colHist._docs.length = 0
    await historico.registrarApagada({ grupo: JID_GRUPO, autor: AUTOR, autorNome: 'Teste', tipo: 'texto', texto: 'segredo revelado' })
    await historico.registrarApagada({ grupo: JID_GRUPO, autor: OUTRO, autorNome: '', tipo: 'imagem', texto: 'foto da festa' })
    const { sock, enviadas } = criarSockFake()
    await apagadas.executar(sock, JID_GRUPO, msgTexto('id-cmd-apag', '/apagadas'))
    const texto = enviadas.at(-1)?.conteudo?.text || ''
    if (!/APAGADAS DE HOJE/.test(texto)) throw new Error('sem cabecalho')
    if (!/segredo revelado/.test(texto)) throw new Error('texto sumiu')
    if (!/dia: imagem/.test(texto)) throw new Error('rotulo de midia sumiu')
  })

  await testar('/apagadas vazio: aviso amigavel', async () => {
    colHist._docs.length = 0
    const { sock, enviadas } = criarSockFake()
    await apagadas.executar(sock, JID_GRUPO, msgTexto('id-cmd-vazio', '/apagadas'))
    const texto = enviadas.at(-1)?.conteudo?.text || ''
    if (!/Nenhuma mensagem apagada hoje/.test(texto)) throw new Error('sem aviso amigavel')
  })

  await testar('toggle: ligado por padrao, desliga e religa', async () => {
    colCfg._docs.clear()
    if ((await configGrupo.antiApagadaHabilitada(JID_GRUPO)) !== true) throw new Error('devia ser ligado por padrao')
    const { sock, enviadas } = criarSockFake()
    const msgAdmin = (id, txt) => ({
      key: { remoteJid: JID_GRUPO, participant: AUTOR, id, fromMe: false },
      message: { conversation: txt }, pushName: 'Admin'
    })
    await antiapagada.executar(sock, JID_GRUPO, msgAdmin('id-t0', '/antiapagada 0'), '/antiapagada 0')
    if ((await configGrupo.antiApagadaHabilitada(JID_GRUPO)) !== false) throw new Error('nao desligou')
    if (!/DESATIVADA/.test(enviadas.at(-1)?.conteudo?.text || '')) throw new Error('sem confirmacao de off')
    await antiapagada.executar(sock, JID_GRUPO, msgAdmin('id-t1', '/antiapagada 1'), '/antiapagada 1')
    if ((await configGrupo.antiApagadaHabilitada(JID_GRUPO)) !== true) throw new Error('nao religou')
  })

  await testar('toggle: membro comum recusado', async () => {
    const { sock, enviadas } = criarSockFake()
    const msgMembro = {
      key: { remoteJid: JID_GRUPO, participant: OUTRO, id: 'id-negado', fromMe: false },
      message: { conversation: '/antiapagada 0' }, pushName: 'Membro'
    }
    await antiapagada.executar(sock, JID_GRUPO, msgMembro, '/antiapagada 0')
    if (!/peti/.test(enviadas.at(-1)?.conteudo?.text || '')) throw new Error('liberou p/ membro')
  })

  historico._injetarColecao(null)
  configGrupo.__definirColecaoTeste(null)
}

async function main() {
  console.log('TESTE mensagens apagadas — anti-apagada do Limbo')
  await parteCaptura()
  await parteReenvio()
  await parteComandos()
  cacheMensagens._definirBaixarMidia(null)
  cacheMensagens._limparTudo()
  cacheMensagens._pararLimpeza()
  console.log(reprovadas === 0 ? 'TODOS PASSARAM' : reprovadas + ' FALHARAM')
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Falha inesperada no teste:', err)
  process.exit(1)
})

