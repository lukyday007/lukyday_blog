---
title: "Network Part 5 - CDN, WebSocket, and Idempotency: When the Parts Meet Traffic"
description: Four real scenarios — image loading, real-time chat, global routing, and payment retries — where Parts 1–4 stop being theory and start being architecture decisions.
sidebar:
  order: 6
date: 2026-05-06
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: May 6, 2026</p>

> In Part 2, the **TCP handshake cost** was a fundamental transaction cost for every connection. <br>In Part 3, HTTP underwent three structural shifts to overcome that specific cost. <br>In Part 4, load balancers distributed traffic by choosing how much data they would analyze.
>
> But real services don't experience these problems one at a time. Loading a product page hits RTT, multiplexing, and CDN placement all at once. Processing a single payment triggers TCP reliability, application-layer retries, and idempotency in the same breath. The parts have been laid out. Now they meet traffic

<br>
<br>

Parts 1 through 4 examined each component in isolation — one layer, one protocol, one routing decision at a time. That was necessary. It is impossible to diagnose a bottleneck without knowing where to look.

But isolation is not how systems operate. A single user action — loading a page, sending a message, completing a payment — passes through multiple layers simultaneously. The bottleneck can form at any one of those layers. The question is no longer "what does this component do?" It is "**which component is the constraint right now, and what combination resolves it?**"

Four scenarios. Four different bottlenecks. Four different answers. All are assembled from parts already seen.


<br>


## Image-Heavy Pages — When Two Constraints Hit at Once

Picture an e-commerce product page. A single scroll loads 80 high-resolution images. Each image is a separate HTTP request. Each request pays the *TCP handshake* cost. The bottleneck here forms across two layers — the Network Layer (L3) and the Application Layer (L7).

### The first bottleneck is distance — an L3 constraint.

Seoul to a US server costs roughly 150ms per round trip. That's *RTT* — a fixed cost locked to physics, determined by the routing path at L3. 80 images × 150ms = 12 seconds of pure network delay, before the server even starts processing. The constraint is geography, not computation.

A **CDN (Content Delivery Network)** resolves this by caching static content on edge servers physically close to users. Seoul users hit a Seoul edge server. São Paulo users hit a São Paulo edge server. *RTT* drops not by making the connection faster, but by shortening the L3 path itself.

*Theory of Constraints (TOC)*: when RTT is the constraint, the fix is not faster servers but closer servers.

### The second bottleneck is sequential delivery — an L7 constraint.

Even with a nearby CDN, 80 images over HTTP/1.1 means *Head-of-Line Blocking*. One slow image stalls everything behind it.

HTTP/2 *multiplexing* breaks those 80 requests into interleaved frames over a single connection. Small thumbnails slip through between chunks of a large hero image. The connection stays alive with *Keep-Alive*, and the queue disappears with *multiplexing*. The fix happens entirely at L7 — nothing below it changes.

Furthermore, HTTP/2 uses **HPACK header compression** to eliminate header redundancy. Instead of resending static data like cookies across 80 requests, it transmits only the changes. **By minimizing these repetitive 'administrative costs,' the connection amortizes its overhead across every subsequent message.**

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

*Theory of Constraints (TOC)*, applied: when two constraints sit on different layers, the fix must address both. **Solving one while ignoring the other moves the bottleneck. It doesn't remove it.**

<em>TCP handshake cost, RTT, Keep-Alive</em> → Network Part 2<br>
<em>Head-of-Line Blocking, multiplexing</em> → Network Part 3<br>
<em>Theory of Constraints (TOC)</em> → Network Part 1


<br>

## Real-Time Messaging — Where the Connection Cost Moves

A chat application needs messages to arrive instantly. A notification system needs to push updates without the client asking. These services share a critical structural requirement: **The server must initiate communication first.**

HTTP was designed the other way around. The client asks, the server answers. If the server has something new, it has no way to say so — it has to wait for the next question. This is an L7 constraint — the request-response model doesn't support server-initiated communication. 

The three approaches below work around this at L7, but each allocates the connection cost in a different place — eventually cascading down to L4, where port limits live.

| Protocol | Connection Cost | Server Resources | Direction |
|--|--|--|--|
| Long Polling | Per message | Low (short-lived) | Client → Server |
| SSE | Per session | Medium (one-way) | Server → Client |
| WebSocket | Per session | High (persistent) | Both |

Where does the difference come from? One at a time.

<br>

### Long Polling — One response, one reconnection, a new contract every time.

The client sends a request and the server holds it open. It does not respond until there is something new to say. When a response finally arrives, the client immediately sends another request. The connection is alive, but it is rebuilt every round.

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

From *Transaction Cost Theory*: Long Polling is the *TCP handshake* problem in disguise. Every response-request cycle is a new negotiation. The contract doesn't carry over. **The most effective way to reduce transaction costs is to reduce the number of transactions.** Long Polling does the opposite. It multiplies them.

Each reconnection carries HTTP headers, a new *TCP handshake* when *Keep-Alive* expires, and a fresh slot in the server connection pool. At tens of thousands of users, these negotiation fees alone saturate the server.

<br>

### SSE (Server-Sent Events) — One channel, one direction, held open indefinitely.

SSE maintains a single HTTP connection indefinitely, allowing the server to push data whenever new information exists. The client never reconnects; it simply stays active to listen to the continuous stream.

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

This model applies *Keep-Alive* logic to real-time delivery. One *TCP handshake* serves many messages. The system pays the negotiation fee **only once**. 

The trade-off is one-directional. SSE fits notification feeds — stock price alerts, live scores, deployment status — perfectly. For interactive chat, the client must send a new HTTP request for every outbound message, reintroducing per-message cost. **SSE optimizes only half the channel.**

<br>

### WebSocket — One connection, both directions, permanently.

