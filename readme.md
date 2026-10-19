# X-Clude - X post filter extension for safer discussion.

An X.com Chrome Extension to hide ragebait/clickbait/influencer/engagement farming posts using typesafe.ai Jev.

## Install (development)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open x.com. Matching posts are collapsed with a **Show** button.

No build step. Click the toolbar icon for the on/off switch and hidden-post counts; open **Settings** to pick categories, sensitivity, and an allowlist of handles.

## How it works

- `shared.js` – settings and the local rule engine (phrase and shape scoring per category: ragebait, clickbait, influencer, engagement, and trivial reply-farming questions in Thai and English).
- `content.js` – watches the timeline, hides matching posts, leaves a placeholder.
- `background.js` – optional AI classification with [Jev](https://docs.typesafe.ai/introduction) (`POST https://api.typesafe.ai/v1/systemone`, one `choice` question per post: ok / ragebait / clickbait / influencer / engagement). Paste your TypeSafe API key in Settings; it's the only AI setting. Without a key everything stays local. Only post text is sent.
