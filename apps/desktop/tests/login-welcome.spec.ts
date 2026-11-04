import {test,expect} from './fixtures';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.isTauri=true;w.welcomeAuthCalls=[];
  w.__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{
   if(command==='source_fetch'||command==='smart_history_fetch')return [];
   if(command==='diagnostics_status')return {version:'0.0.1',platform:'windows',architecture:'x86_64',storageAvailable:true,yandex:localStorage.getItem('test.connected')==='1'?'saved':'missing'};
   if(command==='auth_command'){w.welcomeAuthCalls.push(args.action);return args.action==='cancel'?'cancelled':'waiting';}
  }};
 });
});
test('unconnected startup explains login, offers later and keeps Settings available without autoplay',async({page})=>{
 await page.goto('/');await expect(page.locator('#account-welcome')).toBeVisible();await expect(page.locator('#account-welcome')).toContainText('Мою волну');await expect(page.locator('#account-welcome')).toContainText('Настройки → Яндекс Музыка → Войти в Яндекс');
 expect(await page.evaluate(()=>(window as any).welcomeAuthCalls)).toEqual([]);await expect(page.locator('iframe')).toHaveCount(0);
 await page.locator('#account-welcome-later').click();await page.locator('[data-panel=settings]').click();await expect(page.locator('#account-connect')).toHaveText('Войти в Яндекс');await expect(page.locator('#account-connect')).toBeEnabled();
 await page.reload();await expect(page.locator('#account-welcome')).toBeVisible();
});
test('do not offer again persists through restart while manual login remains available',async({page})=>{
 await page.goto('/');await page.locator('#account-welcome-dismiss').check();await page.locator('#account-welcome-later').click();await page.reload();
 await expect(page.locator('#account-welcome')).toBeHidden();await page.locator('[data-panel=settings]').click();await expect(page.locator('#account-connect')).toBeEnabled();
});
test('saved account has no welcome and shows change account after reload',async({page})=>{
 await page.goto('/');await page.locator('#account-welcome-later').click();await page.evaluate(()=>localStorage.setItem('test.connected','1'));await page.reload();
 await expect(page.locator('#account-welcome')).toBeHidden();await page.locator('[data-panel=settings]').click();await expect(page.locator('#account-connect')).toHaveText('Сменить аккаунт');await expect(page.locator('#account-disconnect')).toBeVisible();await expect(page.locator('#account-connection')).toContainText('сохранён');
});
test('welcome login opens the existing account flow and cancellation stays usable',async({page})=>{
 await page.goto('/');await page.locator('#account-welcome-login').click();await expect(page.locator('#account-welcome')).toBeHidden();await expect(page.locator('[data-pane=settings]')).toBeVisible();await expect(page.locator('#account-cancel')).toBeVisible();
 expect(await page.evaluate(()=>(window as any).welcomeAuthCalls[0])).toBe('begin');await page.locator('#account-cancel').click();await expect(page.locator('#account-status')).toContainText('Вход отменён');await expect(page.locator('iframe')).toHaveCount(0);
});
