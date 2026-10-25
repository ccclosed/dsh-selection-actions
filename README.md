# dsh-selection-actions

[![npm](https://img.shields.io/npm/v/dsh-selection-actions.svg)](https://www.npmjs.com/package/dsh-selection-actions)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI plugin: select any fragment of a
conversation and turn it into a citation in the message you are about to send — or open it in a parallel chat.

English | [Русский](#русский)

## What it does

1. **Selection toolbar.** Select text in the conversation and a small toolbar appears next to the selection:
   `Add to chat` and `Add in side chat`.
2. **Add to chat** stages the fragment in the current composer. The draft shows a compact
   `N conversation selections` strip with a remove control; hovering it slides out the staged citations.
   When you send, each fragment becomes a blockquote in the prompt — the model reads it as quoted context.
3. **Sent citations render as cards.** The transcript replaces the raw `> …` block with a card
   (quote glyph, excerpt, “Quote from the conversation”), so neither you nor the model sees a wall of markdown.
4. **Add in side chat** forks the current Session, opens the copy in the right Sidebar as a parallel chat and
   stages the same citation there, so follow-up questions do not pollute the main thread.

## Install

The plugin is a bundle: the Host half is empty, everything lives in the Web client. Install it with the
harness plugin manager, from this checkout or straight from GitHub:

```
# from npm
dsh plugin --profile <profile> add dsh-selection-actions

# from a local checkout
dsh plugin --profile <profile> add /path/to/dsh-selection-actions

# from this repository
dsh plugin --profile <profile> add https://github.com/ccclosed/dsh-selection-actions
```

Then reload the Web GUI page. It is a per-profile installation and survives restarts.

### Install from the plugin market (no npm account, one URL)

The repository ships a [format-1 market index](market.json), so the plugin installs from a pinned commit
without npm. Add this URL under **Settings → Plugins → Discover → index sources**:

```
https://raw.githubusercontent.com/ccclosed/dsh-selection-actions/main/market.json
```

The version it lists installs as
`git+https://github.com/ccclosed/dsh-selection-actions.git#<commit>`, so an install is always reproducible.

## How it works

- `client.js` — the whole plugin (Web client half, `window.__ModuleLoader__` module):
  - `shell.overlay` — the floating toolbar next to a selection;
  - `conversation.input.dock` — the citation strip above the composer card;
  - `conversation.input.overlay` / host slots — not used; the strip lives in the dock seat because that
    seat renders reliably while the in-card overlay seat deactivated the entry;
  - `ctx.inputTriggers.registerSource` — a reference source whose `codec.serialize` turns a chip into the
    blockquote that reaches the model;
  - `ctx.uiConversation.userText.register` + `conversation.user.text.node` — the transcript card renderer.
- `index.js` — empty Host half (`apply() {}`), so there is no Config and no Host-side settings.
- `locale/en.json`, `locale/ru.json` — only `meta` (title and description for the plugins list). Button
  labels, counter forms and tooltips are registered by `client.js` itself for both languages.

## Known limitations

- The citation strip is attached to the composer card from the dock seat (see above) and overlaps its top
  edge by a few pixels rather than being a child of the card.
- The remove control clears this plugin’s citations only when the draft holds no foreign reference chips.
- `Add in side chat` reuses the shipped `subagentchat` Sidebar tab, so the tab title falls back to the fork’s
  Session id when the Session has no projected title yet.

## License

MIT — see [LICENSE](LICENSE).

-----

<a id="русский"></a>
## Русский

Плагин для веб-GUI DeepSeek Harness: выделяешь фрагмент переписки и превращаешь его в цитату в отправляемом
сообщении либо открываешь его в параллельном чате.

- **Add to chat** — фрагмент попадает в композер текущего чата. Над полем появляется плашка
  `N conversation selections`: по наведению из неё выезжают добавленные цитаты, крестик убирает их.
  При отправке каждый фрагмент становится блокквотом в запросе — модель читает его как цитируемый контекст.
- **Отправленная цитата рисуется карточкой** (кавычка, фрагмент, подпись «Цитата из переписки»), а не
  сырым `> …` текстом.
- **Add in side chat** — форк текущей сессии открывается отдельной вкладкой в правой панели, туда же
  подставляется цитата; основная ветка не засоряется.

Установка: `dsh plugin --profile <профиль> add /путь/к/dsh-selection-actions`, затем перезагрузить страницу.
Host-половина пустая, настроек нет; вся логика в `client.js`.