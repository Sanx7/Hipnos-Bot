// ============================================================
// 🎨 CORES-VIP — o emoji do /corvip traduzido para uma cor de verdade
// ============================================================
// O campo `corVip` (vip.js) guarda UM emoji escolhido pelo VIP. Onde não dá
// para desenhar emoji — o quadro do /ranking e o cartaz do /procurado, feitos
// com Jimp — esse emoji vira a COR do nome: mesma informação, sem depender de
// glifo.
//
//   • os 10 emojis que o `/corvip lista` sugere têm cor FIXA (MAPA_COR_VIP);
//   • qualquer outro emoji válido cai na PALETA_AUXILIAR, escolhida por hash
//     dos codepoints: o MESMO emoji dá SEMPRE a mesma cor (nada de aleatório —
//     o pergaminho precisa sair igual toda vez que for gerado);
//   • sem cor definida ('' / null / undefined) devolve COR_PADRAO, a tinta
//     padrão do pergaminho (o nome volta a ser texto comum).
//
// 🎯 Legibilidade: todas as cores são escuras o bastante para virar tinta em
// pergaminho claro (fundo ~#e7d4a9) — nada de amarelo claro ou pastel.
// ============================================================

// 🎨 Cor fixa dos emojis sugeridos no `/corvip lista` (vip.SUGESTOES_COR_VIP).
// ⚠️ Todas DISTINTAS: dois VIPs com cores diferentes não podem parecer iguais.
const MAPA_COR_VIP = {
  '🔥': '#b8352a', // brasa
  '💎': '#1f7a8c', // azul-gema
  '👑': '#a2740f', // ouro velho
  '🌙': '#2d4f8a', // azul-noite
  '⚡': '#bf6b0a', // âmbar
  '🦋': '#6a2f9e', // roxo-borboleta
  '🐺': '#575757', // cinza-lobo
  '👻': '#7a5f9e', // lilás espectral
  '🌹': '#a8325f', // rosa-escuro
  '🍀': '#2f7d32' // verde-trevo
}

// 🎨 Reserva para emojis fora das sugestões (o /corvip aceita qualquer um).
// Escolhida por hash do emoji: estável, escura e sem repetir o mapa fixo.
const PALETA_AUXILIAR = [
  '#8b3a2f', // terracota
  '#2f6f63', // verde-mar
  '#7a4a1f', // caramelo
  '#3f4f8a', // índigo
  '#6b3f7a', // ameixa
  '#4a6b2f', // oliva
  '#8a2f4f', // vinho-rosa
  '#2f5f8a', // azul-aço
  '#5e4a1f', // mostarda escura
  '#4b4b4b' // grafite
]

// 🖋️ Tinta padrão (nenhuma cor escolhida) — o mesmo marrom-escuro do
// pergaminho, para o nome parecer escrito à mão na carta.
const COR_PADRAO = '#3b2a18'

// Hash estável dos codepoints do emoji (soma ponderada simples).
function hashDoEmoji (texto) {
  let soma = 7
  for (const ch of String(texto)) {
    soma = (soma * 31 + ch.codePointAt(0)) % 1000000007
  }
  return soma
}

// 🎨 Emoji do /corvip → hex "#rrggbb". NUNCA lança (entrada estranha cai no
// padrão): o pergaminho não pode cair por causa de um emoji esquisito.
function corDoEmoji (emoji) {
  const limpo = String(emoji ?? '').trim()
  if (!limpo) return COR_PADRAO
  if (MAPA_COR_VIP[limpo]) return MAPA_COR_VIP[limpo]
  return PALETA_AUXILIAR[hashDoEmoji(limpo) % PALETA_AUXILIAR.length]
}

module.exports = {
  MAPA_COR_VIP,
  PALETA_AUXILIAR,
  COR_PADRAO,
  hashDoEmoji,
  corDoEmoji
}
