import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:4200';
const browser = await chromium.launch({ headless: true });
const publicRoutes = [
  '/',
  '/auth',
  '/lookup',
  '/skymiles',
  '/results',
  '/booking/passengers',
  '/booking/seats',
  '/booking/review',
];
const customerRoutes = ['/trips', '/track', '/reschedule', '/profile'];
const adminRoutes = [
  '/admin',
  '/admin/reservation-desk',
  '/admin/bookings',
  '/admin/seat-operations',
  '/admin/users',
  '/admin/flights',
  '/admin/airports',
  '/admin/policies',
  '/admin/commercial',
  '/admin/seat-pricing',
];

async function makeContext(lang) {
  const context = await browser.newContext();
  await context.addInitScript((value) => {
    localStorage.setItem('aptech-airlines-language', value);
  }, lang);
  return context;
}

async function login(page, username) {
  await page.goto(baseUrl + '/auth', { waitUntil: 'networkidle' });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill('DemoPass@2026');
  await page.locator('button.submit').click();
  await page.waitForURL((url) => url.pathname === '/', { timeout: 10000 });
}

async function scan(page, route) {
  await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(650);
  return await page.evaluate(() => ({
    url: location.pathname + location.search,
    lang: document.documentElement.lang,
    text: (document.body.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    attrs: Array.from(document.querySelectorAll('[placeholder], [title], [aria-label]'))
      .flatMap((element) => ['placeholder', 'title', 'aria-label']
        .map((name) => element.getAttribute(name))
        .filter(Boolean)),
  }));
}

function suspicious(lines, lang) {
  const allow = /APTECH|AIRLINES|SkyMiles|PayPal|AirLabs|IATA|PNR|VND|USD|ECONOMY|CLUB|BUSINESS|FIRST|MEMBER|SILVER|GOLD|PLATINUM|SGN|HAN|DAD|APT-/i;
  const viWords = /\b(Đang|Không|Chưa|Tìm|Thêm|Sửa|Xóa|Lưu|Đóng|Chọn|Hành|Khách|Chuyến|Ghế|Giá|Ngày|Người|Đặt|Đổi|Hủy|Quản|Tải|Cập|Trạng|Mã|Sân|Phát|Bắt|Vui|Nhập|Tra|Hoàn|Thanh|Tổng|Chiều|Nơi|Loại|Thông|Chính|Thương|Còn|Đã|Tạo)\b/i;
  const enWords = /\b(Dashboard|Reservation|Bookings?|Seat Operations|Users|Flights|Airports|Policies|Commercial|Seat Pricing|Customer site|Logout|Search|Create|Update|Save|Delete|Edit|Refresh|Loading|Selected|Available|Total seats|Base fare|Physical capacity|Flight number|Origin|Destination|Role|Unable|Select|Publish|Materialize|Passenger|Fare|Status|Ticket|Current points|Profile|Details|Cancel|Confirm|Hold|Direct|Connecting|Customer|Backend|Template|Network|Aircraft|Cabin|Staff|Scheduler|Timezone|Version|Rule|Records?|Source|Layout|Audit|Checkout)\b/i;
  return lines.filter((line) => {
    if (allow.test(line) && line.length < 35) return false;
    return lang === 'en' ? viWords.test(line) : enWords.test(line);
  });
}

for (const lang of ['vi', 'en']) {
  console.log('\n=== ' + lang.toUpperCase() + ' PUBLIC ===');
  {
    const context = await makeContext(lang);
    const page = await context.newPage();
    for (const route of publicRoutes) {
      const data = await scan(page, route);
      const bad = suspicious([...data.text, ...data.attrs], lang);
      console.log(route, '=>', data.url, 'lang=' + data.lang, 'suspect=' + bad.length);
      if (bad.length) console.log('  ' + bad.join(' | ').slice(0, 7000));
    }
    await context.close();
  }

  console.log('\n=== ' + lang.toUpperCase() + ' CUSTOMER ===');
  {
    const context = await makeContext(lang);
    const page = await context.newPage();
    await login(page, 'demo_customer');
    for (const route of customerRoutes) {
      const data = await scan(page, route);
      const bad = suspicious([...data.text, ...data.attrs], lang);
      console.log(route, '=>', data.url, 'lang=' + data.lang, 'suspect=' + bad.length);
      if (bad.length) console.log('  ' + bad.join(' | ').slice(0, 7000));
    }
    await context.close();
  }

  console.log('\n=== ' + lang.toUpperCase() + ' ADMIN ===');
  {
    const context = await makeContext(lang);
    const page = await context.newPage();
    await login(page, 'demo_admin');
    for (const route of adminRoutes) {
      const data = await scan(page, route);
      const bad = suspicious([...data.text, ...data.attrs], lang);
      console.log(route, '=>', data.url, 'lang=' + data.lang, 'suspect=' + bad.length);
      if (bad.length) console.log('  ' + bad.join(' | ').slice(0, 7000));
    }
    await context.close();
  }
}

console.log('\n=== TOGGLE + PERSISTENCE ===');
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.waitForTimeout(100);
  const enNow = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    stored: localStorage.getItem('aptech-airlines-language'),
    body: document.body.innerText,
  }));
  await page.reload({ waitUntil: 'networkidle' });
  const enReload = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    stored: localStorage.getItem('aptech-airlines-language'),
    body: document.body.innerText,
  }));
  await page.getByRole('button', { name: 'VI', exact: true }).click();
  await page.waitForTimeout(100);
  const viNow = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    stored: localStorage.getItem('aptech-airlines-language'),
    body: document.body.innerText,
  }));
  console.log(JSON.stringify({
    enNow: { lang: enNow.lang, stored: enNow.stored, search: enNow.body.includes('Search flights') },
    enReload: { lang: enReload.lang, stored: enReload.stored, search: enReload.body.includes('Search flights') },
    viNow: { lang: viNow.lang, stored: viNow.stored, search: viNow.body.includes('Tìm chuyến') },
  }));
  await context.close();
}

await browser.close();
