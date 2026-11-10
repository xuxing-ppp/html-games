const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const base=path.join(__dirname,'..');
function load(){
 const sandbox=vm.createContext({console,performance});
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'original-scripts.json'),'utf8'));
 for(const script of [...original,'web/tags.js','web/descriptions.js','web/characters.js','web/model.js','web/mechanisms.js','web/tournament-core.js','web/tournament.js'])vm.runInContext(fs.readFileSync(path.join(base,script),'utf8'),sandbox,{filename:script});
 return sandbox;
}
module.exports={load};
