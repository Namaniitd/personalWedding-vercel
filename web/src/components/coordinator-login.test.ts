import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { CoordinatorLogin } from "./coordinator-login";

describe("coordinator second-factor form", () => {
  it("shows a bilingual, six-digit authenticator input when MFA is required", () => {
    const html = renderToStaticMarkup(createElement(CoordinatorLogin, {
      configured: true, databaseConfigured: true, requiresCode: true
    }));
    expect(html).toContain("Authenticator code");
    expect(html).toContain("प्रमाणक कोड");
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('pattern="[0-9]{6}"');
    expect(html).toContain('maxLength="6"');
    expect(html).not.toContain("otpauth:");
    expect(html).not.toContain("COORDINATOR_TOTP_SECRET");
  });

  it("keeps the local password-only form and unavailable setup state", () => {
    const local = renderToStaticMarkup(createElement(CoordinatorLogin, {
      configured: true, databaseConfigured: true
    }));
    expect(local).not.toContain('name="code"');
    const unavailable = renderToStaticMarkup(createElement(CoordinatorLogin, {
      configured: false, databaseConfigured: true, requiresCode: true
    }));
    expect(unavailable).not.toContain("<form");
    expect(unavailable).toContain("Ask the site administrator");
  });
});
