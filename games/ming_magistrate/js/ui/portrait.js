/* Each person has an explicit portrait: face, hair, dress and posture share one identity. */
(() => {
 'use strict';const M=globalThis.Ming,{el}=M;
 const profiles={
  you:{face:'angular',skin:'#e5c5a0',robe:'#435d7c',hat:'official',beard:'short',eyes:'steady',brows:'straight',pose:-2},
  hai:{face:'long',skin:'#d8ba97',robe:'#62675f',hat:'official',beard:'trim',eyes:'stern',brows:'heavy',age:true,pose:4},
  qi:{face:'square',skin:'#cfab82',robe:'#606d69',hat:'military',beard:'moustache',eyes:'steady',brows:'heavy',pose:-5},
  hu:{face:'broad',skin:'#d9bc96',robe:'#645d4c',hat:'official',beard:'full',eyes:'narrow',brows:'arched',age:true,pose:3},
  shen:{face:'long',skin:'#e1cbae',robe:'#72786d',hat:'scholar',beard:'grey',eyes:'smile',brows:'soft',age:true,pose:-4},
  zhou:{face:'square',skin:'#c9ad87',robe:'#77818a',hat:'soft',beard:'stubble',eyes:'steady',brows:'straight',pose:5},
  lu:{face:'broad',skin:'#dec5a2',robe:'#79735b',hat:'scholar',beard:'trim',eyes:'narrow',brows:'arched',pose:4},
  xu:{face:'angular',skin:'#ddbd99',robe:'#986448',hat:'soft',beard:'short',eyes:'smile',brows:'arched',pose:-3},
  gu:{face:'round',skin:'#dbc3a4',robe:'#6b665e',hat:'official',beard:'trim',eyes:'narrow',brows:'heavy',age:true,pose:2},
  clerk:{face:'long',skin:'#d8bea0',robe:'#827766',hat:'cloth',beard:'rough',eyes:'down',brows:'soft',age:true,pose:6},
  elder:{face:'round',skin:'#cbb08c',robe:'#8d826c',hat:'cloth',beard:'grey',eyes:'down',brows:'soft',age:true,pose:-5},
  north:{face:'angular',skin:'#bd9873',robe:'#88765f',hat:'wrap',beard:'stubble',eyes:'wide',brows:'straight',pose:5},
  south:{face:'long',skin:'#d1b391',robe:'#696a63',hat:'lowcap',beard:'none',eyes:'down',brows:'soft',pose:-7},
  boat:{face:'square',skin:'#b89571',robe:'#66788a',hat:'wrap',beard:'rough',eyes:'narrow',brows:'heavy',pose:7},
  courier:{face:'oval',skin:'#c9a984',robe:'#6c7e83',hat:'soft',beard:'moustache',eyes:'wide',brows:'straight',pose:-6},
  coroner:{face:'broad',skin:'#d3b69a',robe:'#8a7a65',hat:'cloth',beard:'trim',eyes:'steady',brows:'soft',pose:3},
  lin:{face:'angular',skin:'#e1c6a8',robe:'#788574',hat:'bun',beard:'none',eyes:'steady',brows:'straight',woman:true,pose:-3},
  widow:{face:'round',skin:'#ddc7af',robe:'#7a6254',hat:'lowbun',beard:'none',eyes:'down',brows:'soft',woman:true,pose:5},
  family:{face:'oval',skin:'#ddc3a4',robe:'#998972',hat:'bun',beard:'none',eyes:'wide',brows:'soft',woman:true,pose:-5},
  tenant:{face:'oval',skin:'#d5b18e',robe:'#927456',hat:'tiedbun',beard:'none',eyes:'wide',brows:'soft',woman:true,pose:6},
  scribe:{face:'long',skin:'#dfc9aa',robe:'#747c7a',hat:'lowcap',beard:'none',eyes:'down',brows:'straight',pose:8},
  censor:{face:'square',skin:'#d2baa0',robe:'#6a6c65',hat:'official',beard:'grey',eyes:'stern',brows:'straight',age:true,pose:-1}
 };
 const outlines={
  angular:'M32 40Q31 24 50 23Q69 23 70 40L67 65 59 80 50 87 40 80 33 63Z',
  long:'M33 40Q32 24 50 23Q68 23 68 40L66 67Q63 84 50 92Q36 86 34 68Z',
  square:'M29 41Q29 24 50 24Q72 24 72 42L69 68 61 82 39 83 31 69Z',
  broad:'M27 42Q28 24 50 24Q73 24 74 43L70 68Q64 83 50 86Q33 82 29 67Z',
  round:'M29 43Q28 24 50 24Q73 24 72 43L70 65Q67 86 50 88Q32 85 30 65Z',
  oval:'M31 42Q30 25 50 24Q70 24 70 43L67 66Q63 81 50 87Q36 82 33 65Z'
 };
 function Portrait({person,older=false}){
  const original=profiles[person],p=original&&older?{...original,age:true}:original;if(!p)throw Error('Portrait missing for '+person);
  const ink='#3e433b',hair=p.beard==='grey'||older?'#77786b':'#393d36';
  const line=(d,width=1,opacity=.85)=>el('path',{d,fill:'none',stroke:ink,strokeWidth:width,strokeLinecap:'round',strokeLinejoin:'round',opacity});
  const wash=(d,fill,opacity=1)=>el('path',{d,fill,opacity});
  const short=p.beard==='short',face=outlines[p.face];
  const hat=p.hat==='official'?el('g',null,wash('M28 32L29 15Q50 8 70 16L72 33Z','#353c37'),line('M29 29L13 29 12 34M71 29L88 29 89 34',2),line('M33 18Q50 13 66 19',.8,.5)):
   p.hat==='scholar'?el('g',null,wash('M30 34L33 17Q51 11 68 19L71 35Z','#4a5147'),line('M32 31L68 32M37 18L36 29M63 19L66 31',1)):
   p.hat==='military'?el('g',null,wash('M27 37Q29 15 46 14L48 8 55 9 57 15Q72 20 75 37Z','#586259'),wash('M29 32L72 33 72 39 28 39Z','#aaa080'),line('M49 16L51 30M32 23L29 32M69 24L73 33',1.2)):
   p.hat==='wrap'?el('g',null,wash('M27 39L29 26Q49 16 70 28L74 39 64 34Q46 28 28 44Z',person==='north'?'#c2ad8e':'#8a9a99'),line('M29 33Q49 24 71 36M32 29Q50 23 66 30',1),wash('M68 33L81 38 75 44 71 59 67 58 70 40Z',person==='north'?'#c2ad8e':'#8a9a99')):
   ['bun','lowbun','tiedbun'].includes(p.hat)?el('g',null,wash(p.hat==='lowbun'?'M66 40Q83 40 78 56L67 58Z':'M57 26Q58 10 70 14Q79 18 71 30Z','#373c35'),p.hat==='tiedbun'?el('g',null,line('M61 22L76 27',3,.6),wash('M72 24L83 28 76 32 80 48 74 46Z','#c1aa89')):line(p.hat==='lowbun'?'M67 44L80 47':'M57 23L77 19',1.5)):
   el('g',null,wash(p.hat==='lowcap'?'M30 37L32 27Q49 18 68 27L71 38Z':p.hat==='cloth'?'M29 36L31 25Q49 19 69 27L73 39Z':'M28 36L30 22Q49 14 69 23L73 37Z','#50564c'),line('M31 32Q49 26 69 34',1));
  const eyes={steady:'M35 53Q40 51 45 53M56 53Q61 51 66 53',smile:'M35 54Q40 50 45 54M56 54Q61 50 66 54',stern:'M35 53L45 54M56 54L66 52',narrow:'M35 54L45 54M56 54L66 54',wide:'M35 54Q40 49 45 54M56 54Q61 49 66 54',down:'M35 55Q40 53 45 55M56 55Q61 53 66 55'};
  const brows={straight:'M34 47L45 46M56 46L67 47',soft:'M35 47Q40 44 45 47M56 47Q62 44 66 48',heavy:'M34 46L45 45M56 45L68 46',arched:'M34 47Q40 42 46 46M55 46Q61 42 68 47'};
  let beard=null;
  if(p.beard==='stubble')beard=el('g',null,line('M38 72L42 74M44 74L47 75M53 74L57 73M60 71L62 73',.8,.6),line('M43 82L46 85M50 84L50 87M55 81L54 85',.7,.6));
  else if(p.beard==='moustache')beard=line('M40 71Q45 69 49 72Q54 69 61 71',1.5);
  else if(p.beard!=='none')beard=el('g',null,line('M39 72Q44 69 49 73Q55 69 61 72',p.beard==='rough'?1.6:1.2),wash(short?'M44 80Q50 84 57 79L54 90 49 94 45 89Z':p.beard==='full'?'M36 74Q49 84 65 74L61 95 51 106 40 95Z':p.beard==='trim'?'M40 79Q50 84 61 77L58 93 51 100 44 94Z':'M40 80Q50 85 61 78L59 98 51 110 44 99Z',hair,.8),line(short?'M48 84L49 92M53 84L52 89':'M45 85L49 101M54 86L52 105M58 83L56 96',.6,.55));
  const prop=person==='north'?el('g',null,wash('M12 124L32 116 35 119 16 130Z','#b6a386'),line('M14 128L32 119',1.5),line('M15 130L18 129 20 130 23 127 25 128 28 125',.7)):
   ['tenant','family','lin','scribe'].includes(person)?el('g',null,wash(person==='tenant'?'M62 112L82 116 77 136 57 132Z':'M60 112L82 115 79 136 57 133Z','#efe5cd'),line('M60 114L79 118M63 113L60 131',.7,.6)):
   ['clerk','shen','censor','coroner'].includes(person)?el('g',null,wash('M58 118L83 121 80 136 55 133Z','#c4b693'),line('M63 119L60 134M66 120L63 135',.8,.6)):
   person==='courier'?el('g',null,line('M28 100L73 136M33 99L78 136',2,.7),wash('M65 119L83 125 79 139 62 134Z','#8a7357')):null;
  return el('div',{className:`portrait portrait-${person}`,'data-portrait-person':person,'aria-hidden':'true'},el('svg',{viewBox:'0 0 100 145'},
   el('g',{transform:`rotate(${p.pose} 50 88)`},
    wash('M6 139Q11 109 31 101L39 91 61 91 70 101Q89 111 95 140L74 143 48 140 27 142Z',p.robe,.78),
    wash('M10 139Q16 112 33 103L44 118 38 141Z',p.robe,.28),wash('M63 99Q87 110 91 139L72 142 55 118Z',p.robe,.3),
    line('M8 139Q13 112 32 103L39 93M62 94L69 102Q88 113 93 139',1.3),
    wash('M36 91L49 115 64 91 58 116 49 125 41 115Z','#f3ecdc'),line('M36 92L49 116 64 93M49 116L40 143M52 120L72 143',1.1),
    line('M21 115L17 130M30 112L24 134M72 112L82 133M68 125L74 137',.65,.48),
    wash(face,p.skin),wash('M62 34Q73 52 64 76L53 88 60 69Z','#81735e',.14),line(face,1.1),
    line('M30 48Q24 47 28 60L32 64M71 48Q77 47 73 60L69 64',.75),
    wash(p.woman?'M30 47Q23 29 36 22Q51 14 66 24Q77 32 70 49L63 34 51 29Q38 31 30 47Z':'M30 45Q24 26 38 21Q57 15 70 29L70 45 63 33 48 28 35 37Z',p.age?'#57594e':'#373d35'),
    p.age&&el('g',null,line('M34 63L39 66M61 64L66 66M37 70L35 77M64 70L66 77',.6,.5),line('M37 41L45 40M56 40L64 42',.6,.45)),
    line(brows[p.brows],p.brows==='heavy'?1.6:1,.8),line(eyes[p.eyes],1.1),
    p.eyes==='wide'&&el('g',null,line('M40 52L40 55M61 52L61 55',1.1)),
    line(p.face==='broad'?'M50 53L47 65 54 67':'M51 53L47 66 53 68',.85),
    line(p.eyes==='smile'?'M43 75Q50 80 58 74':p.eyes==='down'?'M43 77Q50 74 58 77':'M43 76Q50 78 58 75',.85),beard,hat,prop
   )));
 }
 Object.assign(M,{Portrait,portraitProfiles:profiles});
})();
