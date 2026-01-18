/**
 * AES-256-GCM encryption using WebCrypto API
 */

interface CryptoInterface {
  subtle: {
    digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer>;
    importKey(
      format: string,
      keyData: BufferSource,
      algorithm: string | object,
      extractable: boolean,
      keyUsages: string[],
    ): Promise<CryptoKey>;
    encrypt(
      algorithm: string | object,
      key: CryptoKey,
      data: BufferSource,
    ): Promise<ArrayBuffer>;
    decrypt(
      algorithm: string | object,
      key: CryptoKey,
      data: BufferSource,
    ): Promise<ArrayBuffer>;
    deriveBits(
      algorithm: object,
      baseKey: CryptoKey,
      length: number,
    ): Promise<ArrayBuffer>;
  };
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
    Object.setPrototypeOf(this, DecryptionError.prototype);
  }
}

class EncryptionHelper {
  private keyPromise: Promise<CryptoKey> | null = null;
  private readonly passphrase: string;
  private readonly crypto: CryptoInterface;
  private readonly passphraseMode: "derive" | "raw";

  constructor(
    passphrase: string,
    crypto?: CryptoInterface,
    passphraseMode: "derive" | "raw" = "derive",
  ) {
    this.passphrase = passphrase;
    this.crypto =
      crypto ||
      (typeof window !== "undefined" ? window.crypto : (global as any).crypto);
    this.passphraseMode = passphraseMode;
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.keyPromise) {
      return this.keyPromise;
    }

    this.keyPromise = (async () => {
      const enc = new TextEncoder();
      const pwUtf8 = enc.encode(this.passphrase);

      let keyMaterial: ArrayBuffer;

      if (this.passphraseMode === "derive") {
        // User passphrase - use PBKDF2 to derive strong key
        // No salt for deterministic behavior (same passphrase = same key everywhere)
        // Use passphrase itself as "salt" for PBKDF2
        const iterations = 100000; // 100k iterations - good security/performance balance

        // Import passphrase as key material for PBKDF2
        const baseKey = await this.crypto.subtle.importKey(
          "raw",
          pwUtf8,
          "PBKDF2",
          false,
          ["deriveBits"],
        );

        // Derive 256 bits using PBKDF2
        keyMaterial = await this.crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            salt: pwUtf8, // Use passphrase as salt for determinism
            iterations: iterations,
            hash: "SHA-256",
          },
          baseKey,
          256, // bits
        );
      } else {
        // Raw mode - passphrase is already strong (e.g., random bytes)
        // Just hash to normalize to 256 bits
        keyMaterial = await this.crypto.subtle.digest("SHA-256", pwUtf8);
      }

      // Import the derived/hashed material as AES-GCM key
      return await this.crypto.subtle.importKey(
        "raw",
        keyMaterial,
        "AES-GCM",
        true,
        ["encrypt", "decrypt"],
      );
    })();

    return this.keyPromise;
  }

  private static fromHexString(hexString: string): Uint8Array {
    return new Uint8Array(
      hexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );
  }

  private static toHexString(bytes: Uint8Array): string {
    return bytes.reduce(
      (str, byte) => str + byte.toString(16).padStart(2, "0"),
      "",
    );
  }

  async encrypt(data: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await this.getKey();
    const encoded = enc.encode(data);
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await this.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      encoded,
    );
    return `${EncryptionHelper.toHexString(iv)}|${EncryptionHelper.toHexString(new Uint8Array(ciphertext))}`;
  }

  async decrypt(data: string): Promise<string> {
    const key = await this.getKey();
    const [iv, ciphertext] = data
      .split("|")
      .map((s) => EncryptionHelper.fromHexString(s));
    try {
      const decrypted = await this.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
        },
        key,
        ciphertext as BufferSource,
      );
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      throw new DecryptionError(
        `Could not decrypt: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

export { EncryptionHelper, DecryptionError };
export type { CryptoInterface };
