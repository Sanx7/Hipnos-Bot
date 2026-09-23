// ============================================
// 📚 PERGUNTAS-QUIZ — Banco de perguntas do /quiz
// ============================================
// Formato compacto "pergunta|A|B|C|D|correta|categoria" (uma por linha),
// onde "correta" é o índice 0-3 da alternativa certa.
// O módulo exporta { PERGUNTAS, CATEGORIAS, sortearPerguntas } pronto p/ uso.
//
// Consumo:
//   const { PERGUNTAS, CATEGORIAS, sortearPerguntas } = require('../../dados/perguntas-quiz')
//   sortearPerguntas(5)                → 5 aleatórias (sem repetir na rodada)
//   sortearPerguntas(5, 'geografia')   → 5 só da categoria (null se inválida)
// ============================================

// Parte 1 — CONHECIMENTOS GERAIS (exporta string bruta).

module.exports = `
Qual é a capital do Brasil?|São Paulo|Brasília|Rio de Janeiro|Salvador|1|gerais
Quantos dias tem um ano bissexto?|365|364|366|367|2|gerais
Qual é o maior planeta do sistema solar?|Terra|Marte|Júpiter|Saturno|2|gerais
Em que ano o Brasil foi descoberto pelos portugueses?|1492|1500|1502|1520|1|gerais
Qual é o idioma mais falado no mundo?|Inglês|Mandarim|Espanhol|Hindi|1|gerais
Quantos continentes existem na Terra?|5|6|7|8|2|gerais
Qual é a moeda oficial do Japão?|Won|Yuan|Iene|Rúpia|2|gerais
Qual oceano banha o litoral brasileiro?|Pacífico|Índico|Atlântico|Ártico|2|gerais
Quantos estados tem o Brasil?|25|26|27|28|2|gerais
Qual é o maior país do mundo em território?|China|Estados Unidos|Canadá|Rússia|3|gerais
Em que continente fica o Egito?|Ásia|Europa|África|América|2|gerais
Qual é a capital da Argentina?|Santiago|Montevidéu|Buenos Aires|Lima|2|gerais
Quantos lados tem um hexágono?|5|6|7|8|1|gerais
Qual é o menor país do mundo?|Mônaco|Vaticano|San Marino|Liechtenstein|1|gerais
Em que ano aconteceu a Proclamação da República do Brasil?|1822|1888|1889|1891|2|gerais
Qual é a capital de Portugal?|Porto|Coimbra|Lisboa|Braga|2|gerais
Quantos minutos tem uma hora?|50|60|90|100|1|gerais
Qual é o rio mais extenso do Brasil?|São Francisco|Paraná|Amazonas|Tocantins|2|gerais
Qual país tem formato de bota no mapa?|Grécia|Espanha|Itália|Portugal|2|gerais
Em que século estamos?|XX|XXI|XXII|XIX|1|gerais
Qual é a capital do Canadá?|Toronto|Vancouver|Ottawa|Montreal|2|gerais
Quantas cores tem a bandeira do Brasil?|3|4|5|6|1|gerais
Qual é o maior deserto quente do mundo?|Atacama|Saara|Gobi|Kalahari|1|gerais
Em que país ficam as pirâmides de Gizé?|México|Peru|Egito|Sudão|2|gerais
Qual é a capital da Austrália?|Sydney|Melbourne|Canberra|Perth|2|gerais
Quantos jogadores de linha tem um time de futebol?|9|10|11|12|2|gerais
Qual é o nome do satélite natural da Terra?|Titan|Europa|Lua|Io|2|gerais
Em que ano o homem pisou na Lua pela primeira vez?|1965|1969|1972|1975|1|gerais
Qual é a capital da França?|Londres|Madri|Paris|Roma|2|gerais
Qual país sediou a Copa do Mundo de 2014?|Alemanha|África do Sul|Brasil|Rússia|2|gerais
Quantas patas tem uma aranha?|6|8|10|12|1|gerais
Qual é o animal símbolo da Austrália?|Coala|Canguru|Ornitorrinco|Dingo|1|gerais
Em que país nasceu o tango?|Espanha|Argentina|Uruguai|Colômbia|1|gerais
Qual é a capital da Espanha?|Barcelona|Madri|Sevilha|Valência|1|gerais
Quantos anéis olímpicos existem?|4|5|6|7|1|gerais
Qual é o maior mamífero do mundo?|Elefante-africano|Baleia-azul|Girafa|Hipopótamo|1|gerais
Em que país fica a Torre Eiffel?|Itália|França|Bélgica|Inglaterra|1|gerais
Qual é a capital da Itália?|Milão|Nápoles|Roma|Veneza|2|gerais
Quantos segundos tem um minuto?|30|60|90|120|1|gerais
Qual é o país com mais Copas do Mundo de futebol?|Alemanha|Argentina|Itália|Brasil|3|gerais
Em que continente fica o Brasil?|América do Norte|América do Sul|América Central|Europa|1|gerais
Qual é a capital do México?|Guadalajara|Monterrey|Cancún|Cidade do México|3|gerais
Quantos dias tem o mês de fevereiro em ano comum?|27|28|29|30|1|gerais
Qual é o maior oceano do planeta?|Atlântico|Índico|Pacífico|Ártico|2|gerais
Em que país fica Machu Picchu?|México|Bolívia|Peru|Chile|2|gerais
Qual é a capital da Alemanha?|Munique|Berlim|Hamburgo|Frankfurt|1|gerais
Quantas letras tem o alfabeto brasileiro oficial?|23|24|26|28|2|gerais
Qual é o esporte mais popular do Brasil?|Vôlei|Basquete|Futebol|Tênis|2|gerais
Em que país fica a Muralha da China?|Japão|Mongólia|China|Coreia do Sul|2|gerais
Qual é a capital do Reino Unido?|Londres|Dublin|Edimburgo|Cardiff|0|gerais
`
