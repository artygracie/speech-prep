import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const INTERNAL_KEY = process.env.INTERNAL_TRIGGER_KEY;
const GITHUB_REPO = 'artygracie/speech-prep';
const APP_URL = 'https://speechprep.ai';
const ADMIN_EMAIL = 'gracie@artygroup.com';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function closePR(prNumber) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/pulls/${prNumber}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state: 'closed' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PR close failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sendRejectionEmail(title) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'SpeechPrep <noreply@speechprep.ai>',
      to: [ADMIN_EMAIL],
      subject: `Auto-rejected: ${title}`,
      text: 'No review after 5 days. Re-arm from /admin/drafts/rejected if needed.',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend email failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function sendNudge(draftId) {
  const res = await fetch(`${APP_URL}/api/admin/drafts/send-approval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': INTERNAL_KEY,
    },
    body: JSON.stringify({ draftId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nudge send failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function insertRevision(draftId, content) {
  const { error } = await supabase
    .from('draft_revisions')
    .insert({ draft_id: draftId, kind: 'system_event', content });
  if (error) throw new Error(`Insert revision failed: ${error.message}`);
}

async function main() {
  const { data: drafts, error } = await supabase
    .from('drafts')
    .select('id, title, email_sent_at, reminder_sent_at, pr_number')
    .eq('status', 'awaiting_review');

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);

  const now = new Date();
  let reminders = 0;
  let rejected = 0;

  for (const draft of drafts) {
    const { id, title, email_sent_at, reminder_sent_at, pr_number } = draft;
    const sentAt = new Date(email_sent_at);
    const hoursSince = (now - sentAt) / (1000 * 60 * 60);

    console.log(`Draft "${title}" (id=${id}): ${hoursSince.toFixed(1)}h since email`);

    if (hoursSince >= 120) {
      console.log(`  -> AUTO-REJECT (${hoursSince.toFixed(1)}h >= 120h)`);
      try {
        if (pr_number) await closePR(pr_number);
        const { error: updateErr } = await supabase
          .from('drafts')
          .update({ status: 'rejected', status_reason: 'Auto-rejected after 5 days' })
          .eq('id', id);
        if (updateErr) throw new Error(`Update status failed: ${updateErr.message}`);
        await insertRevision(id, 'Auto-rejected after 5 days of no review');
        await sendRejectionEmail(title);
        rejected++;
        console.log(`  -> Rejected, PR closed, email sent.`);
      } catch (err) {
        console.error(`  -> ERROR during auto-reject: ${err.message}`);
      }
    } else if (hoursSince >= 48 && !reminder_sent_at) {
      console.log(`  -> NUDGE (${hoursSince.toFixed(1)}h >= 48h, no prior reminder)`);
      try {
        await sendNudge(id);
        const { error: updateErr } = await supabase
          .from('drafts')
          .update({ reminder_sent_at: now.toISOString() })
          .eq('id', id);
        if (updateErr) throw new Error(`Update reminder_sent_at failed: ${updateErr.message}`);
        await insertRevision(id, 'Reminder sent (48h)');
        reminders++;
        console.log(`  -> Nudge sent, reminder_sent_at updated.`);
      } catch (err) {
        console.error(`  -> ERROR during nudge: ${err.message}`);
      }
    } else {
      console.log(`  -> No action needed.`);
    }
  }

  console.log(`\nChecked ${drafts.length} drafts. ${reminders} reminders sent. ${rejected} auto-rejected.`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
