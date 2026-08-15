# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in dsh-lsp-actions,
please report it privately:

- **Preferred:** use GitHub's private vulnerability reporting on the
  [Security tab](https://github.com/PerryLink/dsh-lsp-actions/security/advisories/new)
  of this repository. This keeps the report confidential and lets us coordinate
  a fix and a CVE/security advisory with you.
- If that is not available to you, email the repository maintainer (see the
  commit history for contact details) with `[SECURITY]` in the subject.

**Before reporting, sanitize everything you share:** remove tokens, API keys,
credentials, request headers, personal paths, and any other sensitive data.
Minimal proof-of-concept material is welcome; never send real secrets.

## What to include

- Affected version(s) of dsh-lsp-actions and the DeepSeek Harness runtime.
- A short description of the vulnerability and its impact.
- Steps to reproduce (sanitized) or a minimal proof of concept.
- Whether you plan to disclose publicly, and your preferred embargo timeline.

## Response expectations

- We will acknowledge your report within **5 business days**.
- We aim to confirm the issue and publish a fixed release within **30 days**,
  depending on severity. High-severity issues are prioritized.
- If we determine the report is out of scope or not a vulnerability, we will
  tell you and explain why.

## Disclosure

- We follow coordinated disclosure: fixes are released before public details,
  and we credit reporters in the release notes and advisory unless you ask to
  remain anonymous.
- You are free to disclose after the fix has shipped (or after 90 days from
  acknowledgement if no fix has shipped), and we will not pursue reports made
  in good faith under this policy.
