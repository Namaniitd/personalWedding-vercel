"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { WeddingSide } from "@/lib/types";
import { coordinatorApiPath, coordinatorPath } from "@/lib/wedding-side";

function errorMessage(value: unknown) {
  if (
    value
    && typeof value === "object"
    && "error" in value
    && typeof value.error === "string"
  ) return value.error;
  return "Coordinator sign-in could not be completed.";
}

export function CoordinatorLogin({ configured, databaseConfigured: coordinatorAvailable, requiresCode = false, side = "groom" }: { side?: WeddingSide; configured: boolean; databaseConfigured: boolean; requiresCode?: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const team = side === "bride" ? "bride’s" : "groom’s";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await fetch(coordinatorApiPath("login", side), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(requiresCode ? { code } : {}) })
      });
      if (response.ok) {
        router.replace(coordinatorPath(side));
        return;
      }
      setMessage(errorMessage(await response.json().catch(() => null)));
    } catch {
      setMessage("Coordinator sign-in could not be completed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="coordinator-login-page">
      <section className="coordinator-login-card" aria-labelledby="coordinator-login-title">
        <div className="coordinator-login-mark" aria-hidden="true">W<span>&amp;</span>W</div>
        <p className="coordinator-login-kicker">{side === "bride" ? "Bride’s coordinator" : "Groom’s coordinator"}</p>
        <nav className="coordinator-side-choice" aria-label="Choose your coordinator workspace">
          <a href={coordinatorPath("groom", "login")} aria-current={side === "groom" ? "page" : undefined}>Groom’s side</a>
          <a href={coordinatorPath("bride", "login")} aria-current={side === "bride" ? "page" : undefined}>Bride’s side</a>
        </nav>
        <h1 id="coordinator-login-title">Welcome back.</h1>
        <p className="coordinator-login-copy">
          {requiresCode
            ? `Sign in with the ${team} coordinator password and the code from that team’s authenticator app.`
            : `Sign in with the ${team} coordinator password provided by the wedding administrator.`}
        </p>

        {configured ? (
          <form className="coordinator-login-form" onSubmit={submit}>
            <label htmlFor="coordinator-password">Coordinator password</label>
            <input
              id="coordinator-password"
              name="password"
              type="password"
              autoComplete="current-password"
              minLength={16}
              maxLength={512}
              required
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {requiresCode ? (
              <>
                <label htmlFor="coordinator-code">Authenticator code <span lang="hi">/ प्रमाणक कोड</span></label>
                <input
                  id="coordinator-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  aria-describedby="coordinator-code-hint"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                />
                <p className="coordinator-login-copy" id="coordinator-code-hint">
                  Enter the current 6-digit code. <span lang="hi">अपने प्रमाणक ऐप का मौजूदा 6 अंकों का कोड दर्ज करें।</span>
                </p>
              </>
            ) : null}
            {message ? <p className="coordinator-login-error" role="alert">{message}</p> : null}
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <div className="coordinator-login-setup" role="status">
            <p>{coordinatorAvailable ? `The ${team} coordinator sign-in is not available yet.` : "The invitation service is currently unavailable for coordinators."}</p>
            <p className="coordinator-login-setup-hint">
              {coordinatorAvailable
                ? `Ask the site administrator to complete sign-in setup for the ${team} workspace.`
                : "Ask the site administrator to check the invitation API service, then try again."}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
