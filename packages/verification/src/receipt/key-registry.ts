/** Public-key registry. No private key is ever stored here. */

export type KeyStatus = 'active' | 'retiring' | 'retired' | 'revoked';

export interface KeyRecord {
  key_id: string;
  algorithm: 'Ed25519';
  public_key: Uint8Array;
  status: KeyStatus;
  valid_from: string;
  valid_until?: string;
  retired_at?: string;
  purpose: string;
  environment: 'test' | 'production';
  replacement_key_id?: string;
}

export class KeyRegistry {
  private readonly keys = new Map<string, KeyRecord>();

  register(record: KeyRecord): void {
    if (this.keys.has(record.key_id)) {
      throw new Error(`key_id ${record.key_id} already registered — key IDs cannot be reused`);
    }
    this.keys.set(record.key_id, record);
  }

  get(keyId: string): KeyRecord | undefined {
    return this.keys.get(keyId);
  }

  retire(keyId: string, retiredAtIso: string, replacementKeyId?: string): void {
    const record = this.keys.get(keyId);
    if (!record) throw new Error(`unknown key_id: ${keyId}`);
    this.keys.set(keyId, {
      ...record,
      status: 'retired',
      retired_at: retiredAtIso,
      replacement_key_id: replacementKeyId,
    });
  }

  revoke(keyId: string): void {
    const record = this.keys.get(keyId);
    if (!record) throw new Error(`unknown key_id: ${keyId}`);
    this.keys.set(keyId, { ...record, status: 'revoked' });
  }

  /** Retired keys still verify historical receipts; revoked keys do not. */
  canVerifyWith(keyId: string): boolean {
    const record = this.keys.get(keyId);
    if (!record) return false;
    return (
      record.status === 'active' || record.status === 'retiring' || record.status === 'retired'
    );
  }
}
