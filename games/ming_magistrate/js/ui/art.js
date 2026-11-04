/* Protected scene framing and character-based reading anchors, shared by all workspaces. */
(() => {
 'use strict';const M=globalThis.Ming,{el,artCatalog}=M;
 function SceneArt({kind='desk',className=''}){const meta=artCatalog[kind]??artCatalog.desk;return el('figure',{className:`scene-art ${className}`,'data-art-key':kind,style:{'--focus-x':meta.focus[0]*100+'%','--focus-y':meta.focus[1]*100+'%'}},el('picture',null,meta.portrait&&el('source',{media:'(max-width: 600px) and (min-height: 520px), (max-width: 1100px) and (max-height: 519px)',srcset:M.imagePath(meta.portrait)}),el('img',{src:M.imagePath(meta.file),alt:'',draggable:'false',decoding:'sync'})));}
 // Transitions are explicit and keep an opaque old picture beneath the new one.
 const transitions=new Set();
 function cancelSceneTransitions(){for(const job of [...transitions])job.finish();}
 function prepareSceneTransition(previous,next){
  const picture=next.querySelector('picture'),img=picture.querySelector('img');
  const prior=previous.querySelector('picture:not(.scene-outgoing)'),pending=previous.querySelector('.scene-outgoing');
  const frame=(pending&&(!prior.querySelector('img').complete||getComputedStyle(prior).opacity==='0')?pending:prior).cloneNode(true);
  frame.className='scene-outgoing';frame.setAttribute('aria-hidden','true');
  frame.style.cssText=`opacity:1;z-index:0;--focus-x:${previous.style.getPropertyValue('--focus-x')};--focus-y:${previous.style.getPropertyValue('--focus-y')}`;
  next.prepend(frame);picture.style.opacity='0';picture.style.zIndex='1';
  return ()=>{
   const job={closed:false,animation:null,cleanup:()=>{},finish(){if(job.closed)return;job.closed=true;job.cleanup();job.animation?.cancel();frame.remove();picture.style.removeProperty('opacity');picture.style.removeProperty('z-index');transitions.delete(job);}};
   transitions.add(job);
   const reveal=()=>{
    if(job.closed||!next.isConnected)return job.finish();
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||document.getElementById('root').dataset.reduced==='true')return job.finish();
    picture.style.opacity='1';job.animation=picture.animate([{opacity:0},{opacity:1}],{duration:220,easing:'ease-out'});
    job.animation.finished.then(()=>job.finish(),()=>job.finish());
   };
   img.decode().then(reveal,()=>{
    if(job.closed)return;
    if(img.complete)return job.finish();
    // A responsive source may change during decode; wait for that image instead.
    img.addEventListener('load',reveal,{once:true});img.addEventListener('error',job.finish,{once:true});
    job.cleanup=()=>{img.removeEventListener('load',reveal);img.removeEventListener('error',job.finish);};
   });
  };
 }
  const paperAnchors=new Map();let paperSession=0;
  function resetPaperReading(){paperAnchors.clear();paperSession++;}
  const snapshotPaperReading=()=>({session:paperSession,anchors:[...paperAnchors]});
  function restorePaperReading(snapshot){paperSession=snapshot.session;paperAnchors.clear();snapshot.anchors.forEach(([k,v])=>paperAnchors.set(k,v));}
  // Rich folio pages use the same character-based reading position as story prose.
  function mountPaper(slot){
    const key=`${paperSession}/${slot.dataset.scrollKey}`,range=document.createRange(),nodes=M.readingTextNodes(slot);
    let restoring=false,raf=0,width=slot.clientWidth,height=slot.clientHeight,restored=null;
    const capture=()=>{
      if(width!==slot.clientWidth||height!==slot.clientHeight||slot.scrollTop===restored)return;
      if(slot.scrollTop<2){paperAnchors.set(key,0);return;}
      const top=slot.getBoundingClientRect().top+2;let offset=0;
      for(const node of nodes){range.selectNodeContents(node);if(range.getBoundingClientRect().bottom>top){let lo=0,hi=node.length;while(lo<hi){const m=Math.floor((lo+hi)/2);range.setStart(node,m);range.setEnd(node,Math.min(node.length,m+1));if(range.getBoundingClientRect().bottom<=top)lo=m+1;else hi=m;}paperAnchors.set(key,offset+lo);return;}offset+=node.length;}
    };
    const restore=()=>{
      if(!slot.isConnected||!slot.clientHeight)return;if(restored!==null&&slot.scrollTop!==restored)capture();restoring=true;width=slot.clientWidth;height=slot.clientHeight;
      let offset=paperAnchors.get(key)??0;
      if(!offset)slot.scrollTop=0;else for(const node of nodes){if(offset<node.length){range.setStart(node,offset);range.setEnd(node,offset+1);slot.scrollTop+=range.getBoundingClientRect().top-slot.getBoundingClientRect().top-2;break;}offset-=node.length;}
      restored=slot.scrollTop;cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>restoring=false);
    };
    slot.addEventListener("scroll",capture,{passive:true});const observer=new ResizeObserver(restore);observer.observe(slot);restore();
    return ()=>{capture();observer.disconnect();cancelAnimationFrame(raf);slot.removeEventListener("scroll",capture);};
  }

 function mountArt(container){const ds=[...container.querySelectorAll('.folio-reading')].map(mountPaper);for(const surface of container.querySelectorAll('.atlas-viewport')){const world=surface.querySelector('.atlas-world');const fit=()=>{const width=Math.min(surface.clientWidth,surface.clientHeight*1.5),height=width/1.5;Object.assign(world.style,{width:width+'px',height:height+'px',left:(surface.clientWidth-width)/2+'px',top:(surface.clientHeight-height)/2+'px',right:'auto',bottom:'auto'});};const ro=new ResizeObserver(fit);ro.observe(surface);fit();ds.push(()=>ro.disconnect());}return()=>ds.forEach(f=>f());}
 Object.assign(M,{SceneArt,prepareSceneTransition,cancelSceneTransitions,mountArt,resetPaperReading,snapshotPaperReading,restorePaperReading});
})();
