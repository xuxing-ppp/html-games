// util.js —— 通用工具 (从原单文件拆出; 全局命名空间 W)
(function(){
  function clamp(v,a,b){ return v<a?a : v>b?b : v; }
  function rand(min,max){ return min + Math.random()*(max-min); }
  function randSign(){ return Math.random()<0.5?-1:1; }
  function shade(hex,p){
    const n=parseInt(hex.slice(1),16);
    let r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    r=clamp(Math.round(r*(1+p)),0,255); g=clamp(Math.round(g*(1+p)),0,255); b=clamp(Math.round(b*(1+p)),0,255);
    return 'rgb('+r+','+g+','+b+')';
  }
  /** 角度归一化到 [-π,π]，用于最短转向 */
  function normalizeAngle(a){ a=a%(2*Math.PI); if(a>Math.PI)a-=2*Math.PI; if(a<-Math.PI)a+=2*Math.PI; return a; }
  W.Util = { clamp, rand, randSign, shade, normalizeAngle };
})();
