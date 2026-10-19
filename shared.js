// Shared by the content script, service worker (importScripts), popup and options page.

const XC_CATEGORIES = {
  ragebait: "Ragebait",
  clickbait: "Clickbait",
  influencer: "Influencer hype",
  engagement: "Engagement farming",
  question: "Trivial questions",
};

// Badge/bar colors per category (readable on light and dark backgrounds).
const XC_COLORS = {
  ragebait: "#f4212e",
  clickbait: "#f58a07",
  influencer: "#7856ff",
  engagement: "#00a67e",
  question: "#1d9bf0",
};

const XC_DEFAULTS = {
  enabled: true,
  mode: "label", // "label": keep flagged posts visible with a category tag; "hide": collapse them behind a Show button
  categories: { ragebait: true, clickbait: true, influencer: true, engagement: true, question: true },
  sensitivity: "balanced", // relaxed | balanced | strict
  apiKey: "", // TypeSafe (Jev) API key; AI classification is on whenever this is set
  allowlist: [],
};

const XC_THRESHOLDS = {
  relaxed: { score: 5, confidence: 0.75 },
  balanced: { score: 3.5, confidence: 0.6 },
  strict: { score: 2.5, confidence: 0.5 },
};

// [pattern, category, weight]
const XC_RULES = [
  // Engagement farming
  [/\b(like|retweet|repost|rt|follow)\b[^.\n]{0,25}\b(and|&|\+|if)\b[^.\n]{0,25}\b(like|retweet|repost|rt|follow|comment)\b/i, "engagement", 3],
  [/\b(rt|retweet|repost|like) (this )?if\b/i, "engagement", 3],
  [/\bfollow (me )?for (more|daily)\b/i, "engagement", 2.5],
  [/\bcomment ["'“”]?\w+["'“”]? (and|&|to) (i['’]ll|get|receive|i will)\b/i, "engagement", 3.5],
  [/\b(giveaway|airdrop)\b/i, "engagement", 2],
  [/\bturn on (post )?notifications\b/i, "engagement", 2],
  [/\b(drop|reply with|comment) (a |an )?(🔥|❤️|👇|emoji|gm|yes|1)\b/i, "engagement", 2.5],
  [/\b(ratio|ratioed)\b/i, "engagement", 1],
  [/\bbookmark this\b/i, "engagement", 1.5],
  [/\bwho['’]?s (still )?(awake|here)\b/i, "engagement", 2],

  // Clickbait
  [/\b(you (won['’]t|will not|wouldn['’]t) believe|what happens next|will (shock|blow) you)\b/i, "clickbait", 3.5],
  [/\bnobody (is )?(talking about|tells you|knows)\b/i, "clickbait", 3],
  [/\b(this|it)('s| is) (insane|unreal|wild|crazy|unbelievable)\b/i, "clickbait", 2],
  [/\b(they|the media|the government) (don['’]t|doesn['’]t|do not) want you to (know|see)\b/i, "clickbait", 3.5],
  [/\bbreaking[:!]/i, "clickbait", 1.5],
  [/\b(thread|🧵)\s*(👇|⬇️|:)?\s*$/i, "clickbait", 1.5],
  [/\bhere['’]?s (why|what|how)\b[^.\n]{0,40}(👇|⬇️|🧵)/i, "clickbait", 2],
  [/\bstop scrolling\b/i, "clickbait", 3],
  [/\bread (that|this) again\b/i, "clickbait", 2],
  [/\b\d+ (things|ways|tips|tools|secrets|mistakes) (you|that|every|to)\b/i, "clickbait", 1.5],

  // Influencer hype
  [/\b(make|made|earn|earning)\s+\$?\d[\d,.]*\s?[kKmM]?\s*(\/|per|a|every)?\s*(month|mo|week|day|hour)\b/i, "influencer", 3.5],
  [/\bpassive income\b/i, "influencer", 3],
  [/\b(side hustle|financial freedom|six figures|7[- ]figures?|quit your (9|nine)[- ]to[- ](5|five))\b/i, "influencer", 2.5],
  [/\b(the )?(chatgpt|ai|gpt)\b[^.\n]{0,30}\b(prompts?|tools?)\b[^.\n]{0,30}\b(will|that will|to)\b[^.\n]{0,30}\b(change|replace|10x|save)\b/i, "influencer", 3],
  [/\b10x\b/i, "influencer", 1.5],
  [/\b(dm|message) me (for|to get|the word)\b/i, "influencer", 2.5],
  [/\bfree (guide|course|ebook|pdf|template|cheatsheet)s?\b/i, "influencer", 2],
  [/\b(grindset|hustle culture|rise and grind|alpha|sigma)\b/i, "influencer", 2],
  [/\bi (went|grew) from \$?\d[\d,.]*[kKmM]?\s+to\s+\$?\d[\d,.]*[kKmM]?\b/i, "influencer", 3],

  // Ragebait
  [/\b(wake up|open your eyes)[, ]+(people|america|world|sheep)\b/i, "ragebait", 3],
  [/\b(libs|leftists|woke mob|maga cult|sheeple|snowflakes?|normies)\b/i, "ragebait", 2],
  [/\b(disgusting|despicable|outrageous|shameful)\b[^.\n]{0,60}(and|but)\b[^.\n]{0,40}\b(nobody|no one)\b/i, "ragebait", 3],
  [/\b(unpopular opinion|hot take)\b/i, "ragebait", 1.5],
  [/\b(this is|that['’]s) (what|why) (is )?(wrong|destroying|ruining)\b/i, "ragebait", 2.5],
  [/\b(is|are) (destroying|ruining|killing) (america|the west|our country|society|everything)\b/i, "ragebait", 3],
  [/\bhow (is|are) (this|these|they) (still )?(legal|allowed)\b/i, "ragebait", 2],
  [/\b(quote|qt) (this )?(and|to) (tell|show) (me|us)\b/i, "ragebait", 2],

  // Trivial questions: generic open-ended prompts that farm replies (Thai)
  [/(อะไร|ไหน|ใคร|ไหม|มั้ย|บ้าง)[^\n]{0,60}(ที่สุด|สำหรับ(คุณ|เธอ|เรา|ทุกคน))/, "question", 2.5],
  [/สำหรับ(คุณ|เธอ|เพื่อน ๆ|ทุกคน)\s*[?？]?\s*$/, "question", 2],
  [/มี(สถานที่|เสียง|กลิ่น|อาหาร|เมนู|เพลง|หนัง|วัน|ช่วงเวลา|คำพูด|ที่ไหน|อะไร)[^\n]{0,25}(อะไร|ไหน|ไหม|มั้ย)/, "question", 2.5],
  [/(ฟังแล้ว|ได้ไป|ได้ทำ|ได้กิน|ได้ดู|ได้นอน)[^\n]{0,40}(รู้สึก|ใจฟู|สบายใจ|ผ่อนคลาย|มีความสุข|หายเหนื่อย)/, "question", 2],
  [/(ใจฟู|ฮีลใจ|ชุ่มชื่นหัวใจ|หายเหนื่อย|ผ่อนคลายที่สุด)/, "question", 1.5],
  [/(ถ้าเลือกได้|ถ้าให้เลือก|ถ้ามีโอกาส|ถ้าย้อนเวลาได้)[^\n]{0,60}(อะไร|ที่ไหน|ใคร)/, "question", 2.5],
  [/(ทุกคน|เพื่อน ๆ)[^\n]{0,15}(ชอบ|เคย|มี)[^\n]{0,40}(ไหม|มั้ย|บ้าง)/, "question", 2.5],
  [/(เล่าให้ฟัง|แชร์หน่อย|คอมเมนต์มา|มาเล่า)/, "question", 2],

  // Trivial questions (English)
  [/\bwould you rather\b/i, "question", 3],
  [/\bwhat['’]?s (your|the one) (favou?rite|go-to|guilty pleasure|comfort|happy place)\b/i, "question", 3.5],
  [/\b(what|which|where|who)\b[^?\n]{0,60}\b(makes?|made) you (happiest|feel (calm|relaxed|happy|peaceful|sleepy))\b/i, "question", 3],
  [/\bif you could (only )?(choose|pick|have|go|live|eat|be)\b[^?\n]{0,50}\?/i, "question", 2.5],
  [/\b(drop|share|tell me) your (favou?rite|go-to|current)\b/i, "question", 2.5],
  [/\bwhat['’]?s (a|one) (thing|song|movie|place|food|sound|smell)\b[^?\n]{0,60}\?/i, "question", 2],
];

function xcNormalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

// Shape-based signals that don't depend on specific phrases.
function xcShapeScores(text) {
  const out = [];
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 25) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length > 0.6) out.push(["ragebait", 2, "mostly capitals"]);
  }
  const bangs = (text.match(/[!?]{2,}/g) || []).length;
  if (bangs >= 2) out.push(["ragebait", 1.5, "excess punctuation"]);
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emoji >= 6 && emoji / Math.max(text.length, 1) > 0.08) out.push(["clickbait", 1.5, "emoji spam"]);
  const hashtags = (text.match(/(^|\s)#\w+/g) || []).length;
  if (hashtags >= 5) out.push(["engagement", 2, "hashtag stuffing"]);
  const asksQuestion = /[?？]\s*$/.test(text) || /(ไหม|มั้ย|หรือเปล่า|บ้าง|สำหรับคุณ|ที่สุด|อะไร|ที่ไหน|ใคร)\s*$/.test(text);
  if (asksQuestion && text.length <= 160 && !/https?:\/\//.test(text) && !/[.!]\s+\S/.test(text)) {
    out.push(["question", 1.5, "short open-ended question"]);
  }
  return out;
}

// Returns { category, score, reason } for the best-scoring enabled category, or null.
function xcHeuristic(rawText, settings) {
  const text = xcNormalize(rawText);
  if (text.length < 8) return null;

  const scores = {};
  const reasons = {};
  const add = (cat, weight, why) => {
    scores[cat] = (scores[cat] || 0) + weight;
    (reasons[cat] = reasons[cat] || []).push(why);
  };

  for (const [re, cat, weight] of XC_RULES) {
    const m = text.match(re);
    if (m) add(cat, weight, m[0].slice(0, 40));
  }
  for (const [cat, weight, why] of xcShapeScores(text)) add(cat, weight, why);

  const threshold = (XC_THRESHOLDS[settings.sensitivity] || XC_THRESHOLDS.balanced).score;
  let best = null;
  for (const cat of Object.keys(scores)) {
    if (!settings.categories[cat]) continue;
    if (scores[cat] >= threshold && (!best || scores[cat] > best.score)) {
      best = { category: cat, score: scores[cat], reason: reasons[cat].join(", ") };
    }
  }
  return best;
}

function xcMergeSettings(stored) {
  const s = stored || {};
  return {
    ...XC_DEFAULTS,
    ...s,
    categories: { ...XC_DEFAULTS.categories, ...(s.categories || {}) },
    allowlist: Array.isArray(s.allowlist) ? s.allowlist : [],
  };
}

async function xcLoadSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return xcMergeSettings(settings);
}
