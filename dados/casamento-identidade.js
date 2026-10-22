// Índices e caches vivem somente durante um comando. Nenhum dado de grupo é
// reutilizado na próxima execução. Consultas de sessão têm limite no processo.
const { identificar, identidade } = require('./identidade-participante')
const { ehLid, resolverLidParaTelefone } = require('../lid')
let emVoo = 0
const fila = []
function consultarSessao(jid) {
  return new Promise((resolve, reject) => {
    fila.push({ jid, resolve, reject })
    drenar()
  })
}
function drenar() {
  while (emVoo < 2 && fila.length) {
    const tarefa = fila.shift()
    emVoo++
    Promise.resolve().then(() => resolverLidParaTelefone(tarefa.jid, { silencioso: true }))
      .then(tarefa.resolve, tarefa.reject).finally(() => { emVoo--; drenar() })
  }
}
function criarResolvedor(participantes) {
  const porId = new Map(), porNumero = new Map(), cache = new Map(), sessoes = new Map()
  const desconhecidos = [], invalidos = new Set()
  const vazio = () => ({ numero: null, participante: null })
  function adicionar(mapa, chave, p) {
    if (!chave) return
    if (!mapa.has(chave)) mapa.set(chave, new Set())
    mapa.get(chave).add(p)
  }
  function registrar(numero, p) { if (p) adicionar(porNumero, numero, p) }
  for (const p of participantes) {
    const ids = [p.id, p.phoneNumber, p.lid && `${String(p.lid).split('@')[0]}@lid`]
    const numeros = new Set(ids.map(identidade).filter(k => k.startsWith('pn:')).map(k => k.slice(3)))
    if (numeros.size > 1) invalidos.add(p)
    for (const id of ids) adicionar(porId, identidade(id), p)
    for (const numero of numeros) registrar(numero, p)
    if (!numeros.size && ehLid(p.id)) desconhecidos.push(p)
  }
  function sessao(jid) {
    const k = identidade(jid)
    // Guarda também ausência/falha durante este comando, sem cache negativo global.
    if (!sessoes.has(k)) sessoes.set(k, consultarSessao(jid))
    return sessoes.get(k)
  }
  function conferir(pessoa) {
    if (pessoa.numero && (porNumero.get(pessoa.numero)?.size > 1 || invalidos.has(pessoa.participante))) return vazio()
    return pessoa
  }
  async function resolverDireto(jid) {
    const k = identidade(jid)
    if (!k) return vazio()
    const exatos = [...(porId.get(k) || [])]
    if (exatos.length > 1 || exatos.some(p => invalidos.has(p))) return vazio()
    let pessoa
    if (!ehLid(jid) || exatos.some(p => [p.id, p.phoneNumber].some(id => identidade(id).startsWith('pn:')))) {
      pessoa = await identificar(exatos, jid)
    } else {
      const numero = await sessao(jid)
      if (!numero) return vazio()
      if (exatos.length) {
        const prova = { ...exatos[0], phoneNumber: `${numero}@s.whatsapp.net` }
        pessoa = await identificar([prova], jid)
        if (pessoa.participante) pessoa.participante = exatos[0]
      } else {
        pessoa = await identificar([...(porNumero.get(numero) || [])], `${numero}@s.whatsapp.net`)
      }
    }
    if (pessoa.numero) {
      registrar(pessoa.numero, pessoa.participante)
      const membros = [...(porNumero.get(pessoa.numero) || [])]
      if (!pessoa.participante && membros.length === 1) pessoa.participante = membros[0]
    }
    return conferir(pessoa)
  }
  function direto(jid) {
    const k = identidade(jid)
    if (!cache.has(k)) cache.set(k, resolverDireto(jid))
    return cache.get(k)
  }
  let varredura
  async function buscar(jid) {
    let pessoa = conferir(await direto(jid))
    // Só percorre LIDs desconhecidos se não há prova direta de pertencimento.
    // Os workers reutilizam os mesmos resultados e limitam consultas à sessão.
    if (pessoa.numero && !pessoa.participante && desconhecidos.length) {
      if (!varredura) varredura = (async () => {
        let proximo = 0
        async function worker() {
          while (proximo < desconhecidos.length) await direto(desconhecidos[proximo++].id)
        }
        await Promise.all([worker(), worker()])
      })()
      await varredura
      const membros = [...(porNumero.get(pessoa.numero) || [])]
      if (membros.length === 1) pessoa = { ...pessoa, participante: membros[0] }
    }
    return conferir(pessoa)
  }
  return { buscar, conferir }
}
module.exports = { criarResolvedor }
