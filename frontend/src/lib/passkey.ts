// Ключ доступа (passkey) в браузере: окно устройства (Face ID, Touch ID, Windows Hello, телефон рядом) через
// @simplewebauthn/browser. Параметры и проверку подписи даёт сервер (backend/src/auth/passkeys.ts); здесь —
// только вызов окна и ошибки словами. Ключ привязан к домену портала: на другом адресе устройство его не покажет.

import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

import { ApiError } from '../api/client';

export const passkeysSupported = (): boolean => {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
};

export const createPasskey = (optionsJSON: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON> =>
  startRegistration({ optionsJSON });

export const askPasskey = (optionsJSON: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON> =>
  startAuthentication({ optionsJSON });

/** Человек закрыл окно устройства или не подтвердил — не ошибка, о которой надо тревожно сообщать. */
export const isPasskeyCancel = (err: unknown): boolean =>
  err instanceof Error &&
  (err.name === 'NotAllowedError' || err.name === 'AbortError' || (err instanceof WebAuthnError && err.code === 'ERROR_CEREMONY_ABORTED'));

/** Ошибка окна устройства или сервера — словами для экрана. */
export const passkeyErrorText = (err: unknown): string => {
  if (err instanceof ApiError) return err.message;
  if (isPasskeyCancel(err)) return 'Окно ключа доступа закрыто — ничего не изменилось.';
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'На этом устройстве ключ портала уже есть.';
    if (err.code === 'ERROR_INVALID_DOMAIN' || err.code === 'ERROR_INVALID_RP_ID') {
      return 'Ключи доступа работают только на основном адресе портала.';
    }
    if (err.code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT') {
      return 'Устройство не умеет подтверждать вход отпечатком, лицом или PIN-кодом.';
    }
  }
  return 'Устройство не смогло выполнить запрос. Попробуйте ещё раз или войдите по паролю.';
};

/** Название нового ключа по устройству — человек поправит, если нужно. */
export const suggestPasskeyName = (ua: string): string => {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'Mac';
  return '';
};

interface ISignalUnknown {
  signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void>;
}

/**
 * Ключа больше нет на портале (убран в профиле или администратором) — просим менеджер паролей убрать его
 * и с устройства, чтобы он не предлагался снова. Браузер без этой возможности просто промолчит.
 */
export const forgetPasskey = (rpId: string, credentialId: string): void => {
  const api = (globalThis as { PublicKeyCredential?: ISignalUnknown }).PublicKeyCredential;
  api?.signalUnknownCredential?.({ rpId, credentialId }).catch(() => undefined);
};
