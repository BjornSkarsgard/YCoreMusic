import {setIconLabel} from './icons';
export function paintRange(input:HTMLInputElement){const min=Number(input.min)||0,max=Number(input.max)||100,value=Number(input.value);input.style.setProperty('--range-fill',`${max>min?Math.max(0,Math.min(100,(value-min)/(max-min)*100)):0}%`);}
export function mountVisualControls(){
 const buttons:Record<string,[string,boolean]>={repeat:['repeat',true],mute:['volume',true],fullscreen:['fullscreen',true],'source-start':['play',false],'history-smart':['play',false],'discovery-refresh':['sync',false],'library-refresh':['sync',false],'history-refresh':['sync',false],'scene-open':['monitor',false],'scene-off':['close',false],'monitor-refresh':['sync',false],'youtube-settings':['settings',false]};
 for(const [id,[name,only]]of Object.entries(buttons)){const button=document.getElementById(id);if(button)setIconLabel(button,id==='mute'&&button.getAttribute('aria-pressed')==='true'?'muted':name,(button.textContent??'').replace(/^[▶♥☆]\s*/,''),only);}
 for(const input of document.querySelectorAll<HTMLInputElement>('input[type=range]')){paintRange(input);input.addEventListener('input',()=>paintRange(input));}
 const search=document.querySelector<HTMLButtonElement>('#catalogue-search button:not([type=button])');if(search)setIconLabel(search,'search','Найти');
}
