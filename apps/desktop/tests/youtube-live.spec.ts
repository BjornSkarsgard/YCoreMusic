import { test, expect } from '@playwright/test';
test('real YouTube: cue, explicit muted Play, pause and seek', async ({ page }) => {
  test.skip(process.env.YCORE_LIVE_YOUTUBE !== '1', 'Opt-in network spike');
  test.setTimeout(60000);
  await page.goto('/');
  await page.locator('#volume').evaluate((input:HTMLInputElement)=>{input.value='0';input.dispatchEvent(new Event('input'));});
  await page.locator('#edit-video').click();
  await page.locator('#url').fill(process.env.YCORE_TEST_VIDEO_ID ?? 'M7lc1UVf-VE');
  await page.getByRole('button', { name: 'Подготовить' }).click();
  try {await expect(page.locator('#play')).toBeEnabled({timeout:25000});} catch {throw new Error('Real embed preparation failed: '+await page.locator('#status').innerText());}
  await expect(page.locator('#status')).not.toHaveText('Воспроизведение');
  await page.locator('#play').click();
  await expect(page.locator('#status')).toHaveText('Воспроизведение', {timeout:25000});
  await page.locator('#pause').click();
  await expect(page.locator('#status')).toHaveText('Пауза');
  await page.locator('#forward').click();
  await expect(page.locator('#status')).toHaveText('Пауза');
  await expect.poll(async () => Number(await page.locator('#seek').inputValue())).toBeGreaterThanOrEqual(4);
});
