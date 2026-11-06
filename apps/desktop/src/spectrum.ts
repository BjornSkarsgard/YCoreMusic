import {AudioMotion} from './audio-motion';
export type VisualizerPreset='spectrum'|'ambient'|'liquid'|'particles';
export interface VisualOptions {content:'video'|'visualizer';fps:number;quality:'low'|'medium'|'high'|'ultra';preset?:VisualizerPreset}
export interface AnalysisFrame {available:boolean;bands?:number[];error?:string}
const COUNT=48;
/** Real frequency magnitudes only. No independent soundtrack or simulated beat. */
export function mountSpectrum(stage:HTMLElement){
 let canvas=document.createElement('canvas');canvas.className='spectrum-canvas';canvas.setAttribute('aria-label','Спектр звука YCore Music');stage.prepend(canvas);
 let options:VisualOptions={content:'video',fps:0,quality:'high'},visible=true,frame=0,last=0,lastDraw=0,received=0,disposed=false;
 let needsResize=true,pixelRatio=devicePixelRatio;
 let phase=0,energy=0,bass=0,pulse=0,reference=.0001,lastBurst=0,particleCursor=0,attribute=0;
 const motion=new AudioMotion(),peaks=new Float32Array(COUNT),sparks=new Float32Array(420*6),points=new Float32Array(500*3);
 const radii=Float32Array.from({length:160},(_,i)=>{const seed=Math.sin((i+1)*12.9898)*43758.5453;return seed-Math.floor(seed);});
 const artwork=document.createElement('img');artwork.className='visualizer-artwork';artwork.alt='Обложка текущего трека';artwork.hidden=true;stage.append(artwork);
 const brand=new URL('./assets/ycore-mark.svg',import.meta.url).href;let artworkUrl=brand;artwork.src=brand;artwork.alt='YCore Music';artwork.onerror=()=>{if(artwork.src!==brand){artwork.src=brand;artwork.alt='YCore Music';}};
 let target=new Float32Array(COUNT),values=new Float32Array(COUNT),gl:WebGLRenderingContext|null=null,ctx:CanvasRenderingContext2D|null=null,program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null;
 const vertices=new Float32Array(COUNT*24),quad=new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);
 let uniforms:Record<string,WebGLUniformLocation|null>={};
 function fallback(){
  if(gl){gl.deleteBuffer(buffer);gl.deleteProgram(program);}gl=null;
  const next=canvas.cloneNode(false) as HTMLCanvasElement;canvas.replaceWith(next);canvas=next;ctx=canvas.getContext('2d');canvas.dataset.renderer='canvas2d';
 }
 function initialize(){
  gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
  if(!gl){fallback();return;}
  const shader=(type:number,source:string)=>{const s=gl!.createShader(type)!;gl!.shaderSource(s,source);gl!.compileShader(s);if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS)){gl!.deleteShader(s);return null;}return s;};
  const vertex=shader(gl.VERTEX_SHADER,vertexShader);
  const fragment=shader(gl.FRAGMENT_SHADER,fragmentShader);
  if(!vertex||!fragment){if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);fallback();return;}
  program=gl.createProgram();gl.attachShader(program!,vertex);gl.attachShader(program!,fragment);gl.linkProgram(program!);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program!,gl.LINK_STATUS)){fallback();return;}
  buffer=gl.createBuffer();gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);const attr=gl.getAttribLocation(program!,'a');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);canvas.dataset.renderer='webgl';
  attribute=attr;uniforms=Object.fromEntries(['mode','phase','energy','bass','impact','resolution','pointSize'].map(name=>[name,gl!.getUniformLocation(program!,name)]));
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback();last=0;});
 }
 function resize(){
  const rect=stage.getBoundingClientRect(),scale={low:.5,medium:.75,high:1,ultra:1.25}[options.quality]*devicePixelRatio;
  const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
 }
 function running(){return !disposed&&visible&&!document.hidden&&options.content==='visualizer';}
 function draw(now:number){
  frame=0;if(!running())return;frame=requestAnimationFrame(draw);
  const elapsed=last?now-last:0,period=options.fps?1000/options.fps:0;
  if(last&&period&&elapsed<period-.5)return;
  last=period&&last?(elapsed<period?last+period:now-elapsed%period):now;
  const delta=lastDraw?now-lastDraw:16.67;lastDraw=now;
  const fresh=now-received<500;
  const strongest=fresh?target.reduce((max,value)=>Math.max(max,value),0):0;
  reference=Math.max(.0001,strongest,reference*Math.exp(-delta/2400));
  for(let i=0;i<COUNT;i++){
   const amplitude=fresh?target[i]:0;
   const level=amplitude>1e-7?Math.max(0,Math.min(1,(20*Math.log10(amplitude/reference)+52)/52)):0;
   values[i]+=(level-values[i])*(1-Math.exp(-delta/(level>values[i]?14:130)));
   peaks[i]=Math.max(values[i],peaks[i]-delta*.0005);
   const x=-.9+i*1.8/COUNT,r=x+1.8/COUNT*.72,bottom=-.65,top=bottom+Math.max(.002,values[i]*1.3);
   vertices.set([x,bottom,r,bottom,x,top,x,top,r,bottom,r,top],i*12);
   const peak=bottom+peaks[i]*1.3;vertices.set([x,peak,r,peak,x,peak+.012,x,peak+.012,r,peak,r,peak+.012],COUNT*12+i*12);
  }
  const response=motion.update(values,delta);energy=response.energy;bass=response.bass;pulse=response.impact;
  phase+=Math.min(delta,50)*.001*(energy*2+pulse*3);
  if(needsResize||pixelRatio!==devicePixelRatio){resize();needsResize=false;pixelRatio=devicePixelRatio;}
  const preset=options.preset??'spectrum',mode=['spectrum','ambient','liquid','particles'].indexOf(preset),particleLimit={low:96,medium:180,high:300,ultra:420}[options.quality];
  artwork.style.transform='translate(-50%,-50%) scale('+(1+bass*.05+pulse*.1)+')';
  let pointCount=0;
  if(preset==='particles'){
   if(response.burst&&now-lastBurst>120){lastBurst=now;const count={low:24,medium:48,high:80,ultra:120}[options.quality],ox=Math.sin(phase*3)*.35,oy=Math.cos(phase*2)*.25;for(let i=0;i<count;i++){const slot=particleCursor++%particleLimit,k=slot*6,angle=i*2.399963+phase,speed=(.35+radii[slot%160]*.9)*(1+pulse),life=.65+radii[(slot+43)%160];sparks.set([ox,oy,Math.cos(angle)*speed,Math.sin(angle)*speed,life,life],k);}}
   const dt=Math.min(delta,50)*.001;
   for(let i=0;i<particleLimit;i++){const k=i*6;if(sparks[k+4]<=0)continue;sparks[k+4]-=dt;sparks[k]+=sparks[k+2]*dt;sparks[k+1]+=sparks[k+3]*dt;sparks[k+3]-=dt*.3;points.set([sparks[k]*canvas.height/canvas.width,sparks[k+1],Math.max(0,sparks[k+4]/sparks[k+5])],pointCount++*3);}
   for(let i=0;i<24;i++){const angle=i*2.399963+phase*.3,r=(radii[i]+phase*.08)%1;points.set([Math.cos(angle)*r*canvas.height/canvas.width,Math.sin(angle)*r,.25+values[i]*.6],pointCount++*3);}
  }
  if(gl){
   gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(11/255,11/255,20/255,1);gl.clear(gl.COLOR_BUFFER_BIT);
   gl.uniform1f(uniforms.mode,mode);gl.uniform1f(uniforms.phase,phase);gl.uniform1f(uniforms.energy,energy);gl.uniform1f(uniforms.bass,bass);gl.uniform1f(uniforms.impact,pulse);gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);gl.uniform1f(uniforms.pointSize,(5+bass*12+pulse*24)*pixelRatio);
   if(preset==='particles'){
    gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.bufferData(gl.ARRAY_BUFFER,points.subarray(0,pointCount*3),gl.DYNAMIC_DRAW);gl.drawArrays(gl.POINTS,0,pointCount);gl.disable(gl.BLEND);
   }else{gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);gl.bufferData(gl.ARRAY_BUFFER,preset==='spectrum'?vertices:quad,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,preset==='spectrum'?COUNT*12:6);}
  }else if(ctx){
   ctx.fillStyle='#0B0B14';ctx.fillRect(0,0,canvas.width,canvas.height);
   if(preset==='spectrum'){const gradient=ctx.createLinearGradient(0,0,canvas.width,0);gradient.addColorStop(0,'#00E5FF');gradient.addColorStop(.5,'#6D28FF');gradient.addColorStop(1,'#FF4FD8');ctx.fillStyle=gradient;for(let i=0;i<COUNT;i++){const height=Math.max(1,values[i]*canvas.height*.65),x=canvas.width*(.05+i*.9/COUNT),w=canvas.width*.9/COUNT*.72;ctx.fillRect(x,canvas.height*.825-height,w,height);ctx.fillRect(x,canvas.height*(.825-peaks[i]*.65),w,2*pixelRatio);}}
   else if(preset==='particles'){for(let i=0;i<pointCount;i++){ctx.globalAlpha=Math.min(1,energy*2.5)*points[i*3+2];ctx.fillStyle=i%2?'#FF4FD8':'#00E5FF';ctx.beginPath();ctx.arc((points[i*3]+1)*canvas.width/2,(1-points[i*3+1])*canvas.height/2,(3+bass*6+pulse*12)*pixelRatio*points[i*3+2],0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
   else {for(let i=0;i<3;i++){const x=canvas.width*(.5+Math.sin(phase*.5+i*2)*.22),y=canvas.height*(.5+Math.cos(phase*.4+i)*.22),r=canvas.height*(.4+bass*.25+pulse*.2);const gradient=ctx.createRadialGradient(x,y,0,x,y,r);gradient.addColorStop(0,['#00E5FF','#6D28FF','#FF4FD8'][i]);gradient.addColorStop(1,'transparent');ctx.globalAlpha=Math.min(1,energy*(.8+pulse));ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.globalAlpha=1;if(preset==='ambient'){ctx.strokeStyle='#A855FF';ctx.lineWidth=(2+pulse*7)*pixelRatio;ctx.globalAlpha=energy;ctx.beginPath();ctx.arc(canvas.width/2,canvas.height/2,canvas.height*(.24+bass*.08+pulse*.12),0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}}
  }
 }
 function schedule(){if(frame)cancelAnimationFrame(frame);frame=0;last=lastDraw=0;needsResize=true;canvas.hidden=options.content!=='visualizer';canvas.dataset.preset=options.preset??'spectrum';canvas.setAttribute('aria-label','Визуализатор '+(options.preset??'spectrum'));artwork.hidden=options.content!=='visualizer'||options.preset!=='ambient';if(running())frame=requestAnimationFrame(draw);}
 const observer=new ResizeObserver(()=>{needsResize=true;});observer.observe(stage);
 const visibility=()=>schedule();document.addEventListener('visibilitychange',visibility);initialize();schedule();
 return {
  artwork(url?:string){let next=brand;try{const candidate=new URL(url??'');if(candidate.protocol==='https:'&&candidate.hostname==='avatars.mds.yandex.net'&&!candidate.username&&!candidate.password)next=candidate.href;}catch{/* Brand fallback for absent album artwork. */}if(next!==artworkUrl){artworkUrl=next;artwork.src=next;artwork.alt=next===brand?'YCore Music':'Обложка текущего трека';}},
  configure(value:VisualOptions){options=value;schedule();},
  visible(value:boolean){if(visible===value)return;visible=value;if(!value){target.fill(0);values.fill(0);peaks.fill(0);sparks.fill(0);motion.reset();}schedule();},
  receive(value:AnalysisFrame){target.fill(0);if(value.available&&Array.isArray(value.bands))for(let i=0;i<COUNT;i++){const v=value.bands[i];target[i]=Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;}received=performance.now();},
  destroy(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',visibility);if(gl){gl.deleteBuffer(buffer);gl.deleteProgram(program);}canvas.remove();artwork.remove();}
 };
}
import {vertexShader,fragmentShader} from './visualizer-shaders';
