---
title: "Network Part 5 - CDN, WebSocket, and Idempotency: When the Parts Meet Traffic"
description: Four real scenarios — image loading, real-time chat, global routing, and payment retries — where Parts 1–4 stop being theory and start being architecture decisions.
sidebar:
  order: 6
date: 2026-05-06
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: May 6, 2026</p>

> In Part 2, the TCP handshake turned out to be a negotiation fee charged on every connection. <br>In Part 3, HTTP evolved three times to escape the constraints of that fee. <br>In Part 4, load balancers split traffic based on how much they were willing to know.
>
> But real services don't experience these problems one at a time. Loading a product page hits RTT, multiplexing, and CDN placement all at once. Processing a single payment triggers TCP reliability, application-layer retries, and idempotency in the same breath. The parts have been laid out. Now they meet traffic.

<br>
<br>

This post covers how concepts from Network Parts 1–4 combine in practice. Reading each concept in the part where it first appeared will make the trade-offs in every scenario click faster.

Parts 1 through 4 examined each component in isolation — one layer, one protocol, one routing decision at a time. That was necessary. You can't diagnose a bottleneck if you don't know where to look.

But isolation is not how systems operate. A single user action — loading a page, sending a message, completing a payment — passes through multiple layers simultaneously, and the bottleneck can form at any one of them. The question is no longer "what does this component do?" It's **"which component is the constraint right now, and what combination resolves it?"**

Four scenarios. Four different bottlenecks. Four different answers — all assembled from parts we've already seen.

<br>


### Image-Heavy Pages — When Two Constraints Hit at Once

Picture an e-commerce product page. A single scroll loads 80 high-resolution images. Each image is a separate HTTP request. Each request pays the cost of the *TCP handshake*. The bottleneck here forms across two layers: the Network Layer / L3 (the routing path that determines RTT) and the Application Layer / L7 (the protocol that determines how requests are delivered).

**The first bottleneck is distance — an L3 constraint.**

Seoul to a US server costs roughly 150ms per round trip. That's *RTT* — a fixed cost locked to physics, determined by the routing path at L3. 80 images × 150ms = 12 seconds of pure network delay, even before the server starts processing. The bottleneck isn't computation. It's geography.

A **CDN (Content Delivery Network)** resolves this by caching static content on edge servers physically close to users. Seoul users hit a Seoul edge server. São Paulo users hit a São Paulo edge server. *RTT* gets reduced — not by making the connection faster, but by shortening the L3 path itself.

In the language of the *Theory of Constraints (TOC)*: when RTT is the constraint, the strategy isn't to optimize what happens after the packet arrives. It's to move the server closer to the user so the packet has less distance to travel.

**The second bottleneck is sequential delivery — an L7 constraint.**

Even with a nearby CDN, 80 images over HTTP/1.1 means *Head-of-Line Blocking*. One slow image stalls everything behind it.

HTTP/2 *multiplexing* breaks those 80 requests into interleaved frames over a single connection. Small thumbnails slip through between chunks of a large hero image. The connection stays alive with *Keep-Alive*, and the queue disappears with *multiplexing*. The fix happens entirely at L7 — nothing below it changes.

```
[Without CDN + HTTP/1.1]

Client
   ├─ Request image1 → (150ms) → Response
   ├─ Request image2 → (150ms) → Response
   ├─ Request image3 → (150ms) → Response
   │
   ├─ ...
   │
   └─ Request image80 → (150ms) → Response

80 images × 150ms RTT × sequential 
= 12,000ms (12s)
= painfully slow

------------------------------------------

[With CDN + HTTP/2]

Client
   ├─────── Single Connection ──────┐
   │                                │
   │   ┌  image1  ┐  ┌  image2  ┐   │
   │   ├──────────┤  ├──────────┤   │
   │   ├  image3  ┤  ├  image4  ┤   │
   │   ├──────────┤  ├──────────┤   │
   │   ├   ...    ┤  ├   ...    ┤   │
   │   └  image80 ┘  └──────────┘   │
   │                                │
   │ (sent & received concurrently) │
   └────────────────────────────────┘

80 images × ~5ms RTT  × multiplexed 
≈ tens of ms
= fast
```

If static content dominates and users are geographically distributed, CDN + HTTP/2 is the first combination to consider. 
If content is dynamic and users are concentrated in a single region, CDN adds little.

