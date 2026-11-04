/* Seeded connected silhouettes; generated before occupants are placed. */
(function(root){'use strict';
const templates={狭渡:[6,8,'narrow'],双桥:[8,7,'corners'],曲岸:[9,6,'bend'],洲渡:[7,8,'islet'],关道:[6,9,'narrow'],折巷:[8,7,'bend'],缺庭:[8,8,'corners'],环堡:[9,7,'ring'],双岛:[9,8,'islet'],阶台:[7,9,'steps'],十字:[9,9,'cross'],残环:[9,8,'ring'],芦汀:[8,6,'reeds'],回湾:[9,8,'coves'],齿门:[8,9,'teeth'],曲廊:[9,8,'zigzag'],悬桥:[6,9,'ladder'],孤峰:[9,9,'pillars']};
function shape(name,seed=0){const [width,height,kind]=templates[name]||[7,8,'plain'],cx=Math.floor(width/2),board=Array(width*height).fill('floor'),mask=board.map(()=>true),flip=seed%2;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){let cut=false;
 if(kind==='narrow')cut=(x===0||x===width-1)&&y>1&&y<height-2;
 if(kind==='corners')cut=(x<2&&y<2)||(x>=width-2&&y>=height-2);
 if(kind==='bend')cut=(x<(flip?1:2)&&y<height/2)||(x>=width-(flip?2:1)&&y>height/2);
 if(kind==='islet')cut=(y===Math.floor(height/2)&&x!==cx&&x!==cx-1&&x!==1&&x!==width-2);
 if(kind==='ring')cut=x>=cx-1&&x<=cx+1&&y===Math.floor(height/2);
 if(kind==='cross')cut=(x<2||x>=width-2)&&(y<2||y>=height-2);
 if(kind==='reeds')cut=(x===0||x===width-1)&&y%3!==0;
 if(kind==='coves')cut=(x<2&&y===2)||(x>=width-2&&y===height-3);
 if(kind==='teeth')cut=y%3===1&&(x<2||x>=width-2);
 if(kind==='zigzag')cut=(y===2&&x<cx-1)||(y===height-3&&x>cx);
 if(kind==='ladder')cut=(x===0||x===width-1)&&y%2===0;
 if(kind==='pillars')cut=(x===1||x===width-2)&&(y===2||y===height-3);
 if(kind==='steps')cut=(x===0&&y<height/2)||(x>=width-1&&y>=height/2);
 if(cut){board[y*width+x]='void';mask[y*width+x]=false;}
 }
 // Two connected lanes, plus an open spawn diamond. This is the skeleton, not a late erase pass.
 for(let y=0;y<height;y++){for(const x of [cx,cx-1]){board[y*width+x]='floor';mask[y*width+x]=true;}}
 const hero={x:cx,y:height-2},beacon={x:cx,y:height-1};
 for(const [dx,dy]of [[0,0],[1,0],[-1,0],[0,-1],[0,1]]){const x=hero.x+dx,y=hero.y+dy;board[y*width+x]='floor';mask[y*width+x]=true;}
 const side=flip?1:width-2;
 for(let y=1;y<height-2;y++)if(board[y*width+side]==='floor'&&(y+seed)%4===0)board[y*width+side]='spikes';
 if(width>=8){const x=flip?width-2:1,y=Math.floor(height/2);if(board[y*width+x]==='floor')board[y*width+x]='pit';}
 return {width,height,board,mask,hero,beacon,kind};
}
const api={templates,shape};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.XQArenas=api;
})(typeof globalThis!=='undefined'?globalThis:this);
