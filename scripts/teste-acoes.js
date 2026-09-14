// ============================================================
// 🧪 Teste offline dos comandos de ação (menu-brincadeiras/acoes.js)
// Sem WhatsApp real: usa um "sock" falso que registra o que o bot
// tentaria enviar. (As chamadas às APIs de GIF são reais.)
//
// Valida:
//   0) o módulo exporta os 10 comandos com nome/executar;
//   1) alvo via REPLY (mensagem citada) — prioridade 1;
//   2) alvo via MENÇÃO (@usuario) — comportamento original mantido;
//   3) sem alvo → aviso amigável, sem crash;
//   4) o GIF sai como VÍDEO MP4 (convertido via ffmpeg) + gifPlayback.
//
// Uso (na raiz do projeto):  node scripts/teste-acoes.js
// ============================================================
const acoes = require('../comandos/menu-brincadeiras/acoes')

const jidFalso = 'teste-acoes@g.us'
const ENVIADOR = '5511777777777@s.whatsapp.net'
const AUTOR_DA_CITADA = '5511988887777@s.whatsapp.net'
const MENCIONADO = '5511955554444@s.whatsapp.net'

const msgBase = {
  key: { id: 'TESTE-ACOES', remoteJid: jidFalso, participant: ENVIADOR },
  pushName: 'Harness'
}

function criarSockFalso(registro) {
  return {
    async sendMessage(jid, conteudo, opcoes) {
      registro.push({ conteudo, opcoes })
      if (conteudo.video) {
        const buf = conteudo.video
        const container = (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp')
          ? 'MP4 ✅' : 'NÃO-MP4 ⚠️'
        console.log(`   🎬 VÍDEO enviado: ${(buf.length / 1024).toFixed(0)} KB | container=${container} | gifPlayback=${conteudo.gifPlayback} | mimetype=${conteudo.mimetype || '-'}`)
        console.log(`   📝 Legenda: ${String(conteudo.caption || '').replace(/\n/g, ' ')}`)
        console.log(`   🏷️ mentions: ${(conteudo.mentions || []).join(' | ')}`)
        console.log(`   ↩️ quoted: ${opcoes?.quoted ? 'sim ✅' : 'não ⚠️'}`)
      } else {
        console.log(`   💬 Texto: ${String(conteudo.text || '').split('\n')[0].slice(0, 90)}`)
      }
      return { ok: true }
    }
  }
}

const msgComReply = {
  ...msgBase,
  message: {
    extendedTextMessage: {
      text: '/tapa',
      contextInfo: {
        participant: AUTOR_DA_CITADA,
        quotedMessage: { conversation: 'mensagem original citada' }
      }
    }
  }
}

const msgComMencao = {
  ...msgBase,
  message: {
    extendedTextMessage: {
      text: '/tapa @fulano',
      contextInfo: { mentionedJid: [MENCIONADO] }
    }
  }
}

const msgSemAlvo = { ...msgBase, message: { conversation: '/tapa' } }

async function rodarCaso(nome, msg, validar) {
  console.log('='.repeat(72))
  console.log('CASO:', nome)
  console.log('-'.repeat(72))
  const mensagens = []
  try {
    await acoes.find(a => a.nome === 'tapa').executar(criarSockFalso(mensagens), jidFalso, msg)
  } catch (err) {
    console.log('   💥 ERRO VAZOU DO COMANDO (não deveria!):', err?.message || err)
    return false
  }
  const ok = validar(mensagens)
  console.log('   Resultado:', ok ? '✅ PASSOU' : '❌ FALHOU')
  return ok
}

;(async () => {
  console.log('🧪 Teste offline dos comandos de ação (sock falso, sem WhatsApp real)\n')
  let falhas = 0

  // 0) Os 10 comandos exportados com nome/executar
  const nomes = acoes.map(a => a.nome)
  const esperados = ['tapa', 'beijo', 'abraço', 'soco', 'chute', 'carinho', 'mordida', 'cutucada', 'aconchego', 'comer']
  const faltando = esperados.filter(n => !nomes.includes(n))
  const moduloOk = faltando.length === 0 && acoes.every(a => a.nome && typeof a.executar === 'function')
  console.log('📋 Comandos exportados:', nomes.join(', '))
  console.log('   10 comandos com nome/executar?', moduloOk ? '✅ SIM' : `❌ NÃO (faltando: ${faltando.join(', ') || '—'})`)
  if (!moduloOk) falhas++

  // 1) Reply → alvo é o autor da mensagem citada
  const okReply = await rodarCaso('1) Alvo via REPLY (mensagem citada — prioridade 1)', msgComReply, (ms) => {
    const envio = ms.find(m => m.conteudo.video)
    if (!envio) return false
    const { conteudo, opcoes } = envio
    return conteudo.gifPlayback === true
      && (conteudo.mentions || []).includes(AUTOR_DA_CITADA)
      && String(conteudo.caption).includes(AUTOR_DA_CITADA.split('@')[0])
      && Boolean(opcoes?.quoted)
  })
  if (!okReply) falhas++

  // 2) Menção → alvo é o mencionado (comportamento original)
  const okMencao = await rodarCaso('2) Alvo via MENÇÃO @usuario (comportamento original)', msgComMencao, (ms) => {
    const envio = ms.find(m => m.conteudo.video)
    if (!envio) return false
    return conteudoOK(envio.conteudo, MENCIONADO)
  })
  if (!okMencao) falhas++

  // 3) Sem alvo → aviso, sem vídeo
  const okSemAlvo = await rodarCaso('3) Sem reply e sem menção → aviso amigável', msgSemAlvo, (ms) => {
    const temVideo = ms.some(m => m.conteudo.video)
    const temAviso = ms.some(m => typeof m.conteudo.text === 'string' && m.conteudo.text.startsWith('❌'))
    return temAviso && !temVideo
  })
  if (!okSemAlvo) falhas++

  console.log('\n' + '='.repeat(72))
  if (falhas === 0) {
    console.log('✅ TODOS os casos passaram — o processo permaneceu vivo.')
  } else {
    console.log(`❌ ${falhas} caso(s) falharam.`)
    process.exitCode = 1
  }
})().catch(err => {
  console.error('Erro no harness de teste:', err)
  process.exitCode = 1
})

// Helper: valida vídeo + gifPlayback + alvo nas mentions
function conteudoOK(conteudo, alvoEsperado) {
  return conteudo.gifPlayback === true
    && (conteudo.mentions || []).includes(alvoEsperado)
    && String(conteudo.caption).includes(alvoEsperado.split('@')[0])
}
