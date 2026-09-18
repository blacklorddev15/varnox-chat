'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  IconBack,
  IconClock,
  IconEdit,
  IconPlus,
  IconSearch,
  IconSmilePlus,
  IconStar,
} from './icons';

type Mode = 'emoji' | 'gif' | 'stickers';

/** Each category carries one glyph to stand in for it on the bottom bar. */
const CATEGORIES: { id: string; label: string; icon: string; items: string[] }[] = [
  {
    id: 'smileys',
    label: 'Smileys & People',
    icon: '😀',
    items: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
      '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮',
      '😴','🤤','😪','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😯','😲','😳','🥺','😦','😧','😨',
      '😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','🤬','😈','👿','💀','💩','👋',
      '🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👉','👆','👇','☝️','👍','👎','👏','🙌',
      '🤝','🙏','💪','👀','🧠','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💖',
      '💘','💝','✨','🎉','🎊','🔥','💯',
    ],
  },
  {
    id: 'nature',
    label: 'Animals & Nature',
    icon: '🐻',
    items: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆',
      '🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🕷️','🦂','🐢','🐍','🦎','🐙','🦑',
      '🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎍','🌾','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝',
      '🌚','🌙','⭐','🌟','💫','⚡','🌈','☀️','⛅','☁️','🌧️','⛈️','❄️','☃️','💧','🌊','🌫️','🌪️','🌍','🪐',
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    icon: '🍔',
    items: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🥦',
      '🥕','🌽','🌶️','🥒','🥬','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🧀','🥚','🍳','🧇','🥞','🥓','🍔','🍟',
      '🍕','🌭','🥪','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥠','🍢',
      '🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧋','🥤','🍺',
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: '⚽',
    items: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥊','🥋','⛳',
      '🏹','🎣','🤿','🥊','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️',
      '🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️','🎪','🎭',
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Places',
    icon: '🚗',
    items: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🛺','🚲','🛴','🚨',
      '✈️','🛫','🛬','🚀','🛰️','🚁','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️',
      '🏠','🏡','🏢','🏥','🏦','🏨','🏫','🏭','⛪','🕌','🕍','🛕','🌉','🌁','🗻','🏔️','⛰️','🌋','🏝️','🏜️',
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💡',
    items: [
      '📱','💻','⌨️','🖥️','🖨️','🖱️','💽','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📠','📺','📻','🎙️',
      '⏰','⌚','📡','🔋','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','💰','💳','🧾','💎','⚖️',
      '🔧','🔨','⚒️','🛠️','⛏️','🔩','⚙️','🧱','⛓️','🧲','🔪','🗡️','🛡️','🚬','⚰️','🏺','📚','📖','📝','✏️',
      '📌','📍','📎','🖇️','📐','📏','🧮','📦','📫','📮','🗳️','✉️','📩','📨','🔒','🔑','🗝️','🔐','🧿','🎁',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '💯',
    items: [
      '✅','❌','❓','❗','🔔','🔕','⚠️','🚫','♻️','✳️','✴️','❇️','©️','®️','™️','🔟','🔠','🔡','🔤','🅰️',
      '🆎','🅱️','🆑','🆒','🆓','🆔','🆕','🆖','🅾️','🆗','🅿️','🆘','🆙','🆚','⬆️','↗️','➡️','↘️','⬇️','↙️',
      '⬅️','↖️','↕️','↔️','↩️','↪️','🔃','🔄','🔙','🔚','🔛','🔜','🔝','🛐','🕉️','✡️','☸️','☯️','✝️','☦️',
    ],
  },
];

/**
 * Sticker packs.
 *
 * There is no sticker artwork, no upload path and nowhere to store any, so these are the
 * expressive glyphs drawn large rather than images, and they send as ordinary messages. A real
 * library would need assets, storage and a render path in the bubble — a feature, not a tab.
 * The "Create sticker" tile is present for the shape of the screen and says plainly that it is
 * not available, rather than opening something that does nothing.
 */
