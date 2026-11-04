// View-only state. Paging and panels never change the simulation or save format.
(function(){
  const $=id=>document.getElementById(id);
  let page=0, capacity=6, filter='all';
  function cards(){return Array.from(document.querySelectorAll('.unit-card'));}
  function matches(c){const cfg=W.Config.UNIT_TYPES[c.dataset.id],q=$('unitSearch').value.trim().toLowerCase();return (filter==='all'||cfg.kind===filter)&&(cfg.name+cfg.nameEn+cfg.desc).toLowerCase().includes(q);}
  function paginate(){
    const list=$('unitList'),items=cards(),filtered=items.filter(matches);
    const box=list.getBoundingClientRect();
    const cols=box.width>=230?2:1, rows=Math.max(1,Math.floor(box.height/70));
    capacity=cols*rows;
    list.style.setProperty('--columns',String(cols));
    const pages=Math.max(1,Math.ceil(filtered.length/capacity));page=Math.min(page,pages-1);
    items.forEach(c=>c.hidden=true);filtered.slice(page*capacity,(page+1)*capacity).forEach(c=>c.hidden=false);
    list.style.setProperty('--slots',String(capacity));
    $('unitPage').textContent=filtered.length?`${page+1} / ${pages}`:'无匹配';
    $('unitPrev').disabled=page===0;$('unitNext').disabled=page>=pages-1;
  }
  function tab(name){
    $('commandTitle').textContent={unit:'兵种详情',deploy:'布阵工具',storage:'本机存档'}[name]||'兵种';
    const roster=name==='roster';$('sidebar').hidden=!roster;$('commandPanel').hidden=roster;
    document.querySelectorAll('[data-command-page]').forEach(p=>p.hidden=p.dataset.commandPage!==name);
    document.querySelectorAll('[data-side-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.sideTab===(name==='unit'?'roster':name))));
    if(roster)requestAnimationFrame(paginate);
  }
  function refresh(){
    document.querySelectorAll('[data-side-tab="storage"]').forEach(b=>{b.disabled=!!W.Campaign.active;b.title=W.Campaign.active?'闯关进度自动保存':'';});
  }
  function panel(open){
    refresh();document.body.classList.toggle('deployment-open',open);$('btnTools').setAttribute('aria-expanded',String(open));$('btnUnitDetails').setAttribute('aria-expanded',String(open));
    W.UI.hideTooltip();
  }
  function selection(){const id=W.Game.state.input.selectedTypeId;if(id)$('selectedUnitName').textContent=W.Config.UNIT_TYPES[id].name;}
  function init(){
    cards().forEach(c=>{const icon=c.querySelector('.uc-swatch');if(icon){icon.innerHTML='';const img=document.createElement('img');img.src=W.Renderer.thumbnail(c.dataset.id);img.alt='';icon.appendChild(img);}c.addEventListener('click',()=>{selection();if(window.innerWidth<=560)panel(false);});c.addEventListener('keydown',selection);});
    document.querySelectorAll('[data-unit-art]').forEach(img=>img.src=W.Renderer.thumbnail(img.dataset.unitArt,img.dataset.team));
    $('unitPrev').onclick=()=>{page--;paginate();};$('unitNext').onclick=()=>{page++;paginate();};
    document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;page=0;paginate();}));
    $('unitSearch').addEventListener('input',()=>{page=0;paginate();});
    $('btnTools').onclick=()=>{tab('roster');panel(!document.body.classList.contains('deployment-open'));};
    document.querySelectorAll('[data-side-tab]').forEach(b=>b.onclick=()=>{tab(b.dataset.sideTab);panel(true);});
    $('btnUnitDetails').onclick=()=>{tab('unit');panel(true);};
    $('btnCloseCommand').onclick=()=>{tab('roster');$('btnUnitDetails').focus();};
    window.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('deployment-open')){panel(false);if(window.innerWidth<=560)$('btnTools').focus();else{tab('roster');$('btnUnitDetails').focus();}}});
    $('btnStart').addEventListener('click',()=>panel(false));$('btnHome').addEventListener('click',()=>panel(false));
    new ResizeObserver(paginate).observe($('unitList'));
    tab('roster');selection();paginate();
  }
  W.Presentation={init,paginate,refresh,reset(){tab('roster');panel(false);}};
})();
