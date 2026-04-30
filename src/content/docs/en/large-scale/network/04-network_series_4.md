---
title: Network Part 4 - Where to Split, Why to Read?
description: From the limits of DNS round-robin to the trade-offs of L4/L7 load balancers — where you split traffic determines what your system can and cannot do.
sidebar:
  order: 5
date: 2026-04-29
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 29, 2026</p>

> October 4, 2021. Facebook, Instagram, and WhatsApp went completely dark for roughly six hours — all at once. The servers were fine. No bad deploy. A single command run during routine maintenance withdrew every one of Facebook's BGP routes. The internet forgot how to reach Facebook's data centers. Traffic had nowhere to go. Facebook ceased to exist on the internet.
>
> The servers were running. The load balancers were healthy. Everything was fine. Requests just couldn't get in. That's what happens when traffic distribution breaks at the routing layer. No matter how well-built the system behind the load balancer is — if requests can't reach it, none of it matters.

<br>
<br>

Not all load balancers work the same way. Some look only at the outside of a packet and route it fast. Others open the packet, read what's inside, and decide based on the contents. In Part 1, the trade-off was clear: L4 is fast because it stays ignorant, L7 is precise because it pays to know. Load balancers face the same choice. Which layer do you split traffic at?

<br>

### DNS Round Robin — Blind by Design

The most primitive form of load balancing starts at DNS. Register multiple server IPs under one domain, and hand out a different IP in rotation for each incoming request. That's **DNS round-robin**.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.cloudflare.com/learning/dns/glossary/round-robin-dns/">Cloudflare Learning: What is round-robin DNS?</a><br>
  <a href="https://www.cloudflare.com/learning/performance/what-is-dns-load-balancing/">Cloudflare Learning: What is DNS load balancing?</a>
</div>


```
                ┌───────────────┐
                │     Client    │
                └───────────────┘
                        ↓
              "What's example.com?"
                        ↓
    ┌──────────────────────────────────────┐
    │               DNS Server             │
    │  (Returns a different IP each time)  │
    └──────────────────────────────────────┘
        ┌───────────────┼───────────────┐
  [1st request]   [2nd request]    [3rd request]
       ↙                ↓                ↘
 ┌────────────┐   ┌────────────┐   ┌────────────┐
 │  Server A  │   │ Server B   │   │  Server C  │
 │192.168.0.1 │   │192.168.0.2 │   │192.168.0.3 │
 └────────────┘   └────────────┘   └────────────┘

[Structural limits]

✗ Blind to server state
  → DNS keeps returning Server A even when it's overloaded
✗ Can't detect failures
  → DNS keeps responding with Server B's IP even after it goes down
✗ TTL caching
  → once a client receives an IP, it keeps hitting that server until TTL expires
```

DNS round-robin looks balanced in theory.

Imagine a theme park with three parking lots — A, B, and C. The navigation app at the entrance sends cars in rotation: first to A, next to B, then C. Arithmetically balanced.
 
But the navigation app doesn't check the server every time. It trusts the answer it got for a fixed window. "This information is valid for 10 minutes" — timer starts, server goes unchecked. That's **TTL (Time-To-Live)**: an expiration date on information.
 
This is where the breakdown happens. Picture a convoy of tourist buses arriving back-to-back. The first bus gets "go to Lot A." Every bus behind it copies that answer without checking — their devices already have it cached. The server is ready to send the next convoy to Lots B and C. But the buses aren't asking anymore. Lot A is jammed. Lots B and C sit empty.

Economist George Akerlof described this structure in his 1970 paper "The Market for Lemons" as **Information Asymmetry**. In the used car market, sellers know the defects; buyers don't. That gap alone distorts the entire market.
 
<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://en.wikipedia.org/wiki/The_Market_for_Lemons">Information Asymmetry</a><br />
</div>

