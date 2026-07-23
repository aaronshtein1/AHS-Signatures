# Staff Training Guide: Preventing Accidental Alterations to Signed Records

**AHS Signatures — Training Materials for Authorized Personnel**

Effective Date: July 2026
Training Cycle: Upon onboarding + annual refresher
Regulation Reference: 8 CFR 274a.2(e)–(i), USCIS M-274 Section 10.1

---

## 1. Purpose

This guide trains authorized staff on the proper use of the AHS Signatures system and the procedures for preventing accidental alterations to electronically signed records. All administrators with access to the system must complete this training before being granted admin access.

---

## 2. Who Must Complete This Training

- All employees with "Admin" role in AHS Signatures
- Any employee who manages, views, or handles signed documents
- New administrators must complete training before first use
- All trained staff must complete an annual refresher

---

## 3. Understanding Record Integrity

### Why It Matters

Electronic signatures on employment documents (including Form I-9) carry the same legal weight as handwritten signatures. Federal regulations require that employers:

- Prevent unauthorized creation, modification, deletion, or deterioration of signed records
- Maintain complete audit trails of all actions taken on records
- Ensure only authorized personnel access electronic records
- Produce records within 3 business days if requested by DHS, DOJ, or DOL

**Altering, deleting, or corrupting a signed record — even accidentally — can result in federal penalties and legal liability.**

### What Constitutes a "Record"

In AHS Signatures, the following are protected records once a document has been sent for signing:

- The original uploaded PDF document
- The signed (completed) PDF document
- All signature data (drawn images, typed names, identity records)
- The audit log / timeline for each packet
- Attestation text and acknowledgment records
- Transaction confirmations

---

## 4. Rules for Handling Signed Records

### 4.1 Never Modify Completed Packets

Once a signing packet reaches "completed" status:

- **DO NOT** attempt to edit, rename, or modify the packet in any way.
- **DO NOT** delete the packet or its associated files.
- **DO NOT** download the signed PDF and re-upload a modified version.
- **DO NOT** manually edit database records.

If a completed document contains an error, the correct procedure is to create a new packet with the corrected document and route it for new signatures. The original signed record must be retained.

### 4.2 Use Caution with Active Packets

For packets that are in "sent" or "in_progress" status:

- **Reassignment** is permitted if a signer needs to change (e.g., wrong person assigned). Use the Reassign feature — this creates an audit trail.
- **Cancellation** is permitted if a packet was sent in error. Use the Cancel feature — this creates an audit trail. Cancelled packets are retained, not deleted.
- **Resending** a link is safe and creates an audit trail.
- **DO NOT** delete active packets. Only draft packets can be deleted.

### 4.3 Draft Packets

Draft packets (not yet sent) may be:

- Edited (change name, update recipients)
- Deleted (if created in error)

Once a draft is sent, it becomes a protected record.

### 4.4 User Management

When managing user accounts:

- **DO NOT** delete user accounts. Instead, deactivate them using the toggle switch.
- **DO NOT** change another admin's role without authorization.
- You cannot deactivate your own account or remove your own admin role (the system prevents this).

---

## 5. Common Mistakes to Avoid

| Mistake | Why It's a Problem | What to Do Instead |
|---------|-------------------|-------------------|
| Deleting a completed packet from the database | Destroys the legal record and audit trail | Retain all completed records; create a new corrected packet if needed |
| Modifying a signed PDF file in storage | Breaks the SHA-256 integrity hash; the file will fail verification | Never modify signed PDFs; create a new signing packet |
| Sharing your admin credentials | Compromises audit trail integrity (actions attributed to wrong person) | Each admin must have their own account; use Microsoft SSO |
| Cancelling a completed packet | This is blocked by the system, but attempting it indicates confusion | Completed packets cannot be changed; create a new one if corrections are needed |
| Bypassing the system to sign documents | Paper or email-based signatures lack the required audit trail | Always use AHS Signatures for documents requiring electronic signatures |
| Deleting audit log entries from the database | Destroys the compliance-required audit trail | Never access the database directly; all actions must go through the application |

---

## 6. Proper Procedures

### 6.1 Creating a Signing Packet

1. Upload the PDF document.
2. Verify placeholder tags are detected (signature, date, text fields).
3. Enter accurate recipient information (name, email, role, order).
4. Review all details before sending.
5. Send — the system will email the first signer automatically.

### 6.2 Monitoring Signing Progress

1. Check the Packets page for status updates.
2. Use the packet detail view to see the timeline of all events.
3. If a signer hasn't responded, use "Resend" to send a new link.
4. If a signer needs to change, use "Reassign" with the new signer's information.

### 6.3 Handling Completed Documents

1. The signed PDF is automatically stored and emailed to all parties.
2. If SharePoint is configured, the signed PDF is automatically uploaded.
3. To verify document integrity, check the SHA-256 hash in the completion audit entry against the stored file.
4. Retain the record according to the retention schedule.

### 6.4 If You Make a Mistake

- **Sent to wrong person**: Use Reassign to correct the recipient. This preserves the audit trail.
- **Wrong document uploaded**: Cancel the packet and create a new one with the correct document.
- **Need to correct a completed document**: Create a new packet with the corrected document. Do not alter the original.
- **Accidentally clicked something**: Check the packet timeline — all actions are logged. If no harmful action was taken, no further steps are needed.
- **Unsure what to do**: Ask your supervisor or the Compliance Officer before taking action.

---

## 7. Security Practices

### 7.1 Account Security

- Use Microsoft SSO (Sign in with Microsoft) for authentication when available.
- If using email/password login, use a strong password (minimum 12 characters).
- Never share your login credentials with anyone.
- Log out when leaving your workstation.
- Report any suspicious account activity immediately.

### 7.2 Recognizing Problems

Report to your supervisor or Compliance Officer if you notice:

- Signed documents that appear different from what was originally sent
- Audit log entries you don't recognize
- User accounts you don't recognize
- Missing packets or records
- Any error messages related to integrity hash mismatches
- Anyone requesting direct database access to modify records

---

## 8. Training Acknowledgment

I acknowledge that I have read and understand this training guide. I understand my responsibilities for maintaining the integrity of electronically signed records and will follow the procedures described above.

| Field | Value |
|-------|-------|
| Employee Name | _________________________ |
| Employee Signature | _________________________ |
| Date | _________________________ |
| Trainer Name | _________________________ |
| Trainer Signature | _________________________ |

---

## 9. Training Log

| Employee Name | Training Date | Type (Initial/Refresher) | Trainer |
|---------------|--------------|--------------------------|---------|
| | | | |

---

## 10. Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | July 2026 | AHS Administration | Initial document |
