# App evaluation records

Run `npm run metrics -- --json` at the evaluated commit and save the output alongside each evaluation. The report counts nonblank physical lines: shared framework modules statically reachable from each app entry point (including barrel re-exports), all app-local TypeScript and reachable views, and app-owned plan JSON. Reachability includes unused re-exports, not actual runtime use or bundled size. Shared code and plan counts are separate: the same framework can appear in multiple apps. Generated plans are not app-owned JSON and report zero plan lines until saved. No line count establishes quality or effort.

For each app and evaluated commit, record separately:

- Task and acceptance criteria, start and first working draft times, including breaks or excluded time.
- AI model, prompt, plan output, validation and behavior results on the first attempt; record invalid output as a failed attempt.
- Number and description of corrections and whether they modify plans or custom code.
- Reviewer, time spent, review method, and findings; include any omitted or unverified scenarios.
- Link or location of the captured metrics output and test results.

Do not estimate missing historical measurements. Re-run with the same procedure when comparing apps and record differences in scope or environment.
