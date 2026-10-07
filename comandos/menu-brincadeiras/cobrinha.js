const criarComando = require('../../dados/jogos-turnos')
const vetores = { cima: [0, -1], baixo: [0, 1], esquerda: [-1, 0], direita: [1, 0] }
const acoes = { cima: 'cima', w: 'cima', baixo: 'baixo', s: 'baixo', esquerda: 'esquerda', a: 'esquerda', direita: 'direita', d: 'direita' }
const iguais = (a,b) => a.x === b.x && a.y === b.y
function comida(cobra) {
  const livres = []
  for (let y=0; y<8; y++) for (let x=0; x<8; x++) if (!cobra.some(p => p.x === x && p.y === y)) livres.push({x,y})
  return livres.length ? livres[Math.floor(Math.random() * livres.length)] : null
}
function render(estado) {
  const linhas = []
  for (let y=0; y<8; y++) {
    let linha = ''
    for (let x=0; x<8; x++) {
      const p = {x,y}
      linha += iguais(estado.cobra[0],p) ? '🐍' : estado.cobra.some(c => iguais(c,p)) ? '🟩' : estado.comida && iguais(estado.comida,p) ? '🍎' : '⬛'
    }
    linhas.push(linha)
  }
  return `${linhas.join('\n')}\n🏆 Pontuação: ${estado.pontos}`
}
module.exports = criarComando({
  nome: 'cobrinha',
  instrucoes: '🐍 COBRINHA DO LIMBO\nSó quem iniciou joga: cima/w, baixo/s, esquerda/a, direita/d. Coma 🍎, evite paredes e o próprio corpo. Não pode inverter a direção. Envie desistir ou /cobrinha desistir. Inatividade: 2 minutos.',
  normalizar: (acao) => Object.hasOwn(acoes, acao) ? acoes[acao] : null,
  criar() { const cobra = [{x:3,y:3},{x:2,y:3},{x:1,y:3}]; return { cobra, comida: comida(cobra), direcao: 'direita', pontos: 0 } },
  render,
  jogar(estado, direcao) {
    const [dx,dy] = vetores[direcao]
    const [ax,ay] = vetores[estado.direcao]
    if (dx === -ax && dy === -ay) return { fim: false, valida: false, texto: '↩️ Não pode inverter a direção diretamente. Escolha outra direção.' }
    const cabeca = {x:estado.cobra[0].x+dx,y:estado.cobra[0].y+dy}
    const comeu = estado.comida && iguais(cabeca,estado.comida)
    // A cauda sai nesta rodada; entrar na célula que ela libera é válido.
    const corpo = comeu ? estado.cobra : estado.cobra.slice(0,-1)
    if (cabeca.x < 0 || cabeca.x > 7 || cabeca.y < 0 || cabeca.y > 7 || corpo.some(p => iguais(p,cabeca))) return { fim: true, texto: `💥 Colisão! Pontuação final: ${estado.pontos}.` }
    estado.direcao = direcao
    estado.cobra.unshift(cabeca)
    if (comeu) { estado.pontos++; estado.comida = comida(estado.cobra) }
    else estado.cobra.pop()
    if (!estado.comida) return { fim: true, texto: `🏆 Vitória! Você preencheu o tabuleiro. Pontuação final: ${estado.pontos}.` }
    return { fim: false, texto: comeu ? '🍎 Boa! A cobra cresceu.' : '🐍 Próxima jogada!' }
  },
  comida
})
