// ============================================================
// Teste de integração do /play SEM precisar conectar no WhatsApp.
// Usa um "sock" falso que apenas registra o que o bot tentaria enviar.
//
// Uso (na raiz do projeto):  node scripts/teste-play.js
// ============================================================
// Carrega o .env da raiz (sem sobrescrever o ambiente real) para o
// teste usar a MESMA BRONXYS_API_KEY configurada no projeto.
require('../config')
process.env.PLAY_TIMEOUT_MS = '30000'

const comando = require('../comandos/menu-download/play')

const jidFalso = 'teste-play@s.whatsapp.net'
const msgFalsa = { key: { id: 'TESTE-PLAY' }, pushName: 'Harness' }

function criarSockFalso(registro) {
  return {
    async sendMessage(jid, conteudo) {
      registro.push(conteudo)
      if (conteudo.audio) {
        const tipoAudio = (conteudo.audio && typeof conteudo.audio === 'object' && conteudo.audio.url)
          ? 'URL' : 'Buffer'
        console.log(`   ✅ ÁUDIO ENVIADO (${tipoAudio}): fileName=${conteudo.fileName || '-'} | mimetype=${conteudo.mimetype}`)
      } else if (conteudo.image) {
        const primeiraLinha = String(conteudo.caption || '').split('\n')[0].slice(0, 100)
        console.log(`   🖼️ PREVIEW ENVIADO (imagem + legenda): ${primeiraLinha}`)
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
    nome: '1) Busca por NOME — vídeo normal',
    texto: '/play Never Gonna Give You Up',
    validar(mensagens) {
      return mensagens.some(m => m.audio)
        ? '✅ PASSOU (buscou, baixou e "enviou" o áudio)'
        : '❌ FALHOU (nenhum áudio foi enviado)'
    }
  },
  {
    nome: '2) Busca por NOME — vídeo mais longo (~6 min)',
    texto: '/play Bohemian Rhapsody Queen',
    validar(mensagens) {
      return mensagens.some(m => m.audio)
        ? '✅ PASSOU (buscou, baixou e "enviou" o áudio)'
        : '❌ FALHOU (nenhum áudio foi enviado)'
    }
  },
  {
    nome: '3) Uso sem argumento (instruções, sem buscar nada)',
    texto: '/play',
    validar(mensagens) {
      const mostrouUso = mensagens.some(m => typeof m.text === 'string' && m.text.includes('Como usar'))
      const semAudio = !mensagens.some(m => m.audio)
      return mostrouUso && semAudio
        ? '✅ PASSOU (mostrou instruções de uso sem tocar na API)'
        : '❌ FALHOU (esperava mensagem de uso sem áudio)'
    }
  },
  {
    nome: '4) Vídeo com duração > 1 hora (não deve baixar)',
    texto: '/play lofi hip hop para estudar 1 hora',
    validar(mensagens) {
      const avisouDuracao = mensagens.some(m => typeof m.text === 'string' && m.text.includes('1 hora'))
      const semAudio = !mensagens.some(m => m.audio)
      return avisouDuracao && semAudio
        ? '✅ PASSOU (avisou a duração e NÃO tentou baixar)'
        : '❌ FALHOU (esperava aviso de duração sem áudio)'
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
