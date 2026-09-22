// 🔥 smoke-resumir-modelo.js — smoke test REAL do /resumir (OpenRouter)
// Faz uma chamada de verdade à OpenRouter com a OPENROUTER_API_KEY do .env e
// confere: HTTP 200 + resposta não vazia + indícios de pt-BR.
//   - por padrão usa o MODELO_PADRAO do comando (sem RESUMIR_MODEL no env);
//   - p/ testar outro modelo: node scripts/smoke-resumir-modelo.js <modelo>
//     Ex.: node scripts/smoke-resumir-modelo.js google/gemma-4-31b-it:free
// Uso: node scripts/smoke-resumir-modelo.js
const fs = require('fs')
const path = require('path')

const linhaEnv = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('OPENROUTER_API_KEY='))
const chave = linhaEnv ? linhaEnv.slice('OPENROUTER_API_KEY='.length).trim() : ''
if (!chave) {
  console.error('❌ OPENROUTER_API_KEY não encontrada no .env')
  process.exit(1)
}
if ('RESUMIR_MODEL' in process.env) delete process.env.RESUMIR_MODEL

const resumir = require('../comandos/menu-utilitario/resumir')
const { SYSTEM_PROMPT, URL_OPENROUTER_CHAT, APP_TITLE_PADRAO, SITE_URL_PADRAO, MODELO_PADRAO } = resumir.__internos
// 🎯 modelo via argv (default = MODELO_PADRAO do comando) p/ comparar candidatos
const MODELO = process.argv[2] || MODELO_PADRAO

const TEXTO =
  'A noite caiu sobre o Limbo e as sombras dançavam lentamente entre os sonhos. ' +
  'Os guardiões dormiam enquanto as estrelas contavam histórias antigas. ' +
  'Ninguém sabia o que viria depois do amanhecer, mas o silêncio era confortável. ' +
  'E assim o tempo passou, tecendo memórias que ninguém jamais poderia resumir por completo. ' +
  'No entanto, um sussurro distante prometia mudanças para todos que habitavam aquele lugar.'

async function main () {
  console.log('🔥 Smoke test real → modelo:', MODELO)
  const t0 = Date.now()
  const resposta = await fetch(URL_OPENROUTER_CHAT, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + chave,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL_PADRAO,
      'X-Title': APP_TITLE_PADRAO
    },
    body: JSON.stringify({
      model: MODELO,
      temperature: 0.3,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: TEXTO }
      ]
    })
  })
  const ms = Date.now() - t0
  console.log('HTTP', resposta.status, '(' + ms + 'ms)')

  const json = await resposta.json().catch(() => null)
  if (resposta.status !== 200) {
    console.error('❌ Esperava 200, veio', resposta.status, JSON.stringify(json).slice(0, 500))
    process.exit(1)
  }

  const conteudo = String(json?.choices?.[0]?.message?.content || '').trim()
  if (!conteudo) {
    console.error('❌ Resposta 200 mas conteúdo vazio:', JSON.stringify(json).slice(0, 500))
    process.exit(1)
  }

  // 🇧🇷 Indícios de pt-BR: palavras comuns do idioma no resumo
  const palavrasPt = (conteudo.match(/\b(de|que|não|para|com|uma|os|as|no|na|por|mais|texto|resumo|sombras|guardiões)\b/gi) || []).length
  console.log('Resposta (' + conteudo.length + ' chars, ' + palavrasPt + ' termos pt-BR):')
  console.log(conteudo.slice(0, 400))
  if (palavrasPt < 3) {
    console.error('❌ Poucos indícios de pt-BR na resposta')
    process.exit(1)
  }
  console.log('\n✅ Smoke OK: HTTP 200 + conteúdo válido em pt-BR com', MODELO)
}

main().catch((err) => {
  console.error('❌ Smoke falhou:', err?.message || err)
  process.exit(1)
})
