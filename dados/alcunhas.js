// ============================================
// ⚔️ ALCUNHAS — o título de guerra de cada pessoa (dados/alcunhas.js)
// ============================================
// Todo mundo tem uma alcunha. Ela é TEMÁTICA (mítica grega, de guerra) e
// serve de "apelido de guerra" do jogador — é ela que aparece no cartaz de
// procurado do /procurado.
//
// 🎲 COMO ESCOLHE (determinístico, SEM data):
//   Hash FNV-1a do NÚMERO da pessoa (o MESMO algoritmo do /horoscopo em
//   comandos/menu-utilitario/horoscopo.js — 2166136261, XOR do byte,
//   Math.imul por 16777619, `>>> 0 no fim) e o resto da divisão pelo tamanho
//   do banco escolhe a alcunha.
//
//   Por que NADA de data e nada de Math.random: a alcunha é uma identidade.
//   Se ela mudasse todo dia, o nome de guerra de alguém seria outro às 3 da
//   manhã e o cartaz de procurado trocaria de título sem motivo. Como a
//   entrada é só o número, a MESMA pessoa recebe SEMPRE a MESMA alcunha —
//   no /procurado, no texto e depois de reiniciar o Render.
//
// 🎯 Por que o banco é grande (36 alcunhas): com o FNV-1a os números reais
// (55..., 11 digits) espalham bem pelos índices, então o número baixo de
// repetição nunca fica crowded num punhado de alcunhas.
// ============================================

// ⚔️ O banco. Ordem FIXA: mudar a lista mudaria a alcunha de todo mundo,
// então acrescente ao FINAL (nunca no meio), para não embaralhar as antigas.
const ALCUNHAS = [
  'Devorador de Deuses',
  'Flagelo do Olimpo',
  'Matador Implacável',
  'Punho de Zeus',
  'Sombra de Ares',
  'Trovão do Mediterrâneo',
  'Lâmina de Ares',
  'Coroa de Espinhos',
  'Garra de Leonidas',
  'Voz do Abismo',
  'Caminho de Cinzas',
  'Ferro de Esparta',
  'Fera do Trono',
  'Eclipse de Titã',
  'Fio da Navalha',
  'Grito de Guerra',
  'Herdeiro do Trovão',
  'Ídolo de Mármore',
  'Julgamento Final',
  'Lâmina Sagrada',
  'Maldição do Mar',
  'Nocaute Divino',
  'Olho de Águia',
  'Punhal do Olimpo',
  'Quebra-Mundo',
  'Rei das Sombras',
  'Sentença do Trono',
  'Sismo de Titã',
  'Tempestade de Bronze',
  'Terramoto de Zeus',
  'Última Sentença',
  'Vingança Ancestral',
  'Voz do Trovão',
  'Zeus de Bolso',
  'Brasa do Olimpo',
  'Coroa de Ferro'
]

// -------------------------------------------------------------------
// 🔢 Hash FNV-1a de 32 bits — o MESMO do /horoscopo (mantido aqui
// autossuficiente: dados/ não depende de nada, e assim o banco de
// alcunhas pode ser usado por qualquer comando sem puxar o horoscopo).
// -------------------------------------------------------------------
function hashFnv1a (texto) {
  let hash = 2166136261
  for (let i = 0; i < texto.length; i += 1) {
    hash ^= texto.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// -------------------------------------------------------------------
// ⚔️ alcunhaPadrao(numero): a alcunha padrão da pessoa.
// Só o NÚMERO entra na conta — determinístico e sem data, como combinado.
//
// Entrada tolerante (a mesma normalização do /ranking e do /perfil):
//   "5511999999999", "5511999999999@s.whatsapp.net", "5511999999999@lid" e
//   "5511999999999:12@s.whatsapp.net" caem TODOS na MESMA alcunha — o `:12`
//   é o id de dispositivo e não pode entrar no hash, senão a mesma pessoa
//   teria duas alcunhas diferentes dependendo de como o JID chegou.
//
// Sem número reconhecível devolve a primeira do banco (nunca lança nem
// devolve string vazia — o cartaz de procurado precisa sempre de um título).
// -------------------------------------------------------------------
function apenasNumero (valor) {
  return String(valor ?? '').split('@')[0].split(':')[0].replace(/\D/g, '')
}

function alcunhaPadrao (numero) {
  const digitos = apenasNumero(numero)
  if (!digitos) return ALCUNHAS[0]
  return ALCUNHAS[hashFnv1a(digitos) % ALCUNHAS.length]
}

module.exports = {
  ALCUNHAS,
  hashFnv1a,
  apenasNumero,
  alcunhaPadrao
}
