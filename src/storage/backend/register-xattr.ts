import { registerXattrFileMetadata } from './file-metadata'

// Makes the extended attributes metadata store (and its fs-xattr native addon)
// available to the file backend. Imported by the full server entry point;
// entry points that skip it can only use FILE_STORAGE_METADATA=sidecar.
registerXattrFileMetadata(() => import('./file-metadata-xattr'))
