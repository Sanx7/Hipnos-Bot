// ============================================
// 📚 comandos-registry.js — Registro de comandos do bot
// ============================================
// O Map que guarda os comandos carregados pelo loader (bot.js) vive AQUI,
// num módulo próprio e sem dependências, para que qualquer outro módulo
// (ex.: o /info) possa consultá-lo/contá-lo SEM dar require no bot.js —
// o que criaria dependência circular (comando -> bot -> comando) durante
// o carregamento dos comandos.
//
// bot.js: preenche este Map via carregarComandos() e usa comandos.get()
// no roteador de mensagens — comportamento idêntico ao de antes.
// ============================================

const comandos = new Map()

module.exports = { comandos }
