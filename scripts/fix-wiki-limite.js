const fs = require('fs')
const p = 'comandos/utilitario/wiki.js'
let t = fs.readFileSync(p, 'utf8')
const alvo = "const USER_AGENT = 'HipnosBot/1.0 (https://github.com/Sanx7/Hipnos-Bot)'"
if (!t.includes(alvo)) {
  console.log('ALVO_NAO_ACHADO')
  process.exit(1)
}
if (t.includes('LIMITE_BYTES_IMAGEM = 10')) {
  console.log('JA_EXISTE')
  process.exit(0)
}
t = t.replace(alvo, alvo + "\n\n// Limite defensivo do download da miniatura (10 MB).\nconst LIMITE_BYTES_IMAGEM = 10 * 1024 * 1024")
fs.writeFileSync(p, t)
console.log('CONST_OK')
