/** Calendar boundaries in the person's timezone; the final selected day is inclusive. */
export function historyRange(fromDate:string,untilDate:string):{from?:number;until?:number}{
 function midnight(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Укажите корректную дату.');
  const date=new Date(value+'T00:00:00');
  if(!Number.isFinite(date.getTime())||date.getFullYear()!==Number(value.slice(0,4))||date.getMonth()+1!==Number(value.slice(5,7))||date.getDate()!==Number(value.slice(8,10)))throw Error('Укажите корректную дату.');
  return date;
 }
 const from=fromDate?Math.floor(midnight(fromDate).getTime()/1000):undefined;
 const last=untilDate?midnight(untilDate):undefined;if(last)last.setDate(last.getDate()+1);
 const until=last?Math.floor(last.getTime()/1000):undefined;
 if(from!==undefined&&until!==undefined&&from>=until)throw Error('Начало периода должно быть не позже конца.');
 return {...(from!==undefined?{from}:{}),...(until!==undefined?{until}:{})};
}
