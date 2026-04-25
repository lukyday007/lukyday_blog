---
title: Network Part 3 - The Evolution of HTTP and the Cost of Every Trade-off
description: From HOL Blocking to QUIC — how HTTP/1.1, HTTP/2, and HTTP/3 each made a different call on what to keep and what to let go, read through Path Dependency and the Innovator's Dilemma.
sidebar:
  order: 4
date: 2026-04-25
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 25, 2026</p>

> When the past answer becomes the present problem, we call it Path Dependency. TCP was designed in 1981. It solved the right problems for its time. By the time HTTP was carrying the modern web, that 40-year-old foundation was starting to show its age.
>
> Keep-Alive solved the contract problem. One connection, many requests. Cheaper by design. But the queue was still single-file. Fix the engine, and suddenly the road is the problem. That road was TCP.

<br>
<br>

### HTTP/1.1 — One Lane, No Exceptions

HTTP/1.1 had one rigid rule: one connection handles one request at a time, in order.

Keep-Alive meant you didn't have to renegotiate a new contract for every exchange. But the delivery itself was still sequential. One large image delayed at the front of the queue, and every lightweight text file behind it had to wait. The connection was alive — it just couldn't move two things at once. This is **Head-of-Line Blocking (HOLB)**.

Browsers tried to route around it by opening up to six parallel connections per server. But that just brought back the port exhaustion and handshake overhead from Part 2. The problem wasn't solved. It was transferred — into a different form of cost.

<br>

### HTTP/2 — Same Road, Different Lane

Released in 2015, HTTP/2 attacked HOL Blocking at the application layer with **multiplexing**.

Instead of sending whole files in sequence, HTTP/2 breaks requests and responses into small frames and interleaves them over a single connection. Small payloads can slip through between chunks of a large one. On paper, it looked like true parallel processing.

But TCP was still underneath. And TCP is obsessed with order.

If a single packet is lost in transit, TCP halts everything — including frames from entirely unrelated requests — until that packet is retransmitted and order is restored. HTTP/2 had widened the lanes at the application layer. The transport layer's old rules froze them anyway.

This is Path Dependency in action. **The choice to build HTTP on top of TCP meant every improvement had to work within TCP's constraints.** HTTP/2 was a sustaining innovation — the best possible improvement within the existing system. But it couldn't break the structural ceiling, because the ceiling was TCP itself.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://web.dev/articles/performance-http2">web.dev: HTTP/2</a>
</div>

<br>

### HTTP/3 — Cutting the Path

Google made the call. Ditching TCP entirely.

But this is where a common misconception takes hold. Dropping TCP didn't mean dropping reliability. It meant replacing everything TCP did with something that did it better.

The new foundation is UDP. Unlike TCP, UDP makes no guarantees — no ordering, no retransmission, no reliability. It just fires packets and moves on. Google built QUIC directly on top of that bare foundation — taking on everything TCP used to handle (retransmission, encryption, connection management), but doing it per stream. One stream stalls, the rest keep moving. HOL Blocking, gone at the root.

```
┌─────────────────┐        ┌─────────────────┐
│      Before     │        │      After      │
├─────────────────┤        ├─────────────────┤
│   HTTP/1.1·2    │        │     HTTP/3      │
│        ↕        │    →   │        ↕        │
│       TCP       │        │      QUIC       │
│        ↕        │        │        ↕        │
│       IP        │        │       UDP       │
└─────────────────┘        └─────────────────┘
```

This is why HTTP/3 is called "UDP-based." QUIC sits on top of UDP, and HTTP/3 runs on top of QUIC. TCP wasn't abandoned — its role was replaced.

**Why YouTube and Zoom were already on UDP**

Real-time streaming services made this call long ago. When a packet drops during a video call, waiting for TCP to retransmit it freezes the screen. It's better to skip that moment and move to the next frame. When continuity matters more than completeness, TCP's reliability becomes a liability.

