import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function flag(name, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  if (/^(true|1|yes|on)$/i.test(value)) return true;
  if (/^(false|0|no|off)$/i.test(value)) return false;
  throw new Error(`${name} must be true or false.`);
}
function number(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}
export function publicOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('AGENT4_PUBLIC_URL must be an HTTP(S) origin without a path, credentials, query, or fragment.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for AGENT4_PUBLIC_URL outside localhost.');
  return url.origin;
}
export async function loadConfig() {
  if (!flag('AGENT4_AUTH_REQUIRED', true)) throw new Error('Agent4 requires authentication. Do not disable AGENT4_AUTH_REQUIRED.');
  const config = JSON.parse(await readFile(path.join(APP_ROOT, 'config/default.json'), 'utf8'));
  const dataRoot = path.resolve(process.env.AGENT4_DATA_DIR || path.join(APP_ROOT, 'data'));
  const origin = publicOrigin(process.env.AGENT4_PUBLIC_URL || 'http://localhost:8782');
  const provider = process.env.AGENT4_AI_PROVIDER || 'ollama';
  if (!['ollama', 'openai'].includes(provider)) throw new Error('AGENT4_AI_PROVIDER must be ollama or openai.');
  const zone = process.env.AGENT4_TIME_ZONE || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); } catch { throw new Error('AGENT4_TIME_ZONE must be an IANA time zone.'); }
  const setupTokenFile = path.resolve(process.env.AGENT4_SETUP_TOKEN_FILE || path.join(APP_ROOT, '.secrets/setup-token'));
  let setupToken = '';
  try { setupToken = (await readFile(setupTokenFile, 'utf8')).trim(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (setupToken && !/^[a-f0-9]{64}$/.test(setupToken)) throw new Error('Invalid setup token. Run npm run setup to prepare this installation.');
  return { ...config, runtime: {
    root: APP_ROOT, dataRoot,
    roomDatabasePath: path.join(dataRoot, 'agent4.sqlite'),
    meetingAudioRoot: path.join(dataRoot, 'meeting-audio'),
    hqTemplatePath: path.join(APP_ROOT, 'public/hq.html'),
    agent4PublicUrl: origin, publicOrigin: origin, setupToken, setupTokenFile,
    agent4AuthRequired: true, agent4SecureCookies: origin.startsWith('https://'), trustProxy: flag('AGENT4_TRUST_PROXY'),
    agent4SessionHours: number('AGENT4_SESSION_HOURS', 168, 1, 720),
    agent4AiProvider: provider, aiProvider: provider,
    agent4Model: process.env.AGENT4_MODEL || 'qwen3.5:4b', analysisModel: process.env.AGENT4_MODEL || 'qwen3.5:4b',
    agent4OpenaiApiKey: process.env.OPENAI_API_KEY || '', openaiApiKey: process.env.OPENAI_API_KEY || '',
    agent4GithubToken: process.env.AGENT4_GITHUB_TOKEN || '',
    agent4HourlyActionLimit: number('AGENT4_HOURLY_ACTION_LIMIT', 40, 1, 1000),
    agent4UserHourlyActionLimit: number('AGENT4_USER_HOURLY_ACTION_LIMIT', 12, 1, 1000),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', ollamaApiKey: process.env.OLLAMA_API_KEY || '',
    ollamaContextWindow: number('OLLAMA_CONTEXT_WINDOW', 8192, 1024, 131072),
    ollamaMaxOutputTokens: number('OLLAMA_MAX_OUTPUT_TOKENS', 1024, 128, 32768), ollamaKeepAlive: '2m',
    minFreeMemoryMb: number('AGENT4_MIN_FREE_MEMORY_MB', 1024), maxLoadAverage: number('AGENT4_MAX_LOAD_AVERAGE', 4),
    aiTimeoutMs: number('AGENT4_AI_TIMEOUT_MS', 180000, 1000, 1200000),
    meetingAiTimeoutMs: number('AGENT4_MEETING_AI_TIMEOUT_MS', 720000, 1000, 1200000),
    ownerTimeZone: zone, defaultEventMinutes: 60,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '', telegramOwnerChatId: process.env.TELEGRAM_OWNER_CHAT_ID || '',
    telegramOwnerUserId: process.env.TELEGRAM_OWNER_USER_ID || '', publicTelegramUsername: (process.env.AGENT4_TELEGRAM_USERNAME || '').replace(/^@/, ''),
    telegramMorningBriefAt: '08:30', telegramWeeklyResetAt: '18:00',
    googleCalendarClientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || '', googleCalendarClientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
    googleCalendarRefreshToken: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN || '', googleCalendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    voiceTranscriptionEnabled: flag('AGENT4_VOICE_TRANSCRIPTION_ENABLED'),
    voiceTranscriptionUrl: process.env.AGENT4_VOICE_TRANSCRIPTION_URL || 'http://127.0.0.1:8178/inference',
    voiceMaxBytes: number('AGENT4_VOICE_MAX_BYTES', 10485760, 1024, 10485760), voiceMaxDurationSeconds: number('AGENT4_VOICE_MAX_DURATION_SECONDS', 120, 1, 120),
    voiceTranscriptionTimeoutMs: 120000,
    clientPagesEnabled: flag('AGENT4_CLIENT_PAGES'), clientPagesHosts: (process.env.AGENT4_CLIENT_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean),
    clientPagesUrl: process.env.AGENT4_CLIENT_URL ? publicOrigin(process.env.AGENT4_CLIENT_URL) : '',
    clientWhatsapp: process.env.AGENT4_CLIENT_WHATSAPP || '', clientEmail: process.env.AGENT4_CLIENT_EMAIL || '',
    publicInquiryEnabled: flag('AGENT4_PUBLIC_INQUIRY'), publicInquiryOrigins: (process.env.AGENT4_INQUIRY_ORIGINS || '').split(',').filter(Boolean).map(publicOrigin),
    requestTimeoutMs: 20000, userAgent: 'Agent4/0.1'
  }};
}
export function requireSetting(value, label) {
  if (!value) throw new Error(`${label} is required. Add it to your .env file.`);
  return value;
}
