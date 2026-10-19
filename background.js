importScripts("shared.js");

const MAX_CONCURRENT = 2;
const MAX_TEXT_CHARS = 1000;
const MAX_QUOTED_CHARS = 600;
const MAX_QUOTED2_CHARS = 400;

// Cost controls
const BATCH_MAX = 5; // posts per request; batching 5 cut input tokens ~30% in testing
const BATCH_WAIT_MS = 400; // how long to wait for more posts before sending a partial batch
const CACHE_VERSION = 2; // bump when QUESTION changes so stale verdicts aren't reused
const CACHE_LIMIT = 3000;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

let active = 0;
const waiting = [];

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const MAX_RETRIES = 2;

const QUESTION = {
  type: "choice",
  instructions:
    "Classify this social media post. Judge the post's intent and style, not its topic. Ordinary news, opinions, jokes and genuine discussion are ok. If the state has a quoted_post, it is context only: classify the author's own post (for example a comment that stirs outrage over the quote, or farms replies), never the quoted post by itself. If it also has quoted_post_2, that is the post which quoted_post itself quotes; also context only. A post with no comment that just quotes another is ok unless the quote itself is plainly being used as bait.",
  criteria: {
    ok: "Normal post: news, opinion, humor, personal update, genuine discussion or a question with a real information need",
    ragebait: "Written mainly to provoke anger or outrage and fuel arguments, not to inform",
    clickbait: "Sensational or withholding headline meant to drive clicks or curiosity",
    influencer: "Self-promotion, get-rich or growth-hack hype, lead magnets, 'follow me for tips'",
    engagement: "Explicit ask for likes, reposts, follows or replies to boost reach; giveaways",
    question: "Trivial, generic open-ended question posed to farm replies, in any language: favorites, 'what makes you happiest/most relaxed', 'is there a place that...', would-you-rather. Questions seeking real help, facts or news are ok",
  },
};

function limit(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      task().then(resolve, reject).finally(() => {
        active--;
        const next = waiting.shift();
        if (next) next();
      });
    };
    if (active < MAX_CONCURRENT) run();
    else waiting.push(run);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Persistent verdict cache (survives service worker restarts) ----

let cache = null; // hash -> [label, confidence, savedAt]
let cacheLoading = null;

// Memoized so concurrent callers share one Map instead of each loading their own.
function loadCache() {
  cacheLoading ||= chrome.storage.local.get("aiCache").then(({ aiCache }) => {
    const cutoff = Date.now() - CACHE_TTL_MS;
    cache = new Map((aiCache || []).filter(([, v]) => v[2] > cutoff));
    return cache;
  });
  return cacheLoading;
}

function saveCache() {
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return chrome.storage.local.set({ aiCache: [...cache] });
}

async function hashKey(text, quoted, quoted2) {
  const data = new TextEncoder().encode(JSON.stringify([CACHE_VERSION, text, quoted, quoted2]));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- Usage tracking, shown in the popup ----

let usage = null;
let usageLoading = null;
const today = () => new Date().toLocaleDateString("en-CA");

// Memoized per day; a new day starts a fresh counter.
function loadUsage() {
  if (usage && usage.day !== today()) usageLoading = null;
  usageLoading ||= chrome.storage.local.get("aiUsage").then(({ aiUsage }) => {
    usage = aiUsage && aiUsage.day === today()
      ? aiUsage
      : { day: today(), posts: 0, cached: 0, requests: 0, inputTokens: 0, outputTokens: 0 };
    return usage;
  });
  return usageLoading;
}

const saveUsage = () => chrome.storage.local.set({ aiUsage: usage });

// ---- Requests ----

function describe(item) {
  const text = item.text.slice(0, MAX_TEXT_CHARS);
  // With a quote, send both so the model can use the quoted post as context.
  if (!item.quoted) return { post: text };
  return {
    post: text || "(no comment)",
    quoted_post: item.quoted.slice(0, MAX_QUOTED_CHARS),
    ...(item.quoted2 ? { quoted_post_2: item.quoted2.slice(0, MAX_QUOTED2_CHARS) } : {}),
  };
}

function buildBody(items) {
  if (items.length === 1) {
    const d = describe(items[0]);
    return { model: MODEL, state: items[0].quoted ? d : d.post, questions: { category: QUESTION } };
  }
  // One request, one question per post: the posts share a single call instead of paying per call.
  return {
    model: MODEL,
    state: items.map((item, i) => ({ id: i, ...describe(item) })),
    questions: Object.fromEntries(
      items.map((_, i) => [
        `p${i}`,
        { ...QUESTION, instructions: `${QUESTION.instructions} The state is a list of posts; classify only the post with id ${i}.` },
      ])
    ),
  };
}

function toVerdict(answer) {
  if (!answer || !(answer.choice in XC_CATEGORIES || answer.choice === "ok")) return null;
  return { label: answer.choice, confidence: answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0 };
}

async function post(body, apiKey) {
  const payload = JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: payload,
    });
    if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`TypeSafe API returned ${res.status}`);
    return res.json();
  }
}

