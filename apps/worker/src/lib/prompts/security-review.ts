/**
 * Prompt de revisión de seguridad — réplica fiel del comando `/security-review`
 * de Claude Code (extraído del binario v2.1.140), adaptado para el verifier
 * HEADLESS del Forge.
 *
 * Qué se mantiene PIXEL-PERFECT del original (es el valor real — conocimiento
 * de seguridad destilado de miles de reviews de Anthropic):
 *  - Las categorías de vulnerabilidad a examinar.
 *  - Las CRITICAL INSTRUCTIONS (>80% confianza, minimizar falsos positivos).
 *  - Las 17 HARD EXCLUSIONS + 12 PRECEDENTS + signal quality criteria.
 *  - Severity guidelines + confidence scoring.
 *
 * Qué se ADAPTA para el worker (documentado en cada punto):
 *  1. El contexto git se INYECTA como texto (el worker headless no expande
 *     los comandos `!`git ...`` que Claude Code interactivo ejecuta).
 *  2. El diff range conceptual es `origin/<baseBranch>..HEAD` — el cambio que
 *     ESTA story introdujo sobre el sprint-batch, no `origin/HEAD...` del repo.
 *  3. UNA sola pasada (sin sub-tasks Task). El original usa sub-tasks paralelas
 *     para filtrar falsos positivos; acá las omitimos para acotar costo y
 *     timeout del verifier (que ya es un cuello de botella). Las reglas de
 *     filtrado se aplican inline en la misma pasada.
 *  4. Emite un bloque `VERDICT_JSON` machine-readable al final ADEMÁS del
 *     markdown, para que el worker mapee findings → passed/failed sin parsear
 *     prosa.
 */

export interface SecurityReviewContext {
  /** Output de `git status` en el workdir. */
  gitStatus: string;
  /** Output de `git diff --name-only origin/<base>..HEAD`. */
  filesModified: string;
  /** Output de `git log --no-decorate origin/<base>..HEAD`. */
  commits: string;
  /** Output de `git diff origin/<base>..HEAD` (puede venir truncado). */
  diffContent: string;
}

/**
 * Construye el prompt del verifier de seguridad con el contexto git inyectado.
 * El cuerpo (categorías + exclusiones + precedents) es transcripción fiel del
 * comando oficial; solo cambian el contexto, el flujo de una pasada y el
 * formato de salida con verdict parseable.
 */
