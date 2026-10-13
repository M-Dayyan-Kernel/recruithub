/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RH_EXTENSION_ID?: string
  readonly VITE_RH_EXTENSION_INSTALL_URL?: string
  /** 'off' disables the extension gate in development builds only. */
  readonly VITE_EXTENSION_CHECK?: string
}
