# TensorFlow.js runtime

`tf.min.js` is the unmodified `dist/tf.es2017.min.js` bundle from
`@tensorflow/tfjs` version **4.22.0**, distributed via registry.npmjs.org.
The ES2017 bundle avoids the legacy bundle's eval-based regenerator polyfill,
so it can run under the sandbox CSP without `unsafe-eval`.

Copyright 2024 Google LLC. Licensed under Apache-2.0; see
`TENSORFLOW-JS-LICENSE.txt`. This third-party library is not subject to
Eltes' restrictive source reuse terms. Upstream: https://github.com/tensorflow/tfjs

No model weights are included. The sandbox loads this bundled file only when
requested; snippets cannot fetch model weights or other network resources.

## Three.js r180

`three.r180.min.js` is an offline IIFE bundle of npm `three@0.180.0`'s
`build/three.module.js`, built with esbuild 0.28.2 (`--bundle --format=iife
--global-name=THREE --minify`). The upstream MIT license is retained in
`THREE-LICENSE.txt`. No model weights or remote assets are included. Only loaded
when the user explicitly enables the Three.js website-preview option; injected
into the opaque-origin preview, not exposed to generated code in the app origin.
Upstream: https://github.com/mrdoob/three.js/tree/r180

Bundle SHA-256: `07a95e94084abcb4bcb1adec04fea06606aebf7f797badf45215562a7e439290`.
This third-party library retains its MIT terms, independently of the Eltes license.