WebSocket begins as an HTTP request and upgrades to a persistent, full-duplex channel. Both sides send data at any time without re-negotiation. The system signs the contract only once.

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

From *Transaction Cost Theory*: The transaction cost remains near zero per message. The entire negotiation overhead is front-loaded into a single upgrade handshake.

But the cost does not vanish; it moves. Each WebSocket connection keeps a TCP socket and its port occupied for the entire session.

The physical limits are strict. A server has roughly *28,000 usable ports*. A chat service with 50,000 concurrent users needs 50,000 open sockets permanently. *TIME_WAIT* does not apply here because these connections never close.

The connection cost went from **per-message** (Long Polling) to **per-session** (WebSocket) — cheaper per interaction, but a continuous resource commitment.

The question remains the same: **what's more expensive — renegotiating constantly, or holding the line open?**

*   **Message frequency bottleneck** (thousands of messages per second per user) → WebSocket wins. The per-message cost of Long Polling would be devastating.
*   **Connection count bottleneck** (millions of users, infrequent updates) → SSE or Long Polling may be more efficient. They release resources between interactions.

*Theory of Constraints (TOC)*, applied: **find which resource saturates first — message throughput or connection count — and choose accordingly.**

<em>Transaction Cost Theory, TCP handshake, Keep-Alive, TIME_WAIT</em> → Network Part 2<br>
<em>28,000 usable ports</em> → Network Part 1<br>
<em>Theory of Constraints (TOC)</em> → Network Part 1

<br>

## Global Routing — Closing the Information Gap

When a service spans continents, every request pays for distance. The server responds in 5ms, but the user waits 150ms before the response even begins its return trip. **The bottleneck isn't the server. It's the L3 path between the server and the user.**

### The problem — DNS doesn't know where you are

A service with users in Seoul, London, and São Paulo runs all its servers in `us-east-1`. Seoul to Virginia is roughly 150ms *RTT*. London is around 80ms. São Paulo is roughly 180ms.

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
```

DNS operates at L7, where the routing decision is made. However, *DNS round-robin* cannot solve the distance problem. It rotates IPs without knowing where the client is. A Seoul user might be routed to Virginia while a server in Tokyo sits idle.

This is *Information Asymmetry* — the DNS server lacks the information the routing decision requires.

### The fix — GeoDNS + Edge servers

When a DNS query arrives, GeoDNS reads the client's IP at L7 to infer their location. It then returns the nearest server's IP, effectively using L7 information to lower L3 routing costs. Seoul users get Tokyo, London gets Frankfurt, and São Paulo gets their local server.


```
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

Where *DNS round-robin* was blind rotation, GeoDNS is informed routing. The information that was missing — the client's location — is now part of the decision. **How you bridge this *information gap* determines the outcome.** GeoDNS handles it by acquiring the one piece of information that matters most: **where the user is.**

While a CDN caches static content to shorten L3 distance, an edge server moves L7 computation itself — authentication checks, personalization logic, API responses — toward the user.

If users span two or more continents, GeoDNS + edge servers is the only way to structurally reduce RTT. However when traffic fits comfortably in a single region, it only adds operational complexity.

*Information Asymmetry*, applied: **the routing decision is only as good as the information it has. Close the gap, and the cost drops. Ignore it, and geography wins by default.**

<em>RTT</em> → Network Part 2<br>
<em>DNS round-robin, Information Asymmetry</em> → Network Part 4


<br>

## Payment Retries — Where TCP's Trust Ends

A user clicks "Pay" and the request reaches the server. The server charges the card, but the response is lost. A network timeout occurs somewhere between the server and the client.

The client sees: "Request failed." The user clicks "Pay" again. A second request arrives at the server. Without protection, the card is charged twice.

### TCP's guarantee, revisited.

*TCP purchases reliability at the cost of speed* — a *Transaction Cost* paid once per connection to guarantee delivery at L4. But that contract is bounded. It promises that bytes will be delivered, in order, without loss. It says nothing about what happens after the application processes those bytes.

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

### An idempotency key solves this at L7.

The client generates a unique key for each intended action and attaches it to the request. If the same key arrives twice, the server recognizes it as a retry and returns the original result without re-executing.

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

In distributed systems, a timeout represents an **unknown state** rather than a failure. The client doesn't know if the charge went through, and that uncertainty is the most expensive cost in payments.

The key distinction is simple. **TCP guarantees at-least-once delivery, but the application needs exactly-once execution.** Idempotency keys bridge that gap — turning the retry into a verified replay rather than a new transaction.

Any write operation where network retries can occur — payments, orders, reservations — needs an idempotency key. Read-only APIs do not.

*Transaction Cost Theory*, applied: **TCP's contract covers L4. Guaranteeing execution at L7 requires a separate contract — and the idempotency key is that contract's cost.**

<em>TCP handshake, TCP's trust cost</em> → Network Part 2 <br>

*Reference: [Brave New Geek: You Cannot Have Exactly-Once Delivery](https://bravenewgeek.com/you-cannot-have-exactly-once-delivery/)*


<br>

## The Bottom Line

Four scenarios. Four bottlenecks. Four different combinations of the same building blocks.

* Image loading paid two costs at once. Distance at L3 and queuing at L7.
* Real-time messaging moved the negotiation fee from per-message to per-session, trading frequency for commitment.
* Global routing closed the information gap that DNS couldn't see.
* Payment retries revealed the boundary where TCP's trust expires and the application must build its own.

Every scenario asked the same question this series has been asking from the start: **where is the bottleneck, and what are you willing to trade to clear it?**

**There is no universal architecture. There is only the architecture that matches the constraint you're facing right now.**

Next up: the network delivered the request. Now the server has to process it — and every query ultimately hits one physical constraint. That's where the Database series picks up.
