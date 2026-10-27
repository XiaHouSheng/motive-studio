import { spawnSync } from "node:child_process";
import type { CredentialStore } from "./credential-store.js";
import { EncryptedFileCredentialStore } from "./encrypted-file-store.js";
import { MacKeychainCredentialStore } from "./keychain-store.js";
import { SecretServiceCredentialStore } from "./secret-service-store.js";
import { WindowsDpapiCredentialStore } from "./windows-dpapi-store.js";

export {
  CredentialStoreError,
  isCredentialStoreError,
  type CredentialStore,
} from "./credential-store.js";
export { EncryptedFileCredentialStore } from "./encrypted-file-store.js";
export { MacKeychainCredentialStore } from "./keychain-store.js";
export { SecretServiceCredentialStore } from "./secret-service-store.js";
export { WindowsDpapiCredentialStore } from "./windows-dpapi-store.js";

/**
 * 按当前平台选择凭据存储：
 * - Windows：DPAPI（CurrentUser）——始终可用
 * - macOS：钥匙串
 * - Linux：secret-tool 可用时用 Secret Service，否则降级为本机加密文件
 * - 其他平台：本机加密文件
 *
 * 降级只发生在「加密文件」这一非明文方案上，绝不静默退化为明文存储。
 */
export function createCredentialStore(secretsDir: string): CredentialStore {
  switch (process.platform) {
    case "win32":
      return new WindowsDpapiCredentialStore(secretsDir);
    case "darwin":
      return new MacKeychainCredentialStore();
    case "linux": {
      const probe = spawnSync("secret-tool", ["--help"], {
        stdio: "ignore",
        timeout: 5_000,
      });
      if (!probe.error) return new SecretServiceCredentialStore();
      return new EncryptedFileCredentialStore(secretsDir);
    }
    default:
      return new EncryptedFileCredentialStore(secretsDir);
  }
}