// ---- Batching ----

let pending = [];
let flushTimer = null;
const inflight = new Map(); // hash -> promise, so identical posts share one call

function enqueue(item) {
  return new Promise((resolve, reject) => {
    pending.push({ ...item, resolve, reject });
    if (pending.length >= BATCH_MAX) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, BATCH_WAIT_MS);
  });
}

async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  const items = pending.splice(0, BATCH_MAX);
  if (!items.length) return;
  if (pending.length) flushTimer = setTimeout(flush, 0);

  try {
    const settings = await xcLoadSettings();
    if (!settings.apiKey) throw new Error("No API key set");

    const data = await limit(() => post(buildBody(items), settings.apiKey));
    const c = await loadCache();
    const u = await loadUsage();
    u.requests += 1;
    u.inputTokens += data.usage?.input_tokens ?? 0;
    u.outputTokens += data.usage?.output_tokens ?? 0;

    items.forEach((item, i) => {
      const verdict = toVerdict(data.answers?.[items.length === 1 ? "category" : `p${i}`]);
      if (verdict) {
        c.delete(item.hash);
        c.set(item.hash, [verdict.label, verdict.confidence, Date.now()]);
      }
      item.resolve(verdict);
    });
    await Promise.all([saveCache(), saveUsage()]);
  } catch (err) {
    items.forEach((item) => item.reject(err));
  }
}

async function classify(text, quoted = "", quoted2 = "") {
  const settings = await xcLoadSettings();
  if (!settings.enabled || !settings.apiKey) return null;

  const [c, u, hash] = await Promise.all([loadCache(), loadUsage(), hashKey(text, quoted, quoted2)]);

  const hit = c.get(hash);
  if (hit && Date.now() - hit[2] < CACHE_TTL_MS) {
    u.cached += 1;
    return { label: hit[0], confidence: hit[1] };
  }
  if (inflight.has(hash)) return inflight.get(hash);

  if (settings.dailyLimit > 0 && u.posts >= settings.dailyLimit) {
    throw new Error(`Daily AI limit of ${settings.dailyLimit} posts reached`);
  }
  u.posts += 1;

  const promise = enqueue({ text, quoted, quoted2, hash }).finally(() => inflight.delete(hash));
  inflight.set(hash, promise);
  return promise;
}

const SEEN_LIMIT = 5000; // remembered post keys, so re-renders and reloads don't count a post twice

let statsQueue = Promise.resolve();
function recordFlagged(category, key) {
  statsQueue = statsQueue.then(async () => {
    const { stats, statsSeen } = await chrome.storage.local.get(["stats", "statsSeen"]);
    const seen = new Set(statsSeen || []);
    if (key && seen.has(key)) return;

    const next = stats || { hidden: 0, byCategory: {} };
    next.hidden += 1;
    next.byCategory[category] = (next.byCategory[category] || 0) + 1;
    if (key) seen.add(key);
    await chrome.storage.local.set({ stats: next, statsSeen: [...seen].slice(-SEEN_LIMIT) });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === "classify" && typeof msg.text === "string") {
    classify(
      msg.text,
      typeof msg.quoted === "string" ? msg.quoted : "",
      typeof msg.quoted2 === "string" ? msg.quoted2 : ""
    )
      .then((result) => sendResponse({ ok: !!result, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async response
  }
  if (msg.type === "flagged" && msg.category in XC_CATEGORIES) {
    recordFlagged(msg.category, typeof msg.key === "string" ? msg.key : "");
  }
});
