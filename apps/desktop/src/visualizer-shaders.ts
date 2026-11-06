export const vertexShader=`
attribute vec3 a;varying vec2 p;varying float life;uniform float pointSize;
void main(){p=a.xy;life=a.z;gl_Position=vec4(a.xy,0.,1.);gl_PointSize=pointSize*(.4+.6*a.z);}`;
export const fragmentShader=`
precision mediump float;
varying vec2 p;varying float life;uniform float mode;uniform float phase;uniform float energy;uniform float bass;uniform float impact;
uniform vec2 resolution;
vec3 palette(float x){return mix(mix(vec3(0.,.898,1.),vec3(.427,.157,1.),smoothstep(-1.,.25,x)),vec3(1.,.31,.847),smoothstep(-.1,1.,x));}
void main(){
 if(mode<.5){gl_FragColor=vec4(mix(palette(p.x),vec3(1.),impact*.45)*(.9+impact*.5),1.);return;}
 if(mode>2.5){float a=1.-smoothstep(.04,.5,length(gl_PointCoord-vec2(.5)));gl_FragColor=vec4(mix(palette(p.x),vec3(1.),impact*.65),a*life*min(1.,energy*2.5));return;}
 vec2 q=p*vec2(resolution.x/resolution.y,1.);
 vec3 base=vec3(.043,.043,.078);
 if(mode<1.5){
  float radius=length(q);float glow=exp(-radius*radius*(1.5-bass*.8));
  float ring=exp(-abs(radius-(.42+.2*bass+.25*impact))*24.);
  float echo=exp(-abs(radius-(.8+.4*impact))*22.)*impact;
  vec3 color=palette(sin(phase*.3)*.5+q.x*.6);
  gl_FragColor=vec4(base+color*(glow*.65+ring*(.8+impact)+echo)*energy+vec3(.3)*ring*impact,1.);return;
 }
 q+=normalize(q+vec2(.001))*sin(length(q)*14.-phase*4.)*impact*.12;
 vec2 a=vec2(sin(phase*.6)*(.65+bass*.2),cos(phase*.4)*.42);
 vec2 b=vec2(cos(phase*.5+2.)*.7,sin(phase*.7+1.)*.5);
 vec2 c=vec2(sin(phase*.3+4.)*.6,cos(phase*.5+3.)*.4);
 float f=(.12+.24*bass+.14*impact)/(dot(q-a,q-a)+.08)+(.10+.22*energy)/(dot(q-b,q-b)+.08)+(.09+.2*energy)/(dot(q-c,q-c)+.08);
 float shape=smoothstep(.65,2.6,f);vec3 color=palette(q.x*.6+sin(phase*.2)*.3);
 float edge=exp(-abs(f-1.7)*6.);gl_FragColor=vec4(base+color*shape*(.035+energy)+vec3(.2)*edge*impact,1.);
}`;