const STICKER_PACKS: { id: string; label: string; items: string[] }[] = [
  {
    id: 'faces',
    label: 'Faces',
    items: [
      '😂','❤️','🔥','👍','🎉','😭','😍','🙏','💀','✨','🥰','😎','👀','💯','🤝','🥳',
      '😤','🫡','🤔','😴','🙌','👏','💔','🤯','🫶','😈','🤡','👻','🎯','⚡','🌟','🥺',
    ],
  },
  {
    id: 'animals',
    label: 'Animals',
    items: [
      '🐶','🐱','🦊','🐻','🐼','🐨','🦁','🐯','🐮','🐷','🐸','🐵','🐔','🐧','🦆','🦉',
      '🦄','🐝','🦋','🐢','🐍','🐙','🦑','🐠','🐬','🐳','🦈','🐊','🦖','🦕','🐘','🦒',
    ],
  },
  {
    id: 'hands',
    label: 'Hands',
    items: [
      '👋','🤚','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️',
      '👍','👎','✊','👊','🤛','🤜','👏','🙌','🤲','🤝','🙏','💪','🖕','🤟','👐','🤜',
    ],
  },
];

const RECENTS_KEY = 'varnox-emoji-recents';
const FAVS_KEY = 'varnox-sticker-favourites';

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === 'string') as string[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a full or disabled store is not worth failing a keystroke over */
  }
}

/** Delete-left. Inlined here because it is only ever used by this panel. */
function BackspaceGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M9 5h9.5A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12z" />
      <path d="M12 9.5l5 5M17 9.5l-5 5" />
    </svg>
  );
}

/** Peeling sticker. Also local to this panel. */
function StickerGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6.5L14.5 20H6a2 2 0 0 1-2-2z" />
      <path d="M20 12.5h-4a1.5 1.5 0 0 0-1.5 1.5v6" />
    </svg>
  );
}

