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
