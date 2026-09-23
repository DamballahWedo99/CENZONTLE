<!--
Thanks for contributing. Read CONTRIBUTING.md before you open the PR.
Delete the sections that don't apply — don't leave an empty template behind.
-->

## What changes

<!-- One or two sentences. The PR title already says the "what"; what matters here is the scope. -->

## Why

<!--
The context the diff doesn't show: what problem this solves, what alternative you
discarded and why. If it closes an issue, write "Closes #123".
-->

## How you tested it

<!--
Be concrete and reproducible. "I ran the tests" says nothing; "I added a case to
apps/api/src/modules/factory/qa/qa-stage.spec.ts covering the precedence between
qaCompletedAt and releaseApprovedAt, and checked the gate by hand in the UI" does.
-->

## Checklist

- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] The commit uses one of the repo's prefixes (`Feat:` `Fix:` `Refactor:` `Docs:` `Test:` `Chore:`)
- [ ] No secrets, no `.env`, no real credentials (not in logs or screenshots either)

<!-- Check only what applies to this change: -->

- [ ] **Touched the Prisma schema** → I generated the migration with `pnpm --filter @cenzontle/api exec prisma migrate dev --name <desc>` and committed the `.sql`
- [ ] **New environment variable** → I documented it in the matching `.env.example` **and** in `docs/configuration.md`
- [ ] **New dependency under a copyleft or attribution license** (GPL/LGPL/AGPL/MPL/EPL) → I added it to `NOTICES.md`
- [ ] **User-visible behavior change** → I updated the documentation under `docs/`

## Notes for reviewers

<!--
Where to look first, which part worries you, what you deliberately left out.
If you know something is half-finished, say it here instead of waiting for someone
to notice.
-->
