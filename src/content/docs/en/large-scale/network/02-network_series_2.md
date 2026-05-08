---
title: Network Part 2 - The Cost of a TCP Handshake
description: The structural cost of TCP's 3-way handshake — what RTT and TIME_WAIT mean under high-volume traffic, and why Transaction Cost Theory explains the birth of Keep-Alive.
sidebar:
  order: 3
date: 2026-04-13
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 13, 2026</p>

> Imagine a high-demand ticket drop. Tens of thousands of people clicking the "Buy" button at the exact same millisecond. The server collapses—long before a single byte of actual data has moved. That’s the strange part: nothing has been exchanged yet. So, what exactly wore the server out?
>
> There is essential labor that must occur before data can flow. Until that work is finished, the transaction hasn't even begun. In fact, it can't.

<br>

**Every transaction carries a setup cost.** Verifying the counterparty. Aligning on terms. Confirming mutual readiness. The more a transaction relies on trust, the higher that setup cost becomes.

**Network protocols follow the same economic logic.** Before data can move reliably, both sides must establish a shared understanding: that packets will arrive, that order will be preserved, and that nothing will vanish without a response. None of this is free. It takes time—and that time compounds much faster than most expect.

<br>

## TCP Contract Protocols Before Data Flow

TCP made a clear choice: **no data moves until a contract is established.**

Both sides exchange signals to confirm readiness. Until this exchange is finished, not a single byte of actual data is transmitted. The entire initial period is dedicated to process—to the "paperwork" of networking.

This is the handshake: trust acquired at the expense of speed.

The fundamental problem is that this contract is not reusable. Every new connection must start from scratch. A single handshake for one user is manageable. However, when ten thousand users hit the server at once, the setup costs alone can crash the system before any real work begins.

```
Client                            Server
  |                                 |
  |  ———————————— SYN ——————————>   |  "Can we connect?"
  |                                 |
  |  <————————— SYN-ACK —————————   |  "Yes. Are you ready?"
  |                                 |
  |  ———————————— ACK ——————————>   |  "Ready. Let's go."
  |                                 |
  |       [ Data transfer ]         |
```

Three signals must pass before data can flow. SYN and SYN-ACK represent the negotiation. ACK is the final signature. The actual transaction only starts once all three steps are complete.

<br>

## The Double Bill of RTT and TIME_WAIT

### Opening the connection — RTT

The time required to complete a handshake is strictly tied to physical distance. For instance, a request from Seoul to a US server takes roughly 150ms per round trip. This is <strong>RTT (Round Trip Time)</strong>.

TCP needs at least 1.5 round trips before the server receives the first byte of the payload. From the moment a user clicks to the moment the server registers the request, <strong>225ms (150ms × 1.5)</strong> has already evaporated.

One request, 225ms. With ten thousand concurrent users, you face ten thousand instances of this overhead. No amount of server-side optimization can eliminate it. RTT is a **fixed cost**—locked to the laws of physics, not the quality of your infrastructure.

### Closing the connection — TIME_WAIT

The bill doesn't stop when the transaction ends. TCP holds a closed port in a **TIME_WAIT** state for up to two minutes. This is a defensive measure: it ensures that late-arriving packets from the previous connection do not collide with a new one using the same port.

From Network Part 1: roughly 28,000 ports are available. A server handling 500 connections per second will accumulate 60,000 TIME_WAIT ports (500/s × 120s) before the two-minute window clears. This is more than double the available capacity. At this point, the server can no longer accept new connections.

```
After connection closes:

Port 5001  [TIME_WAIT ——————————— 2 min ———————————]
Port 5002  [TIME_WAIT ——————————— 2 min ———————————]
Port 5003  [TIME_WAIT ——————————— 2 min ———————————]
  ...
Port 5028  [TIME_WAIT ——————————— 2 min ———————————]

→ 28,000 ports exhausted. No new connections accepted.
```

**RTT** is the cost of opening; **TIME_WAIT** is the cost of closing. **TCP** charges a premium on both ends.

*Reference: [Cloudflare Learning: What is round-trip time?](https://www.cloudflare.com/learning/cdn/glossary/round-trip-time-rtt/)* <br>
*Reference: [Cloudflare Learning: What is TCP/IP?](https://www.cloudflare.com/learning/ddos/glossary/tcp-ip/)*

<br>

## Transaction Cost Theory and Keep-Alive Optimization

In 1937, Ronald Coase famously asked why markets aren't frictionless. His answer was simple: every transaction demands a hidden tax—the cost of searching for partners, negotiating terms, and signing contracts. TCP is essentially a network implementation of that reality. Every connection demands a "negotiation fee," and **Transaction Cost Theory** points to exactly one solution.

*Reference: [UBS Nobel Perspectives: Oliver Williamson — Transaction Cost Theory](https://www.ubs.com/microsites/nobel-perspectives/en/laureates/oliver-williamson.html)*

**The most effective way to reduce transaction costs is to reduce the frequency of transactions.**

The goal isn't necessarily faster contracts, but fewer of them. This is the core logic behind **HTTP Keep-Alive**. Instead of opening and closing a connection for every single request, Keep-Alive maintains a persistent connection across multiple requests. The setup cost is distributed—amortized over an entire session rather than paid upfront for every request.

Keep-Alive addressed the contract problem, but it wasn't a total cure. Even within a persistent connection, a rigid rule remained: requests had to be processed in the exact order they arrived. We fixed the negotiation fee, but suddenly the queue itself became the bottleneck.

That's where the next part picks up.

<br>

## The Bottom Line

The TCP handshake is the price of trust. **RTT** is the cost of opening a connection, and **TIME_WAIT** is the debt incurred after closing one. In the language of Transaction Cost Theory, TCP is a protocol that levies a "negotiation fee" on every single connection.

**The optimization insight isn't "connect faster." It's "connect less." HTTP has been moving in that direction ever since.**

Next up: HTTP/1.1 addressed the frequency problem with Keep-Alive, only to hit a different wall. A single queue with no passing. We fixed the engine, but realized the road was only one lane.