import { GatedHome } from '@/components/gated';

/**
 * The root address, which is only a way in: /chat when signed in, /login when not.
 *
 * The decision moved to components/gated.tsx along with the rest of the gate, because on the
 * client it is a question only the browser can ask. `metadata` comes from app/layout.tsx, which
 * is unchanged — this route never had any of its own.
 */
export default function Home() {
  return <GatedHome />;
}
