// ============================================================
// 🧪 Teste offline do LOADER de comandos — réplica da lógica do
// bot.js (carregarComandos), sem conectar no WhatsApp.
//
// Confirma que TODOS os comandos carregam sem erro e que o
// registro ficou íntegro (nome/executar + aliases).
//
// Uso (na raiz do projeto):  node scripts/teste-loader.js
// ============================================================
const fs = require('fs')
const path = require('path')
const { comandos } = require('../comandos-registry')

function carregarComandos(pasta) {
  const arquivos = fs.readdirSync(pasta)
  for (const arquivo of arquivos) {
    const caminho = path.join(pasta, arquivo)
    if (fs.statSync(caminho).isDirectory()) {
      carregarComandos(caminho)
    } else if (arquivo.endsWith('.js')) {
      try {
        const comando = require(caminho)
        if (Array.isArray(comando)) {
          for (const item of comando) {
            if (item?.nome && item.executar) comandos.set(item.nome, item)
            else console.log(`⚠️ Item ignorado em ${arquivo}: sem nome/executar`)
          }
          continue
        }
        if (comando.nome && comando.executar) {
          comandos.set(comando.nome, comando)
          if (Array.isArray(comando.aliases)) {
            for (const apelido of comando.aliases) {
              if (apelido && typeof apelido === 'string' && !comandos.has(apelido)) {
                comandos.set(apelido, comando)
              }
            }
          }
        } else {
          console.log(`⚠️ Item ignorado em ${arquivo}: sem nome/executar`)
        }
      } catch (err) {
        console.log(`❌ Erro ao carregar ${arquivo}`)
        console.log(err)
        process.exitCode = 1
      }
    }
  }
}

const pastaComandos = path.join(__dirname, '..', 'comandos')
if (fs.existsSync(pastaComandos)) carregarComandos(pastaComandos)

console.log('')
console.log('📊 Entradas no registro (comandos + aliases):', comandos.size)
console.log('🎧 /play registrado?', comandos.has('play') ? '✅ SIM' : '❌ NÃO')

if (process.exitCode !== 1 && !comandos.has('play')) process.exitCode = 1
if (process.exitCode === 1) {
  console.log('❌ FALHOU: algum módulo não carregou ou o /play sumiu do registro.')
} else {
  console.log('✅ Loader OK — todos os comandos carregaram sem erro.')
}
