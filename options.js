const $ = (id) => document.getElementById(id);
const categoriesEl = $("categories");

for (const [key, name] of Object.entries(XC_CATEGORIES)) {
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.dataset.category = key;
  label.append(box, " " + name);
  categoriesEl.append(label);
}

async function load() {
  const s = await xcLoadSettings();
  categoriesEl.querySelectorAll("input").forEach((box) => {
    box.checked = s.categories[box.dataset.category];
  });
  $("mode").value = s.mode;
  $("sensitivity").value = s.sensitivity;
  $("allowlist").value = s.allowlist.join("\n");
  $("apiKey").value = s.apiKey;
  $("dailyLimit").value = s.dailyLimit;
}

function parseAllowlist(text) {
  return [...new Set(text.split(/[\s,]+/).map((h) => h.replace(/^@/, "").toLowerCase()).filter(Boolean))];
}

function say(msg, ok = true) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = ok ? "#00ba7c" : "#f4212e";
  setTimeout(() => (el.textContent = ""), 3000);
}

$("save").addEventListener("click", async () => {
  const current = await xcLoadSettings();
  const categories = {};
  categoriesEl.querySelectorAll("input").forEach((box) => {
    categories[box.dataset.category] = box.checked;
  });
  const dailyLimit = Number($("dailyLimit").value);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0) return say("Daily limit must be 0 or a positive whole number", false);

  await chrome.storage.local.set({
    settings: {
      ...current,
      categories,
      mode: $("mode").value,
      sensitivity: $("sensitivity").value,
      allowlist: parseAllowlist($("allowlist").value),
      apiKey: $("apiKey").value.trim(),
      dailyLimit,
    },
  });
  say("Saved");
});

load();
