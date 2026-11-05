export interface VisualOptions {content:'video'|'visualizer';fps:number;quality:'low'|'medium'|'high'|'ultra'}
export interface AnalysisFrame {available:boolean;bands?:number[];error?:string}
const COUNT=48;
/** Real frequency magnitudes only. No independent soundtrack or simulated beat. */
export function mountSpectrum(stage:HTMLElement){
 let canvas=document.createElement('canvas');canvas.className='spectrum-canvas';canvas.setAttribute('aria-label','Спектр звука YCore Music');stage.prepend(canvas);
 let options:VisualOptions={content:'video',fps:0,quality:'high'},visible=true,frame=0,last=0,received=0,disposed=false;
 let target=new Float32Array(COUNT),values=new Float32Array(COUNT),gl:WebGLRenderingContext|null=null,ctx:CanvasRenderingContext2D|null=null,program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null;
 const vertices=new Float32Array(COUNT*12);
 function fallback(){
  if(gl){gl.deleteBuffer(buffer);gl.deleteProgram(program);}gl=null;
  const next=canvas.cloneNode(false) as HTMLCanvasElement;canvas.replaceWith(next);canvas=next;ctx=canvas.getContext('2d');canvas.dataset.renderer='canvas2d';
 }
 function initialize(){
  gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
  if(!gl){fallback();return;}
  const shader=(type:number,source:string)=>{const s=gl!.createShader(type)!;gl!.shaderSource(s,source);gl!.compileShader(s);if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS)){gl!.deleteShader(s);return null;}return s;};
  const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 a;varying vec2 p;void main(){p=a;gl_Position=vec4(a,0.,1.);}');
  const fragment=shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 p;void main(){vec3 c=mix(vec3(0.,.898,1.),vec3(.427,.157,1.),smoothstep(-1.,.25,p.x));c=mix(c,vec3(1.,.31,.847),smoothstep(-.1,1.,p.x));gl_FragColor=vec4(c*(.78+.22*(p.y+1.)*.5),1.);}');
  if(!vertex||!fragment){if(vertex)gl.deleteShader(vertex);if(fragment)gl.deleteShader(fragment);fallback();return;}
  program=gl.createProgram();gl.attachShader(program!,vertex);gl.attachShader(program!,fragment);gl.linkProgram(program!);gl.deleteShader(vertex);gl.deleteShader(fragment);
  if(!gl.getProgramParameter(program!,gl.LINK_STATUS)){fallback();return;}
  buffer=gl.createBuffer();gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);const attr=gl.getAttribLocation(program!,'a');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);canvas.dataset.renderer='webgl';
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
  const delta=last?now-last:16.67;if(last&&options.fps&&delta<1000/options.fps-.5)return;last=now;
  const fresh=now-received<500;
  for(let i=0;i<COUNT;i++){
   const amplitude=fresh?target[i]:0;
   const level=amplitude>0?Math.max(0,Math.min(1,(20*Math.log10(amplitude)+80)/80)):0;
   values[i]+=(level-values[i])*(1-Math.exp(-delta/(level>values[i]?45:180)));
   const x=-.9+i*1.8/COUNT,r=x+1.8/COUNT*.72,bottom=-.65,top=bottom+Math.max(.002,values[i]*1.3);
   vertices.set([x,bottom,r,bottom,x,top,x,top,r,bottom,r,top],i*12);
  }
  resize();
  if(gl){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(11/255,11/255,20/255,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,COUNT*6);}
  else if(ctx){ctx.fillStyle='#0B0B14';ctx.fillRect(0,0,canvas.width,canvas.height);const gradient=ctx.createLinearGradient(0,0,canvas.width,0);gradient.addColorStop(0,'#00E5FF');gradient.addColorStop(.5,'#6D28FF');gradient.addColorStop(1,'#FF4FD8');ctx.fillStyle=gradient;for(let i=0;i<COUNT;i++){const height=Math.max(1,values[i]*canvas.height*.65);ctx.fillRect(canvas.width*(.05+i*.9/COUNT),canvas.height*.825-height,canvas.width*.9/COUNT*.72,height);}}
 }
 function schedule(){if(frame)cancelAnimationFrame(frame);frame=0;last=0;canvas.hidden=options.content!=='visualizer';if(running())frame=requestAnimationFrame(draw);}
 const visibility=()=>schedule();document.addEventListener('visibilitychange',visibility);initialize();schedule();
 return {
  configure(value:VisualOptions){options=value;schedule();},
  visible(value:boolean){if(visible===value)return;visible=value;if(!value){target.fill(0);values.fill(0);}schedule();},
  receive(value:AnalysisFrame){target.fill(0);if(value.available&&Array.isArray(value.bands))for(let i=0;i<COUNT;i++){const v=value.bands[i];target[i]=Number.isFinite(v)?Math.max(0,Math.min(1,v)):0;}received=performance.now();},
  destroy(){disposed=true;cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility);if(gl){gl.deleteBuffer(buffer);gl.deleteProgram(program);}canvas.remove();}
 };
}
