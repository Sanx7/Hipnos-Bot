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
      const padrao = { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [] };
      fs.writeFileSync(BANCO_CONFIG, JSON.stringify(padrao, null, 2));
      return padrao;
    }
    const dados = fs.readFileSync(BANCO_CONFIG, 'utf-8');
    const json = JSON.parse(dados);
    if (!json.antiStatus) json.antiStatus = []; // Garante a propriedade
    return json;
  } catch (err) {
    console.error("Erro ao ler antias.json:", err);
    return { antiAudio: [], antiDocument: [], antiEvent: [], antiLink: [], antiPayment: [], antiStatus: [] };
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
  nome: "antistatus",
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
          text: '🌑 Hipnos recusa sua invocação... você não dita quais visões cruzam este reino.' 
        }, { quoted: msg });
      }

      const args = text.split(' ').slice(1);
      if (!args.length) {
        return await sock.sendMessage(jid, { 
          text: '❌ O ritual exige uma escolha. Digite 1 para banir marcações de status/histórias ou 0 para permiti-las.' 
        }, { quoted: msg });
      }

      const opcao = args[0].trim();
      let configs = lerConfiguracoes();

      if (opcao === '1') {
        if (configs.antiStatus.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '💀 A névoa contra falsos alertas de status já está densa. Nenhuma menção intrusa passará.' 
          }, { quoted: msg });
        }
        
        configs.antiStatus.push(jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚖️ CEGUEIRA DO LIMBO\n\n⚙️ Hipnos baniu as marcações de status encaminhadas.\n👁️ Qualquer tentativa de forçar visualizações ou espalhar histórias externas banirá o autor para as trevas.' 
        }, { quoted: msg });
      
      } else if (opcao === '0') {
        if (!configs.antiStatus.includes(jid)) {
          return await sock.sendMessage(jid, { 
            text: '⚠️ Os alertas de status já transitam livremente. Não há bloqueio ativo.' 
          }, { quoted: msg });
        }
        
        configs.antiStatus = configs.antiStatus.filter(id => id !== jid);
        salvarConfiguracoes(configs);
        
        return await sock.sendMessage(jid, { 
          text: '🌑⚙️ O bloqueio de visões foi dispersado. Hipnos permite que referências a mídias externas voltem a circular.' 
        }, { quoted: msg });
      
      } else {
        return await sock.sendMessage(jid, { 
          text: '❌ Comando inválido... Decida-se: 1 para trancar marcações de status ou 0 para liberá-las.' 
        }, { quoted: msg });
      }

    } catch (err) {
      console.error('Erro no comando antistatus:', err);
    }
  }
};