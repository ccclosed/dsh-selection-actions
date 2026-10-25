/**
 * dsh-selection-actions — client half.
 *
 * Adds, to the DSH Web GUI:
 *  1. a mini toolbar next to a non-empty text selection in the conversation
 *     ("Add to chat" / "Add in side chat");
 *  2. reference chips inserted into the current session composer (the chip is
 *     serialized into the outgoing prompt as a quote when the message is sent);
 *  3. a per-composer counter of this plugin's chips ("N conversation selections").
 *
 * Verified against an installed harness on 2026-10-25; the authoritative
 * sources are the shipped Client packages of the profile (@deepseek-ai/*):
 *  - insert path: dsh-client-ui-conversation/lib/client.js:15309 (`insertReference(ref, span)`,
 *    phase + draftRev guards) and :14536 (`$replaceDetectSpanWithNodes` — a collapsed
 *    span inserts the chip node plus a separating space);
 *  - live draft state: dsh-client-ui-conversation/lib/client.js:15396 (`this.state.getSnapshot()`);
 *  - composer dock owner props: dsh-client-ui-conversation/lib/client.js:17779 (`zone = { session, input }`)
 *    rendered at :17842 (`renderSlot("conversation.input.dock", zone)`);
 *  - session of the selection: the conversation body carries `data-conversation-session`
 *    (dsh-client-ui-conversation/lib/client.js:17867);
 *  - trigger sources: dsh-client-ui-input-trigger/lib/types/types.d.ts (InputTriggerSource) and
 *    dsh-client-ui-input-trigger/lib/types/client/contract.d.ts (`ctx.inputTriggers.registerSource`);
 *  - draft attachment type: dsh-client-ui-conversation/lib/types/client/contract/draft-editor.d.ts
 *    (ReferenceInsert, Occurrence);
 *  - side chat: dsh-client-ui-workspace/lib/types/client/navigation.d.ts:11
 *    (`ctx.uiWorkspace.startSession(workspaceId?, { prompt })`).
 */