DNS round-robin works the same way. The DNS server knows Server A is overloaded. The client won't find out until TTL expires. The distribution gets skewed — not because caching is broken, but because of a structural disconnect between the party that has the information and the party that needs it.

**DNS round-robin looks like load balancing. In practice, it's blind rotation.**

<br>

### L4 Load Balancer — Fast by Choice

The L4 load balancer follows the same philosophy introduced in Part 1. It doesn't open the packet. It reads only the destination address (IP) and port number on the envelope, and decides where to send it from there.

```
[Transport Layer]

            ┌───────────────────┐
            │   Client Request  │
            └───────────────────┘      
                      ↓
      ┌─────────────────────────────────┐
      │         L4 Load Balancer        │
      │                                 │
      │         ✓ IP address            │
      │       ✓ Check Port number       │
      │        ✗ Packet content         │
      └─────────────────────────────────┘    
        ↙             ↓             ↘
  ┌───────────┐ ┌───────────┐ ┌───────────┐
  │ Server A  │ │ Server B  │ │ Server C  │
  └───────────┘ └───────────┘ └───────────┘      
  ( Based on IP hash or least connections )        
```

No content inspection means fast decisions. Millions of concurrent connections, handled. It fits environments where large numbers of clients open simple TCP connections simultaneously — game servers, for example.

L4 is a strategy that accepts the information gap. It makes routing decisions without knowing what's inside the packet. Where DNS round-robin failed because it lacked information, L4 turns that same ignorance into a deliberate choice. DNS misdistributes because it doesn't know. L4 trades knowing for speed.

The limits follow from that choice. No content visibility means no URL-based routing. You can't send `/api/payments` to the payments cluster and `/api/products` to the product cluster. You can't read cookies. Session persistence isn't possible.

<br>

### L7 Load Balancer — Informed by Design

The L7 load balancer reads the packet. HTTP headers, URL paths, cookies, request body. It opens the envelope, reads the letter, and routes it to whoever handles that specific content.

```
[Application Layer]
 
              ┌───────────────────┐
              │   Client Request  │
              └───────────────────┘
                        ↓
            ┌────────────────────────┐
            │    L7 Load Balancer    │
            │                        │
            │  ✓ IP address / port   │
            │  ✓ HTTP method / URL   │
            │  ✓ Host header         │
            │  ✓ Cookies / body      │
            └────────────────────────┘
          ↙             ↓             ↘
    ┌───────────┐  ┌──────────┐   ┌──────────┐
    │  Payment  │  │  Product │   │   User   │
    │  Server   │  │  Server  │   │  Server  │
    └───────────┘  └──────────┘   └──────────┘
               Routing based on URL path
```

Reading the URL means `/api/payments` goes to the payments server and `/api/products` goes to the product server. Reading cookies enables **session persistence** — if a user's cart data lives only on Server A, L7 reads the user ID from the cookie and keeps sending that user back to Server A.

L7 is a strategy that pays to close the information gap. Transaction Cost Theory from Part 2 applies here too. Acquiring information has a cost. Parsing headers, inspecting URLs, reading cookies — all of it is the price of knowing. In exchange for paying that cost, L7 can make decisions L4 simply cannot.

The trade-off is structural. Every request gets parsed and interpreted. That overhead is categorically higher than L4. As traffic scales, the cost compounds.

<br>

### L4 vs L7 — Where the Bottleneck Is

