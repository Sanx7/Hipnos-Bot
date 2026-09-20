const fs = require('fs')
const arquivos = [
  'comandos/menu-utilitario/lembrete.js',
  'comandos/menu-utilitario/meuslembretes.js',
  'scripts/teste-lembretes.js'
]
for (const f of arquivos) {
  let c
  try {
    c = fs.readFileSync(f, 'utf8')
  } catch (e) {
    console.log(f + ' : AUSENTE (' + e.code + ')')
    continue
  }
  const antes = (c.match(/\r\\n/g) || []).length
  c = c.replace(/\r\\n/g, '\r\n')
  fs.writeFileSync(f, c)
  console.log(f + ' : ' + antes + ' quebras restauradas')
}
