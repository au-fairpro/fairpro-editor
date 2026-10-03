/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOWED_PARENT_ORIGINS?: string;
  readonly VITE_GIT_COMMIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
