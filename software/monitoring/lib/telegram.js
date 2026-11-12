// Sends a photo to the Telegram bot chat. No-op if not configured.
export async function sendPhoto(jpegBuffer, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const form = new FormData();
  form.append("chat_id", chat);
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([jpegBuffer], { type: "image/jpeg" }), "pecheye.jpg");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  if (!res.ok) console.error("Telegram error", res.status, await res.text());
  return res.ok;
}

export async function sendMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
  return res.ok;
}
