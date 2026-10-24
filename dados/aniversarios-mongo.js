const { randomUUID, createHash } = require('node:crypto')
const conexao = require('../rpg/conexao-mongo')
const { validar, bissexto } = require('./aniversarios-tempo')
const preparados = new WeakMap()
async function usarColecoes(fn) {
  return conexao.usarContextoRpg(async ctx => {
    const opcoes = { writeConcern: { w: 'majority', wtimeoutMS: 15000 }, readConcern: { level: 'majority' }, readPreference: 'primary' }
    const perfis = ctx.banco.collection('aniversariosHipnos', opcoes)
    const entregas = ctx.banco.collection('aniversariosEntregas', opcoes)
    if (!preparados.has(ctx.banco)) {
      const promessa = perfis.createIndex({ publico: 1, mes: 1, dia: 1 }, { name: 'idx_aniversarios_publicos_data' })
      preparados.set(ctx.banco, promessa)
      promessa.catch(() => preparados.delete(ctx.banco))
    }
    await preparados.get(ctx.banco)
    return fn({ perfis, entregas })
  })
}
function confirmado(r) { if (r?.acknowledged !== true) throw Error('ANIVERSARIO_RESULTADO_INCERTO'); return r }
function numeroValido(n) { if (!/^\d{10,15}$/.test(String(n))) throw Error('ANIVERSARIO_IDENTIDADE_INVALIDA'); return String(n) }
function criarRepositorio(usar = usarColecoes) {
  return {
    consultar(numero) { return usar(s => s.perfis.findOne({ _id: numeroValido(numero) })) },
    salvar(numero, data, agora = Date.now()) {
      numero = numeroValido(numero)
      if (!validar(data?.dia, data?.mes)) throw Error('ANIVERSARIO_DATA_INVALIDA')
      return usar(async s => {
        confirmado(await s.perfis.updateOne({ _id: numero }, {
          $set: { dia: data.dia, mes: data.mes, publico: false, revisao: randomUUID(), atualizadoEm: new Date(agora) },
          $setOnInsert: { criadoEm: new Date(agora) }
        }, { upsert: true }))
      })
    },
    privacidade(numero, publico, agora = Date.now()) {
      if (typeof publico !== 'boolean') throw Error('ANIVERSARIO_PRIVACIDADE_INVALIDA')
      return usar(async s => confirmado(await s.perfis.updateOne({ _id: numeroValido(numero) },
        { $set: { publico, revisao: randomUUID(), atualizadoEm: new Date(agora) } })).matchedCount === 1)
    },
    remover(numero) { return usar(async s => confirmado(await s.perfis.deleteOne({ _id: numeroValido(numero) })).deletedCount === 1) },
    publicos(numeros) {
      const ids = [...new Set(numeros.map(numeroValido))]
      return usar(s => s.perfis.find({ _id: { $in: ids }, publico: true }).toArray())
    },
    hoje(hoje) {
      const datas = [{ dia: hoje.dia, mes: hoje.mes }]
      if (hoje.mes === 2 && hoje.dia === 28 && !bissexto(hoje.ano)) datas.push({ dia: 29, mes: 2 })
      return usar(s => s.perfis.find({ publico: true, $or: datas }).toArray())
    },
    async reservar(numero, grupo, ano, agora = Date.now()) {
      numero = numeroValido(numero)
      if (!/^\d+(?:-\d+)?@g\.us$/.test(grupo) || !Number.isInteger(ano)) throw Error('ANIVERSARIO_DESTINO_INVALIDO')
      const _id = createHash('sha256').update(JSON.stringify([numero, grupo, ano])).digest('hex'), token = randomUUID()
      return usar(async s => {
        try {
          // Não expira: remover/recriar o perfil ou mudar a data não reabre o ano.
          // Sem dia/mês ou telefone no recibo. Incerta nunca significa concluída.
          confirmado(await s.entregas.insertOne({ _id, token, ano, estado: 'incerta', criadoEm: new Date(agora) }))
          return { _id, token }
        } catch (e) { if (e.code === 11000) return null; throw e }
      })
    },
    liberar(reserva) {
      // Permitido somente quando sendMessage ainda não foi chamado.
      return usar(async s => confirmado(await s.entregas.deleteOne({ ...reserva, estado: 'incerta' })))
    },
    concluir(reserva, mensagemId, agora = Date.now()) {
      if (typeof mensagemId !== 'string' || !mensagemId) throw Error('ANIVERSARIO_ENVIO_NAO_CONFIRMADO')
      return usar(async s => {
        const r = confirmado(await s.entregas.updateOne({ ...reserva, estado: 'incerta' },
          { $set: { estado: 'enviada', mensagemId, enviadoEm: new Date(agora) } }))
        if (r.matchedCount !== 1) throw Error('ANIVERSARIO_CONFIRMACAO_INDISPONIVEL')
      })
    }
  }
}
module.exports = { criarRepositorio, usarColecoes }
