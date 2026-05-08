import { config } from '../config.js';
import { LocalDiskStore } from './LocalDiskStore.js';
import { R2Store } from './R2Store.js';
import type { ObjectStore } from './types.js';

let store: ObjectStore | null = null;

export function getObjectStore(): ObjectStore {
  if (store) return store;

  if (config.OBJECT_STORE === 'r2') {
    if (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET) {
      throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required when OBJECT_STORE=r2');
    }
    store = new R2Store();
  } else {
    store = new LocalDiskStore();
  }

  return store;
}
