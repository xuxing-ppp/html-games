/* Small DOM helpers: each call creates real browser nodes. No framework or build step. */
(() => {
  "use strict";
  const M = (globalThis.Ming ??= {});
  const svgTags = new Set([
    "svg", "rect", "circle", "ellipse", "polyline", "polygon",
    "g",
    "path",
    "defs",
    "linearGradient",
    "stop",
    "pattern",
    "text",
  ]);

  function append(parent, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || typeof child === "boolean")
        continue;
      parent.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
    }
    return parent;
  }

  function fragment({ children = [] }) {
    return append(document.createDocumentFragment(), children);
  }

  /** Create an HTML/SVG element, attach attributes/events, then append its children. */
  function el(tag, props = {}, ...children) {
    props ??= {};
    if (typeof tag === "function") return tag({ ...props, children });
    const svg = svgTags.has(tag);
    const node = svg
      ? document.createElementNS("http://www.w3.org/2000/svg", tag)
      : document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
      if (value === null || value === undefined || name === "key") continue;
      if (name.startsWith("on"))
        node.addEventListener(name.slice(2).toLowerCase(), value);
      else if (name === "style") {
        for (const [property, setting] of Object.entries(value))
          node.style.setProperty(property, setting);
      } else if (name === "disabled") node.disabled = Boolean(value);
      else if (name === "value" && !svg) node.value = String(value);
      else {
        const attr =
          name === "className"
            ? "class"
            : svg
              ? name.replace(/[A-Z]/g, (char) => "-" + char.toLowerCase())
              : name;
        // These SVG attributes are case-sensitive.
        node.setAttribute(
          ["viewBox", "patternUnits", "preserveAspectRatio"].includes(name) ? name : attr,
          String(value),
        );
      }
    }
    if (tag === "summary") node.append(el(InkIcon,{kind:"fold",className:"disclosure-mark"}));
    append(node, children);
    if(tag==='button'&&!node.dataset.focusKey){
      const identity=['data-select-item','data-target','data-choice-value','data-font-size','data-map-place','data-map-list','data-open-source','data-submit-puzzle'].find(k=>node.hasAttribute(k));
      node.dataset.focusKey=identity?identity+':'+node.getAttribute(identity):node.hasAttribute('data-pair-field')?'pair:'+node.dataset.pairSide+':'+node.dataset.pairField:node.getAttribute('aria-label')??node.textContent;
    }
    return node;
  }

  // One source of truth for all action marks, disclosure marks and seals.
  function InkIcon({kind="arrow",className=""}={}) {
    const paths={arrow:"M2 12Q12 11.4 22 12M16 6L22 12 15 18",close:"M5 4L20 20M20 4L5 20",fold:"M8 4L17 12 8 20"};
    return el("svg",{className:`ink-icon ${className}`,viewBox:"0 0 24 24","aria-hidden":"true",focusable:"false"},
      el("path",{d:paths[kind]??paths.arrow,fill:"none",stroke:"currentColor",strokeWidth:kind==="close"?1.7:1.3,strokeLinecap:"round",strokeLinejoin:"round"}));
  }
  function Action({label,onClick,className="primary",disabled=false,arrow=true,...props}) {
    return el("button",{...props,className:`ink-action ${className}`,onClick,disabled},
      el("span",{className:"action-label"},label),arrow&&el(InkIcon));
  }
  function Seal({label="已批",className=""}={}) {
    return el("svg",{className:`ink-seal ${className}`,viewBox:"0 0 68 98",role:"img","aria-label":label},
      el("path",{d:"M5 4L62 3 64 31M64 35L63 93 6 95 4 54M4 49L5 4M10 10L57 9 58 87 11 89Z",fill:"none",stroke:"currentColor",strokeWidth:1.6}),
      ...[...label].map((char,i)=>el("text",{x:34,y:label.length===1?52:32+i*38,textAnchor:"middle",dominantBaseline:"central",fontSize:29},char)));
  }
  // Only unfamiliar, useful terms are annotated. Plain text remains the source of truth.
  const annotationTerms=['里长','仓书','知府','底联','代按','拨赈','退补','副卷'];
  function AnnotatedText({text='',onTerm,readingKey='copy',used=new Set(),terms=annotationTerms}) {
    const nodes=[],available=terms.filter(term=>M.terms?.[term]).sort((a,b)=>b.length-a.length);
    let cursor=0,plain=0;
    while(cursor<text.length){
      const term=onTerm&&available.find(term=>!used.has(term)&&text.startsWith(term,cursor));
      if(!term){cursor++;continue;}
      if(cursor>plain)nodes.push(text.slice(plain,cursor));
      used.add(term);
      nodes.push(el('button',{type:'button',className:'inline-term','data-term':term,'data-focus-key':`term:${readingKey}:${cursor}:${term}`,'aria-label':`解释“${term}”`,onClick:()=>onTerm(term)},term));
      cursor+=term.length;plain=cursor;
    }
    if(plain<text.length)nodes.push(text.slice(plain));
    return el(fragment,null,nodes);
  }
  function Prose({text='',onTerm,readingKey='copy'}){
    const used=new Set();
    return text.split(/\n\s*\n/).map((part,i)=>el('p',null,el(AnnotatedText,{text:part,onTerm,readingKey:`${readingKey}:${i}`,used})));
  }
  function readingTextNodes(root){
    const nodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.textContent.trim()&&!n.parentElement.closest('svg,[data-reading-ignore]')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
    while(walker.nextNode())nodes.push(walker.currentNode);
    return nodes;
  }
  Object.assign(M, { el, fragment, InkIcon, Action, Seal, AnnotatedText, Prose, readingTextNodes });
})();
