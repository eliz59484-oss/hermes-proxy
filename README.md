# 🔧 Hermes Agent + Vercel Прокси — Решение блокировки OpenRouter

## Проблема
OpenRouter (и Groq, Mistral) блокируют российские IP-адреса серверов Beget.
Hermes Agent использует OpenRouter как провайдер — запросы падают с `HTTP 403: Access denied by security policy`.

## Решение
Развернуть **Vercel прокси** — сервер шлёт запросы на Vercel (не блокируется),
Vercel пересылает в OpenRouter с реальным ключом.

```
Beget VPS → Vercel Proxy → OpenRouter → AI модель
```

---

## Шаг 1 — Создать Vercel прокси

### Файлы проекта

**`pages/api/v1/[...path].js`** (главный файл — catch-all прокси):
```javascript
export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
  const targetUrl = `https://openrouter.ai/api/v1/${path}`;

  const headers = {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': req.headers['content-type'] || 'application/json',
    'HTTP-Referer': 'https://hermes-proxy.vercel.app',
    'X-Title': 'Hermes Agent',
  };

  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const response = await fetch(targetUrl, { method: req.method, headers, body });
  const contentType = response.headers.get('content-type') || 'application/json';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(response.status);

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); break; }
      res.write(value);
    }
  } catch { res.end(); }
}
```

**`package.json`**:
```json
{
  "name": "hermes-proxy",
  "version": "1.0.0",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build" },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  }
}
```

### Деплой на Vercel

```bash
# Инициализируем git и пушим на GitHub
git init && git add . && git commit -m "hermes proxy"
git remote add origin https://GITHUB_TOKEN@github.com/USERNAME/hermes-proxy.git
git push -u origin main
```

Затем на vercel.com → **New Project → Import from GitHub → hermes-proxy**

**Важно:** добавить Environment Variable перед деплоем:
- Name: `OPENROUTER_API_KEY`
- Value: твой ключ OpenRouter (из openrouter.ai/keys)

---

## Шаг 2 — Настроить Hermes на сервере

### .env файл
```bash
cat > /root/.hermes/.env << 'EOF'
TELEGRAM_BOT_TOKEN=твой_токен_бота
OPENROUTER_API_KEY=proxy-key
EOF
```
> `OPENROUTER_API_KEY=proxy-key` — любое значение, реальный ключ хранится в Vercel

### Пропатчить исходники Hermes

Hermes хардкодит URL OpenRouter в **двух файлах**. Меняем на Vercel URL:

```bash
PROXY="https://ИМЯ-ПРОЕКТА.vercel.app/api/v1"

sed -i "s|https://openrouter.ai/api/v1|${PROXY}|g" \
    /usr/local/lib/hermes-agent/hermes_constants.py \
    /usr/local/lib/hermes-agent/plugins/model-providers/openrouter/__init__.py

find /usr/local/lib/hermes-agent -name "*.pyc" -delete
```

### Выбрать модель и перезапустить

```bash
# Имя модели — БЕЗ префикса openrouter/
hermes config set model deepseek/deepseek-v4-flash

systemctl --user restart hermes-gateway
```

### Посмотреть доступные модели через прокси

```bash
curl -s https://ИМЯ.vercel.app/api/v1/models \
  -H 'Authorization: Bearer proxy-key' | \
  python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data']]" | head -20
```

---

## Проверка что всё работает

```bash
# В логах должен быть base_url=https://ИМЯ.vercel.app (не openrouter.ai!)
hermes logs errors 2>&1 | tail -5

# Прямой тест прокси
curl -X POST https://ИМЯ.vercel.app/api/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer proxy-key' \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

---

## ⚠️ После обновления Hermes (`hermes update`)

Обновление **перезапишет** пропатченные файлы! После каждого обновления повторить патч:

```bash
PROXY="https://hermes-proxy-ten.vercel.app/api/v1"
sed -i "s|https://openrouter.ai/api/v1|${PROXY}|g" \
    /usr/local/lib/hermes-agent/hermes_constants.py \
    /usr/local/lib/hermes-agent/plugins/model-providers/openrouter/__init__.py
find /usr/local/lib/hermes-agent -name "*.pyc" -delete
systemctl --user restart hermes-gateway
```

---

## Текущая конфигурация (2026-07-30)

| Параметр | Значение |
|---|---|
| VPS | `159.194.232.115` (Beget) |
| Vercel прокси | `https://hermes-proxy-ten.vercel.app` |
| GitHub репо | `https://github.com/eliz59484-oss/hermes-proxy` |
| Модель | `deepseek/deepseek-v4-flash` |
| Файлы проекта на Mac | `/Users/igor/.gemini/antigravity/scratch/hermes-proxy/` |
