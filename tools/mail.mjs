#!/usr/bin/env node
/* ==========================================================================
   Eltes — mail command line
   --------------------------------------------------------------------------
     node tools/mail.mjs status                     what is configured
     node tools/mail.mjs welcome you@example.com    send the real welcome mail
     node tools/mail.mjs test you@example.com       prove a provider works
     node tools/mail.mjs bounce you@example.com     record a hard bounce
     node tools/mail.mjs unsuppress you@example.com forget a suppression

   Nothing here is a simulation except `bounce`: that command writes the same
   event a provider webhook would write, so you can watch the suppression list
   do its job without waiting for a real bounce.
   ========================================================================== */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createMailer, readConfig } = require('../lib/mail.cjs');

const [, , command = 'status', ...rest] = process.argv;
const flags = new Set(rest.filter((value) => value.startsWith('--')));
const args = rest.filter((value) => !value.startsWith('--'));
const json = flags.has('--json');

const config = readConfig(process.env);
const mailer = createMailer({ env: process.env, log: json ? () => {} : (line) => console.log(line) });

function print(value) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(value);
}

function showStatus() {
  const status = mailer.status();
  if (json) return print(status);
  const line = (label, value) => console.log(`  ${label.padEnd(12)} ${value}`);
  console.log('\nEltes mail');
  line('mode', status.mode === 'live' ? `live · ${status.provider}` : 'outbox only (nothing leaves this machine)');
  line('from', status.from || '—');
  if (status.problems.length) line('needs', status.problems.join('; '));
  line('folder', status.mailDir);
  line('outbox', `${status.outbox} message${status.outbox === 1 ? '' : 's'} saved`);
  line('counts', `sent ${status.counts.sent} · bounced ${status.counts.bounced} · outbox ${status.counts.outbox} · errors ${status.counts.error}`);
  if (status.suppressed.length) {
    line('suppressed', `${status.suppressed.length} address${status.suppressed.length === 1 ? '' : 'es'} (nothing is sent to them again)`);
    for (const entry of status.suppressed.slice(0, 5)) {
      console.log(`               ${entry.email} · ${entry.reason} · ${entry.at}`);
    }
  }
  if (status.recent.length) {
    console.log('\n  recent');
    for (const event of status.recent.slice(0, 6)) {
      console.log(`    ${event.at}  ${event.type.padEnd(9)} ${event.to || ''}${event.detail ? ` · ${event.detail}` : ''}`);
    }
  }
  console.log('');
}

async function run() {
  if (command === 'status') return showStatus();

  if (command === 'welcome' || command === 'test') {
    const to = args[0];
    if (!to) {
      console.error(`Usage: node tools/mail.mjs ${command} <email> [--name "Ada Lovelace"] [--json]`);
      process.exitCode = 1;
      return;
    }
    const nameIndex = rest.indexOf('--name');
    const name = nameIndex >= 0 ? rest[nameIndex + 1] : (to.split('@')[0] || 'there');
    const result = command === 'welcome'
      ? await mailer.sendWelcome({ name, email: to, baseUrl: process.env.ELTES_APP_URL || 'http://localhost:4173' })
      : await mailer.send({
        to,
        subject: 'Eltes mail test',
        text: 'This is a test from your Eltes server. If you can read it, the provider is configured correctly.',
        html: '<p style="font-family:system-ui,sans-serif">This is a test from your Eltes server. If you can read it, the provider is configured correctly.</p>'
      });

    if (json) return print(result);
    if (result.ok) {
      console.log(`\nSent · ${result.provider}${result.id ? ` · ${result.id}` : ''} · ${result.ms} ms → ${result.to}`);
      console.log(`Subject: ${result.subject}\n`);
      return;
    }
    if (result.suppressed) {
      console.log(`\nNot sent — ${result.reason}\n`);
      return;
    }
    if (result.outbox) {
      console.log(`\nNot delivered — ${result.reason}.`);
      console.log(`Saved as a real .eml file you can open in any mail client:\n  ${result.file}\n`);
      console.log('To actually deliver it, set ELTES_MAIL_FROM plus one of:');
      console.log('  RESEND_API_KEY   free plan: 3,000/month, 100/day');
      console.log('  BREVO_API_KEY    free plan: 300/day');
      console.log('  ELTES_SMTP_URL   smtps://user:pass@smtp.example.com:465\n');
      process.exitCode = 0;
      return;
    }
    console.log(`\nNot delivered — ${result.error || 'unknown error'}${result.bounced ? ' (address treated as a hard bounce)' : ''}.\n`);
    process.exitCode = 1;
    return;
  }

  if (command === 'bounce') {
    const to = args[0];
    if (!to) {
      console.error('Usage: node tools/mail.mjs bounce <email> [reason]');
      process.exitCode = 1;
      return;
    }
    const result = mailer.webhook({ type: 'bounced', to, detail: args[1] || '551 mailbox does not exist' }, 'cli');
    print(json ? result : `\nRecorded a hard bounce for ${to}. Later sends to this address are skipped.\n`);
    return;
  }

  if (command === 'unsuppress') {
    const to = args[0];
    if (!to) {
      console.error('Usage: node tools/mail.mjs unsuppress <email>');
      process.exitCode = 1;
      return;
    }
    const { readFileSync, writeFileSync } = await import('node:fs');
    const file = mailer.paths.suppressed;
    let list = {};
    try { list = JSON.parse(readFileSync(file, 'utf8')); } catch { list = {}; }
    delete list[String(to).trim().toLowerCase()];
    writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`);
    console.log(`\n${to} can receive mail again.\n`);
    return;
  }

  console.error(`Unknown command "${command}". Try: status, welcome, test, bounce, unsuppress`);
  process.exitCode = 1;
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
