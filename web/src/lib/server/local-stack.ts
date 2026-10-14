/** The only HTTP public origins allowed for built local Podman images. */
export function isLocalStackPublicOrigin() {
  return process.env.NODE_ENV === "production"
    && process.env.LOCAL_STACK_MODE === "1"
    && (process.env.PUBLIC_APP_ORIGIN === "http://127.0.0.1:3000"
      || process.env.PUBLIC_APP_ORIGIN === "http://127.0.0.1:3001"
      || process.env.PUBLIC_APP_ORIGIN === "http://127.0.0.1:3002");
}
