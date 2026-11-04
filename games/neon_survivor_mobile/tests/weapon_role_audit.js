// Targeted moving-Boss / armored-support follow-up. Same seeds, prerequisites and movement for all variants.
const {load,state,step}=require('./combat_harness');
const tacticalInput=require('./tactical_input');
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const ids=arg('--weapons','blade_boomerang,sentry_hex,lance_evo,blade_frost').split(',');
for(const id of ids)for(const scene of ['boss','support'])for(const seed of [0x51a7,0x9273,0xc314,0x7849,0xef12]) {
  const variants=['current','sources','refilled'];
  for(const variant of variants) {
    const SV=load(arg('--root'),seed),C=SV.Config,def=C.weaponDef(id);
    const sources=def.fuse||[id.replace(/_evo$/,'')];
    const s=state(SV,{difficulty:'hard',weapon:id,minute:18});
    s.passives=Object.fromEntries(Object.keys(C.PASSIVES).map(k=>[k,5]));SV.Entities.invalidateMods(s);
    s.player.hp=s.player.maxHp=SV.Entities.mods(s).maxHp;
    s.weapons=(variant==='sources'?sources:[id]).map(id=>({id,level:8,cd:0,angle:0,evolved:!C.WEAPONS[id]}));
    if(variant==='refilled')s.weapons.push({id:sources.includes('shotgun_evo')?'missile':'shotgun',level:1,cd:0,angle:0,evolved:false});
    SV.Waves.update=()=>{};
    if(scene==='boss')SV.Entities.addBoss(s,'colossus',210,0);
    else for(let i=0;i<32;i++) {
      const a=i/32*Math.PI*2,r=140+i%4*25;
      const e=SV.Entities.addEnemy(s,i<2?'priest':i<4?'warden':i%3?'zombie':'shielder',Math.cos(a)*r,Math.sin(a)*r);
      if(i===4){e.elite=true;e.hp*=3.5;e.maxHp*=3.5;}
    }
    let frames=0;
    for(;frames<30*60&&!s.dead&&s.enemies.length;frames++)step(SV,s,1/60,()=>tacticalInput(SV,s,frames));
    console.log(JSON.stringify({id,scene,seed,variant,seconds:frames/60,dead:s.dead,kills:s.kills,taken:Object.values(s.enemyDamage).reduce((a,b)=>a+b,0),
      remaining:s.enemies.length,metrics:s.hitMetrics,engagementKills:s.engagementKills}));
  }
}
