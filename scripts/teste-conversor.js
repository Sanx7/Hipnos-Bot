// ============================================
// Teste do /conversor (parte 1)
// ============================================

const conversor = require('../comandos/menu-utilitario/conversor')

const JID = '120363000000000000@g.us'
const MSG = { key: { remoteJid: JID, fromMe: false, id: 'MSG' }, message: { conversation: '/conversor' } }

function criarSock() {
  const enviadas = []
  return {
    enviadas: enviadas,
    sock: {
      sendMessage: async function (jid, conteudo, opcoes) {
        enviadas.push({ jid: jid, conteudo: conteudo, opcoes: opcoes })
        return { key: { id: 'fake-' + enviadas.length } }
      }
    }
  }
}

function textoUnico(enviadas) {
  const textos = enviadas.map(function (e) { return e.conteudo && e.conteudo.text }).filter(function (t) { return typeof t === 'string' })
  if (textos.length !== 1) throw new Error('esperava 1 mensagem, veio ' + textos.length)
  return textos[0]
}

let reprovadas = 0
async function testar(nome, fn) {
  try {
    await fn()
    console.log('OK ' + nome)
  } catch (err) {
    reprovadas += 1
    console.error('FALHOU ' + nome + ' -> ' + (err && err.message ? err.message : err))
  }
}

function pertoDe(a, b, tol) {
  return Math.abs(a - b) <= (tol || 0.01)
}


async function main() {
  await testar('exports (nome/aliases/executar)', async function () {
    if (conversor.nome !== 'conversor') throw new Error('nome errado')
    if (typeof conversor.executar !== 'function') throw new Error('sem executar')
    if (!conversor.aliases || conversor.aliases.indexOf('converter') === -1) throw new Error('falta alias converter')
  })

  await testar('distancia: 10 km em milhas = 6.21 mi', async function () {
    const p = conversor.parsear('10 km em milhas')
    if (p.erro) throw new Error('parse falhou: ' + p.erro)
    if (!pertoDe(conversor.converter(p.valor, p.origem, p.destino), 6.2137)) throw new Error('valor errado')
  })

  await testar('peso: 5 kg em lb = 11.02 lb', async function () {
    const p = conversor.parsear('5 kg em lb')
    if (p.erro) throw new Error('parse falhou: ' + p.erro)
    if (!pertoDe(conversor.converter(p.valor, p.origem, p.destino), 11.0231)) throw new Error('valor errado')
  })

  await testar('temperatura: 30 c em f = 86 F', async function () {
    const p = conversor.parsear('30 c em f')
    if (p.erro) throw new Error('parse falhou: ' + p.erro)
    if (!pertoDe(conversor.converter(p.valor, p.origem, p.destino), 86)) throw new Error('valor errado')
  })

  await testar('volume: 2 litros em galoes = 0.53 gal', async function () {
    const p = conversor.parsear('2 litros em galoes')
    if (p.erro) throw new Error('parse falhou: ' + p.erro)
    if (!pertoDe(conversor.converter(p.valor, p.origem, p.destino), 0.5283)) throw new Error('valor errado')
  })

  await testar('velocidade: 100 km/h em mph = 62.14 mph', async function () {
    const p = conversor.parsear('100 km/h em mph')
    if (p.erro) throw new Error('parse falhou: ' + p.erro)
    if (!pertoDe(conversor.converter(p.valor, p.origem, p.destino), 62.1371)) throw new Error('valor errado')
  })

  await testar('separadores: para, seta, sem separador', async function () {
    const a = conversor.parsear('5 kg para lb')
    const b = conversor.parsear('10 km -> milhas')
    const c = conversor.parsear('10 km milhas')
    if (a.erro || b.erro || c.erro) throw new Error('algum separador falhou')
  })

  await testar('alias de unidade: celsius, kilometros', async function () {
    if (!conversor.resolverUnidade('celsius')) throw new Error('celsius nao resolveu')
    if (!conversor.resolverUnidade('kilometros')) throw new Error('kilometros nao resolveu')
  })

  await testar('erro: unidade desconhecida', async function () {
    const r = conversor.parsear('10 parsecs em km')
    if (r.erro !== 'origem') throw new Error('esperava erro origem, veio ' + r.erro)
    const s = criarSock()
    await conversor.executar(s.sock, JID, MSG, '/conversor 10 parsecs em km')
    if (!/reconheci/i.test(textoUnico(s.enviadas))) throw new Error('sem aviso amigavel')
  })

  await testar('erro: categorias incompativeis (km em kg)', async function () {
    const r = conversor.parsear('10 km em kg')
    if (r.erro !== 'categoria') throw new Error('esperava erro categoria, veio ' + r.erro)
    const s = criarSock()
    await conversor.executar(s.sock, JID, MSG, '/conversor 10 km em kg')
    if (!/tipos diferentes/i.test(textoUnico(s.enviadas))) throw new Error('sem aviso amigavel')
  })

  await testar('erro: valor nao numerico', async function () {
    const s = criarSock()
    await conversor.executar(s.sock, JID, MSG, '/conversor abc km em milhas')
    if (!/numero|como usar|conversor/i.test(textoUnico(s.enviadas))) throw new Error('sem aviso amigavel')
  })

  await testar('erro: sem argumento mostra ajuda', async function () {
    const s = criarSock()
    await conversor.executar(s.sock, JID, MSG, '/conversor')
    if (!/conversor/i.test(textoUnico(s.enviadas))) throw new Error('sem ajuda de uso')
  })

  await testar('fluxo feliz: resposta contem o resultado', async function () {
    const s = criarSock()
    await conversor.executar(s.sock, JID, MSG, '/conversor 10 km em milhas')
    const t = textoUnico(s.enviadas)
    if (!/6,21/.test(t)) throw new Error('resultado sumiu: ' + t)
  })

  console.log(reprovadas === 0 ? 'Todos os testes passaram.' : reprovadas + ' teste(s) reprovados.')
  process.exit(reprovadas === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('Falha inesperada:', err)
  process.exit(1)
})
