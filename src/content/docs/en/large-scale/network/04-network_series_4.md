---
title: Network Part 4 - Where to Split, Why to Read.?
description: From the limits of DNS round-robin to the trade-offs of L4/L7 load balancers — where you split traffic determines what your system can and cannot do.
sidebar:
  order: 5
date: 2026-04-29
---

<p style="font-size: 0.85rem; color: var(--sl-color-gray-3); text-align: right;">Published: April 29, 2026</p>

> October 4, 2021. Facebook, Instagram, and WhatsApp went dark simultaneously for nearly six hours. No server crashed. No code was deployed. A routine maintenance command accidentally withdrew all of Facebook's BGP routes — the instructions that tell the rest of the internet how to reach Facebook's data centers. With no route to follow, traffic had nowhere to go. Facebook had vanished from the internet.
>
> The servers were running. The load balancers were running. Everything was fine — except that no traffic could reach any of it. This is what happens when traffic distribution breaks at the routing level. It doesn't matter how well you've built the system behind the load balancer if requests can't find their way in.

<br>
<br>

Not all load balancers work the same way. Some look only at the outside of a packet and distribute it fast. Others read the contents and decide where to send it. In Part 1, we said L4 is fast because it doesn't know what's inside, and L7 is slower because it does. Load balancers face the same choice. Which layer do you split traffic at?

<br>

### DNS Round Robin — Blind by Design

The most primitive form of load balancing starts at DNS. Register multiple server IPs under a single domain, and return a different IP in rotation each time a request comes in. That's **DNS Round Robin**.

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

On paper, the design looks airtight. Imagine a theme park with three parking lots — A, B, and C. The navigation app at the entrance sends cars in rotation: first to A, next to B, then C. Arithmetically balanced.
 
But the navigation app doesn't check the server every time. It trusts the answer it got for a fixed window. "This information is valid for 10 minutes" — timer starts, server goes unchecked. That's **TTL (Time-To-Live)**: an expiration date on information.
 
Here's where the bottleneck emerges. Picture a convoy of hundreds of tour buses pulling in. The moment the lead bus gets "Head to Lot A," every bus behind it copies that answer without asking again. It's already locked in on each device: *A is the answer right now*.
 
The server is ready to send the next convoy to Lots B and C. But the buses don't look. Lot A is gridlocked at the entrance while B and C sit empty.
 
The server distributed correctly. The only problem: the buses held onto that answer for ten minutes and never let go. DNS round-robin can control *what* it tells you, but not *how long you'll believe it*.
 
Economist George Akerlof gave this structure a name in his 1970 paper "The Market for Lemons": **Information Asymmetry**. In the used car market, sellers know the condition of the car — buyers don't. That single gap warps the entire market.
 
<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://en.wikipedia.org/wiki/The_Market_for_Lemons">Information Asymmetry</a><br />
</div>

DNS round-robin works the same way. The DNS server knows Server A is overloaded. The client has no way to find out until the TTL expires. The distortion isn't a caching bug. It's a structural information gap.
 
**DNS round-robin looks like distribution. In practice, it's blind rotation.**

<br>

### L4 Load Balancer — Fast by Choice

The L4 load balancer follows the same philosophy we introduced in Part 1. It doesn't open the packet. It reads only the address on the envelope — IP address and port number — and decides where to send it.

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

No content reading means fast processing. Millions of concurrent connections. Ideal for environments like game servers where massive numbers of clients open simple TCP connections simultaneously. It doesn't need to know what game is being played. It just keeps handling connections.
 
Conway's Law from Network Part 1 — **intentional ignorance** — operates here too. L4 isn't uninformed. It chose not to look. That trade-off buys speed. But it also pays the price of information asymmetry. If it can't see what's in the packet, it can't know that a payment request should go to the payment server. The less it knows, the simpler its decisions.
 
What L4 can't do: route a specific user to a specific server, or differentiate between `/api/payments` and `/api/products` to send traffic to different backends.

<br>

### L7 Load Balancer — Informed by Design

The L7 load balancer opens the packet and reads it. HTTP headers, URL path, cookies, even the request body. It's like opening the envelope, reading the letter, and then routing it to the right person.

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

