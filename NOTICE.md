# Notices

FairPro editor is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`), as published by the Free Software Foundation. See
[LICENSE](LICENSE). It comes with no warranty.

Copyright (C) 2026 FairPro.

## What this repository contains

Only the editor app: a page that hosts SuperDoc, its toolbar, and the code
that loads and saves documents through `postMessage`. FairPro's contract
management platform is a separate program that embeds this page in an iframe
and is not part of this work.

## Third-party components

- **SuperDoc** (`superdoc` on npm), by Harbour Enterprises, Inc. d/b/a
  SuperDoc, licensed under AGPL-3.0 (or a separate commercial agreement).
  Source: <https://github.com/superdoc-dev/superdoc>.
- **SuperDoc DOCX Engine** (`@superdoc/docx-engine` on npm), a dependency of
  SuperDoc 2. It is proprietary, not open source, and is not covered by this
  repository's licence. It is installed from npm under its own licence:
  <https://docs.superdoc.dev/resources/docx-engine-license>. This repository
  does not contain, modify or redistribute its source, and nobody working on
  this repository may inspect, deobfuscate or reverse engineer it.

Other dependencies and their licences are listed in `pnpm-lock.yaml` and in
each package under `node_modules`.
