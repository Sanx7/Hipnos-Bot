// ============================================================
// 🧪 Teste offline do LOADER de comandos — réplica da lógica do
// bot.js (carregarComandos), sem conectar no WhatsApp.
//
// Confirma que TODOS os comandos carregam sem erro e que o
// registro ficou íntegro (nome/executar + aliases).
//
// Uso (na raiz do projeto):  node scripts/teste-loader.js
// ============================================================
// Não permitir que config.js carregue credenciais reais do .env neste teste.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
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
            if (item?.nome && item.executar) {
              comandos.set(item.nome, item)
              for (const alias of item.aliases || []) {
                if (typeof alias === 'string' && alias && !comandos.has(alias)) comandos.set(alias, item)
              }
            }
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
for (const nome of ['ranking', 'rankativo', 'inativos', 'sairgrupo', 'sairdogrupo', 'sairgp', 'leavegp', 'comunicado', 'avisogeral', 'broadcast', 'anunciar']) {
  if (typeof comandos.get(nome)?.executar !== 'function') process.exitCode = 1
}
const comunicado = require('../comandos/menu-dono/comunicado')
for (const nome of [comunicado.nome, ...comunicado.aliases]) {
  if (comandos.get(nome) !== comunicado) process.exitCode = 1
}
for (const cmd of [require('../comandos/menu-brincadeiras/enquete')[0], require('../comandos/admin/enquete-admin')[0], require('../comandos/menu-brincadeiras/eununca'), require('../comandos/admin/totag')]) {
  for (const nome of [cmd.nome, ...cmd.aliases]) {
    if (comandos.get(nome) !== cmd) process.exitCode = 1
  }
}
for (const cmd of [...require('../comandos/admin/figurinhas-moderacao'), ...require('../comandos/admin/advertencias-consultas')]) {
  if (comandos.get(cmd.nome) !== cmd) {
    console.error(`❌ Implementação inesperada para /${cmd.nome}`)
    process.exitCode = 1
  }
}
const lembretesPrincipal = require('../comandos/meuslembretes')
const lembretesUtilitario = require('../comandos/menu-utilitario/meuslembretes')
for (const [nome, esperado] of [
  ['meuslembretes', lembretesPrincipal], ['lembretes', lembretesPrincipal],
  ['listalembretes', lembretesPrincipal], ['meus-lembretes', lembretesUtilitario]
]) {
  if (comandos.get(nome) !== esperado) {
    console.error(`❌ Implementação inesperada para /${nome}`)
    process.exitCode = 1
  }
}
if (process.exitCode === 1) {
  console.log('❌ FALHOU: algum módulo não carregou ou o /play sumiu do registro.')
} else {
  console.log('✅ Loader OK — todos os comandos carregaram sem erro.')
}
