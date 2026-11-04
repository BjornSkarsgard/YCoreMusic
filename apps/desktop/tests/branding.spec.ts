import {test,expect} from './fixtures';

test('YCore branding uses the short header name, full window name and exact agreed slogan',async({page})=>{
 await page.goto('/');await expect(page).toHaveTitle('YCore Music');
 await expect(page.locator('.brand')).toHaveAttribute('aria-label','YCore Music');await expect(page.locator('.brand')).toContainText('YCore');
 await page.locator('[data-panel=settings]').click();await expect(page.locator('[data-pane=settings]>h2')).toHaveText('YCore Music');
 await expect(page.locator('.brand-tagline')).toHaveText('Your Music. Your Core, Your World.');
});