*Theory of Constraints (TOC)*, applied: **when two constraints sit on different layers, the fix must address both. Solving one while ignoring the other moves the bottleneck — it doesn't remove it.**

<div style="text-align: right; margin-top: -0.1rem; font-size: 0.85rem; color: var(--sl-color-gray-3);">
  <em>TCP handshake cost, RTT, Keep-Alive</em> → Network Part 2<br>
  <em>Head-of-Line Blocking, multiplexing</em> → Network Part 3<br>
  <em>Theory of Constraints (TOC)</em> → Network Part 1
</div>

<br>

### Real-Time Messaging — Where the Connection Cost Moves

A chat application needs messages to arrive instantly. A notification system needs to push updates without the client asking. Both share the same structural problem: **the server needs to talk first.**

HTTP was designed the other way around. The client asks, the server answers. If the server has something new, it has no way to say so — it has to wait for the next question. This is an L7 constraint — the request-response model doesn't support server-initiated communication. The three approaches below each work around this at L7, but their costs cascade down to the Transport Layer / L4, where connection count and port limits live.

Three approaches exist. Each pays the connection cost in a different place.

| Protocol | Connection Cost | Server Resources | Direction |
|--|--|--|--|
| Long Polling | Per message | Low (short-lived) | Client → Server |
| SSE | Per session | Medium (one-way) | Server → Client |
| WebSocket | Per session | High (persistent) | Both |

Where does the difference come from? One at a time.

<br>

**Long Polling — One response, one reconnection, a new contract every time.**

The client sends a request and the server holds it open — not responding until there's something new to say. When a response finally arrives, the client immediately sends another request. The connection is alive, but it's rebuilt every round.

```
[Long Polling — Reconnect Loop]

Client                            Server
  │                                 │
  │ ───── Request ────────────────> │
  │                                 │
  │        (waiting...)             │
  │        (holding...)             │
  │ <──── Response ───────────────  │  "New message"
  │                                 │
  │ ───── Request ────────────────> │  ← immediately reconnect
  │                                 │
  │        (waiting...)             │
  │ <──── Response ───────────────  │  "Another message"
  │                                 │
  │ ───── Request ────────────────> │
  │        (repeat forever)         │

```

From *Transaction Cost Theory*: Long Polling is the *TCP handshake* problem in disguise. Every response-request cycle is a new negotiation. The contract doesn't carry over. *The most effective way to reduce transaction costs is to reduce the number of transactions* — Long Polling does the opposite. It multiplies them.

The overhead is real. Each reconnection carries HTTP headers, potentially a new TCP handshake (if *Keep-Alive* expires), and a fresh slot in the server's connection pool. At scale — tens of thousands of users waiting for messages — the negotiation fee alone saturates the server.

<br>

**SSE (Server-Sent Events) — One channel, one direction, held open indefinitely.**

SSE holds a single HTTP connection open indefinitely. The server pushes data down whenever it has something new. The client never reconnects — it just listens.

```
[SSE — One-Way Stream]

Client                             Server
  │                                 │
  │ ───── Request (subscribe) ────> │
  │                                 │
  │                                 │
  │ <──── Event Stream ───────────  │  "Message 1"
  │ <──── Event Stream ───────────  │  "Message 2"
  │ <──── Event Stream ───────────  │  "Update"
  │ <──── Event Stream ───────────  │  "Notification"
  │                                 │
  │        (connection stays open)  │
```

This is *Keep-Alive* logic applied to real-time delivery. One handshake, many messages. The negotiation fee is paid once and amortized across every subsequent event.

The trade-off: SSE is one-directional. The server talks, the client listens. For a notification feed — stock price alerts, live scores, deployment status updates — that's exactly right. For a chat application where the client also needs to send messages back through the same channel, SSE falls short. The client would need a separate HTTP request for every outbound message, reintroducing the per-message cost that SSE was designed to avoid.

<br>

**WebSocket — One connection, both directions, permanently.**

WebSocket starts as an HTTP request, then upgrades the connection to a persistent, full-duplex channel. Both sides can send data at any time. No re-negotiation. No new connections. The contract is signed once.

```
[WebSocket — Full Duplex Communication]

Client                            Server
  │                                │
  │ ─── HTTP Upgrade ───────────>  │
  │ <── 101 Switching ───────────  │
  │                                │
  │════════════════════════════════│
  │    Persistent Bidirectional    │
  │════════════════════════════════│
  │                                │
  │ ───────── "Hey" ────────────>  │
  │ <──────── "Hi" ──────────────  │
  │ ─────── "Got it" ───────────>  │
  │ <──────── "News" ────────────  │
  │            ...                 │
```

