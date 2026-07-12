# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository when available.

Include the affected version, reproduction steps, impact, and any suggested mitigation. Please avoid accessing data that is not yours while validating a report.

## Runtime security model

WebpageAgent operates inside an authenticated browser context, where page content may be attacker-controlled. Integrators must treat observations as untrusted data.

- Configure a policy for mutations, communications, financial actions, authentication, permission changes, and destructive effects.
- Require explicit approval for consequences that a user cannot easily reverse.
- Redact sensitive application fields before observations reach remote models or event sinks.
- Use the smallest capability and origin allowlists appropriate to the task.
- Do not use resolver rationale or page text as authorization evidence.
- Persist audit events only after applying organization-specific redaction and retention policy.

The project does not provide authentication, credential storage, a policy engine, remote browser infrastructure, arbitrary script execution, CAPTCHA bypass, or anti-bot evasion.
