// ============================================================
// Teste de integração do /play SEM precisar conectar no WhatsApp.
// Usa um "sock" falso que apenas registra o que o bot tentaria enviar.
//
// Uso (na raiz do projeto):  node scripts/teste-play.js
// ============================================================
process.env.PLAY_TIMEOUT_MS = '90000'

const comando = require('../comandos/menu-fig/play')

const jidFalso = 'teste-play@s.whatsapp.net'
const msgFalsa = { key: { id: 'TESTE-PLAY' }, pushName: 'Harness' }

function criarSockFalso(registro) {
  return {
    async sendMessage(jid, conteudo) {
      registro.push(conteudo)
      if (conteudo.audio) {
        console.log(`   ✅ ÁUDIO ENVIADO: ${(conteudo.audio.length / (1024 * 1024)).toFixed(2)} MB | mimetype=${conteudo.mimetype}`)
      } else {
        const primeiraLinha = String(conteudo.text || '').split('\n')[0].slice(0, 100)
        console.log(`   💬 Mensagem: ${primeiraLinha}`)
      }
      return { ok: true }
    }
  }
}

const CASOS = [
  {
    nome: '1) Vídeo NORMAL (busca por nome)',
    texto: '/play Never Gonna Give You Up',
    validar(mensagens) {
      return mensagens.some(m => m.audio)
        ? '✅ PASSOU (baixou e "enviou" o áudio)'
        : '❌ FALHOU (nenhum áudio foi enviado)'
    }
  },
  {
    nome: '2) Vídeo mais LONGO (~6 min)',
    texto: '/play Bohemian Rhapsody Queen',
    validar(mensagens) {
      return mensagens.some(m => m.audio)
        ? '✅ PASSOU (baixou e "enviou" o áudio)'
        : '❌ FALHOU (nenhum áudio foi enviado)'
    }
  },
  {
    nome: '3) Link INVÁLIDO/inexistente (de propósito)',
    texto: '/play https://www.youtube.com/watch?v=dQw4w9WgXc9',
    validar(mensagens) {
      const temErroAmigavel = mensagens.some(m => typeof m.text === 'string' && m.text.startsWith('❌'))
      const semAudio = !mensagens.some(m => m.audio)
      return temErroAmigavel && semAudio
        ? '✅ PASSOU (respondeu erro amigável SEM derrubar nada)'
        : '❌ FALHOU (esperava mensagem de erro amigável sem áudio)'
    }
  }
]

;(async () => {
  // Permite rodar um caso específico: node scripts/teste-play.js 3
  const filtro = process.argv[2]
  const casos = filtro ? CASOS.filter((c, i) => String(i + 1) === filtro) : CASOS

  console.log('🧪 Iniciando teste do /play com sock falso (sem WhatsApp real)\n')

  for (const caso of casos) {
    console.log('='.repeat(72))
    console.log('CASO:', caso.nome)
    console.log('Entrada:', caso.texto)
    console.log('-'.repeat(72))

    const mensagens = []
    const inicio = Date.now()
    let vazouErro = false

    try {
      await comando.executar(criarSockFalso(mensagens), jidFalso, msgFalsa, caso.texto)
    } catch (err) {
      vazouErro = true
      console.log('   💥 ERRO VAZOU DO COMANDO (não deveria!):', err)
    }

    const segundos = ((Date.now() - inicio) / 1000).toFixed(1)
    console.log(`   ⏱️ Concluído em ${segundos}s`)
    console.log('   Resultado:', vazouErro ? '❌ FALHOU (erro vazou do /play)' : caso.validar(mensagens))
  }

  console.log('\n' + '='.repeat(72))
  console.log('✅ Fim dos testes — o processo permaneceu vivo em TODOS os casos.')
  console.log('   (O "envio" é simulado; no bot real o áudio segue pelo Baileys como nos demais comandos.)')
})().catch(err => {
  console.error('Erro no harness de teste:', err)
  process.exitCode = 1
})