Transaction cost: near zero per message. The entire negotiation overhead is front-loaded into a single upgrade handshake.

But the cost doesn't vanish — it moves. Each WebSocket connection holds a persistent TCP socket open on the server. Roughly *28,000 usable ports* per server. *TIME_WAIT* doesn't apply to connections that never close, but the port stays occupied for as long as the connection lives. A chat service with 50,000 concurrent users needs 50,000 open sockets — permanently.

The connection cost went from **per-message** (Long Polling) to **per-session** (WebSocket). Cheaper per interaction, but the resource commitment is continuous.

<br>

The question remains the same: **what's more expensive — renegotiating constantly, or holding the line open?**

If the bottleneck is message frequency (thousands of messages per second per user), WebSocket wins — the per-message cost of Long Polling would be devastating. 
If the bottleneck is connection count (millions of users, infrequent updates), SSE or even Long Polling may be more efficient — they release resources between interactions.

*Theory of Constraints (TOC)*, applied: **find which resource saturates first — message throughput or connection count — and choose accordingly.**

<div style="text-align: right; margin-top: -0.1rem; font-size: 0.85rem; color: var(--sl-color-gray-3);">
  <em>Transaction Cost Theory, TCP handshake, Keep-Alive, TIME_WAIT</em> → Network Part 2<br>
  <em>L4 port limit (28,000)</em> → Network Part 1<br>
  <em>Theory of Constraints (TOC)</em> → Network Part 1
</div>

<br>

### Global Routing — Closing the Information Gap

A service with users in Seoul, London, and São Paulo runs all its servers in `us-east-1`. Seoul to Virginia is roughly 150ms *RTT*. London is around 80ms. São Paulo, roughly 180ms.

Every request from every user pays that cost. Not once — on every interaction. The server could respond in 5ms, but the user waits 150ms before the response even starts its return trip. **The bottleneck isn't the server. It's the L3 path between the server and the user.**

DNS — operating at L7 — is where the routing decision is made. *DNS round-robin* can't solve the distance problem. It rotates IPs without knowing where the client is. A Seoul user might get routed to Virginia while a server in Tokyo sits idle. This is *Information Asymmetry* — the DNS server lacks the information the routing decision requires.

**GeoDNS closes that information gap.**

When a DNS query arrives, GeoDNS reads the client's IP address at L7, infers their geographic location, and returns the IP of the nearest server. This decision determines the L3 routing path — L7's information changes L3's cost. Seoul users get the Tokyo server. London users get the Frankfurt server. São Paulo users get the São Paulo server.

```
[Traditional DNS Round Robin]

              ┌────────────┐
              │    DNS     │
              │ (No logic) │
              └─────┬──────┘
                    │
      ┌─────────────┼─────────────┐
      │             │             │
 Seoul User    London User     SP User
      │             │             │
      └──────┬──────┴──────┬──────┘
             ▼             ▼
       ┌────────────┬────────────┐
       │            │            │
   192.168.1.1  192.168.1.2  192.168.1.3
   (Virginia)   (Virginia)   (Virginia)
       │            │            │
     150ms         80ms        180ms

-----------------------------------------------

[GeoDNS (Location-Aware Routing)]

              ┌─────────────┐
              │     DNS     │
              │ (Geo Logic) │
              └──────┬──────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
  Seoul User    London User     SP User
       │             │             │
       ▼             ▼             ▼
     (Asia)       (Europe)   (South America)
       │             │             │
 ┌──────────┐  ┌───────────┐  ┌───────────┐
 │   Tokyo  │  │ Frankfurt │  │ São Paulo │
 │ 10.0.1.1 │  │  10.0.2.1 │  │ 10.0.3.1  │
 └──────────┘  └───────────┘  └───────────┘
       │             │             │
     30ms          15ms           10ms
```

Where *DNS round-robin* was blind rotation, GeoDNS is informed routing. The information that was missing — the client's location — is now part of the decision. *How you handle the information gap determines the outcome.* GeoDNS handles it by acquiring the one piece of information that matters most: **where the user is.**

