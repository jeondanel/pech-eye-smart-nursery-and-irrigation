// Telegram bot chat. Every call is a no-op (returns false) if the bot isn't configured.
async function call(method, body, headers) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !process.env.TELEGRAM_CHAT_ID) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers, body });
  if (!res.ok) console.error("Telegram error", res.status, await res.text());
  return res.ok;
}

export function sendPhoto(jpegBuffer, caption) {
  const form = new FormData();
  form.append("chat_id", process.env.TELEGRAM_CHAT_ID);
  if (caption) form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([jpegBuffer], { type: "image/jpeg" }), "pecheye.jpg");
  return call("sendPhoto", form);
}

export function sendMessage(text) {
  return call("sendMessage", JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }), { "content-type": "application/json" });
}
