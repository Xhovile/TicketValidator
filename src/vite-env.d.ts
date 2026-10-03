/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUYMESHO_TICKET_SIGNING_KEY_ID?: string;
  readonly VITE_BUYMESHO_TICKET_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
