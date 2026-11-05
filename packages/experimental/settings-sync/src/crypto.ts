/**
 * Client-side encryption for synced items: scrypt derives a 256-bit key from the sync password, and AES-256-GCM seals
 * each item with its logical path as associated data, so the server cannot read an item or move it to another path.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

/** scrypt cost parameters stored beside the salt in the account's key envelope. */
export interface KdfParams {
  readonly N: number
  readonly r: number
  readonly p: number
}

/** One AES-256-GCM output; `ciphertext` ends with the 16-byte authentication tag. */
export interface Sealed {
  readonly nonce: Buffer
  readonly ciphertext: Buffer
}

const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16
const VERIFIER_TEXT = 'dsh-settings-sync/verifier/v1'
const VERIFIER_PATH = 'key-envelope'
const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt)

/**
 * Derive the item key from the sync password.
 * @param password - sync password; never leaves the device.
 * @param salt - per-account random salt from the key envelope.
 * @param params - scrypt cost from the key envelope.
 * @returns 32-byte key.
 */
export function deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return scryptAsync(password.normalize('NFKC'), salt, KEY_BYTES, { ...params, maxmem: 256 * params.N * params.r })
}

/**
 * Create a key envelope salt.
 * @returns fresh 16-byte salt for a new key envelope.
 */
export function createSalt(): Buffer {
  return randomBytes(16)
}

/**
 * Encrypt one item.
 * @param key - derived item key.
 * @param plaintext - complete item bytes.
 * @param path - logical item path bound as associated data.
 * @returns nonce and ciphertext with appended tag.
 */
export function seal(key: Buffer, plaintext: Buffer, path: string): Sealed {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(Buffer.from(path, 'utf8'))
  return { nonce, ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]) }
}

/**
 * Decrypt one item.
 * @param key - derived item key.
 * @param sealed - nonce and ciphertext with appended tag.
 * @param path - logical item path the item was sealed under.
 * @returns plaintext; throws when the key, path, or bytes do not match.
 */
export function open(key: Buffer, sealed: Sealed, path: string): Buffer {
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce)
    .setAAD(Buffer.from(path, 'utf8'))
    .setAuthTag(sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES))
  return Buffer.concat([decipher.update(body), decipher.final()])
}

/**
 * Keyed digest of plaintext, stored server-side to detect changes without exposing a guessable hash of a secret.
 * @param key - derived item key.
 * @param plaintext - complete item bytes.
 * @returns lowercase hex HMAC-SHA-256.
 */
export function digest(key: Buffer, plaintext: Buffer): string {
  return createHmac('sha256', key).update(plaintext).digest('hex')
}

/**
 * Seal the fixed verifier text so another device can test a password before decrypting items.
 * @param key - derived item key.
 * @returns sealed verifier.
 */
export function createVerifier(key: Buffer): Sealed {
  return seal(key, Buffer.from(VERIFIER_TEXT, 'utf8'), VERIFIER_PATH)
}

/**
 * Test a derived key against the account's verifier.
 * @param key - candidate key.
 * @param verifier - sealed verifier from the key envelope.
 * @returns whether the key opens the verifier.
 */
export function checkVerifier(key: Buffer, verifier: Sealed): boolean {
  try {
    return open(key, verifier, VERIFIER_PATH).toString('utf8') === VERIFIER_TEXT
  } catch {
    // AES-GCM authentication failure is the expected outcome for a wrong password.
    return false
  }
}
