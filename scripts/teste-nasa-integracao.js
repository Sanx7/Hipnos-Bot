// ============================================
// 🌐 teste-nasa-integracao.js — Smoke test REAL (usa internet + chaves do .env)
// ============================================
// Valida a integração de verdade do /nasa:
//   1) chamada à API APOD da NASA com a NASA_API_KEY do .env;
//   2) tradução título+explicação via Groq (GROQ_API_KEY, modelo
//      llama-3.3-70b-versatile com response_format json_object).
// É SOMENTE LEITURA (2 requisições HTTP) e não envia nada ao WhatsApp.
// Uso: node scripts/teste-nasa-integracao.js
// ============================================

require('../config') // carrega o .env (NASA_API_KEY e GROQ_API_KEY)

async function main() {
  // 1) 🌌 API da NASA
  const apiKey = (process.env.NASA_API_KEY || 'DEMO_KEY').trim()
  console.log(`→ NASA (api_key: ${apiKey.slice(0, 4)}...)`)
  const respostaNasa = await fetch(
    `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(apiKey)}`
  )
  console.log(`← NASA HTTP ${respostaNasa.status}`)
  if (!respostaNasa.ok) {
    console.error('💥 NASA falhou — verifique a NASA_API_KEY/limite.')
    process.exit(1)
  }
  const apod = await respostaNasa.json()
  console.log(`   title: ${apod.title}`)
  console.log(`   media_type: ${apod.media_type} | date: ${apod.date} | copyright: ${apod.copyright || '-'}`)
  console.log(`   url: ${apod.url}`)
  console.log(`   explanation: ${String(apod.explanation || '').slice(0, 110)}...`)

  // 2) 🈯 Tradução via Groq
  const chave = (process.env.GROQ_API_KEY || '').trim()
  if (!chave) {
    console.log('→ GROQ_API_KEY ausente — tradução ficaria no fallback (inglês). OK.')
    process.exit(0)
  }
  console.log(`→ Groq (modelo ${process.env.GROQ_MODEL || 'openai/gpt-oss-20b'})`)
  const respostaGroq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${chave}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: (process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Você traduz textos astronômicos para o português do Brasil (pt-BR). Responda APENAS com um JSON válido no formato {"titulo": "...", "explicacao": "..."} sem comentários extras.'
        },
        {
          role: 'user',
          content: `Traduza para o português do Brasil:\n\nTÍTULO: ${apod.title}\n\nEXPLICAÇÃO: ${apod.explanation}`
        }
      ]
    })
  })
  console.log(`← Groq HTTP ${respostaGroq.status}`)
  if (!respostaGroq.ok) {
    const corpo = await respostaGroq.text().catch(() => '')
    console.error(`💥 Groq falhou (HTTP ${respostaGroq.status}): ${corpo.slice(0, 300)}`)
    console.error('   O /nasa continuaria funcionando com o texto original (fallback).')
    process.exit(1)
  }
  const dados = await respostaGroq.json()
  const bruto = String(dados?.choices?.[0]?.message?.content || '')
  const traduzido = JSON.parse(bruto.match(/\{[\s\S]*\}/)[0])
  console.log(`   TITULO_TRADUZIDO: ${traduzido.titulo}`)
  console.log(`   EXPLICACAO_TRADUZIDA: ${String(traduzido.explicacao).slice(0, 130)}...`)
  console.log('\n🎉 Integração real OK: NASA + Groq respondendo como o /nasa espera.')
}

main().catch((err) => {
  console.error('💥 FALHA NA INTEGRAÇÃO:', err?.message || err)
  process.exit(1)
})