const { test, expect } = require('@playwright/test');

test('Participant can complete a study', async ({ page }) => {
  await page.goto('http://localhost:7000/');
  await page.click('text=Start Study');
  await page.fill('#participantId', '123456789012345678901234');
  await page.fill('#studyId', '411');
  await page.click('#startBtn');
  await page.waitForSelector('.card-row1-col2-3-4-5');
  await page.check('#radio-healthy');
  await page.click('#button-next');
  await expect(page.locator('#progress-bar-text')).toHaveText(/Diagnosis 2\/17/);
});