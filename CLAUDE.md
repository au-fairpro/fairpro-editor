# fairpro-editor: working rules

The public, AGPL-licensed editor page FairPro embeds in an iframe. Read
README.md first: it describes the message protocol and the security rules.

- Keep business logic out. Permissions, the edit lock, versions, storage and
  audit belong to FairPro (fairpro-platform), which is proprietary. Nothing
  from fairpro-platform may be copied into this repository.
- Never inspect, deobfuscate or reverse engineer `@superdoc/docx-engine`.
  Use only SuperDoc's public API and documentation.
- No customer documents in the repository, fixtures or logs. Test documents
  are synthetic.
- A protocol change bumps `PROTOCOL_VERSION` only when FairPro would break,
  and lands together with the matching change in fairpro-platform.
- Owner's standing rules apply as in fairpro-platform: latest stable versions
  (record any hold-back in README.md), unit tests with every change, check
  current practice online, and verify before saying something is done
  (`pnpm check` and `pnpm test:e2e`).
- Never commit to `main`; open a pull request.
