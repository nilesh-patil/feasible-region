# Vendored third party libraries

All assets in this directory are vendored (self hosted) so the site runs with no
CDN at runtime. Versions are pinned to releases available in early 2023, matching
the project era rule.

Serve root is `docs/`, so these files load from `./vendor/...`.

## d3

- Library: D3 (Data Driven Documents), full bundle
- Version: 7.8.5
- File: `d3.v7.min.js` (UMD build, defines the global `d3`)
- Upstream home: https://d3js.org/
- Source repository: https://github.com/d3/d3
- Fetched from: https://cdn.jsdelivr.net/npm/d3@7.8.5/dist/d3.min.js
- License: ISC
- License text pointer: https://github.com/d3/d3/blob/v7.8.5/LICENSE
  (bundled header of `d3.v7.min.js` also carries the copyright line)

License text (ISC):

```
Copyright 2010-2023 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## KaTeX

- Library: KaTeX (math typesetting)
- Version: 0.16.4
- Files: `katex.min.css`, `katex.min.js`, and the 20 WOFF2 font faces under `fonts/`
- Upstream home: https://katex.org/
- Source repository: https://github.com/KaTeX/KaTeX
- Fetched from:
  - https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.css
  - https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/katex.min.js
  - https://cdn.jsdelivr.net/npm/katex@0.16.4/dist/fonts/<face>.woff2
- License: MIT
- License text pointer: https://github.com/KaTeX/KaTeX/blob/v0.16.4/LICENSE

Only the WOFF2 font faces referenced by `katex.min.css` are vendored (the WOFF
and TTF fallbacks in the upstream `dist/fonts/` are omitted on purpose to keep the
payload small; every WOFF2 name that the CSS `url(...)` rules point at is present).

License text (MIT):

```
The MIT License (MIT)

Copyright (c) 2013-2020 Khan Academy and other contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
