/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SMB_SERVER: string;
  readonly VITE_SMB_SHARE: string;
  readonly VITE_SMB_REMOTE_PATH: string;
  readonly VITE_SMB_USERNAME: string;
  readonly VITE_SMB_PASSWORD: string;
  readonly VITE_SMB_LOCAL_DIR: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
