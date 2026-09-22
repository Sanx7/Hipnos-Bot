// ============================================================
// 🧪 Teste offline do /traduzir (menu-utilitario/traduzir.js)
// Sem WhatsApp real e SEM rede: as fontes são injetadas via
// _injetarFonte (mesmo padrão do /letra e do /pinterest).
//
// Valida:
//   0) exports do comando (nome/executar + extras e aliases);
//   1) tradução direta (/traduzir en <texto> → primária chamada);
//   2) idioma padrão pt quando a 1ª palavra NÃO é idioma;
//   3) idioma por nome comum (inglês, espanhol, francês...);
//   4) tradução via reply (texto citado);
//   5) reply a áudio/vídeo → aviso do /transcrever;
//   6) idioma inválido sozinho → aviso de idioma;
//   7) texto vazio → ajuda de uso;
//   8) texto > 500 chars → truncado com aviso;
//   9) primária falha → fallback assume (e registra a troca);
//   10) as duas falham → aviso amigável, nada escapa;
//   11) resolverIdioma/separarIdiomaETexto/truncar (unidades).
//
// Uso (na raiz do projeto):  node scripts/teste-traduzir.js
// ============================================================
const traduzir = require('../comandos/menu-utilitario/traduzir')

const jidFalso = 'teste-traduzir@s.whatsapp.net'
const msgFalsa = { key: { id: 'TESTE-TRADUZIR' }, message: {}, pushName: 'Harness' }

function criarSockFalso(registro) {
  return {
    async sendMessage(jid, conteudo) {
      registro.push(conteudo)
      return { ok: true }
    }
  }
}

const replyCom = (quotedMessage) => ({
  key: { id: 'TESTE-TRADUZIR-REPLY' },
  message: { extendedTextMessage: { text: '/traduzir', contextInfo: { quotedMessage } } },
  pushName: 'Harness'
})

const textos = (registro) => registro.filter(m => typeof m.text === 'string').map(m => m.text)

let reprovadas = 0
const testar = (nome, ok, detalhe) => {
  console.log((ok ? '✅' : '❌') + ' ' + nome + (ok ? '' : ` — ${detalhe || ''}`))
  if (!ok) reprovadas++
}

