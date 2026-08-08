export interface EncodingDetectionResult {
  encoding: string;
  confidence: number;
  bom: boolean;
}

export function detectEncoding(bytes: Uint8Array): EncodingDetectionResult {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', confidence: 1.0, bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', confidence: 1.0, bom: true };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', confidence: 1.0, bom: true };
  }

  let utf8Valid = true;
  let asciiOnly = true;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte > 127) asciiOnly = false;
    if (byte >= 0x80) {
      if (byte < 0xc0 || byte > 0xf4) {
        utf8Valid = false;
        break;
      }
      const expectedContinuation = byte >= 0xf0 ? 3 : byte >= 0xe0 ? 2 : 1;
      if (i + expectedContinuation >= bytes.length) {
        utf8Valid = false;
        break;
      }
      for (let j = 1; j <= expectedContinuation; j++) {
        if (bytes[i + j] < 0x80 || bytes[i + j] > 0xbf) {
          utf8Valid = false;
          break;
        }
      }
      if (!utf8Valid) break;
      i += expectedContinuation;
    }
  }

  if (utf8Valid) {
    return { encoding: asciiOnly ? 'ascii' : 'utf-8', confidence: 0.95, bom: false };
  }

  return { encoding: 'iso-8859-1', confidence: 0.5, bom: false };
}

export function decodeWithFallback(bytes: Uint8Array, declaredEncoding?: string): string {
  const detected = detectEncoding(bytes);
  const encoding = declaredEncoding || detected.encoding;

  try {
    const decoder = new TextDecoder(encoding, { fatal: true });
    return decoder.decode(bytes);
  } catch {
    try {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      return decoder.decode(bytes);
    } catch {
      return new TextDecoder('iso-8859-1', { fatal: false }).decode(bytes);
    }
  }
}

export function stripBom(text: string): string {
  if (text.startsWith('\uFEFF')) {
    return text.slice(1);
  }
  return text;
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function sanitizeControlChars(text: string): string {
  // Remove control characters except tab (\t), newline (\n), and carriage return (\r)
  // Control chars: 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F
  const controlChars = '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]';
  return text.replace(new RegExp(controlChars, 'gu'), '');
}

export function truncateText(
  text: string,
  maxLength: number
): { text: string; truncated: boolean } {
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: text.slice(0, maxLength), truncated: true };
}
