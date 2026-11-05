/** Local sources of synced items: the active profile patch, the model selection file, and stored credential references. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { CREDENTIALS_FILENAME } from '@deepseek-ai/dsh-credentials-local'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SyncItemKind } from './types.ts'

/** One item's current local bytes. */
export interface LocalItem {
  readonly path: string
  readonly kind: SyncItemKind
  readonly content: Buffer
}

/** Where items live on this device. */
export interface ItemLocations {
  /** Harness home directory. */
  readonly home: string
  /** Active profile patch file. */
  readonly patchPath: string
}

/** Logical path of the active profile's patch, independent of the profile name. */
export const PROFILE_PATCH_PATH = 'profile/cordis.patch.yml'

/** Logical path of the credential reference item. */
export const CREDENTIALS_PATH = 'credentials/refs'
const MODEL_SELECTION_FILE = 'flashx.yml'

async function readOptional(filename: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Names under `refs` in the local credential file. The credential service cannot enumerate references, so the file is
 * read for names only; values always come from the service.
 */
async function storedRefNames(home: string): Promise<string[]> {
  const text = await readOptional(join(home, CREDENTIALS_FILENAME))
  if (text === undefined) return []
  const document = yaml.load(text.toString('utf8'))
  if (typeof document !== 'object' || document === null || !('refs' in document)) return []
  const refs = document.refs
  if (typeof refs !== 'object' || refs === null) return []
  return Object.keys(refs).filter(isCredentialRefName).sort()
}

function filePaths(locations: ItemLocations): { path: string; kind: SyncItemKind; filename: string }[] {
  return [
    // One path for every profile name: Desktop (`desktop`) and Web (`web`) devices share the same settings.
    { path: PROFILE_PATCH_PATH, kind: 'profile-patch', filename: locations.patchPath },
    { path: MODEL_SELECTION_FILE, kind: 'model-selection', filename: join(locations.home, MODEL_SELECTION_FILE) },
  ]
}

/**
 * Read every local item that exists.
 * @param locations - this device's home and profile.
 * @param credentials - credential service supplying reference values.
 * @returns items in stable path order; credential values appear only for references stored in the credential file.
 */
export async function collectLocalItems(locations: ItemLocations, credentials: CredentialProvider): Promise<LocalItem[]> {
  const items: LocalItem[] = []
  for (const file of filePaths(locations)) {
    const content = await readOptional(file.filename)
    if (content !== undefined) items.push({ path: file.path, kind: file.kind, content })
  }
  const refs: Record<string, string> = {}
  for (const name of await storedRefNames(locations.home)) {
    const resolved = await credentials.resolve(credentialRef(name))
    /* v8 ignore next -- a reference removed between the file read and resolve is skipped */
    if (resolved?.source === 'file') refs[name] = resolved.value
  }
  if (Object.keys(refs).length > 0) items.push({ path: CREDENTIALS_PATH, kind: 'credentials', content: Buffer.from(JSON.stringify(refs), 'utf8') })
  return items.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Whether this release reads and writes a logical path; rows under other paths, such as earlier per-profile paths,
 * stay on the server untouched.
 * @param path - logical item path.
 * @returns whether the path is synced.
 */
export function isSyncedPath(path: string): boolean {
  return path === CREDENTIALS_PATH || path === PROFILE_PATCH_PATH || path === MODEL_SELECTION_FILE
}

/**
 * Write one downloaded item to its local destination.
 * @param locations - this device's home and profile.
 * @param credentials - credential service receiving reference values.
 * @param path - logical item path.
 * @param content - decrypted item bytes.
 * @returns after the item is written.
 */
export async function applyItem(
  locations: ItemLocations, credentials: CredentialProvider, path: string, content: Buffer,
): Promise<void> {
  if (path === CREDENTIALS_PATH) {
    for (const [name, value] of Object.entries(parseRefs(content))) {
      const ref = credentialRef(name)
      if ((await credentials.resolve(ref))?.value !== value) await credentials.set(ref, value)
    }
    return
  }
  const file = filePaths(locations).find(candidate => candidate.path === path)
  if (file === undefined) throw new Error(`settings-sync: ${path} is not a synced path`)
  await writeFileAtomic(file.filename, content, { mode: 0o600, dirMode: 0o700 })
}

function parseRefs(content: Buffer): Record<string, string> {
  const refs: unknown = JSON.parse(content.toString('utf8'))
  if (typeof refs !== 'object' || refs === null) throw new Error('settings-sync: credential item is not an object')
  const parsed: Record<string, string> = {}
  for (const [name, value] of Object.entries(refs)) {
    if (!isCredentialRefName(name) || typeof value !== 'string' || value === '') throw new Error(`settings-sync: invalid credential reference ${name}`)
    parsed[name] = value
  }
  return parsed
}

/**
 * Union two credential items so a pass never drops a key that only one device holds.
 * @param local - this device's credential item.
 * @param remote - decrypted server credential item.
 * @param localWins - whether this device's value wins for a name present on both sides.
 * @returns canonical item bytes with names in sorted order.
 */
export function mergeCredentialItems(local: Buffer, remote: Buffer, localWins: boolean): Buffer {
  const [low, high] = localWins ? [parseRefs(remote), parseRefs(local)] : [parseRefs(local), parseRefs(remote)]
  const merged = { ...low, ...high }
  return Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(merged).sort().map(name => [name, merged[name]]))), 'utf8')
}
