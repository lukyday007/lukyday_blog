---
title: Network Part 2 - The Cost of a TCP Handshake
description: The structural cost of TCP's 3-way handshake — what RTT and TIME_WAIT mean under high-volume traffic, and why Transaction Cost Theory explains the birth of Keep-Alive.
sidebar:
  order: 3
---

> TCP's approach to reliability is straightforward: establish a contract before sending anything. But have you ever stopped to think about how expensive that contract actually is?
>
> Picture a flash sale. The moment thousands of users click that button, the server has something to do before it can process a single request — negotiate a connection with each one of them. Signals go back and forth. Readiness gets confirmed. Only then does real data start moving. Under load, the server isn't buried in data. It's buried under a mountain of contract negotiations.

<br>
<br>

This is how TCP earns its reliability. And that reliability always comes at a price.

<br>

### How TCP Establishes a Connection

TCP guarantees delivery. It reassembles out-of-order packets and retransmits anything lost in transit. But all of that reliability hinges on one prerequisite: both sides must confirm their readiness before a single byte of data moves.

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

Three signals have to complete before data can move. What's important here is that throughout this entire exchange, not a single byte of actual payload — the data you actually wanted to send — has been transmitted. Every millisecond spent so far has gone purely toward establishing the connection itself. That's the procedural cost of reliability.


<br>


### What Happens Between the Three Signatures

**RTT — Distance becomes cost**

The time it takes to send a SYN and receive a SYN-ACK back is called RTT — Round Trip Time. Seoul to a US-based server sits around 150ms RTT.

A TCP handshake takes 1.5 round trips before the server can begin processing your actual data — 0.5 RTT for SYN, 0.5 for SYN-ACK, and 0.5 for the first data packet to arrive. On a Seoul-to-US connection with ~150ms RTT, that means <Strong>225ms (150ms × 1.5)</Strong> has already evaporated before a single byte of your request is processed.

One request, 225ms. Ten thousand concurrent users means that cost runs 10,000 times simultaneously. This isn't a hardware problem — it's a fixed cost of the protocol.


**TIME_WAIT — Closed connections still hold their spot**

When a connection closes, the port doesn't immediately free up. TCP holds terminated connections in a TIME_WAIT state for up to two minutes—a safeguard against late-arriving packets colliding with new connections.

In Network Part 1, we established that a server has roughly 28,000 usable ports. Now, picture a high-traffic server closing 500 connections per second. To sustain this, you would need 60,000 available ports (500/s × 120s) just to handle the queue of closing connections. Since we only have 28,000, the server hits a wall long before the first minute is even up. New connections have nowhere to go—the system has run out of breath.


```
After connection closes:

Port 5001  [TIME_WAIT ——————————— 2 min ———————————]
Port 5002  [TIME_WAIT ——————————— 2 min ———————————]
Port 5003  [TIME_WAIT ——————————— 2 min ———————————]
  ...
Port 5028  [TIME_WAIT ——————————— 2 min ———————————]

→ 28,000 ports exhausted. No new connections accepted.
```

RTT is the cost of opening a connection. TIME_WAIT is the cost of closing one. Under high-volume traffic, TCP charges at both ends.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.cloudflare.com/learning/cdn/glossary/round-trip-time-rtt/">Cloudflare Learning: What is round-trip time?</a><br>
  <a href="https://www.cloudflare.com/learning/ddos/glossary/tcp-ip/">Cloudflare Learning: What is TCP/IP?</a>
</div>

<br>

### The Cost of Making a Deal

In 1937, economist Ronald Coase asked a deceptively simple question: Why don't market transactions happen frictionlessly? His answer: Every transaction carries "preparation costs." Finding a counterparty, negotiating terms, and formalizing an agreement—the process itself has a price. Oliver Williamson later formalized this as Transaction Cost Theory.

The TCP handshake is this theory expressed in network architecture. Before any data moves, both sides must enter a binding contract. SYN and SYN-ACK are the negotiation; ACK is the final signature. The actual transaction—data transfer—only begins after all three steps are complete.

Transaction Cost Theory's core insight is simple: <Strong>the most effective way to reduce transaction costs is to reduce the number of transactions.</Strong> Instead of renegotiating a new contract for every exchange, you keep one contract alive and reuse it as much as possible.

That is precisely the logic behind HTTP Keep-Alive. Rather than paying the "handshake tax" for every single request, it keeps the connection open across multiple requests—amortizing the setup cost across dozens of exchanges.

However, Keep-Alive alone wasn't a silver bullet. HTTP still faced structural limitations—like the "Head-of-Line Blocking" problem—that prevented it from being truly efficient. In Part 3, we'll look at how the protocol had to evolve further to overcome these remaining frictions.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.ubs.com/microsites/nobel-perspectives/en/laureates/oliver-williamson.html">UBS Nobel Perspectives: Oliver Williamson — Transaction Cost Theory</a>
</div>

<br>

### The Bottom Line

TCP's handshake is the price of reliability. RTT is what you pay to open a connection. TIME_WAIT is what you pay after closing one. In the language of Transaction Cost Theory, TCP is a protocol that charges a negotiation fee on every single connection.

**The goal isn't to make connections faster. It's to make fewer of them. That's the direction HTTP has been moving ever since.**

Next up: how HTTP/1.1 introduced Keep-Alive to soften the blow, how HTTP/2 took it further with multiplexing, and why HTTP/3 made the most radical call of all — ditching TCP entirely.