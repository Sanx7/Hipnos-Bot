// ============================================================
// 🔬 Sonda de liveness da Purrbot API — SOMENTE investigação.
// Testa as ROTAS OFICIAIS anunciadas pela própria raiz da API
// (formato /v2/img/{rating}/{acao}/{formato}) e reporta o formato
// real da resposta. Este arquivo é removido ao fim da análise.
// ============================================================
const BASE = 'https://api.purrbot.site/v2/'

// Rotas oficiais de INTERAÇÃO (SFW, gif) vindas do index da API
const sfwGif = [
  'img/sfw/angry/gif', 'img/sfw/bite/gif', 'img/sfw/blush/gif', 'img/sfw/comfy/gif',
  'img/sfw/cry/gif', 'img/sfw/cuddle/gif', 'img/sfw/dance/gif', 'img/sfw/fluff/gif',
  'img/sfw/hug/gif', 'img/sfw/kiss/gif', 'img/sfw/lay/gif', 'img/sfw/lick/gif',
  'img/sfw/pat/gif', 'img/sfw/poke/gif', 'img/sfw/pout/gif', 'img/sfw/slap/gif',
  'img/sfw/smile/gif', 'img/sfw/tail/gif', 'img/sfw/tickle/gif'
]
// Exemplos de endpoints de imagem (estático) e listas — só p/ confirmar formato
const extras = ['img/sfw/neko/img', 'img/sfw/holo/img', 'list/sfw/gif', 'list/nsfw/gif']
// Amostra NSFW documentada (só p/ confirmar formato, sem usar em prod por ora)
const nsfwAmostra = ['img/nsfw/yaoi/gif', 'img/nsfw/yuri/gif']

async function testa (caminho) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetch(BASE + caminho, { signal: ctl.signal, headers: { Accept: 'application/json' } })
    clearTimeout(timer)
    const status = String(r.status)
    if (r.status === 200) {
      let detalhe = ''
      try {
        const j = await r.json()
        if (j.error === true) detalhe = 'error:true ' + JSON.stringify(j).slice(0, 60)
        else if (j.link) {
          const fim = j.link.split('.').pop().split('?')[0]
          detalhe = `link OK (${fim}) keys=${Object.keys(j).join(',')}`
        } else detalhe = 'sem-link: ' + JSON.stringify(j).slice(0, 90)
      } catch (e) { detalhe = 'corpo-nao-json' }
      console.log(`200 VIVO  ${caminho.padEnd(26)} ${detalhe}`)
      return
    }
    let corpo = ''
    try { corpo = (await r.text()).replace(/\s+/g, ' ').slice(0, 70) } catch (e) { /* ignora */ }
    console.log(`${status} MORTO ${caminho.padEnd(26)} ${corpo}`)
  } catch (err) {
    clearTimeout(timer)
    console.log(`FALHA    ${caminho.padEnd(26)} ${err?.message || err}`)
  }
}

async function main () {
  await testa('') // raiz: index de rotas
  await testa('info')
  console.log(`\n— ${sfwGif.length} interações SFW (gif) + ${extras.length} extras + ${nsfwAmostra.length} amostra NSFW —\n`)
  const todos = [...sfwGif, ...extras, ...nsfwAmostra]
  for (let i = 0; i < todos.length; i += 8) {
    await Promise.all(todos.slice(i, i + 8).map(testa))
  }
}

main().catch((err) => { console.error('sonda falhou:', err?.message || err) })

