---
name: Google Storage DELETE completion
description: How the installed Google Storage SDK signals completion for cancellable DELETE streams
---

For cancellable object deletion through the installed Google Storage client, explicitly end the writable request stream and settle from its `response` event after validating the HTTP status. Do not await the stream's readable `end` or `complete` event.

**Why:** The SDK attaches only the writable side for non-GET `requestStream` calls. Its transport emits `response`, but the returned duplex never emits the readable completion events, so successful deletion otherwise hangs forever.

**How to apply:** Drain the response, accept 2xx, map 404 to absent, reject other statuses, remove abort listeners when settled, and cover the adapter with the real SDK against a bounded local HTTP endpoint.