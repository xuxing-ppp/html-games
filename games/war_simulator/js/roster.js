// Distinct weapon masses, mobility and active abilities; shared config remains data-only.
(function(){
  const T=W.Config.UNIT_TYPES;
  const melee={attackInterval:1,range:22,kind:'melee',helmet:true,projectile:null,accent:'#b5bfc8',knockback:65};
  const ranged={attackInterval:1.5,kind:'ranged',helmet:false,weapon:'staff',knockback:20,mass:1,radius:12,moveSpeed:30};
  Object.assign(T,{
    lancer:{...melee,name:'疾风枪骑',nameEn:'Lancer',cost:85,hp:140,attack:27,moveSpeed:75,mass:2.5,radius:15,range:35,weapon:'spear',accent:'#edc382',special:{kind:'charge'},restitution:.3,turnRate:3,spin:0,desc:'蓄势冲锋，碰撞造成额外伤害与击退。长枪克制远程，密集重甲能阻停冲锋。'},
    hammerer:{...melee,name:'震地重锤',nameEn:'Earthshaker',cost:110,hp:230,attack:33,moveSpeed:29,mass:3.4,radius:16,weapon:'hammer',weaponMass:.65,accent:'#bca182',special:{kind:'quake'},spin:2,desc:'每 5 秒震地，击退并短暂打断周围敌人。重量大、起步慢，适合突破密集阵线。'},
    duelist:{...melee,name:'游刃剑客',nameEn:'Duelist',cost:65,hp:85,attack:25,attackInterval:.55,moveSpeed:67,mass:.85,radius:11,weapon:'sword',weaponMass:.12,accent:'#e0c8ab',helmet:false,special:{kind:'dash'},spin:6.4,desc:'向敌人侧翼突进，短时格挡部分伤害。轻盈高攻，惧怕范围打击和强力击退。'},
    frost_mage:{...ranged,name:'霜语术士',nameEn:'Cryomancer',cost:80,hp:65,attack:12,range:245,accent:'#8fe3e7',special:null,projectile:{speed:230,damage:12,knockback:15,lifetime:1.2,spread:.04,kind:'frost',slow:2.4},desc:'冰晶命中减速 2.4 秒；限制冲锋与转身，配合长枪和弩炮制造输出窗口。'},
    ballista:{...ranged,name:'重型弩炮',nameEn:'Ballista',cost:125,hp:145,attack:52,attackInterval:2.8,range:390,moveSpeed:16,mass:4,radius:19,weapon:'ballista',accent:'#c49a62',turnRate:1.4,restitution:.15,special:null,projectile:{speed:490,damage:52,knockback:150,lifetime:.95,spread:.025,kind:'bolt',pierce:3,recoil:90},desc:'重弩贯穿最多 3 名敌军，连续命中伤害递减。发射产生后坐力，侧翼需要步兵保护。'},
    bomber:{...ranged,name:'炼金投弹手',nameEn:'Alchemist',cost:95,hp:60,attack:25,attackInterval:2.1,range:210,weapon:'bomb',accent:'#e7a25c',special:null,projectile:{speed:170,damage:25,knockback:70,lifetime:1.5,spread:.12,kind:'bomb',aoe:{radius:72,damage:26,kb:100}},desc:'投掷爆弹，较大的爆炸范围克制密集部队；装填缓慢，需要前排保护。'},
    standard:{...melee,name:'军旗卫士',nameEn:'Standard Bearer',cost:75,hp:140,attack:12,moveSpeed:38,mass:1.8,radius:13,weapon:'flag',accent:'#e5ce78',special:{kind:'rally'},spin:1.8,desc:'附近友军获得 18% 攻击加成与 12% 加速。光环不叠加，阵亡后加成消失。'},
    pikeman:{...melee,name:'铁壁长戟',nameEn:'Pikeman',cost:55,hp:115,attack:24,moveSpeed:30,mass:2,radius:13,range:43,weapon:'spear',weaponMass:.35,accent:'#a4c6b2',special:{kind:'brace'},turnRate:3.5,spin:0,desc:'迎敌架枪，减轻正面冲撞并反伤冲锋骑兵。侧翼脆弱，长武器难应付贴身包围。'}
  });
  Object.assign(T.heavy_knight,{restitution:.25,weaponMass:.5,spin:2.5});
  Object.assign(T.giant,{restitution:.2,weaponMass:.8,spin:1.8});
  Object.assign(T.shielder,{restitution:.25,spin:0,turnRate:3});
})();
