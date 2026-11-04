/* The game surface and its reader have separate update lifetimes. */
(() => {
 'use strict';
 const M=globalThis.Ming,root=document.getElementById('root'),loaded=M.readSave(),motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
 const freshUI=()=>({pages:[],selectedItem:null,endingAct:0,endingActRead:-1,guidesDone:new Set()});
 const state={game:null,saved:loaded.saved,error:loaded.error,font:20,reduced:false,replay:null,ui:freshUI()};
 try{const size=Number(localStorage.getItem('jingshui.reading-size'));if([18,20,22].includes(size))state.font=size;state.reduced=localStorage.getItem('jingshui.reduced-motion')==='true';}catch{}
 let gameRoot=null,dialog=null,disposeGame=()=>{},disposeLibrary=()=>{},gameDirty=false,toastTimer,replayReturn=null;
 const reduced=()=>state.reduced||motionPreference.matches;
 const currentGame=()=>state.replay??state.game;
 function snapshot(){const page=state.ui.pages.at(-1),body=dialog?.querySelector('.library-body');if(page&&body){page.top=body.scrollTop;page.disclosures=[...dialog.querySelectorAll('details[data-disclosure-key]')].map(n=>[n.dataset.disclosureKey,n.open]);}}
 function focus(key){if(!key)return;[...(dialog??gameRoot??root).querySelectorAll('button,input,textarea,select')].find(n=>n.dataset.focusKey===key||n.textContent===key)?.focus({preventScroll:true});}
 function push(type,args={}){snapshot();const active=document.activeElement;state.ui.pages.push({type,...args,top:0,origin:active?.dataset.focusKey??active?.textContent});render({game:false});}
 function back(){snapshot();const page=state.ui.pages.pop();render({game:false});focus(page?.origin);}
 function close(){const origin=state.ui.pages[0]?.origin;state.ui.pages=[];render({game:false});focus(origin);}
 function set(change){snapshot();Object.assign(state.ui,change);render({game:'selectedItem' in change||'endingAct' in change,motion:'endingAct' in change});}
 function setFont(size){snapshot();state.font=size;try{localStorage.setItem('jingshui.reading-size',String(size));}catch{}render({game:false});}
 function setReduced(value){snapshot();state.reduced=value;try{localStorage.setItem('jingshui.reduced-motion',String(value));}catch{}render({game:false});}
 function dispatch(action,redraw=true){
  const game=currentGame();if(!game)return;snapshot();const previousError=state.error,next=M.reduce(game,action);if(next===game)return;
  const moved=next.node!==game.node||next.phase!==game.phase||next.explorationFocus!==game.explorationFocus;
  if(['place','pair','order'].includes(action.type))state.ui.guidesDone.add(M.puzzles[M.currentNode(game).puzzle]?.kind);
  if(state.replay)state.replay=next;else{state.game=next;state.saved=next;state.error=M.writeSave(next);}
  if(moved){state.ui.selectedItem=null;state.ui.pages=[];}
  const surfaceChanged=!['hint','note','editNote','removeNote'].includes(action.type)||previousError!==state.error;
  gameDirty=gameDirty||surfaceChanged;
  if(redraw){
   render({game:!state.ui.pages.length&&surfaceChanged,motion:moved});
   if(action.type==='submitPuzzle'&&next.feedback?.kind==='wrong')requestAnimationFrame(()=>{const feedback=gameRoot?.querySelector('.puzzle-feedback');feedback?.focus({preventScroll:true});feedback?.scrollIntoView({block:'nearest'});});
  }
 }
 function restart(){state.game=M.initial();state.saved=state.game;state.replay=null;state.ui=freshUI();M.resetReaders();M.resetPaperReading();state.error=M.writeSave(state.game);render({motion:true});}
 function resume(){state.game=state.saved;state.ui=freshUI();render();}
 function home(){state.game=null;state.ui.pages=[];render();}
 function disposeAll(){disposeLibrary();disposeGame();disposeLibrary=disposeGame=()=>{};M.cancelSceneTransitions();}
 function startReplay(){snapshot();disposeAll();replayReturn={ui:structuredClone(state.ui),anchors:M.snapshotPaperReading(),readerAnchors:M.snapshotReaderReading()};state.replay=M.initial();state.ui=freshUI();M.resetReaders();M.resetPaperReading();render({motion:true});}
 function endReplay(){if(!state.replay)return;disposeAll();state.replay=null;state.ui=replayReturn.ui;M.restorePaperReading(replayReturn.anchors);M.restoreReaderReading(replayReturn.readerAnchors);replayReturn=null;render();}
 function toast(text){clearTimeout(toastTimer);root.querySelector('.toast')?.remove();const t=M.el('div',{className:'toast',role:'status'},text);root.append(t);toastTimer=setTimeout(()=>t.remove(),2200);}
 function view(){return {...state,reduced:reduced(),systemReduced:motionPreference.matches,game:currentGame(),replay:!!state.replay,dispatch,set,push,back,close,setFont,setReduced,restart,resume,home,startReplay,endReplay,toast};}
 function mountSurface(surface){const readers=M.mountReaders(surface),art=M.mountArt(surface);return()=>{readers();art();};}
 function render({game=true,motion=false}={}){
  if(currentGame()?.phase==='ending')state.ui.endingActRead=Math.max(state.ui.endingActRead,state.ui.endingAct);
  const active=document.activeElement,key=active?.dataset.focusKey,selection=active&&'selectionStart'in active?{a:active.selectionStart,b:active.selectionEnd}:null;
  root.style.setProperty('--reading-size',state.font+'px');root.dataset.reduced=String(reduced());
  if(reduced())M.cancelSceneTransitions();
  // A hidden surface only needs rebuilding if a game action changed its contents.
  const replaceGame=game||!gameRoot||(gameDirty&&!state.ui.pages.length);
  if(replaceGame){
   const details=new Map([...gameRoot?.querySelectorAll('details[data-disclosure-key]')??[]].map(n=>[n.dataset.disclosureKey,n.open]));
   disposeGame();
   const next=M.GameView(view()),previousArt=gameRoot?.querySelector('.scene-art'),nextArt=next.querySelector('.scene-art');
   let startTransition=null;
   if(previousArt&&nextArt&&previousArt.dataset.artKey===nextArt.dataset.artKey)nextArt.replaceWith(previousArt);
   else{
    if(motion&&!reduced()&&previousArt&&nextArt)startTransition=M.prepareSceneTransition(previousArt,nextArt);
    M.cancelSceneTransitions();
   }
   if(gameRoot)gameRoot.replaceWith(next);else root.prepend(next);
   gameRoot=next;gameDirty=false;
   for(const n of gameRoot.querySelectorAll('details[data-disclosure-key]'))if(details.has(n.dataset.disclosureKey))n.open=details.get(n.dataset.disclosureKey);
   disposeGame=mountSurface(gameRoot);startTransition?.();
   const g=currentGame();
   if(state.replay&&g.node==='names-close'&&g.beat===M.sceneBeats(g).length-1){const advance=gameRoot.querySelector('[data-advance]');advance?.replaceWith(M.el(M.Action,{label:'结束教学回放',onClick:endReplay}));}
  }
  // Reader navigation keeps its own lifetime; pending game changes apply on close.
  const disclosures=new Map(state.ui.pages.at(-1)?.disclosures??[]);
  disposeLibrary();dialog?.remove();dialog=M.Library(view());disposeLibrary=()=>{};
  if(dialog){
   root.append(dialog);dialog.showModal();
   for(const n of dialog.querySelectorAll('details[data-disclosure-key]'))if(disclosures.has(n.dataset.disclosureKey))n.open=disclosures.get(n.dataset.disclosureKey);
   dialog.querySelector('.library-body').scrollTop=state.ui.pages.at(-1).top??0;
   disposeLibrary=mountSurface(dialog);
  }
  if(key){focus(key);const selected=document.activeElement;if(selection&&selected?.setSelectionRange)try{selected.setSelectionRange(selection.a,selection.b);}catch{}}
 }
 motionPreference.addEventListener('change',()=>{snapshot();render({game:false});});
 addEventListener('pagehide',disposeAll);render();
})();
