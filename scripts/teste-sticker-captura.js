// 🧪 TESTE DO BUG "/s COM LEGENDA" — captura de mídia do /sticker
// ============================================================
// Cobre a causa raiz e os caminhos de captura SEM depender do WhatsApp:
//
//   PARTE 1 — extração do texto do comando (dados/texto-comando.js):
//     é o que faz uma FOTO com "/s" na LEGENDA chegar ao roteador (antes o
//     text ficava vazio → comando nunca roteado → só reply funcionava);
//
//   PARTE 2 — captura de mídia do /sticker (comandos/menu-fig/sticker.js):
//     mídia DIRETA (com o comando na legenda) e mídia CITADA (reply), com
//     prioridade para a direta, + view-once e o aviso de "como usar".
//     `downloadContentFromMessage` é substituído por um stub (nada de rede)
//     e o VIP é forçado a true via __definirColecaoTeste (pula o cooldown).
//
// Uso: node scripts/teste-sticker-captura.js
// ============================================================

// ── 💠 VIP: collection fake fazendo todo mundo VIP (isVip → true) ──
// Assim o cooldown de 3min do /s não interfere entre os cenários.
const vip = require('../vip')
const vipsFake = {
  async findOne() {
    return { numero: 'qualquer', expira_em: Date.now() + 60 * 60 * 1000 }
  },
  async deleteOne() { return { deletedCount: 0 } },
  async updateOne() { return { modifiedCount: 1 } },
  async find() { return { async toArray() { return [] } } }
}
vip.__definirColecaoTeste(vipsFake)

// ── 📥 Stub do download de mídia (Baileys) — precisa vir ANTES do require
//    do sticker.js, que desestrutura a função no carregamento do módulo ──
const baileys = require('@whiskeysockets/baileys')
// Registro do nó exato entregue ao download; sem rede nem conversão.
const downloads = []
const baixarMidiaTeste = async (no, tipo) => {
  downloads.push({ tipo, no })
  // Interrompe antes da conversão: este teste verifica somente a captura.
  throw new Error('Interrupção controlada do teste de captura')
}

const { extrairTextoComando } = require('../dados/texto-comando')
// A Baileys pode expor um namespace ESM imutável. Injeta uma cópia das
// dependências ao carregar o comando, sem modificar exportações da biblioteca.
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const caminhoComando = require.resolve('../comandos/menu-fig/sticker')
const requireComando = createRequire(caminhoComando)
const moduloComando = { exports: {} }
const carregar = vm.runInThisContext(
  '(function(require, module, exports, __filename, __dirname) {\n' + fs.readFileSync(caminhoComando, 'utf8') + '\n})',
  { filename: caminhoComando }
)
carregar(nome => nome === '@whiskeysockets/baileys'
  ? { ...baileys, downloadContentFromMessage: baixarMidiaTeste }
  : requireComando(nome), moduloComando, moduloComando.exports, caminhoComando, path.dirname(caminhoComando))
const sticker = moduloComando.exports

// ── Sock fake: guarda tudo o que o comando envia ──
const GRUPO = '12036@g.us'
let enviados = []
const sockFake = {
  async sendMessage(jid, conteudo) {
    enviados.push({ jid, conteudo, texto: conteudo?.text || '', sticker: conteudo?.sticker || null })
    return {}
  }
}
const ultimo = () => enviados.at(-1)

const msgMidia = (sender, { image, video, caption, quoted } = {}) => {
  const conteudo = {}
  if (image) conteudo.imageMessage = { ...image, ...(caption ? { caption } : {}) }
  if (video) conteudo.videoMessage = { ...video, ...(caption ? { caption } : {}) }
  if (quoted) conteudo.extendedTextMessage = { text: caption || '/s', contextInfo: { quotedMessage: quoted } }
  return { key: { remoteJid: GRUPO, participant: sender }, message: conteudo, pushName: 'Teste' }
}

let ok = 0
let falhou = 0
function checar(rotulo, condicao) {
  if (condicao) { ok += 1; console.log('✅', rotulo) } else { falhou += 1; console.log('❌', rotulo) }
}

async function testar(rotulo, conteudo, esperado, tipo) {
  downloads.length = 0
  enviados = []
  const msg = { key: { remoteJid: GRUPO, participant: '5511999999999@s.whatsapp.net' }, message: conteudo }
  checar(rotulo + ': texto chega ao roteador', extrairTextoComando(msg) === '/sticker')
  await sticker.executar(sockFake, GRUPO, msg, extrairTextoComando(msg))
  if (esperado) {
    checar(rotulo + ': nó e tipo corretos no download', downloads.length === 1 && downloads[0].no === esperado && downloads[0].tipo === tipo)
  } else {
    checar(rotulo + ': orienta legenda e reply sem baixar mídia', downloads.length === 0 && /legenda/.test(ultimo()?.texto) && /Responda/.test(ultimo()?.texto))
  }
}

;(async () => {
  const foto = { caption: '/sticker' }
  const video = { caption: '/sticker', seconds: 3 }
  const reply = (quotedMessage) => ({ extendedTextMessage: { text: '/sticker', contextInfo: { quotedMessage } } })
  checar('Alias /sticker registrado', sticker.aliases.includes('sticker'))
  await testar('Foto com legenda', { imageMessage: foto }, foto, 'image')
  await testar('Foto citada', reply({ imageMessage: foto }), foto, 'image')
  await testar('Vídeo com legenda', { videoMessage: video }, video, 'video')
  await testar('Vídeo citado', reply({ videoMessage: video }), video, 'video')
  await testar('Comando sem mídia', { conversation: '/sticker' })
  const fotoDireta = { ...foto, contextInfo: { quotedMessage: { videoMessage: video } } }
  await testar('Foto direta vence vídeo citado', { imageMessage: fotoDireta }, fotoDireta, 'image')
  const videoDireto = { ...video, contextInfo: { quotedMessage: { imageMessage: foto } } }
  await testar('Vídeo direto vence foto citada', { videoMessage: videoDireto }, videoDireto, 'video')
  await testar('Legenda em mensagem temporária', { ephemeralMessage: { message: { imageMessage: foto } } }, foto, 'image')
  await testar('Reply em mensagem temporária', { ephemeralMessage: { message: reply({ imageMessage: foto }) } }, foto, 'image')
  await testar('Mídia citada encapsulada', reply({ viewOnceMessageV2: { message: { videoMessage: video } } }), video, 'video')
  downloads.length = 0
  await sticker.executar(sockFake, GRUPO, msgMidia('5511999999999@s.whatsapp.net', { video: { seconds: 11 }, caption: '/sticker' }), '/sticker')
  checar('Vídeo longo mantém limite de 10s', downloads.length === 0 && /Limite de 10 segundos/.test(ultimo()?.texto))
  checar('Sem legenda não inventa comando', extrairTextoComando({ imageMessage: {} }) === '')
  checar('Texto simples preservado', extrairTextoComando({ conversation: '/s' }) === '/s')
  console.log(`Resultado: ${ok} aprovados; ${falhou} falhas.`)
  process.exitCode = falhou ? 1 : 0
})().catch(err => { console.error('Falha no teste de captura:', err); process.exitCode = 1 })
