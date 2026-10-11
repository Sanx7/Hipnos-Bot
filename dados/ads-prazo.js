// Timeout does not imply WhatsApp rejected a message. The occurrence is consumed
// before send, so late success cannot cause automatic retry of the same occurrence.
module.exports = async function prazo(promise, ms = 30000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Prazo excedido')), ms); timer.unref?.() })]) }
  finally { clearTimeout(timer) }
}