QUIC brought that same instinct to general web traffic. A lost packet stalls only the stream it belongs to. Everything else keeps moving.

**0-RTT — Cutting the cost of security too**

The 1.5 RTT cost from Part 2 was just the TCP handshake. Add HTTPS, and TLS negotiation stacks on top. One connection, up to 3 RTT before a single byte of data moves.

QUIC has TLS 1.3 built in — connection and security negotiation happen simultaneously. Return visits skip the handshake entirely. The 1.5 RTT from Part 2 collapses to zero.


```
┌─────────────────────┬────────────────────┐
│     TCP + TLS       │        QUIC        │
├─────────────────────┼────────────────────┤
│    TCP   1.5 RTT    │ First visit 1 RTT  │
│    TLS   1.5 RTT    │ Return visit 0RTT  │
│    ──────────────   │                    │
│    Total  3 RTT     │                    │
└─────────────────────┴────────────────────┘

```

The trade-off is real. By abandoning TCP, the application now owns packet loss handling, connection reliability, and security. Simpler to use. Far more complex underneath.

This is what the Innovator's Dilemma calls disruptive innovation. Not an improvement on what existed — a replacement of it.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.chromium.org/quic/">Chromium: QUIC</a><br>
  <a href="https://www.rfc-editor.org/rfc/rfc9000">RFC 9000: QUIC</a>
</div>

<br>

### How the Three Versions Compare
```
HTTP/1.1  — Requests must wait in line
time →  t1     t2     t3     t4     t5
R1     [====] [====]
R2                   [====] [====]
R3                                 [====]
R2 can't start until R1 finishes. R3 can't start until R2 finishes.
──────────────────────────────────────────
HTTP/2  — One lost packet freezes everything
time →  t1     t2     t3     t4     t5
R1      [====] [====] [====]
R2      [====] ✕ ← packet lost
R3      [====]        ← waiting...  ← waiting...
When ✕ occurs, R1, R2, and R3 all freeze.
──────────────────────────────────────────
HTTP/3  — Only the affected stream pauses
time →  t1     t2     t3     t4     t5
R1      [====] [====] [====] [====]
R2      [====] ✕ ← packet lost        [retransmit]
R3      [====] [====] [====] [====] ← keeps moving
When ✕ occurs, only R2 pauses. R1 and R3 continue.
```


Each version made a different call on where to absorb the cost.

<br>

### The Business Lens — Path Dependency and the Innovator's Dilemma

The evolution of HTTP is a case study in two management concepts that explain why the right answer takes so long to arrive.

**Path Dependency.** Every router and firewall on the internet was optimized for TCP. Even when better alternatives existed, leaving TCP behind wasn't just a technical decision — it was an infrastructure negotiation with the entire global network. A choice made in 1981 constrained technical decisions well into the 2020s.

**The Innovator's Dilemma.** HTTP/1.1 to HTTP/2 was sustaining innovation — improving performance while staying within the existing system. Safe, but structurally limited. HTTP/3 was disruptive innovation — abandoning the standard entirely and rebuilding on a new foundation. Risky, but the only way to break the ceiling.

Where the two concepts meet is HTTP/3 itself. Path Dependency explains why it took 40 years. The Innovator's Dilemma explains why it had to happen at all.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.hbs.edu/faculty/Pages/item.aspx?num=46">Clayton Christensen: The Innovator's Dilemma</a>
</div>

<br>

### The Bottom Line

HTTP/1.1 trimmed the negotiation fee. HTTP/2 increased the transaction density. HTTP/3 rejected the legacy constraints entirely to win back speed. The evolution of protocols isn't a search for the right answer. It's a history of choosing the best trade-off for the era.

**Improve along the path, or change the path itself. That question doesn't only apply to protocols.**

Next up: even with HTTP/3 handling requests efficiently, traffic still has to land somewhere. When tens of thousands of requests arrive at once, something has to decide where they go. That's the load balancer — and the choice between L4 and L7 turns out to be another trade-off worth understanding.