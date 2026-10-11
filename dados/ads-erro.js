module.exports = function erro(mensagem) { const e = new Error(mensagem); e.publico = true; return e }
