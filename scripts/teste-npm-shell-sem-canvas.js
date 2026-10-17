// Valida o shell sem rede, npm install ou alteração de node_modules.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const sh = process.env.TEST_SH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/sh.exe' : '/bin/sh')
const script = path.resolve(__dirname, 'npm-shell-sem-canvas.sh').replace(/\\/g, '/')
let total = 0
function testar(flag, pacote, evento, comando, status, omitido) {
  const r = spawnSync(sh, [script, '-c', comando], {
    encoding: 'utf8', env: { ...process.env, DISABLE_CANVAS: flag, npm_package_name: pacote, npm_lifecycle_event: evento }
  })
  assert.ifError(r.error)
  assert.equal(r.status, status, r.stderr)
  assert.equal(r.stderr.includes('instalação nativa omitida'), omitido)
  total++
}
testar('true', 'canvas', 'install', 'exit 23', 0, true)
testar('false', 'canvas', 'install', 'exit 23', 23, false)
testar('', 'canvas', 'install', 'exit 23', 23, false)
for (const pacote of ['sharp', '@ffmpeg-installer/linux-x64', '@whiskeysockets/baileys', 'protobufjs', 'hipnos-bot']) {
  testar('true', pacote, 'install', 'exit 0', 0, false)
  testar('true', pacote, 'install', 'exit 23', 23, false)
}
for (const evento of ['preinstall', 'postinstall']) testar('true', 'canvas', evento, 'exit 23', 23, false)
const r = spawnSync(sh, [script, '-c', 'printf "%s" "$HIPNOS_PROVA_SCRIPT"'], {
  encoding: 'utf8', env: { ...process.env, DISABLE_CANVAS: 'true', npm_package_name: 'outra-lib', npm_lifecycle_event: 'install', HIPNOS_PROVA_SCRIPT: 'script executado' }
})
assert.equal(r.status, 0)
assert.equal(r.stdout, 'script executado')
console.log(`OK: ${total + 1} verificações; só o install do Canvas é omitido, comandos e falhas das outras bibliotecas são preservados.`)