<table style="width:100%;border-collapse:collapse;font-size:13px;margin:1rem 0;">
  <thead>
    <tr>
      <th style="width:22%;color:var(--sl-color-gray-2);font-size:12px;padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-4);font-weight:400;text-align:left;"></th>
      <th style="width:39%;padding:10px 16px;border-bottom:0.5px solid #378ADD;background:#E6F1FB;color:#0C447C;font-weight:500;text-align:left;">L4 Load Balancer</th>
      <th style="width:39%;padding:10px 16px;border-bottom:0.5px solid #1D9E75;background:#E1F5EE;color:#0F6E56;font-weight:500;text-align:left;">L7 Load Balancer</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Sees</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">IP address, port number</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">HTTP headers, URL, cookies, request body</td>
    </tr>
    <tr style="background:var(--sl-color-bg-nav);">
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Speed</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">Fast</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">Slower</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Routes by</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">Connection count, IP hash</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">URL path, cookies, headers</td>
    </tr>
    <tr style="background:var(--sl-color-bg-nav);">
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:var(--sl-color-gray-2);font-size:12px;">Can do</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0C447C;">Simple TCP distribution</td>
      <td style="padding:10px 16px;border-bottom:0.5px solid var(--sl-color-gray-5);color:#0F6E56;">Content-based routing<br>A/B testing<br>Session persistence</td>
    </tr>
    <tr>
      <td style="padding:10px 16px;color:var(--sl-color-gray-2);font-size:12px;">Common use</td>
      <td style="padding:10px 16px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;margin-right:4px;">Game servers</span>
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E6F1FB;color:#185FA5;border:0.5px solid #378ADD;">High-volume streaming</span>
      </td>
      <td style="padding:10px 16px;">
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;margin-right:4px;">API Gateway</span>
        <span style="font-size:11px;padding:2px 7px;border-radius:20px;background:#E1F5EE;color:#0F6E56;border:0.5px solid #1D9E75;">Microservices</span>
      </td>
    </tr>
  </tbody>
</table>

Goldratt's Theory of Constraints from Network Part 1 applies directly here. The constraint is never fixed — **it's wherever the system is closest to 100% saturation**. The question of which OSI layer is the bottleneck becomes the question of which load balancer to use.

Concurrent connections approaching the limit: L4. Requests that need to be routed based on their content: L7. In practice, many production systems layer both — L4 receives traffic first and distributes it across server groups, then L7 handles fine-grained routing within each group.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.haproxy.com/blog/layer-4-and-layer-7-proxy-mode">HAProxy Blog: Layer 4 and Layer 7 Proxy Mode</a>
</div>

<br>

### Own the Information, or Let It Go

Three systems. Same problem. Three different answers.

DNS round-robin failed because it couldn't see server state. It rotated blind. The information gap distorted the distribution.

L4 chose to give up information. It makes decisions without knowing the contents — and converts that ignorance directly into speed. The gap becomes an asset.

L7 chose to buy information. It pays in parsing time and gets precision in return. The gap gets closed at a cost.

What Akerlof showed wasn't that information gaps are inherently bad — it's that **how you handle the gap is what determines the outcome**. Used car markets that ignored the gap collapsed. Markets that bridged it with warranties survived.

Load balancers work the same way. Ignore the gap and you get DNS. Accept it and you get L4. Close it and you get L7.

**The question isn't whether the information gap exists. It's what you do with it.**

This is the same structure that's run through every part of this series. Goldratt asked where the constraint is. Coase and Williamson explained the conditions under which paying transaction costs makes sense. Akerlof showed how information gaps split behavior. Different names across four parts — but the same question underneath.

**Where is the bottleneck right now, and what are you willing to give up to clear it?**

<br>

### The Bottom Line

DNS round-robin assigns slots without knowing server state. Information asymmetry distorts the distribution. L4 gives up information and gets speed. L7 acquires information and gets precision. Each approach makes a different call on where to absorb the cost.

Which layer you split traffic at isn't a technical preference — it's a trade-off decision. The same question this series has been asking from Part 1. Where is the constraint, and what do you give up to resolve it?

**Know where the bottleneck is, and you'll know where to split. Know how to handle the information gap, and you'll know how to split.**

Next up: everything covered so far — OSI layers, TCP handshake costs, HTTP evolution, load balancing — comes together in real systems. Three scenarios: an e-commerce platform, a live chat service, and a payment system. Where does the bottleneck form, and which choices resolve it?