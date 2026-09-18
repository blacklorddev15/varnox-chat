'use client';

import { useState } from 'react';
import { IconBack } from './icons';

const CATEGORIES: { id: string; label: string; items: string[] }[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    items: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
      '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','😮',
      '😴','🤤','😪','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺','😦','😧',
      '😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','🤬','😈','👿','💀','💩',
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎',
      '✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🦵','🦶','👂','👀','👁️','🧠','❤️','🧡',
      '💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','✨','🎉','🎊',
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    items: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆',
      '🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🕷️','🦂','🐢','🐍','🦎','🐙','🦑',
      '🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🎍','🌾','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝',
      '🌚','🌙','⭐','🌟','💫','⚡','🔥','🌈','☀️','⛅','☁️','🌧️','⛈️','❄️','☃️','💧','🌊','🌫️','🌪️','🌍',
    ],
  },
  {
    id: 'food',
    label: 'Food',
    items: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🥦',
      '🥕','🌽','🌶️','🥒','🥬','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🧀','🥚','🍳','🧇','🥞','🥓','🍔','🍟',
      '🍕','🌭','🥪','🌮','🌯','🥗','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥠','🍢',
      '🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧋','🥤','🍺',
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    items: [
      '📱','💻','⌨️','🖥️','🖨️','🖱️','💽','💾','💿','📀','📷','📸','📹','🎥','📞','☎️','📠','📺','📻','🎙️',
      '⏰','⌚','📡','🔋','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','💰','💳','🧾','💎','⚖️',
      '🔧','🔨','⚒️','🛠️','⛏️','🔩','⚙️','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','🛡️','🚬','⚰️','🏺',
      '📚','📖','📝','✏️','🖊️','🖋️','📌','📍','📎','🖇️','📐','📏','🧮','📦','📫','📮','🗳️','✉️','📩','📨',
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    items: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🛺','🚲','🛴','🚨',
      '✈️','🛫','🛬','🚀','🛰️','🚁','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️',
      '🏠','🏡','🏢','🏥','🏦','🏨','🏫','🏭','🏰','⛪','🕌','🕍','🛕','🌉','🌁','🗻','🏔️','⛰️','🌋','🏝️',
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    items: [
      '✅','❌','❓','❗','💯','🔔','🔕','🔒','🔓','🔑','🗝️','🔐','⚠️','🚫','♻️','✳️','✴️','❇️','©️','®️',
      '™️','🔟','🔠','🔡','🔤','🅰️','🆎','🅱️','🆑','🆒','🆓','🆔','🆕','🆖','🅾️','🆗','🅿️','🆘','🆙','🆚',
      '⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️','↕️','↔️','↩️','↪️','🔃','🔄','🔙','🔚','🔛','🔜','🔝','🛐',
    ],
  },
];

/**
 * Stickers.
 *
 * There is no sticker artwork, no upload path and nowhere to store any, so these are the
 * expressive glyphs drawn large rather than images. They send as ordinary messages. A real
 * library would need assets, storage and a render path in the bubble — that is a feature, not
 * a tab, and this is honest about being the smaller thing.
 */
const STICKERS = [
  '😂','❤️','🔥','👍','🎉','😭','😍','🙏','💀','✨','🥰','😎','👀','💯','🤝','🥳',
  '😤','🫡','🤔','😴','🙌','👏','💔','🤯','🫶','😈','🤡','👻','🎯','⚡','🌟','🥺',
];

export function EmojiPanel({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(CATEGORIES[0].id);
  const tabs = [...CATEGORIES, { id: 'stickers', label: 'Stickers', items: STICKERS }];
  const active = tabs.find((c) => c.id === tab) ?? tabs[0];

  return (
    <div className="emoji-panel">
      {/* The panel gets the same title bar every other screen has: the back chevron hard left,
          and the heading in the italic serif the app uses for headings, in gold. */}
      <div className="emoji-head">
        <button
          type="button"
          className="emoji-back"
          onClick={onClose}
          title="Back"
          aria-label="Back"
        >
          <IconBack size={18} />
        </button>
        <h3 className="emoji-title">{active.label}</h3>
      </div>
      <div className="emoji-tabs">
        {tabs.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`emoji-tab${c.id === tab ? ' on' : ''}`}
            onClick={() => setTab(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className={`emoji-grid${tab === 'stickers' ? ' stickers' : ''}`}>
        {active.items.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
