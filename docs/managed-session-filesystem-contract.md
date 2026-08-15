# Managed session filesystem contract

This is a release-blocking host contract for every managed Vibe64 project and
session source. It records the 2026-08-15 permission failure that cost live
work and the architecture required to prevent it from recurring.

## Incident

Vite and `vue-router` failed with `EACCES` while regenerating
`src/typed-router.d.ts` in a hosted session.

The source file was replaced at 14:29:12. The preview watcher attempted its HMR
write at 14:29:13 and failed. Vibe64's former post-command recursive permission
repair did not complete until 14:29:30. The repair was therefore inherently too
late for a live watcher.

The human/agent command and the workspace daemon were writing the same session
source under different Unix identities:

- human or agent commands could run as `merc`;
- preview and Vite ran as `v64d_<workspace>`;
- both identities belonged to the shared `vibe64` group;
- directories were setgid, but did not have an inherited default ACL;
- an atomically replaced file could consequently be created without shared
  group write access.

The problem was not credentials, Git authentication, application behavior, or
deployment. It was the filesystem creation contract.

## Emergency host repair

The live project trees for `sas/dogandgroom`, `sas/compas-next`, and `pass/whs2`
were repaired by:

1. assigning the shared `vibe64` group recursively;
2. making existing files group-writable;
3. making directories group-writable and setgid;
4. adding inherited default ACLs for shared group access;
5. verifying that no existing file lacked shared-group write access.

A file created as `merc` with umask `0022` then inherited owner `merc`, group
`vibe64`, and mode `0660`; the corresponding `v64d_<workspace>` daemon could
append immediately. The affected `typed-router.d.ts` became writable by
`v64d_sas`.

This emergency repair is evidence, not the product design. Vibe64 must not
depend on repeating a recursive repair.

## Mandatory architecture

Credentials and filesystem identity are separate concerns. GitHub, database,
preview-identity, and application credentials must not determine source
ownership or write access.

Before any actor, agent, package manager, generated-file writer, or preview
watcher starts, every managed project/session source namespace must have:

- owning group: `vibe64`;
- directory mode: `2770`;
- process umask for managed writers: `0007`;
- access group ACL: `vibe64:rwx`;
- inherited default group ACL: `vibe64:rwx`;
- no access for other users.

The human users allowed to operate on a workspace and its
`v64d_<workspace>` daemon must be members of `vibe64`. A missing group, missing
ACL tools, wrong ownership, wrong mode, absent default ACL, or missing group
membership is a startup failure. It is never repaired after a command.

The ACL contract must survive or be re-established before exposing a path
created by clone, copy, atomic replacement, checkout, reset, move, archive
restore, or session-source recovery. A path must not become visible to a live
watcher in an intermediate unsafe state.

## Required proof

Host verification must cover both identities, not merely inspect shell source:

1. Start or model a watcher as the workspace daemon.
2. Create and atomically replace a generated source file as the human actor
   using umask `0022`.
3. Prove that the daemon can immediately rewrite it.
4. Repeat the boundary across Git checkout/reset and a generated router file.
5. Prove newly created directories retain setgid and the mandatory default ACL.

Preview recovery has a related invariant: a failed preview must offer a working
fresh-start/retry path. Restart logic must not reject a new terminal merely
because the previous process has already failed.

## Forbidden designs

- no recursive `chown`, `chgrp`, `chmod`, or ACL repair after commands;
- no timing gap between a writer completing and a watcher gaining access;
- no reliance on a cooperative application umask alone;
- no single-user assumption for hosted session sources;
- no weakening the project tree to world-readable or world-writable modes;
- no application-source workaround for a host filesystem defect.

The emergency repair changed no application source, Git history, or deployment
release. The permanent implementation must preserve that ownership boundary.
