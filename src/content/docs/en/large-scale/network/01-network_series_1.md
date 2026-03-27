---
title: Network Part 1 - The OSI Model as a Fault Map
description: How to read the OSI model as a bottleneck diagnostic tool — the distinct failure modes of L4 and L7, and why Conway's Law explains the layered design.
sidebar:
  order: 2
---

> In a previous post, we watched a single DNS misconfiguration on one AWS server bring 3,500 companies across 60 countries to a standstill. DNS lives at Layer 7. The failure started there.
>
> This kind of thing repeats. On June 21, 2022, a misconfigured BGP route at Cloudflare blocked 50% of all global HTTP traffic. No server was overloaded. No deployment had gone wrong. Packets simply lost their way and looped endlessly through the network. This time, the failure was at Layer 3.

<br>
<br>

Both incidents share one thing: it took far too long to find the cause. Because no one knew which layer had failed.

The OSI model is not a taxonomy for networking textbooks. **It's a fault map — a way to pinpoint exactly where a system breaks.**

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://blog.cloudflare.com/cloudflare-outage-on-june-21-2022/">Cloudflare Blog: Cloudflare outage on June 21, 2022</a>
</div>

<br>

### Why the Layers Don't Talk to Each Other

Before the fault map makes sense, this question needs an answer. Why does the OSI model split into 7 layers at all? Wouldn't it be more efficient if each layer could see what the others were doing?

In 1968, software engineer Melvin Conway proposed what has since become foundational in systems design:

> *"Any organization that designs a system will produce a design whose structure is a copy of the organization's communication structure."* — Conway's Law

The OSI model is that principle applied to network architecture. Each layer communicates only through a defined interface. Internal implementation stays private. Layer 4 has no idea whether Layer 7 is speaking HTTP or gRPC. Layer 3 doesn't know — or care — whether Layer 4 is TCP or UDP.

This is **deliberate ignorance**. And that ignorance produces two trade-offs:

* **Freedom to change:** Migrating from HTTP/1.1 to HTTP/2 happens entirely within Layer 7. Everything below stays untouched. The layers are decoupled by design.
* **Fault isolation:** A routing failure at Layer 3 has no bearing on your application logic at Layer 7. The blast radius is contained to one layer.

That's why the Cloudflare outage could be called "a Layer 3 problem" immediately. Without the layered design, the cause would have been buried somewhere in the full stack.

**Each layer chose not to know the others. That's exactly what makes it possible to know which layer broke.**

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://martinfowler.com/bliki/ConwaysLaw.html">Martin Fowler: Conway's Law</a>
</div>

<br>

### Every Layer Has Its Own Breaking Point

Goldratt's Theory of Constraints is direct: the output of any system is capped by its weakest link. Networks are no exception. But the *nature* of the bottleneck changes depending on which layer you're looking at.

Packets travel down from L7 to L1 on the sender's side — each layer wrapping the data in its own envelope. On the receiving end, they unwrap back up from L1 to L7. Seven layers. Seven handoffs. Under high-volume traffic, one of those handoffs will crack first. The question is which one, and why.

<br>

**L4 — Speed was the goal. Awareness was the price.**

Layer 4 is deliberately blind to content. It sees an IP address, a port number, a protocol — TCP or UDP — and nothing else. It never opens the packet. Think of it as a courier that delivers sealed envelopes without knowing what's inside. That's why it's fast.

But that choice has structural consequences. Every TCP connection occupies a port. Port numbers top out at 65,535 — with a realistic working range of around 28,000. Once concurrent connections hit that ceiling, the system stops accepting new ones. No exceptions.

**L4's bottleneck is connection count.** Ticketing drops, flash sales, live-streamed events — any scenario where thousands of users connect simultaneously runs straight into this wall.

<br>

**L7 — Awareness was the goal. Speed was the price.**

Layer 7 sees everything: HTTP headers, URL paths, cookies, request bodies. It reads the packet, understands the context, and makes decisions accordingly. That's enormously powerful.

But that knowledge is expensive. Parsing takes time. Authentication takes time. Decompression, routing logic, business rules — they all stack. The per-request Logic Latency at L7 is higher than anywhere below it by design. As traffic scales, those costs don't just add — they compound.

L4 stays blind and stays fast. L7 stays aware and pays for it. Neither is a flawed design. They made different trade-offs.

<br>

Pull back to all seven layers, and the picture looks like this:
```
         Rate of Saturation → 100%
L7  [████████████░░]  Logic Latency spikes   ← felt first
L4  [███████░░░░░░░]  Concurrency ceiling
L3  [█████░░░░░░░░░]  Routing overhead
L1  [███░░░░░░░░░░░]  Throughput saturation  ← when this goes, everything goes
```

L7 hits the wall first. L1 going down means nothing gets through at all. Under high-volume load, there's only one question that matters: **which layer is closest to 100% Saturation right now?**

*How to resolve L4 and L7 bottlenecks in practice — that's Part 4 (Load Balancers).*

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://sre.google/sre-book/monitoring-distributed-systems/">Google SRE Book: Monitoring Distributed Systems</a><br>
  <a href="https://www.rfc-editor.org/rfc/rfc793">RFC 793: Transmission Control Protocol</a>
</div>

<br>

### The Bottom Line

The OSI model isn't a protocol classification system. Each layer is an independent failure candidate with its own breaking point. And the reason those layers exist in the first place is itself a trade-off — give up awareness to gain speed, or give up speed to gain awareness.

The layer where Saturation hits 100% first is the constraint. The boundaries between layers are what make that constraint findable — and fixable — without touching everything else.

**Engineers who understand this don't panic when something breaks. They don't touch the whole system. They ask which layer. Then they fix that layer.**

Next up: Layer 4, up close. We'll look at the hidden cost of TCP's 3-way handshake — the process every connection must complete before a single byte of real data moves. Under load, that turns out to be anything but cheap.