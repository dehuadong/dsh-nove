# Third-party notices

see-storycraft bundles the following third-party packages into its Host build.
They are not separate runtime dependencies of the installed plugin.

- **unpdf** — MIT. Copyright (c) 2023-2025 unjs contributors. PDF text extraction; includes Mozilla PDF.js (Apache-2.0), Copyright 2012 Mozilla Foundation.
- **jszip** — MIT or GPL-3.0; this project uses it under the MIT option. Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso.
- **pako** — MIT. Copyright (c) 2014-2017 Vitaly Puzrin, Andrey Tupitsin. Deflate implementation used by jszip.
- **lie**, **immediate**, **setimmediate**, **readable-stream**, **process-nextick-args**, **isarray**, **safe-buffer**, **core-util-is**, **inherits**, **string_decoder**, **util-deprecate** — MIT. Transitive dependencies of jszip/unpdf.

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Apache License 2.0

Mozilla PDF.js is distributed under the Apache License, Version 2.0. A copy of
the license is available at https://www.apache.org/licenses/LICENSE-2.0 and in
the `pdfjs-dist` package; bundled code retains its copyright and license
headers. This notice does not change the project's MIT license.
