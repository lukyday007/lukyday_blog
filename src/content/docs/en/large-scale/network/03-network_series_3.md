---
title: Network Part 3 - The Evolution of HTTP and the Cost of Every Trade-off
description: From HOL Blocking to QUIC — how HTTP/1.1, HTTP/2, and HTTP/3 each made a different call on what to keep and what to let go, read through Path Dependency and the Innovator's Dilemma.
sidebar:
  order: 4
date: 2026-04-25
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 25, 2026</p>

> HTTP/2 arrived in 2015 to resolve the queuing issues of its predecessor. It introduced a significant technical shift by interleaving multiple requests into a single connection. Yet, real-world performance showed an unexpected result. On networks with 2% packet loss, HTTP/1.1 actually outperformed the newer protocol. **The server and the application code remained identical, but the technically superior protocol failed to deliver.**
>
> The fault did not lie within HTTP/2 itself but in the layer beneath it. TCP, a protocol designed in 1981, still controlled the data flow. While multiplexing allowed more data to move at the application layer, TCP continued to enforce strict ordering. This meant a single lost packet could stall the entire connection until it was recovered.

*Reference: [TCP Head-of-Line Blocking — http3-explained](https://http3-explained.haxx.se/en/why-quic/why-tcphol)*  

<br>
<br>

Keep-Alive reduced the cost of establishing connections by allowing one connection to handle many requests. However, the delivery queue remained single-file. Improving the application protocol only revealed a deeper bottleneck in the transport layer. That bottleneck was TCP.

## HTTP/1.1 — One Lane, No Exceptions

HTTP/1.1 followed a rigid rule where **one connection could only handle one request at a time** in a strict sequence.

Keep-Alive eliminated the need to renegotiate a new contract for every exchange. But the delivery itself was still sequential. One large image delayed at the front of the queue, and every lightweight text file behind it had to wait. The connection was alive — it just couldn't move two things at once. This is **Head-of-Line Blocking (HOLB)**.

Browsers tried to route around it by opening up to six parallel connections per server. But that just brought back the port exhaustion and handshake overhead from Network Part 2. The core issue wasn't resolved. **The cost was simply transferred into a different form of inefficiency.**

<br>

## HTTP/2 — Same Road, Different Lane

Released in 2015, HTTP/2 targeted HOL Blocking at the application layer using **multiplexing**.

Instead of sequential file transfers, HTTP/2 breaks data into small frames. It interleaves these frames over a single connection. Small payloads can now slip between chunks of larger ones. On paper, this looked like true parallel processing.

However, TCP remained the foundation. And **TCP is obsessed with order**.

If one packet is lost, TCP halts everything. This includes frames from entirely unrelated requests. The connection stalls until that specific packet is retransmitted. HTTP/2 widened the lanes at the application layer, but the transport layer's legacy rules froze them.

The decision to build HTTP on top of TCP meant **every new improvement had to live within TCP’s constraints**. HTTP/2 was the best answer the existing system could provide. It offered wider lanes and smarter framing—every possible gain that could be achieved without abandoning the foundation.

**The ceiling was not the design of HTTP/2. The limitation was the foundation itself.**

A choice made in 1981 was quietly setting the upper bound for the future. Thirty-four years later, that legacy was still dictating the hard borders of what innovation could reach.

*Reference: [web.dev: HTTP/2](https://web.dev/articles/performance-http2)*


<br>

## HTTP/3 — Cutting the Path

Google finally made the call to ditch TCP entirely.

There is a common misconception that dropping TCP means losing reliability. In reality, it meant replacing TCP’s legacy functions with a superior system. The new foundation is **UDP**. Unlike TCP, UDP makes no guarantees—no ordering, no retransmission, and no reliability. It simply fires packets and moves on.

Google built **QUIC** directly on top of this bare foundation. QUIC handles everything TCP once did—retransmission, encryption, and connection management—but it does so **per stream**. If one stream stalls, the others keep moving. The root cause of Head-of-Line Blocking is finally eliminated.

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

This is why HTTP/3 is described as "UDP-based." QUIC sits on top of UDP, and HTTP/3 runs on top of QUIC. **TCP was not simply abandoned. Its entire role was strategically replaced.**


### Why YouTube and Zoom were already on UDP

Real-time streaming services made this strategic choice long ago. In a video call, waiting for TCP to retransmit a lost packet freezes the screen. It is often better to skip the missing data and move immediately to the next frame. When **continuity matters more than completeness**, TCP’s reliability actually becomes a liability.

QUIC brought this same instinct to general web traffic. By handling data per stream, a lost packet only stalls the specific stream it belongs to. Everything else continues to move without interruption. The efficiency of real-time streaming has now become the standard for the broader web.

### 0-RTT — Cutting the cost of security too

The 1.5 RTT cost mentioned in Part 2 covered only the TCP handshake. When HTTPS is added, the TLS negotiation must stack on top. This creates a cumulative delay of up to 3 RTT before a single byte of application data moves.

QUIC solves this by integrating TLS 1.3 directly into its transport layer. Connection and security negotiations occur simultaneously instead of in sequence. On return visits, the system can skip the handshake entirely. This collapses the 1.5 RTT delay from Part 2 to zero.

```
┌─────────────────────┬────────────────────┐
│     TCP + TLS       │        QUIC        │
├─────────────────────┼────────────────────┤
│    TCP   1.5 RTT    │ First visit 1 RTT  │
│    TLS   1.5 RTT    │ Return visit 0RTT  │
│    ─────────────    │                    │
│    Total  3 RTT     │                    │
└─────────────────────┴────────────────────┘

```

The trade-off is clear. By abandoning TCP, the application layer assumes full responsibility for packet loss handling, reliability, and security. While this makes the protocol simpler to deploy, the underlying architecture becomes far more complex.

There is a difference between improving a system and replacing one. 

HTTP/2 chose the first path: wider lanes on the same road.
HTTP/3 chose the second: a new road altogether.

The first path is safer. The second is the only one capable of moving the ceiling.

*Reference: [Chromium: QUIC](https://www.chromium.org/quic/)*  <br>
*Reference: [RFC 9000: QUIC](https://www.rfc-editor.org/rfc/rfc9000)*


<br>

## How the Three Versions Compare
```
HTTP/1.1  — Requests must wait in line
time  →   t1      t2      t3      t4      t5
R1        [====]  [====]
R2                        [====]  [====]
R3                                        [====]
R2 can't start until R1 finishes. R3 can't start until R2 finishes.
──────────────────────────────────────────
HTTP/2  — One lost packet freezes everything
time  →   t1      t2      t3      t4      t5
R1        [====]  [====]  [====]
R2        [====]  ✕  ← packet lost
R3        [====]  ← waiting...  ← waiting...
When ✕ occurs, R1, R2, and R3 all freeze.
──────────────────────────────────────────
HTTP/3  — Only the affected stream pauses
time  →   t1      t2      t3      t4      t5
R1        [====]  [====]  [====]  [====]
R2        [====]  ✕ ← packet lost        [retransmit]
R3        [====]  [====]  [====]  [====] ← keeps moving
When ✕ occurs, only R2 pauses. R1 and R3 continue.
```

Each version made a different call on where to absorb the cost.

<br>


## Path Dependency and the Innovator's Dilemma

Throughout this evolution, two invisible patterns have dictated the pace of progress. The first is a legacy decision from decades ago that continued to set a rigid ceiling for every new layer built above it. The second is the inevitable moment where incremental improvements lose their efficacy, forcing a total replacement of the system itself.

These patterns have specific names in the world of management.

### Path Dependency

For decades, every router and firewall on the internet was optimized exclusively for TCP. Even when superior alternatives emerged, abandoning TCP was not merely a technical choice. It was a complex infrastructure negotiation with the entire global network. 

A single architectural decision made in 1981 effectively constrained technical innovation well into the 2020s. This is **Path Dependency** in its purest form, where legacy systems dictate the boundaries of future progress.

### The Innovator's Dilemma

The transition from HTTP/1.1 to HTTP/2 represents **sustaining innovation**. It focused on improving performance while carefully remaining within the established rules of the existing system. This approach was safe but structurally limited.

In contrast, HTTP/3 is a **disruptive innovation**. It abandoned the standard entirely to rebuild on a new foundation. While this shift was inherently risky, it was the only way to break through the structural ceiling that TCP had imposed.

The intersection of these two concepts defines the current state of the web. Path Dependency explains why this evolution took forty years to materialize. The Innovator’s Dilemma explains why such a radical shift had to happen to move the industry forward.

*Reference: [Clayton Christensen: The Innovator's Dilemma](https://www.hbs.edu/faculty/Pages/item.aspx?num=46)*


<br>


## The Bottom Line

HTTP/1.1 trimmed the negotiation fee. HTTP/2 increased the transaction density. Finally, HTTP/3 rejected legacy constraints entirely to recover lost speed. The evolution of protocols is not a simple search for the "right" answer. It is a history of choosing the optimal trade-off for each era.

**Improve along the existing path, or change the path itself. This strategic question applies to far more than just protocols.**

Next up: even with HTTP/3 handling requests efficiently, traffic must still land somewhere. When tens of thousands of requests arrive simultaneously, a decision must be made on where they go. This is the role of the load balancer. The choice between L4 and L7 turns out to be another critical trade-off worth understanding.