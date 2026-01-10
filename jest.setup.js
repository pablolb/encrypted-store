import { TextEncoder, TextDecoder } from 'util';
import { TransformStream, ReadableStream, WritableStream } from 'stream/web';
import { webcrypto } from 'crypto';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
global.TransformStream = TransformStream;
global.ReadableStream = ReadableStream;
global.WritableStream = WritableStream;

// Provide crypto with subtle for Fireproof
global.crypto = webcrypto;

// Minimal browser globals for Fireproof
global.window = global;
global.document = {
  createElement: () => ({}),
  head: { appendChild: () => {} },
};
global.navigator = {
  userAgent: 'node.js',
};
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};
global.indexedDB = undefined;
