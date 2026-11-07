import {test,expect} from './fixtures';

test('YCore branding uses the short header name, full window name and exact agreed slogan',async({page})=>{
 await page.goto('/');await expect(page).toHaveTitle('YCore Music');
 await expect(page.locator('.brand')).toHaveAttribute('aria-label','YCore Music');await expect(page.locator('.brand')).toContainText('YCORE');
 await page.locator('[data-panel=settings]').click();await expect(page.locator('[data-pane=settings]>h2')).toHaveText('YCore Music');
 await expect(page.locator('.brand-tagline')).toHaveText('Your Music. Your Core, Your World.');
});

test('support opens the external browser through the native command and reports a launch failure',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.isTauri=true;w.supportCalls=0;w.supportFails=true;w.__TAURI_INTERNALS__={invoke:async(command:string)=>{if(command==='support_open'){w.supportCalls++;if(w.supportFails)throw Error('No browser');}}};});
 await page.goto('/');await page.locator('[data-panel=settings]').click();
 await page.getByRole('button',{name:'Поддержать',exact:true}).click();
 await expect(page.locator('#support-status')).toContainText('https://www.donationalerts.com/r/affor_1337');
 await expect(page.locator('#support-developer')).toBeEnabled();
 await page.evaluate(()=>(window as any).supportFails=false);await page.locator('#support-developer').click();
 await expect(page.locator('#support-status')).toBeEmpty();expect(await page.evaluate(()=>(window as any).supportCalls)).toBe(2);
 await expect(page).toHaveTitle('YCore Music');await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
});

test('the weekly support reminder opens the review link and honors a permanent dismissal',async({page})=>{
 await page.addInitScript(()=>{
  const key='ycore.supportReminder.v1';
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({nextAt:0,disabled:false}));
  const w=window as any;w.isTauri=true;w.supportDestinations=[];
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='support_open')w.supportDestinations.push(args.destination);
  }};
 });
 await page.goto('/');
 const reminder=page.locator('#support-reminder');
 await expect(reminder).toBeVisible();
 await reminder.getByRole('button',{name:'Оставить отзыв'}).click();
 await expect(reminder).toBeHidden();
 expect(await page.evaluate(()=>(window as any).supportDestinations)).toEqual(['review']);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('ycore.supportReminder.v1')!).nextAt-Date.now())).toBeGreaterThan(6*86400000);
 await page.evaluate(()=>localStorage.removeItem('ycore.supportReminder.v1'));
 await page.reload();
 await reminder.getByRole('button',{name:'Больше не показывать'}).click();
 await page.reload();
 await expect(page.locator('#play')).toBeVisible();
 await expect(reminder).toHaveCount(0);
});
