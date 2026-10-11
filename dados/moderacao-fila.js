// Serialização por grupo e cache limitado, compartilhados pelas proteções.
function criarFila({ relogio = () => Date.now(), max = 10000, falha, saturada }) {
  const filas = new Map(), vistas = new Map()
  function limpar() {
    for (const [k, v] of vistas) if (!v.ativo && v.expira <= relogio()) vistas.delete(k)
  }
  const timer = setInterval(limpar, 30000); timer.unref()
  return {
    processar(jid, id, executar) {
      limpar()
      const chave = `${jid}:${id}`
      if (vistas.has(chave)) return vistas.get(chave).promise
      if (vistas.size >= max || filas.size >= max) { saturada?.(); return Promise.resolve(false) }
      const anterior = filas.get(jid) || Promise.resolve()
      const promise = anterior.catch(() => {}).then(executar).catch(falha)
      const visto = { promise, ativo: true, expira: relogio() + 120000 }
      vistas.set(chave, visto); filas.set(jid, promise)
      promise.finally(() => { visto.ativo = false; visto.expira = relogio() + 120000; if (filas.get(jid) === promise) filas.delete(jid) })
      return promise
    },
    limparTeste() { filas.clear(); vistas.clear() }, tamanho() { return vistas.size }
  }
}
module.exports = { criarFila }
