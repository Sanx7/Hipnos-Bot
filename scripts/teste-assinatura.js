// ============================================================
// TESTE ASSINATURA - parte 1/4 (cabecalho + harness)
// ============================================================
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
const path = require('path')
const fs = require('fs')
const os = require('os')
const vip = require('../vip')
const lid = require('../lid')
const { limparNumero, getDonos } = require('../config')
const { Sticker, StickerTypes } = require('wa-sticker-formatter')
const figurinha = require('../comandos/menu-fig/figurinha')
const sticker = require('../comandos/menu-fig/sticker')
function criarColecaoFake() {
  const documentos = new Map()
  const clone = (d) => JSON.parse(JSON.stringify(d))
  const casa = (d, filtro) => Object.entries(filtro || {}).every(([campo, valor]) => {
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      if (Array.isArray(valor.$in)) return valor.$in.includes(d[campo])
      if (valor.$lte !== undefined) return d[campo] <= valor.$lte
    }
    return d[campo] === valor
  })
  return {
    _mapa: documentos,
    async findOne(filtro) { for (const d of documentos.values()) if (casa(d, filtro)) return clone(d); return null },
    async updateOne(filtro, atualizacao, opcoes = {}) {
      for (const [, d] of documentos) {
        if (casa(d, filtro)) {
          if (atualizacao.$set) Object.assign(d, atualizacao.$set)
          if (atualizacao.$unset) for (const campo of Object.keys(atualizacao.$unset)) delete d[campo]
          return { matchedCount: 1 }
        }
      }
      if (opcoes.upsert) {
        const novo = { ...(atualizacao.$setOnInsert || {}), ...(atualizacao.$set || {}) }
        documentos.set(novo.numero, novo)
        return { upsertedCount: 1 }
      }
      return { matchedCount: 0 }
    },
    async deleteOne(filtro) { for (const [chave, d] of documentos) { if (casa(d, filtro)) { documentos.delete(chave); return { deletedCount: 1 } } } return { deletedCount: 0 } },
    async deleteMany() { return { deletedCount: 0 } },
    find(filtro) { return { sort() { return this }, async toArray() { return [...documentos.values()].filter((d) => casa(d, filtro)).map(clone) } } }
  }
}
const colecaoFake = criarColecaoFake()
vip.__definirColecaoTeste(colecaoFake)
const vips = () => colecaoFake._mapa
const JID_GRUPO = '120363@g.us'
const NUM_VIP = '5511900000001'
const JID_VIP = `${NUM_VIP}@s.whatsapp.net`
const LID_VIP = '999888777@lid'
const NUM_COMUM = '5511911111111'
const DOIS_DIAS = 2 * 24 * 60 * 60 * 1000
function criarSock() {
  const envios = []
  const sock = {
    envios,
    async groupMetadata() { return { subject: 'Recinto de Teste', participants: [{ id: LID_VIP, phoneNumber: JID_VIP }, { id: `${NUM_COMUM}@s.whatsapp.net` }] } },
    async sendMessage(jid, conteudo) { envios.push({ jid, conteudo, texto: conteudo?.text || '' }); return {} }
  }
  return { sock, envios }
}
const mensagem = (texto, participante = JID_VIP) => ({ key: { remoteJid: JID_GRUPO, participant: participante }, message: { conversation: texto }, pushName: 'Teste' })
async function lerExif(buffer) {
  const { Image } = require('node-webpmux')
  const img = new Image()
  await img.load(buffer)
  const bruto = (img.exif || Buffer.from('')).toString('utf-8')
  // O EXIF do webpmux traz lixo binário + dois comprimentos little-endian
  // antes do JSON (ex.: "{\\u0000\\u0000\\u0000\\u0016\\u0000..." colado no "{").
  // O JSON válido é o MAIOR trecho entre chaves (o interno com sticker-pack-*).
  let melhor = null
  let inicio = -1
  while (true) {
    inicio = bruto.indexOf('{', inicio + 1)
    if (inicio === -1) break
    const fim = bruto.lastIndexOf('}')
    if (fim <= inicio) continue
    try {
      const candidato = JSON.parse(bruto.slice(inicio, fim + 1))
      if (candidato && candidato['sticker-pack-name']) { melhor = candidato; break }
      if (!melhor) melhor = candidato
    } catch (e) { /* tenta a próxima chave */ }
  }
  if (!melhor) throw new Error('EXIF sem JSON legivel')
  return { pack: melhor['sticker-pack-name'] || null, autor: melhor['sticker-pack-publisher'] || null, crua: melhor }
}
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
async function gerarStickerExif(pack, autor) {
  const s = new Sticker(PNG_1PX, { pack, author: autor, type: StickerTypes.CROPPED, id: 'teste_assinatura', quality: 70 })
  return s.toBuffer()
}
let aprovadas = 0
let reprovadas = 0
async function testar(rotulo, fn) {
  try { await fn(); aprovadas += 1; console.log('✅', rotulo) } catch (err) { reprovadas += 1; console.log('❌', rotulo); console.log('   ↳', err?.message || err) }
}
async function main() {
  const comando = require('../comandos/menu-vip/assinatura')
  console.log('TESTE /assinatura - nome de autor no EXIF')
  const definir = (texto, participante = JID_VIP) => {
    const { sock, envios } = criarSock()
    return comando.executar(sock, JID_GRUPO, mensagem('/assinatura ' + texto, participante), '/assinatura ' + texto).then(() => envios.at(-1)?.texto || '')
  }
  const mostrar = (participante = JID_VIP) => {
    const { sock, envios } = criarSock()
    return comando.executar(sock, JID_GRUPO, mensagem('/assinatura', participante), '/assinatura').then(() => envios.at(-1)?.texto || '')
  }
  const remover = (participante = JID_VIP, variante = 'remover') => {
    const { sock, envios } = criarSock()
    return comando.executar(sock, JID_GRUPO, mensagem('/assinatura ' + variante, participante), '/assinatura ' + variante).then(() => envios.at(-1)?.texto || '')
  }
  await testar('nao-VIP (comum) e recusado', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const resposta = await definir('@joaovip', NUM_COMUM + '@s.whatsapp.net')
    if (!/coroados|exclusivo/i.test(resposta)) throw new Error('resposta: ' + JSON.stringify(resposta))
  })
  await testar('VIP vencido e tratado como nao-VIP (recusa segura)', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() - 1000 })
    const resposta = await definir('@joaovip')
    if (!/coroados|exclusivo|mais ativo|renove/i.test(resposta)) throw new Error('resposta: ' + JSON.stringify(resposta))
  })
  await testar('VIP define e mostra', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const resposta = await definir('@joaovip')
    if (!/ASSINATURA DEFINIDA/i.test(resposta)) throw new Error('resposta: ' + JSON.stringify(resposta))
    if ((await vip.obterAssinatura(NUM_VIP)) !== '@joaovip') throw new Error('nao gravou')
    const atual = await mostrar()
    if (!/SUA ASSINATURA/i.test(atual) || !atual.includes('@joaovip')) throw new Error('mostrar: ' + JSON.stringify(atual))
  })
  await testar('remover e reset desligam', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, assinatura: '@joaovip' })
    const r1 = await remover(JID_VIP, 'remover')
    if (!/removida/i.test(r1)) throw new Error('remover: ' + JSON.stringify(r1))
    if ((await vip.obterAssinatura(NUM_VIP)) !== null) throw new Error('nao apagou')
    await vip.definirAssinatura(NUM_VIP, '@outra')
    const r2 = await remover(JID_VIP, 'reset')
    if (!/removida/i.test(r2)) throw new Error('reset: ' + JSON.stringify(r2))
  })
  await testar('limite 35 passa, 36 recusa', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    if ((await vip.validarAssinatura('a'.repeat(35))).ok !== true) throw new Error('35 deveriam passar')
    const v = await vip.validarAssinatura('b'.repeat(36))
    if (v.ok || v.motivo !== 'longo') throw new Error('valid: ' + JSON.stringify(v))
    const resposta = await definir('b'.repeat(36))
    if (!/muito longa/i.test(resposta)) throw new Error('resposta: ' + JSON.stringify(resposta))
  })
  await testar('emoji permitido', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS })
    const comEmoji = '⭐ @joaovip ⭐'
    const v = await vip.validarAssinatura(comEmoji)
    if (!v.ok) throw new Error('recusou emoji: ' + JSON.stringify(v))
    const resposta = await definir(comEmoji)
    if (!/ASSINATURA DEFINIDA/i.test(resposta)) throw new Error('resposta: ' + JSON.stringify(resposta))
    if ((await vip.obterAssinatura(NUM_VIP)) !== comEmoji) throw new Error('nao gravou emoji')
  })
  await testar('EXIF customizado e padrao', async () => {
    const custom = await lerExif(await gerarStickerExif(sticker.PACK_PADRAO, '@joaovip'))
    if (custom.pack !== 'Hipnos Bot' || custom.autor !== '@joaovip') throw new Error('custom: ' + JSON.stringify(custom))
    const padrao = await lerExif(await gerarStickerExif(sticker.PACK_PADRAO, sticker.AUTOR_PADRAO))
    if (padrao.pack !== 'Hipnos Bot' || padrao.autor !== 'Sombras do Limbo') throw new Error('padrao: ' + JSON.stringify(padrao))
  })
  await testar('resolverAutorExif dos dois comandos', async () => {
    vips().clear()
    vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, assinatura: '@joaovip' })
    if ((await sticker.resolverAutorExif(NUM_VIP)) !== '@joaovip') throw new Error('/s nao devolveu assinatura')
    if ((await figurinha.resolverAutorExif(NUM_VIP)) !== '@joaovip') throw new Error('/figurinha nao devolveu')
    if ((await sticker.resolverAutorExif(NUM_COMUM)) !== sticker.AUTOR_PADRAO) throw new Error('/s nao caiu no padrao')
    if ((await figurinha.resolverAutorExif(NUM_COMUM)) !== figurinha.AUTOR_PADRAO) throw new Error('/figurinha nao caiu no padrao')
  })
  await testar('metadados gravam autor custom (webp do Sticker)', async () => {
    const base = await gerarStickerExif(sticker.PACK_PADRAO, sticker.AUTOR_PADRAO)
    const e1 = await lerExif(await sticker.inyectarMetadatosWebp(base, '@joaovip'))
    if (e1.autor !== '@joaovip' || e1.pack !== 'Hipnos Bot') throw new Error('/s: ' + JSON.stringify(e1))
    const e2 = await lerExif(await figurinha.aplicarMetadados(base, '@joaovip'))
    if (e2.autor !== '@joaovip' || e2.pack !== 'Hipnos Bot') throw new Error('/fig: ' + JSON.stringify(e2))
    const e3 = await lerExif(await figurinha.aplicarMetadados(base, null))
    if (e3.autor !== 'Sombras do Limbo') throw new Error('padrao: ' + JSON.stringify(e3))
  })
  await testar('pack fixo e sem drawtext', async () => {
    if (sticker.PACK_PADRAO !== 'Hipnos Bot') throw new Error('pack /s: ' + sticker.PACK_PADRAO)
    if (figurinha.PACK_PADRAO !== 'Hipnos Bot') throw new Error('pack /fig: ' + figurinha.PACK_PADRAO)
    for (const arq of ['sticker.js', 'figurinha.js']) {
      const fonte = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-fig', arq), 'utf8')
      if (/drawtext/i.test(fonte)) throw new Error(arq + ' ainda tem drawtext')
      if (!/resolverAutorExif/.test(fonte)) throw new Error(arq + ' sem resolverAutorExif')
    }
  })
  await testar('ajuda fala em nome de autor', async () => {
    if (!/nome de autor/i.test(comando.descricao)) throw new Error('descricao: ' + JSON.stringify(comando.descricao))
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-vip', 'assinatura.js'), 'utf8')
    if (/marca d'água/i.test(fonte)) throw new Error('ajuda ainda fala em marca')
  })
  await testar('LID cru resolvido via metadados', async () => {
    const { resolverAutorVip } = require('../vip-acesso')
    lid.__definirConsultaSessaoTeste(async () => null)
    try {
      vips().clear()
      vips().set(NUM_VIP, { numero: NUM_VIP, expira_em: Date.now() + DOIS_DIAS, assinatura: '@joaovip' })
      if ((await vip.obterAssinatura(LID_VIP)) !== null) throw new Error('cenario exige @lid cru sem doc')
      const { sock } = criarSock()
      const autor = await resolverAutorVip(sock, JID_GRUPO, mensagem('/s', LID_VIP), 'teste')
      if (autor.numero !== NUM_VIP) throw new Error('numero: ' + JSON.stringify(autor))
      if (autor.via !== 'metadados') throw new Error('via: ' + autor.via)
      if ((await vip.obterAssinatura(autor.numero)) !== '@joaovip') throw new Error('assinatura nao achada')
      if ((await sticker.resolverAutorExif(autor.numero)) !== '@joaovip') throw new Error('/s nao usaria')
      if ((await figurinha.resolverAutorExif(autor.numero)) !== '@joaovip') throw new Error('/fig nao usaria')
    } finally { lid.__definirConsultaSessaoTeste(null) }
  })
  await testar('fontes usam autor RESOLVIDO', async () => {
    for (const arq of ['sticker.js', 'figurinha.js']) {
      const fonte = fs.readFileSync(path.join(__dirname, '..', 'comandos', 'menu-fig', arq), 'utf8')
      if (!/numero: autorVip.*resolverAutorVip\(sock, jid, msg/.test(fonte)) throw new Error(arq + ' nao resolve via vip-acesso')
      if (!/resolverAutorExif\(autorVip\)/.test(fonte)) throw new Error(arq + ' nao consulta pelo resolvido')
    }
  })
  console.log(reprovadas === 0 ? 'TODOS PASSARAM' : reprovadas + ' FALHARAM')
  process.exit(reprovadas === 0 ? 0 : 1)
}
main()


