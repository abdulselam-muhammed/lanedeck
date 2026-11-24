// Log scrubbing: nothing that looks like a credential reaches disk or the UI.
const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***PRIVATE KEY***'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '***'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '***'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '***'],
  [/\bsntrys_[A-Za-z0-9_=+/-]{20,}/g, '***'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '***JWT***'],
  [/(authorization\s*[:=]\s*)(bearer|token|basic)\s+[^\s"']+/gi, '$1$2 ***'],
  [/(x-access-token:)[^@\s]+@/gi, '$1***@'],
  [/(https?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1***@'],
  [/\b((?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY))\s*[=:]\s*)(["']?)[^\s"']{6,}\2/g, '$1$2***$2'],
];
export function scrub(s) {
  let out = String(s);
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
