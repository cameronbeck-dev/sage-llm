import { LocalDiskStore } from './LocalDiskStore.js';
import { PostgresStore } from './PostgresStore.js';
import { config } from '../config.js';
import type { ObjectStore } from './types.js';

export type { ObjectStore } from './types.js';

let instance: ObjectStore | null = null;

export function getObjectStore(): ObjectStore {
  if (instance) return instance;
  if (config.NODE_ENV === 'production') {
    instance = new PostgresStore();
  } else {
    instance = new LocalDiskStore();
  }
  return instance;
}

export function _resetObjectStoreForTests(): void {
  instance = null;
}
