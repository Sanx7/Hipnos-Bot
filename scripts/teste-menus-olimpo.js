// Teste offline: carrega os comandos reais, sem iniciar o bot ou ler o .env.
process.env.MONGODB_URI = ''
process.env.MONGO_URI_RPG = ''
require('net').Socket.prototype.connect = function () { throw new Error('REDE_PROIBIDA') }
require('mongodb').MongoClient.prototype.connect = async function () { throw new Error('MONGO_PROIBIDO') }
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const existe = fs.existsSync
const envLocal = path.resolve(__dirname, '../.env')
fs.existsSync = arquivo => path.resolve(String(arquivo)) === envLocal ? false : existe(arquivo)
const { comandos } = require('../comandos-registry')
const prefixo = require('../prefixo')
const adulto = require('../modoadulto')
const estadoBot = require('../estado-bot')
// As negativas são deliberadas e independentes das credenciais do operador.
adulto.modoAdultoAtivo = async () => false
estadoBot.remetenteEhDono = async () => false

const fontes = []
function carregar(pasta) {
  for (const arquivo of fs.readdirSync(pasta)) {
    const caminho = path.join(pasta, arquivo)
    if (fs.statSync(caminho).isDirectory()) { carregar(caminho); continue }
    if (!arquivo.endsWith('.js')) continue
    const modulo = require(caminho)
    for (const cmd of Array.isArray(modulo) ? modulo : [modulo]) {
      if (!cmd?.nome || typeof cmd.executar !== 'function') continue
      fontes.push({ caminho, cmd })
      comandos.set(cmd.nome, cmd)
      for (const alias of cmd.aliases || []) {
        if (typeof alias === 'string' && alias && !comandos.has(alias)) comandos.set(alias, cmd)
      }
    }
  }
}
carregar(path.resolve(__dirname, '../comandos'))
const { portais, catalogo } = require('../dados/menus-catalogo')
const { POR_PAGINA, entradas } = require('../dados/menus-olimpo')
let total = 0
async function teste(nome, fn) { await fn(); total++; console.log(`OK: ${nome}`) }
const msg = { key: { remoteJid: '11111111111@s.whatsapp.net', fromMe: false }, message: { conversation: '' } }
async function executar(nome, texto, jid = msg.key.remoteJid) {
  const envios = []
  const sock = { async sendMessage(destino, conteudo, opcoes) { envios.push({ destino, conteudo, opcoes }) } }
  await comandos.get(nome).executar(sock, jid, msg, texto)
  assert.equal(envios.length, 1, `Uma única mensagem por página: ${nome}`)
  assert.equal(envios[0].destino, jid)
  return envios[0]
}
function anunciados(texto, sinal) {
  const p = sinal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...texto.matchAll(new RegExp(`(?:^|\\s|\\*)${p}([\\p{L}\\d-]+)`, 'gu'))].map(m => m[1])
}
async function main() {
  await teste('catálogo cobre todos os comandos carregados, sem repetições', () => {
    const navegacao = new Set(['menu', 'brincadeira', ...portais.map(p => p.nome)])
    const reais = [...new Set([...comandos.values()].filter(c => !c.oculto).map(c => c.nome))].filter(n => !navegacao.has(n)).sort()
    const ativos = catalogo.filter(c => comandos.get(c.nome)?.nome === c.nome)
    assert.deepEqual([...new Set(ativos.map(c => c.nome))].sort(), reais)
    assert.equal(new Set(catalogo.map(c => `${c.categoria}:${c.nome}`)).size, catalogo.length)
    for (const c of catalogo) {
      assert.ok(portais.some(p => p.categoria === c.categoria))
      assert.ok(c.descricao.length >= 12 && c.descricao.length <= 120)
      assert.doesNotMatch(c.descricao, /(?:^|\s)\/[\p{L}\d-]+/u)
    }
  })
  await teste('comando reservado carrega sem ser anunciado nos menus', () => {
    const cmd = comandos.get('surpresa')
    assert.equal(typeof cmd?.executar, 'function')
    assert.equal(cmd.oculto, true)
    assert.ok(!catalogo.some(c => c.nome === cmd.nome))
    for (const portal of portais) assert.ok(!entradas(portal.categoria).some(c => c.nome === cmd.nome))
  })
  await teste('quatro comandos de aniversarios no RPG, com uma entrada por comando', () => {
    for (const nome of ['aniversario', 'meuaniversario', 'aniversarios', 'removeraniversario']) {
      const cmd = comandos.get(nome)
      assert.equal(cmd?.nome, nome)
      assert.equal(cmd.categoria, 'rpg')
      assert.equal(typeof cmd.executar, 'function')
      assert.equal(entradas('rpg').filter(c => c.nome === nome).length, 1)
      assert.equal(fontes.filter(f => f.cmd.nome === nome || (f.cmd.aliases || []).includes(nome)).length, 1)
    }
    assert.equal(POR_PAGINA, 12)
  })
  for (const sinal of ['/', '!', '#']) {
    prefixo.__definirPrefixoTeste(sinal)
    await teste(`central anuncia somente os 12 submenus com prefixo ${sinal}`, async () => {
      const { conteudo } = await executar('menu', `${sinal}menu`)
      assert.match(conteudo.text, /🏛️ \*PORTAIS DO OLIMPO\*/)
      assert.deepEqual(anunciados(conteudo.text, sinal).sort(), portais.map(p => p.nome).sort())
      assert.ok(conteudo.text.includes(`${sinal}menu-dono`))
      assert.ok(conteudo.text.includes(`${sinal}menu-adulto`))
      assert.ok(conteudo.text.length < 3000)
    })
    for (const p of portais) {
      await teste(`${p.nome}: todas as páginas, comandos reais e continuação (${sinal})`, async () => {
        const vistos = []
        const paginas = Math.ceil(entradas(p.categoria).length / POR_PAGINA)
        for (let pagina = 1; pagina <= paginas; pagina++) {
          const envio = await executar(p.nome, `${sinal}${p.nome} ${pagina}`, '120000000000@g.us')
          const text = envio.conteudo.text
          assert.equal(envio.opcoes.quoted, msg)
          assert.ok(text.length <= 3500, `Página longa: ${p.nome} ${pagina}`)
          assert.ok(text.includes(`*Página:* ${pagina}/${paginas}`))
          for (const nome of anunciados(text, sinal)) assert.ok(comandos.has(nome), `Comando inexistente: ${nome}`)
          if (sinal !== '/') assert.doesNotMatch(text, /(?:^|\s)\/[a-z]/m)
          const nomes = [...text.matchAll(new RegExp(`\\*${sinal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\p{L}\\d-]+)\\*`, 'gu'))].map(m => m[1])
          vistos.push(...nomes)
          if (pagina < paginas) assert.ok(text.includes(`Próxima: ${sinal}${p.nome} ${pagina + 1}`))
          if (pagina > 1) assert.ok(text.includes(`Anterior: ${sinal}${p.nome} ${pagina - 1}`))
        }
        assert.deepEqual(vistos, entradas(p.categoria).map(c => c.acesso || c.nome))
      })
    }
  }
  prefixo.__definirPrefixoTeste('!')
  await teste('menu adulto cobre os 50 comandos reais, uma única entrada por implementação', () => {
    const reais = require('../comandos/menu-adulto/comandos-adulto')
    const lista = entradas('adulto')
    assert.equal(reais.length, 50)
    assert.equal(lista.length, reais.length)
    assert.deepEqual(lista.map(c => c.nome).sort(), reais.map(c => c.nome).sort())
    for (const cmd of reais) {
      const item = lista.find(c => c.nome === cmd.nome)
      assert.equal(comandos.get(item.acesso || item.nome), cmd)
      const novos = ['esfregar1', 'esfregar2', 'esfregar3', 'esfregar4', 'pgpeito2', 'pgpeito3', 'tapabunda3', 'tapabunda4']
      if (!novos.includes(cmd.nome)) continue
      for (const rota of new Set([cmd.nome, ...cmd.aliases])) {
        const donos = fontes.filter(f => f.cmd.nome === rota || (f.cmd.aliases || []).includes(rota))
        assert.equal(donos.length, 1, `Rota adulta duplicada: ${rota}`)
        assert.equal(comandos.get(rota), cmd)
      }
    }
  })
  await teste('adulto tem 5 paginas 12/12/12/12/2, com aliases somente como acesso da mesma entrada', async () => {
    const rotas = [], quantidades = []
    let texto = ''
    for (let p = 1; p <= 5; p++) {
      const pagina = (await executar('menu-adulto', `!menu-adulto ${p}`)).conteudo.text
      texto += pagina
      const nomes = [...pagina.matchAll(/\*!([\p{L}\d-]+)\*/gu)].map(m => m[1])
      rotas.push(...nomes); quantidades.push(nomes.length)
    }
    assert.deepEqual(quantidades, [12, 12, 12, 12, 2])
    assert.equal(new Set(rotas).size, 50)
    assert.match(texto, /\*!murro\* \(soco adulto\)/)
    assert.match(texto, /\*!bater\* \(tapa adulto\)/)
    assert.doesNotMatch(texto, /\*!(?:soco|tapa|boquete|tirarcalcinha)\*/)
    for (const rota of rotas) assert.equal(comandos.get(rota).categoria, 'adulto')
  })
  await teste('alias ausente ou desviado para brincadeiras não anuncia acesso adulto incorreto', () => {
    const murro = comandos.get('murro'), bater = comandos.get('bater')
    try {
      comandos.delete('murro')
      comandos.set('bater', comandos.get('tapa'))
      assert.equal(entradas('adulto').length, 48)
      assert.ok(!entradas('adulto').some(c => ['soco', 'tapa'].includes(c.nome)))
    } finally { comandos.set('murro', murro); comandos.set('bater', bater) }
  })
  await teste('aliases dos menus e barra legada preservados', async () => {
    for (const { cmd } of fontes.filter(f => portais.some(p => p.nome === f.cmd.nome))) {
      for (const alias of cmd.aliases || []) {
        assert.equal(comandos.get(alias), cmd)
        assert.equal((await executar(alias, `!${alias}`)).conteudo.text, (await executar(cmd.nome, `/${cmd.nome}`)).conteudo.text)
      }
    }
    assert.equal((await executar('brincadeira', '!brincadeira')).conteudo.text,
      (await executar('menu-brincadeiras', '!menu-brincadeiras')).conteudo.text)
  })
  await teste('página inválida devolve instrução copiável, sem exceções', async () => {
    for (const arg of ['0', '-1', 'abc', '9999', '1 extra', '1.2']) {
      assert.match((await executar('menu-admin', `!menu-admin ${arg}`)).conteudo.text, /Página não encontrada.*!menu-admin/)
    }
  })
  await teste('Arcontes e todos os fluxos de relacionamento estão categorizados', () => {
    for (const n of ['arconte', 'removerarconte', 'listaarcontes', 'historicoarconte']) {
      assert.equal(catalogo.find(c => c.nome === n).categoria, 'admin')
    }
    for (const n of ['namorar', 'aceitarnamoro', 'recusarnamoro', 'namoro', 'terminar', 'casar', 'aceitar', 'recusar', 'casamento', 'divorciar', 'ajustardatacasamento']) {
      assert.equal(catalogo.find(c => c.nome === n).categoria, 'relacionamentos')
    }
  })
  await teste('menu não anuncia votação de banimento sem comando registrado', async () => {
    const localizar = async () => {
      const textos = []
      for (let p = 1; p <= Math.ceil(entradas('admin').length / POR_PAGINA); p++) {
        textos.push((await executar('menu-admin', `!menu-admin ${p}`)).conteudo.text)
      }
      return textos.join('\n')
    }
    assert.ok(!comandos.has('enquete-admin-ban'))
    assert.ok(!comandos.has('banir'))
    assert.ok(!(await localizar()).includes('!enquete-admin-ban'))
  })
  await teste('ausência de comando no registro impede anúncio no submenu', async () => {
    const cmd = comandos.get('arconte')
    try {
      comandos.delete('arconte')
      const paginas = Math.ceil(entradas('admin').length / POR_PAGINA)
      for (let p = 1; p <= paginas; p++) assert.ok(!anunciados((await executar('menu-admin', `!menu-admin ${p}`)).conteudo.text, '!').includes('arconte'))
    } finally { comandos.set('arconte', cmd) }
  })
  await teste('visitar menus não altera o registro nem autoriza concessão de VIP', async () => {
    const antes = [...comandos]
    await executar('menu', '!menu')
    await executar('menu-dono', '!menu-dono')
    await executar('menu-vip', '!menu-vip')
    assert.deepEqual([...comandos], antes)
    const resposta = await executar('darvip', '!darvip @participante 30')
    assert.match(resposta.conteudo.text, /só obedece aos donos/)
  })
  await teste('visitar menu adulto não habilita o modo nem envia mídia restrita', async () => {
    await executar('menu-adulto', '!menu-adulto')
    const resposta = await executar('beijogostoso', '!beijogostoso', '120000000000@g.us')
    assert.ok(resposta.conteudo.text)
    assert.match(resposta.conteudo.text, /modo adulto|modoadulto/i)
    assert.ok(!resposta.conteudo.video && !resposta.conteudo.image)
    assert.equal(await adulto.modoAdultoAtivo('120000000000@g.us'), false)
  })
  await teste('todos os 50 acessos exibidos continuam bloqueados com modo adulto desligado', async () => {
    await executar('menu-adulto', '!menu-adulto')
    for (const item of entradas('adulto')) {
      const acesso = item.acesso || item.nome
      const resposta = await executar(acesso, `!${acesso}`, '120000000000@g.us')
      assert.match(resposta.conteudo.text, /modo adulto/i)
      assert.ok(!resposta.conteudo.video && !resposta.conteudo.image)
    }
  })
  await teste('colisões preexistentes mantêm os vencedores e descrições reais', () => {
    assert.equal(comandos.get('gay'), require('../comandos/menu-efeitos/efeitos-imagem').find(c => c.nome === 'gay'))
    assert.match(catalogo.find(c => c.nome === 'gay').descricao, /arco-íris/)
    for (const nome of ['tapa', 'soco']) assert.equal(comandos.get(nome), require('../comandos/menu-brincadeiras/acoes').find(c => c.nome === nome))
    assert.equal(comandos.get('encerrar-enquete'), require('../comandos/menu-brincadeiras/enquete')[1])
    assert.equal(comandos.get('meuslembretes'), require('../comandos/meuslembretes'))
  })
  console.log(`${total} testes de menus passaram (offline); ${catalogo.length} entradas em ${portais.length} portais.`)
}
main().catch(erro => { console.error(erro); process.exitCode = 1 })
