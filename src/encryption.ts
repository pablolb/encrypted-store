/**
 * Interface defining the subset of the Web Crypto API that we use
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

  /**
   * @param passphrase - The passphrase used for encryption/decryption
   * @param crypto - Optional crypto implementation. If not provided, uses the global crypto object.
   *                 This parameter is primarily for testing purposes.
   */
  constructor(passphrase: string, crypto?: CryptoInterface) {
    this.passphrase = passphrase;
    this.crypto =
      crypto ||
      (typeof window !== "undefined" ? window.crypto : (global as any).crypto);
  }

  private async getKey(): Promise<CryptoKey> {
    if (this.keyPromise) {
      return this.keyPromise;
    }

    const enc = new TextEncoder();
    const pwUtf8 = enc.encode(this.passphrase);
    const pwHash = await this.crypto.subtle.digest("SHA-256", pwUtf8);
    this.keyPromise = this.crypto.subtle.importKey(
      "raw",
      pwHash,
      "AES-GCM",
      true,
      ["encrypt", "decrypt"],
    );
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
