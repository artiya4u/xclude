importScripts("shared.js");

const CACHE_LIMIT = 500;
const MAX_CONCURRENT = 2;
const MAX_TEXT_CHARS = 1000;

const cache = new Map(); // text -> { label, confidence }
let active = 0;
const waiting = [];

const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const MAX_RETRIES = 2;

const QUESTION = {
  type: "choice",
  instructions:
    "Classify this social media post. Judge the post's intent and style, not its topic. Ordinary news, opinions, jokes and genuine discussion are ok.",
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

async function callModel(text, apiKey) {
  const body = JSON.stringify({
    model: MODEL,
    state: text.slice(0, MAX_TEXT_CHARS),
    questions: { category: QUESTION },
  });

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
    });
    if ((res.status === 429 || res.status === 529) && attempt < MAX_RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`TypeSafe API returned ${res.status}`);

    const answer = (await res.json()).answers?.category;
    if (!answer || !(answer.choice in XC_CATEGORIES || answer.choice === "ok")) return null;
    return { label: answer.choice, confidence: answer.probabilities?.[answer.choice] ?? answer.confidence ?? 0 };
  }
}

async function classify(text) {
  const settings = await xcLoadSettings();
  if (!settings.enabled || !settings.apiKey) return null;

  const key = text;
  if (cache.has(key)) return cache.get(key);

  const verdict = await limit(() => callModel(text, settings.apiKey));
  if (verdict) {
    cache.set(key, verdict);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  return verdict;
}

let statsQueue = Promise.resolve();
function recordHidden(category) {
  statsQueue = statsQueue.then(async () => {
    const { stats } = await chrome.storage.local.get("stats");
    const next = stats || { hidden: 0, byCategory: {} };
    next.hidden += 1;
    next.byCategory[category] = (next.byCategory[category] || 0) + 1;
    await chrome.storage.local.set({ stats: next });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === "classify" && typeof msg.text === "string") {
    classify(msg.text)
      .then((result) => sendResponse({ ok: !!result, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // async response
  }
  if (msg.type === "hidden" && msg.category in XC_CATEGORIES) {
    recordHidden(msg.category);
  }
});
