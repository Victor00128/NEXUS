# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in NEXUS, please report it responsibly.

**Please do NOT open a public GitHub issue for security vulnerabilities.**

### What to include

- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if you have one)

### Response timeline

- **Acknowledgement:** within 48 hours
- **Initial assessment:** within 7 days
- **Fix or mitigation:** within 30 days for critical issues

### Scope

In scope:
- The NEXUS API server (`api/`)
- The frontend application (`src/`)
- Docker / deployment configuration
- Authentication and authorization logic

Out of scope:
- Third-party dependencies (report upstream, but let us know)
- Social engineering attacks
- Denial of service attacks against hosted instances

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Security Design

- **Authentication:** Optional API bearer token with constant-time comparison; deployments must configure it explicitly
- **Rate limiting:** Tier-aware sliding window (per-minute + per-day + lifetime)
- **Headers:** HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Permissions-Policy
- **Docker:** The API image runs as a non-root user; deployment images use minimal base images
- **Data:** Dataset contribution is opt-in, but contributed prompts and responses may contain personal or sensitive data. Operators must obtain consent and redact content before enabling publication