**Edge servers extend this logic beyond static content.** A CDN caches images and files. An edge server can run L7 computation — authentication checks, personalization logic, API responses — close to the user. Where CDN shortened L3's distance, edge servers move L7's processing itself toward the user.

If users span two or more continents, GeoDNS + edge servers is the only way to structurally reduce RTT. 
If traffic fits comfortably in a single region, it only adds operational complexity.

*Information Asymmetry*, applied: **the routing decision is only as good as the information it has. Close the gap, and the cost drops. Ignore it, and geography wins by default.**

<div style="text-align: right; margin-top: -0.1rem; font-size: 0.85rem; color: var(--sl-color-gray-3);">
  <em>RTT</em> → Network Part 2<br>
  <em>DNS round-robin, Information Asymmetry</em> → Network Part 4
</div>

<br>

### Payment Retries — Where TCP's Trust Ends

A user clicks "Pay." The request reaches the server. The server charges the card. Then the response is lost — a network timeout somewhere between the server and the client.

The client sees: "Request failed." The user clicks "Pay" again. A second request arrives at the server. Without protection, the card is charged twice.

**TCP's guarantee, revisited.** *TCP purchases reliability at the cost of speed.* The handshake ensures packets arrive, in order, without loss. But TCP's guarantee operates at the transport layer. It promises that bytes will be delivered. It says nothing about what happens after the application processes those bytes.

The timeout above isn't a TCP failure. TCP delivered the request successfully. The server processed it. The response was lost on its way back. L4's TCP did its job. L7 was left unprotected.

```
Client                        Server
|                              |
|  ——— "Charge $50" ————————>  |  ✓ TCP delivered
|                              |  ✓ Server charged the card
|  <—— Response ———————— ✕     |  ✗ Response lost in transit
|                              |
|  (timeout — user retries)    |
|                              |
|  ——— "Charge $50" ————————>  |  ✓ TCP delivered again
|                              |  ✗ Server charges the card AGAIN
```

**An idempotency key solves this at L7.** The client generates a unique key for each intended action and attaches it to the request. If the same key arrives twice, the server recognizes it as a retry and returns the original result without re-executing.

```
Client                        Server
|                              |
|  ——— "Charge $50"            |
|      key: abc-123 ————————>  |  ✓ First time seeing abc-123
|                              |  ✓ Charges the card, stores result
|  <—— Response ———————— ✕     |  ✗ Response lost
|                              |
|  ——— "Charge $50"            |
|      key: abc-123 ————————>  |  → abc-123 already processed
|                              |  → Returns stored result, no re-charge
|  <—— Response ————————————   |  ✓ Client receives confirmation
```

The key distinction: **TCP guarantees at-least-once delivery. The application needs exactly-once execution.** Idempotency keys bridge that gap.

This is where network-layer concepts meet application-layer design. The trust that the *TCP handshake* purchases extends only to the L4 boundary. Beyond that, reliability is L7's responsibility.

Any write operation where network retries can occur — payments, orders, reservations — needs an idempotency key. Read-only APIs do not.

*Transaction Cost Theory*, applied: **TCP's contract covers L4. Guaranteeing execution at L7 requires a separate contract — and the idempotency key is that contract's cost.**


<div style="text-align: right; margin-top: -0.1rem; font-size: 0.85rem; color: var(--sl-color-gray-3);">
  <em>TCP handshake, TCP's trust cost</em> → Network Part 2
</div>
<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://bravenewgeek.com/you-cannot-have-exactly-once-delivery/">Brave New Geek: You Cannot Have Exactly-Once Delivery</a>
</div>

<br>

### The Bottom Line

Four scenarios. Four bottlenecks. Four different combinations of the same building blocks.

Image loading paid the cost of distance and the cost of queuing — at two different layers, simultaneously. Real-time messaging moved the negotiation fee from per-message to per-session, trading frequency for commitment. Global routing closed the information gap that DNS couldn't see. Payment retries revealed the boundary where TCP's trust expires and the application must build its own.

Every scenario asked the same question this series has been asking from the start: **where is the bottleneck, and what are you willing to trade to clear it?**

The answer was never the same twice.

**There is no universal architecture. There is only the architecture that matches the constraint you're facing right now.**

Next up: the network delivered the request. Now the server has to process it — and the first thing it touches is the database. The idempotency key from payment retries — the guarantee that the same request executes only once — cannot be completed without a database transaction. Every query, every write, every transaction ultimately hits one physical constraint: disk I/O. That's where the Database series begins.