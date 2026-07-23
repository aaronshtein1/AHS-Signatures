# Records Inspection and Quality Assurance Schedule

**AHS Signatures — Regular Inspection Schedule for Electronic I-9 Records**

Effective Date: July 2026
Review Cycle: This schedule itself is reviewed annually.
Regulation Reference: 8 CFR 274a.2(e)–(i), USCIS M-274 Section 10.1

---

## 1. Purpose

This document establishes a regular inspection and quality assurance schedule to ensure the integrity, accuracy, and reliability of electronically stored signature records and Form I-9 documents, as required by DHS regulations and the M-274 Handbook for Employers.

---

## 2. Inspection Schedule Overview

| Inspection | Frequency | Responsible Party | Target |
|------------|-----------|-------------------|--------|
| Signed PDF integrity check | Monthly | System Administrator | All completed packets |
| Audit log completeness review | Monthly | System Administrator | All packets signed in prior month |
| Database backup verification | Weekly | System Administrator | Database and file storage |
| Access control review | Quarterly | Office Manager | User accounts and roles |
| Retention compliance review | Quarterly | HR Manager | Records approaching retention deadline |
| System security review | Semi-annually | System Administrator | Authentication, tokens, access logs |
| Full compliance audit | Annually | Compliance Officer / HR Manager | All procedures and records |

---

## 3. Monthly: Signed PDF Integrity Check

**What:** Verify that signed PDF files have not been altered since creation by comparing stored SHA-256 hashes against re-computed hashes.

**Procedure:**

1. Log into the admin dashboard.
2. Navigate to Packets and filter by status "completed."
3. For a sample of completed packets (minimum 10% or 5 packets, whichever is greater):
   a. Download the signed PDF.
   b. Compute the SHA-256 hash of the downloaded file.
   c. Compare against the `signedPdfHash` value stored in the database (visible in the packet timeline under the "completed" audit entry).
4. Document any mismatches immediately.

**If a mismatch is found:**
- Do not modify or delete any records.
- Document the packet ID, expected hash, and actual hash.
- Notify the Compliance Officer within 24 hours.
- Investigate the cause (storage corruption, unauthorized access, etc.).

**Record:** Log the inspection date, number of records sampled, results (pass/fail), and inspector name.

---

## 4. Monthly: Audit Log Completeness Review

**What:** Verify that all signing transactions from the prior month have complete audit trails.

**Procedure:**

1. Query completed packets from the prior month.
2. For each packet, verify the timeline contains the expected sequence:
   - `created` (with admin identity)
   - `sent` (with admin identity)
   - `viewed` (with signer IP and userAgent)
   - `attestation_acknowledged` (with signer name and email)
   - `signed` (with signature type and identity record notation)
   - `completed` (with SHA-256 hash)
3. Verify that multi-signer packets show the correct sequential signing order.
4. Flag any packets missing expected audit entries.

**Record:** Log the inspection date, number of packets reviewed, any anomalies, and inspector name.

---

## 5. Weekly: Database Backup Verification

**What:** Confirm that automated database backups are running and restorable.

**Procedure:**

1. Verify Neon database branch backups are active (Neon provides automatic point-in-time recovery).
2. Check the Neon dashboard for the most recent backup timestamp.
3. Confirm the backup is within the last 24 hours.
4. Quarterly: perform a test restore to a separate branch to verify data recoverability.

**Record:** Log the verification date, most recent backup timestamp, and any issues.

---

## 6. Quarterly: Access Control Review

**What:** Review user accounts to ensure only authorized personnel have access.

**Procedure:**

1. Navigate to the Users page in the admin dashboard.
2. Review all user accounts:
   - Verify each active account belongs to a current employee.
   - Confirm admin roles are assigned only to authorized personnel.
   - Deactivate accounts for separated employees.
3. Review Microsoft SSO accounts (auto-created on first login for @homecare4all.org users):
   - Verify all SSO accounts correspond to current employees.
   - Ensure role assignments are appropriate.

**Record:** Log the review date, number of active accounts, any changes made, and reviewer name.

---

## 7. Quarterly: Retention Compliance Review

**What:** Identify records that have passed their retention deadline and may be purged, and records that must continue to be retained.

**Procedure:**

1. Review completed signing packets older than 3 years from the hire date.
2. Cross-reference with HR records to determine:
   - If the employee is still active (retain until 1 year after separation).
   - If the employee separated more than 1 year ago AND the record is more than 3 years from hire (eligible for purging).
3. Do NOT delete records that are within the retention period.
4. For records eligible for purging, obtain written authorization from the HR Manager before deletion.

**Retention Formula:**
- Retain until the LATER of: (a) 3 years after hire date, or (b) 1 year after employment ends.

**Record:** Log the review date, number of records reviewed, records flagged for retention/purging, and reviewer name.

---

## 8. Semi-Annual: System Security Review

**What:** Review system security controls and access patterns.

**Procedure:**

1. Review JWT token configuration (expiration period, secret rotation needs).
2. Review signing token expiration settings.
3. Check CORS configuration to ensure only authorized domains are allowed.
4. Review server logs for unusual access patterns or failed authentication attempts.
5. Verify SSL/TLS certificates are current.
6. Confirm environment variables and secrets are properly secured.

**Record:** Log the review date, findings, any remediation actions taken, and reviewer name.

---

## 9. Annual: Full Compliance Audit

**What:** Comprehensive review of all electronic signature procedures against M-274 requirements.

**Procedure:**

1. Review and update the Electronic Signature Business Process Documentation.
2. Verify all M-274 Section 10.1 requirements are still met:
   - [ ] System allows attestation acknowledgment before signing
   - [ ] Electronic signatures are attached to completed forms
   - [ ] Signatures are affixed at time of transaction
   - [ ] Identity verification records are created and preserved
   - [ ] Printed transaction confirmations are available on request
   - [ ] Reasonable integrity, accuracy, and reliability controls exist
   - [ ] Tamper prevention mechanisms are in place (PDF hash verification)
   - [ ] Indexing system allows record identification and retrieval
   - [ ] System can produce legible paper reproductions
   - [ ] Access is restricted to authorized personnel
   - [ ] Backup and recovery systems are operational
   - [ ] Staff are trained on preventing accidental alterations
   - [ ] Audit trails capture access date, user identity, and actions taken
3. Review any system changes made during the year for compliance impact.
4. Update this inspection schedule if procedures have changed.
5. Conduct or schedule staff training refresher.

**Record:** Log the audit date, all checklist results, any deficiencies found, remediation plan, and auditor name.

---

## 10. Inspection Log Template

| Date | Inspection Type | Inspector | Records Sampled | Result | Notes |
|------|----------------|-----------|-----------------|--------|-------|
| | | | | Pass / Fail | |

---

## 11. Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | July 2026 | AHS Administration | Initial document |
