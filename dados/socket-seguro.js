const estados = new WeakMap()
function disponivel(sock) {
  const estado = estados.get(sock)
  return (!estado || (estado.aberto && estado.validar())) && sock?.ws?.isOpen !== false
}
// Operações destrutivas exigem socket registrado com a guarda da lease.
function exclusivoDisponivel(sock) { return estados.has(sock) && disponivel(sock) }
function falhaConexao(erro) {
  const codigo = erro?.output?.statusCode || erro?.statusCode || erro?.status
  return [408, 428, 440, 401, 500, 503, 515].includes(Number(codigo))
}
function exigir(sock) { if (!disponivel(sock)) throw Object.assign(new Error('Socket indisponível'), { statusCode: 428 }) }
function preparar(sock, validar = () => true) {
  if (estados.has(sock)) return
  const estado = { aberto: false, validar, consultas: new Map() }; estados.set(sock, estado)
  const enviar = sock.sendMessage.bind(sock), metadados = sock.groupMetadata.bind(sock)
  sock.sendMessage = (...args) => { try { exigir(sock); return enviar(...args) } catch (e) { return Promise.reject(e) } }
  sock.groupMetadata = jid => {
    try { exigir(sock) } catch (e) { return Promise.reject(e) }
    if (estado.consultas.has(jid)) return estado.consultas.get(jid)
    const consulta = Promise.resolve().then(() => metadados(jid)).then(meta => { exigir(sock); return meta })
    estado.consultas.set(jid, consulta)
    consulta.finally(() => { if (estado.consultas.get(jid) === consulta) estado.consultas.delete(jid) }).catch(() => {})
    return consulta
  }
}
function atualizar(sock, aberto) { const estado = estados.get(sock); if (estado) estado.aberto = aberto }
function criarInicializador() {
  let pendente = null, bloqueado = false
  return {
    iniciar(fn) {
      if (bloqueado) return Promise.resolve()
      if (pendente) return pendente
      pendente = Promise.resolve().then(fn).finally(() => { pendente = null })
      return pendente
    },
    bloquear() { bloqueado = true },
    bloqueado() { return bloqueado }
  }
}
module.exports = { disponivel, exclusivoDisponivel, exigir, falhaConexao, preparar, atualizar, criarInicializador }
