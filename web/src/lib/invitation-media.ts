/** Keep invitation media under the same bearer link and private response policy. */
export function invitationMediaUrl(token: string, asset: string) {
  return `/i/${encodeURIComponent(token)}/media/${encodeURIComponent(asset)}`;
}
