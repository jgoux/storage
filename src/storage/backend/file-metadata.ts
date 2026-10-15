import { randomUUID } from 'node:crypto'
import * as fsp from 'node:fs/promises'
import path from 'node:path'
import { logger } from '@internal/monitoring'

/**
 * Per-file metadata the file backend keeps next to the object bytes.
 *
 * Keys are logical names; each store decides how they are persisted.
 */
export type FileMetadataKey = 'cache-control' | 'content-encoding' | 'content-type' | 'etag'

export type FileMetadataValues = Partial<Record<FileMetadataKey, string | undefined>>

export interface FileMetadataStore {
  get(file: string, key: FileMetadataKey): Promise<string | undefined>
  /** Reads several keys at once */
  getMany(file: string, keys: readonly FileMetadataKey[]): Promise<FileMetadataValues>
  /** Sets the given keys, a key whose value is undefined is removed. Other keys are untouched. */
  set(file: string, values: FileMetadataValues): Promise<void>
  /** Drops all the metadata of a file (or of everything under a directory), to be called once it is gone. */
  removeAll(file: string): Promise<void>
}

export type FileMetadataMode = 'xattr' | 'sidecar'

/**
 * Sidecar store: metadata lives in JSON files that mirror the layout of the storage root
 * under `<root>/~metadata/<path>.json`, so it works on any file system and needs no native addon.
 * `~` is not in the set of characters bucket names allow (see VALID_BUCKET_NAME), so no bucket,
 * and therefore no object, can ever be addressed inside that directory.
 * Writes go through a temporary file and a rename so readers never see a partial document.
 */
const SIDECAR_DIR = '~metadata'
const SIDECAR_SUFFIX = '.json'
const METADATA_KEYS: readonly FileMetadataKey[] = [
  'cache-control',
  'content-encoding',
  'content-type',
  'etag',
]

export class SidecarFileMetadataStore implements FileMetadataStore {
  private readonly metadataRoot: string

  constructor(private readonly root: string) {
    this.metadataRoot = path.join(root, SIDECAR_DIR)
  }

  async get(file: string, key: FileMetadataKey): Promise<string | undefined> {
    return (await this.getMany(file, [key]))[key]
  }

  async getMany(file: string, keys: readonly FileMetadataKey[]): Promise<FileMetadataValues> {
    const sidecar = this.sidecarPath(file)
    let content: string
    try {
      content = await fsp.readFile(sidecar, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw error
    }

    // an unreadable document is handled like a missing one, the next write replaces it
    try {
      const parsed = JSON.parse(content)
      const metadata: FileMetadataValues = {}
      for (const key of keys) {
        if (typeof parsed?.[key] === 'string') {
          metadata[key] = parsed[key]
        }
      }
      return metadata
    } catch {
      logger.warn(
        { type: 'file-metadata', sidecar },
        '[FileBackend] Ignoring corrupt metadata file'
      )
      return {}
    }
  }

  async set(file: string, values: FileMetadataValues): Promise<void> {
    const metadata = await this.getMany(file, METADATA_KEYS)
    for (const [key, value] of Object.entries(values) as [FileMetadataKey, string | undefined][]) {
      if (value === undefined) {
        delete metadata[key]
      } else {
        metadata[key] = value
      }
    }

    const sidecar = this.sidecarPath(file)
    if (Object.keys(metadata).length === 0) {
      await this.removeSidecar(sidecar)
      return
    }

    const tmp = `${sidecar}.${randomUUID()}.tmp`
    await fsp.mkdir(path.dirname(sidecar), { recursive: true })
    await fsp.writeFile(tmp, JSON.stringify(metadata))
    await fsp.rename(tmp, sidecar)
  }

  async removeAll(file: string): Promise<void> {
    const sidecar = this.sidecarPath(file)
    await fsp.rm(sidecar.slice(0, -SIDECAR_SUFFIX.length), { recursive: true, force: true })
    await this.removeSidecar(sidecar)
  }

  private async removeSidecar(sidecar: string) {
    await fsp.rm(sidecar, { force: true })

    // drop the directories that became empty, up to and including the metadata root
    for (
      let dir = path.dirname(sidecar);
      dir.startsWith(this.metadataRoot);
      dir = path.dirname(dir)
    ) {
      try {
        await fsp.rmdir(dir)
      } catch {
        return
      }
    }
  }

  private sidecarPath(file: string): string {
    const relative = path.relative(this.root, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`File ${file} is outside of the storage root`)
    }
    return path.join(this.metadataRoot, relative + SIDECAR_SUFFIX)
  }
}

// The xattr store pulls in a native addon, so it is registered by the entry point
// (see register-xattr.ts) instead of being imported here. A build that never
// registers it keeps the addon out of its module graph.
let loadXattrStore: (() => Promise<{ xattrFileMetadataStore: FileMetadataStore }>) | undefined

export function registerXattrFileMetadata(
  load: () => Promise<{ xattrFileMetadataStore: FileMetadataStore }>
) {
  loadXattrStore = load
}

/** Whether this build links the extended attributes store, see registerXattrFileMetadata */
export function isXattrFileMetadataRegistered(): boolean {
  return loadXattrStore !== undefined
}

/**
 * Resolves the store for FILE_STORAGE_METADATA. Unset means extended attributes
 * when they are available in this build, and sidecar files otherwise.
 */
export async function resolveFileMetadataStore(
  mode: FileMetadataMode | undefined,
  root: string
): Promise<FileMetadataStore> {
  if (mode === 'sidecar' || (mode === undefined && !loadXattrStore)) {
    return new SidecarFileMetadataStore(root)
  }

  if (mode !== undefined && mode !== 'xattr') {
    throw new Error('FILE_STORAGE_METADATA env variable must be either "xattr" or "sidecar"')
  }

  if (!loadXattrStore) {
    throw new Error('FILE_STORAGE_METADATA=xattr is not supported by this build, use "sidecar"')
  }

  return (await loadXattrStore()).xattrFileMetadataStore
}
