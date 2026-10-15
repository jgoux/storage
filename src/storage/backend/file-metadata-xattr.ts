import * as xattr from 'fs-xattr'
import type { FileMetadataKey, FileMetadataStore, FileMetadataValues } from './file-metadata'

// file metadata attribute keys on different platforms
const METADATA_ATTR_KEYS: Record<'darwin' | 'linux', Record<FileMetadataKey, string>> = {
  darwin: {
    'cache-control': 'com.apple.metadata.supabase.cache-control',
    'content-encoding': 'com.apple.metadata.supabase.content-encoding',
    'content-type': 'com.apple.metadata.supabase.content-type',
    etag: 'com.apple.metadata.supabase.etag',
  },
  linux: {
    'cache-control': 'user.supabase.cache-control',
    'content-encoding': 'user.supabase.content-encoding',
    'content-type': 'user.supabase.content-type',
    etag: 'user.supabase.etag',
  },
}

function isMissingXattrError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENODATA' || code === 'ENOATTR'
}

function attributeName(key: FileMetadataKey): string {
  return METADATA_ATTR_KEYS[process.platform === 'darwin' ? 'darwin' : 'linux'][key]
}

/**
 * Extended attributes store, backed by the fs-xattr native addon.
 *
 * fs-xattr's async path leaks about 0.5 kB per call (fs-xattr#47, reported for
 * this backend in #1349). The sync path does not leak and the reads are small,
 * so it is used until an upstream release ships the fix.
 */
class XattrFileMetadataStore implements FileMetadataStore {
  async get(file: string, key: FileMetadataKey): Promise<string | undefined> {
    try {
      const value = xattr.getAttributeSync(file, attributeName(key))
      return value?.toString() ?? undefined
    } catch (error) {
      if (isMissingXattrError(error)) {
        return undefined
      }
      throw error
    }
  }

  async getMany(file: string, keys: readonly FileMetadataKey[]): Promise<FileMetadataValues> {
    const values = await Promise.all(keys.map((key) => this.get(file, key)))
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]))
  }

  async set(file: string, values: FileMetadataValues): Promise<void> {
    for (const [key, value] of Object.entries(values) as [FileMetadataKey, string | undefined][]) {
      if (value !== undefined) {
        xattr.setAttributeSync(file, attributeName(key), value)
        continue
      }

      try {
        xattr.removeAttributeSync(file, attributeName(key))
      } catch (error) {
        if (!isMissingXattrError(error)) {
          throw error
        }
      }
    }
  }

  async removeAll(): Promise<void> {
    // attributes live in the file's inode and go away with it
  }
}

export const xattrFileMetadataStore = new XattrFileMetadataStore()
