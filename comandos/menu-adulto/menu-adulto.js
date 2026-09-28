// ============================================
// 🔞 MENU-ADULTO — Pergaminho do Modo Adulto
// ============================================
// Lista os comandos adultos liberados pelo /modoadulto.
// Consulta livre, mas cada comando só executa com o modo ligado.
// ============================================

const { RODAPE_MENU } = require('../../config')

module.exports = {
  nome: 'menu-adulto',
  aliases: ['menueadulto', 'menu18', 'menu-adulto'],
  descricao: 'Abre o pergaminho dos comandos adultos (+18).',
  async executar(sock, jid, msg) {
    try {
      await sock.sendMessage(jid, {
        text: `
╔══════════════════════════════╗
║      🔞 𝐌𝐄𝐍𝐔 𝐀𝐃𝐔𝐋𝐓𝐎 🔞      ║
╚══════════════════════════════╝

🔞 Prazeres proibidos de Hipnos.
(Só funciona com o *modo adulto* ligado: /modoadulto 1.)

════════════════════

💋 BEIJOS & LAMBIDAS

💋 /beijogostoso @pessoa (ou /bjgostoso)
➥ Dá um beijo gostoso em alguém.

💋 /beijolesbico @pessoa (ou /bjlesbico)
➥ Beijo lésbico com alguém.

👅 /lambida1 @pessoa (ou /lamber1)
➥ Dá uma lambida em alguém.

👅 /lambida2 @pessoa (ou /lamber2)
➥ Outra lambida caprichada.

😛 /lambidarosto1 @pessoa (ou /lamberosto1)
➥ Lambe o rosto de alguém.

😛 /lambidarosto2 @pessoa (ou /lamberosto2)
➥ Lambe o rosto de novo.

💋 /mamar @pessoa
➥ Mama no peito de alguém.

════════════════════

🍑 PEITOS & CORPO

👙 /arrancarcalcinha @pessoa (ou /tirarcalcinha)
➥ Tira a calcinha de alguém.

🍒 /caranopeito @pessoa (ou /crnopeito)
➥ Cai de cara nos peitos de alguém.

👅 /chuparpeito1 @pessoa (ou /chpeito1)
➥ Chupa o peito de alguém.

👅 /chuparpeito2 @pessoa (ou /chpeito2)
➥ Chupa o peitinho gostoso.

👀 /mostrapeito @pessoa
➥ Mostra o peito para alguém.

✋ /pgpeito @pessoa (ou /pegarnopeito)
➥ Pega no peito de alguém.

🍑 /tapabunda1 @pessoa (ou /baternabunda1)
➥ Tapa na bunda que dá prazer.

🍑 /tapabunda2 @pessoa (ou /baternabunda2)
➥ Outro tapa na bunda.

💃 /rebolar1 @pessoa (ou /rebolar, /rebola)
➥ Rebola para alguém.

💃 /rebolar2 @pessoa (ou /rebola2)
➥ Rebola de novo.

🍑 /esfregar @pessoa (ou /seesfregar)
➥ Se esfrega com gosto.

🪑 /sentada1 @pessoa (ou /sentarnacara1)
➥ Senta na cara de alguém.

🪑 /sentada2 @pessoa (ou /sentarnacara2)
➥ Senta na cara de novo.

🪑 /sentada3 @pessoa (ou /sentarnacara3)
➥ Mais uma sentada.

🪑 /sentar1 @pessoa (ou /quicar)
➥ Senta no colo e quica.

🪑 /sentar2 @pessoa (ou /quicar2)
➥ Senta no colo de novo.

✂️ /tesourar @pessoa (ou /tesoura, /sexolesbico)
➥ Sexo lésbico com alguém.

════════════════════

🔥 CLÍMAX

👄 /blow1 @pessoa (ou /blow, /bqt, /boquete)
➥ Chupa gostoso alguém.

👄 /blow2 @pessoa (ou /boquete2)
➥ Boquete gostoso.

🍆 /comer1 @pessoa (ou /transar, /fazersexo)
➥ Transa com alguém.

🍆 /comer2 @pessoa (ou /transar2, /fazersexo2)
➥ Come alguém.

🍆 /comer3 @pessoa (ou /transar3, /fazersexo3)
➥ Mete em alguém.

🍆 /comer4 @pessoa (ou /transar4, /fazersexo4)
➥ Empurra em alguém.

🍆 /comer5 @pessoa (ou /transar5, /fazersexo5)
➥ Sexo gostoso.

🃏 /cartasecreta @pessoa
➥ Dá uma carta secreta.

════════════════════

💢 BRIGA & ZOEIRA

🔫 /atirar1 @pessoa (ou /tiro1)
➥ Dá um tiro em alguém.

🔫 /atirar2 @pessoa (ou /tiro2)
➥ Baleia alguém.

🦵 /chutar1 @pessoa (ou /chute1, /bicuda1)
➥ Dá um chute.

🦵 /chutar2 @pessoa (ou /chute2, /bicuda2)
➥ Outro chute.

🔪 /matar1 @pessoa
➥ Empurra da janela.

🔪 /matar2 @pessoa
➥ Mata alguém.

🦷 /morder @pessoa (ou /mordida)
➥ Morde alguém.

👊 /soco @pessoa (ou /murro)
➥ Soco na cara.

🖐️ /tapa @pessoa (ou /bater)
➥ Tapa na cara.

😂 /risada
➥ Dá risada.

════════════════════

💡 Marque com @ ou responda a mensagem da pessoa.
⚠️ Conteúdo +18: mantenham o respeito.

════════════════════

${RODAPE_MENU}
        `
      }, { quoted: msg });
    } catch (err) {
      console.error("Erro ao enviar o menu-adulto:", err);
    }
  }
};
