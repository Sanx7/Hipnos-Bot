const criarComando = require('../../dados/jogos-turnos')
const acoes = { p: 'pular', pular: 'pular', s: 'seguir', seguir: 'seguir' }
function chance(pontos) { return Math.min(0.85, 0.25 + pontos * 0.03) }
function obstaculo(pontos) {
  return Math.random() < chance(pontos) ? (Math.random() < 0.5 ? 'cacto' : 'galho') : 'livre'
}
module.exports = criarComando({
  nome: 'dino',
  instrucoes: '🦖 DINO DO LIMBO\nSó quem iniciou joga: pular/p salta o 🌵; seguir/s passa sob o 🌿. Caminho livre aceita ambos. Envie desistir ou /dino desistir para encerrar. Inatividade: 2 minutos.',
  normalizar: (acao) => Object.hasOwn(acoes, acao) ? acoes[acao] : null,
  criar: () => ({ pontos: 0, obstaculo: obstaculo(0) }),
  render: (estado) => `🦖 ─── ${estado.obstaculo === 'cacto' ? '🌵 Cacto: pule!' : estado.obstaculo === 'galho' ? '🌿 Galho baixo: siga sem pular!' : '🟦 Caminho livre'}\n🏆 Pontuação: ${estado.pontos}`,
  jogar(estado, acao) {
    if ((estado.obstaculo === 'cacto' && acao !== 'pular') || (estado.obstaculo === 'galho' && acao !== 'seguir')) return { fim: true, texto: `💥 Colisão! Hipnos recolheu seu dinossauro. Pontuação final: ${estado.pontos}.` }
    estado.pontos++
    estado.obstaculo = obstaculo(estado.pontos)
    return { fim: false, texto: '✅ Rodada vencida! Prepare o próximo movimento.' }
  },
  chance
})
