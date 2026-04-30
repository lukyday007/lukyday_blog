---
title: Network Part 2 - The Cost of a TCP Handshake
description: The structural cost of TCP's 3-way handshake — what RTT and TIME_WAIT mean under high-volume traffic, and why Transaction Cost Theory explains the birth of Keep-Alive.
sidebar:
  order: 3
date: 2026-04-13
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 13, 2026</p>


> Picture a ticket drop. Tens of thousands of people clicking at the same moment. The server collapses — before a single byte of real data has moved. That's the strange part. Nothing was actually exchanged yet. So what wore the server out?
>
> There's work that has to happen before the data can flow. Until that work is done, the transaction hasn't started. It can't.

<br>
<br>

Every transaction has a setup cost. Verifying the other party. Aligning on terms. Confirming readiness on both sides. The more a transaction depends on trust, the more that setup costs.

Networks are no different. Before data can move reliably, both sides have to establish a shared understanding — that packets will arrive, that order will be preserved, that nothing will go missing without a response. None of that is free. It takes time. And that time adds up faster than most people expect.

<br>

### TCP's Call — Contract Before Data

TCP made a deliberate choice: **no data moves until a contract is in place.**

Both sides exchange signals to confirm they're ready. Until that exchange completes, not a single byte of actual payload is transmitted. The entire window is spent on process. On paperwork.

That's the handshake. Trust purchased at the cost of speed.

The deeper problem is that this contract doesn't carry over. Every new connection starts from scratch. One user, one handshake — manageable. Ten thousand users hitting the server simultaneously — the setup cost alone is enough to bring it down, before the real work has even begun.

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

Three signals. Only then does data flow. SYN and SYN-ACK are the negotiation. ACK is the signature. The actual transaction — the data — doesn't start until all three are done.

<br>

### The Bill Comes Twice

**Opening the connection — RTT**

The time it takes to complete the handshake is tied to physical distance. Seoul to a US server: roughly 150ms per round trip. That's RTT — Round Trip Time.

TCP needs at least 1.5 round trips before the server receives the first byte of data. From the moment a user clicks to the moment the server registers what was sent: <strong>225ms (150ms × 1.5)</strong> is already gone.

One request, 225ms. Ten thousand concurrent users, ten thousand instances of that cost. No amount of server-side optimization touches it. RTT is a fixed cost — locked to physics, not infrastructure.

**Closing the connection — TIME_WAIT**

The bill doesn't stop when the connection ends. TCP holds a closed port in TIME_WAIT for up to two minutes. The reason is defensive: late-arriving packets from the old connection shouldn't collide with a new one using the same port.

From Part 1: roughly 28,000 ports are available. A server handling 500 connections per second will accumulate 60,000 TIME_WAIT ports (500/s × 120s) before the two-minute window clears. That's more than double the limit. New connections stop being possible.

```
After connection closes:

Port 5001  [TIME_WAIT ——————————— 2 min ———————————]
Port 5002  [TIME_WAIT ——————————— 2 min ———————————]
Port 5003  [TIME_WAIT ——————————— 2 min ———————————]
  ...
Port 5028  [TIME_WAIT ——————————— 2 min ———————————]

→ 28,000 ports exhausted. No new connections accepted.
```

RTT is the cost of opening. TIME_WAIT is the cost of closing. TCP charges on both ends.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.cloudflare.com/learning/cdn/glossary/round-trip-time-rtt/">Cloudflare Learning: What is round-trip time?</a><br>
  <a href="https://www.cloudflare.com/learning/ddos/glossary/tcp-ip/">Cloudflare Learning: What is TCP/IP?</a>
</div>

<br>

### Transaction Cost Theory and Keep-Alive

In 1937, Ronald Coase famously asked why markets aren't frictionless. His answer was simple: every transaction demands a hidden tax—the cost of searching for partners, negotiating terms, and signing contracts. TCP is a network implementation of that idea. Every connection comes with a negotiation fee. And Transaction Cost Theory points to exactly one solution.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.ubs.com/microsites/nobel-perspectives/en/laureates/oliver-williamson.html">UBS Nobel Perspectives: Oliver Williamson — Transaction Cost Theory</a>
</div>

**The most effective way to reduce transaction costs is to reduce the number of transactions.**

Not faster contracts — fewer contracts. That's the logic behind HTTP Keep-Alive. Instead of opening and closing a connection for every request, Keep-Alive holds the connection open across multiple requests. The handshake cost gets distributed — not paid once per request, but once per session.

Keep-Alive solved the contract problem. But it didn't solve everything. Even inside a persistent connection, there was still a hard rule: requests had to be handled in the order they arrived. Fix the negotiation fee, and suddenly the queue itself becomes the bottleneck.

That's where the next part picks up.

<br>

### The Bottom Line

The TCP handshake is the price of trust. RTT is what you pay to open a connection. TIME_WAIT is what you owe after closing one. In the language of Transaction Cost Theory, TCP is a protocol that charges a negotiation fee on every single connection.

**The optimization insight isn't "connect faster." It's "connect less." HTTP has been moving in that direction ever since.**

Next up: HTTP/1.1 solved the connection frequency problem with Keep-Alive. Then it ran into a different wall. One queue, no passing. Fix the engine — and suddenly the road is one lane.