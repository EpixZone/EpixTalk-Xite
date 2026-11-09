# Epix Talk

Decentralized forum with xID identity on [EpixNet](https://epixnet.io).

## Features

- Topic threads with groups and categories
- Markdown support with syntax highlighting
- xID-authenticated user profiles
- Upvote system for topics and comments
- Admin/moderator roles with report queue
- Inline content editing for authors
- Newsfeed subscriptions
- 10 language translations

## Structure

```
epix1talk58lw26c0cyrtuu8axptne2p6zf33s7xxwu/
├── index.html
├── content.json
├── dbschema.json          # EpixTalk DB (v2)
├── LICENSE                # MIT
├── css/
│   └── all.css            # Bundled stylesheet
├── js/
│   ├── EpixTalk.js        # Main app (extends EpixFrame)
│   ├── TopicList.js       # Topic listing and groups
│   ├── TopicShow.js       # Topic detail + comments
│   ├── User.js            # xID auth and voting
│   ├── UserProfile.js     # User profile pages
│   ├── Admin.js           # Moderation panel
│   ├── lib/               # jQuery, EpixFrame, marked, highlight
│   └── utils/             # LogMixin, Text, Time, Translate, etc.
├── languages/             # da, fa, fr, hu, it, pl, sk, uk, zh, zh-tw
└── data-default/
    └── users/
        └── content-default.json
```

## Database

- **File:** `data/users/epix_talk.db`
- **Tables:** `topic`, `topic_vote`, `comment`, `comment_vote`, `report`

## Tech Stack

- Vanilla ES6 JavaScript (no build step)
- jQuery + plugins
- EpixFrame WebSocket bridge
- marked.js + highlight.js
- All JS wrapped in IIFEs

## License

MIT

## Regression checks

Run the dependency-free checks with Node.js 22.13 or newer:

```sh
node --test tests/*.test.cjs
```

The browser checks use Chromium, the real page scripts, and controlled EpixFrame
responses. Install Playwright outside the site, then point the tests at it:

```sh
export EPIX_BROWSER_TEST_TOOLS=/path/to/node_modules
export EPIX_CHROMIUM_PATH=/path/to/chromium
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$EPIX_CHROMIUM_PATH"
node --test tests/editor-controls.browser.cjs tests/avatar-refresh.browser.cjs
node tests/branding-browser.cjs
```

The checks cover repeated editing, query completion order, delete confirmation
and failures, avatars during sync, empty and nested groups, admin signing,
branding persistence and retries, and mobile light/dark layouts. The color tests
check OKLab lightness, sRGB gamut, and accent text contrast across hues.
