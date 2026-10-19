# X-Clude - X post filter extension for safer discussion.

An X.com Chrome Extension to hide ragebait/clickbait/influencer/engagement farming posts using typesafe.ai Jev.

## Install (development)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open x.com. Matching posts get a colored category tag (or can be collapsed behind a **Show** button, see Settings).

No build step. Click the toolbar icon for the on/off switch and flagged-post counts; open **Settings** to pick categories, sensitivity, an allowlist of handles, and the display mode: **Label** (default; keep the post visible with a colored category tag and icon) or **Hide** (collapse behind a Show button).

## How it works

- `shared.js` – settings and the local rule engine (phrase and shape scoring per category: ragebait, clickbait, influencer, engagement, and trivial reply-farming questions in Thai and English).
- `content.js` – watches the timeline, hides matching posts, leaves a placeholder.
- `background.js` – optional AI classification with [Jev](https://docs.typesafe.ai/introduction) (`POST https://api.typesafe.ai/v1/systemone`, one `choice` question per post: ok / ragebait / clickbait / influencer / engagement). Paste your TypeSafe API key in Settings; it's the only AI setting. Without a key everything stays local. Only post text is sent.

## Keeping Jev cost down

- Rules run first, so posts they catch never reach the API.
- Quote-only posts, posts under ~12 real characters, and allowlisted authors are never sent.
- A post is only classified once it is within ~600px of the screen.
- Verdicts are cached for 14 days (up to 3,000, stored as hashes of the post text), so refreshes and re-renders cost nothing.
- Posts are batched up to 5 per request (~30% fewer input tokens than one call each). Identical posts in flight share one call.
- A hard cap of 2,000 posts per day (`DAILY_POST_LIMIT` in `background.js`). The popup shows today's posts, calls, tokens and cache hits.
- Quote handling: the author's own text is judged; a quoted post and the post it quotes (two levels) are sent to Jev as context only.
