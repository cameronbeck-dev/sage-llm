import * as dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const BLOCKED_RANGES = new Set([
  'loopback',
  'linkLocal',
  'private',
  'uniqueLocal',
  'carrierGradeNat',
  'multicast',
  'unspecified',
  'broadcast',
  'reserved',
]);

export interface SafeUrl {
  url: URL;
  pinnedIp: string;
  family: 4 | 6;
}

export async function assertSafeUrl(input: string): Promise<SafeUrl> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw { error: 'invalid_url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw { error: 'unsupported_protocol' };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw { error: 'dns_lookup_failed' };
  }

  if (addresses.length === 0) {
    throw { error: 'dns_no_results' };
  }

  for (const { address } of addresses) {
    let parsed: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      parsed = ipaddr.parse(address);
    } catch {
      throw { error: 'invalid_address' };
    }
    const range = parsed.range();
    if (BLOCKED_RANGES.has(range)) {
      throw { error: 'blocked: private address' };
    }
  }

  const first = addresses[0];
  return {
    url,
    pinnedIp: first.address,
    family: first.family as 4 | 6,
  };
}
