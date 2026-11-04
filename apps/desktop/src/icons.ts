const paths:Record<string,string>={
 wave:'M2 12h3l3-7 4 14 4-14 3 7h3',search:'M20 20l-4.5-4.5M17.5 10.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
 music:'M9 18V5l11-2v13M9 8l11-2M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3ZM20 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
 catalogue:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',queue:'M8 5h13M8 12h13M8 19h9M3 5h.01M3 12h.01M3 19h.01',
 history:'M3 3v6h6M3 9a9 9 0 1 1 0 7M12 7v5l3 2',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
 monitor:'M3 4h18v13H3zM8 21h8M12 17v4',mini:'M3 4h18v16H3zM12 12h7v6h-7z',pin:'M8 3h8l-1 6 4 4v2H5v-2l4-4zM12 15v7',close:'M6 6l12 12M18 6L6 18',more:'M5 12h.01M12 12h.01M19 12h.01',
 play:'M7 4l14 8-14 8z',pause:'M8 5v14M16 5v14',previous:'M5 5v14M19 5l-11 7 11 7z',next:'M19 5v14M5 5l11 7-11 7z',
 volume:'M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',muted:'M3 9h4l5-4v14l-5-4H3zM17 9l5 6M22 9l-5 6',
 repeat:'M17 2l4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3',
 'repeat-one':'M17 2l4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3M10 10l2-1v6M10 15h4',
 fullscreen:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',shrink:'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5',
 heart:'M20.5 4.6a5.5 5.5 0 0 0-8 0l-.5.5-.5-.5a5.5 5.5 0 0 0-8 7.6L12 21l8.5-8.8a5.5 5.5 0 0 0 0-7.6Z',
 dislike:'M7 3v12H3V3zM7 4h10a3 3 0 0 1 3 3l-1 5a3 3 0 0 1-3 3h-3l1 5c-2 2-3-1-4-3l-3-3',
 star:'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
 back:'M9 5l-6 7 6 7M3 12h17',forward:'M15 5l6 7-6 7M21 12H4',sync:'M20 7a8 8 0 0 0-14-2L3 8M3 3v5h5M4 17a8 8 0 0 0 14 2l3-3M16 16h5v5',
 captions:'M3 5h18v14H3zM10 10a3 3 0 1 0 0 4M18 10a3 3 0 1 0 0 4',info:'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',exit:'M9 3H4v18h5M13 8l5 4-5 4M8 12h13',
};
export const iconDefs='<svg class="icon-definitions" aria-hidden="true" width="0" height="0"><defs><linearGradient id="ycore-icon-accent" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#00E5FF"/><stop offset=".5" stop-color="#A855FF"/><stop offset="1" stop-color="#FF4FD8"/></linearGradient></defs></svg>';
export function icon(name:string){return `<svg class="ui-icon icon-${name}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]??paths.more}"/></svg>`;}
export function setIconLabel(element:HTMLElement,name:string,label='',iconOnly=false){
 const template=document.createElement('template');template.innerHTML=icon(name);const text=document.createElement('span');text.textContent=label;if(iconOnly)text.className='sr-only';
 element.replaceChildren(template.content,text);
 if(iconOnly&&label)element.title=label;
}
