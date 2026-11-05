/** Item sealing binds ciphertext to its key and logical path. */
import { expect, it } from 'vitest'
import { checkVerifier, createSalt, createVerifier, deriveKey, digest, open, seal } from '../src/crypto.ts'

const params = { N: 2 ** 14, r: 8, p: 1 }

it('opens only with the same password and path', async () => {
  const salt = createSalt()
  const key = await deriveKey('correct horse', salt, params)
  const sealed = seal(key, Buffer.from('DEEPSEEK_API_KEY=sk-secret'), 'credentials/refs')
  expect(sealed.ciphertext.includes(Buffer.from('sk-secret'))).toBe(false)
  expect(open(key, sealed, 'credentials/refs').toString()).toBe('DEEPSEEK_API_KEY=sk-secret')
  expect(() => open(key, sealed, 'flashx.yml')).toThrow()
  const other = await deriveKey('wrong horse', salt, params)
  expect(() => open(other, sealed, 'credentials/refs')).toThrow()
  expect(checkVerifier(key, createVerifier(key))).toBe(true)
  expect(checkVerifier(other, createVerifier(key))).toBe(false)
})

it('derives the same key from the same salt and a keyed digest per key', async () => {
  const salt = createSalt()
  const a = await deriveKey('pässword', salt, params), b = await deriveKey('pässword', salt, params)
  expect(a.equals(b)).toBe(true)
  const other = await deriveKey('pässword', createSalt(), params)
  expect(digest(a, Buffer.from('x'))).toBe(digest(b, Buffer.from('x')))
  expect(digest(a, Buffer.from('x'))).not.toBe(digest(other, Buffer.from('x')))
})

it('rejects invalid scrypt cost', async () => {
  await expect(deriveKey('x', createSalt(), { N: 3, r: 8, p: 1 })).rejects.toThrow()
})
