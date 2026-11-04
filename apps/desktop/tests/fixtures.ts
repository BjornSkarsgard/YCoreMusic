import {test as base} from '@playwright/test';
export {expect} from '@playwright/test';
export type {Page} from '@playwright/test';
// Mocked renderer scenarios must not wait on public thumbnail requests.
// The separate opt-in live YouTube spec imports Playwright directly.
export const test=base.extend({page:async({page},use)=>{
 await page.route('https://i.ytimg.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#20212a"/></svg>'}));
 await use(page);
}});
