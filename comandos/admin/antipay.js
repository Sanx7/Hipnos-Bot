const fs = require('fs');
const path = require('path');

const BANCO_CONFIG = path.join(__dirname, '..', 'dados', 'antias.json');

function lerConfiguracoes() {
  try {
    const pastaDados = path.dirname(BANCO_CONFIG);
    if (!fs.existsSync(pastaDados)) {
      fs.mkdirSync(pastaDados, { recursive: true });
    }
    if (!fs.existsSync(BANCO_CONFIG)) {
      const padrao = { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [] };
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2));
      return padrao;
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    const json = JSON.parse(dados);
    if (!json.antiPayment) json.antiPayment = [];
    return json;
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [] };
  }
}

function salvarConfiguracoes(config) {
  try {
    fs.writeFileSync(BANCO_CONFIG, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Erro ao salvar antias.json:", err);
  }
}

module.exports = {
  nome: "antipay", // Alterado para o nome que você escolheu!
  async executar(sock, jid, msg, text) {
    try {
      const ehGrupo = jid.endsWith('@g.us');
      if (!ehGrupo) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos não desperdiça feitiços fora de um território coletivo. Use este comando em um grupo.' 
        }, { quoted: msg });
      }

      // Validação do Dono (O Soberano)
      const sender = msg.key.participant || msg.key.remoteJid;
      const numeroDoSender = sender.split('@')[0].split(':')[0].replace(/\D/g, '');
      const SEU_LID = '177060848861240';

      if (numeroDoSender !== SEU_LID) {
        return await sock.sendMessage(jid, { 
          text: '🌑 Hipnos recusa sua invocação... as transações mundanas e seus selos estão além da sua autoridade.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para banir cobranças materiais ou 0 para tolerá-las.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.antiPayment.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 A contenção de moedas e pactos já está erguida neste recinto. Nenhuma transação passará.' 
          }, { quoted: msg });
        }
        
        configs.antiPayment.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ PURGAÇÃO DE PACTOS\n\n⚙️ Hipnos ativou a contenção comercial.\n💰 Qualquer tentativa de gerar pagamentos, transferências ou cobranças ocultas resultará no fechamento do portão e no banimento imediato do autor para o limbo.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.antiPayment.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ O comércio flui sem interferências aqui. Não há restrição ativa.' 
          }, { quoted: msg });
        }
        
        configs.antiPayment = configs.antiPayment.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ O bloqueio de moedas foi suspenso. Hipnos recolhe suas correntes e permite transações materiais de novo.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para trancar os pagamentos ou 0 para liberá-los.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando antipay:', err);
    }
  }
};