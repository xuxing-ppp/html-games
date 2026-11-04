/* Continuous document reading. A character anchor survives font and viewport changes. */
(() => {
  "use strict";
  const M=globalThis.Ming,{el}=M,instances=new WeakMap();
  const anchors=new Map();
  let readerSession=0;
  function Reader({blocks,readingKey,onTerm}){
    const key=`${readerSession}/${readingKey??JSON.stringify(blocks)}`;
    const used=new Set();
    const paragraphs=blocks.flatMap((text,index)=>text.split(/\n\s*\n/).map((part,i)=>el("p",null,el(M.AnnotatedText,{text:part,onTerm,readingKey:`${readingKey}:${index}:${i}`,used}))));
    const copy=el("div",{className:"reader-copy"},...paragraphs);
    const viewport=el("div",{className:"reader-window",tabIndex:0,"aria-label":"正文，可上下滚动"},copy);
    const root=el("section",{className:"reader","aria-label":"卷宗正文"},viewport);
    instances.set(root,()=>{
      let localAnchor=anchors.get(key)??0;
      let restoring=false,frame=0,measuredWidth=viewport.clientWidth,measuredHeight=viewport.clientHeight,restoredTop=null;
      const range=document.createRange(),textNodes=M.readingTextNodes(copy);
      function capture(){
        if(!viewport.isConnected||measuredWidth!==viewport.clientWidth||measuredHeight!==viewport.clientHeight||viewport.scrollTop===restoredTop)return;
        if(viewport.scrollTop<2){localAnchor=0;anchors.set(key,0);return;}
        const top=viewport.getBoundingClientRect().top+2;
        let offset=0;
        for(const text of textNodes){
          const length=text.length;range.selectNodeContents(text);
          if(range.getBoundingClientRect().bottom>top){
            let lo=0,hi=length;
            while(lo<hi){const mid=Math.floor((lo+hi)/2);range.setStart(text,mid);range.setEnd(text,Math.min(length,mid+1));if(range.getBoundingClientRect().bottom<=top)lo=mid+1;else hi=mid;}
            localAnchor=offset+lo;anchors.set(key,localAnchor);return;
          }
          offset+=length;
        }
      }
      function restore(){
        if(!viewport.isConnected||!viewport.clientHeight)return;
        if(restoredTop!==null&&viewport.scrollTop!==restoredTop)capture();
        restoring=true;measuredWidth=viewport.clientWidth;measuredHeight=viewport.clientHeight;
        let offset=localAnchor;
        if(!offset)viewport.scrollTop=0;
        else for(const text of textNodes){const length=text.length;if(offset<length&&text){range.setStart(text,offset);range.setEnd(text,Math.min(length,offset+1));viewport.scrollTop+=range.getBoundingClientRect().top-viewport.getBoundingClientRect().top-2;break;}offset-=length;}
        restoredTop=viewport.scrollTop;
        cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{restoring=false;});
      }
      viewport.addEventListener("scroll",capture,{passive:true});
      const observer=new ResizeObserver(restore);observer.observe(viewport);restore();
      return ()=>{capture();observer.disconnect();cancelAnimationFrame(frame);viewport.removeEventListener("scroll",capture);};
    });
    return root;
  }
  function mountReaders(container){const dispose=[...container.querySelectorAll(".reader")].map(n=>instances.get(n)?.()).filter(Boolean);return ()=>dispose.forEach(f=>f());}
  Object.assign(M,{Reader,mountReaders,resetReaders:()=>{anchors.clear();readerSession++;},snapshotReaderReading:()=>({session:readerSession,anchors:[...anchors]}),restoreReaderReading:s=>{readerSession=s.session;anchors.clear();s.anchors.forEach(([k,v])=>anchors.set(k,v));}});
})();