export function buildSecurityReviewPrompt(ctx: SecurityReviewContext): string {
  const fence = '```';
  return [
    `You are a senior security engineer conducting a focused security review of the changes on this branch.`,
    ``,
    `GIT STATUS:`,
    ``,
    fence,
    ctx.gitStatus.trim() || '(sin cambios reportados)',
    fence,
    ``,
    `FILES MODIFIED:`,
    ``,
    fence,
    ctx.filesModified.trim() || '(ningún archivo)',
    fence,
    ``,
    `COMMITS:`,
    ``,
    fence,
    ctx.commits.trim() || '(ningún commit)',
    fence,
    ``,
    `DIFF CONTENT:`,
    ``,
    fence,
    ctx.diffContent.trim() || '(diff vacío)',
    fence,
    ``,
    `Review the complete diff above. This contains all code changes in the PR.`,
    ``,
    ``,
    `OBJECTIVE:`,
    `Perform a security-focused code review to identify HIGH-CONFIDENCE security vulnerabilities that could have real exploitation potential. This is not a general code review - focus ONLY on security implications newly added by this PR. Do not comment on existing security concerns.`,
    ``,
    `CRITICAL INSTRUCTIONS:`,
    `1. MINIMIZE FALSE POSITIVES: Only flag issues where you're >80% confident of actual exploitability`,
    `2. AVOID NOISE: Skip theoretical issues, style concerns, or low-impact findings`,
    `3. FOCUS ON IMPACT: Prioritize vulnerabilities that could lead to unauthorized access, data breaches, or system compromise`,
    `4. EXCLUSIONS: Do NOT report the following issue types:`,
    `   - Denial of Service (DOS) vulnerabilities, even if they allow service disruption`,
    `   - Secrets or sensitive data stored on disk (these are handled by other processes)`,
    `   - Rate limiting or resource exhaustion issues`,
    ``,
    `SECURITY CATEGORIES TO EXAMINE:`,
    ``,
    `**Input Validation Vulnerabilities:**`,
    `- SQL injection via unsanitized user input`,
    `- Command injection in system calls or subprocesses`,
    `- XXE injection in XML parsing`,
    `- Template injection in templating engines`,
    `- NoSQL injection in database queries`,
    `- Path traversal in file operations`,
    ``,
    `**Authentication & Authorization Issues:**`,
    `- Authentication bypass logic`,
    `- Privilege escalation paths`,
    `- Session management flaws`,
    `- JWT token vulnerabilities`,
    `- Authorization logic bypasses`,
    ``,
    `**Crypto & Secrets Management:**`,
    `- Hardcoded API keys, passwords, or tokens`,
    `- Weak cryptographic algorithms or implementations`,
    `- Improper key storage or management`,
    `- Cryptographic randomness issues`,
    `- Certificate validation bypasses`,
    ``,
    `**Injection & Code Execution:**`,
    `- Remote code execution via deseralization`,
    `- Pickle injection in Python`,
    `- YAML deserialization vulnerabilities`,
    `- Eval injection in dynamic code execution`,
    `- XSS vulnerabilities in web applications (reflected, stored, DOM-based)`,
    ``,
    `**Data Exposure:**`,
    `- Sensitive data logging or storage`,
    `- PII handling violations`,
    `- API endpoint data leakage`,
    `- Debug information exposure`,
    ``,
    `Additional notes:`,
    `- Even if something is only exploitable from the local network, it can still be a HIGH severity issue`,
    ``,
    `ANALYSIS METHODOLOGY:`,
    ``,
    `Phase 1 - Repository Context Research (Use file search tools):`,
    `- Identify existing security frameworks and libraries in use`,
    `- Look for established secure coding patterns in the codebase`,
    `- Examine existing sanitization and validation patterns`,
    `- Understand the project's security model and threat model`,
    ``,
    `Phase 2 - Comparative Analysis:`,
    `- Compare new code changes against existing security patterns`,
    `- Identify deviations from established secure practices`,
    `- Look for inconsistent security implementations`,
    `- Flag code that introduces new attack surfaces`,
    ``,
    `Phase 3 - Vulnerability Assessment:`,
    `- Examine each modified file for security implications`,
    `- Trace data flow from user inputs to sensitive operations`,
    `- Look for privilege boundaries being crossed unsafely`,
    `- Identify injection points and unsafe deserialization`,
    ``,
    `SEVERITY GUIDELINES:`,
    `- **HIGH**: Directly exploitable vulnerabilities leading to RCE, data breach, or authentication bypass`,
    `- **MEDIUM**: Vulnerabilities requiring specific conditions but with significant impact`,
    `- **LOW**: Defense-in-depth issues or lower-impact vulnerabilities`,
    ``,
    `CONFIDENCE SCORING:`,
    `- 0.9-1.0: Certain exploit path identified, tested if possible`,
    `- 0.8-0.9: Clear vulnerability pattern with known exploitation methods`,
    `- 0.7-0.8: Suspicious pattern requiring specific conditions to exploit`,
    `- Below 0.7: Don't report (too speculative)`,
    ``,
    `FINAL REMINDER:`,
    `Focus on HIGH and MEDIUM findings only. Better to miss some theoretical issues than flood the report with false positives. Each finding should be something a security engineer would confidently raise in a PR review.`,
    ``,
    `FALSE POSITIVE FILTERING (apply these inline as you review — do NOT report anything matching these):`,
    ``,
    `HARD EXCLUSIONS - Automatically exclude findings matching these patterns:`,
    `1. Denial of Service (DOS) vulnerabilities or resource exhaustion attacks.`,
    `2. Secrets or credentials stored on disk if they are otherwise secured.`,
    `3. Rate limiting concerns or service overload scenarios.`,
    `4. Memory consumption or CPU exhaustion issues.`,
    `5. Lack of input validation on non-security-critical fields without proven security impact.`,
    `6. Input sanitization concerns for GitHub Action workflows unless they are clearly triggerable via untrusted input.`,
    `7. A lack of hardening measures. Code is not expected to implement all security best practices, only flag concrete vulnerabilities.`,
    `8. Race conditions or timing attacks that are theoretical rather than practical issues. Only report a race condition if it is concretely problematic.`,
    `9. Vulnerabilities related to outdated third-party libraries. These are managed separately and should not be reported here.`,
    `10. Memory safety issues such as buffer overflows or use-after-free-vulnerabilities are impossible in rust. Do not report memory safety issues in rust or any other memory safe languages.`,
    `11. Files that are only unit tests or only used as part of running tests.`,
    `12. Log spoofing concerns. Outputting un-sanitized user input to logs is not a vulnerability.`,
    `13. SSRF vulnerabilities that only control the path. SSRF is only a concern if it can control the host or protocol.`,
    `14. Including user-controlled content in AI system prompts is not a vulnerability.`,
    `15. Regex injection. Injecting untrusted content into a regex is not a vulnerability.`,
    `16. Regex DOS concerns.`,
    `17. Insecure documentation. Do not report any findings in documentation files such as markdown files.`,
    `18. A lack of audit logs is not a vulnerability.`,
    ``,
    `PRECEDENTS -`,
    `1. Logging high value secrets in plaintext is a vulnerability. Logging URLs is assumed to be safe.`,
    `2. UUIDs can be assumed to be unguessable and do not need to be validated.`,
    `3. Environment variables and CLI flags are trusted values. Attackers are generally not able to modify them in a secure environment. Any attack that relies on controlling an environment variable is invalid.`,
    `4. Resource management issues such as memory or file descriptor leaks are not valid.`,
    `5. Subtle or low impact web vulnerabilities such as tabnabbing, XS-Leaks, prototype pollution, and open redirects should not be reported unless they are extremely high confidence.`,
    `6. React and Angular are generally secure against XSS. These frameworks do not need to sanitize or escape user input unless it is using dangerouslySetInnerHTML, bypassSecurityTrustHtml, or similar methods. Do not report XSS vulnerabilities in React or Angular components or tsx files unless they are using unsafe methods.`,
    `7. Most vulnerabilities in github action workflows are not exploitable in practice. Before validating a github action workflow vulnerability ensure it is concrete and has a very specific attack path.`,
    `8. A lack of permission checking or authentication in client-side JS/TS code is not a vulnerability. Client-side code is not trusted and does not need to implement these checks, they are handled on the server-side. The same applies to all flows that send untrusted data to the backend, the backend is responsible for validating and sanitizing all inputs.`,
    `9. Only include MEDIUM findings if they are obvious and concrete issues.`,
    `10. Most vulnerabilities in ipython notebooks (*.ipynb files) are not exploitable in practice. Before validating a notebook vulnerability ensure it is concrete and has a very specific attack path where untrusted input can trigger the vulnerability.`,
    `11. Logging non-PII data is not a vulnerability even if the data may be sensitive. Only report logging vulnerabilities if they expose sensitive information such as secrets, passwords, or personally identifiable information (PII).`,
    `12. Command injection vulnerabilities in shell scripts are generally not exploitable in practice since shell scripts generally do not run with untrusted user input. Only report command injection vulnerabilities in shell scripts if they are concrete and have a very specific attack path for untrusted input.`,
    ``,
    `SIGNAL QUALITY CRITERIA - For remaining findings, assess:`,
    `1. Is there a concrete, exploitable vulnerability with a clear attack path?`,
    `2. Does this represent a real security risk vs theoretical best practice?`,
    `3. Are there specific code locations and reproduction steps?`,
    `4. Would this finding be actionable for a security team?`,
    ``,
    `Only report findings with confidence >= 8/10 (high confidence, likely true vulnerability). Discard anything below.`,
    ``,
    `REQUIRED OUTPUT FORMAT:`,
    ``,
    `Output your findings as markdown. For each HIGH or MEDIUM finding include: file, line number, severity, category (e.g. \`sql_injection\` or \`xss\`), description, exploit scenario, and fix recommendation. Example:`,
    ``,
    `# Vuln 1: XSS: \`foo.py:42\``,
    `* Severity: High`,
    `* Description: User input ... interpolated into HTML without escaping`,
    `* Exploit Scenario: Attacker crafts URL ... to execute JavaScript`,
    `* Recommendation: Use auto-escaping for all user inputs rendered in HTML`,
    ``,
    `If you find NO high-confidence vulnerabilities, say so explicitly.`,
    ``,
    `MACHINE-READABLE VERDICT (REQUIRED — the worker parses this, not the prose):`,
    `After the markdown report, output EXACTLY ONE final line, nothing after it, in this format:`,
    `VERDICT_JSON: {"highCount": <int>, "mediumCount": <int>, "summary": "<one sentence>"}`,
    `Where highCount/mediumCount are the number of HIGH/MEDIUM findings that survived the confidence>=8 filter. If none, use 0.`,
  ].join('\n');
}