export function EmojiPanel({
  onPick,
  onClose,
  onBackspace,
}: {
  onPick: (value: string) => void;
  onClose: () => void;
  /** Deletes the character before the caret, the way the key on the right of the bar does. */
  onBackspace: () => void;
}) {
  const [mode, setMode] = useState<Mode>('emoji');
  const [cat, setCat] = useState(CATEGORIES[0].id);
  const [pack, setPack] = useState(STICKER_PACKS[0].id);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    setRecents(read(RECENTS_KEY));
    setFavs(read(FAVS_KEY));
  }, []);

  function pick(value: string) {
    onPick(value);
    setRecents((prev) => {
      const next = [value, ...prev.filter((x) => x !== value)].slice(0, 24);
      write(RECENTS_KEY, next);
      return next;
    });
  }

  function toggleFav(value: string) {
    setFavs((prev) => {
      const next = prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value];
      write(FAVS_KEY, next);
      return next;
    });
  }

  /**
   * Search matches category names only. A real emoji search needs a keyword table — the names
   * behind each glyph — and this app has none, so "food" finds the food set and a word like
   * "pizza" finds nothing. Better to do the smaller honest thing than pretend otherwise.
   */
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    return CATEGORIES.filter((c) => c.label.toLowerCase().includes(needle));
  }, [q]);

  const activeCat = CATEGORIES.find((c) => c.id === cat) ?? CATEGORIES[0];
  const activePack = STICKER_PACKS.find((p) => p.id === pack) ?? STICKER_PACKS[0];
  const favStickers = favs.filter((f) => STICKER_PACKS.some((p) => p.items.includes(f)));

  return (
    <div className="emoji-panel">
      <div className="emoji-top">
        <button
          type="button"
          className="emoji-ic"
          onClick={onClose}
          title="Back"
          aria-label="Back"
        >
          <IconBack size={18} />
        </button>
        <button
          type="button"
          className={`emoji-ic${searching ? ' on' : ''}`}
          onClick={() => {
            setSearching((v) => !v);
            setQ('');
          }}
          title="Search"
          aria-label="Search"
        >
          <IconSearch size={18} />
        </button>

        <div className="emoji-seg" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'emoji'}
            className={mode === 'emoji' ? 'on' : ''}
            onClick={() => setMode('emoji')}
            title="Emoji"
          >
            <IconSmilePlus size={18} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'gif'}
            className={mode === 'gif' ? 'on' : ''}
            onClick={() => setMode('gif')}
            title="GIF"
          >
            GIF
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'stickers'}
            className={mode === 'stickers' ? 'on' : ''}
            onClick={() => setMode('stickers')}
            title="Stickers"
          >
            <StickerGlyph size={18} />
          </button>
        </div>

        {mode === 'stickers' ? (
          <button type="button" className="emoji-ic" onClick={onClose} title="Done">
            <IconEdit size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="emoji-ic"
            onClick={onBackspace}
            title="Backspace"
            aria-label="Backspace"
          >
            <BackspaceGlyph size={18} />
          </button>
        )}
      </div>

      {searching ? (
        <input
          className="emoji-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search categories"
          autoFocus
        />
      ) : null}

      <div className="emoji-body">
        {mode === 'gif' ? (
          <p className="emoji-empty">
            No GIF provider is connected. Add a Tenor or Giphy key and this becomes a search box.
          </p>
        ) : mode === 'stickers' ? (
          <>
            <p className="emoji-section">Create</p>
            <div className="sticker-create">
              <span className="sticker-create-tile">
                <IconEdit size={20} />
              </span>
              <span className="sticker-create-label">Create sticker</span>
            </div>
            <p className="emoji-section">Favourites</p>
            {favStickers.length ? (
              <div className="emoji-grid stickers">
                {favStickers.map((s) => (
                  <button key={s} type="button" onClick={() => pick(s)} aria-label={s}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <p className="emoji-empty">Star a sticker to keep it here.</p>
            )}
            <p className="emoji-section">{activePack.label}</p>
            <div className="emoji-grid stickers">
              {activePack.items.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => pick(s)}
                  onDoubleClick={() => toggleFav(s)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleFav(s);
                  }}
                  aria-label={s}
                  className={favs.includes(s) ? 'fav' : ''}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {results ? (
              results.length ? (
                results.map((c) => (
                  <div key={c.id}>
                    <p className="emoji-section">{c.label}</p>
                    <div className="emoji-grid">
                      {c.items.map((e) => (
                        <button key={e} type="button" onClick={() => pick(e)} aria-label={e}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="emoji-empty">Nothing matches that.</p>
              )
            ) : (
              <>
                {recents.length ? (
                  <>
                    <p className="emoji-section">Recents</p>
                    <div className="emoji-grid">
                      {recents.slice(0, 16).map((e) => (
                        <button key={e} type="button" onClick={() => pick(e)} aria-label={e}>
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
                <p className="emoji-section">{activeCat.label}</p>
                <div className="emoji-grid">
                  {activeCat.items.map((e) => (
                    <button key={e} type="button" onClick={() => pick(e)} aria-label={e}>
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="emoji-cats">
        {mode === 'stickers' ? (
          <>
            <button type="button" className="emoji-ic on" title="Recents">
              <IconClock size={18} />
            </button>
            <button type="button" className="emoji-ic" title="Favourites">
              <IconStar size={18} />
            </button>
            <div className="emoji-cats-pack">
              {STICKER_PACKS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`emoji-pack${p.id === pack ? ' on' : ''}`}
                  onClick={() => setPack(p.id)}
                  title={p.label}
                >
                  {p.items[0]}
                </button>
              ))}
            </div>
            <button type="button" className="emoji-ic" title="Add a pack">
              <IconPlus size={18} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={`emoji-cat${cat === 'recents' ? ' on' : ''}`}
              onClick={() => setCat(CATEGORIES[0].id)}
              title="Recents"
            >
              <IconClock size={18} />
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`emoji-cat${c.id === cat ? ' on' : ''}`}
                onClick={() => {
                  setCat(c.id);
                  setSearching(false);
                  setQ('');
                }}
                title={c.label}
              >
                {c.icon}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
