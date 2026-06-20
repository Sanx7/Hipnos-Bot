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
      const padrao = { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [] };
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2));
      return padrao;
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    const json = JSON.parse(dados);
    if (!json.antiLink) json.antiLink = []; // Garante a propriedade
    return json;
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [] };
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
  nome: "antilink",
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
          text: '🌑 Hipnos recusa sua invocação... você não possui o domínio dos portais deste reino.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para selar os portais (links) ou 0 para reabri-los.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.antiLink.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 A barreira contra portais externos já está ativa. Nenhuma rota de fuga passará.' 
          }, { quoted: msg });
        }
        
        configs.antiLink.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ FECHAMENTO DE PORTAIS\n\n⚙️ Hipnos ativou a contenção de links.\n🔗 Qualquer tentativa de enviar caminhos externos ou convites será imediatamente apagada e desfeita.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.antiLink.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ As pontes e caminhos já estão abertos por aqui. Não há selo para remover.' 
          }, { quoted: msg });
        }
        
        configs.antiLink = configs.antiLink.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ A barreira ruiu. Hipnos permite que os membros voltem a compartilhar seus portais.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para trancar os links ou 0 para liberá-los.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando antilink:', err);
    }
  }
};