Reading the URL means `/api/payments` goes to the payment server and `/api/products` goes to the product server. Reading cookies makes **Session Persistence** possible. If a user's shopping cart is stored on Server A, they need to keep landing on Server A. L7 reads the user ID from the cookie and routes them there every time.
 
In Network Part 2, Oliver Williamson's Transaction Cost Theory said: acquiring information always has a cost. L7 is the side that willingly pays it. Opening the packet, parsing the headers, interpreting the URL — all of it is a transaction cost paid to obtain information. In return, it makes decisions L4 never could.
 
The downside: reading takes time. Parsing and interpreting every request is structurally more expensive than L4. As traffic grows, those costs compound.

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

This is where Goldratt's Theory of Constraints — first introduced in Network Part 1 — applies directly. The constraint isn't always the same. **It depends on where the system is closest to 100% saturation.** The same principle that told us which OSI layer was bottlenecked now tells us which load balancer to reach for.

If concurrent connection count is approaching its ceiling, use L4. If requests need different handling based on their content, use L7. In practice, many systems use both in layers. L4 takes traffic first and splits it into server groups; L7 handles fine-grained routing within those groups.

<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://www.haproxy.com/blog/layer-4-and-layer-7-proxy-mode">HAProxy Blog: Layer 4 and Layer 7 Proxy Mode</a>
</div>

<br>

### The Cost of Reading vs. The Cost of Not Knowing

Supply chain management has a theory called **Risk Pooling** — the idea that where you hold inventory determines not just logistics cost, but how quickly you can respond when demand shifts.
 
<div style="text-align: right; margin-top: -0.5rem;">
  <a href="https://hbr.org/1994/11/from-supply-chain-to-value-chain">HBR: Supply Chain Management and Risk Pooling</a>
</div>

A centralized warehouse is simple to manage. Demand forecasting is easier. If one region spikes, you pull from inventory elsewhere. The downside: a customer in Busan waits an extra day for a shipment leaving Seoul. Efficient to manage, slow to respond.
 
A distributed warehouse reverses that. The Busan warehouse ships to Busan customers same day. Fast, but each location carries its own inventory, raising operating costs. When one runs dry, restocking from another isn't instant.
 
**Where you split determines latency (logistics cost).** That's the first question Risk Pooling asks.
 
But warehouse location is only half of it. How much the person running the warehouse knows about each order also changes outcomes.
 
A sorting worker at a central distribution center reads the barcode on the outside of the box and pushes it through. Whether the contents are glassware or fresh produce doesn't matter. The entire job is maximizing Throughput — and every detail beyond destination is noise to be discarded.
 
The regional warehouse manager works differently. They open the shipping manifest. Urgent order — call a courier. Cold chain item — reroute to a refrigerated vehicle. They pay with time (Latency) to read the information. In return, they avoid the expensive mistakes: wrong vehicle, damaged goods, missed priority flags.
 
Akerlof's Information Asymmetry operates here. The side with information and the side without it make different decisions. **No information means simple decisions. More information means more precise decisions. And acquiring information always carries a cost.**
 
Overlay the two theories and the question splits into two layers.
 
**Where to split** — Risk Pooling answers this. Bottleneck in connection count: use L4. Bottleneck in routing accuracy: use L7.
 
**Whether to read** — Information Asymmetry answers this. When the cost of acquiring information (parsing overhead) is less than the cost of acting without it (wrong routing), L7 is the rational choice. When it isn't, L4 is.
 
This is the same structure we've been tracing since Part 1. Goldratt asked where the constraint is. Coase and Williamson asked under what conditions it's worth paying the transaction cost. Akerlof showed how the gap in information splits behavior. Four parts, different names, same question: **where is the bottleneck right now, and what are you willing to give up to clear it?**

<br>

### The Bottom Line

DNS round-robin assigns turns without knowing server state. Information asymmetry warps the distribution. L4 gives up information and gains speed. L7 acquires information and gains precision. Each is a different answer to the same question: where do you absorb the cost?

Choosing which layer to split traffic at isn't a technical decision. It's a trade-off decision.

**Know where the bottleneck is, and you'll know where to split.**

Next up: everything covered so far — OSI layers, TCP handshake costs, HTTP evolution, load balancing — comes together in real systems. Three scenarios: an e-commerce platform, a live chat service, and a payment system. Where does the bottleneck form, and which choices resolve it?