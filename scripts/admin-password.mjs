#!/usr/bin/env node
/**
 * Turn an admin password into the value that goes in ADMIN_PASSWORD_HASH.
 *
 *   node scripts/admin-password.mjs 'the password you want'
 *
 * Paste the printed output into Vercel as ADMIN_PASSWORD_HASH, then redeploy. The output is a
 * scrypt hash, not the password — it is safe to paste, to keep in a password manager's notes, or
 * to send to somebody. The password itself is not recoverable from it.
 *
 * This exists so the password never has to be typed anywhere except your own machine. An admin
 * password that has been written into a chat, an issue, or a commit is a password that has to be
 * changed; running this locally means there is nothing to change.
 *
 * The format matches `hashPassword()` in lib/auth.ts exactly — scrypt, 16-byte salt, 64-byte
 * digest, joined with `$` — because `verifyPassword()` rejects anything else. If the two ever
 * drift, every admin password stops working with no clue why, which is what the round-trip check
 * in the pull request this shipped with is for.
 */
import crypto from 'node:crypto';

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/admin-password.mjs 'the password you want'");
  process.exit(1);
}

// Long enough that a guess is not the weak link, and a warning rather than a refusal: the owner's
// choice is the owner's, but a four-character admin password is worth being told about.
if (password.length < 12) {
  console.error(`Warning: that password is ${password.length} characters. Twelve or more is a reasonable floor.`);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

console.log(`\nADMIN_PASSWORD_HASH=${'scrypt'}$${salt}$${hash}\n`);
console.error('Put the line above in Vercel as ADMIN_PASSWORD_HASH, then redeploy.');
console.error('Do not commit it, and do not commit the password.');
