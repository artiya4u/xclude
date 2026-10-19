// Scans the X timeline, hides posts that match the filters, and leaves a "show" placeholder.

const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const PLACEHOLDER_CLASS = "xclude-placeholder";
const TAG_CLASS = "xclude-tag"; // fallback bar above the post
const PILL_CLASS = "xclude-pill"; // inline pill in the author name row
const labelled = new WeakMap(); // article -> { category, reason, source }, so the pill can be restored

// Simple 24x24 stroke icons (Lucide-style): [element, attributes] lists per category.
const ICONS = {
  ragebait: [["path", { d: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" }]],
  clickbait: [
    ["path", { d: "M14 4.1 12 6" }],
    ["path", { d: "m5.1 8-2.9-.8" }],
    ["path", { d: "m6 12-1.9 2" }],
    ["path", { d: "M7.2 2.2 8 5.1" }],
    ["path", { d: "M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" }],
  ],
  influencer: [
    ["path", { d: "m3 11 18-5v12L3 14v-3z" }],
    ["path", { d: "M11.6 16.8a3 3 0 1 1-5.8-1.6" }],
  ],
  engagement: [
    ["path", { d: "m17 2 4 4-4 4" }],
    ["path", { d: "M3 11v-1a4 4 0 0 1 4-4h14" }],
    ["path", { d: "m7 22-4-4 4-4" }],
    ["path", { d: "M21 13v1a4 4 0 0 1-4 4H3" }],
  ],
  question: [
    ["circle", { cx: 12, cy: 12, r: 10 }],
    ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
    ["path", { d: "M12 17h.01" }],
  ],
};

function makeIcon(category) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const [tag, attrs] of ICONS[category] || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

let settings = XC_DEFAULTS;
let generation = 0; // bumped on settings change so in-flight AI results for old settings are dropped

// The author's own text, and the text of a quoted post if there is one.
// A quoted post renders inside a role="link" card within the article; the author's text does not.
function getTweetTexts(article) {
  const els = [...article.querySelectorAll('[data-testid="tweetText"]')];
  const main = els.find((el) => !el.closest('[role="link"]'));
  const quoted = els.find((el) => el !== main && el.closest('[role="link"]'));
  return { text: main ? main.innerText : "", quoted: quoted ? quoted.innerText : "" };
}

function getTweetHandle(article) {
  const link = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
  return link ? link.getAttribute("href").slice(1).split("/")[0].toLowerCase() : "";
}

function getTweetKey(article) {
  const link = article.querySelector('a[href*="/status/"] time')?.closest("a");
  const href = link ? link.getAttribute("href") : "";
  const { text, quoted } = getTweetTexts(article);
  return href || xcNormalize(text || quoted).slice(0, 80);
}

function removePlaceholder(article) {
  labelled.delete(article);
  article.querySelectorAll(`.${PILL_CLASS}`).forEach((el) => el.remove());
  const prev = article.previousElementSibling;
  if (prev && (prev.classList.contains(PLACEHOLDER_CLASS) || prev.classList.contains(TAG_CLASS))) prev.remove();
  article.classList.remove("xclude-hidden");
}

// Label mode: keep the post visible and add a colored category pill.
// The pill is a fixed-height flex item in the header row (shorter than the row), so the card never resizes.
function buildPill(category, reason, source) {
  const pill = document.createElement("span");
  pill.style.setProperty("--xc", XC_COLORS[category] || "#71767b");
  pill.title = `${source}: ${reason}`;
  pill.append(makeIcon(category), document.createTextNode(XC_CATEGORIES[category] || category));
  return pill;
}

function insertPill(article, info) {
  const userName = article.querySelector('[data-testid="User-Name"]');
  if (!userName) return false;
  const pill = buildPill(info.category, info.reason, info.source);
  pill.className = PILL_CLASS;

  // Preferred spot: in the header row, just before the Grok icon / "..." menu on the right.
  const anchor = article.querySelector('[aria-label*="grok" i]') || article.querySelector('[data-testid="caret"]');
  if (anchor && !userName.contains(anchor)) {
    // Climb to the header row that holds both the author name and the action buttons.
    let item = anchor;
    while (item.parentElement && !item.parentElement.contains(userName)) item = item.parentElement;
    const header = item.parentElement;
    if (header && header !== article) {
      header.insertBefore(pill, item);
      return true;
    }
  }

  // Fallback: next to the display name.
  (userName.firstElementChild || userName).append(pill);
  return true;
}

function tagTweet(article, category, reason, source) {
  removePlaceholder(article);

  const info = { category, reason, source };
  if (insertPill(article, info)) {
    labelled.set(article, info);
  } else {
    // Header not found (X changed its markup): fall back to a bar above the post.
    const bar = document.createElement("div");
    bar.className = TAG_CLASS;
    bar.append(buildPill(category, reason, source));
    article.before(bar);
  }
  chrome.runtime.sendMessage({ type: "hidden", category }).catch(() => {});
}

// React may re-render the header and drop the pill; put it back.
function restorePill(article) {
  const info = labelled.get(article);
  if (info && !article.querySelector(`.${PILL_CLASS}`)) insertPill(article, info);
}

function flagTweet(article, category, reason, source) {
  if (settings.mode === "label") tagTweet(article, category, reason, source);
  else hideTweet(article, category, reason, source);
}

function hideTweet(article, category, reason, source) {
  removePlaceholder(article);

  const bar = document.createElement("div");
  bar.className = PLACEHOLDER_CLASS;

  const label = document.createElement("span");
  label.textContent = `Hidden by X-Clude: ${XC_CATEGORIES[category] || category}`;
  label.title = `${source}: ${reason}`;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Show";
  button.addEventListener("click", () => {
    const hidden = article.classList.toggle("xclude-hidden");
    bar.classList.toggle("xclude-open", !hidden);
    button.textContent = hidden ? "Show" : "Hide";
  });

  bar.append(label, button);
  article.before(bar);
  article.classList.add("xclude-hidden");
  chrome.runtime.sendMessage({ type: "hidden", category }).catch(() => {});
}

function classifyWithAI(text, quoted) {
  return chrome.runtime
    .sendMessage({ type: "classify", text, quoted })
    .then((res) => (res && res.ok ? res.result : null))
    .catch(() => null);
}

// Posts too short to classify meaningfully (links, mentions, emoji and whitespace don't count).
const MIN_AI_CHARS = 12;
function worthClassifying(text) {
  return text.replace(/https?:\/\/\S+|@\w+|\p{Extended_Pictographic}|\s+/gu, "").length >= MIN_AI_CHARS;
}

// Only spend an AI call on posts the user is about to see: X loads many more than get scrolled to.
const visibilityCallbacks = new WeakMap();
const visibilityObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      visibilityObserver.unobserve(entry.target);
      const run = visibilityCallbacks.get(entry.target);
      visibilityCallbacks.delete(entry.target);
      run?.();
    }
  },
  { rootMargin: "600px 0px" }
);

