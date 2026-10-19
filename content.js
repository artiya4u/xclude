// Scans the X timeline, hides posts that match the filters, and leaves a "show" placeholder.

const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const PLACEHOLDER_CLASS = "xclude-placeholder";

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
  const prev = article.previousElementSibling;
  if (prev && prev.classList.contains(PLACEHOLDER_CLASS)) prev.remove();
  article.classList.remove("xclude-hidden");
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
    hideTweet(article, hit.category, hit.reason, "rules");
    return;
  }

  if (!settings.apiKey) return;

  const gen = generation;
  const result = await classifyWithAI(text, quoted);
  if (gen !== generation || article.dataset.xcKey !== key || !result) return;

  let minConfidence = (XC_THRESHOLDS[settings.sensitivity] || XC_THRESHOLDS.balanced).confidence;
  // Genuine questions look similar to trivial ones, so be pickier about hiding these.
  if (result.label === "question") minConfidence = Math.max(minConfidence, 0.8);
  if (settings.categories[result.label] && result.confidence >= minConfidence) {
    hideTweet(article, result.label, `confidence ${result.confidence.toFixed(2)}`, "AI");
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
      if (article) processTweet(article);
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
