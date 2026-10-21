/** Raw invitation URLs are exported only from the one-time issuance result. */
export function buildInvitationLinkCsv(invitations: { householdName: { en: string; hi: string }; preferredLocale: "en" | "hi"; contactNumber?: string; invitationUrl: string }[]) {
  const quote = (value: string) => {
    const safe = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [["name", "contactnumber", "invitationurl"], ...invitations.map((invitation) => [
    invitation.householdName[invitation.preferredLocale], invitation.contactNumber ?? "", invitation.invitationUrl
  ])].map((row) => row.map(quote).join(",")).join("\r\n");
}
