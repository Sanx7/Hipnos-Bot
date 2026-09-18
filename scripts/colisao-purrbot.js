// ============================================
// 🔎 colisao-purrbot.js — checagem de nomes (ANÁLISE, não implementação)
// Percorre comandos/ com o mesmo algoritmo do loader e verifica quais
// candidatos de comando da Purrbot já estão ocupados no registro.
// Uso: node scripts/colisao-purrbot.js
// ============================================
const fs = require('fs')
const path = require('path')

const nomes = new Map()
function carregar (pasta) {
  for (const item of fs.readdirSync(pasta)) {
    const caminho = path.join(pasta, item)
    const stat = fs.statSync(caminho)
    if (stat.isDirectory()) { carregar(caminho); continue }
    if (!item.endsWith('.js') || item.endsWith('.bak')) continue
    try {
      const mod = require(caminho)
      const itens = Array.isArray(mod) ? mod : [mod]
      for (const comando of itens) {
        if (!comando || !comando.nome) continue
        const rel = path.relative(path.join(__dirname, '..'), caminho)
        if (!nomes.has(comando.nome)) nomes.set(comando.nome, `${rel}`)
        for (const apelido of comando.aliases || []) {
          if (!nomes.has(apelido)) nomes.set(apelido, `${rel} (alias de ${comando.nome})`)
        }
      }
    } catch (err) {
      nomes.set(`ERRO:${item}`, String(err.message).slice(0, 60))
    }
  }
}
carregar(path.join(__dirname, '..', 'comandos'))

// Candidatos: ações SFW confirmadas vivas na Purrbot (sonda ao vivo) +
// os exemplos pedidos pelo usuário + comandos já implementados no bot
const candidatos = [
  'abracar', 'abraco', 'beijar', 'beijo', 'morder', 'mordida', 'lamber', 'tapa',
  'comer', 'sentar', 'soco', 'chute', 'carinho', 'cutucada', 'aconchego',
  'kiss', 'kissme', 'ship', 'shipme', 'sfundo',
  'hug', 'bite', 'lick', 'slap', 'pat', 'poke', 'pout', 'tickle', 'tail',
  'smile', 'cuddle', 'blush', 'cry', 'comfy', 'lay', 'dance', 'angry', 'fluff',
  'yaoi', 'yuri'
]

console.log(`📊 Registro atual: ${nomes.size} entradas (nome + aliases)\n`)
for (const c of candidatos) {
  console.log(nomes.has(c) ? `❌ ${c} — JÁ EXISTE: ${nomes.get(c)}` : `✅ ${c} — livre`)
}
