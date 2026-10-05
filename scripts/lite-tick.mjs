const secret = process.env.CRON_SECRET ?? '';
const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

function isLocal(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

if (!isLocal(base)) {
  console.error('lite:tick only runs against localhost');
  process.exit(1);
}

if (!secret) {
  console.error('CRON_SECRET is not set');
  process.exit(1);
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function tick() {
  const time = stamp();
  try {
    const response = await fetch(`${base}/api/cron/lite-tick`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!response.ok) {
      console.log(`${time} ${response.status}`);
      return;
    }
    const body = await response.json();
    const sent = body?.texts?.sent ?? 0;
    const ended = body?.conversations?.ended ?? 0;
    console.log(`${time} sent=${sent} ended=${ended}`);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    console.log(`${time} ${name}`);
  }
}

await tick();
setInterval(tick, 60_000);
