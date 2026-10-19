const enabledBox = document.getElementById("enabled");

async function save(patch) {
  const settings = await xcLoadSettings();
  await chrome.storage.local.set({ settings: { ...settings, ...patch } });
}

async function render() {
  const settings = await xcLoadSettings();
  enabledBox.checked = settings.enabled;

  const { stats } = await chrome.storage.local.get("stats");
  const s = stats || { hidden: 0, byCategory: {} };
  document.getElementById("hidden").textContent = s.hidden;

  const max = Math.max(1, ...Object.values(s.byCategory));
  const rows = Object.entries(XC_CATEGORIES)
    .filter(([key]) => settings.categories[key])
    .map(([key, name]) => {
      const n = s.byCategory[key] || 0;
      const row = document.createElement("div");
      row.className = "row" + (n ? "" : " zero");
      const label = document.createElement("span");
      label.textContent = name;
      const count = document.createElement("span");
      count.className = "n";
      count.textContent = n;
      const bar = document.createElement("div");
      bar.className = "bar";
      const fill = document.createElement("i");
      fill.style.width = `${(n / max) * 100}%`;
      bar.append(fill);
      row.append(label, count, bar);
      return row;
    });
  document.getElementById("rows").replaceChildren(...rows);
}

chrome.storage.onChanged.addListener(render);
enabledBox.addEventListener("change", () => save({ enabled: enabledBox.checked }));
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
render();
