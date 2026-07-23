# Electronic Signature Business Process Documentation

**AHS Signatures — E-Signature Capture, Storage, and Verification Procedures**

Effective Date: July 2026
Review Cycle: Annually or upon system changes
Regulation Reference: 8 CFR 274a.2(e)–(i), USCIS M-274 Handbook for Employers (Section 10.1)

---

## 1. Purpose

This document describes the business processes by which AHS Signatures captures, stores, verifies, and retains electronic signatures on employment-related documents, including Form I-9. These procedures are designed to meet the requirements of the Department of Homeland Security (DHS) for electronic signature systems as outlined in the M-274 Handbook for Employers.

---

## 2. System Overview

AHS Signatures is a web-based document signing platform that:

- Accepts PDF documents uploaded by authorized administrators
- Detects signature, date, and text field placeholders in documents
- Routes documents to designated signers via secure, time-limited email links
- Captures electronic signatures (drawn or typed) with full identity records
- Produces signed PDF documents with signatures stamped in place
- Maintains a complete audit trail of all actions

**System Components:**
- Frontend: Next.js web application (hosted on Vercel)
- Backend: Hono API server (hosted on Neon Functions)
- Database: PostgreSQL (Neon Serverless Postgres)
- File Storage: Neon Object Storage (S3-compatible)
- Email: SMTP (Gmail) for signing notifications

---

## 3. Electronic Signature Capture Process

### 3.1 Document Preparation

1. An authorized administrator uploads a PDF document to the system.
2. The system scans the PDF for signature placeholder tags (Adobe Sign format or custom format).
3. The administrator assigns recipients (signers) with names, email addresses, roles, and signing order.
4. The administrator reviews and sends the signing packet.

### 3.2 Signer Notification

1. The system generates a cryptographically secure signing token (256-bit random, 64 hex characters) for each recipient.
2. The token is stored in the database and has a configurable expiration period (default: 7 days).
3. An email containing a unique signing URL is sent to the first signer in the sequence.
4. Subsequent signers are notified only after all preceding signers have completed.

### 3.3 Attestation and Disclosure (Step 1 of 3)

Before signing, the signer must:

1. Read the full **Electronic Signature Disclosure and Consent**, which includes:
   - Identity confirmation (signer is the named individual)
   - Intent to sign (electronic signature carries same legal weight as handwritten)
   - Attestation under penalty of perjury that information is true and correct
   - Document review acknowledgment
   - Record of transaction disclosure (name, email, IP, browser, timestamp will be preserved)
   - Right to request a printed copy of the transaction confirmation
2. Scroll to the bottom of the disclosure (enforced by the system — the acknowledgment checkbox is disabled until full scroll is detected).
3. Check the acknowledgment checkbox to confirm they have read and understood the disclosure.

The exact attestation text is stored verbatim in the database with the signature record.

### 3.4 Signature Capture (Step 2 of 3)

The signer provides their signature using one of two methods:

- **Drawn signature**: The signer draws their signature on a digital canvas using a mouse, stylus, or finger. The signature is captured as a PNG image (base64-encoded).
- **Typed signature**: The signer types their full legal name and selects a font style. The name is stored as text.

In both cases, the signer must also enter their **full legal name** in a separate text field.

### 3.5 Review and Confirmation (Step 3 of 3)

Before final submission, the signer reviews:

- Their name and email
- The document name
- A preview of their signature
- Attestation status (acknowledged)
- Current date and time

The signer must check a confirmation box stating: "I confirm that I am [Name] and I am the intended signer of this document."

An identity verification notice informs the signer that their name, email, IP address, browser information, and secure access token will be recorded.

### 3.6 Submission and Record Creation

Upon submission, the system creates the following records **server-side**:

**Signature Record:**
| Field | Description |
|-------|-------------|
| signatureData | Base64 PNG image (drawn) or typed name (typed) |
| signatureType | "drawn" or "typed" |
| typedName | Full legal name entered by signer |
| textFields | JSON of additional field values (dates, initials, etc.) |
| ipAddress | Client IP address (from X-Forwarded-For header) |
| userAgent | Browser/device identification string |
| attestationText | Verbatim copy of the disclosure text the signer acknowledged |
| identityRecord | JSON containing email, name, SHA-256 hash of signing token, IP, userAgent, and ISO timestamp |
| createdAt | Server timestamp of signature creation |

**Audit Log Entries:**
- `attestation_acknowledged` — with signer name, email, IP, userAgent
- `signed` — with signer name, email, signature type, identity record preserved

---

## 4. Document Completion and PDF Generation

When all signers in the sequence have signed:

