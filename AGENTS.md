# BG repository working instructions

Repository: https://github.com/elanghaqeem-hash/BG

## Standing user instruction

The user authorized automatic commits and pushes for BG code and project-file changes made while working in ChatGPT on 27 October 2026 (Asia/Jakarta).

- After each completed logical change, review the diff, run checks appropriate to that change, commit the relevant files, and push to this repository before ending the task. Do not request push authorization again.
- Push task changes to the current task branch. Use a dedicated branch for substantial application changes; this instruction alone does not authorize merging to main or production deployment.
- Check the current remote state before writing. Preserve other contributors' work and use ordinary fast-forward updates; do not force-push or rewrite shared history.
- Stage only files belonging to the task. Never commit credentials, API keys, tokens, environment secrets, private customer data, dependency folders, or temporary build output.
- If checks fail, fix them before pushing a completed change. If blocked, report the exact blocker and distinguish local changes from successfully pushed commits.
- Verify the remote commit after pushing and report its branch and commit link.
- Follow a later explicit user instruction to pause or change this workflow.

## Execution boundary

This file is an instruction for coding sessions, not a background file watcher. It does not create a ChatGPT conversation-change trigger or synchronize chat messages and attachments. Automatic push runs as part of each active BG coding task.
