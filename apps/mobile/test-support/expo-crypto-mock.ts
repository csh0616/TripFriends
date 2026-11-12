// TASK-012 §19 F1: expo-crypto 가짜 (네이티브 모듈 대신 Node crypto). 폰에서는 네이티브가 같은 값을 준다고 본다.
// 앱이 이 모듈로 crypto.subtle.digest(SHA-256)를 채우든, 다른 방법을 쓰든 테스트는 결과(authorize 주소의 s256)만 본다.
import { createHash, randomBytes, randomUUID as nodeUUID } from 'node:crypto';

export const CryptoDigestAlgorithm = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512', MD5: 'MD5' } as const;
export const CryptoEncoding = { HEX: 'hex', BASE64: 'base64' } as const;

const nodeName = (algorithm: string) => algorithm.replace('-', '').toLowerCase();
const bytesOf = (data: ArrayBuffer | ArrayBufferView) =>
  data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

export async function digest(algorithm: string, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer> {
  const out = createHash(nodeName(algorithm)).update(bytesOf(data)).digest();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

export async function digestStringAsync(algorithm: string, value: string, options: { encoding?: string } = {}): Promise<string> {
  return createHash(nodeName(algorithm)).update(value, 'utf8').digest(options.encoding === 'base64' ? 'base64' : 'hex');
}

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  const bytes = randomBytes(array.byteLength);
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes);
  return array;
}

export const getRandomBytes = (size: number) => new Uint8Array(randomBytes(size));
export const getRandomBytesAsync = async (size: number) => getRandomBytes(size);
export const randomUUID = () => nodeUUID();
