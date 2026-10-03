export const TICKET_CREDENTIAL_VERSION = "BM1";
const DEFAULT_KEY_ID = "buymesho-ticket-2026";

export type TicketCredentialPayload = {
  v: 1;
  kid: string;
  tid: string;
  eid: string;
  oid: string;
  iat: number;
};

function getConfiguredPublicKey(): string {
  return String(import.meta.env.VITE_BUYMESHO_TICKET_PUBLIC_KEY ?? "").trim();
}

function getConfiguredKeyId(): string {
  return String(import.meta.env.VITE_BUYMESHO_TICKET_SIGNING_KEY_ID ?? DEFAULT_KEY_ID).trim() || DEFAULT_KEY_ID;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodePayload(value: string): TicketCredentialPayload | null {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== TICKET_CREDENTIAL_VERSION) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1]!))) as Partial<TicketCredentialPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.kid !== "string" ||
      typeof payload.tid !== "string" ||
      typeof payload.eid !== "string" ||
      typeof payload.oid !== "string" ||
      !Number.isFinite(payload.iat)
    ) return null;
    if (payload.kid !== getConfiguredKeyId()) return null;
    return payload as TicketCredentialPayload;
  } catch {
    return null;
  }
}

export function decodeTicketCredential(value: string): TicketCredentialPayload | null {
  const normalized = value.trim();
  return normalized.startsWith(`${TICKET_CREDENTIAL_VERSION}.`) ? decodePayload(normalized) : null;
}

let publicKeyPromise: Promise<CryptoKey> | null = null;

async function importPublicKey(): Promise<CryptoKey> {
  const configured = getConfiguredPublicKey();
  if (!configured) throw new Error("Ticket credential verification key is not configured.");
  if (!publicKeyPromise) {
    publicKeyPromise = crypto.subtle.importKey(
      "spki",
      base64UrlToBytes(configured),
      { name: "Ed25519" } as any,
      false,
      ["verify"],
    ).catch((error) => {
      publicKeyPromise = null;
      throw error;
    });
  }
  return publicKeyPromise;
}

export async function verifyTicketCredential(value: string): Promise<TicketCredentialPayload | null> {
  const normalized = value.trim();
  const payload = decodeTicketCredential(normalized);
  if (!payload) return null;

  try {
    const parts = normalized.split(".");
    const verified = await crypto.subtle.verify(
      { name: "Ed25519" } as any,
      await importPublicKey(),
      base64UrlToBytes(parts[2]!),
      new TextEncoder().encode(`${TICKET_CREDENTIAL_VERSION}.${parts[1]}`),
    );
    return verified ? payload : null;
  } catch {
    return null;
  }
}

export function isSignedTicketCredential(value: string): boolean {
  return value.trim().startsWith(`${TICKET_CREDENTIAL_VERSION}.`);
}
