"use strict";
const fs=require("fs"),vm=require("vm"),path=require("path");
const ROOT=path.resolve(__dirname,"..");
const attrs={};
const doc={documentElement:{lang:""},title:"",querySelector(){return null;},querySelectorAll(){return[];}};
const localStorage={_d:{},getItem(k){return this._d[k]||null;},setItem(k,v){this._d[k]=String(v);}};
const s={console,document:doc,localStorage,setTimeout,clearTimeout};s.window=s;s.SV={};vm.createContext(s);
for(const f of ["util.js","config.js","storage.js","i18n.js"]){vm.runInContext(fs.readFileSync(path.join(ROOT,"js",f),"utf8"),s,{filename:f});}
const C=s.SV.Config,I=s.SV.I18n,ref=C.WEAPONS.blade,damage=C.WEAPONS.blade.stats(8).damage;
function ok(v,m){if(!v)throw new Error(m);console.log("ok - "+m);}
I.init();
ok(I.getLanguage()==="en","missing preference defaults to English");
ok(C.WEAPONS.blade.name==="Orbiting Blades","base weapon localized to English");
ok(C.WEAPON_EVOS.blade_aura.name==="Annihilation Wheel","fusion localized to English");
ok(C.CHARACTERS.collector.ability.damageName==="Magnetic Crystal Volley","nested character text localized");
ok(C.WEAPONS.blade===ref&&C.WEAPONS.blade.stats(8).damage===damage,"localization preserves object identity and numbers");
I.setLanguage("zh-CN");
ok(C.WEAPONS.blade.name==="旋转光刃"&&C.CHARACTERS.collector.name==="磁芯","Chinese round-trip restores canonical text");
ok(C.BOSSES.bloodhunter.name==="血棘猎手"&&C.BOSSES.riftsentry.name==="裂隙哨兵","new Boss names restore in Chinese");
ok(C.BOSSES.thornwarden.name==="铁棘卫士"&&C.BOSSES.eclipseeye.name==="蚀界之眼","additional Boss names restore in Chinese");
ok(s.SV.Storage.get("language")==="zh-CN","Chinese preference persisted");
I.setLanguage("en");
ok(C.BOSSES.duke.name==="Bloated Duke"&&C.STAGES.void.name==="Void Abyss","English round-trip covers boss and stage");
ok(C.BOSSES.bloodhunter.name==="Bloodthorn Hunter"&&C.BOSSES.riftsentry.name==="Rift Sentry","new Boss names translate to English");
ok(C.BOSSES.thornwarden.name==="Ironthorn Warden"&&C.BOSSES.eclipseeye.name==="Eclipse Eye","additional Boss names translate to English");
ok(doc.documentElement.lang==="en"&&doc.title==="Neon Survivor","document metadata follows language");
console.log("i18n logic passed");
