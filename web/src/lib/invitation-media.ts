/** Keep invitation media under the same bearer link and private response policy. */
export function invitationMediaUrl(token: string, asset: string) {
  if (token === "public-invitation-groom" || token === "public-invitation-bride") {
    return `/rsvp/${token === "public-invitation-bride" ? "b" : "g"}/media/${encodeURIComponent(asset)}`;
  }
  return `/i/${encodeURIComponent(token)}/media/${encodeURIComponent(asset)}`;
}