function whenNearViewport(article, run) {
  visibilityCallbacks.set(article, run);
  visibilityObserver.observe(article);
}

async function processTweet(article) {
  const key = getTweetKey(article);
  if (!key || article.dataset.xcKey === key) return;
  article.dataset.xcKey = key;
  removePlaceholder(article);

  if (!settings.enabled) return;

  const { text, quoted } = getTweetTexts(article);
  if (!text && !quoted) return;

  const handle = getTweetHandle(article);
  if (handle && settings.allowlist.includes(handle)) return;

  // Rules look at the author's own words only, never the quoted post.
  const hit = text ? xcHeuristic(text, settings) : null;
  if (hit) {
    flagTweet(article, hit.category, hit.reason, "rules");
    return;
  }

  // Cost controls: no AI call for quote-only posts, tiny posts, or posts that haven't come near the screen.
  if (!settings.apiKey || !text || !worthClassifying(text)) return;

  const gen = generation;
  whenNearViewport(article, async () => {
    if (gen !== generation || article.dataset.xcKey !== key) return;
    const result = await classifyWithAI(text, quoted);
    if (gen !== generation || article.dataset.xcKey !== key || !result) return;
    applyAIResult(article, result);
  });
}

function applyAIResult(article, result) {
  let minConfidence = (XC_THRESHOLDS[settings.sensitivity] || XC_THRESHOLDS.balanced).confidence;
  // Genuine questions look similar to trivial ones, so be pickier about hiding these.
  if (result.label === "question") minConfidence = Math.max(minConfidence, 0.8);
  if (settings.categories[result.label] && result.confidence >= minConfidence) {
    flagTweet(article, result.label, `confidence ${result.confidence.toFixed(2)}`, "AI");
  }
}

function scan(root) {
  if (root.matches?.(TWEET_SELECTOR)) processTweet(root);
  root.querySelectorAll?.(TWEET_SELECTOR).forEach(processTweet);
}

function rescanAll() {
  generation++;
  document.querySelectorAll(TWEET_SELECTOR).forEach((article) => {
    delete article.dataset.xcKey;
    removePlaceholder(article);
  });
  scan(document);
}

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
    // X reuses article elements when the virtual list recycles; re-check on text changes.
    if (m.type === "characterData" || m.type === "childList") {
      const article = m.target.parentElement?.closest?.(TWEET_SELECTOR);
      if (article) {
        processTweet(article);
        restorePill(article);
      }
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    settings = xcMergeSettings(changes.settings.newValue);
    rescanAll();
  }
});

xcLoadSettings().then((loaded) => {
  settings = loaded;
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scan(document);
});
