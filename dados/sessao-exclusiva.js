const { randomUUID } = require('crypto')
const LEASE_MS = 90000, RENOVAR_MS = 20000
function criarLease({ relogio = Date.now, intervalo = setInterval, cancelar = clearInterval, perdida = () => {} } = {}) {
  const dono = randomUUID(), _id = 'hipnos_socket_lease'
  let colecao, timer, validoAte = 0, renovando = false, parado = false
  function valida() { return !parado && validoAte > relogio() }
  async function renovar() {
    if (renovando || parado) return
    renovando = true
    try {
      const agora = relogio()
      const r = await colecao.updateOne({ _id, dono, ate: { $gt: agora } }, { $set: { ate: agora + LEASE_MS } })
      if (!(r.matchedCount || r.modifiedCount) || !valida()) throw new Error('Lease perdida')
      validoAte = agora + LEASE_MS
    } catch (_) { parado = true; validoAte = 0; if (timer) cancelar(timer); perdida() }
    finally { renovando = false }
  }
  async function adquirir(col) {
    if (parado) throw new Error('Lease encerrada')
    if (valida()) return
    const agora = relogio()
    let r
    try { r = await col.updateOne({ _id, $or: [{ dono }, { ate: { $lte: agora } }] }, { $set: { dono, ate: agora + LEASE_MS } }, { upsert: true }) }
    catch (e) { if (e.code === 11000) throw Object.assign(new Error('Sessão ocupada por outra instância'), { sessaoOcupada: true }); throw e }
    if (!(r.upsertedCount || r.modifiedCount || r.matchedCount)) throw new Error('Lease não confirmada')
    colecao = col; validoAte = agora + LEASE_MS
    if (!valida()) throw new Error('Reserva da sessão expirou')
    if (!timer) { timer = intervalo(() => { renovar().catch(() => {}) }, RENOVAR_MS); timer?.unref?.() }
  }
  function vestir(col, atual = () => true) {
    const guard = () => { if (!valida() || !atual()) throw new Error('Sessão sem lease válida ou socket substituído') }
    return {
      find(...args) { guard(); return col.find(...args) },
      async findOne(...args) { guard(); return col.findOne(...args) },
      async updateOne(...args) { guard(); return col.updateOne(...args) },
      async deleteOne(...args) { guard(); return col.deleteOne(...args) }
    }
  }
  async function liberar() {
    parado = true; validoAte = 0; if (timer) cancelar(timer)
    if (colecao) await colecao.updateOne({ _id, dono }, { $set: { ate: 0 } })
  }
  return { adquirir, renovar, valida, vestir, liberar }
}
module.exports = { criarLease, LEASE_MS, RENOVAR_MS }
