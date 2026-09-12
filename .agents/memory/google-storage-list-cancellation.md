---
name: Cancelling Google Storage listings
description: How to propagate cleanup deadlines into Google Storage list requests.
---

The installed Google Storage client does not expose `AbortSignal` on `getFiles`. Use the supported `getFilesStream` API and destroy the stream when the caller's signal aborts.

**Why:** Racing the `getFiles` promise against a timeout releases the cleanup lock but leaves the network request running, so repeated failures can accumulate background requests.

**How to apply:** For deadline-bound object listings, pass an `AbortSignal` through the application boundary, collect the file stream, and destroy it with an abort error. Reject the timeout before aborting so the transport's abort error cannot replace the domain timeout.