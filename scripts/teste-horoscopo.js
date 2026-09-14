// ============================================================
// 🧪 Teste offline do /horoscopo (menu-utilitario/horoscopo.js)
// Sem WhatsApp real e sem rede: sock falso registra os envios.
//
// Valida:
//   0) os 12 signos existem, com 5-10 frases cada;
//   1) trava diária: mesmo signo + mesma data → MESMA frase;
//   2) signos diferentes no mesmo dia → leituras (podem) diferir;
//   3) aceita signo com e sem acento (leao == leão);
//   4) signo inválido e ausência de signo → avisos amigáveis;
//   5) mudando a data, a chave muda (leitura gira no dia seguinte).
//
// Uso (na raiz do projeto):  node scripts/teste-horoscopo.js
// ============================================================
const horoscopo = require('../comandos/menu-utilitario/horoscopo')

const jidFalso = 'teste-horoscopo@s.whatsapp.net'
const msgFalsa = { key: { id: 'TESTE-HOROSCOPO' }, pushName: 'Harness' }

function criarSockFalso (registro) {
  return {
    async sendMessage (jid, conteudo) {
      registro.push(conteudo)
      console.log('   💬 ' + String(conteudo.text || '').split('\n')[0].slice(0, 90))
      return { ok: true }
    }
  }
}

let reprovadas = 0
const testar = (nome, ok, detalhe) => {
  console.log((ok ? '✅' : '❌') + ' ' + nome + (ok ? '' : ` — ${detalhe || ''}`))
  if (!ok) reprovadas++
}

;(async () => {
  console.log('🧪 Teste offline do /horoscopo\n')

  // 0) 12 signos, 5-10 frases cada
  const nomes = horoscopo.SIGNOS.map(s => s.signo)
  const esperados = ['áries', 'touro', 'gêmeos', 'câncer', 'leão', 'virgem', 'libra', 'escorpião', 'sagitário', 'capricórnio', 'aquário', 'peixes']
  testar('12 signos presentes na lista fixa', esperados.every(e => nomes.includes(e)), nomes.join(', '))
  testar('todos os signos têm entre 5 e 10 frases', horoscopo.SIGNOS.every(s => s.frases.length >= 5 && s.frases.length <= 10))

  // 1) trava diária: mesma chave → mesma frase (chamadas repetidas)
  const hoje = new Date()
  const a = horoscopo.horoscopoDoDia('leão', hoje)
  const b = horoscopo.horoscopoDoDia('leao', hoje) // sem acento, "outro usuário"
  testar('trava diária: mesma frase para o mesmo signo no mesmo dia', a.frase === b.frase && a.indice === b.indice)
  testar('normalização de acento: leao == leão', a.indice === b.indice && a.signo === b.signo)

  // 2) dias diferentes → chave muda (a frase PODE repetir, mas o índice é recalculado)
  const amanha = new Date(hoje.getTime() + 24 * 60 * 60 * 1000)
  const c = horoscopo.horoscopoDoDia('leão', amanha)
  testar('data diferente gera chave diferente', a.data !== c.data)

  // 3) todos os 12 signos retornam leitura válida hoje
  const todas = esperados.map(s => horoscopo.horoscopoDoDia(s, hoje))
  testar('todos os 12 signos retornam leitura válida hoje', todas.every(l => l && l.frase))

  // 4) fluxo do comando com sock falso
  const registro1 = []
  await horoscopo.executar(criarSockFalso(registro1), jidFalso, msgFalsa, '/horoscopo leao')
  const envioOk = registro1.find(m => typeof m.text === 'string' && m.text.includes('LEÃO'))
  testar('comando com signo válido envia a leitura (sem acento, exibido com acento)', Boolean(envioOk))

  const registro2 = []
  await horoscopo.executar(criarSockFalso(registro2), jidFalso, msgFalsa, '/horoscopo ophiucus')
  testar('signo inválido → aviso amigável (sem crash)', registro2.some(m => typeof m.text === 'string' && m.text.startsWith('❌')))

  const registro3 = []
  await horoscopo.executar(criarSockFalso(registro3), jidFalso, msgFalsa, '/horoscopo')
  testar('sem signo → instruções de uso', registro3.some(m => typeof m.text === 'string' && m.text.includes('Como usar')))

  console.log('')
  if (reprovadas === 0) console.log('🎉 Todos os testes do /horoscopo passaram.')
  else { console.log(`💥 ${reprovadas} teste(s) reprovado(s).`); process.exitCode = 1 }
})().catch(err => {
  console.error('Erro no harness de teste:', err)
  process.exitCode = 1
})
