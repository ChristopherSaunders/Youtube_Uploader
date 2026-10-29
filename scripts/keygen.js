// Prints fresh random secrets to paste into .env.
import crypto from 'node:crypto';

console.log(`SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`);
console.log(`TOKEN_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
