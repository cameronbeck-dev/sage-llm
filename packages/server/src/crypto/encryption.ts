import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION = 0x01;

export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionConfigError';
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export interface EncryptedEnvelope {
  version: number;
  iv: string;
  tag: string;
  ciphertext: string;
}

function getKey(): Buffer {
  const raw = config.SAGE_ENC_KEY;
  if (!raw) {
    throw new EncryptionConfigError('SAGE_ENC_KEY is not set');
  }

  let keyBuf: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    keyBuf = Buffer.from(raw, 'hex');
  } else {
    keyBuf = Buffer.from(raw, 'base64');
  }

  if (keyBuf.length !== KEY_BYTES) {
    throw new EncryptionConfigError(
      `SAGE_ENC_KEY must decode to exactly 32 bytes (got ${keyBuf.length})`
    );
  }

  return keyBuf;
}

export function encrypt(plaintext: string): EncryptedEnvelope {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decrypt(envelope: EncryptedEnvelope): string {
  if (envelope.version !== VERSION) {
    throw new DecryptionError(`Unsupported envelope version: ${envelope.version}`);
  }

  const key = getKey();

  let iv: Buffer;
  let tag: Buffer;
  let ciphertextBuf: Buffer;

  try {
    iv = Buffer.from(envelope.iv, 'base64');
    tag = Buffer.from(envelope.tag, 'base64');
    ciphertextBuf = Buffer.from(envelope.ciphertext, 'base64');
  } catch {
    throw new DecryptionError('Envelope fields are not valid base64');
  }

  if (iv.length !== IV_BYTES) {
    throw new DecryptionError('Invalid IV length');
  }
  if (tag.length !== TAG_BYTES) {
    throw new DecryptionError('Invalid auth tag length');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new DecryptionError('Decryption failed: authentication tag mismatch or corrupted data');
  }
}