window.__ModuleLoader__.load({
  id: 'dsh-selection-actions',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin (dictionaries live here, not in locale/*.json). */
    const NS = 'selection-actions';
    /** Trigger-source name (must be unique per trigger character). */
    const SOURCE = 'selection';
    /** Marker written on the composer-dock zone element (own DOM only). */
    const ZONE_ATTR = 'data-dsa-zone';
    /** Marker written on the floating panel (used to ignore clicks inside it). */
    const PANEL_ATTR = 'data-dsa-panel';
    /** Prefix of a self-contained, reload-safe reference id. */
    const REF_PREFIX = 'dsasel1_';
    const LABEL_MAX = 64;
    const CLIPBOARD_MAX = 32;
    const TEXT_MAX = 4000;
    const FLASH_MS = 1400;

    const DICT_EN = {
      'toolbar.label': 'Selection actions',
      'action.addToChat': 'Add to chat',
      'action.addInSideChat': 'Add in side chat',
      'counter.one': '{n} conversation selection',
      'counter.many': '{n} conversation selections',
      'counter.hint': 'These fragments become a quote in your message. Remove them with the cross or with Backspace in the composer.',
      'counter.remove': 'Remove the selected fragments',
      'info.added': 'Added to chat',
      'info.already': 'Already added',
      'info.openingSideChat': 'Opening a side chat…',
      'info.sideChatOpened': 'Opened in a side chat',
      'error.noSession': 'Could not resolve the conversation for this selection',
      'error.insert': 'The draft changed — try again',
      'error.busy': 'The composer is busy right now — try again in a moment',
      'error.sideChat': 'Side chat is unavailable',
      'quote.label': 'fragment from the conversation',
      'quote.source': 'Quote from the conversation',
    };

    const DICT_RU = {
      'toolbar.label': 'Действия с выделением',
      'action.addToChat': 'Добавить в чат',
      'action.addInSideChat': 'Добавить в боковой чат',
      'counter.one': '{n} фрагмент из переписки',
      'counter.few': '{n} фрагмента из переписки',
      'counter.many': '{n} фрагментов из переписки',
      'counter.hint': 'Эти фрагменты станут цитатой в сообщении. Убираются крестиком или клавишей Backspace в композере.',
      'counter.remove': 'Убрать выбранные фрагменты',
      'info.added': 'Добавлено в чат',
      'info.already': 'Уже добавлено',
      'info.openingSideChat': 'Открываю боковой чат…',
      'info.sideChatOpened': 'Открыто в боковом чате',
      'error.noSession': 'Не удалось определить разговор для этого выделения',
      'error.insert': 'Черновик изменился — попробуйте ещё раз',
      'error.busy': 'Композер сейчас занят — попробуйте через мгновение',
      'error.sideChat': 'Боковой чат недоступен',
      'quote.label': 'фрагмент из переписки',
      'quote.source': 'Цитата из переписки',
    };

    const CSS = [
      '.dsa-panel{position:fixed;z-index:2200;display:flex;align-items:center;gap:2px;',
      'padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);',
      'font-size:13px;line-height:1.2;max-width:calc(100vw - 16px);pointer-events:auto;',
      'box-sizing:border-box;}',
      '.dsa-btn{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:transparent;',
      'border:0;border-radius:7px;padding:6px 10px;cursor:pointer;white-space:nowrap;}',
      '.dsa-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsa-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.dsa-flash{padding:0 8px;font-size:12px;white-space:nowrap;color:var(--dsw-alias-state-success-primary);}',
      '.dsa-flash-error{color:var(--dsw-alias-state-error-primary);}',
      // The strip takes the composer card's exact geometry and overlaps its top
      // edge by a few pixels: the reserved band is padding only, so the two
      // surfaces read as one block while the strip stays in a renderable seat.
      '[data-composer-card]{transition:padding-top 160ms cubic-bezier(.22,.8,.24,1);}',
      '.dsa-strip{animation:dsa-pop-in 160ms cubic-bezier(.22,.8,.24,1) both;box-sizing:border-box;',
      'display:inline-flex;flex-direction:column;align-items:flex-start;position:relative;z-index:2;',
      'width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance)',
      ' - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));',
      'max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));',
      'margin:0 auto -6px;padding:0 var(--dsh-composer-dock-inset);}',
      '.dsa-strip-row{display:inline-flex;align-items:center;gap:4px;padding:5px 8px;',
      'border-radius:var(--dsw-radius-panel) var(--dsw-radius-panel) 0 0;',
      'background:var(--dsw-specific-input-major);box-shadow:none;max-width:100%;}',
      '.dsa-chip{display:inline-flex;align-items:center;gap:7px;padding:3px 8px;border:0;',
      'border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:12px;line-height:1.35;cursor:default;}',
      '.dsa-chip{transition:background-color 120ms ease;}',
      '.dsa-chip:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dsa-chip-glyph{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1;}',
      '.dsa-chip-label{white-space:nowrap;}',
      '.dsa-chip-remove{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;',
      'padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);',
      'font:inherit;font-size:13px;line-height:1;cursor:pointer;}',
      '.dsa-chip-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      // Hover popover: the citation text lives here, not in the draft.
      '.dsa-pop{position:absolute;bottom:calc(100% + 6px);left:0;z-index:6;display:flex;flex-direction:column;',
      'gap:6px;min-width:300px;max-width:min(560px,calc(100vw - 64px));max-height:42vh;overflow-y:auto;',
      'padding:8px;border-radius:var(--dsw-radius-panel);background:var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1));',
      'box-shadow:var(--dsw-elevation-panel, var(--dsw-elevation-soft));}',
      // Motion: the popover slides out of the strip and eases back on close.
      '@keyframes dsa-pop-in{from{opacity:0;transform:translateY(8px) scale(.985);}',
      'to{opacity:1;transform:translateY(0) scale(1);}}',
      '.dsa-pop{animation:dsa-pop-in 170ms cubic-bezier(.22,.8,.24,1) both;}',
      '.dsa-panel{animation:dsa-pop-in 140ms cubic-bezier(.22,.8,.24,1) both;}',
      '@media (prefers-reduced-motion: reduce){.dsa-pop,.dsa-panel{animation:none;}}',
      '.dsa-pop-card{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);',
      'background:var(--dsw-alias-bg-layer-2);font-size:13px;line-height:1.45;}',
      '.dsa-pop-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.4;padding:0 2px;}',
      // Our chips carry no label; the host still paints them, so hide exactly those.
      '[data-composer-card] [class*="_chip"]:has([class*="_label"]:empty){display:none;}',
      '.dsa-quote{display:flex;gap:8px;align-items:flex-start;margin:6px 0;padding:8px 10px;',
      'border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-state-business-primary);',
      'border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);',
      'color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45;box-sizing:border-box;}',
      '.dsa-quote-glyph{flex:none;color:var(--dsw-alias-label-tertiary);line-height:1.2;font-size:14px;}',
      // The host paints inline reference chips with the business token; a citation
      // chip reads as neutral text, so neutralise it inside the composer card only.
      '[data-composer-card] [class*="_chip"]{color:var(--dsw-alias-label-primary) !important;}',
      '.dsa-quote-body{min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.dsa-pop-card .dsa-quote-text{display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;}',
      '.dsa-quote-text{white-space:pre-wrap;word-break:break-word;}',
      '.dsa-quote-source{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.3;}',
    ].join('');

    // ---------------------------------------------------------------- text utils

    function collapseText(value) {
      return String(value === undefined || value === null ? '' : value).replace(/\s+/gu, ' ').trim();
    }

    function clip(value, max) {
      const text = collapseText(value);
      return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
    }

    function elementOf(node) {
      if (!node) return null;
      if (node.nodeType === 1) return node;
      return node.parentElement || null;
    }

    function closestSafe(element, selector) {
      if (!element || typeof element.closest !== 'function') return null;
      try {
        return element.closest(selector);
      } catch (error) {
        return null;
      }
    }

    function preventDefault(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    }

    // ------------------------------------------------------------- ref codec
    // The ref is self-contained (base64url over JSON) so a persisted draft keeps
    // working after a page reload, with no plugin memory involved.

    function toBase64Url(value) {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
      return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
    }

    function fromBase64Url(value) {
      const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
      const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return new TextDecoder().decode(bytes);
    }

    function encodeRef(text, origin) {
      return REF_PREFIX + toBase64Url(JSON.stringify({
        t: String(text).slice(0, TEXT_MAX),
        m: typeof origin === 'string' && origin !== '' ? origin : 'conversation',
      }));
    }

    function decodeRef(ref) {
      if (typeof ref !== 'string' || ref.indexOf(REF_PREFIX) !== 0) return undefined;
      try {
        const parsed = JSON.parse(fromBase64Url(ref.slice(REF_PREFIX.length)));
        if (!parsed || typeof parsed.t !== 'string') return undefined;
        return {
          text: parsed.t,
          origin: typeof parsed.m === 'string' ? parsed.m : 'conversation',
        };
      } catch (error) {
        return undefined;
      }
    }

    /** Clipboard / persisted projection of one of our chips (never the model form). */
    function clipboardFor(ref) {
      const decoded = decodeRef(ref);
      return '[selection: ' + clip(decoded === undefined ? '' : decoded.text, CLIPBOARD_MAX) + ']';
    }

    /** Model-facing serialization: a markdown quote. */
    function quoteFor(ref, t) {
      const decoded = decodeRef(ref);
      if (decoded === undefined) return '';
      const body = decoded.text
        .replace(/\r\n?/gu, '\n')
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n');
      // The trailing blank line terminates the blockquote: text the user types
      // right after the chip starts a new paragraph instead of joining the last
      // quoted line (which would make their own words read as a citation).
      return '> ' + t('quote.label') + ':\n' + body + '\n\n';
    }

    /**
     * Locate the next sent citation block produced by {@link quoteFor}.
     *
     * The model-facing text of a citation stays a readable blockquote; this
     * matcher only lets the transcript present that block as a card, so the
     * reader never sees the raw `> …` lines while the model still receives
     * plain quotable text.
     * @param text - complete original message text.
     * @param from - inclusive start offset to search from.
     * @returns the block span and its display data, or undefined.
     */
    function nextQuoteBlock(text, from) {
      const headers = [DICT_EN['quote.label'], DICT_RU['quote.label']];
      let start = -1;
      for (const header of headers) {
        const needle = '> ' + header + ':';
        let at = text.indexOf(needle, from);
        while (at !== -1) {
          // The chip is inserted inline, so the block may follow ordinary text
          // on the same line; only a token boundary is required.
          const before = at === 0 ? '' : text.charAt(at - 1);
          const boundary = before === '' || /\s/u.test(before);
          if (boundary && (start === -1 || at < start)) start = at;
          at = text.indexOf(needle, at + 1);
        }
      }
      if (start === -1) return undefined;
      const headerEnd = text.indexOf('\n', start);
      let end = headerEnd === -1 ? text.length : headerEnd;
      const body = [];
      while (end < text.length) {
        const nextBreak = text.indexOf('\n', end + 1);
        const lineEnd = nextBreak === -1 ? text.length : nextBreak;
        const line = text.slice(end + 1, lineEnd);
        if (line !== '>' && line.slice(0, 2) !== '> ') break;
        body.push(line === '>' ? '' : line.slice(2));
        end = lineEnd;
      }
      const excerpt = body.join('\n').trim();
      if (excerpt === '') return undefined;
      return { start: start, end: end, data: { excerpt: excerpt } };
    }

    // ------------------------------------------------------------ zone registry
    // One live entry per session-scoped composer-dock zone; the root-scoped
    // overlay resolves its target session through this registry (and through the
    // conversation region attribute) without reading another plugin's DOM.

    const zones = new Map();
    const zoneListeners = new Set();
    let lastActiveSessionId = null;

    function notifyZones() {
      for (const listener of [...zoneListeners]) {
        try {
          listener();
        } catch (error) {
          console.error('dsh-selection-actions: zone listener failed', error);
        }
      }
    }

    function subscribeZones(listener) {
      zoneListeners.add(listener);
      return () => zoneListeners.delete(listener);
    }

    // --------------------------------------------------------- selection probing

    function countSelections(state) {
      if (!state || typeof state !== 'object') return 0;
      const occurrences = state.occurrences;
      if (!occurrences || typeof occurrences.length !== 'number') return 0;
      let count = 0;
      for (let index = 0; index < occurrences.length; index++) {
        const occurrence = occurrences[index];
        if (!occurrence || occurrence.source !== SOURCE) continue;
        if (typeof occurrence.ref !== 'string' || occurrence.ref.indexOf(REF_PREFIX) !== 0) continue;
        count++;
      }
      return count;
    }

    /**
     * End offset of the draft in the editor's DETECT coordinates.
     *
     * `state.draft` is the clipboard projection: every reference chip expands
     * to its full `clipboardText` there, while the editor projects the same chip
     * as ONE placeholder character. A span built from the raw draft length
     * therefore overshoots as soon as the draft holds any chip, the span stops
     * mapping, and the insertion is refused — the reason a second selection
     * could not be added.
     * @param state - live InputState of the target composer.
     * @returns offset at the end of the draft in detect coordinates.
     */
    function detectLength(state) {
      if (!state || typeof state.draft !== 'string') return 0;
      let shrink = 0;
      const occurrences = state.occurrences;
      if (occurrences && typeof occurrences.length === 'number') {
        for (let index = 0; index < occurrences.length; index++) {
          const occurrence = occurrences[index];
          if (!occurrence) continue;
          const projected = typeof occurrence.clipboardText === 'string' ? occurrence.clipboardText.length : 0;
          if (projected > 1) shrink += projected - 1;
        }
      }
      return Math.max(0, state.draft.length - shrink);
    }

    /**
     * Rebuild the draft text without this plugin's chips.
     * @param state - live InputState.
     * @returns the remaining text and whether foreign chips (which the removal
     *          cannot preserve as chips) are present.
     */
    function stripOwnChips(state) {
      if (!state || typeof state.draft !== 'string') return { text: '', foreign: false };
      const occurrences = Array.isArray(state.occurrences) ? state.occurrences.slice() : [];
      occurrences.sort((left, right) => right.offset - left.offset);
      let text = state.draft;
      let foreign = false;
      for (const occurrence of occurrences) {
        if (!occurrence) continue;
        if (occurrence.source !== SOURCE) {
          foreign = true;
          continue;
        }
        text = text.slice(0, occurrence.offset) + text.slice(occurrence.offset + occurrence.length);
      }
      return { text: text.replace(/[ \t]+$/u, ''), foreign: foreign };
    }

    /**
     * Display data of this plugin's chips currently in the draft, in draft order.
     * @param state - live InputState.
     * @returns the decoded citation texts.
     */
    function selectionItems(state) {
      if (!state || !Array.isArray(state.occurrences)) return [];
      const items = [];
      for (const occurrence of state.occurrences) {
        if (!occurrence || occurrence.source !== SOURCE) continue;
        if (typeof occurrence.ref !== 'string' || occurrence.ref.indexOf(REF_PREFIX) !== 0) continue;
        const decoded = decodeRef(occurrence.ref);
        items.push({ text: decoded === undefined ? '' : decoded.text });
      }
      return items;
    }

    function isEditableOrPanelNode(node) {
      let element = elementOf(node);
      while (element !== null && element !== document.documentElement) {
        const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (element.isContentEditable === true) return true;
        if (typeof element.hasAttribute === 'function' && element.hasAttribute(PANEL_ATTR)) return true;
        element = element.parentElement;
      }
      return false;
    }

    function selectionIsBlocked(range) {
      return isEditableOrPanelNode(range.startContainer) || isEditableOrPanelNode(range.endContainer);
    }

    /** Depth of the lowest common ancestor: smaller means "closer to the anchor". */
    function meetingDepth(anchor, marker) {
      const chain = new Map();
      let node = anchor;
      let distance = 0;
      while (node !== null) {
        chain.set(node, distance);
        node = node.parentElement;
        distance++;
      }
      let cursor = marker;
      let steps = 0;
      while (cursor !== null) {
        if (chain.has(cursor)) return chain.get(cursor) + steps;
        cursor = cursor.parentElement;
        steps++;
      }
      return Number.MAX_SAFE_INTEGER;
    }

    /** Session of the enclosing conversation region (host-provided DOM contract). */
    function sessionFromRegion(range) {
      const anchor = elementOf(range.startContainer);
      const region = closestSafe(anchor, '[data-conversation-session]');
      if (region === null) return undefined;
      const id = region.getAttribute('data-conversation-session');
      return typeof id === 'string' && id !== '' ? id : undefined;
    }

    /** Fallback: nearest ancestor that contains one of our own zone markers. */
    function sessionFromOwnMarkers(range) {
      const anchor = elementOf(range.startContainer);
      if (anchor === null) return undefined;
      let element = anchor;
      while (element !== null && element !== document.documentElement) {
        if (typeof element.querySelectorAll === 'function') {
          const markers = element.querySelectorAll('[' + ZONE_ATTR + ']');
          if (markers.length > 0) {
            let best;
            let bestDepth = -1;
            for (let index = 0; index < markers.length; index++) {
              const id = markers[index].getAttribute(ZONE_ATTR);
              if (typeof id !== 'string' || id === '') continue;
              const depth = meetingDepth(anchor, markers[index]);
              if (best === undefined || depth < bestDepth) {
                best = id;
                bestDepth = depth;
              }
            }
            if (best !== undefined) return best;
          }
        }
        element = element.parentElement;
      }
      return undefined;
    }

    function resolveSessionId(range) {
      const fromRegion = sessionFromRegion(range);
      if (fromRegion !== undefined) return fromRegion;
      const fromMarkers = sessionFromOwnMarkers(range);
      if (fromMarkers !== undefined) return fromMarkers;
      if (zones.size === 1) {
        const only = zones.keys().next();
        if (!only.done) return only.value;
      }
      // Attribution is a convenience, not a gate: a mounted composer already
      // tells us which conversation the reader is looking at.
      if (lastActiveSessionId !== null) return lastActiveSessionId;
      return undefined;
    }

    // ------------------------------------------------------------------ plugin

    const inject = ['conversation', 'inputTriggers', 'locale', 'sessions', 'slots', 'uiConversation'];

    function apply(ctx) {
      ctx.effect(() => {
        const disposers = [];
        try {
          if (ctx.locale && typeof ctx.locale.register === 'function') {
            disposers.push(ctx.locale.register(NS, 'en', DICT_EN));
            disposers.push(ctx.locale.register(NS, 'ru', DICT_RU));
          }
        } catch (error) {
          console.error('dsh-selection-actions: locale registration failed', error);
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose();
            } catch (error) {
              /* already disposed */
            }
          }
        };
      }, 'dsh-selection-actions: dictionaries');

      let t;
      try {
        t = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : undefined;
      } catch (error) {
        t = undefined;
      }
      if (typeof t !== 'function') t = (key) => key;

      function activeLocaleId() {
        try {
          const snapshot = ctx.locale && typeof ctx.locale.getLocale === 'function' ? ctx.locale.getLocale() : undefined;
          if (snapshot && typeof snapshot.active === 'string') return snapshot.active;
        } catch (error) {
          /* fall through to the default plural rule */
        }
        return 'en';
      }

      /**
       * Pick the dictionary key for one count with the active locale's own plural
       * rules, so Russian gets 1 / 2-4 / 5+ and English gets singular / plural.
       * @param count - number of this plugin's chips in the draft.
       * @returns dictionary key.
       */
      function pluralKey(count) {
        let category = count === 1 ? 'one' : 'other';
        try {
          category = new Intl.PluralRules(activeLocaleId()).select(count);
        } catch (error) {
          /* keep the safe default */
        }
        if (category === 'one') return 'counter.one';
        if (category === 'few') return 'counter.few';
        return 'counter.many';
      }

      /**
       * Resolve a service this plugin does not hard-inject, so a profile without
       * that UI still loads the plugin and simply degrades.
       * @param name - service key.
       * @returns the service face, or undefined when the composition lacks it.
       */
      function optionalService(name) {
        try {
          const direct = ctx[name];
          if (direct !== undefined && direct !== null) return direct;
        } catch (error) {
          /* not registered on this context */
        }
        try {
          return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
        } catch (error) {
          return undefined;
        }
      }

      /**
       * Surface a failure on the composer the user acted on; the last-active
       * Session is only a fallback when the target cannot be resolved.
       * @param sessionId - Session whose composer receives the notice.
       * @param message - localized notice body.
       */
      function notifyError(sessionId, message) {
        try {
          const input = sessionIdToInput(sessionId) || sessionIdToInput(lastActiveSessionId);
          if (input && typeof input.notify === 'function') input.notify('error', message);
        } catch (error) {
          /* the flash inside the panel remains the primary feedback */
        }
      }

      function sessionIdToInput(sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined;
        const actx = ctx.sessions.scope(sessionId);
        if (!actx) return undefined;
        return ctx.conversation.input.for(actx);
      }

      /**
       * Insert one chip into the draft of `sessionId`.
       * @returns {{ok: boolean, reason: 'added'|'already'|'noSession'|'insert'}}
       */
      function insertSelection(sessionId, text) {
        const input = sessionIdToInput(sessionId);
        if (!input || typeof input.insertReference !== 'function') return { ok: false, reason: 'noSession' };
        const ref = encodeRef(text, 'conversation');
        const insert = {
          source: SOURCE,
          ref: ref,
          label: '',
          appearance: 'session',
          clipboardText: clipboardFor(ref),
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          let state;
          try {
            state = input.state.getSnapshot();
          } catch (error) {
            state = undefined;
          }
          if (!state || typeof state.draft !== 'string') return { ok: false, reason: 'insert' };
          // A submission in flight is not a revision race: retrying cannot help.
          if (state.phase === 'adjudicating' || state.phase === 'submitting') return { ok: false, reason: 'busy' };
          if (Array.isArray(state.occurrences)) {
            const duplicate = state.occurrences.some(
              (occurrence) => occurrence && occurrence.source === SOURCE && occurrence.ref === ref,
            );
            if (duplicate) return { ok: false, reason: 'already' };
          }
          const at = detectLength(state);
          const span = { start: at, end: at, draftRev: state.draftRev };
          let applied = false;
          try {
            applied = input.insertReference(insert, span) === true;
          } catch (error) {
            applied = false;
          }
          if (applied) return { ok: true, reason: 'added' };
        }
        return { ok: false, reason: 'insert' };
      }

      /** Canonical right-Sidebar address of one Session chat hosted beside the conversation. */
      function sideChatAddress(parentSessionId, childSessionId) {
        const query = new URLSearchParams({ parent: String(parentSessionId), mode: 'continuable' });
        return 'dsh-resource://subagentchat/session/' + encodeURIComponent(String(childSessionId)) + '?' + query;
      }

      /**
       * Stage our chip in one Session's composer, retrying while that Session's
       * conversation is still opening.
       * @param sessionId - Session whose composer receives the chip.
       * @param insert - prepared reference insertion.
       * @param attemptIndex - retry counter (internal).
       */
      function stageChipInComposer(sessionId, insert, attemptIndex) {
        const tries = attemptIndex === undefined ? 0 : attemptIndex;
        try {
          const input = sessionIdToInput(sessionId);
          if (input && typeof input.insertReference === 'function') {
            const state = input.state.getSnapshot();
            const at = detectLength(state);
            if (input.insertReference(insert, { start: at, end: at, draftRev: state.draftRev }) === true) return;
          }
        } catch (error) {
          /* the Session may still be mounting */
        }
        if (tries < 8) setTimeout(() => stageChipInComposer(sessionId, insert, tries + 1), 250);
      }

      /**
       * Open a parallel chat: fork the Session and host the copy in the right
       * Sidebar, staged with the same quote chip. Falls back to a new Session in
       * the main column when the Sidebar path is unavailable.
       * @param sessionId - Session the selection came from.
       * @param text - selected fragment.
       * @returns settlement with a localized-ready reason.
       */
      function openSideChat(sessionId, text) {
        const ref = encodeRef(text, 'conversation');
        const insert = {
          source: SOURCE,
          ref: ref,
          label: clip(text, LABEL_MAX),
          appearance: 'session',
          clipboardText: clipboardFor(ref),
        };
        const sidebarRight = optionalService('sidebarRight');
        const forked =
          typeof sessionId === 'string' && ctx.sessions && typeof ctx.sessions.fork === 'function'
            ? ctx.sessions.fork({ sessionId: sessionId, increaseTitle: true, allowMigration: false })
            : Promise.reject(new Error('fork unavailable'));
        return Promise.resolve(forked)
          .then((childId) => {
            if (typeof childId !== 'string' || childId === '') throw new Error('fork returned no Session');
            if (!sidebarRight || typeof sidebarRight.openResource !== 'function') throw new Error('right Sidebar unavailable');
            sidebarRight.openResource(sideChatAddress(sessionId, childId), {
              kind: 'subagentchat',
              preferNewPane: true,
            });
            stageChipInComposer(childId, insert);
            return { ok: true, reason: 'sideChatOpened' };
          })
          .catch((error) => {
            console.error('dsh-selection-actions: side chat in the right Sidebar failed, using a new Session', error);
            return openParallelSession(sessionId, ref);
          });
      }

      /** Fallback: a fresh Session in the same Workspace carrying the quote. */
      function openParallelSession(sessionId, ref) {
        const uiWorkspace = optionalService('uiWorkspace');
        if (!uiWorkspace || typeof uiWorkspace.startSession !== 'function') return { ok: false, reason: 'sideChat' };
        const prompt = quoteFor(ref, t);
        let workspaceId;
        try {
          const list = ctx.sessions.list.getSnapshot();
          const row = list && list.byId ? list.byId[sessionId] : undefined;
          workspaceId = row && typeof row.workspaceId === 'string' ? row.workspaceId : undefined;
        } catch (error) {
          workspaceId = undefined;
        }
        try {
          uiWorkspace.startSession(workspaceId, { prompt: prompt });
        } catch (error) {
          console.error('dsh-selection-actions: side chat failed', error);
          return { ok: false, reason: 'sideChat' };
        }
        return { ok: true, reason: 'sideChatOpened' };
      }

      // ----------------------------------------------------------------- strip
      // The strip lives INSIDE the composer card (overlay seat) and the citation
      // text lives in its hover popover — never in the draft itself.

      function createStrip() {
        function StripView(props) {
          const state = props.state !== undefined ? props.state : props.input;
          const sessionId =
            props.sessionId !== undefined && props.sessionId !== null
              ? String(props.sessionId)
              : props.session && props.session.sessionId !== undefined
                ? String(props.session.sessionId)
                : undefined;
          const anchorRef = React.useRef(null);
          /** Pointer is on the strip or its popover. */
          const [active, setActive] = React.useState(false);
          const openTimer = React.useRef(null);
          const closeTimer = React.useRef(null);
          const count = countSelections(state);
          const items = selectionItems(state);

          const clearTimers = React.useCallback(() => {
            if (openTimer.current !== null) {
              clearTimeout(openTimer.current);
              openTimer.current = null;
            }
            if (closeTimer.current !== null) {
              clearTimeout(closeTimer.current);
              closeTimer.current = null;
            }
          }, []);

          /** Hover intent: open after a beat so a passing pointer never flashes. */
          const show = React.useCallback(() => {
            clearTimers();
            openTimer.current = setTimeout(() => {
              openTimer.current = null;
              setActive(true);
            }, 80);
          }, [clearTimers]);

          /** Close after the pointer leaves, leaving room to slide back in. */
          const hideSoon = React.useCallback(() => {
            clearTimers();
            closeTimer.current = setTimeout(() => {
              closeTimer.current = null;
              setActive(false);
            }, 130);
          }, [clearTimers]);

          React.useEffect(
            () => () => {
              clearTimers();
            },
            [clearTimers],
          );

          React.useEffect(() => {
            const element = anchorRef.current;
            if (!element || sessionId === undefined) return undefined;
            const entry = { element: element };
            zones.set(sessionId, entry);
            lastActiveSessionId = sessionId;
            notifyZones();
            return () => {
              if (zones.get(sessionId) === entry) zones.delete(sessionId);
              notifyZones();
            };
          }, [sessionId]);

          React.useEffect(() => {
            if (count === 0) {
              clearTimers();
              setActive(false);
            }
          }, [count, clearTimers]);

          const actions = props.inputActions;
          const removeAll = React.useCallback(() => {
            if (!actions || typeof actions.setDraft !== 'function' || !state) return;
            const stripped = stripOwnChips(state);
            if (stripped.foreign) return;
            actions.setDraft(stripped.text);
            clearTimers();
            setActive(false);
          }, [actions, state]);

          if (count === 0) {
            // Keep the Session attribution alive without drawing anything.
            return h('span', { ref: anchorRef, hidden: true, [ZONE_ATTR]: sessionId === undefined ? '' : sessionId });
          }

          const popover = active
            ? h(
                'span',
                { className: 'dsa-pop' },
                items.map((item, index) =>
                  h(
                    'span',
                    { className: 'dsa-pop-card', key: index },
                    h('span', { className: 'dsa-quote-glyph', 'aria-hidden': 'true' }, '\u275D'),
                    h(
                      'span',
                      { className: 'dsa-quote-body' },
                      h('span', { className: 'dsa-quote-text' }, item.text),
                      h('span', { className: 'dsa-quote-source' }, t('quote.source')),
                    ),
                  ),
                ),
                h('span', { className: 'dsa-pop-hint' }, t('counter.hint')),
              )
            : null;

          return h(
            'span',
            {
              ref: anchorRef,
              className: 'dsa-strip',
              onMouseEnter: show,
              onMouseLeave: hideSoon,
              [ZONE_ATTR]: sessionId === undefined ? '' : sessionId,
            },
            h(
              'span',
              { className: 'dsa-strip-row' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsa-chip',
                  'aria-expanded': active ? 'true' : 'false',
                  title: t('counter.hint'),
                  onFocus: show,
                  onBlur: hideSoon,
                  onKeyDown: (event) => {
                    if (event.key === 'Escape') hideSoon();
                  },
                  onClick: () => {
                    if (active) hideSoon();
                    else show();
                  },
                },
                h('span', { className: 'dsa-chip-glyph', 'aria-hidden': 'true' }, '\u275D'),
                h('span', { className: 'dsa-chip-label' }, t(pluralKey(count), { n: String(count) })),
              ),
              actions && typeof actions.setDraft === 'function'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsa-chip-remove',
                      title: t('counter.remove'),
                      'aria-label': t('counter.remove'),
                      onClick: removeAll,
                    },
                    '\u00D7',
                  )
                : null,
            ),
            popover,
          );
        }

        function StripLive(props) {
          const state = props.useInput((value) => value);
          return h(StripView, Object.assign({}, props, { state: state }));
        }

        function StripStatic(props) {
          return h(StripView, props);
        }

        return function Strip(props) {
          const safeProps = props || {};
          if (typeof safeProps.useInput === 'function') return h(StripLive, safeProps);
          return h(StripStatic, safeProps);
        };
      }

      // -------------------------------------------------------------- overlay

      function createOverlay() {
        return function SelectionOverlay() {
          const [view, setView] = React.useState(null);
          const [feedback, setFeedback] = React.useState(null);
          const viewRef = React.useRef(null);
          const panelRef = React.useRef(null);
          const timerRef = React.useRef(null);
          /**
           * Deadline until which a collapsed selection must not dismiss the
           * panel: inserting a chip moves the editor selection into the
           * composer, and the resulting selectionchange would otherwise hide
           * the confirmation before the user can read it.
           */
          const pinUntilRef = React.useRef(0);
          viewRef.current = view;

          const hide = React.useCallback(() => {
            pinUntilRef.current = 0;
            setView(null);
            setFeedback(null);
          }, []);

          const scheduleHide = React.useCallback(
            (delay) => {
              if (timerRef.current !== null) clearTimeout(timerRef.current);
              timerRef.current = setTimeout(() => {
                timerRef.current = null;
                hide();
              }, delay);
            },
            [hide],
          );

          React.useEffect(
            () => () => {
              if (timerRef.current !== null) clearTimeout(timerRef.current);
            },
            [],
          );

          const evaluate = React.useCallback(() => {
            const pinned = pinUntilRef.current > Date.now();
            const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
            if (!selection || selection.rangeCount !== 1) {
              if (!pinned) hide();
              return;
            }
            const range = selection.getRangeAt(0);
            if (!range || range.collapsed) {
              if (!pinned) hide();
              return;
            }
            const text = collapseText(selection.toString());
            if (text === '') {
              hide();
              return;
            }
            if (selectionIsBlocked(range)) {
              hide();
              return;
            }
            let rect = range.getBoundingClientRect();
            if (!rect || (rect.width === 0 && rect.height === 0)) {
              const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
              rect = rects && rects.length > 0 ? rects[rects.length - 1] : null;
            }
            if (!rect || (rect.width === 0 && rect.height === 0)) {
              hide();
              return;
            }
            // Visibility must not depend on attribution: inside a conversation
            // region the panel always appears, and the Session is resolved (and
            // re-resolved on click) separately.
            const anchor = elementOf(range.startContainer);
            const inConversation = closestSafe(anchor, '[data-conversation-session]') !== null;
            if (!inConversation && zones.size === 0) {
              hide();
              return;
            }
            const sessionId = resolveSessionId(range);
            setView({
              text: text.slice(0, TEXT_MAX),
              sessionId: sessionId,
              top: rect.top,
              bottom: rect.bottom,
              centerX: rect.left + rect.width / 2,
            });
          }, [hide]);

          React.useEffect(() => {
            function onSelectionChange() {
              evaluate();
            }
            function onScroll() {
              hide();
            }
            function onResize() {
              hide();
            }
            function onKeyDown(event) {
              if (event.key === 'Escape') {
                hide();
                return;
              }
              if (event.key !== 'Tab' || viewRef.current === null) return;
              const panel = panelRef.current;
              if (panel === null) return;
              const active = document.activeElement;
              if (active !== null && typeof panel.contains === 'function' && panel.contains(active)) return;
              const first = panel.querySelector('button');
              if (first !== null) {
                event.preventDefault();
                first.focus();
              }
            }
            function onPointerDown(event) {
              const target = event.target;
              if (target !== null && typeof target.closest === 'function' && target.closest('[' + PANEL_ATTR + ']') !== null) {
                return;
              }
              hide();
            }
            document.addEventListener('selectionchange', onSelectionChange);
            document.addEventListener('pointerdown', onPointerDown, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('scroll', onScroll, true);
            window.addEventListener('resize', onResize);
            return () => {
              document.removeEventListener('selectionchange', onSelectionChange);
              document.removeEventListener('pointerdown', onPointerDown, true);
              document.removeEventListener('keydown', onKeyDown, true);
              window.removeEventListener('scroll', onScroll, true);
              window.removeEventListener('resize', onResize);
            };
          }, [evaluate, hide]);

          // A session/zone change re-evaluates: a panel left over from another
          // conversation must not survive a session switch.
          React.useEffect(
            () =>
              subscribeZones(() => {
                if (viewRef.current !== null) evaluate();
              }),
            [evaluate],
          );

          const resolveTargetSession = React.useCallback(() => {
            const current = viewRef.current;
            const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
            if (selection && selection.rangeCount === 1) {
              const range = selection.getRangeAt(0);
              if (range && !range.collapsed) {
                const sessionId = resolveSessionId(range);
                if (sessionId !== undefined) return sessionId;
              }
            }
            return current === null ? undefined : current.sessionId;
          }, []);

          const onAddToChat = React.useCallback(() => {
            const current = viewRef.current;
            if (current === null) return;
            const sessionId = resolveTargetSession();
            if (sessionId === undefined) {
              setFeedback({ text: t('error.noSession'), error: true });
              return;
            }
            const result = insertSelection(sessionId, current.text);
            if (result.ok) {
              pinUntilRef.current = Date.now() + FLASH_MS;
              setFeedback({ text: t('info.added'), error: false });
              scheduleHide(FLASH_MS);
              return;
            }
            if (result.reason === 'already') {
              pinUntilRef.current = Date.now() + FLASH_MS;
              setFeedback({ text: t('info.already'), error: false });
              scheduleHide(FLASH_MS);
              return;
            }
            const message =
              result.reason === 'noSession'
                ? t('error.noSession')
                : result.reason === 'busy'
                  ? t('error.busy')
                  : t('error.insert');
            pinUntilRef.current = Date.now() + FLASH_MS;
            setFeedback({ text: message, error: true });
            scheduleHide(FLASH_MS);
            notifyError(sessionId, message);
          }, [resolveTargetSession, scheduleHide]);

          const onAddInSideChat = React.useCallback(() => {
            const current = viewRef.current;
            if (current === null) return;
            const sessionId = resolveTargetSession();
            pinUntilRef.current = Date.now() + FLASH_MS;
            setFeedback({ text: t('info.openingSideChat'), error: false });
            Promise.resolve(openSideChat(sessionId, current.text))
              .then((result) => {
                pinUntilRef.current = Date.now() + FLASH_MS;
                setFeedback(
                  result && result.ok
                    ? { text: t('info.sideChatOpened'), error: false }
                    : { text: t('error.sideChat'), error: true },
                );
                scheduleHide(FLASH_MS);
              })
              .catch((error) => {
                console.error('dsh-selection-actions: side chat failed', error);
                pinUntilRef.current = Date.now() + FLASH_MS;
                setFeedback({ text: t('error.sideChat'), error: true });
                scheduleHide(FLASH_MS);
              });
          }, [resolveTargetSession, scheduleHide]);

          const viewportWidth = typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 1024;
          const above = view !== null && view.top - 64 >= 8;
          const left = view === null ? 0 : Math.min(Math.max(view.centerX, 132), Math.max(132, viewportWidth - 132));
          const panelStyle =
            view === null
              ? undefined
              : {
                  left: Math.round(left) + 'px',
                  top: Math.round(above ? view.top - 8 : view.bottom + 8) + 'px',
                  transform: above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
                };

          return h(
            React.Fragment,
            null,
            h('style', null, CSS),
            view === null
              ? null
              : h(
                  'div',
                  {
                    ref: panelRef,
                    className: 'dsa-panel',
                    style: panelStyle,
                    role: 'toolbar',
                    'aria-label': t('toolbar.label'),
                    'aria-orientation': 'horizontal',
                    [PANEL_ATTR]: '',
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsa-btn',
                      onMouseDown: preventDefault,
                      onClick: onAddToChat,
                    },
                    t('action.addToChat'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsa-btn',
                      onMouseDown: preventDefault,
                      onClick: onAddInSideChat,
                    },
                    t('action.addInSideChat'),
                  ),
                  feedback === null
                    ? null
                    : h(
                        'span',
                        {
                          className: feedback.error ? 'dsa-flash dsa-flash-error' : 'dsa-flash',
                          role: 'status',
                        },
                        feedback.text,
                      ),
                ),
          );
        };
      }

      // ----------------------------------------------------- trigger source

      const source = {
        trigger: '@',
        name: SOURCE,
        order: 90,
        showGroupTitle: false,
        candidates() {
          // Chips are produced by the selection panel; the '@' menu stays clean.
          return Promise.resolve([]);
        },
        onPick() {
          return undefined;
        },
        codec: {
          clipboardText(ref) {
            return clipboardFor(ref);
          },
          serialize(ref) {
            return Promise.resolve(quoteFor(ref, t));
          },
        },
      };

      ctx.effect(() => {
        const registry = ctx.inputTriggers;
        if (!registry || typeof registry.registerSource !== 'function') return () => {};
        return registry.registerSource(source);
      }, 'dsh-selection-actions: @selection source');

      // ------------------------------------------------------- transcript card
      // A sent citation is presented as a card instead of raw blockquote lines.

      function SelectionQuoteCard(props) {
        const data = (props.node && props.node.data) || {};
        const excerpt = typeof data.excerpt === 'string' ? data.excerpt : '';
        return h(
          'span',
          { className: 'dsa-quote' },
          h('span', { className: 'dsa-quote-glyph', 'aria-hidden': 'true' }, '\u275D'),
          h(
            'span',
            { className: 'dsa-quote-body' },
            h('span', { className: 'dsa-quote-text' }, excerpt),
            h('span', { className: 'dsa-quote-source' }, props.t('quote.source')),
          ),
        );
      }

      // ------------------------------------------------------------ slots

      const Strip = createStrip();
      const Overlay = createOverlay();

      ctx.effect(() => {
        const registry = ctx.uiConversation && ctx.uiConversation.userText;
        if (!registry || typeof registry.register !== 'function') return () => {};
        return registry.register({
          id: 'selection',
          order: 40,
          match(text, from) {
            const candidate = nextQuoteBlock(text, from);
            return candidate === undefined ? undefined : { id: 'selection', start: candidate.start, end: candidate.end, data: candidate.data };
          },
        });
      }, 'dsh-selection-actions: sent citation rule');

      ctx.slots.inject('conversation.user.text.node', () =>
        ctx.slots.register(
          {
            name: 'conversation.user.text.node',
            key: 'selection',
            priority: 100,
            locale: NS,
          },
          SelectionQuoteCard,
        ),
      );

      ctx.effect(
        () =>
          ctx.slots.inject('conversation.input.dock', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.dock',
                id: 'selection-strip',
                order: 60,
                label: () => t('counter.hint'),
              },
              Strip,
            ),
          ),
        'dsh-selection-actions: citation strip',
      );

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'selection-actions',
            order: 60,
            label: () => t('toolbar.label'),
          },
          Overlay,
        ),
      );
    }

    return { inject: inject, apply: apply };
  },
});