1. The system retrieves the original PDF and all signature records.
2. Signature placeholder tags in the PDF content streams are replaced with the signer's name, rendered in blue italic text at the original tag position.
3. Date and text fields are similarly replaced with values provided by signers.
4. The signed PDF is saved to object storage at path: `signed/signed_{packetId}_{timestamp}.pdf`
5. A **SHA-256 integrity hash** of the signed PDF is computed and stored in the database (`signedPdfHash` column) and recorded in the audit log.
6. The packet status is updated to "completed" with a completion timestamp.
7. Completion emails with the signed PDF attached are sent to all signers and the admin.

---

## 5. Electronic Storage and Retention

### 5.1 Storage Locations

| Data | Location | Encryption |
|------|----------|------------|
| Signature records | PostgreSQL database (Neon) | Encrypted at rest (AES-256) |
| Original PDFs | Neon Object Storage (S3) | Encrypted at rest |
| Signed PDFs | Neon Object Storage (S3) | Encrypted at rest |
| Audit logs | PostgreSQL database (Neon) | Encrypted at rest |

### 5.2 Retention Period

Records are retained in accordance with 8 CFR 274a.2(b)(2):

- **Employees who worked fewer than 2 years**: 3 years from hire date
- **Employees who worked 2+ years**: 1 year after termination date
- **Whichever date is later** governs the retention period

Records must be producible within **3 business days** of an inspection request from DHS, DOJ Civil Rights Division, or Department of Labor.

### 5.3 Integrity Verification

- Each signed PDF has a SHA-256 hash stored in the database at time of creation.
- To verify document integrity, re-compute the hash of the stored PDF and compare against the recorded hash.
- Any mismatch indicates the document has been altered after signing.

### 5.4 Access Control

- Only authenticated administrators can access packet management, user management, and audit logs.
- Authentication uses JWT tokens stored in HTTP-only, Secure, SameSite cookies.
- Signing links use cryptographically random tokens with expiration dates.
- The admin user management page allows role assignment and account deactivation.

---

## 6. Audit Trail

### 6.1 Events Logged

| Action | Trigger | Details Captured |
|--------|---------|-----------------|
| created | Packet uploaded | Packet name, recipient count, admin identity |
| updated | Packet modified | Fields changed, admin identity |
| sent | Signing request dispatched | Recipient email, admin identity |
| viewed | Signer opens document | Signer name, IP, userAgent |
| attestation_acknowledged | Signer checks disclosure | Signer name, email, IP, userAgent |
| signed | Signature submitted | Signer name, email, signature type, IP, userAgent |
| completed | All signatures collected | PDF integrity hash (SHA-256) |
| resent | Reminder link sent | Recipient email, admin identity |
| reassigned | Signer changed | Old/new signer details, admin identity |
| cancelled | Packet cancelled | Admin identity |
| uploaded | SharePoint upload | SharePoint URL, folder match info |
| deleted (server log) | Draft packet removed | Admin identity (logged to server console) |

### 6.2 Audit Record Fields

Each audit log entry contains:
- Unique ID
- Packet ID (links to the document)
- Recipient ID (if applicable)
- Action type
- Details (human-readable description including admin identity for admin actions)
- IP address (for signer actions)
- User agent (for signer actions)
- Timestamp (server-generated)

### 6.3 Audit Trail Integrity

- Audit log entries are append-only in normal application operation.
- Database access is restricted to the application service account.
- All admin actions include the performing administrator's name and email in the audit details.
- The signing token stored in the identity record is a one-way SHA-256 hash (the plaintext token is not retained after use).

---

## 7. Identity Verification Process

The system verifies signer identity through the following mechanisms:

1. **Email-gated access**: Signing links are sent only to the designated email address.
2. **Unique cryptographic token**: Each signing link contains a 256-bit random token.
3. **Token expiration**: Tokens expire after a configurable period (default: 7 days).
4. **One-time use**: Each recipient can only sign once; subsequent attempts are rejected.
5. **Sequential enforcement**: Signers cannot access the document until all preceding signers have completed.
6. **Explicit confirmation**: Signers must check a box confirming they are the named individual.
7. **Identity record**: Server-side record captures email, name, token hash, IP, userAgent, and timestamp.
8. **Attestation**: Signer acknowledges under penalty of perjury that information is true and correct.

---

## 8. Transaction Confirmation

After signing, the system displays a transaction confirmation containing:

- Confirmation ID (unique signature record ID)
- Signer name, email, and role
- Document name and file name
- Signature type and typed name
- Signing timestamp
- Attestation status
- Identity details (IP address, browser, signing time)

Signers can print this confirmation using the "Print Confirmation" button. Per the Electronic Signature Disclosure, signers may request a printed copy at any time.

---

## 9. Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | July 2026 | AHS Administration | Initial document |
