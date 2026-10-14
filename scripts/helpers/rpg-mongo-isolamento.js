const dns = require('node:dns').promises
function recusar() { throw new Error('RPG_TEST_ISOLAMENTO_NAO_COMPROVADO') }
function destino(uri) {
  try {
    const u = new URL(uri)
    if (u.protocol !== 'mongodb+srv:' || !u.hostname || u.port || u.hash) recusar()
    return { host: u.hostname.toLowerCase().replace(/\.$/, ''), banco: u.pathname.slice(1) }
  } catch { recusar() }
}
async function validarIsolamento(env, resolverSrv = dns.resolveSrv.bind(dns)) {
  if (!env.RPG_TEST_MONGO_URI) throw new Error('RPG_TEST_MONGO_URI_AUSENTE')
  const teste = destino(env.RPG_TEST_MONGO_URI)
  if (!/^hipnos_rpg_test(?:es)?(?:_[a-z0-9]+)?$/i.test(teste.banco)) recusar()
  const producao = ['MONGODB_URI', 'MONGO_URI_RPG'].map(k => {
    if (!env[k]) recusar()
    return destino(env[k])
  })
  if (producao.some(p => p.host === teste.host)) recusar()
  const grupos = await Promise.all([teste, ...producao].map(async d => {
    const rs = await resolverSrv('_mongodb._tcp.' + d.host)
    if (!rs.length || rs.some(r => !r.name)) recusar()
    return new Set(rs.map(r => r.name.toLowerCase().replace(/\.$/, '')))
  }))
  if (grupos.slice(1).some(g => [...grupos[0]].some(h => g.has(h)))) recusar()
  return { banco: teste.banco, servidoresDistintos: true }
}
function nomesExecucao(banco, run) {
  if (!/^[a-f0-9]{32}$/.test(run) || !/^hipnos_rpg_test(?:es)?(?:_[a-z0-9]+)?$/i.test(banco)) recusar()
  const base = 'rpg_test_' + run
  return { banco, jogadores: base + '_jogadores', operacoes: base + '_operacoes', prova: base + '_prova' }
}
module.exports = { validarIsolamento, nomesExecucao }
