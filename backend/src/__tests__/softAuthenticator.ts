// Программный аутентификатор WebAuthn для тестов ключей доступа (auth/passkeys.ts): настоящие ключи P-256,
// настоящая подпись, CBOR и authenticatorData по спецификации. Проверку делает та же библиотека, что на
// сервере, — без подмены, поэтому тест ловит и ошибки в параметрах (origin, RP ID, вызов, флаги).

import crypto from 'node:crypto';

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

type Cbor = number | string | Buffer | Cbor[] | Map<number | string, Cbor>;

const head = (major: number, n: number): Buffer => {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
};

export const cbor = (value: Cbor): Buffer => {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
};

const FLAG = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 } as const;

const sha256 = (data: Buffer | string): Buffer => crypto.createHash('sha256').update(data).digest();

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

interface ISoftCredential {
  id: Buffer;
  privateKey: crypto.KeyObject;
  rpId: string;
  userHandle: string;
  signCount: number;
}

export interface ISoftOptions {
  /** Откуда «пришёл» браузер: чужой адрес — фишинговая страница. */
  origin: string;
  /** Проверка пользователя (биометрия, PIN). Без неё — только касание. */
  userVerified?: boolean;
  /** Синхронизируемый ключ (iCloud, Google): счётчик всегда 0. */
  synced?: boolean;
}

export class SoftAuthenticator {
  readonly credentials: ISoftCredential[] = [];

  create(options: PublicKeyCredentialCreationOptionsJSON, soft: ISoftOptions): RegistrationResponseJSON {
    const rpId = options.rp.id ?? new URL(soft.origin).hostname;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const coseKey = new Map<number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]);
    const id = crypto.randomBytes(32);
    const synced = soft.synced ?? true;
    const flags = FLAG.UP | FLAG.AT | (soft.userVerified === false ? 0 : FLAG.UV) | (synced ? FLAG.BE | FLAG.BS : 0);
    const lenBytes = Buffer.from([id.length >> 8, id.length & 0xff]);
    const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), u32(0), Buffer.alloc(16), lenBytes, id, cbor(coseKey)]);
    const clientData = JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: soft.origin, crossOrigin: false });
    const attestation = cbor(
      new Map<string, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    this.credentials.push({ id, privateKey, rpId, userHandle: options.user.id, signCount: 0 });
    return {
      id: id.toString('base64url'),
      rawId: id.toString('base64url'),
      type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(clientData).toString('base64url'),
        attestationObject: attestation.toString('base64url'),
        transports: ['internal', 'hybrid'],
      },
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
    };
  }

  /** Вход ключом; по умолчанию — последний созданный, как выбор человека в окне устройства. */
  get(
    options: PublicKeyCredentialRequestOptionsJSON,
    soft: ISoftOptions & { credential?: ISoftCredential; signCount?: number },
  ): AuthenticationResponseJSON {
    const credential = soft.credential ?? this.credentials.at(-1);
    if (!credential) throw new Error('soft authenticator: ключей нет');
    const synced = soft.synced ?? true;
    if (soft.signCount !== undefined) credential.signCount = soft.signCount;
    else if (!synced) credential.signCount += 1;
    const flags = FLAG.UP | (soft.userVerified === false ? 0 : FLAG.UV) | (synced ? FLAG.BE | FLAG.BS : 0);
    const authData = Buffer.concat([sha256(options.rpId ?? credential.rpId), Buffer.from([flags]), u32(credential.signCount)]);
    const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: soft.origin, crossOrigin: false }));
    const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientData)]), credential.privateKey);
    return {
      id: credential.id.toString('base64url'),
      rawId: credential.id.toString('base64url'),
      type: 'public-key',
      response: {
        clientDataJSON: clientData.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: credential.userHandle,
      },
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
    };
  }
}
