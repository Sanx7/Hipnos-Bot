// ============================================
// 🎨 temas-vip.js — Paletas de cor dos cards VIP (/temavip)
// ============================================
// Fonte ÚNICA dos esquemas de cores que o VIP escolhe com o /temavip e que
// os geradores de card aplicam nas cores de FUNDO / TEXTO / DESTAQUE:
//   - /perfil: card com a foto do usuário (fundo + moldura/faixa + nome);
//   - /ship, /shipme, /kiss, /kissme (efeitos-imagem.js): cena de par;
//   - qualquer novo card que queira seguir o tema — é só pedir a paleta.
//
// O ESCOLHIDO fica gravado como campo `temaVip` no documento de VIP do
// Mongo (vip.js — mesma collection dos campos nomeCustom/corVip/assinatura);
// este módulo NÃO toca em banco: é puro dados + helpers de cor, sem
// dependências (não requer o vip.js — o vip.js é que requer ESTE, sem ciclo).
//
// Sem tema definido (mortal, VIP sem escolha ou `/temavip remover`) os
// geradores continuam exatamente como hoje: as cores fixas deles são o
// fallback e a paleta `padrao` espelha essas mesmas cores.
//
// Regras das paletas (o /temavip lista as três cores de cada tema):
//   - fundo/texto/destaque em hex "#rrggbb" (sem alfa);
//   - `texto` legível sobre `fundo` E sobre `destaque` (é impresso na faixa);
//   - `destaque` NUNCA é branco puro (#ffffff): o card do /perfil pinta o
//     nome impresso pelo jimp recolorindo só os pixels brancos da faixa.
// ============================================

// 🎨 Os 5 temas, na ordem em que o /temavip lista.
// `padrao` espelha as cores ATUAIS do card de par (fundo do WhatsApp dark,
// texto branco, roxo do anel do /ship) para o VIP sentir "é o de sempre".
const TEMAS = Object.freeze({
  padrao: Object.freeze({
    nome: 'padrão',
    emoji: '🌑',
    descricao: 'As cores de sempre (WhatsApp dark, branco e roxo).',
    fundo: '#0b141a',
    texto: '#ffffff',
    destaque: '#7c3aed'
  }),
  neon: Object.freeze({
    nome: 'neon',
    emoji: '⚡',
    descricao: 'Noite preta com neon magenta gritando.',
    fundo: '#0a0a14',
    texto: '#e8fff9',
    destaque: '#ff2e97'
  }),
  pastel: Object.freeze({
    nome: 'pastel',
    emoji: '🌸',
    descricao: 'Fundo rosa clarinho, roxo suave e bordô delicado.',
    fundo: '#fdeef5',
    texto: '#4a3f55',
    destaque: '#b8a8e8'
  }),
  escuro: Object.freeze({
    nome: 'escuro',
    emoji: '🕳️',
    descricao: 'Preto quase absoluto com cinza-azulado de contraste.',
    fundo: '#101018',
    texto: '#e6e6f0',
    destaque: '#5a5f7d'
  }),
  dourado: Object.freeze({
    nome: 'dourado',
    emoji: '👑',
    descricao: 'Bordô… não: marrom-noite com ouro reluzente.',
    fundo: '#17110a',
    texto: '#ffe9b0',
    destaque: '#c9971b'
  })
})

const TEMA_PADRAO = 'padrao'

// -------------------------------------------------------------------
// 🧼 normalizarNomeTema(texto): minúsculas, sem acento e sem pontas —
// "/temavip Dourado" e "/temavip dourado" caem no mesmo tema.
// -------------------------------------------------------------------
function normalizarNomeTema(textoBruto) {
  return String(textoBruto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// 📋 listarTemas(): os 5 na ordem, com cores e a CHAVE digitável no
// /temavip (`chave` é o que está gravado em `temaVip`; `nome` é a forma
// amigável exibida nas mensagens).
function listarTemas() {
  return Object.entries(TEMAS).map(([chave, paleta]) => ({ chave, ...paleta }))
}

// 📋 listarNomes(): só os nomes normalizados (p/ as mensagens de recusa).
function listarNomes() {
  return Object.keys(TEMAS)
}

// ✅ temaExiste(nome): o nome JÁ normalizado está no catálogo?
function temaExiste(nome) {
  return Object.prototype.hasOwnProperty.call(TEMAS, String(nome ?? ''))
}

// 🎨 obterPaleta(nome): paleta do tema (nome normalizado na entrada) ou —
// tema desconhecido/ausente — a paleta `padrao`. NUNCA lança.
function obterPaleta(nome) {
  const normalizado = normalizarNomeTema(nome)
  return { ...(temaExiste(normalizado) ? TEMAS[normalizado] : TEMAS[TEMA_PADRAO]) }
}

// 🧪 Hex "#rrggbb" → [r, g, b] (0-255). Lança em hex inválido de propósito:
// quem chama já validou a paleta; um tema corrompido precisa gritar no teste.
function hexParaRgb(hex) {
  const limpo = String(hex || '').replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) throw new Error(`hex inválido: ${hex}`)
  return [
    parseInt(limpo.slice(0, 2), 16),
    parseInt(limpo.slice(2, 4), 16),
    parseInt(limpo.slice(4, 6), 16)
  ]
}

// 🖌️ Hex "#rrggbb" → número 0xRRGGBBFF (formato de cor do jimp).
function hexParaJimp(hex) {
  const [r, g, b] = hexParaRgb(hex)
  return (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0)
}

// 🖌️ Hex "#rrggbb" → string "#rrggbb" pronta pro canvas (ctx.fillStyle).
// Trivial de propósito: deixa a chamada explícita nos geradores.
function hexParaCanvas(hex) {
  return String(hex)
}

module.exports = {
  TEMAS,
  TEMA_PADRAO,
  normalizarNomeTema,
  listarTemas,
  listarNomes,
  temaExiste,
  obterPaleta,
  hexParaRgb,
  hexParaJimp,
  hexParaCanvas
}