;(async () => {
  console.log('🧪 Teste offline do /traduzir\n')

  // 0) exports
  testar('exports do comando (nome/executar/extras)',
    traduzir.nome === 'traduzir' &&
    typeof traduzir.executar === 'function' &&
    typeof traduzir.resolverIdioma === 'function' &&
    typeof traduzir._injetarFonte === 'function' &&
    Array.isArray(traduzir.aliases) && traduzir.aliases.includes('translate'))
  traduzir._restaurarFontes()

  // Fonte fake: ecoa "primária"/"fallback" p/ provar qual foi usada
  const chamadas = []
  traduzir._injetarFonte(
    async (texto, destino) => { chamadas.push({ fonte: 'primaria', texto, destino }); return { texto: 'P:' + texto, origem: 'en', fonte: 'MyMemory' } },
    async (texto, destino) => { chamadas.push({ fonte: 'fallback', texto, destino }); return { texto: 'F:' + texto, origem: 'en', fonte: 'Google' } }
  )

  // 1) tradução direta
  chamadas.length = 0
  let registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir en Bom dia, tudo bem?')
  testar('tradução direta usa a primária com destino en',
    chamadas.length === 1 && chamadas[0].fonte === 'primaria' && chamadas[0].destino === 'en' &&
    chamadas[0].texto === 'Bom dia, tudo bem?' && textos(registro).some(t => t.includes('TRADUÇÃO') && t.includes('Inglês')))

  // 2) sem idioma → destino pt, texto integral preservado
  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir Good morning')
  testar('sem idioma → destino pt com o texto inteiro',
    chamadas.length === 1 && chamadas[0].destino === 'pt' && chamadas[0].texto === 'Good morning' &&
    textos(registro).some(t => t.includes('Português')))

  // 3) idioma por nome comum (com e sem acento)
  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir inglês Good morning')
  testar('idioma por nome comum (inglês → en)', chamadas.length === 1 && chamadas[0].destino === 'en')

  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir frances Bonjour')
  testar('idioma sem acento (frances → fr)', chamadas.length === 1 && chamadas[0].destino === 'fr')

  // 4) tradução via reply (idioma + texto citado)
  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, replyCom({ conversation: 'Hello world' }), '/traduzir en')
  testar('reply: usa o texto citado com o idioma informado',
    chamadas.length === 1 && chamadas[0].destino === 'en' && chamadas[0].texto === 'Hello world' &&
    textos(registro).some(t => t.includes('P:Hello world')))

  // 4b) reply sem idioma → destino pt
  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, replyCom({ conversation: 'Hello world' }), '/traduzir')
  testar('reply sem idioma → destino pt', chamadas.length === 1 && chamadas[0].destino === 'pt')

  // 5) reply a áudio/vídeo → aviso do /transcrever
  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, replyCom({ audioMessage: {} }), '/traduzir en')
  testar('reply a áudio → sugere o /transcrever (sem traduzir)',
    chamadas.length === 0 && textos(registro).some(t => t.includes('/transcrever')))

  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, replyCom({ videoMessage: { caption: 'oi' } }), '/traduzir')
  testar('reply a vídeo → sugere o /transcrever (sem traduzir)',
    chamadas.length === 0 && textos(registro).some(t => t.includes('/transcrever')))

  // 6) idioma inválido sozinho → aviso de idioma
  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir xx')
  testar('idioma inválido → aviso "Não reconheci o idioma"',
    chamadas.length === 0 && textos(registro).some(t => t.includes('Não reconheci o idioma')))

  // 7) texto vazio → ajuda de uso
  chamadas.length = 0
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir')
  testar('texto vazio → ajuda de uso', chamadas.length === 0 && textos(registro).some(t => t.includes('Como usar o tradutor')))

  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir en')
  testar('só idioma (sem texto/reply) → ajuda de uso', textos(registro).some(t => t.includes('Como usar o tradutor')))

  // 8) texto > 500 chars → truncado com aviso
  chamadas.length = 0
  registro = []
  const longo = 'a'.repeat(600)
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir en ' + longo)
  testar('texto longo → truncado em 500 com aviso',
    chamadas.length === 1 && chamadas[0].texto.length === traduzir.LIMITE_ENTRADA &&
    textos(registro).some(t => t.includes('truncado em 100 caracteres')))

  // 9) primária falha → fallback assume
  chamadas.length = 0
  traduzir._injetarFonte(async () => { chamadas.push({ fonte: 'primaria' }); throw new Error('primária fora') }, null)
  traduzir._injetarFonte(null, async (texto, destino) => { chamadas.push({ fonte: 'fallback', texto, destino }); return { texto: 'F:' + texto, origem: 'en', fonte: 'Google' } })
  registro = []
  await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir en Oi')
  testar('primária falha → fallback responde',
    chamadas.some(c => c.fonte === 'fallback') && textos(registro).some(t => t.includes('F:Oi')))

  // 10) as duas falham → aviso amigável, nada escapa
  traduzir._injetarFonte(async () => { throw new Error('primária fora') }, async () => { throw new Error('fallback fora') })
  registro = []
  let escapou = false
  try {
    await traduzir.executar(criarSockFalso(registro), jidFalso, msgFalsa, '/traduzir en Oi')
  } catch (err) { escapou = true }
  testar('duas fontes fora → aviso amigável sem escapar',
    !escapou && textos(registro).some(t => t.includes('línguas do limbo se calaram')))

  // 11) unidades puras
  traduzir._restaurarFontes()
  testar('resolverIdioma: código e nomes (en/inglês/espanhol/francês)',
    traduzir.resolverIdioma('en') === 'en' && traduzir.resolverIdioma('inglês') === 'en' &&
    traduzir.resolverIdioma('ingles') === 'en' && traduzir.resolverIdioma('espanhol') === 'es' &&
    traduzir.resolverIdioma('francês') === 'fr' && traduzir.resolverIdioma('xx') === null)
  const sep = traduzir.separarIdiomaETexto('en Bom dia')
  testar('separarIdiomaETexto: idioma + texto', sep.destino === 'en' && sep.texto === 'Bom dia')
  const sep2 = traduzir.separarIdiomaETexto('Bom dia')
  testar('separarIdiomaETexto: sem idioma → pt + texto integral', sep2.destino === 'pt' && sep2.texto === 'Bom dia')
  const sep3 = traduzir.separarIdiomaETexto('xx')
  testar('separarIdiomaETexto: token de 2 letras sozinho → tentativa de idioma (texto vazio)',
    sep3.destino === 'pt' && sep3.texto === '' && sep3.idiomaInformado === 'xx')
  const sep4 = traduzir.separarIdiomaETexto('Ola')
  testar('separarIdiomaETexto: palavra comum sozinha → texto a traduzir para pt',
    sep4.destino === 'pt' && sep4.texto === 'Ola' && sep4.idiomaInformado === null)
  const tr = traduzir.truncar('b'.repeat(traduzir.LIMITE_ENTRADA + 50))
  testar('truncar: corta no limite e informa o excedente',
    tr.texto.length === traduzir.LIMITE_ENTRADA && tr.truncado === 50)

  console.log('')
  if (reprovadas === 0) console.log('🎉 Todos os testes do /traduzir passaram.')
  else { console.log(`💥 ${reprovadas} teste(s) reprovado(s).`); process.exitCode = 1 }
})().catch(err => {
  console.error('Erro no harness de teste:', err)
  process.exitCode = 1
})

