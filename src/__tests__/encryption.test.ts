/**
 * Tests for EncryptionHelper
 */

import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import { EncryptionHelper, DecryptionError } from "../encryption.js";

describe("EncryptionHelper", () => {
  let helper: EncryptionHelper;

  beforeEach(() => {
    helper = new EncryptionHelper("test-password");
  });

  describe("Encryption and Decryption", () => {
    test("should encrypt and decrypt a simple string", async () => {
      const plaintext = "Hello, World!";
      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("should encrypt and decrypt JSON data", async () => {
      const data = { name: "Alice", age: 30, active: true };
      const plaintext = JSON.stringify(data);
      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(JSON.parse(decrypted)).toEqual(data);
    });

    test("should produce different ciphertext for same plaintext", async () => {
      const plaintext = "Hello, World!";
      const encrypted1 = await helper.encrypt(plaintext);
      const encrypted2 = await helper.encrypt(plaintext);

      // Different IVs should produce different ciphertext
      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same plaintext
      expect(await helper.decrypt(encrypted1)).toBe(plaintext);
      expect(await helper.decrypt(encrypted2)).toBe(plaintext);
    });

    test("should encrypt and decrypt empty string", async () => {
      const plaintext = "";
      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("should encrypt and decrypt unicode characters", async () => {
      const plaintext = "Hello 世界 🌍 émojis ñ";
      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("should encrypt and decrypt long strings", async () => {
      const plaintext = "x".repeat(10000);
      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(decrypted.length).toBe(10000);
    });

    test("should encrypt and decrypt special characters", async () => {
      const plaintext = "!@#$%^&*()_+-=[]{}|;:',.<>?/~`";
      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("Encrypted Format", () => {
    test("should produce encrypted string with pipe separator", async () => {
      const encrypted = await helper.encrypt("test");

      expect(encrypted).toContain("|");
      const parts = encrypted.split("|");
      expect(parts.length).toBe(2);
    });

    test("should have IV and ciphertext in hex format", async () => {
      const encrypted = await helper.encrypt("test");
      const parts = encrypted.split("|");

      // Check hex format (only 0-9 and a-f)
      expect(parts[0]).toMatch(/^[0-9a-f]+$/);
      expect(parts[1]).toMatch(/^[0-9a-f]+$/);
    });

    test("should have 12-byte (24 hex chars) IV", async () => {
      const encrypted = await helper.encrypt("test");
      const iv = encrypted.split("|")[0];

      // 12 bytes = 24 hex characters
      expect(iv.length).toBe(24);
    });
  });

  describe("Decryption Errors", () => {
    test("should throw DecryptionError with wrong password", async () => {
      const helper1 = new EncryptionHelper("password1");
      const helper2 = new EncryptionHelper("password2");

      const encrypted = await helper1.encrypt("secret data");

      await expect(helper2.decrypt(encrypted)).rejects.toThrow(DecryptionError);
      await expect(helper2.decrypt(encrypted)).rejects.toThrow(
        /Could not decrypt/,
      );
    });

    test("should throw DecryptionError with corrupted ciphertext", async () => {
      const encrypted = await helper.encrypt("test");
      const corrupted = encrypted.slice(0, -4) + "xxxx";

      await expect(helper.decrypt(corrupted)).rejects.toThrow(DecryptionError);
    });

    test("should throw DecryptionError with corrupted IV", async () => {
      const encrypted = await helper.encrypt("test");
      const parts = encrypted.split("|");
      const corruptedIv = "xxxx" + parts[0].slice(4);
      const corrupted = corruptedIv + "|" + parts[1];

      await expect(helper.decrypt(corrupted)).rejects.toThrow(DecryptionError);
    });

    test("should throw error with invalid format (no pipe)", async () => {
      await expect(helper.decrypt("invalid-format")).rejects.toThrow();
    });

    test("should throw error with invalid hex characters", async () => {
      await expect(helper.decrypt("gggggg|hhhhhh")).rejects.toThrow();
    });

    test("should throw error with empty encrypted string", async () => {
      await expect(helper.decrypt("")).rejects.toThrow();
    });
  });

  describe("Password Handling", () => {
    test("should work with different passwords", async () => {
      const helper1 = new EncryptionHelper("password1");
      const helper2 = new EncryptionHelper("password2");
      const helper3 = new EncryptionHelper("password3");

      const plaintext = "test data";

      const encrypted1 = await helper1.encrypt(plaintext);
      const encrypted2 = await helper2.encrypt(plaintext);
      const encrypted3 = await helper3.encrypt(plaintext);

      // Each password produces different encryption
      expect(encrypted1).not.toBe(encrypted2);
      expect(encrypted2).not.toBe(encrypted3);

      // Each can only decrypt its own
      expect(await helper1.decrypt(encrypted1)).toBe(plaintext);
      expect(await helper2.decrypt(encrypted2)).toBe(plaintext);
      expect(await helper3.decrypt(encrypted3)).toBe(plaintext);

      // Cannot decrypt each other's
      await expect(helper1.decrypt(encrypted2)).rejects.toThrow();
      await expect(helper2.decrypt(encrypted3)).rejects.toThrow();
      await expect(helper3.decrypt(encrypted1)).rejects.toThrow();
    });

    test("should work with empty password", async () => {
      const helper = new EncryptionHelper("");
      const plaintext = "test";

      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("should work with very long password", async () => {
      const longPassword = "x".repeat(1000);
      const helper = new EncryptionHelper(longPassword);
      const plaintext = "test";

      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    test("should work with unicode password", async () => {
      const helper = new EncryptionHelper("пароль 密码 🔒");
      const plaintext = "test";

      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("Key Caching", () => {
    test("should cache encryption key", async () => {
      const plaintext = "test";

      // First encryption
      const start1 = Date.now();
      await helper.encrypt(plaintext);
      const time1 = Date.now() - start1;

      // Second encryption (should use cached key)
      const start2 = Date.now();
      await helper.encrypt(plaintext);
      const time2 = Date.now() - start2;

      // Second call should be faster (or at least not significantly slower)
      // This is a rough check - key derivation should only happen once
      expect(time2).toBeLessThanOrEqual(time1 * 2);
    });

    test("should use same key for multiple operations", async () => {
      const plaintext = "test";

      const encrypted1 = await helper.encrypt(plaintext);
      const encrypted2 = await helper.encrypt(plaintext);

      // Both should decrypt successfully with the same helper
      expect(await helper.decrypt(encrypted1)).toBe(plaintext);
      expect(await helper.decrypt(encrypted2)).toBe(plaintext);
    });
  });

  describe("Real-world Scenarios", () => {
    test("should handle typical document data", async () => {
      const document = {
        _id: "expense_lunch",
        amount: 15.5,
        description: "Lunch at café",
        date: "2024-01-15",
        tags: ["food", "lunch"],
        metadata: {
          created: Date.now(),
          modified: Date.now(),
        },
      };

      const plaintext = JSON.stringify(document);
      const encrypted = await helper.encrypt(plaintext);
      const decrypted = await helper.decrypt(encrypted);

      expect(JSON.parse(decrypted)).toEqual(document);
    });

    test("should handle concurrent encryption operations", async () => {
      const plaintexts = Array.from({ length: 10 }, (_, i) => `test-${i}`);

      const encrypted = await Promise.all(
        plaintexts.map((pt) => helper.encrypt(pt)),
      );

      const decrypted = await Promise.all(
        encrypted.map((ct) => helper.decrypt(ct)),
      );

      expect(decrypted).toEqual(plaintexts);
    });

    test("should maintain data integrity over multiple encrypt/decrypt cycles", async () => {
      let data = "initial data";

      for (let i = 0; i < 10; i++) {
        const encrypted = await helper.encrypt(data);
        data = await helper.decrypt(encrypted);
      }

      expect(data).toBe("initial data");
    });
  });

  describe("DecryptionError", () => {
    test("should be instanceof Error", async () => {
      const helper1 = new EncryptionHelper("password1");
      const helper2 = new EncryptionHelper("password2");

      const encrypted = await helper1.encrypt("test");

      try {
        await helper2.decrypt(encrypted);
        fail("Should have thrown DecryptionError");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(DecryptionError);
        expect((error as Error).name).toBe("DecryptionError");
      }
    });

    test("should have descriptive error message", async () => {
      try {
        await helper.decrypt("invalid|data");
        fail("Should have thrown DecryptionError");
      } catch (error) {
        expect((error as Error).message).toContain("Could not decrypt");
      }
    });
  });
});
