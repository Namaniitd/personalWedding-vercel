import Foundation
import Security

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(EXIT_FAILURE)
}

guard CommandLine.arguments.count == 3 else {
    fail("Usage: swift scripts/export-macos-ca.swift <exact trusted subject name> <output.pem>")
}

let subjectName = CommandLine.arguments[1]
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
var anchors: CFArray?
let status = SecTrustCopyAnchorCertificates(&anchors)
guard status == errSecSuccess, let certificates = anchors as? [SecCertificate] else {
    fail("Cannot read macOS trusted anchors (status \(status)).")
}

let matches = certificates.filter {
    (SecCertificateCopySubjectSummary($0) as String?) == subjectName
}
guard matches.count == 1 else {
    fail("Expected exactly one trusted anchor named '\(subjectName)'; found \(matches.count).")
}

// Copy certificate bytes only. This API does not access private keys or
// change the machine's trust settings.
let certificateData = SecCertificateCopyData(matches[0]) as Data
let base64 = certificateData.base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
let pem = "-----BEGIN CERTIFICATE-----\n" + base64 + "\n-----END CERTIFICATE-----\n"

do {
    try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    try Data(pem.utf8).write(to: outputURL, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: outputURL.path)
    print("Exported public macOS trusted anchor: \(subjectName)")
} catch {
    fail("Cannot export the trusted certificate: \(error.localizedDescription)")
}
