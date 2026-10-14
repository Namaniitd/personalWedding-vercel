const MAX_SUPABASE_URL_LENGTH = 2_048;

/**
 * Validate the service endpoint before a server-only Supabase key is ever
 * supplied to a client. This deliberately accepts only canonical project
 * endpoints on Supabase's hosted domain, not arbitrary HTTPS destinations.
 */
export function configuredHostedSupabaseUrl() {
  // A service-role key is sent in both Authorization and apikey headers.
  // Node's global TLS bypass would let an on-path peer read that key even
  // when the configured project URL is canonical HTTPS.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("Hosted Supabase requires TLS certificate verification.");
  }

  const value = process.env.SUPABASE_URL;
  if (!value || value.length > MAX_SUPABASE_URL_LENGTH || value.trim() !== value) {
    throw new Error("SUPABASE_URL is not configured.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL must be a valid canonical HTTPS Supabase project URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || hostname === "supabase.co"
    || !hostname.endsWith(".supabase.co")
    || value !== parsed.origin
  ) {
    throw new Error("SUPABASE_URL must be a canonical HTTPS Supabase project URL.");
  }

  return parsed.origin;
}

export function hasConfiguredHostedSupabaseUrl() {
  try {
    configuredHostedSupabaseUrl();
    return true;
  } catch {
    return false;
  }
}
