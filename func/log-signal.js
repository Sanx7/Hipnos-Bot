// ============================================================
// 🔕 log-signal.js — Compacta os dumps de sessão do libsignal
// ============================================================
// O libsignal@6 (dependência da Baileys 7) avisa sobre o ciclo de vida da
// sessão Signal com console.info/console.warn AVULSO — fora do pino da
// Baileys, ignorando qualquer nível de log configurado. Esses avisos
// despejam o Objeto INTEIRO da SessionEntry no terminal, incluindo
// MATERIAL CRIPTOGRÁFICO sensível (rootKey, privKey efêmera, chainKeys) —
// dezenas de linhas a cada renegociação de sessão.
//
// Essa renegociação é ROTINA e não é erro: ao enviar uma mensagem (ex.:
// a enquete do /eununca) a Baileys valida as sessões dos dispositivos do
// destinatário (assertSessions) e, quando precisa de prekeys novos —
// identidade trocada, retry com "Bad MAC", sessão sem canal aberto — ela
// busca o bundle, injeta a sessão nova e a antiga é FECHADA
// (session_builder.initOutgoing → closeSession → o log
// "Closing session: SessionEntry {...}" que aparece no console).
// A mensagem segue enviada normalmente pelo caminho novo.
//
// Este módulo envolve console.info/console.warn e reescreve SÓ esses
// avisos numa linha resumida; qualquer outra chamada passa intacta.
// ❌ NÃO toca em node_modules (sobrevive a npm install / redeploy).
//
// Uso: require('./func/log-signal') uma única vez, no topo do bot.js.
// ============================================================

// Chaves EXATAS do 1º argumento que o libsignal manda com a SessionEntry
// inteira como 2º argumento → resumo de UMA linha no lugar do dump.
const RESUMOS = {
  'Closing session:': '🔒 sessão Signal encerrada (substituída por nova — renegociação automática, sem impacto no envio)',
  'Session already closed': '⚠️ sessão Signal já estava encerrada',
  'Opening session:': '🔓 sessão Signal reaberta',
  'Removing old closed session:': '🧹 sessão Signal antiga removida do cache'
}

let instalado = false

// Idempotente: require várias vezes (ou require + chamada manual) não
// reenvolve o console duas vezes.
function instalar() {
  if (instalado) return false
  instalado = true
  for (const metodo of ['info', 'warn']) {
    const original = console[metodo].bind(console)
    console[metodo] = (...args) => {
      const resumo = typeof args[0] === 'string' ? RESUMOS[args[0]] : undefined
      if (resumo) return original(`[signal] ${resumo}`)
      return original(...args)
    }
  }
  return true
}

// Instala já no require (é para ser chamado no topo do bot.js).
instalar()

module.exports = { RESUMOS, instalar }