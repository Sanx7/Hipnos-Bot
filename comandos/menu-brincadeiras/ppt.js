const prefixo = require('../../prefixo')
const opcoes = ['pedra', 'papel', 'tesoura']
const aliasesJogada = { pedra: 'pedra', p: 'pedra', pe: 'pedra', papel: 'papel', pa: 'papel', tesoura: 'tesoura', t: 'tesoura', te: 'tesoura' }
const emojis = { pedra: '🪨', papel: '📄', tesoura: '✂️' }
const vence = { pedra: 'tesoura', papel: 'pedra', tesoura: 'papel' }
module.exports = {
  nome: 'ppt', aliases: ['jokenpo', 'pedrapapeltesoura'],
  async executar(sock, jid, msg, texto) {
    const argumento = prefixo.removerPrefixo(texto || '').trim().split(/\s+/).slice(1).join(' ').toLowerCase()
    const jogador = Object.hasOwn(aliasesJogada, argumento) ? aliasesJogada[argumento] : null
    let text
    if (!jogador) text = '🪨📄✂️ Use /ppt pedra, papel ou tesoura. Atalhos: p = pedra, pa = papel, t = tesoura.'
    else {
      const bot = opcoes[Math.floor(Math.random() * opcoes.length)]
      const resultado = jogador === bot ? '🤝 Empate! Os sonhos se equilibraram.' : vence[jogador] === bot ? '🏆 Vitória! Você venceu o guardião do sono.' : '💤 Derrota! Hipnos dominou esta rodada.'
      text = `Você: ${emojis[jogador]} ${jogador}\nHipnos: ${emojis[bot]} ${bot}\n\n${resultado}`
    }
    await sock.sendMessage(jid, { text }, { quoted: msg }).catch(() => {})
  }
}
