import re

path = "packages/pcc-schema/src/index.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Remove the old duplicate canonicalization code block
old_block = """function getCanonicalJson(): any {
  if (!canonicalJsonLib) {
    canonicalJsonLib = require('canonical-json');
  }
  return canonicalJsonLib;
}

export function canonicalize(data: unknown): string {
  const canonicalJson = getCanonicalJson();
  return canonicalJson(data);
}

export function hashCanonical(data: unknown): string {
  const crypto = require('crypto');
  const canonical = canonicalize(data);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return `sha256:${hash}`;
}
"""

content = content.replace(old_block, "")

# Remove unused variable declaration if present
content = content.replace("let canonicalJsonLib: any = null;\n", "")

# Fix any in validateProperty signature
content = content.replace(
    "function validateProperty(value: unknown, propSchema: any, path: string): void {",
    "function validateProperty(value: unknown, propSchema: Record<string, unknown>, path: string): void {"
)

# Fix any in validateSemantic signature
content = content.replace(
    "export function validateSemantic(data: any): { valid: boolean; errors: string[] } {",
    "export function validateSemantic(data: Record<string, unknown>): { valid: boolean; errors: string[] } {"
)

# Fix any inside validateSemantic for evidence map
content = content.replace(
    "const evidenceIds = new Set(data.evidence.map((e: any) => e.evidence_id));",
    "const evidenceIds = new Set((data.evidence as Array<Record<string, unknown>>).map((e) => e.evidence_id as string));"
)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Fixed index.ts")
