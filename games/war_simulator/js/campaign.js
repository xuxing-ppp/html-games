// A finite campaign: immutable enemy deployment, budgeted player army and local best stars.
(function(){
  const $=id=>document.getElementById(id),T=W.Config.UNIT_TYPES;
  const levels=[
    {name:'初阵 · 林地遭遇',budget:260,mode:'classic',enemy:[['tribesman',10]],army:[['roman_swordsman',4],['archer',3]],tip:'步兵在前，弓手在后。少量精兵也能挡住散乱的冲锋。'},
    {name:'破阵 · 盾墙之后',budget:460,mode:'classic',enemy:[['shielder',4],['archer',3]],army:[['mage',3],['roman_swordsman',5]],tip:'正面盾牌很坚固，试试范围伤害，或把近战拆成两翼。'},
    {name:'截击 · 风驰电掣',budget:520,mode:'classic',enemy:[['lancer',4],['mounted_archer',2]],army:[['pikeman',6],['frost_mage',2]],tip:'长戟迎击冲锋，寒冰限制骑兵。让前排有足够宽度。'},
    {name:'夺旗 · 中央高地',budget:600,mode:'control',enemy:[['roman_swordsman',6],['priest',2],['standard',1]],army:[['hammerer',2],['shielder',3],['priest',2],['standard',1]],tip:'独占据点 30 秒即可获胜。重锤清空据点，军旗和治疗维持前线。'},
    {name:'攻坚 · 巨人之门',budget:690,mode:'classic',enemy:[['giant',3],['priest',2]],army:[['ballista',3],['pikeman',4],['frost_mage',1]],tip:'别让巨人碰到弩炮。长戟拦截、寒冰减速，给重弩创造射击窗口。'},
    {name:'突围 · 奥术火线',budget:740,mode:'classic',enemy:[['mage',5],['frost_mage',2],['shielder',3]],army:[['duelist',5],['lancer',3],['priest',2]],tip:'分散站位减少爆炸损失，用快速部队逼近脆弱的后排。'},
    {name:'绝境 · 风暴之眼',budget:840,mode:'storm',enemy:[['hammerer',3],['bomber',3],['standard',1]],army:[['heavy_knight',4],['priest',3],['frost_mage',2],['bomber',1]],tip:'战圈会收缩。持续治疗与重甲能撑过最后的混战，过度风筝则会付出代价。'},
    {name:'终章 · 万军之锋',budget:1100,mode:'control',enemy:[['pikeman',4],['ballista',2],['hammerer',2],['priest',2],['standard',1]],army:[['hammerer',3],['mage',3],['priest',3],['shielder',3],['standard',2]],tip:'综合运用范围伤害、治疗和击退。可以抢占据点，也可以尝试歼灭敌军。'}
  ];
  let active=false,index=0,progress=Array(levels.length).fill(0),spent=0;
  function read(){try{const v=JSON.parse(localStorage.getItem('war-lab-campaign-v1'));if(Array.isArray(v))progress=levels.map((_,i)=>Number.isInteger(v[i])?Math.max(0,Math.min(3,v[i])):0);}catch(e){}}
  function unlocked(){let n=0;while(n<levels.length-1&&progress[n]>0)n++;return n;}
  function deploy(team,groups){let col=0;for(const [id,n] of groups){for(let i=0;i<n;i++)W.Game.createUnit(id,team,(team==='red'?-1:1)*(180+(col+Math.floor(i/6))*66),(i%6-(Math.min(n,6)-1)/2)*56);col+=Math.ceil(n/6);}}
  function restoreEnemy(){if(!active)return;W.Game.state.units=W.Game.state.units.filter(u=>u.team!=='blue');deploy('blue',levels[index].enemy);W.Game.recomputeCosts();}
  function load(i){if(i<0||i>=levels.length||i>unlocked())return false;active=true;index=i;W.Terrain.setMap('meadow');W.Game.clearAll(true);W.Lab.clearHistory();deploy('blue',levels[i].enemy);deploy('red',levels[i].army);W.Game.recomputeCosts();$('battleMode').value=levels[i].mode;$('battleMode').onchange?.();W.UI.updatePhaseUI();W.Renderer.fit();refresh();W.UI.flash('你指挥红军 · 可调整推荐阵容');return true;}
  function leave(){active=false;W.Game.clearAll(true);W.Lab.clearHistory();$('btnNextLevel').hidden=true;W.UI.updatePhaseUI();refresh();W.UI.flash('已返回自由沙盘');}
  function allow(typeId,team){if(!active)return true;if(team!=='red'){W.UI.flash('闯关时只能调整红军');return false;}W.Game.recomputeCosts();if(W.Game.state.redCost+T[typeId].cost>levels[index].budget){W.UI.flash('预算不足，删除士兵可返还预算');return false;}return true;}
  function canStart(){if(!active)return true;W.Game.recomputeCosts();if(W.Game.state.redCost>levels[index].budget){W.UI.flash('超出关卡预算，请调整阵容');return false;}spent=W.Game.state.redCost;return true;}
  function result(winner,seconds){if(!active)return;const won=winner==='red',alive=W.Game.state.units.filter(u=>u.alive&&u.team==='red').length,original=W.Game.state.setupSnapshot.filter(u=>u.team==='red').length;
    const stars=won?1+(alive>=Math.ceil(original/2)?1:0)+(spent<=levels[index].budget*.85?1:0):0;
    if(won){progress[index]=Math.max(progress[index],stars);try{localStorage.setItem('war-lab-campaign-v1',JSON.stringify(progress));}catch(e){W.UI.flash('进度暂存于本次游戏，浏览器未允许保存');}}
    $('bannerTitle').textContent=won?(index===levels.length-1?'战役通关！':'关卡胜利！'):winner==='draw'?'势均力敌':'再试一种战术';
    $('bannerSub').textContent=won?`${'★'.repeat(stars)}${'☆'.repeat(3-stars)} · ${seconds.toFixed(1)} 秒 · 花费 ${spent}/${levels[index].budget} · 存活 ${alive}/${original}`:levels[index].tip;
    $('btnNextLevel').hidden=!won||index===levels.length-1;refresh();
  }
  function refresh(){const selector=$('levelSelect');selector.innerHTML=levels.map((l,i)=>`<option value="${i}" ${i>unlocked()?'disabled':''}>${i+1}. ${l.name} ${i>unlocked()?'🔒':progress[i]?'★'.repeat(progress[i]):''}</option>`).join('');selector.value=String(index);$('campaignBrief').textContent=active?levels[index].tip:'八场战术挑战。红军由你指挥，固定敌军、有限预算，逐关解锁。';$('campaignBudget').hidden=!active;document.body.classList.toggle('campaign-active',active);$('btnLeaveCampaign').hidden=!active;if(W.Menu)W.Menu.sync();}
  function hud(){$('btnClear').textContent=active?'✕ 清空红军':'✕ 清空全部';$('btnRandom').textContent=active?'随机红军':'随机配兵（每边）';$('budgetInput').hidden=active;const battle=W.Game.state.phase==='battle';if(active){$('campaignBudget').textContent=`第 ${index+1} / ${levels.length} 关 · 可用预算 ${levels[index].budget-W.Game.state.redCost} / ${levels[index].budget}`;for(const id of ['scenario','btnScenario','battleMode','btnLoad','btnSave'])$(id).disabled=true;}for(const id of ['levelSelect','btnCampaign','btnLeaveCampaign'])$(id).disabled=battle&&!W.Game.state.winner;}
  function random(){if(!active)return false;W.Lab.remember();W.Game.clearAll();W.Game.randomArmy('red',levels[index].budget);W.Game.recomputeCosts();return true;}
  function init(){read();$('btnCampaign').onclick=()=>load(Number($('levelSelect').value));$('btnLeaveCampaign').onclick=leave;$('btnNextLevel').onclick=()=>load(index+1);refresh();}
  W.Campaign={init,load,leave,allow,canStart,result,hud,random,restoreEnemy,levels,get active(){return active;},get index(){return index;},get progress(){return progress.slice();}};
})();
